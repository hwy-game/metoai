import { webcrypto } from "node:crypto";
import type { MetoAiLoginResult, MetoAiSessionSnapshot, MetoAiUser } from "../../shared/metoai-types.js";
import { readAgentSettingsDocument, updateAgentSettingsDocument } from "../agent-settings/settings-document-store.js";
import { getAppLogger } from "../logger.js";
import {
	decodeData,
	decodeRaw,
	describeError,
	METOAI_ORIGIN,
	MetoAiHttpError,
	type MetoAiRequestInit,
	metoaiRequest,
	readSetCookie,
} from "./api.js";

const log = getAppLogger("metoai");

/** 与 `service.RefreshCookieName` 一致；刷新令牌只经 Cookie 传递。 */
const REFRESH_COOKIE_NAME = "new_api_refresh";
const SETTINGS_KEY = "metoaiSession";
/** 访问令牌剩余寿命低于此值就提前刷新（服务端 TTL 只有 15 分钟）。 */
const REFRESH_AHEAD_MS = 60_000;
const LOGIN_TIMEOUT_MS = 20_000;

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

// ---------------------------------------------------------------- 登录

interface LoginEnvelope {
	success?: boolean;
	message?: string;
	/** 站点错误码，如 `AUTH_SESSION_REVOKED`；刷新令牌被吊销时据此判定终态。 */
	code?: string;
	data?: Record<string, unknown>;
}

export async function loginWithPassword(input: {
	username: string;
	password: string;
	turnstileToken?: string;
}): Promise<MetoAiLoginResult> {
	const body: Record<string, unknown> = {
		username: input.username,
		password: input.password,
	};
	const encryptionKey = await fetchPasswordEncryptionKey();
	if (encryptionKey) {
		try {
			body.password_encrypted = await encryptPassword(input.password, encryptionKey.publicKey);
			body.encryption_key_id = encryptionKey.kid;
			body.password = "";
		} catch (error) {
			log.warn(`password encryption failed: ${describeError(error)}`);
		}
	}

	const response = await metoaiRequest("/user/login", {
		method: "POST",
		query: input.turnstileToken ? { turnstile: input.turnstileToken } : undefined,
		body,
		timeoutMs: LOGIN_TIMEOUT_MS,
	});
	return applyLoginResponse(response, "password");
}

export async function loginWithTwoFactor(input: { flowToken: string; code: string }): Promise<MetoAiLoginResult> {
	const response = await metoaiRequest("/user/login/2fa", {
		method: "POST",
		body: { flow_token: input.flowToken, code: input.code },
		timeoutMs: LOGIN_TIMEOUT_MS,
	});
	return applyLoginResponse(response, "2fa");
}

async function applyLoginResponse(response: Response, method: string): Promise<MetoAiLoginResult> {
	const envelope = await readEnvelope(response);
	if (!response.ok || envelope.success === false) {
		return { status: "failed", message: failureMessage(envelope, response.status) };
	}
	const data = envelope.data ?? {};

	if (data.require_2fa === true) {
		const flowToken = typeof data.flow_token === "string" ? data.flow_token : "";
		if (!flowToken) return { status: "failed", message: "2fa-flow-missing" };
		return {
			status: "two-factor-required",
			flowToken,
			expiresAt: toIsoString(data.expires_at),
		};
	}

	const accessToken = typeof data.access_token === "string" ? data.access_token : "";
	if (!accessToken) return { status: "failed", message: "access-token-missing" };

	const refreshToken = readSetCookie(response, REFRESH_COOKIE_NAME) ?? "";
	const accessExpiresAt = toUnixSeconds(data.access_expires_at);
	const user = isRecord(data.user) ? (data.user as unknown as MetoAiUser) : null;

	writeSession({ accessToken, refreshToken, accessExpiresAt, user });
	log.info(`logged in via ${method}`);
	return { status: "ok", user: user ?? emptyUser() };
}

async function readEnvelope(response: Response): Promise<LoginEnvelope> {
	const text = await response.text();
	if (!text) return {};
	try {
		const parsed: unknown = JSON.parse(text);
		return isRecord(parsed) ? (parsed as LoginEnvelope) : {};
	} catch {
		return {};
	}
}

function failureMessage(envelope: LoginEnvelope, status: number): string {
	if (typeof envelope.message === "string" && envelope.message) {
		return envelope.message;
	}
	return status >= 400 ? `HTTP ${status}` : "login-failed";
}

function toIsoString(value: unknown): string {
	return new Date(toUnixSeconds(value) * 1000).toISOString();
}

function toUnixSeconds(value: unknown): number {
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (typeof value === "string") {
		const parsed = Number.parseInt(value, 10);
		if (Number.isFinite(parsed)) return parsed;
	}
	return Math.floor(Date.now() / 1000);
}

// ------------------------------------------------------- 密码加密（可选）

interface PasswordEncryptionKey {
	kid: string;
	publicKey: string;
}

/** 站点未启用密码加密时返回 null，此时按明文口令提交。 */
async function fetchPasswordEncryptionKey(): Promise<PasswordEncryptionKey | null> {
	try {
		const response = await metoaiRequest("/user/login/encryption-key", {
			timeoutMs: 8_000,
		});
		const envelope = await readEnvelope(response);
		if (envelope.success === false) return null;
		const data = envelope.data ?? {};
		if (data.enabled !== true) return null;
		const kid = typeof data.kid === "string" ? data.kid : "";
		const publicKey = typeof data.public_key === "string" ? data.public_key : "";
		return kid && publicKey ? { kid, publicKey } : null;
	} catch (error) {
		log.debug(`password encryption key unavailable: ${describeError(error)}`);
		return null;
	}
}

async function encryptPassword(password: string, publicKeyPem: string): Promise<string> {
	const key = await webcrypto.subtle.importKey(
		"spki",
		pemToDer(publicKeyPem),
		{ name: "RSA-OAEP", hash: "SHA-256" },
		false,
		["encrypt"],
	);
	const ciphertext = await webcrypto.subtle.encrypt({ name: "RSA-OAEP" }, key, new TextEncoder().encode(password));
	return Buffer.from(new Uint8Array(ciphertext)).toString("base64");
}

function pemToDer(pem: string): Uint8Array {
	const body = pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
	return new Uint8Array(Buffer.from(body, "base64"));
}

// ---------------------------------------------------------------- 刷新

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
			timeoutMs: LOGIN_TIMEOUT_MS,
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

/** 带鉴权请求不套标准信封的接口。 */
export async function authedRaw<T>(path: string, init: MetoAiRequestInit = {}): Promise<T> {
	return decodeRaw<T>(path, await authedFetch(path, init));
}
