/**
 * MetoAI 接入模型：账号授权登录与 API Key 直填两条路的状态与动作。
 *
 * 全屏引导屏（MetoAiGate）与首启向导的登录步（MetoAiLoginStep）共用这里，
 * 「拉取 /models → 校验 → 落盘 → 刷新目录」这条链路只有一份实现。
 *
 * `configured` 为 null 表示模型配置尚未从主进程返回：调用方据此决定是「不闪屏
 * 地等」还是「立刻收起登录面」，不能把未知当成未接入。
 */

import type { ModelsConfigData } from "@preload/api.js";
import { localModelsConfigAtom, modelCatalog } from "@shared/store/model-catalog";
import { showToast } from "@shared/store/toast-atoms";
import { useAtomValue } from "jotai";
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { METOAI_BASE_URL, METOAI_DISPLAY_NAME, METOAI_ICON, METOAI_PRESET_ID, METOAI_SITE_URL } from "@/shared/metoai";
import { isInvalidKey } from "../../settings/components/translatePresetError";
import type { MetoAiSignInFormProps } from "../components/MetoAiSignInForm";
import type { MetoAiKeyFormState } from "../components/MetoAiSignInPanel";
import { useMetoAiSessionModel } from "./useMetoAiSession";

export interface MetoAiSignInModel {
	/** null = 模型配置尚未加载；false = 未接入；true = 已接入（登录面可以收起）。 */
	configured: boolean | null;
	/** 已有 MetoAI 会话：登录面同样可以收起，不必等 Key 落盘。 */
	authenticated: boolean;
	mode: "account" | "key";
	toggleMode: () => void;
	signIn: Omit<MetoAiSignInFormProps, "onOpenSite">;
	keyForm: MetoAiKeyFormState;
	/** 打开站点官网（注册 / 取 Key 都用它）。 */
	openSite: () => void;
}

export function useMetoAiSignInModel(): MetoAiSignInModel {
	const { t } = useTranslation("metoai");
	const config = useAtomValue(localModelsConfigAtom);
	const session = useMetoAiSessionModel();

	const [mode, setMode] = useState<"account" | "key">("account");
	const [key, setKey] = useState("");
	const [savingKey, setSavingKey] = useState(false);
	const [keyError, setKeyError] = useState<string | null>(null);

	const configured = useMemo(() => {
		if (!config) return null;
		return Boolean(config.providers[METOAI_PRESET_ID]?.apiKey?.trim());
	}, [config]);

	const openSite = useCallback(() => {
		void window.vetta.shell.openExternal(METOAI_SITE_URL);
	}, []);

	const toggleMode = useCallback(() => {
		// 切换进入方式后清掉上一条 Key 报错，避免残留提示误导用户。
		setKeyError(null);
		setMode((current) => (current === "account" ? "key" : "account"));
	}, []);

	const saveKey = useCallback(async () => {
		const trimmed = key.trim();
		if (!trimmed || savingKey || !config) return;
		setSavingKey(true);
		setKeyError(null);
		try {
			const fetched = await window.vetta.models.refreshPresetModels(METOAI_PRESET_ID, trimmed);
			if (fetched.error || fetched.models.length === 0) {
				const presetError = fetched.error ?? { code: "empty-models" as const };
				if (isInvalidKey(presetError)) setKeyError(t("gate.errorInvalidKey"));
				else if (fetched.models.length === 0) setKeyError(t("gate.errorEmptyModels"));
				else setKeyError(t("gate.errorNetwork"));
				return;
			}

			const nextConfig: ModelsConfigData = {
				...config,
				providers: {
					...config.providers,
					[METOAI_PRESET_ID]: {
						source: "template",
						templateId: METOAI_PRESET_ID,
						displayName: METOAI_DISPLAY_NAME,
						icon: METOAI_ICON,
						api: "openai-responses",
						baseUrl: METOAI_BASE_URL,
						apiKey: trimmed,
						models: fetched.models,
						modelsSyncedAt: new Date().toISOString(),
					},
				},
			};
			await window.vetta.models.set(nextConfig);
			await modelCatalog.revalidate({ force: true, sources: ["local"] });
			showToast({ variant: "success", message: t("gate.success") });
			setKey("");
			// 落盘后 config 刷新为 apiKey="***"，configured 变 true，登录面自动收起。
		} catch {
			setKeyError(t("gate.errorUnknown"));
		} finally {
			setSavingKey(false);
		}
	}, [config, key, savingKey, t]);

	const keyForm = useMemo<MetoAiKeyFormState>(
		() => ({
			value: key,
			saving: savingKey,
			error: keyError,
			onChange: setKey,
			onSubmit: () => void saveKey(),
		}),
		[key, keyError, saveKey, savingKey],
	);

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

	return {
		authenticated: session.authenticated,
		configured,
		keyForm,
		mode,
		openSite,
		signIn,
		toggleMode,
	};
}
