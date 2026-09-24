/**
 * MetoAi 渲染层的纯逻辑：IPC 结果解包与金额展示。
 *
 * 换算规则本身（`quotaPerUnit` / `exchangeRate` / 符号）由主进程从 `/api/status`
 * 推出后经 `MetoAiCurrencyConfig` 下发，这里只负责套用它做展示，不再自行判断
 * 币种——避免两处各有一套「什么算美元」的规则。
 */

import type { MetoAiCurrencyConfig, MetoAiIpcResult } from "@/shared/metoai-types";

/** IPC 返回的业务失败。`code` 可用于区分「会话失效」等需要改变界面的情况。 */
export class MetoAiCallError extends Error {
	readonly code: string;
	readonly status: number;

	constructor(error: { code: string; message: string; status: number }) {
		super(error.message);
		this.name = "MetoAiCallError";
		this.code = error.code;
		this.status = error.status;
	}
}

/** 会话已被服务端终结：界面应回到登录态，而不是提示「重试」。 */
export function isSessionTerminal(error: unknown): boolean {
	return (
		error instanceof MetoAiCallError &&
		(error.code === "AUTH_SESSION_REVOKED" ||
			error.code === "AUTH_UNAUTHORIZED" ||
			error.code === "AUTH_USER_DISABLED")
	);
}

/** 解包 IPC 结果；失败时抛出 `MetoAiCallError`，让调用方用 try/catch 处理。 */
export function unwrapMetoAi<T>(result: MetoAiIpcResult<T>): T {
	if (result.ok) return result.value;
	throw new MetoAiCallError(result.error);
}

/**
 * 站点配置未知时的兜底币种规则：按 new-api 的默认换算（500000 额度单位 = 1 美元）
 * 展示，好过把裸额度单位当成金额给用户看。
 */
export const DEFAULT_METOAI_CURRENCY: MetoAiCurrencyConfig = {
	quotaPerUnit: 500_000,
	displayType: "USD",
	exchangeRate: 1,
	symbol: "$",
	isTokenDisplay: false,
};

/** 概览自带的币种规则；还没拉到概览时退回兜底规则。 */
export function currencyFromOverview(overview: { currency: MetoAiCurrencyConfig } | null): MetoAiCurrencyConfig {
	return overview?.currency ?? DEFAULT_METOAI_CURRENCY;
}

/** 额度单位 → 展示金额。 */
export function quotaToDisplayAmount(quota: number, currency: MetoAiCurrencyConfig): number {
	if (!Number.isFinite(quota)) return 0;
	if (currency.isTokenDisplay) return quota;
	return (quota / currency.quotaPerUnit) * currency.exchangeRate;
}

/** 展示金额 → 额度单位。用于把用户输入的额度换回 `remain_quota`。 */
export function displayAmountToQuota(amount: number, currency: MetoAiCurrencyConfig): number {
	if (!Number.isFinite(amount)) return 0;
	if (currency.isTokenDisplay) return Math.round(amount);
	return Math.round((amount / currency.exchangeRate) * currency.quotaPerUnit);
}

function formatNumber(value: number, maximumFractionDigits: number): string {
	return new Intl.NumberFormat(undefined, {
		minimumFractionDigits: 0,
		maximumFractionDigits,
	}).format(value);
}

/**
 * 额度单位的展示文本。
 *
 * 大额缩写到 K/M：余额和用量常常是百万级额度单位，展开写会撑破卡片宽度；
 * 小额保留 4 位小数，否则「剩 0.0001 美元」会被显示成 0。
 */
export function formatQuota(quota: number, currency: MetoAiCurrencyConfig): string {
	const amount = quotaToDisplayAmount(quota, currency);
	const magnitude = Math.abs(amount);
	if (magnitude >= 1_000_000) return `${formatNumber(amount / 1_000_000, 2)}M`;
	if (magnitude >= 10_000) return `${formatNumber(amount / 1_000, 2)}K`;
	const digits = magnitude >= 1 ? 2 : 4;
	const text = formatNumber(amount, digits);
	return currency.isTokenDisplay ? text : `${currency.symbol}${text}`;
}

/** 不带符号的展示金额，用于可编辑输入框。 */
export function formatEditableAmount(amount: number): string {
	if (!Number.isFinite(amount)) return "0";
	return String(Number.parseFloat(amount.toFixed(4)));
}

/** 站点时间戳是秒级；-1 表示永不过期。 */
export function formatExpiry(expiredTime: number): "never" | string {
	if (expiredTime === -1 || expiredTime <= 0) return "never";
	return new Date(expiredTime * 1000).toLocaleDateString();
}
