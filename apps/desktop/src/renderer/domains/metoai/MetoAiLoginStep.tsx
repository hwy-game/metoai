/**
 * 首启向导的 MetoAi 登录步（连接层）。
 *
 * 位置：紧跟「语言与外观」之后——登录页与官网授权页都按当前界面语言呈现，
 * 让用户先选语言再看登录页，比反过来更合理。
 *
 * 进入这一步后完成接入（或配置迟到地变成已接入）会自动进入下一步，不停留在一个
 * 无需操作的页面上；但用户按「上一步」退回来时不再自动前进，否则按钮等于失效。
 * 「跳过」由向导底部的操作承担，因此这里不提供。
 */

import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { MetoAiSignInPanel } from "./components/MetoAiSignInPanel";
import { useMetoAiSignInModel } from "./hooks/useMetoAiSignInModel";

export interface MetoAiLoginStepProps {
	/** 进入下一步（已接入 / 已登录时自动调用）。 */
	onSuccess: () => void;
}

export function MetoAiLoginStep({ onSuccess }: MetoAiLoginStepProps): JSX.Element {
	const { t } = useTranslation(["metoai", "common"]);
	const model = useMetoAiSignInModel();
	// 进入这一步时就已经接入 / 已登录，说明用户是按「上一步」退回来的：
	// 这时再自动前进等于让「上一步」失效，所以只处理「在本步里完成」和「配置迟到了」。
	const readyOnEntryRef = useRef(model.configured === true || model.authenticated);
	const advancedRef = useRef(false);

	useEffect(() => {
		if (advancedRef.current || readyOnEntryRef.current) return;
		if (model.configured !== true && !model.authenticated) return;
		advancedRef.current = true;
		onSuccess();
	}, [model.authenticated, model.configured, onSuccess]);

	return (
		<div className="mx-auto flex w-full max-w-[400px] flex-col gap-5">
			<MetoAiSignInPanel
				keyForm={model.keyForm}
				mode={model.mode}
				onOpenSite={model.openSite}
				onToggleMode={model.toggleMode}
				signIn={model.signIn}
				subtitle={t("common:setupWizard.metoai.subtitle")}
				title={t("common:setupWizard.metoai.title")}
			/>
			<p className="text-center text-[11px] text-muted-foreground/70">{t("common:setupWizard.metoai.optionalHint")}</p>
		</div>
	);
}
