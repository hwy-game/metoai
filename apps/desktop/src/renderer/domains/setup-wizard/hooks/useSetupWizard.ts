import { markMetoAiGateSkipped } from "@shared/lib/metoai-gate-storage";
import { authTokenAtom, metoaiSessionAtom } from "@shared/store/atoms";
import { localModelsConfigAtom } from "@shared/store/model-catalog";
import { useAtomValue } from "jotai";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { METOAI_PRESET_ID } from "@/shared/metoai";
import { getSetupWizardSteps, type SetupWizardStepId } from "../steps";
import { isSetupWizardCompleted, markSetupWizardCompleted, SETUP_WIZARD_OPEN_EVENT } from "../storage";

export interface SetupWizardModel {
	readonly actions: {
		back: () => void;
		complete: () => void;
		next: () => void;
		/**
		 * 只有向导仍停在 `step` 时才前进。步骤内容可能在退出动画期间迟到地报告完成
		 * （例如登录步的 Key 刚落盘），那时用户已经离开这一步，不该再被推着走。
		 */
		nextIfCurrent: (step: SetupWizardStepId) => void;
		skip: () => void;
	};
	readonly currentStep: SetupWizardStepId;
	readonly isFirst: boolean;
	readonly isLast: boolean;
	readonly labels: {
		readonly back: string;
		readonly getStarted: string;
		readonly next: string;
		readonly progress: string;
		readonly skip: string;
	};
	readonly open: boolean;
	readonly stepIndex: number;
	readonly steps: readonly SetupWizardStepId[];
	readonly totalSteps: number;
}

function resolveSteps(isLoggedIn: boolean, isMetoAiReady: boolean): readonly SetupWizardStepId[] {
	return getSetupWizardSteps({ isLoggedIn, isMetoAiReady });
}

export function useSetupWizard(): SetupWizardModel {
	const { t } = useTranslation("common");
	const token = useAtomValue(authTokenAtom);
	const localModels = useAtomValue(localModelsConfigAtom);
	const session = useAtomValue(metoaiSessionAtom);
	/**
	 * 已接入（模型配置里已有 Key）或已有会话时都不再引导这一步：账号授权登录时 Key 由
	 * 主进程在后台补写，只看 Key 的话用户会先看到这一步再被自动跳过，白闪一下。
	 * 配置未加载且未登录时按未接入处理。
	 */
	const isMetoAiReady =
		Boolean(localModels?.providers[METOAI_PRESET_ID]?.apiKey?.trim()) || session.status === "authenticated";

	const [open, setOpen] = useState(() => !isSetupWizardCompleted());
	// Freeze step list for the current open session so mid-wizard login does not
	// shrink the indicator / scramble stepIndex; re-open recomputes from auth.
	const [steps, setSteps] = useState<readonly SetupWizardStepId[]>(() => resolveSteps(Boolean(token), isMetoAiReady));
	const [stepIndex, setStepIndex] = useState(0);

	const openWizard = useCallback(() => {
		setSteps(resolveSteps(Boolean(token), isMetoAiReady));
		setStepIndex(0);
		setOpen(true);
	}, [isMetoAiReady, token]);

	useEffect(() => {
		const onOpen = () => openWizard();
		window.addEventListener(SETUP_WIZARD_OPEN_EVENT, onOpen);
		return () => window.removeEventListener(SETUP_WIZARD_OPEN_EVENT, onOpen);
	}, [openWizard]);

	const finish = useCallback(() => {
		markSetupWizardCompleted();
		// 向导已经给过登录机会：结束向导就当作「跳过」，否则全屏引导屏会立刻盖回来。
		// 侧边栏和设置里的登录入口仍在，用户之后随时可以登录。
		if (steps.includes("metoai")) markMetoAiGateSkipped();
		setOpen(false);
	}, [steps]);

	const advanceFrom = useCallback(
		(expectedStep?: SetupWizardStepId) => {
			setStepIndex((index) => {
				// 迟到且已过期的完成回调：向导已经离开这一步，位置不再动。
				if (expectedStep !== undefined && steps[index] !== expectedStep) return index;
				if (index >= steps.length - 1) {
					finish();
					return index;
				}
				return index + 1;
			});
		},
		[finish, steps],
	);

	const next = useCallback(() => advanceFrom(), [advanceFrom]);

	const nextIfCurrent = useCallback((step: SetupWizardStepId) => advanceFrom(step), [advanceFrom]);

	const back = useCallback(() => {
		setStepIndex((index) => Math.max(0, index - 1));
	}, []);

	const currentStep = steps[stepIndex] ?? steps[0];
	const isFirst = stepIndex === 0;
	const isLast = stepIndex === steps.length - 1;

	const labels = useMemo(
		() => ({
			back: t("setupWizard.back"),
			getStarted: t("setupWizard.getStarted"),
			next: t("setupWizard.next"),
			progress: t("setupWizard.progress", { current: stepIndex + 1, total: steps.length }),
			skip: t("setupWizard.skip"),
		}),
		[stepIndex, steps.length, t],
	);

	return {
		actions: {
			back,
			complete: finish,
			next,
			nextIfCurrent,
			skip: finish,
		},
		currentStep,
		isFirst,
		isLast,
		labels,
		open,
		stepIndex,
		steps,
		totalSteps: steps.length,
	};
}
