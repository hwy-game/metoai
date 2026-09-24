/**
 * MetoAi 桌面授权（Authorization Code + PKCE S256）的纯逻辑测试。
 *
 * 这里不碰真网络：授权页地址从被 mock 的 `openExternalUrl` 里取，回调校验直接喂 URL，
 * 换码用 `vi.stubGlobal("fetch")` 顶掉全局 fetch 后断言请求体与响应映射。
 * 覆盖的是「客户端能自己保证的部分」——PKCE 变换、回调地址形态、state 的一次性与
 * 时效、回调参数解析、换码请求与响应映射；站点侧对 code 的校验由后端测试负责。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** `app.isPackaged` 决定回调走自定义 scheme 还是本机回环，测试里逐条切换。 */
const electronApp = vi.hoisted(() => ({ isPackaged: true }));

vi.mock("electron", () => ({ app: electronApp }));

vi.mock("../logger.js", () => ({
	getAppLogger: () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() }),
}));

vi.mock("../open-external.js", () => ({ openExternalUrl: vi.fn(async () => undefined) }));

const {
	METOAI_CALLBACK_URL,
	codeChallengeOf,
	consumeAuthorizeCallback,
	createCodeVerifier,
	exchangeCode,
	hasPendingAuthorize,
	reopenAuthorize,
	startAuthorize,
} = await import("./authorize.js");
const { MetoAiHttpError } = await import("./api.js");
const { openExternalUrl } = await import("../open-external.js");

/** 最近一次打开的授权页地址。 */
function lastAuthorizePage(): URL {
	const url = vi.mocked(openExternalUrl).mock.calls.at(-1)?.[0];
	if (!url) throw new Error("授权页没有被打开");
	return new URL(url);
}

function stateOf(url: URL): string {
	return url.searchParams.get("state") ?? "";
}

function callbackFor(state: string, query: string): URL {
	return new URL(`${METOAI_CALLBACK_URL}?state=${state}&${query}`);
}

/** 换码的入参：回调校验给出的三要素。 */
const GRANT = { code: "CODE-1", codeVerifier: "VERIFIER-1", redirectUri: METOAI_CALLBACK_URL };

/** 站点应答用真实 `Response` 造；换码是纯 HTTP 契约，这里只断言请求与映射。 */
function jsonResponse(status: number, payload: unknown): Response {
	return new Response(JSON.stringify(payload), {
		status,
		headers: { "content-type": "application/json" },
	});
}

beforeEach(() => {
	vi.mocked(openExternalUrl).mockClear();
	electronApp.isPackaged = true;
});

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

