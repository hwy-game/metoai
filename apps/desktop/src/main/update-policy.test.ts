import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import {
	clampCheckInterval,
	compareVersions,
	decideUpdatePolicy,
	fetchUpdatePolicy,
	isAllowedDownloadUrl,
} from "./update-policy.js";

const CURRENT_VERSION = "0.5.21";

/** 一个合法的 64 位十六进制校验值（`sha256("test")`）。 */
const SHA256 = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";

/** 服务端「无更新」响应的 `data` 形状；各用例在其上做局部覆盖。 */
function updateCheckData(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		has_update: false,
		forced: false,
		reason: "",
		check_interval_seconds: 3_600,
		latest: null,
		...overrides,
	};
}

function latestRelease(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		version: "0.6.0",
		channel: "stable",
		platform: "windows",
		arch: "x64",
		policy: "optional",
		min_supported_version: "0.5.0",
		release_note: "修复若干问题",
		download_url: "https://releases.openvetta.com/desktop/stable/Metoai-0.6.0.exe",
		file_name: "Metoai-0.6.0.exe",
		size_bytes: 1_024,
		sha256: SHA256,
		published_at: "2026-05-01T00:00:00Z",
		...overrides,
	};
}

/** 记录请求参数并用固定 body 回应，避免任何真实网络访问。 */
function stubFetch(payload: unknown, status = 200): unknown[][] {
	const calls: unknown[][] = [];
	const mock = vi.fn(async (...args: unknown[]) => {
		calls.push(args);
		return new Response(typeof payload === "string" ? payload : JSON.stringify(payload), { status });
	});
	vi.stubGlobal("fetch", mock);
	return calls;
}

describe("decideUpdatePolicy", () => {
	it("treats a null latest as no update while keeping the server interval", () => {
		expect(decideUpdatePolicy(updateCheckData(), CURRENT_VERSION)).toEqual({
			hasUpdate: false,
			forced: false,
			reason: "",
			checkIntervalSeconds: 3_600,
		});
	});

	it("clamps the interval even when there is nothing to install", () => {
		const policy = decideUpdatePolicy(updateCheckData({ check_interval_seconds: 5 }), CURRENT_VERSION);
		expect(policy?.checkIntervalSeconds).toBe(1_800);
	});

	it("maps an optional release from the nested latest object", () => {
		const policy = decideUpdatePolicy(
			updateCheckData({ has_update: true, latest: latestRelease() }),
			CURRENT_VERSION,
		);

		expect(policy).toEqual({
			hasUpdate: true,
			forced: false,
			reason: "",
			checkIntervalSeconds: 3_600,
			latestVersion: "0.6.0",
			releaseNote: "修复若干问题",
			downloadUrl: "https://releases.openvetta.com/desktop/stable/Metoai-0.6.0.exe",
			fileName: "Metoai-0.6.0.exe",
			sha256: SHA256,
			sizeBytes: 1_024,
			publishedAt: "2026-05-01T00:00:00Z",
		});
	});

	it("takes forced from the server conclusion instead of re-deriving it", () => {
		const policy = decideUpdatePolicy(
			updateCheckData({ has_update: true, forced: true, reason: "policy", latest: latestRelease() }),
			CURRENT_VERSION,
		);

		expect(policy).toMatchObject({ hasUpdate: true, forced: true, reason: "policy", latestVersion: "0.6.0" });
	});

	it("keeps the min_supported reason", () => {
		const policy = decideUpdatePolicy(
			updateCheckData({ has_update: true, forced: true, reason: "min_supported", latest: latestRelease() }),
			CURRENT_VERSION,
		);

		expect(policy).toMatchObject({ forced: true, reason: "min_supported" });
	});

	it("normalizes an unknown reason to an empty string", () => {
		const policy = decideUpdatePolicy(
			updateCheckData({ has_update: true, forced: true, reason: "urgent", latest: latestRelease() }),
			CURRENT_VERSION,
		);

		expect(policy).toMatchObject({ forced: true, reason: "" });
	});

	it("drops to no update when forced arrives without a release to install", () => {
		expect(
			decideUpdatePolicy(updateCheckData({ has_update: true, forced: true, reason: "policy" }), CURRENT_VERSION),
		).toEqual({ hasUpdate: false, forced: false, reason: "", checkIntervalSeconds: 3_600 });
	});

	it("normalizes a registered version that is not higher into no update", () => {
		for (const version of [CURRENT_VERSION, "0.5.20", "0.5.21-rc.1"]) {
			const policy = decideUpdatePolicy(
				updateCheckData({ has_update: true, forced: true, reason: "policy", latest: latestRelease({ version }) }),
				CURRENT_VERSION,
			);
			expect(policy, `version ${version}`).toEqual({
				hasUpdate: false,
				forced: false,
				reason: "",
				checkIntervalSeconds: 3_600,
			});
		}
	});

	it("drops a download url outside the release host whitelist", () => {
		const policy = decideUpdatePolicy(
			updateCheckData({
				has_update: true,
				latest: latestRelease({ download_url: "https://evil.example.com/x.exe" }),
			}),
			CURRENT_VERSION,
		);

		expect(policy?.downloadUrl).toBeUndefined();
	});

	it("normalizes the declared checksum and keeps the file name", () => {
		const policy = decideUpdatePolicy(
			updateCheckData({ has_update: true, latest: latestRelease({ sha256: `SHA256:${SHA256.toUpperCase()}` }) }),
			CURRENT_VERSION,
		);

		expect(policy).toMatchObject({ fileName: "Metoai-0.6.0.exe", sha256: SHA256 });
	});

	it("drops a malformed checksum instead of failing the whole policy", () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		try {
			const policy = decideUpdatePolicy(
				updateCheckData({ has_update: true, latest: latestRelease({ sha256: "abc123" }) }),
				CURRENT_VERSION,
			);

			expect(policy?.latestVersion).toBe("0.6.0");
			expect(policy?.sha256).toBeUndefined();
			expect(warn).toHaveBeenCalled();
		} finally {
			warn.mockRestore();
		}
	});

	it("keeps a release the server registered without any download metadata", () => {
		// 线上真实形状：后台登记了版本与策略，但没有产物。策略层照实返回，
		// 「装不上」由 updater-service 判定并收口成「无更新」（见 updater-service.test.ts）。
		const policy = decideUpdatePolicy(
			updateCheckData({
				has_update: true,
				forced: true,
				reason: "policy",
				latest: latestRelease({ download_url: "", file_name: "", size_bytes: 0, sha256: "" }),
			}),
			CURRENT_VERSION,
		);

		expect(policy).toMatchObject({
			hasUpdate: true,
			forced: true,
			latestVersion: "0.6.0",
			downloadUrl: undefined,
			fileName: undefined,
			sha256: undefined,
		});
	});

	it.each([
		["data is not an object", null],
		["data is a string", "nope"],
		["has_update is a string", updateCheckData({ has_update: "true" })],
		["forced is missing", { reason: "", check_interval_seconds: 3_600, latest: null, has_update: true }],
		["reason is a number", updateCheckData({ reason: 42 })],
		["check interval is a string", updateCheckData({ check_interval_seconds: "3600" })],
		["latest is a string", updateCheckData({ latest: "0.6.0" })],
		["latest has no version", updateCheckData({ has_update: true, latest: { release_note: "x" } })],
		["latest version is empty", updateCheckData({ has_update: true, latest: latestRelease({ version: "  " }) })],
	])("returns null when %s", (_label, data) => {
		expect(decideUpdatePolicy(data, CURRENT_VERSION)).toBeNull();
	});
});

