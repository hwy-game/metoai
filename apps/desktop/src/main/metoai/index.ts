/**
 * MetaToken 领域门面：IPC 层只依赖这里，不直接碰 `api.ts` / `session.ts` 的细节。
 *
 * 登录成功后会在后台自动准备模型访问（签发/复用 Key 并写进 `models.json`），
 * 这样用户不必自己去站点复制 Key 再粘回来。准备是异步的：登录立即返回，界面
 * 先可用，模型就绪后由 `vetta:models:changed` 把渲染层的模型目录刷新掉。
 */

import { BrowserWindow } from "electron";
import type {
	MetoAiAccountOverview,
	MetoAiLoginResult,
	MetoAiModelAccessResult,
	MetoAiPaymentLaunch,
	MetoAiSessionSnapshot,
	MetoAiSiteConfig,
	MetoAiTokenDraft,
	MetoAiTokenPage,
	MetoAiTokenPageQuery,
	MetoAiTopUpInfo,
	MetoAiTopUpRecordPage,
} from "../../shared/metoai-types.js";
import { getAppLogger } from "../logger.js";
import {
	createToken,
	deleteToken,
	fetchSelf,
	getCurrencyConfig,
	getSiteConfig,
	getTopUpInfo,
	listTokens,
	listTopUpRecords,
	quoteAmount,
	redeemCode,
	requestPayment,
	revealTokenKey,
	setTokenStatus,
} from "./account.js";
import { openPaymentCashier } from "./cashier-window.js";
import { ensureModelAccess } from "./provider.js";
import {
	clearSession,
	logout as endSession,
	getSessionSnapshot,
	loginWithPassword,
	loginWithTwoFactor,
	refreshAccessToken,
} from "./session.js";

const log = getAppLogger("metoai");

export const METOAI_SESSION_CHANGED_CHANNEL = "vetta:metoai:session-changed";

function broadcastSessionChanged(): void {
	for (const window of BrowserWindow.getAllWindows()) {
		if (!window.isDestroyed()) window.webContents.send(METOAI_SESSION_CHANGED_CHANNEL, getSessionSnapshot());
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

export async function login(input: {
	username: string;
	password: string;
	turnstileToken?: string;
}): Promise<MetoAiLoginResult> {
	const result = await loginWithPassword(input);
	if (result.status === "ok") {
		broadcastSessionChanged();
		prepareModelAccessInBackground();
	}
	return result;
}

export async function loginTwoFactor(input: { flowToken: string; code: string }): Promise<MetoAiLoginResult> {
	const result = await loginWithTwoFactor(input);
	if (result.status === "ok") {
		broadcastSessionChanged();
		prepareModelAccessInBackground();
	}
	return result;
}

export async function logout(): Promise<void> {
	await endSession();
	broadcastSessionChanged();
}

/** 主动续期；返回是否仍然持有有效会话。 */
export async function refresh(): Promise<boolean> {
	const outcome = await refreshAccessToken();
	if (outcome === "unauthorized") broadcastSessionChanged();
	return outcome !== "unauthorized";
}

// -------------------------------------------------------------- 账户与站点

/**
 * 公开站点配置（`/api/status`）。登录前就要用它决定表单形态：
 * 是否开放注册、是否启用密码登录、是否需要 Turnstile、站点显示名与图标。
 */
export function siteConfig(): Promise<MetoAiSiteConfig> {
	return getSiteConfig();
}

export async function getOverview(): Promise<MetoAiAccountOverview> {
	const [user, siteConfig] = await Promise.all([fetchSelf(), getSiteConfig()]);
	return { user, siteConfig, currency: await getCurrencyConfig() };
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

// -------------------------------------------------------------------- 充值

export function topUpInfo(): Promise<MetoAiTopUpInfo> {
	return getTopUpInfo();
}

export function topUpRecords(page?: number, pageSize?: number): Promise<MetoAiTopUpRecordPage> {
	return listTopUpRecords(page, pageSize);
}

export function redeem(code: string): Promise<number> {
	return redeemCode(code);
}

export function quote(amount: number, method: string): Promise<number> {
	return quoteAmount(amount, method);
}

/**
 * 发起支付并等待收银台窗口关闭。
 *
 * 关闭**不等于**支付成功——到账以服务端回调为准，调用方关闭后应重新拉一次余额
 * 与充值记录。`form` 走内置收银台窗口，`redirect` 交系统浏览器。
 */
export async function pay(amount: number, method: string): Promise<MetoAiPaymentLaunch> {
	const launch = await requestPayment(amount, method);
	if (launch.kind === "redirect") {
		const { openExternalUrl } = await import("../open-external.js");
		await openExternalUrl(launch.url);
		return launch;
	}
	if (launch.kind === "form") {
		await openPaymentCashier({ url: launch.url, params: launch.params });
	}
	return launch;
}

// ---------------------------------------------------------------- 模型接入

export function ensureModels(): Promise<MetoAiModelAccessResult> {
	return ensureModelAccess();
}

/** 供登出流程之外的地方重置会话缓存（例如凭据被服务端吊销后）。 */
export function forgetSession(): void {
	clearSession();
	broadcastSessionChanged();
}
