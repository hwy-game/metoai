import { beforeEach, describe, expect, it, vi } from "vitest";

const flags = vi.hoisted(() => ({ cloud: true, mac: true }));

vi.mock("@/shared/feature-flags", () => ({
	isCloudBuildEnabled: () => flags.cloud,
}));

vi.mock("@shared/lib/platform", () => ({
	get isMac() {
		return flags.mac;
	},
}));

import { getSetupWizardSteps } from "./steps";

describe("getSetupWizardSteps", () => {
	beforeEach(() => {
		flags.cloud = true;
		flags.mac = true;
	});

	it("MetoAi 登录步紧跟「语言与外观」", () => {
		expect(getSetupWizardSteps()).toEqual(["languageAppearance", "metoai", "permissions", "login", "welcome"]);
	});

	it("已登录用户跳过登录步", () => {
		expect(getSetupWizardSteps({ isLoggedIn: true })).toEqual([
			"languageAppearance",
			"metoai",
			"permissions",
			"welcome",
		]);
	});

	it("lite 构建（无云服务）不引导云登录，但保留 MetoAi 步", () => {
		flags.cloud = false;
		expect(getSetupWizardSteps()).toEqual(["languageAppearance", "metoai", "permissions", "welcome"]);
	});

	it("已接入 MetoAi（有 Key 或已登录）时不再引导登录", () => {
		expect(getSetupWizardSteps({ isMetoAiReady: true })).toEqual([
			"languageAppearance",
			"permissions",
			"login",
			"welcome",
		]);
	});

	it("非 macOS 跳过权限步；lite 下同样不含云登录步", () => {
		flags.mac = false;
		expect(getSetupWizardSteps()).toEqual(["languageAppearance", "metoai", "login", "welcome"]);
		flags.cloud = false;
		expect(getSetupWizardSteps()).toEqual(["languageAppearance", "metoai", "welcome"]);
	});
});