describe("MetoAi 桌面授权", () => {
	it("按 RFC 7636 生成 S256 challenge，verifier 满足长度与字符集要求", () => {
		// RFC 7636 附录 B 的官方测试向量。
		expect(codeChallengeOf("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe(
			"E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
		);
		expect(createCodeVerifier()).toMatch(/^[A-Za-z0-9_-]{43}$/);
	});

	it("授权页带齐协议参数，打包版回调用自定义 scheme", async () => {
		await startAuthorize();

		const url = lastAuthorizePage();
		expect(`${url.origin}${url.pathname}`).toBe("https://www.metotoken.ai/desktop-authorize");
		expect(url.searchParams.get("response_type")).toBe("code");
		expect(url.searchParams.get("client_id")).toBe("metoai_desktop");
		expect(url.searchParams.get("redirect_uri")).toBe(METOAI_CALLBACK_URL);
		expect(url.searchParams.get("code_challenge_method")).toBe("S256");
		expect(url.searchParams.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/);
		expect(stateOf(url)).not.toBe("");
	});

	it("开发版回调用字面 127.0.0.1 的 http 回环地址", async () => {
		electronApp.isPackaged = false;

		await startAuthorize();

		expect(lastAuthorizePage().searchParams.get("redirect_uri")).toMatch(
			/^http:\/\/127\.0\.0\.1:\d+\/metotoken\/callback$/,
		);
	});

	it("state 匹配时给出换码素材，且 code_challenge 与 verifier 配对", async () => {
		await startAuthorize();
		const authorizePage = lastAuthorizePage();

		const outcome = consumeAuthorizeCallback(callbackFor(stateOf(authorizePage), "code=CODE-1"));

		expect(outcome).toMatchObject({ status: "accepted", code: "CODE-1", redirectUri: METOAI_CALLBACK_URL });
		if (outcome.status !== "accepted") throw new Error("回调应被接受");
		expect(codeChallengeOf(outcome.codeVerifier)).toBe(authorizePage.searchParams.get("code_challenge"));
	});

	it("同一条回调只能消费一次", async () => {
		await startAuthorize();
		const state = stateOf(lastAuthorizePage());

		expect(consumeAuthorizeCallback(callbackFor(state, "code=CODE-1")).status).toBe("accepted");
		expect(consumeAuthorizeCallback(callbackFor(state, "code=CODE-1"))).toEqual({
			status: "rejected",
			reason: "state-mismatch",
		});
	});

	it("拒绝未知 state 的回调", async () => {
		await startAuthorize();

		expect(consumeAuthorizeCallback(callbackFor("not-this-state", "code=CODE-1"))).toEqual({
			status: "rejected",
			reason: "state-mismatch",
		});
	});

	it("拒绝超过 10 分钟 TTL 的回调", async () => {
		await startAuthorize();
		const state = stateOf(lastAuthorizePage());

		const now = Date.now();
		vi.useFakeTimers();
		vi.setSystemTime(now + 11 * 60_000);

		expect(consumeAuthorizeCallback(callbackFor(state, "code=CODE-1"))).toEqual({
			status: "rejected",
			reason: "state-expired",
		});
	});

	it("重开授权页会刷新 10 分钟时效，超时后重开的回调仍被接受", async () => {
		await startAuthorize();
		const state = stateOf(lastAuthorizePage());

		const now = Date.now();
		vi.useFakeTimers();
		vi.setSystemTime(now + 11 * 60_000);
		await reopenAuthorize();

		expect(consumeAuthorizeCallback(callbackFor(state, "code=CODE-1"))).toMatchObject({ status: "accepted" });
	});

	it("用户取消或缺 code 时按原因拒绝", async () => {
		await startAuthorize();
		expect(consumeAuthorizeCallback(callbackFor(stateOf(lastAuthorizePage()), "error=access_denied"))).toEqual({
			status: "rejected",
			reason: "access-denied",
		});

		await startAuthorize();
		expect(consumeAuthorizeCallback(callbackFor(stateOf(lastAuthorizePage()), ""))).toEqual({
			status: "rejected",
			reason: "missing-code",
		});
	});

	it("重新发起授权作废上一次的 state，重开授权页则复用当前 state", async () => {
		await startAuthorize();
		const firstState = stateOf(lastAuthorizePage());
		const firstPage = lastAuthorizePage().toString();

		await reopenAuthorize();
		expect(lastAuthorizePage().toString()).toBe(firstPage);

		await startAuthorize();
		const secondState = stateOf(lastAuthorizePage());
		expect(secondState).not.toBe(firstState);
		expect(consumeAuthorizeCallback(callbackFor(firstState, "code=CODE-1"))).toEqual({
			status: "rejected",
			reason: "state-mismatch",
		});
	});

	it("进行中的授权状态随发起与消费变化", async () => {
		await startAuthorize();
		expect(hasPendingAuthorize()).toBe(true);

		consumeAuthorizeCallback(callbackFor(stateOf(lastAuthorizePage()), "code=CODE-1"));
		expect(hasPendingAuthorize()).toBe(false);
	});
});

describe("MetoAi 换码", () => {
	it("把 PKCE 三要素 POST 到桌面换码端点", async () => {
		const fetchMock = vi.fn(async () =>
			jsonResponse(200, { success: true, data: { access_token: "access-1", refresh_token: "refresh-1" } }),
		);
		vi.stubGlobal("fetch", fetchMock);

		await exchangeCode(GRANT);

		const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
		expect(new URL(url).pathname).toBe("/api/user/auth/desktop/exchange");
		expect(init.method).toBe("POST");
		expect(JSON.parse(String(init.body))).toEqual({
			client_id: "metoai_desktop",
			code: "CODE-1",
			code_verifier: "VERIFIER-1",
			redirect_uri: METOAI_CALLBACK_URL,
		});
	});

	it("换码成功时映射出会话素材", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () =>
				jsonResponse(200, {
					success: true,
					data: {
						access_token: "access-1",
						refresh_token: "refresh-1",
						access_expires_at: 1_700_000_000,
						user: { id: 1, username: "alice" },
					},
				}),
			),
		);

		await expect(exchangeCode(GRANT)).resolves.toEqual({
			accessToken: "access-1",
			refreshToken: "refresh-1",
			accessExpiresAt: 1_700_000_000,
			user: { id: 1, username: "alice" },
		});
	});

	it("响应缺少 refresh_token 时按请求无效拒绝", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => jsonResponse(200, { success: true, data: { access_token: "access-1" } })),
		);

		const error = await exchangeCode(GRANT).catch((caught: unknown) => caught);

		expect(error).toBeInstanceOf(MetoAiHttpError);
		expect((error as InstanceType<typeof MetoAiHttpError>).code).toBe("DESKTOP_AUTH_REQUEST_INVALID");
	});

	it("站点返回 400 时保留错误码，供渲染层选文案", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () =>
				jsonResponse(400, {
					success: false,
					code: "DESKTOP_AUTH_INVALID_GRANT",
					message: "Bad Request",
				}),
			),
		);

		const error = await exchangeCode(GRANT).catch((caught: unknown) => caught);

		expect(error).toBeInstanceOf(MetoAiHttpError);
		expect((error as InstanceType<typeof MetoAiHttpError>).code).toBe("DESKTOP_AUTH_INVALID_GRANT");
	});
});
