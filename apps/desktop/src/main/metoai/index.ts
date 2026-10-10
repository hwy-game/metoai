/**
 * MetoAI 领域门面：IPC 层只依赖这里，不直接碰 `api.ts` / `session.ts` 的细节。
 *
 * 登录只有两条路：系统浏览器授权（`authorize.ts`）与手动填 API Key（渲染层直连
 * 模型配置，不经过本模块）。授权成功后会在后台自动准备模型访问（签发/复用 Key
 * 并写进 `models.json`），这样用户不必自己去站点复制 Key 再粘回来。准备是异步的：
 * 授权立即完成，界面先可用，模型就绪后由 `vetta:models:changed` 把渲染层的模型
 * 目录刷新掉。
 */

import { BrowserWindow } from "electron";
import type {
	MetoAiAccountOverview,
	MetoAiAuthorizeRejection,
	MetoAiAuthorizeRejectionReason,
	MetoAiAuthorizeResult,
	MetoAiModelAccessResult,
	MetoAiSessionSnapshot,
	MetoAiSiteConfig,
	MetoAiSubscription,
	MetoAiTokenDraft,
	MetoAiTokenPage,
	MetoAiTokenPageQuery,
} from "../../shared/metoai-types.js";
import { getAppLogger } from "../logger.js";
import {
	createToken,
	deleteToken,
	fetchSelf,
	fetchSubscription,
	getCurrencyConfig,
	getSiteConfig,
	listTokens,
	revealTokenKey,
	setTokenStatus,
} from "./account.js";
import { describeError, MetoAiHttpError } from "./api.js";
import {
	consumeAuthorizeCallback,
	exchangeCode,
	hasPendingAuthorize,
	reopenAuthorize as reopenAuthorizeFlow,
	startAuthorize,
} from "./authorize.js";
import { ensureModelAccess, releaseModelAccess } from "./provider.js";
import {
	acceptAuthBundle,
	clearSession,
	logout as endSession,
	getSessionSnapshot,
	hasSession,
	refreshAccessToken,
} from "./session.js";

const log = getAppLogger("metoai");

export const METOAI_SESSION_CHANGED_CHANNEL = "vetta:metoai:session-changed";
export const METOAI_AUTHORIZE_REJECTED_CHANNEL = "vetta:metoai:authorize-rejected";

function broadcast(channel: string, payload: unknown): void {
	for (const window of BrowserWindow.getAllWindows()) {
		if (!window.isDestroyed()) window.webContents.send(channel, payload);
	}
}

/** 登录成功后立刻把「模型可用」这条路铺好；失败只记日志，不阻塞登录结果。 */
function prepareModelAccessInBackground(): void {
	void ensureModelAccess()
		.then((result) => {
			if (!result.ok) log.warn(`model access not ready after login: ${result.reason ?? "unknown"}`);
		})
		.catch((error: unknown) => log.warn(`model access preparation failed: ${String(error)}`));
}

// -------------------------------------------------------------------- 会话

export function session(): MetoAiSessionSnapshot {
	return getSessionSnapshot();
}

/** 在系统浏览器打开 MetoAI 授权页；结果由回调与 `session-changed` 事件决定。 */
export function authorize(): Promise<MetoAiAuthorizeResult> {
	return startAuthorize();
}

/** 重新打开授权页，复用同一个 state。 */
export function reopenAuthorize(): Promise<void> {
	return reopenAuthorizeFlow();
}

export async function logout(): Promise<void> {
	// 没有会话时登出是空操作：不能顺手清掉用户自己填进预设的 Key。
	const hadSession = hasSession();
	await endSession();
	if (hadSession) {
		// 本地凭据必须跟着会话一起清掉：只撤会话的话，写进模型配置的那把 Key 还能继续调用中转。
		await releaseModelAccess().catch((error: unknown) => {
			log.warn(`failed to release model access on logout: ${String(error)}`);
		});
	}
	broadcast(METOAI_SESSION_CHANGED_CHANNEL, getSessionSnapshot());
}

/** 主动续期；返回是否仍然持有有效会话。 */
export async function refresh(): Promise<boolean> {
	const outcome = await refreshAccessToken();
	if (outcome === "unauthorized") broadcast(METOAI_SESSION_CHANGED_CHANNEL, getSessionSnapshot());
	return outcome !== "unauthorized";
}

