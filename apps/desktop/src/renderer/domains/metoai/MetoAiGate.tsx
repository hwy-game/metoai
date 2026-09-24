/**
 * 首次接入 MetoAI 的引导屏（连接层）。
 *
 * 何时出现：模型配置已加载、MetoAI 未接入、用户没点过跳过、且当前未登录。
 * 登录成功后会立刻隐藏——主进程在后台签发/复用 Key 并写进 `models.json`，
 * 不需要等它写完（接入失败时可在设置 → MetoAI 里重试）。
 * 退出登录会清掉本地 Key 与「跳过」标记，因此下次启动会重新出现。
 *
 * 挂载位置见 `root-layout/RootGlobalOverlays.tsx`：它必须排在首启向导之前，
 * 否则会盖住「语言与外观」——用户会先看到登录页而不是先选语言。
 */

import { useCallback, useEffect, useState } from "react";
import { MetoAiGateView } from "./MetoAiGateView";
import { isMetoAiGateSkipped, markMetoAiGateSkipped, METOAI_GATE_SKIPPED_EVENT } from "./gate-storage";
import { useMetoAiSignInModel } from "./hooks/useMetoAiSignInModel";

export function MetoAiGate(): JSX.Element | null {
	const model = useMetoAiSignInModel();
	const [skipped, setSkipped] = useState(() => isMetoAiGateSkipped());

	// 首启向导也会写这个标记（走完向导 = 已经给过登录机会）。本屏此时已经挂载着，
	// 只在初始化时读一次的话，向导一关它就会立刻补弹一次，所以必须跟着标记走。
	useEffect(() => {
		const sync = () => setSkipped(isMetoAiGateSkipped());
		window.addEventListener(METOAI_GATE_SKIPPED_EVENT, sync);
		return () => window.removeEventListener(METOAI_GATE_SKIPPED_EVENT, sync);
	}, []);

	const skip = useCallback(() => {
		markMetoAiGateSkipped();
		setSkipped(true);
	}, []);

	// configured 为 null 表示模型配置尚未加载：此时不闪屏，等主进程返回。
	if (model.configured !== false || skipped || model.authenticated) return null;

	return <MetoAiGateView model={model} onSkip={skip} />;
}
