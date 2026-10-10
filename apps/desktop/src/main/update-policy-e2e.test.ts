import { afterEach, describe, expect, it, vi } from "vitest";

import { readE2eUpdatePolicy } from "./update-policy-e2e.js";

const CURRENT_VERSION = "0.5.61";

/** 服务端「登记了一个更高版本」的 `data` 形状；各用例在其上做局部覆盖。 */
function policyData(overrides: Record<string, unknown> = {}): string {
	return JSON.stringify({
		has_update: true,
		forced: false,
		reason: "",
		check_interval_seconds: 3_600,
		latest: { version: "0.5.62" },
		...overrides,
	});
}

function e2eEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
	return { VETTA_E2E: "1", VETTA_E2E_UPDATE_POLICY: policyData(), ...overrides };
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe("readE2eUpdatePolicy", () => {
	it("按服务端登记值给出策略替身", () => {
		const policy = readE2eUpdatePolicy(e2eEnv(), CURRENT_VERSION);

		expect(policy).toMatchObject({ hasUpdate: true, forced: false, latestVersion: "0.5.62" });
	});

	it("没有 E2E 标记时忽略替身", () => {
		// 生产构建里启动环境不得改变更新判定：同一个进程即使带着这段 JSON 也不认。
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

		expect(readE2eUpdatePolicy(e2eEnv({ VETTA_E2E: undefined }), CURRENT_VERSION)).toBeNull();
		expect(readE2eUpdatePolicy(e2eEnv({ VETTA_E2E: "0" }), CURRENT_VERSION)).toBeNull();
		expect(warn).not.toHaveBeenCalled();
	});

	it("没有配置替身时返回 null，让调用方回落到真实请求", () => {
		expect(readE2eUpdatePolicy(e2eEnv({ VETTA_E2E_UPDATE_POLICY: undefined }), CURRENT_VERSION)).toBeNull();
		expect(readE2eUpdatePolicy(e2eEnv({ VETTA_E2E_UPDATE_POLICY: "   " }), CURRENT_VERSION)).toBeNull();
	});

	it("替身不是合法 JSON 时返回 null 并记 warn", () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

		expect(readE2eUpdatePolicy(e2eEnv({ VETTA_E2E_UPDATE_POLICY: "{not json" }), CURRENT_VERSION)).toBeNull();
		expect(warn).toHaveBeenCalledWith(expect.stringContaining("unparsable E2E policy override"));
	});

	it("替身形状不合法时返回 null 并记 warn", () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

		expect(readE2eUpdatePolicy(e2eEnv({ VETTA_E2E_UPDATE_POLICY: "{}" }), CURRENT_VERSION)).toBeNull();
		expect(warn).toHaveBeenCalledWith(expect.stringContaining("unusable E2E policy override"));
	});

	it("登记的版本不高于本机时收敛为「没有可交付的更新」", () => {
		const policy = readE2eUpdatePolicy(
			e2eEnv({ VETTA_E2E_UPDATE_POLICY: policyData({ latest: { version: CURRENT_VERSION } }) }),
			CURRENT_VERSION,
		);

		expect(policy?.hasUpdate).toBe(false);
		expect(policy?.latestVersion).toBeUndefined();
	});
});