// ------------------------------------------------------------------ 授权回调

/**
 * 处理 `metoai://metotoken/callback` 深链（打包版）与开发版 loopback 回调。
 * 返回是否命中本模块的回调路径；未命中时宿主可继续交给其它处理器。
 */
export function handleProtocolUrl(parsed: URL): boolean {
	// 服务端拼出的回调 path 恒为 `/callback`，必须精确相等：`/callback-evil` 之类的
	// 前缀命中会把无关深链当成授权回调。
	if (parsed.hostname !== "metotoken" || parsed.pathname !== "/callback") return false;
	void completeAuthorization(parsed);
	return true;
}

/**
 * 校验回调并换码落盘。任何一步失败都只广播拒绝原因——渲染层据此把「等待授权」
 * 切回可重试状态，而不是让用户一直干等。
 */
async function completeAuthorization(parsed: URL): Promise<void> {
	// 本机任意进程都能对开发版回环地址发一次 GET。当前没有任何进行中的授权时静默丢弃：
	// 广播 `state-mismatch` 会让渲染层把「等待授权」切回 idle 并弹一条用户无法理解的错误。
	// 注意：有过期 state 时仍照常广播——用户确实需要知道要重新发起授权。
	if (!hasPendingAuthorize()) {
		log.debug("ignoring MetoAI authorization callback: no pending authorize");
		return;
	}

	const outcome = consumeAuthorizeCallback(parsed);
	if (outcome.status === "rejected") {
		log.warn(`desktop authorization rejected: ${outcome.reason}`);
		rejectAuthorize(outcome.reason);
		return;
	}

	try {
		acceptAuthBundle(await exchangeCode(outcome));
	} catch (error) {
		log.warn(`desktop authorization exchange failed: ${describeError(error)}`);
		// 只回传站点错误码：`error.message` 是英文 HTTP 状态短语，不能当用户文案。
		rejectAuthorize("exchange-failed", error instanceof MetoAiHttpError ? error.code : undefined);
		return;
	}

	broadcast(METOAI_SESSION_CHANGED_CHANNEL, getSessionSnapshot());
	prepareModelAccessInBackground();
}

function rejectAuthorize(reason: MetoAiAuthorizeRejectionReason, code?: string): void {
	const rejection: MetoAiAuthorizeRejection = code ? { reason, code } : { reason };
	broadcast(METOAI_AUTHORIZE_REJECTED_CHANNEL, rejection);
}

// -------------------------------------------------------------- 账户与站点

/**
 * 公开站点配置（`/api/status`）。用于币种与站点显示信息；登录表单形态不再依赖它
 * ——授权页在浏览器里，由站点自己负责。
 */
export function siteConfig(): Promise<MetoAiSiteConfig> {
	return getSiteConfig();
}

export async function getOverview(): Promise<MetoAiAccountOverview> {
	const [user, siteConfig] = await Promise.all([fetchSelf(), getSiteConfig()]);
	return { user, siteConfig, currency: await getCurrencyConfig() };
}

/** 当前生效的订阅；只读展示，购买与续费都在官网。 */
export function subscription(): Promise<MetoAiSubscription[]> {
	return fetchSubscription();
}

// -------------------------------------------------------------------- 令牌

export function tokens(query?: MetoAiTokenPageQuery): Promise<MetoAiTokenPage> {
	return listTokens(query);
}

export function createKey(draft: MetoAiTokenDraft): Promise<{ id: number; key: string | null }> {
	return createToken(draft);
}

export function deleteKey(id: number): Promise<void> {
	return deleteToken(id);
}

export function setKeyStatus(id: number, status: number): Promise<void> {
	return setTokenStatus(id, status);
}

export function key(id: number): Promise<string> {
	return revealTokenKey(id);
}

// ---------------------------------------------------------------- 模型接入

export function ensureModels(): Promise<MetoAiModelAccessResult> {
	return ensureModelAccess();
}

/** 供登出流程之外的地方重置会话缓存（例如凭据被服务端吊销后）。 */
export function forgetSession(): void {
	clearSession();
	broadcast(METOAI_SESSION_CHANGED_CHANNEL, getSessionSnapshot());
}
