/**
 * MetaToken 控制台的 IPC 桥。
 *
 * 只做「校验入参 → 调 `main/metoai` → 归一化结果」；业务规则、协议形状与错误
 * 分类都在 `main/metoai/` 里。错误作为值返回（`MetoAiIpcResult`），因为 `Error`
 * 实例过不了结构化克隆，异常穿过进程边界后 `code`/`status` 会丢。
 */

import { ipcMain } from "electron";
import type {
	MetoAiErrorPayload,
	MetoAiIpcResult,
	MetoAiTokenDraft,
	MetoAiTokenPageQuery,
} from "../../shared/metoai-types.js";
import { MetoAiHttpError } from "../metoai/api.js";
import {
	createKey,
	deleteKey,
	ensureModels,
	getOverview,
	login,
	loginTwoFactor,
	logout,
	pay,
	quote,
	key as readKey,
	redeem,
	refresh,
	session,
	setKeyStatus,
	siteConfig,
	tokens,
	topUpInfo,
	topUpRecords,
} from "../metoai/index.js";

const CHANNELS = {
	SESSION: "vetta:metoai:session",
	LOGIN: "vetta:metoai:login",
	LOGIN_2FA: "vetta:metoai:login-2fa",
	LOGOUT: "vetta:metoai:logout",
	REFRESH: "vetta:metoai:refresh",
	OVERVIEW: "vetta:metoai:overview",
	TOKENS_LIST: "vetta:metoai:tokens:list",
	TOKENS_CREATE: "vetta:metoai:tokens:create",
	TOKENS_DELETE: "vetta:metoai:tokens:delete",
	TOKENS_SET_STATUS: "vetta:metoai:tokens:set-status",
	TOKENS_KEY: "vetta:metoai:tokens:key",
	TOPUP_INFO: "vetta:metoai:topup:info",
	TOPUP_RECORDS: "vetta:metoai:topup:records",
	TOPUP_QUOTE: "vetta:metoai:topup:quote",
	TOPUP_REDEEM: "vetta:metoai:topup:redeem",
	TOPUP_PAY: "vetta:metoai:topup:pay",
	MODELS_ENSURE: "vetta:metoai:models:ensure",
	SITE_CONFIG: "vetta:metoai:site-config",
} as const;

/** 站点令牌状态：1 启用 / 2 禁用。 */
const TOKEN_STATUSES: readonly number[] = [1, 2];

function assertNonEmptyString(value: unknown, field: string): asserts value is string {
	if (typeof value !== "string" || !value.trim()) throw new Error(`Invalid ${field}`);
}

function assertFiniteNumber(value: unknown, field: string): asserts value is number {
	if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`Invalid ${field}`);
}

/**
 * 支付方式是站点配置的自由字符串（epay 系是 alipay/wechat 这类具体方式），
 * 无法穷举。只拦掉空值与带空白的怪值：它会被回传成 JSON 字段，不是路径片段，
 * 不存在注入面，具体合法性由站点判定。
 */
function assertPaymentMethod(value: unknown): asserts value is string {
	if (typeof value !== "string" || !value.trim() || /\s/.test(value)) {
		throw new Error(`Invalid payment method: ${String(value)}`);
	}
}

function assertTokenStatus(value: unknown): asserts value is number {
	if (typeof value !== "number" || !TOKEN_STATUSES.includes(value)) {
		throw new Error(`Invalid token status: ${String(value)}`);
	}
}

function assertTokenDraft(value: unknown): asserts value is MetoAiTokenDraft {
	if (typeof value !== "object" || value === null) throw new Error("Invalid token draft");
	const draft = value as Partial<MetoAiTokenDraft>;
	assertNonEmptyString(draft.name, "token name");
	if (typeof draft.unlimited_quota !== "boolean") throw new Error("Invalid unlimited_quota");
	if (draft.remain_quota_dollars !== undefined) assertFiniteNumber(draft.remain_quota_dollars, "remain_quota_dollars");
	if (draft.expired_time !== undefined) assertFiniteNumber(draft.expired_time, "expired_time");
	if (draft.model_limits !== undefined && !Array.isArray(draft.model_limits)) {
		throw new Error("Invalid model_limits");
	}
}

