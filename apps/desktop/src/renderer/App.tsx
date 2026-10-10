import { CloudAuthBoot } from "@shared/components/cloud-slots";
import { MetoAiSessionProvider } from "@shared/hooks/useMetoAiSession";
import { RootLayoutView } from "./root-layout/RootLayoutView";
import { useRootLayoutModel } from "./root-layout/useRootLayoutModel";

export function RootLayout(): JSX.Element {
	const model = useRootLayoutModel();
	return (
		<MetoAiSessionProvider>
			<CloudAuthBoot />
			<RootLayoutView model={model} />
		</MetoAiSessionProvider>
	);
}