describe("clampCheckInterval", () => {
	it.each([
		[0, 7_200],
		[-30, 7_200],
		[Number.NaN, 7_200],
		[Number.POSITIVE_INFINITY, 7_200],
		["3600", 7_200],
		[undefined, 7_200],
		[1, 1_800],
		[1_799, 1_800],
		[3_600, 3_600],
		[86_401, 86_400],
		[999_999, 86_400],
	])("clamps %s to %s", (input, expected) => {
		expect(clampCheckInterval(input)).toBe(expected);
	});
});

describe("isAllowedDownloadUrl", () => {
	it.each([
		["http://releases.openvetta.com/desktop/stable/x.exe", false],
		["ftp://releases.openvetta.com/x.exe", false],
		["https://evil.example.com/x.exe", false],
		["https://github.com.evil.example/x.exe", false],
		["https://raw.githubusercontent.com/x.exe", false],
		["https://releases.openvetta.com.evil.example/x.exe", false],
		["not a url", false],
		["", false],
		[undefined, false],
		["https://releases.openvetta.com/desktop/stable/Metoai-0.6.0.exe", true],
		["https://github.com/openvetta/metoai/releases/download/v0.6.0/Metoai-0.6.0.exe", true],
		["https://objects.githubusercontent.com/github-production-release-asset/x", true],
		["https://release-assets.githubusercontent.com/github-production-release-asset/x", true],
	])("treats %s as allowed=%s", (input, expected) => {
		expect(isAllowedDownloadUrl(input)).toBe(expected);
	});
});

