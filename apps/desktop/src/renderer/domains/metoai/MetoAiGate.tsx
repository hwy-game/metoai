/**
 * 首次使用引导屏（连接层）。
 *
 * 何时出现：模型配置已加载、MetaToken 未接入、用户没点过跳过、且当前未登录。
 * 登录成功后会立刻隐藏——主进程在后台签发/复用 Key 并写进 `models.json`，
 * 不需要等它写完（接入失败时可在设置 → MetaToken 里重试）。
 *
 * 两条进入路径共用这里的状态：账号登录走 `useMetoAiSessionModel`，手动填 Key 走
 * 与设置页相同的「拉取 /models → 校验 → 落盘 → 刷新目录」链路。
 */

import type { ModelsConfigData } from "@preload/api.js";
import { localModelsConfigAtom, modelCatalog } from "@shared/store/model-catalog";
import { showToast } from "@shared/store/toast-atoms";
import { resolvedThemeAtom } from "@shared/store/atoms";
import { METOAI_BASE_URL, METOAI_DISPLAY_NAME, METOAI_ICON, METOAI_PRESET_ID, METOAI_SITE_URL } from "@/shared/metoai";
import { useAtomValue } from "jotai";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { isInvalidKey } from "../settings/components/translatePresetError";
import { useMetoAiSessionModel } from "./hooks/useMetoAiSession";
import { isMetoAiGateSkipped, markMetoAiGateSkipped } from "./gate-storage";
import { MetoAiGateView, type MetoAiKeyFormState } from "./MetoAiGateView";

export function MetoAiGate(): JSX.Element | null {
	const { t } = useTranslation("metoai");
	const config = useAtomValue(localModelsConfigAtom);
	const theme = useAtomValue(resolvedThemeAtom);
	const session = useMetoAiSessionModel(theme);

	const [skipped, setSkipped] = useState(() => isMetoAiGateSkipped());
	const [mode, setMode] = useState<"account" | "key">("account");
	const [key, setKey] = useState("");
	const [savingKey, setSavingKey] = useState(false);
	const [keyError, setKeyError] = useState<string | null>(null);

	/** null 表示模型配置尚未加载：此时不闪屏，等主进程返回。 */
	const configured = useMemo(() => {
		if (!config) return null;
		return Boolean(config.providers[METOAI_PRESET_ID]?.apiKey?.trim());
	}, [config]);

	const openSite = useCallback(() => {
		void window.vetta.shell.openExternal(METOAI_SITE_URL);
	}, []);

	const skip = useCallback(() => {
		markMetoAiGateSkipped();
		setSkipped(true);
	}, []);

	// 登录态变化后清掉上一条 Key 报错，避免残留提示误导用户。
	useEffect(() => {
		setKeyError(null);
	}, [mode]);

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
						api: "openai-completions",
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
			// 落盘后 config 刷新为 apiKey="***"，configured 变 true，本组件自动卸载。
		} catch {
			setKeyError(t("gate.errorUnknown"));
		} finally {
			setSavingKey(false);
		}
	}, [config, key, savingKey, t]);

	const keyForm: MetoAiKeyFormState = useMemo(
		() => ({
			value: key,
			saving: savingKey,
			error: keyError,
			onChange: setKey,
			onSubmit: () => void saveKey(),
		}),
		[key, keyError, saveKey, savingKey],
	);

	if (configured !== false || skipped || session.authenticated) return null;

	return (
		<MetoAiGateView
			keyForm={keyForm}
			mode={mode}
			onOpenSite={openSite}
			onSkip={skip}
			onToggleMode={() => setMode((current) => (current === "account" ? "key" : "account"))}
			signIn={{
				busy: session.busy,
				error: session.error,
				twoFactor: session.twoFactor,
				turnstile: session.turnstile,
				turnstileRequired: session.turnstileRequired,
				registerEnabled: session.siteConfig?.register_enabled === true,
				onLogin: session.actions.login,
				onSubmitTwoFactor: session.actions.submitTwoFactor,
				onCancelTwoFactor: session.actions.cancelTwoFactor,
			}}
		/>
	);
}
