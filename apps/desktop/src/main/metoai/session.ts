import type { MetoAiSessionSnapshot, MetoAiUser } from "../../shared/metoai-types.js";
import { readAgentSettingsDocument, updateAgentSettingsDocument } from "../agent-settings/settings-document-store.js";
import { getAppLogger } from "../logger.js";
import {
	decodeData,
	describeError,
	METOAI_ORIGIN,
	MetoAiHttpError,
	type MetoAiRequestInit,
	metoaiRequest,
	readSetCookie,
	toUnixSeconds,
} from "./api.js";

const log = getAppLogger("metoai");

/** 与 `service.RefreshCookieName` 一致；刷新令牌只经 Cookie 传递。 */
const REFRESH_COOKIE_NAME = "new_api_refresh";
const SETTINGS_KEY = "metoaiSession";
/** 访问令牌剩余寿命低于此值就提前刷新（服务端 TTL 只有 15 分钟）。 */
const REFRESH_AHEAD_MS = 60_000;
const REQUEST_TIMEOUT_MS = 20_000;

interface MetoAiStoredSession {
	accessToken: string;
	refreshToken: string;
	/** unix 秒。 */
	accessExpiresAt: number;
	user: MetoAiUser | null;
}

let cached: MetoAiStoredSession | null | undefined;
let refreshInFlight: Promise<RefreshOutcome> | null = null;

type RefreshOutcome = "ok" | "unauthorized" | "transient";

export function getSessionSnapshot(): MetoAiSessionSnapshot {
	const session = readSession();
	if (!session) return { status: "anonymous" };
	return {
		status: "authenticated",
		user: session.user ?? emptyUser(),
		accessExpiresAt: new Date(session.accessExpiresAt * 1000).toISOString(),
	};
}

export function getSessionUser(): MetoAiUser | null {
	return readSession()?.user ?? null;
}

export function hasSession(): boolean {
	return readSession() !== null;
}

/** 用最新一次 `GET /api/user/self` 的结果覆盖本地缓存的用户快照。 */
export function cacheUser(user: MetoAiUser): void {
	const session = readSession();
	if (!session) return;
	writeSession({ ...session, user });
}

export function clearSession(): void {
	cached = null;
	updateAgentSettingsDocument((settings) => {
		delete settings[SETTINGS_KEY];
	});
}

function emptyUser(): MetoAiUser {
	return {
		id: 0,
		username: "",
		display_name: "",
		quota: 0,
		used_quota: 0,
		request_count: 0,
	};
}

function readSession(): MetoAiStoredSession | null {
	if (cached !== undefined) return cached;
	cached = parseStoredSession(readAgentSettingsDocument()[SETTINGS_KEY]);
	return cached;
}

function parseStoredSession(value: unknown): MetoAiStoredSession | null {
	if (!isRecord(value)) return null;
	const { accessToken, refreshToken, accessExpiresAt } = value;
	if (typeof accessToken !== "string" || !accessToken) return null;
	if (typeof refreshToken !== "string" || !refreshToken) return null;
	if (typeof accessExpiresAt !== "number" || !Number.isFinite(accessExpiresAt)) {
		return null;
	}
	const user = isRecord(value.user) ? (value.user as unknown as MetoAiUser) : null;
	return { accessToken, refreshToken, accessExpiresAt, user };
}

