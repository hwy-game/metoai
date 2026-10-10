// 引导窗是独立 i18next 实例，自己装配 settings ns 的资源。
// 只装配一部分语言时不会报错，只是其余语言静默回退，引导窗与主窗口语言不一致。

import { describe, expect, it } from "vitest";
import { SUPPORTED_LANGUAGES } from "@/shared/i18n/config";
import { onboardingResources } from "./i18n";

describe("onboarding catalog", () => {
	it("covers every supported language", () => {
		expect(Object.keys(onboardingResources).sort()).toEqual([...SUPPORTED_LANGUAGES].sort());
	});

	it.each([...SUPPORTED_LANGUAGES])("%s carries the settings namespace", (language) => {
		const bundle = onboardingResources[language] as Record<string, unknown> | undefined;
		expect(bundle?.settings).toBeTypeOf("object");
	});
});
