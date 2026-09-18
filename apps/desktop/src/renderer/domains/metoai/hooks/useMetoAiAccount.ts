/**
 * MetaToken 个人中心的数据与动作：余额、Key、充值。
 *
 * 三段职责分开成三个 hook（账号概览 / Key 管理 / 充值），由连接层组装——它们各自
 * 有独立的加载与错误状态，混在一个 model 里会让「充值失败」把「Key 列表」也置灰。
 */

import { displayAmountToQuota, formatQuota, isSessionTerminal, unwrapMetoAi } from "@shared/lib/metoai";
import { metoaiOverviewAtom, metoaiTokensAtom, metoaiTopUpInfoAtom, metoaiTopUpRecordsAtom } from "@shared/store/atoms";
import { useAtom } from "jotai";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type {
	MetoAiCurrencyConfig,
	MetoAiPaymentChannel,
	MetoAiPaymentGateway,
	MetoAiToken,
	MetoAiTopUpInfo,
	MetoAiTopUpRecord,
	MetoAiUser,
} from "@/shared/metoai-types";

/** 站点令牌状态码 → i18n key。数字来自服务端契约，不在这里翻译。 */
const TOKEN_STATUS_LABEL_KEYS = {
	1: "keys.status.enabled",
	2: "keys.status.disabled",
	3: "keys.status.expired",
	4: "keys.status.exhausted",
} as const;

export type MetoAiTokenStatusLabelKey = (typeof TOKEN_STATUS_LABEL_KEYS)[keyof typeof TOKEN_STATUS_LABEL_KEYS];

export function tokenStatusLabelKey(status: number): MetoAiTokenStatusLabelKey {
	return TOKEN_STATUS_LABEL_KEYS[status as keyof typeof TOKEN_STATUS_LABEL_KEYS] ?? "keys.status.disabled";
}

/** 落库的额度是「额度单位」，展示与输入都要过币种规则。 */
function currencyOf(overview: { currency: MetoAiCurrencyConfig } | null): MetoAiCurrencyConfig {
	return (
		overview?.currency ?? {
			quotaPerUnit: 500_000,
			displayType: "USD",
			exchangeRate: 1,
			symbol: "$",
			isTokenDisplay: false,
		}
	);
}

export interface MetoAiAccountModel {
	loading: boolean;
	error: string | null;
	user: MetoAiUser | null;
	currency: MetoAiCurrencyConfig;
	/** 已按站点币种规则格式化的余额与用量。 */
	balance: string;
	used: string;
	requests: number;
	actions: { reload: () => Promise<void> };
}

export function useMetoAiAccountModel(authenticated: boolean): MetoAiAccountModel {
	const { t } = useTranslation("metoai");
	const [overview, setOverview] = useAtom(metoaiOverviewAtom);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const reload = useCallback(async (): Promise<void> => {
		setLoading(true);
		setError(null);
		try {
			setOverview(unwrapMetoAi(await window.vetta.metoai.overview()));
		} catch (caught) {
			setError(caught instanceof Error && caught.message !== "network" ? caught.message : t("account.errorLoad"));
		} finally {
			setLoading(false);
		}
	}, [setOverview, t]);

	useEffect(() => {
		if (!authenticated) {
			setOverview(null);
			return;
		}
		void reload();
	}, [authenticated, reload, setOverview]);

	const currency = currencyOf(overview);
	const user = overview?.user ?? null;
	const balance = user ? formatQuota(user.quota, currency) : "-";
	const used = user ? formatQuota(user.used_quota, currency) : "-";

	return useMemo(
		() => ({
			loading,
			error,
			user,
			currency,
			balance,
			used,
			requests: user?.request_count ?? 0,
			actions: { reload },
		}),
		[balance, currency, error, loading, reload, used, user],
	);
}

export interface MetoAiKeyRow {
	id: number;
	name: string;
	maskedKey: string;
	status: number;
	statusLabelKey: MetoAiTokenStatusLabelKey;
	/** 已格式化的剩余额度；`unlimited` 为 true 时界面改显示「不限」。 */
	quota: string;
	used: string;
	unlimited: boolean;
	/** 已格式化的到期时间，或 "never"。 */
	expiry: string;
	group: string;
}

export interface MetoAiKeysModel {
	loading: boolean;
	error: string | null;
	/** 新建 / 删除 / 启停进行中：界面据此禁用同一行的其它操作。 */
	busy: boolean;
	rows: MetoAiKeyRow[];
	/** 新建表单的额度单位换算：把用户输入的展示金额换成 `remain_quota`。 */
	toQuota: (amount: number) => number;
	actions: {
		reload: () => Promise<void>;
		create: (draft: { name: string; unlimited: boolean; amount: number }) => Promise<boolean>;
		remove: (id: number) => Promise<void>;
		toggleStatus: (id: number, enabled: boolean) => Promise<void>;
		/** 读取完整 Key（含 `sk-` 前缀）；站点对该接口有限流，调用方应按需触发。 */
		reveal: (id: number) => Promise<string | null>;
	};
}

