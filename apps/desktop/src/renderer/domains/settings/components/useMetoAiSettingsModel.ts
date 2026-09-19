/**
 * MetaToken 个人中心（连接层）：余额、Key、订阅三段数据，加上授权登录 / 登出与「接入模型」。
 *
 * 三段数据各有独立的加载与错误状态，由 `domains/metoai/hooks/useMetoAiAccount` 里的三个
 * model 分别提供；这里只做组装、登录态判定，以及跨段的动作（删除前确认、复制 Key、
 * 把账号下的 Key 写进模型配置、打开官网办理充值/订阅）。
 * 未登录时视图改用授权登录卡片，所以登录动作也一并下发。
 *
 * 客户端不再收款：充值、订阅、兑换码、账户资料、用量明细都只是打开官网对应页面。
 */

import type { MetoAiSignInFormProps } from "@domains/metoai/components/MetoAiSignInForm";
import type { MetoAiKeyRow, MetoAiSubscriptionRow } from "@domains/metoai/hooks/useMetoAiAccount";
import {
	useMetoAiAccountModel,
	useMetoAiKeysModel,
	useMetoAiSubscriptionModel,
} from "@domains/metoai/hooks/useMetoAiAccount";
import { useMetoAiSessionModel } from "@domains/metoai/hooks/useMetoAiSession";
import { unwrapMetoAi } from "@shared/lib/metoai";
import { confirmDialogAtom } from "@shared/store/atoms";
import { localModelsConfigAtom, modelCatalog } from "@shared/store/model-catalog";
import { showToast } from "@shared/store/toast-atoms";
import type { SettingSectionMeta } from "@vetta-org/theme-ui/settings";
import { useAtomValue, useSetAtom } from "jotai";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { METOAI_PRESET_ID, METOAI_SITE_URL } from "@/shared/metoai";
import type { MetoAiUser } from "@/shared/metoai-types";
import { SETTINGS_SECTION } from "../registry";
import type { MetoAiModelAccessState } from "./metoai/MetoAiAccountSection";
import type { MetoAiKeyDraft } from "./metoai/MetoAiKeysSection";

export interface MetoAiSettingsModel {
	authenticated: boolean;
	title: string;
	sections: {
		account: SettingSectionMeta;
		keys: SettingSectionMeta;
		subscription: SettingSectionMeta;
		webActions: SettingSectionMeta;
	};
	/** 未登录时展示的授权登录卡片（view model 与动作）。 */
	signIn: Omit<MetoAiSignInFormProps, "onOpenSite">;
	onOpenSite: () => void;
	account: {
		user: MetoAiUser | null;
		/** 已按站点币种规则格式化。 */
		balance: string;
		used: string;
		requests: number;
		loading: boolean;
		error: string | null;
		onRefresh: () => void;
		signingOut: boolean;
		onSignOut: () => void;
		modelAccess: MetoAiModelAccessState;
	};
	keys: {
		rows: MetoAiKeyRow[];
		loading: boolean;
		error: string | null;
		busy: boolean;
		onCreate: (draft: MetoAiKeyDraft) => Promise<boolean>;
		onDelete: (id: number) => void;
		onToggleStatus: (id: number, enabled: boolean) => void;
		onReveal: (id: number) => Promise<string | null>;
		onCopy: (text: string) => void;
	};
	subscription: {
		rows: MetoAiSubscriptionRow[];
		loading: boolean;
		error: string | null;
		/** 去官网管理订阅（购买、续费、取消都在那边）。 */
		onManage: () => void;
	};
	webActions: {
		onTopUp: () => void;
		onSubscription: () => void;
		onRedeem: () => void;
		onProfile: () => void;
		onUsage: () => void;
	};
}

