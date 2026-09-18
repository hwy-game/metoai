import { CloudAuthBoot } from "@shared/components/cloud-slots";
import { MetoAiGate } from "./domains/metoai/MetoAiGate";
import { RootLayoutView } from "./root-layout/RootLayoutView";
import { useIdleRoutePrefetch } from "./root-layout/useIdleRoutePrefetch";
import { useRootLayoutModel } from "./root-layout/useRootLayoutModel";

export function RootLayout(): JSX.Element {
	const model = useRootLayoutModel();
	useIdleRoutePrefetch();
	return (
		<>
			{/* 云会话生命周期：全树只挂这一处；lite 构建渲染 null */}
			<CloudAuthBoot />
			{/* 首次使用引导：未配置 MetaToken key 时全屏覆盖 */}
			<MetoAiGate />
			<RootLayoutView model={model} />
		</>
	);
}