describe("compareVersions", () => {
	it.each([
		["0.5.21", "0.5.21", 0],
		["0.6.0", "0.5.21", 1],
		["0.5.9", "0.5.10", -1],
		["v1.0.0", "1.0.0", 0],
		["1.0", "1.0.0", 0],
		["1.0.0+build.7", "1.0.0", 0],
		["1.0.0", "1.0.0-beta.1", 1],
		["1.0.0-beta.1", "1.0.0", -1],
		["1.0.0-beta.2", "1.0.0-beta.10", -1],
		["1.0.0-beta.1", "1.0.0-alpha.1", 1],
		["1.0.0-rc.1", "1.0.0-rc.1", 0],
	])("compares %s with %s as %s", (left, right, expected) => {
		expect(Math.sign(compareVersions(left, right))).toBe(expected);
	});
});

describe("fetchUpdatePolicy", () => {
	const input = { version: CURRENT_VERSION, platform: "windows", arch: "x64" };
	let vettaHome: string;

	beforeAll(() => {
		// 安装标识会落到 vetta home：测试里重定向到临时目录，绝不写用户真实配置目录。
		vettaHome = mkdtempSync(join(tmpdir(), "metoai-update-policy-"));
		vi.stubEnv("VETTA_HOME", vettaHome);
	});

	afterAll(() => {
		vi.unstubAllEnvs();
		rmSync(vettaHome, { recursive: true, force: true });
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("returns the parsed policy from a successful envelope", async () => {
		stubFetch({ code: 0, message: "", data: updateCheckData({ has_update: true, latest: latestRelease() }) });

		const policy = await fetchUpdatePolicy(input);

		expect(policy).toMatchObject({ hasUpdate: true, forced: false, latestVersion: "0.6.0" });
	});

	it("sends the version, platform, arch and install id as query parameters", async () => {
		const calls = stubFetch({ code: 0, message: "", data: updateCheckData() });

		await fetchUpdatePolicy({ ...input, channel: "stable" });

		const url = new URL(String(calls[0]?.[0]));
		expect(url.pathname).toBe("/api/desktop/update/check");
		expect(url.searchParams.get("version")).toBe(CURRENT_VERSION);
		expect(url.searchParams.get("platform")).toBe("windows");
		expect(url.searchParams.get("arch")).toBe("x64");
		expect(url.searchParams.get("channel")).toBe("stable");
		expect(url.searchParams.get("install_id")).toMatch(/^[0-9a-f-]{36}$/);
	});

	it("persists the install id under the vetta home directory", async () => {
		const calls = stubFetch({ code: 0, message: "", data: updateCheckData() });

		await fetchUpdatePolicy(input);
		await fetchUpdatePolicy(input);

		const firstId = new URL(String(calls[0]?.[0])).searchParams.get("install_id");
		const secondId = new URL(String(calls[1]?.[0])).searchParams.get("install_id");
		expect(secondId).toBe(firstId);
		expect(readFileSync(join(vettaHome, "metoai-install-id"), "utf8").trim()).toBe(firstId);
	});
	it("attaches a request signal that the caller can abort", async () => {
		const controller = new AbortController();
		let captured: AbortSignal | undefined;
		vi.stubGlobal(
			"fetch",
			vi.fn(async (_input: unknown, init?: RequestInit) => {
				captured = init?.signal ?? undefined;
				return new Response(JSON.stringify({ code: 0, data: updateCheckData() }), { status: 200 });
			}),
		);

		await fetchUpdatePolicy(input, controller.signal);

		expect(captured).toBeInstanceOf(AbortSignal);
		expect(captured?.aborted).toBe(false);
		controller.abort();
		expect(captured?.aborted).toBe(true);
	});

	it.each([
		["a non-zero code", { code: 1, message: "policy unavailable" }],
		["a payload that is not an object", 42],
		["a code that is not a number", { code: "0", data: updateCheckData() }],
	])("fails open on %s", async (_label, payload) => {
		stubFetch(payload);

		await expect(fetchUpdatePolicy(input)).resolves.toBeNull();
	});

	it("fails open when the response body is not JSON", async () => {
		stubFetch("<html>gateway error</html>");

		await expect(fetchUpdatePolicy(input)).resolves.toBeNull();
	});

	it("fails open when the request fails", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => {
				throw new TypeError("fetch failed");
			}),
		);

		await expect(fetchUpdatePolicy(input)).resolves.toBeNull();
	});

	it("fails open when the request times out", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => {
				throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
			}),
		);

		await expect(fetchUpdatePolicy(input)).resolves.toBeNull();
	});

	it("fails open when the caller aborts the request", async () => {
		const controller = new AbortController();
		controller.abort();
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => {
				throw new DOMException("This operation was aborted", "AbortError");
			}),
		);

		await expect(fetchUpdatePolicy(input, controller.signal)).resolves.toBeNull();
	});
});
