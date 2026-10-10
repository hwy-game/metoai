/**
 * 站点额度单位与展示金额之间的换算。
 *
 * 站点的 `quota` / `remain_quota` 都是**额度单位**（整数），不是货币；展示成什么
 * 由 `/api/status` 的 `quota_per_unit` + `quota_display_type` 决定。渲染层不重复
 * 这套规则，一律通过这里换算，保证「余额卡片」与「Key 额度输入框」用同一份定义。
 *
 * 规则与 metotoken 站点前端 `lib/currency.ts#getDisplayMeta` 一致。
 */

import type { MetoAiCurrencyConfig, MetoAiQuotaDisplayType, MetoAiSiteConfig } from "../../shared/metoai-types.js";

/** 站点未返回 `quota_per_unit` 时的兜底值，与后端默认一致。 */
const DEFAULT_QUOTA_PER_UNIT = 500_000;
const DEFAULT_USD_EXCHANGE_RATE = 1;
const DEFAULT_CUSTOM_SYMBOL = "¤";

function positiveOr(value: unknown, fallback: number): number {
	return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

function nonEmptyString(value: unknown, fallback: string): string {
	return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

export function resolveCurrencyConfig(site: MetoAiSiteConfig | null | undefined): MetoAiCurrencyConfig {
	const quotaPerUnit = positiveOr(site?.quota_per_unit, DEFAULT_QUOTA_PER_UNIT);
	const displayType: MetoAiQuotaDisplayType = site?.quota_display_type ?? "USD";

	switch (displayType) {
		case "TOKENS":
			return { quotaPerUnit, displayType, exchangeRate: 1, symbol: "", isTokenDisplay: true };
		case "CNY":
			return {
				quotaPerUnit,
				displayType,
				exchangeRate: positiveOr(site?.usd_exchange_rate, DEFAULT_USD_EXCHANGE_RATE),
				symbol: "¥",
				isTokenDisplay: false,
			};
		case "CUSTOM":
			return {
				quotaPerUnit,
				displayType,
				exchangeRate: positiveOr(site?.custom_currency_exchange_rate, DEFAULT_USD_EXCHANGE_RATE),
				symbol: nonEmptyString(site?.custom_currency_symbol, DEFAULT_CUSTOM_SYMBOL),
				isTokenDisplay: false,
			};
		default:
			return { quotaPerUnit, displayType: "USD", exchangeRate: 1, symbol: "$", isTokenDisplay: false };
	}
}

/** 额度单位 → 展示金额。 */
export function quotaToDisplayAmount(quota: number, config: MetoAiCurrencyConfig): number {
	if (!Number.isFinite(quota)) return 0;
	if (config.isTokenDisplay) return quota;
	return (quota / config.quotaPerUnit) * config.exchangeRate;
}

/** 展示金额 → 额度单位（写入 `remain_quota` 前调用）。 */
export function displayAmountToQuota(amount: number, config: MetoAiCurrencyConfig): number {
	if (!Number.isFinite(amount)) return 0;
	if (config.isTokenDisplay) return Math.round(amount);
	return Math.round((amount / config.exchangeRate) * config.quotaPerUnit);
}
