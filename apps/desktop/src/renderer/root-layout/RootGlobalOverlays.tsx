import { lazy, Suspense } from "react";
import { MetoAiGate } from "../domains/metoai/MetoAiGate";
import { ActionApprovalCenter } from "../shared/action-approval/ActionApprovalCenter";
import { SshPromptDialog } from "../shared/components/SshPromptDialog";
import { UpdateRequiredOverlay } from "../shared/components/UpdateRequiredOverlay";
import { useAtomValue } from "jotai";
import { initialRoutePaintedAtom } from "./initial-route-paint-state";

const RootOverlayViews = lazy(() =>
	import("./RootOverlayViews").then((module) => ({ default: module.RootOverlayViews })),
);

export function RootGlobalOverlays(): JSX.Element {
	const routePainted = useAtomValue(initialRoutePaintedAtom);
	return (
		<>
			{/* Keep receiving requests while the presenter chunk is loading. */}
			<ActionApprovalCenter />
			<SshPromptDialog />
			{/*
			 * MetoAI 首次接入引导：必须排在 SetupWizard 之前——两者都是 z-[100] 全屏层，
			 * DOM 靠后的向导才能盖住它，用户才会先看到「语言与外观」而不是登录页。
			 * 向导里的登录步结束后会写「跳过」标记，这里便不再弹出。
			 * 放在首屏 chunk，避免等 overlay 分包加载后才出现。
			 */}
			<MetoAiGate />
			{/* 强制更新：阻塞式覆盖层，服务端策略要求且更新源给出可下载版本时才渲染 */}
			<UpdateRequiredOverlay />
			{routePainted && (
				<Suspense fallback={null}>
					<RootOverlayViews />
				</Suspense>
			)}
		</>
	);
}