function toErrorPayload(error: unknown): MetoAiErrorPayload {
	if (error instanceof MetoAiHttpError) {
		return {
			code: error.code ?? (error.status === 0 ? "network" : "http"),
			message: error.message,
			status: error.status,
		};
	}
	if (error instanceof Error) return { code: "unknown", message: error.message, status: 0 };
	return { code: "unknown", message: String(error), status: 0 };
}

/** 统一包装：校验/业务异常都变成可序列化的结果值。 */
function handle<T>(channel: string, handler: (...args: unknown[]) => Promise<T> | T): void {
	ipcMain.handle(channel, async (_event, ...args: unknown[]): Promise<MetoAiIpcResult<T>> => {
		try {
			return { ok: true, value: await handler(...args) };
		} catch (error) {
			return { ok: false, error: toErrorPayload(error) };
		}
	});
}

export function registerMetoAiIpc(): () => void {
	handle(CHANNELS.SESSION, () => session());
	handle(CHANNELS.SITE_CONFIG, () => siteConfig());
	handle(CHANNELS.OVERVIEW, () => getOverview());
	handle(CHANNELS.REFRESH, () => refresh());
	handle(CHANNELS.LOGOUT, () => logout());

	handle(CHANNELS.LOGIN, (username, password, turnstileToken) => {
		assertNonEmptyString(username, "username");
		assertNonEmptyString(password, "password");
		return login({
			username,
			password,
			...(typeof turnstileToken === "string" && turnstileToken ? { turnstileToken } : {}),
		});
	});

	handle(CHANNELS.LOGIN_2FA, (flowToken, code) => {
		assertNonEmptyString(flowToken, "flowToken");
		assertNonEmptyString(code, "code");
		return loginTwoFactor({ flowToken, code });
	});

	handle(CHANNELS.TOKENS_LIST, (query) => tokens((query ?? {}) as MetoAiTokenPageQuery));

	handle(CHANNELS.TOKENS_CREATE, (draft) => {
		assertTokenDraft(draft);
		return createKey(draft);
	});

	handle(CHANNELS.TOKENS_DELETE, (id) => {
		assertFiniteNumber(id, "token id");
		return deleteKey(id);
	});

	handle(CHANNELS.TOKENS_SET_STATUS, (id, status) => {
		assertFiniteNumber(id, "token id");
		assertTokenStatus(status);
		return setKeyStatus(id, status);
	});

	handle(CHANNELS.TOKENS_KEY, (id) => {
		assertFiniteNumber(id, "token id");
		return readKey(id);
	});

	handle(CHANNELS.TOPUP_INFO, () => topUpInfo());
	handle(CHANNELS.TOPUP_RECORDS, (page, pageSize) =>
		topUpRecords(
			typeof page === "number" && Number.isFinite(page) ? page : undefined,
			typeof pageSize === "number" && Number.isFinite(pageSize) ? pageSize : undefined,
		),
	);

	handle(CHANNELS.TOPUP_QUOTE, (amount, method) => {
		assertFiniteNumber(amount, "amount");
		assertPaymentMethod(method);
		return quote(amount, method);
	});

	handle(CHANNELS.TOPUP_REDEEM, (code) => {
		assertNonEmptyString(code, "redemption code");
		return redeem(code);
	});

	handle(CHANNELS.TOPUP_PAY, (amount, method) => {
		assertFiniteNumber(amount, "amount");
		assertPaymentMethod(method);
		return pay(amount, method);
	});

	handle(CHANNELS.MODELS_ENSURE, () => ensureModels());

	return () => {
		for (const channel of Object.values(CHANNELS)) ipcMain.removeHandler(channel);
	};
}
