/**
 * MetoAI 桌面授权登录（Authorization Code + PKCE S256）。
 *
 * 客户端不收集 MetoAI 的用户名与密码：把用户送到系统浏览器的授权页，站点
 * 授权后回调本进程，主进程再用一次性 code + code_verifier 换取会话。token 因此
 * 不进浏览器历史与 Referer；PKCE 挡掉「同机其它程序截获 code 再换 token」。
 *
 * state 与 verifier 只存内存：进程重启即失效，回调会被丢弃，用户重新点一次授权
 * 即可。落盘反而会多一份需要清理的持久状态。
 *
 * 本模块只管协议（发起、校验回调、换码），不落盘会话——写入由 `session.ts` 的
 * `acceptAuthBundle` 负责，调用方是 `metoai/index.ts`。
 */

import { createHash, randomBytes, randomUUID } from "node:crypto";
import { app } from "electron";
import { METOAI_SITE_URL } from "../../shared/metoai.js";
import type { MetoAiAuthorizeRejectionReason, MetoAiAuthorizeResult, MetoAiUser } from "../../shared/metoai-types.js";
import { getAppLogger } from "../logger.js";
import { ensureLoopbackCallbackUrl } from "../loopback-callback.js";
import { openExternalUrl } from "../open-external.js";
import { decodeData, MetoAiHttpError, metoaiRequest, toUnixSeconds } from "./api.js";

const log = getAppLogger("metoai");
/** 站点预注册的桌面客户端标识。 */
const CLIENT_ID = "metoai_desktop";

/** 打包版回调地址（自定义 scheme）。 */
export const METOAI_CALLBACK_URL = "metoai://metotoken/callback";

/** 开发版回环回调路径；宿主按同一路径注册处理器。 */
export const METOAI_LOOPBACK_PATH = "/metotoken/callback";

/** 授权页是站点 SPA 的顶层路由。 */
const AUTHORIZE_PAGE_URL = `${METOAI_SITE_URL}/desktop-authorize`;

/** 服务端的授权码 TTL 是 10 分钟；超时的 state 一律拒绝。 */
const STATE_TTL_MS = 10 * 60_000;

const EXCHANGE_TIMEOUT_MS = 20_000;

interface PendingAuthorize {
	verifier: string;
	/** 发起时用的回调地址：换码必须回传同一个值，否则服务端拒绝。 */
	redirectUri: string;
	createdAt: number;
}

/** 进行中的授权。只保留最近一次发起的 state：旧链接再回调过来也不该被接受。 */
const pendingStates = new Map<string, PendingAuthorize>();

/** 换码成功后的会话素材；由调用方交给 `session.ts` 落盘。 */
export interface AuthorizeBundle {
	accessToken: string;
	refreshToken: string;
	/** unix 秒。 */
	accessExpiresAt: number;
	user: MetoAiUser | null;
}

/** 通过校验的回调：换码所需的全部素材。 */
export interface AuthorizeGrant {
	code: string;
	codeVerifier: string;
	redirectUri: string;
}

/** 校验回调的结论：`accepted` 带换码素材，`rejected` 带拒绝原因。 */
export type AuthorizeCallbackOutcome =
	| ({ status: "accepted" } & AuthorizeGrant)
	| { status: "rejected"; reason: Exclude<MetoAiAuthorizeRejectionReason, "exchange-failed"> };

// ---------------------------------------------------------------------- PKCE

/** 43 位 base64url 随机串，满足服务端对 code_verifier 的长度要求。 */
export function createCodeVerifier(): string {
	return randomBytes(32).toString("base64url");
}

/** RFC 7636 的 S256：`base64url(sha256(verifier))`。 */
export function codeChallengeOf(verifier: string): string {
	return createHash("sha256").update(verifier).digest("base64url");
}

// -------------------------------------------------------------------- 发起授权

/**
 * 发起授权：生成 state 与 PKCE 配对并在系统浏览器打开授权页。
 * 重复调用会作废上一次的 state——后发起的那次才算数。
 */
export async function startAuthorize(): Promise<MetoAiAuthorizeResult> {
	const state = randomUUID();
	const entry: PendingAuthorize = {
		verifier: createCodeVerifier(),
		redirectUri: await resolveRedirectUri(),
		createdAt: Date.now(),
	};
	pendingStates.clear();
	pendingStates.set(state, entry);

	log.info("opening MetoAI desktop authorization page");
	await openExternalUrl(authorizeUrlFor(state, entry));
	return { status: "started" };
}

