/**
 * 首次接入 MetoAI 的全屏引导屏（展示层）。
 *
 * 只在「未接入 MetoAI 且用户没跳过」时覆盖主界面。登录面本身与首启向导的
 * 登录步共用 `MetoAiSignInPanel`，本层只负责全屏容器与「跳过」动作。
 */

import { useTranslation } from "react-i18next";
import { MetoAiSignInPanel } from "./components/MetoAiSignInPanel";
import type { MetoAiSignInModel } from "./hooks/useMetoAiSignInModel";

export interface MetoAiGateViewProps {
	model: MetoAiSignInModel;
	onSkip: () => void;
}

export function MetoAiGateView({ model, onSkip }: MetoAiGateViewProps): JSX.Element {
	const { t } = useTranslation("metoai");

	return (
		<div className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-background p-6 text-foreground">
			<div className="w-full max-w-[400px]">
				<MetoAiSignInPanel
					keyForm={model.keyForm}
					mode={model.mode}
					onOpenSite={model.openSite}
					onSkip={onSkip}
					onToggleMode={model.toggleMode}
					signIn={model.signIn}
					subtitle={t("gate.subtitle")}
					title={t("gate.title")}
				/>
			</div>
		</div>
	);
}
