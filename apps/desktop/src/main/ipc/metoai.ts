/**
 * MetoAi 控制台的 IPC 桥。
 *
 * 只做「校验入参 → 调 `main/metoai` → 归一化结果」；业务规则、协议形状与错误
 * 分类都在 `main/metoai/` 里。错误作为值返回（`MetoAiIpcResult`），因为 `Error`
 * 实例过不了结构化克隆，异常穿过进程边界后 `code`/`status` 会丢。
 *
 * 授权是「主进程发起、回调后由事件通知」的两段式：`AUTHORIZE` / `AUTHORIZE_REOPEN`
 * 只负责打开浏览器，结果走 `session-changed`（成功）或 `authorize-rejected`（失败）。
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
	authorize,
	createKey,
	deleteKey,
	ensureModels,
	getOverview,
	logout,
	key as readKey,
	refresh,
	reopenAuthorize,
	session,
	setKeyStatus,
	siteConfig,
	subscription,
	tokens,
} from "../metoai/index.js";

const CHANNELS = {
	SESSION: "vetta:metoai:session",
	AUTHORIZE: "vetta:metoai:authorize",
	AUTHORIZE_REOPEN: "vetta:metoai:authorize:reopen",
	LOGOUT: "vetta:metoai:logout",
	REFRESH: "vetta:metoai:refresh",
	OVERVIEW: "vetta:metoai:overview",
	SUBSCRIPTION: "vetta:metoai:subscription",
	TOKENS_LIST: "vetta:metoai:tokens:list",
	TOKENS_CREATE: "vetta:metoai:tokens:create",
	TOKENS_DELETE: "vetta:metoai:tokens:delete",
	TOKENS_SET_STATUS: "vetta:metoai:tokens:set-status",
	TOKENS_KEY: "vetta:metoai:tokens:key",
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
	handle(CHANNELS.SUBSCRIPTION, () => subscription());
	handle(CHANNELS.REFRESH, () => refresh());
	handle(CHANNELS.LOGOUT, () => logout());

	handle(CHANNELS.AUTHORIZE, () => authorize());
	handle(CHANNELS.AUTHORIZE_REOPEN, () => reopenAuthorize());

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

	handle(CHANNELS.MODELS_ENSURE, () => ensureModels());

	return () => {
		for (const channel of Object.values(CHANNELS)) ipcMain.removeHandler(channel);
	};
}