/** 重新打开当前授权页，复用同一个 state；没有进行中的授权时退化为发起一次新的。 */
export async function reopenAuthorize(): Promise<void> {
	const current = currentPending();
	if (!current) {
		await startAuthorize();
		return;
	}
	// 重开是一次新的 10 分钟窗口：state 仍复用，但时效要刷新，否则首次发起 10 分钟后
	// 重开、用户在浏览器里完成同意时，回调会因为 `createdAt` 过旧被判过期。
	current.entry.createdAt = Date.now();
	await openExternalUrl(authorizeUrlFor(current.state, current.entry));
}

/**
 * 开发模式用 loopback HTTP 回调，打包后用自定义 scheme。
 * 原因见 `loopback-callback.ts` 顶部注释。
 */
async function resolveRedirectUri(): Promise<string> {
	if (app.isPackaged) return METOAI_CALLBACK_URL;
	return await ensureLoopbackCallbackUrl(METOAI_LOOPBACK_PATH);
}

function currentPending(): { state: string; entry: PendingAuthorize } | null {
	for (const [state, entry] of pendingStates) return { state, entry };
	return null;
}

function authorizeUrlFor(state: string, entry: PendingAuthorize): string {
	const url = new URL(AUTHORIZE_PAGE_URL);
	url.searchParams.set("response_type", "code");
	url.searchParams.set("client_id", CLIENT_ID);
	url.searchParams.set("redirect_uri", entry.redirectUri);
	url.searchParams.set("state", state);
	url.searchParams.set("code_challenge", codeChallengeOf(entry.verifier));
	url.searchParams.set("code_challenge_method", "S256");
	return url.toString();
}

// -------------------------------------------------------------------- 回调校验
/** 是否有进行中的授权（含尚未消费的过期 state）；回调入口据此丢弃本机噪声请求。 */
export function hasPendingAuthorize(): boolean {
	return pendingStates.size > 0;
}

/**
 * 校验并消费一次回调。
 *
 * 返回 `rejected` 表示这次回调不可信或用户取消：调用方必须丢弃其中的 code。
 * state 匹配后立即从表里删掉，同一条链接不能被用第二次。
 */
export function consumeAuthorizeCallback(url: URL): AuthorizeCallbackOutcome {
	const state = url.searchParams.get("state") ?? "";
	const entry = state ? pendingStates.get(state) : undefined;
	if (!entry) {
		log.warn("拒绝 MetoAI 授权回调：state 不匹配（可能来自过期链接、旧标签页或非本次授权）");
		return { status: "rejected", reason: "state-mismatch" };
	}
	pendingStates.delete(state);

	if (Date.now() - entry.createdAt > STATE_TTL_MS) {
		log.warn("拒绝 MetoAI 授权回调：state 已过期");
		return { status: "rejected", reason: "state-expired" };
	}
	if (url.searchParams.get("error")) return { status: "rejected", reason: "access-denied" };

	const code = url.searchParams.get("code") ?? "";
	if (!code) return { status: "rejected", reason: "missing-code" };

	return { status: "accepted", code, codeVerifier: entry.verifier, redirectUri: entry.redirectUri };
}

// ---------------------------------------------------------------------- 换码

interface DesktopExchangeData {
	access_token?: unknown;
	access_expires_at?: unknown;
	refresh_token?: unknown;
	user?: unknown;
}

/**
 * `POST /api/user/auth/desktop/exchange`：一次性 code + verifier 换会话。
 *
 * 桌面端没有 cookie jar，refresh token 只在响应体里回传一次（浏览器登录走
 * `Set-Cookie`），因此必须在这里读出来交给调用方保存。该端点不需要 Origin。
 */
export async function exchangeCode(grant: AuthorizeGrant): Promise<AuthorizeBundle> {
	const response = await metoaiRequest("/user/auth/desktop/exchange", {
		method: "POST",
		body: {
			client_id: CLIENT_ID,
			code: grant.code,
			code_verifier: grant.codeVerifier,
			redirect_uri: grant.redirectUri,
		},
		timeoutMs: EXCHANGE_TIMEOUT_MS,
	});

	const data = await decodeData<DesktopExchangeData>("/user/auth/desktop/exchange", response);
	const accessToken = typeof data.access_token === "string" ? data.access_token : "";
	const refreshToken = typeof data.refresh_token === "string" ? data.refresh_token : "";
	if (!accessToken || !refreshToken) {
		throw new MetoAiHttpError("desktop-exchange-response-invalid", 0, "DESKTOP_AUTH_REQUEST_INVALID");
	}

	return {
		accessToken,
		refreshToken,
		accessExpiresAt: toUnixSeconds(data.access_expires_at),
		user: isRecord(data.user) ? (data.user as unknown as MetoAiUser) : null,
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