export function useMetoAiKeysModel(authenticated: boolean, currency: MetoAiCurrencyConfig): MetoAiKeysModel {
	const { t } = useTranslation("metoai");
	const [tokens, setTokens] = useAtom(metoaiTokensAtom);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	const reload = useCallback(async (): Promise<void> => {
		setLoading(true);
		setError(null);
		try {
			const page = unwrapMetoAi(await window.vetta.metoai.tokens({ page: 1, pageSize: 100 }));
			setTokens(page.items ?? []);
		} catch (caught) {
			setError(caught instanceof Error && caught.message !== "network" ? caught.message : t("keys.errorLoad"));
		} finally {
			setLoading(false);
		}
	}, [setTokens, t]);

	useEffect(() => {
		if (!authenticated) {
			setTokens([]);
			return;
		}
		void reload();
	}, [authenticated, reload, setTokens]);

	const create = useCallback(
		async (draft: { name: string; unlimited: boolean; amount: number }): Promise<boolean> => {
			setBusy(true);
			setError(null);
			try {
				unwrapMetoAi(
					await window.vetta.metoai.createKey({
						name: draft.name.trim(),
						unlimited_quota: draft.unlimited,
						...(draft.unlimited ? {} : { remain_quota_dollars: draft.amount }),
						expired_time: -1,
					}),
				);
				await reload();
				return true;
			} catch (caught) {
				setError(caught instanceof Error && caught.message !== "network" ? caught.message : t("keys.errorCreate"));
				return false;
			} finally {
				setBusy(false);
			}
		},
		[reload, t],
	);

	const remove = useCallback(
		async (id: number): Promise<void> => {
			setBusy(true);
			setError(null);
			try {
				unwrapMetoAi(await window.vetta.metoai.deleteKey(id));
				await reload();
			} catch (caught) {
				setError(caught instanceof Error && caught.message !== "network" ? caught.message : t("keys.errorDelete"));
			} finally {
				setBusy(false);
			}
		},
		[reload, t],
	);

	const toggleStatus = useCallback(
		async (id: number, enabled: boolean): Promise<void> => {
			setBusy(true);
			setError(null);
			try {
				unwrapMetoAi(await window.vetta.metoai.setKeyStatus(id, enabled ? 1 : 2));
				await reload();
			} catch (caught) {
				setError(caught instanceof Error && caught.message !== "network" ? caught.message : t("keys.errorToggle"));
			} finally {
				setBusy(false);
			}
		},
		[reload, t],
	);

	const reveal = useCallback(async (id: number): Promise<string | null> => {
		try {
			return unwrapMetoAi(await window.vetta.metoai.key(id));
		} catch {
			return null;
		}
	}, []);

	const rows = useMemo<MetoAiKeyRow[]>(
		() =>
			tokens.map((token: MetoAiToken) => ({
				id: token.id,
				name: token.name,
				maskedKey: `sk-${token.key}`,
				status: token.status,
				statusLabelKey: tokenStatusLabelKey(token.status),
				quota: formatQuota(token.remain_quota, currency),
				used: formatQuota(token.used_quota, currency),
				unlimited: token.unlimited_quota,
				expiry: token.expired_time === -1 ? "never" : new Date(token.expired_time * 1000).toLocaleDateString(),
				group: token.group,
			})),
		[tokens, currency],
	);

	return useMemo(
		() => ({
			loading,
			error,
			busy,
			rows,
			toQuota: (amount: number) => displayAmountToQuota(amount, currency),
			actions: { reload, create, remove, toggleStatus, reveal },
		}),
		[loading, error, busy, rows, currency, reload, create, remove, toggleStatus, reveal],
	);
}

export interface MetoAiTopUpModel {
	loading: boolean;
	error: string | null;
	/** 站点启用的支付渠道；为空表示站点没开在线支付。 */
	methods: MetoAiPaymentChannel[];
	amountOptions: number[];
	minTopUp: number;
	redemptionEnabled: boolean;
	records: MetoAiTopUpRecord[];
	/** 最近一次预结算的实付金额（展示金额）；null 表示未计算。 */
	quote: number | null;
	quoting: boolean;
	paying: boolean;
	actions: {
		reload: () => Promise<void>;
		quote: (amount: number, gateway: MetoAiPaymentGateway) => Promise<void>;
		pay: (amount: number, gateway: MetoAiPaymentGateway) => Promise<boolean>;
		redeem: (code: string) => Promise<boolean>;
	};
}

/** 支付方式条目里的最低下单额可能是数字或数字字符串。 */
function readAmount(value: unknown, fallback = 0): number {
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (typeof value === "string") {
		const parsed = Number.parseFloat(value);
		if (Number.isFinite(parsed)) return parsed;
	}
	return fallback;
}

/**
 * 把 `/api/user/topup/info` 折算成可选渠道列表。
 *
 * `pay_methods` 是站点自配的具体方式（`type` 为 `alipay` / `wechat` / `stripe` 等），
 * 每一项都要单独可选：`type` 会原样回传成 `payment_method`，聚合成一个 `epay` 值
 * 站点并不认识。`waffo` 走独立的计量式收银台、由开关单独下发，因此从列表里剔除，
 * 避免同一个渠道出现两次。
 */
