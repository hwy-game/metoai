import { isMac } from "@shared/lib/platform";
import { isCloudBuildEnabled } from "@/shared/feature-flags";

export type SetupWizardStepId = "permissions" | "languageAppearance" | "metoai" | "login" | "welcome";

export interface GetSetupWizardStepsOptions {
	/** When true, omit the optional login step (already signed in). */
	readonly isLoggedIn?: boolean;
	/** When true, omit the MetoAi step (already connected: a key is configured or a session exists). */
	readonly isMetoAiReady?: boolean;
}

/**
 * macOS: language/appearance → metoai → permissions → login → welcome;
 * 其它平台跳过权限步。
 *
 * MetoAi 步紧跟「语言与外观」：登录页与官网授权页都按当前界面语言呈现，
 * 先选语言再看登录页，比反过来更合理。lite 构建没有云登录步，这一步就是主入口。
 */
export function getSetupWizardSteps(options?: GetSetupWizardStepsOptions): readonly SetupWizardStepId[] {
	const base: readonly SetupWizardStepId[] = isMac
		? ["languageAppearance", "metoai", "permissions", "login", "welcome"]
		: ["languageAppearance", "metoai", "login", "welcome"];
	// 已接入 MetoAi（有 Key 或已登录）就没什么可操作的，跳过这一步。
	const steps = options?.isMetoAiReady ? base.filter((step) => step !== "metoai") : base;
	// lite 构建（无云服务）不引导登录；已登录用户同样跳过。
	if (!isCloudBuildEnabled() || options?.isLoggedIn) {
		return steps.filter((step) => step !== "login");
	}
	return steps;
}
