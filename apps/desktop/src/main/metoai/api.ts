import { METOAI_API_BASE, METOAI_SITE_URL } from "../../shared/metoai.js";
import { getAppLogger } from "../logger.js";

const log = getAppLogger("metoai");

/** 站点源（scheme://host）。部分接口需要它充当 `Origin`，见 `session.ts`。 */
export const METOAI_ORIGIN = METOAI_SITE_URL;

export class MetoAiHttpError extends Error {
	readonly status: number;
	readonly code: string | undefined;

	constructor(message: string, status: number, code?: string) {
		super(message);
		this.name = "MetoAiHttpError";
		this.status = status;
		this.code = code;
	}

	/** 401 且不是终态错误：可以尝试刷新访问令牌后重放。 */
	get isRefreshable(): boolean {
		return this.status === 401 && this.code !== "AUTH_SESSION_REVOKED";
	}

	/** 会话已终结（被吊销 / 凭据无效）：只能重新登录。 */
	get isSessionTerminal(): boolean {
		return (
			this.code === "AUTH_SESSION_REVOKED" || this.code === "AUTH_UNAUTHORIZED" || this.code === "AUTH_USER_DISABLED"
		);
	}
}

export interface MetoAiRequestInit {
	method?: "GET" | "POST" | "PUT" | "DELETE";
	query?: Record<string, string | number | boolean | undefined>;
	body?: unknown;
	headers?: Record<string, string>;
	timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 15_000;

export function metoaiUrl(path: string, query?: MetoAiRequestInit["query"]): string {
	const url = new URL(`${METOAI_API_BASE}${path}`);
	if (query) {
		for (const [key, value] of Object.entries(query)) {
			if (value === undefined) continue;
			url.searchParams.set(key, String(value));
		}
	}
	return url.toString();
}

/**
 * 站点控制台接口的裸请求。只做传输：不注入凭据、不拆信封。
 * 凭据由 `session.ts` 的 `authedFetch` 统一附加。
 */
export async function metoaiRequest(path: string, init: MetoAiRequestInit = {}): Promise<Response> {
	const { method = "GET", query, body, headers, timeoutMs } = init;
	const url = metoaiUrl(path, query);
	const requestHeaders: Record<string, string> = {
		Accept: "application/json",
		...headers,
	};
	if (body !== undefined) {
		requestHeaders["Content-Type"] = "application/json";
	}

	let response: Response;
	try {
		response = await fetch(url, {
			method,
			headers: requestHeaders,
			body: body === undefined ? undefined : JSON.stringify(body),
			signal: AbortSignal.timeout(timeoutMs ?? DEFAULT_TIMEOUT_MS),
		});
	} catch (error) {
		// 只记方法与路径：URL 里可能带 turnstile token，body 里有口令。
		log.warn(`${method} ${path} transport failed: ${describeError(error)}`);
		throw new MetoAiHttpError("network", 0);
	}

	log.debug(`${method} ${path} -> ${response.status}`);
	return response;
}

interface MetoAiEnvelope<T> {
	success?: boolean;
	message?: string;
	code?: string;
	data?: T;
}

function parseJson(text: string): unknown {
	if (!text) return undefined;
	try {
		return JSON.parse(text);
	} catch {
		return undefined;
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readEnvelope(payload: unknown): MetoAiEnvelope<unknown> {
	return isRecord(payload) ? (payload as MetoAiEnvelope<unknown>) : {};
}

function throwHttpError(path: string, response: Response, payload: unknown): never {
	const envelope = readEnvelope(payload);
	const message =
		typeof envelope.message === "string" && envelope.message ? envelope.message : `HTTP ${response.status}`;
	log.warn(`${path} failed: status=${response.status} code=${envelope.code ?? "-"}`);
	throw new MetoAiHttpError(message, response.status, envelope.code);
}

/** 拆 `{success, message, data}` 信封并返回 `data`。 */
export async function decodeData<T>(path: string, response: Response): Promise<T> {
	const payload = parseJson(await response.text());
	if (!response.ok) throwHttpError(path, response, payload);

	const envelope = readEnvelope(payload);
	if (envelope.success === false) {
		throw new MetoAiHttpError(envelope.message ?? `HTTP ${response.status}`, response.status, envelope.code);
	}
	return envelope.data as T;
}

/** 站点少数接口不套标准信封（`/api/user/pay`、`/api/user/amount`），原样返回。 */
export async function decodeRaw<T>(path: string, response: Response): Promise<T> {
	const payload = parseJson(await response.text());
	if (!response.ok) throwHttpError(path, response, payload);
	return payload as T;
}

/** 请求并拆信封，返回 `data`。 */
export function metoaiData<T>(path: string, init: MetoAiRequestInit = {}): Promise<T> {
	return metoaiRequest(path, init).then((response) => decodeData<T>(path, response));
}

/** 请求不套标准信封的接口，原样返回 JSON。 */
export function metoaiRaw<T>(path: string, init: MetoAiRequestInit = {}): Promise<T> {
	return metoaiRequest(path, init).then((response) => decodeRaw<T>(path, response));
}

/** 读 `Set-Cookie` 里某个 cookie 的值（登录时用来留存刷新令牌）。 */
export function readSetCookie(response: Response, name: string): string | undefined {
	for (const raw of response.headers.getSetCookie()) {
		const pair = raw.split(";", 1)[0] ?? "";
		const separator = pair.indexOf("=");
		if (separator <= 0) continue;
		if (pair.slice(0, separator).trim() !== name) continue;
		return pair.slice(separator + 1).trim();
	}
	return undefined;
}
/**
 * 站点的时间戳一律是 unix 秒。字段缺失或不可解析时退到「现在」——访问令牌会被
 * 判成立刻过期并触发一次刷新，比留下一个永不过期的假时间安全。
 */
export function toUnixSeconds(value: unknown): number {
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (typeof value === "string") {
		const parsed = Number.parseInt(value, 10);
		if (Number.isFinite(parsed)) return parsed;
	}
	return Math.floor(Date.now() / 1000);
}

export function describeError(error: unknown): string {
	if (error instanceof MetoAiHttpError) {
		return `${error.message} (status=${error.status} code=${error.code ?? "-"})`;
	}
	if (error instanceof Error) return `${error.name}: ${error.message}`;
	return String(error);
}