function resolvePaymentOptions(info: MetoAiTopUpInfo | null): MetoAiPaymentChannel[] {
	if (!info) return [];
	const channels: MetoAiPaymentChannel[] = [];
	const seen = new Set<string>();

	for (const method of info.enable_online_topup ? (info.pay_methods ?? []) : []) {
		const type = method.type?.trim();
		const name = method.name?.trim();
		if (!type || !name || type === "waffo" || seen.has(type)) continue;
		seen.add(type);
		const minTopUp = readAmount(method.min_topup);
		channels.push({
			method: type,
			name,
			// 站点可能只在顶层给 Stripe 的最低下单额，条目里为 0 时回退过去。
			minTopUp: type === "stripe" && minTopUp <= 0 ? info.stripe_min_topup : minTopUp,
		});
	}

	// 独立网关不一定出现在 `pay_methods` 里，按各自的开关补齐。
	const dedicated: MetoAiPaymentChannel[] = [
		...(info.enable_stripe_topup ? [{ method: "stripe", name: "Stripe", minTopUp: info.stripe_min_topup }] : []),
		...(info.enable_creem_topup ? [{ method: "creem", name: "Creem", minTopUp: info.stripe_min_topup }] : []),
		...(info.enable_waffo_pancake_topup
			? [
					{
						method: "waffo_pancake",
						name: "Waffo Pancake",
						minTopUp: info.waffo_pancake_min_topup ?? 0,
					},
				]
			: []),
		...(info.enable_waffo_topup ? [{ method: "waffo", name: "Waffo", minTopUp: info.waffo_min_topup ?? 0 }] : []),
	];
	for (const channel of dedicated) {
		if (seen.has(channel.method)) continue;
		seen.add(channel.method);
		channels.push(channel);
	}

	return channels;
}

export function useMetoAiTopUpModel(authenticated: boolean): MetoAiTopUpModel {
	const { t } = useTranslation("metoai");
	const [info, setInfo] = useAtom(metoaiTopUpInfoAtom);
	const [records, setRecords] = useAtom(metoaiTopUpRecordsAtom);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [quote, setQuote] = useState<number | null>(null);
	const [quoting, setQuoting] = useState(false);
	const [paying, setPaying] = useState(false);

	const reload = useCallback(async (): Promise<void> => {
		setLoading(true);
		setError(null);
		try {
			const [nextInfo, nextRecords] = await Promise.all([
				window.vetta.metoai.topUpInfo().then(unwrapMetoAi),
				window.vetta.metoai.topUpRecords(1, 20).then(unwrapMetoAi),
			]);
			setInfo(nextInfo);
			setRecords(nextRecords.items ?? []);
		} catch (caught) {
			setError(caught instanceof Error && caught.message !== "network" ? caught.message : t("topUp.errorLoad"));
		} finally {
			setLoading(false);
		}
	}, [setInfo, setRecords, t]);

	useEffect(() => {
		if (!authenticated) {
			setInfo(null);
			setRecords([]);
			return;
		}
		void reload();
	}, [authenticated, reload, setInfo, setRecords]);

	const calculateQuote = useCallback(async (amount: number, gateway: MetoAiPaymentGateway): Promise<void> => {
		setQuoting(true);
		try {
			setQuote(unwrapMetoAi(await window.vetta.metoai.quote(amount, gateway)));
		} catch {
			setQuote(null);
		} finally {
			setQuoting(false);
		}
	}, []);

	const pay = useCallback(
		async (amount: number, gateway: MetoAiPaymentGateway): Promise<boolean> => {
			setPaying(true);
			setError(null);
			try {
				const launch = unwrapMetoAi(await window.vetta.metoai.pay(amount, gateway));
				if (launch.kind === "unsupported") {
					setError(t("topUp.errorLaunch"));
					return false;
				}
				// 收银台关闭不代表支付成功：到账以服务端回调为准，这里只把记录刷新一遍。
				await reload();
				return true;
			} catch (caught) {
				setError(caught instanceof Error && caught.message !== "network" ? caught.message : t("topUp.errorLaunch"));
				return false;
			} finally {
				setPaying(false);
			}
		},
		[reload, t],
	);

	const redeem = useCallback(
		async (code: string): Promise<boolean> => {
			setError(null);
			try {
				unwrapMetoAi(await window.vetta.metoai.redeem(code));
				await reload();
				return true;
			} catch (caught) {
				setError(caught instanceof Error && caught.message !== "network" ? caught.message : t("topUp.errorRedeem"));
				return false;
			}
		},
		[reload, t],
	);

	return useMemo(
		() => ({
			loading,
			error,
			methods: resolvePaymentOptions(info),
			amountOptions: info?.amount_options ?? [],
			minTopUp: info?.min_topup ?? 0,
			redemptionEnabled: info?.enable_redemption === true,
			records,
			quote,
			quoting,
			paying,
			actions: { reload, quote: calculateQuote, pay, redeem },
		}),
		[loading, error, info, records, quote, quoting, paying, reload, calculateQuote, pay, redeem],
	);
}

export { isSessionTerminal };
