/**
 * MetaToken 个人中心的数据与动作：余额、Key、订阅状态。
 *
 * 三段职责分开成三个 hook（账号概览 / Key 管理 / 订阅），由连接层组装——它们各自
 * 有独立的加载与错误状态，混在一个 model 里会让「订阅拉取失败」把「Key 列表」也置灰。
 *
 * 充值与订阅购买都不在这里：那是站点网页的事，客户端只读状态并给出官网入口。
 */

import {
	currencyFromOverview,
	displayAmountToQuota,
	formatQuota,
	isSessionTerminal,
	unwrapMetoAi,
} from "@shared/lib/metoai";
import {
	metoaiOverviewAtom,
	metoaiSubscriptionAtom,
	metoaiTokensAtom,
	writeMetoAiOverviewAtom,
} from "@shared/store/atoms";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { MetoAiCurrencyConfig, MetoAiSubscription, MetoAiToken, MetoAiUser } from "@/shared/metoai-types";

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
	const overview = useAtomValue(metoaiOverviewAtom);
	const writeOverview = useSetAtom(writeMetoAiOverviewAtom);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const reload = useCallback(async (): Promise<void> => {
		setLoading(true);
		setError(null);
		try {
			writeOverview(unwrapMetoAi(await window.vetta.metoai.overview()));
		} catch (caught) {
			setError(caught instanceof Error && caught.message !== "network" ? caught.message : t("account.errorLoad"));
		} finally {
			setLoading(false);
		}
	}, [writeOverview, t]);

	// 未登录时不必在这里清空概览：会话变回匿名由 App 根部的 provider 统一清（见 clearMetoAiStateAtom）。
	useEffect(() => {
		if (!authenticated) return;
		void reload();
	}, [authenticated, reload]);

	const currency = currencyFromOverview(overview);
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

/** 服务端订阅状态 → i18n key。未知状态一律中性展示，不猜语义。 */
const SUBSCRIPTION_STATUS_KEYS = {
	active: "subscription.status.active",
	expired: "subscription.status.expired",
	cancelled: "subscription.status.cancelled",
} as const;

export type MetoAiSubscriptionStatusKey =
	| (typeof SUBSCRIPTION_STATUS_KEYS)[keyof typeof SUBSCRIPTION_STATUS_KEYS]
	| "subscription.status.unknown";

export function subscriptionStatusLabelKey(status: string): MetoAiSubscriptionStatusKey {
	return SUBSCRIPTION_STATUS_KEYS[status as keyof typeof SUBSCRIPTION_STATUS_KEYS] ?? "subscription.status.unknown";
}

/** 一行订阅的展示数据；额度与时间都已按站点规则格式化。 */
export interface MetoAiSubscriptionRow {
	id: number;
	/** 套餐标题；站点没给出对应套餐时为 null，界面回退中性文案。 */
	planTitle: string | null;
	statusLabelKey: MetoAiSubscriptionStatusKey;
	/** 已用 / 总量，各自过币种规则。 */
	used: string;
	total: string;
	/** 已格式化的到期时间。 */
	expiresAt: string;
	/** 已格式化的下次额度重置时间；null 表示不重置。 */
	nextResetAt: string | null;
	autoRenew: boolean;
}

export interface MetoAiSubscriptionModel {
	loading: boolean;
	error: string | null;
	/** 当前生效的订阅；空数组表示没有订阅。 */
	rows: MetoAiSubscriptionRow[];
	actions: { reload: () => Promise<void> };
}

/** 订阅只有读取一条路：购买、续费、取消都在官网。 */
export function useMetoAiSubscriptionModel(
	authenticated: boolean,
	currency: MetoAiCurrencyConfig,
): MetoAiSubscriptionModel {
	const { t } = useTranslation("metoai");
	const [subscriptions, setSubscriptions] = useAtom(metoaiSubscriptionAtom);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const reload = useCallback(async (): Promise<void> => {
		setLoading(true);
		setError(null);
		try {
			setSubscriptions(unwrapMetoAi(await window.vetta.metoai.subscription()));
		} catch (caught) {
			setError(
				caught instanceof Error && caught.message !== "network" ? caught.message : t("subscription.errorLoad"),
			);
		} finally {
			setLoading(false);
		}
	}, [setSubscriptions, t]);

	useEffect(() => {
		if (!authenticated) {
			setSubscriptions([]);
			return;
		}
		void reload();
	}, [authenticated, reload, setSubscriptions]);

	const rows = useMemo<MetoAiSubscriptionRow[]>(
		() =>
			subscriptions.map((subscription: MetoAiSubscription) => ({
				id: subscription.id,
				planTitle: subscription.planTitle,
				statusLabelKey: subscriptionStatusLabelKey(subscription.status),
				used: formatQuota(subscription.amountUsed, currency),
				total: formatQuota(subscription.amountTotal, currency),
				expiresAt: new Date(subscription.endTime * 1000).toLocaleDateString(),
				nextResetAt:
					subscription.nextResetTime === null
						? null
						: new Date(subscription.nextResetTime * 1000).toLocaleDateString(),
				autoRenew: subscription.autoRenew,
			})),
		[subscriptions, currency],
	);

	return useMemo(() => ({ loading, error, rows, actions: { reload } }), [loading, error, rows, reload]);
}

export { isSessionTerminal };
