/**
 * 退出登录：会话与本地模型凭据一起清掉，站点上的 Key 不动。
 *
 * 覆盖用户从设置页点「退出登录」之后主进程真正发生的事：撤销服务端会话、删除本地会话
 * 记录、把 `models.json` 里 MetoAI 预设的 Key 从凭据库移除（模型条目与 baseUrl 保留），
 * 并且登录后的后台预热不会把 Key 写回来。
 *
 * 只替掉宿主边界：electron、日志、打开浏览器、模型配置宿主与 fetch。会话落盘、模型配置
 * 持久化与凭据移除都走真实实现，因此断言的正是生产路径上的副作用。
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { METOAI_BASE_URL, METOAI_PRESET_ID } from "../../shared/metoai.js";
import type { ModelCredentialStore } from "../models/model-credential-store.js";
import { ModelSettingsService, type ModelsConfig } from "../models/model-settings-service.js";

vi.mock("electron", () => ({
	app: { isPackaged: true },
	BrowserWindow: { getAllWindows: () => [] },
}));

vi.mock("../logger.js", () => ({
	getAppLogger: () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() }),
}));

vi.mock("../open-external.js", () => ({ openExternalUrl: vi.fn(async () => undefined) }));

/** 模型配置宿主：真实 `ModelSettingsService` + 内存凭据库，只替掉磁盘与 Agent 运行时。 */
const host = vi.hoisted(() => ({ service: undefined as unknown as ModelSettingsService }));
vi.mock("../models/model-settings-host.js", () => ({
	getDesktopModelSettingsService: () => host.service,
}));

const { logout } = await import("./index.js");
const { acceptAuthBundle, getSessionSnapshot } = await import("./session.js");
const { ensureModelAccess } = await import("./provider.js");

const USER = { id: 1, username: "alice", display_name: "Alice", quota: 0, used_quota: 0, request_count: 0 };

function createCredentialStore(initial: Record<string, string>): ModelCredentialStore & {
	values: Map<string, string>;
} {
	const values = new Map(Object.entries(initial));
	return {
		values,
		isAvailable: () => true,
		has: (credentialRef) => values.has(credentialRef),
		get: (credentialRef) => values.get(credentialRef),
		set: (credentialRef, value) => {
			values.set(credentialRef, value);
		},
		remove: (credentialRef) => {
			values.delete(credentialRef);
		},
	};
}

let home: string;
let config: ModelsConfig;
let credentials: ReturnType<typeof createCredentialStore>;
let refreshRegistry: ReturnType<typeof vi.fn>;
let fetchMock: ReturnType<typeof vi.fn>;

/** 登录后的本地状态：会话已落盘，模型配置里是那把自动签发的 Key。 */
function signIn(): void {
	acceptAuthBundle({
		accessToken: "access-1",
		refreshToken: "sid-1.secret",
		accessExpiresAt: Math.floor(Date.now() / 1000) + 900,
		user: USER,
	});
}

beforeEach(() => {
	home = mkdtempSync(join(tmpdir(), "vetta-metoai-logout-"));
	vi.stubEnv("VETTA_HOME", home);

	credentials = createCredentialStore({ "metoai-cred": "sk-metoai", "other-cred": "sk-other" });
	config = {
		providers: {
			[METOAI_PRESET_ID]: {
				source: "template",
				templateId: METOAI_PRESET_ID,
				displayName: "MetoAI",
				icon: "MetoAI",
				api: "openai-completions",
				baseUrl: METOAI_BASE_URL,
				credentialRef: "metoai-cred",
				models: [{ id: "gpt-5" }, { id: "claude-4" }],
				modelsSyncedAt: "2026-01-01T00:00:00.000Z",
			},
			other: { baseUrl: "https://example.com/v1", credentialRef: "other-cred", models: [{ id: "m-1" }] },
		},
	};
	refreshRegistry = vi.fn(async () => {});
	host.service = new ModelSettingsService({
		readConfig: async () => config,
		writeConfig: async (next) => {
			config = next;
		},
		refreshRegistry,
		credentials,
	});

	fetchMock = vi.fn(
		async () =>
			new Response(JSON.stringify({ success: true }), {
				status: 200,
				headers: { "content-type": "application/json" },
			}),
	);
	vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.unstubAllEnvs();
	rmSync(home, { recursive: true, force: true });
});

describe("MetoAI 退出登录", () => {
	it("撤销服务端会话并清掉本地 Key，模型条目与站点上的 Key 都保留", async () => {
		signIn();

		await logout();

		// 站点侧只登出这条会话，不碰令牌列表。
		const [url, init] = fetchMock.mock.calls[0] as unknown as [string, { headers: Record<string, string> }];
		expect(new URL(url).pathname).toBe("/api/user/auth/logout");
		expect(init.headers.Authorization).toBe("Bearer access-1");
		expect(getSessionSnapshot().status).toBe("anonymous");

		// 本地凭据从配置与凭据库里一起消失，模型条目与 baseUrl 原样保留。
		const current = await host.service.getConfig();
		const metoai = current.providers[METOAI_PRESET_ID];
		expect(metoai?.apiKey).toBeUndefined();
		expect(metoai?.credentialRef).toBeUndefined();
		expect(metoai?.models?.map((model) => model.id)).toEqual(["gpt-5", "claude-4"]);
		expect(metoai?.baseUrl).toBe(METOAI_BASE_URL);
		expect(credentials.values.has("metoai-cred")).toBe(false);

		// 其它服务商的 Key 完全不受影响。
		expect(current.providers.other?.apiKey).toBe("sk-other");
		expect(credentials.values.get("other-cred")).toBe("sk-other");

		// 模型注册表与 Agent 运行时的凭据被刷新，运行中的会话立刻失去这把 Key。
		expect(refreshRegistry).toHaveBeenCalled();
	});

	it("退出后后台预热不会把 Key 写回来", async () => {
		signIn();

		await logout();

		await expect(ensureModelAccess()).resolves.toEqual({ ok: false, created: false, reason: "not-logged-in" });
		expect((await host.service.getConfig()).providers[METOAI_PRESET_ID]?.apiKey).toBeUndefined();
		expect(credentials.values.has("metoai-cred")).toBe(false);
	});

	it("没有会话时登出是空操作，不清掉用户自己填进预设的 Key", async () => {
		await logout();

		expect(fetchMock).not.toHaveBeenCalled();
		expect((await host.service.getConfig()).providers[METOAI_PRESET_ID]?.apiKey).toBe("sk-metoai");
		expect(credentials.values.has("metoai-cred")).toBe(true);
	});
});