export function useMetoAiSettingsModel(): MetoAiSettingsModel {
	const { t } = useTranslation("metoai");
	const { t: tSettings } = useTranslation("settings");
	const session = useMetoAiSessionModel();
	const authenticated = session.authenticated;

	const account = useMetoAiAccountModel(authenticated);
	const keys = useMetoAiKeysModel(authenticated, account.currency);
	const subscription = useMetoAiSubscriptionModel(authenticated, account.currency);

	const setConfirm = useSetAtom(confirmDialogAtom);
	const config = useAtomValue(localModelsConfigAtom);

	const [modelBusy, setModelBusy] = useState(false);
	const [modelMessage, setModelMessage] = useState<string | null>(null);
	const modelConnected = Boolean(config?.providers[METOAI_PRESET_ID]?.apiKey?.trim());

	// 登出后丢掉上一条接入结果：否则换个账号进来还挂着上一个账号的提示。
	useEffect(() => {
		if (!authenticated) setModelMessage(null);
	}, [authenticated]);

	const connectModels = useCallback(async (): Promise<void> => {
		setModelBusy(true);
		setModelMessage(null);
		try {
			const result = unwrapMetoAi(await window.vetta.metoai.ensureModels());
			if (!result.ok) {
				setModelMessage(t("account.modelAccessFailed"));
				return;
			}
			await modelCatalog.revalidate({ force: true, sources: ["local"] });
			setModelMessage(t(result.created ? "account.modelAccessCreated" : "account.modelAccessReused"));
		} catch {
			setModelMessage(t("account.modelAccessFailed"));
		} finally {
			setModelBusy(false);
		}
	}, [t]);

	const removeKey = useCallback(
		(id: number): void => {
			setConfirm({
				title: t("keys.deleteConfirmTitle"),
				message: t("keys.deleteConfirmBody"),
				confirmLabel: t("keys.delete"),
				variant: "danger",
				onConfirm: () => void keys.actions.remove(id),
			});
		},
		[keys.actions, setConfirm, t],
	);

	const copyKey = useCallback(
		async (text: string): Promise<void> => {
			try {
				await navigator.clipboard.writeText(text);
				showToast({ variant: "success", message: t("keys.copied") });
			} catch {
				showToast({ variant: "error", message: t("keys.copyFailed") });
			}
		},
		[t],
	);

	/** 站点网页里的页面路径；客户端只负责打开，不在应用内复刻这些流程。 */
	const openSitePage = useCallback((path: string): void => {
		void window.vetta.shell.openExternal(`${METOAI_SITE_URL}${path}`);
	}, []);

	const openSite = useCallback((): void => openSitePage(""), [openSitePage]);

	const signIn = useMemo<Omit<MetoAiSignInFormProps, "onOpenSite">>(
		() => ({
			phase: session.phase,
			error: session.error,
			onAuthorize: () => void session.actions.startAuthorize(),
			onReopen: () => void session.actions.reopenAuthorize(),
			onCancel: session.actions.cancelAuthorize,
		}),
		[session.actions, session.error, session.phase],
	);

	// 分区标题在这里翻好再交给展示层：设置域的分区元数据只有 titleKey，
	// 而主题层的 SettingSection 不接受 i18next 的强类型 `t`。
	const sections = useMemo(
		() => ({
			account: { ...SETTINGS_SECTION["metoai-account"], title: tSettings("section_metoai-account") },
			keys: { ...SETTINGS_SECTION["metoai-keys"], title: tSettings("section_metoai-keys") },
			subscription: { ...SETTINGS_SECTION["metoai-subscription"], title: tSettings("section_metoai-subscription") },
			webActions: { ...SETTINGS_SECTION["metoai-web-actions"], title: tSettings("section_metoai-web-actions") },
		}),
		[tSettings],
	);

	return useMemo(
		() => ({
			authenticated,
			title: t("title"),
			sections,
			signIn,
			onOpenSite: openSite,
			account: {
				user: account.user,
				balance: account.balance,
				used: account.used,
				requests: account.requests,
				loading: account.loading,
				error: account.error,
				onRefresh: () => void account.actions.reload(),
				signingOut: session.busy,
				onSignOut: () => void session.actions.logout(),
				modelAccess: {
					connected: modelConnected,
					busy: modelBusy,
					message: modelMessage,
					onConnect: () => void connectModels(),
				},
			},
			keys: {
				rows: keys.rows,
				loading: keys.loading,
				error: keys.error,
				busy: keys.busy,
				onCreate: keys.actions.create,
				onDelete: removeKey,
				onToggleStatus: (id: number, enabled: boolean) => void keys.actions.toggleStatus(id, enabled),
				onReveal: keys.actions.reveal,
				onCopy: (text: string) => void copyKey(text),
			},
			subscription: {
				rows: subscription.rows,
				loading: subscription.loading,
				error: subscription.error,
				onManage: () => openSitePage("/subscriptions"),
			},
			webActions: {
				onTopUp: () => openSitePage("/wallet"),
				onSubscription: () => openSitePage("/subscriptions"),
				onRedeem: () => openSitePage("/redemption-codes"),
				onProfile: () => openSitePage("/profile"),
				onUsage: () => openSitePage("/account-usage"),
			},
		}),
		[
			account.actions,
			account.balance,
			account.error,
			account.loading,
			account.requests,
			account.user,
			account.used,
			authenticated,
			connectModels,
			copyKey,
			keys.actions,
			keys.busy,
			keys.error,
			keys.loading,
			keys.rows,
			modelBusy,
			modelConnected,
			modelMessage,
			openSite,
			openSitePage,
			removeKey,
			sections,
			session.actions,
			session.busy,
			signIn,
			subscription.error,
			subscription.loading,
			subscription.rows,
			t,
		],
	);
}
