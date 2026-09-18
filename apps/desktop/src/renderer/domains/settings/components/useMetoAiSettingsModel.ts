/**
 * MetaToken 个人中心（连接层）：余额、Key、充值三段数据，加上登录 / 登出与「接入模型」。
 *
 * 三段数据各有独立的加载与错误状态，由 `domains/metoai/hooks/useMetoAiAccount` 里的三个
 * model 分别提供；这里只做组装、登录态判定，以及跨段的动作（删除前确认、复制 Key、
 * 把账号下的 Key 写进模型配置）。未登录时视图改用登录表单，所以登录动作也一并下发。
 */

import type { MetoAiSignInFormProps } from "@domains/metoai/components/MetoAiSignInForm";
import type { MetoAiKeyRow } from "@domains/metoai/hooks/useMetoAiAccount";
import { useMetoAiAccountModel, useMetoAiKeysModel, useMetoAiTopUpModel } from "@domains/metoai/hooks/useMetoAiAccount";
import { useMetoAiSessionModel } from "@domains/metoai/hooks/useMetoAiSession";
import { unwrapMetoAi } from "@shared/lib/metoai";
import { confirmDialogAtom, resolvedThemeAtom } from "@shared/store/atoms";
import { localModelsConfigAtom, modelCatalog } from "@shared/store/model-catalog";
import { showToast } from "@shared/store/toast-atoms";
import type { SettingSectionMeta } from "@vetta-org/theme-ui/settings";
import { useAtomValue, useSetAtom } from "jotai";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { METOAI_PRESET_ID, METOAI_SITE_URL } from "@/shared/metoai";
import type { MetoAiPaymentChannel, MetoAiTopUpRecord, MetoAiUser } from "@/shared/metoai-types";
import { SETTINGS_SECTION } from "../registry";
import type { MetoAiModelAccessState } from "./metoai/MetoAiAccountSection";
import type { MetoAiKeyDraft } from "./metoai/MetoAiKeysSection";

export interface MetoAiSettingsModel {
	authenticated: boolean;
	title: string;
	sections: {
		account: SettingSectionMeta;
		keys: SettingSectionMeta;
		topUp: SettingSectionMeta;
	};
	/** 未登录时展示的登录表单（view model 与动作）。 */
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
	topUp: {
		methods: MetoAiPaymentChannel[];
		amountOptions: number[];
		loading: boolean;
		error: string | null;
		quoting: boolean;
		paying: boolean;
		quote: number | null;
		redemptionEnabled: boolean;
		records: MetoAiTopUpRecord[];
		/** 展示币种符号；TOKENS 口径下为空串。 */
		symbol: string;
		onQuote: (amount: number, method: string) => void;
		onPay: (amount: number, method: string) => void;
		onRedeem: (code: string) => Promise<boolean>;
	};
}

export function useMetoAiSettingsModel(): MetoAiSettingsModel {
	const { t } = useTranslation("metoai");
	const { t: tSettings } = useTranslation("settings");
	const theme = useAtomValue(resolvedThemeAtom);
	const session = useMetoAiSessionModel(theme);
	const authenticated = session.authenticated;

	const account = useMetoAiAccountModel(authenticated);
	const keys = useMetoAiKeysModel(authenticated, account.currency);
	const topUp = useMetoAiTopUpModel(authenticated);

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

	const openSite = useCallback((): void => {
		void window.vetta.shell.openExternal(METOAI_SITE_URL);
	}, []);

	const signIn = useMemo<Omit<MetoAiSignInFormProps, "onOpenSite">>(
		() => ({
			busy: session.busy,
			error: session.error,
			twoFactor: session.twoFactor,
			turnstile: session.turnstile,
			turnstileRequired: session.turnstileRequired,
			registerEnabled: session.siteConfig?.register_enabled === true,
			onLogin: session.actions.login,
			onSubmitTwoFactor: session.actions.submitTwoFactor,
			onCancelTwoFactor: session.actions.cancelTwoFactor,
		}),
		[
			session.actions,
			session.busy,
			session.error,
			session.siteConfig,
			session.turnstile,
			session.turnstileRequired,
			session.twoFactor,
		],
	);

	// 分区标题在这里翻好再交给展示层：设置域的分区元数据只有 titleKey，
	// 而主题层的 SettingSection 不接受 i18next 的强类型 `t`。
	const sections = useMemo(
		() => ({
			account: { ...SETTINGS_SECTION["metoai-account"], title: tSettings("section_metoai-account") },
			keys: { ...SETTINGS_SECTION["metoai-keys"], title: tSettings("section_metoai-keys") },
			topUp: { ...SETTINGS_SECTION["metoai-topup"], title: tSettings("section_metoai-topup") },
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
			topUp: {
				methods: topUp.methods,
				amountOptions: topUp.amountOptions,
				loading: topUp.loading,
				error: topUp.error,
				quoting: topUp.quoting,
				paying: topUp.paying,
				quote: topUp.quote,
				redemptionEnabled: topUp.redemptionEnabled,
				records: topUp.records,
				symbol: account.currency.symbol,
				onQuote: (amount: number, method: string) => void topUp.actions.quote(amount, method),
				onPay: (amount: number, method: string) => void topUp.actions.pay(amount, method),
				onRedeem: topUp.actions.redeem,
			},
		}),
		[
			account.actions,
			account.balance,
			account.currency.symbol,
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
			removeKey,
			sections,
			session.actions,
			session.busy,
			signIn,
			t,
			topUp.actions,
			topUp.amountOptions,
			topUp.error,
			topUp.loading,
			topUp.methods,
			topUp.paying,
			topUp.quoting,
			topUp.quote,
			topUp.records,
			topUp.redemptionEnabled,
		],
	);
}