function writeSession(session: MetoAiStoredSession): void {
	cached = session;
	updateAgentSettingsDocument((settings) => {
		settings[SETTINGS_KEY] = session;
	});
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 刷新令牌形如 `<sid>.<secret>`，服务端要求 `X-Auth-Session` 与之一致。 */
function sessionIdOf(refreshToken: string): string | undefined {
	const separator = refreshToken.indexOf(".");
	if (separator <= 0) return undefined;
	return refreshToken.slice(0, separator);
}

function isExpiringSoon(session: MetoAiStoredSession): boolean {
	return session.accessExpiresAt * 1000 - Date.now() < REFRESH_AHEAD_MS;
}

// ------------------------------------------------------------ 写入授权结果

/** 一次桌面授权换来的会话素材。 */
export interface MetoAiAuthBundle {
	accessToken: string;
	refreshToken: string;
	/** unix 秒。 */
	accessExpiresAt: number;
	user: MetoAiUser | null;
}

/**
 * 用授权换来的会话覆盖本地会话。
 *
 * 桌面端没有 cookie jar，刷新令牌只在换码响应里回传一次，因此必须在这里落盘；
 * 之后的续期与登出仍走 `refreshAccessToken` / `logout`（与原密码登录完全一致）。
 */
export function acceptAuthBundle(bundle: MetoAiAuthBundle): MetoAiUser {
	const user = bundle.user ?? emptyUser();
	writeSession({
		accessToken: bundle.accessToken,
		refreshToken: bundle.refreshToken,
		accessExpiresAt: bundle.accessExpiresAt,
		user,
	});
	log.info("session established via desktop authorization");
	return user;
}

// ---------------------------------------------------------------- 刷新

interface MetoAiEnvelope {
	success?: boolean;
	message?: string;
	/** 站点错误码，如 `AUTH_SESSION_REVOKED`；刷新令牌被吊销时据此判定终态。 */
	code?: string;
	data?: Record<string, unknown>;
}

async function readEnvelope(response: Response): Promise<MetoAiEnvelope> {
	const text = await response.text();
	if (!text) return {};
	try {
		const parsed: unknown = JSON.parse(text);
		return isRecord(parsed) ? (parsed as MetoAiEnvelope) : {};
	} catch {
		return {};
	}
}

/**
 * 刷新访问令牌。服务端 `AccessTokenTTL` 只有 15 分钟，持久会话必须依赖它。
 *
 * 必须带 `Origin`：`SessionCookieOriginGuard` 在 `SessionCookieSecure` 开启时会校验
 * 来源，而它接受「请求自身的 scheme://host」，所以发送站点源恒可通过。
 */
export async function refreshAccessToken(): Promise<RefreshOutcome> {
	if (refreshInFlight) return refreshInFlight;
	refreshInFlight = runRefresh().finally(() => {
		refreshInFlight = null;
	});
	return refreshInFlight;
}

async function runRefresh(): Promise<RefreshOutcome> {
	const session = readSession();
	if (!session) return "unauthorized";

	let response: Response;
	try {
		response = await metoaiRequest("/user/auth/refresh", {
			method: "POST",
			headers: refreshHeaders(session.refreshToken),
			timeoutMs: REQUEST_TIMEOUT_MS,
		});
	} catch (error) {
		log.warn(`token refresh transport failed: ${describeError(error)}`);
		return "transient";
	}

	const envelope = await readEnvelope(response);
	if (!response.ok || envelope.success === false) {
		const code = typeof envelope.code === "string" ? envelope.code : "";
		// 409 AUTH_REFRESH_RACE / 429 是并发或限流，凭据本身还有效。
		if (response.status === 401 || response.status === 403) {
			log.warn(`token refresh rejected: status=${response.status} code=${code || "-"}`);
			clearSession();
			return "unauthorized";
		}
		log.warn(`token refresh failed: status=${response.status} code=${code || "-"}`);
		return "transient";
	}

	const data = envelope.data ?? {};
	const accessToken = typeof data.access_token === "string" ? data.access_token : "";
	if (!accessToken) return "transient";

	writeSession({
		accessToken,
		refreshToken: readSetCookie(response, REFRESH_COOKIE_NAME) ?? session.refreshToken,
		accessExpiresAt: toUnixSeconds(data.access_expires_at),
		user: isRecord(data.user) ? (data.user as unknown as MetoAiUser) : session.user,
	});
	log.debug("access token refreshed");
	return "ok";
}

function refreshHeaders(refreshToken: string): Record<string, string> {
	const headers: Record<string, string> = {
		Cookie: `${REFRESH_COOKIE_NAME}=${refreshToken}`,
		Origin: METOAI_ORIGIN,
	};
	const sid = sessionIdOf(refreshToken);
	if (sid) headers["X-Auth-Session"] = sid;
	return headers;
}

// ---------------------------------------------------------------- 登出

export async function logout(): Promise<void> {
	const session = readSession();
	if (!session) return;
	try {
		await metoaiRequest("/user/auth/logout", {
			method: "POST",
			headers: {
				...refreshHeaders(session.refreshToken),
				Authorization: `Bearer ${session.accessToken}`,
			},
			timeoutMs: 10_000,
		});
	} catch (error) {
		// 本地登出必须成功，即使服务端不可达。
		log.warn(`logout request failed: ${describeError(error)}`);
	}
	clearSession();
}

// ------------------------------------------------------------ 带鉴权请求

/**
 * 携带访问令牌请求控制台接口；401 时刷新一次并重放。
 *
 * 刷新失败只区分两类：终态（会话被吊销/凭据无效）与瞬时（网络、5xx、限流）。
 * 只有终态才清理本地会话，避免网络抖动把用户踢下线。
 */
export async function authedFetch(path: string, init: MetoAiRequestInit = {}): Promise<Response> {
	let session = readSession();
	if (!session) throw new MetoAiHttpError("not-logged-in", 401, "AUTH_UNAUTHORIZED");

	if (isExpiringSoon(session)) {
		const outcome = await refreshAccessToken();
		if (outcome === "unauthorized") {
			throw new MetoAiHttpError("not-logged-in", 401, "AUTH_UNAUTHORIZED");
		}
		session = readSession();
		if (!session) throw new MetoAiHttpError("not-logged-in", 401, "AUTH_UNAUTHORIZED");
	}

	let response = await sendAuthed(path, init, session.accessToken);
	if (response.status !== 401) return response;

	const outcome = await refreshAccessToken();
	if (outcome !== "ok") {
		throw new MetoAiHttpError("not-logged-in", 401, "AUTH_UNAUTHORIZED");
	}
	const refreshed = readSession();
	if (!refreshed) throw new MetoAiHttpError("not-logged-in", 401, "AUTH_UNAUTHORIZED");

	response = await sendAuthed(path, init, refreshed.accessToken);
	if (response.status === 401) clearSession();
	return response;
}

function sendAuthed(path: string, init: MetoAiRequestInit, accessToken: string): Promise<Response> {
	return metoaiRequest(path, {
		...init,
		headers: { ...init.headers, Authorization: `Bearer ${accessToken}` },
	});
}

/** 带鉴权请求控制台接口并拆信封。 */
export async function authedData<T>(path: string, init: MetoAiRequestInit = {}): Promise<T> {
	return decodeData<T>(path, await authedFetch(path, init));
}
