import { MetoAiSettingsView } from "./MetoAiSettingsView";
import { useMetoAiSettingsModel } from "./useMetoAiSettingsModel";

export function MetoAiSettings(): JSX.Element {
	return <MetoAiSettingsView model={useMetoAiSettingsModel()} />;
}
