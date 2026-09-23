import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { findWindowsSupplementalArtifacts } from "./windows-packaging-contract.mjs";
import {
	createExtractionRoot,
	decodeMsiLog,
	readExpectedWindowsVersion,
	resolveExtractionBaseCandidates,
	summarizeMsiLog,
	verifyExtractedWindowsLayout,
} from "./verify-windows-packages.mjs";

async function createLayout(root, version) {
	const versionDir = join(root, "versions", version);
	await mkdir(join(versionDir, "resources"), { recursive: true });
	await Promise.all([
		writeFile(join(root, "Metoai.exe"), "launcher"),
		writeFile(join(root, "current.json"), `${JSON.stringify({ version })}\n`),
		writeFile(join(versionDir, "Metoai.exe"), "application"),
		writeFile(join(versionDir, "resources", "app.asar"), "archive"),
	]);
}

test("Windows supplemental artifacts are located by extension and version", () => {
	assert.deepEqual(
		findWindowsSupplementalArtifacts(
			["Metoai-1.2.3-win-x64.msi", "Metoai-1.2.3-win-x64.zip", "Metoai-1.2.2-win-x64.msi", "latest.yml"],
			"1.2.3",
		),
		["Metoai-1.2.3-win-x64.msi", "Metoai-1.2.3-win-x64.zip"],
	);
});

test("Windows package inspection accepts the versioned launcher layout at any extraction depth", async () => {
	const root = await mkdtemp(join(tmpdir(), "vetta-windows-package-layout-"));
	try {
		const layoutRoot = join(root, "Program Files", "Metoai");
		await createLayout(layoutRoot, "1.2.3");
		assert.equal(await verifyExtractedWindowsLayout(root, "1.2.3"), layoutRoot);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("Windows package inspection rejects an incomplete or wrong-version layout", async () => {
	const root = await mkdtemp(join(tmpdir(), "vetta-windows-package-layout-"));
	try {
		await createLayout(root, "1.2.2");
		await assert.rejects(
			() => verifyExtractedWindowsLayout(root, "1.2.3"),
			/expected one complete 1\.2\.3 layout/,
		);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("Windows package verification uses the Inno update manifest version", async () => {
	const releaseDir = await mkdtemp(join(tmpdir(), "vetta-windows-packages-"));
	try {
		await writeFile(join(releaseDir, "latest.yml"), "version: 9.8.7\n");
		assert.equal(await readExpectedWindowsVersion(releaseDir), "9.8.7");
	} finally {
		await rm(releaseDir, { recursive: true, force: true });
	}
});

test("Windows MSI extraction prefers short drive-root directories", () => {
	assert.deepEqual(
		resolveExtractionBaseCandidates({
			releaseDir: "D:\\a\\metoai\\metoai\\apps\\desktop\\release",
			tempDir: "C:\\Users\\RUNNER~1\\AppData\\Local\\Temp",
		}),
		["D:\\vmsi-", "C:\\vmsi-", "C:\\Users\\RUNNER~1\\AppData\\Local\\Temp\\vmsi-"],
	);
});

test("Windows MSI extraction keeps room for the longest payload paths under MAX_PATH", () => {
	const [base] = resolveExtractionBaseCandidates({ releaseDir: "C:\\a\\release", tempDir: "C:\\Temp" });
	// resources/system-plugins/<plugin>/dist/assets/<hashed asset name> reaches ~190 characters.
	const longestPayloadPath = `${base}abc123\\m\\${"x".repeat(190)}`;
	assert.ok(longestPayloadPath.length < 260, `${longestPayloadPath.length} characters would break msiexec`);
});

test("Windows MSI extraction falls back when a drive root is not writable", async () => {
	const attempts = [];
	const root = await createExtractionRoot({
		releaseDir: "D:\\a\\release",
		tempDir: "C:\\Temp",
		createDirectory: async (base) => {
			attempts.push(base);
			if (base.startsWith("D:")) throw Object.assign(new Error("denied"), { code: "EACCES" });
			return `${base}abc123`;
		},
	});
	assert.equal(root, "C:\\vmsi-abc123");
	assert.deepEqual(attempts, ["D:\\vmsi-", "C:\\vmsi-"]);
});

test("Windows MSI extraction reports every base it could not use", async () => {
	await assert.rejects(
		() =>
			createExtractionRoot({
				releaseDir: "D:\\a\\release",
				tempDir: "C:\\Temp",
				createDirectory: async () => {
					throw Object.assign(new Error("denied"), { code: "EPERM" });
				},
			}),
		/could not create an extraction directory; tried D:\\vmsi- \(EPERM\), C:\\vmsi- \(EPERM\), C:\\Temp\\vmsi- \(EPERM\)/,
	);
});

test("Windows MSI log diagnostics surface why msiexec aborted", () => {
	const summary = summarizeMsiLog(
		[
			"MSI (s) (20:A0) [16:28:31:810]: Note: 1: 2262 2: DigitalSignature 3: -2147287038",
			"MSI (s) (20:A0) [16:28:34:713]: Product: Metoai -- Error 1304. Error writing to file: C:\\vmsi1\\m\\vetta\\versions\\0.5.58\\resources\\system-plugins\\vetta-ui-design\\dist\\assets\\_virtual_mf.js.  Verify that you have access to that directory.",
			"Action ended 16:28:34: InstallFinalize. Return value 3.",
			"MSI (s) (20:A0) [16:28:34:912]: Windows Installer 已安装产品。产品名称: Metoai。安装成功或错误状态: 1603。",
			"MSI (s) (20:A0) [16:28:34:929]: MainEngineThread is returning 1603",
		].join("\r\n"),
	);
	assert.equal(summary.length, 3);
	assert.match(summary[0], /Error 1304/);
	assert.match(summary[1], /Return value 3/);
	assert.match(summary[2], /returning 1603/);
});

test("Windows MSI log decoding handles the UTF-16LE log msiexec writes", () => {
	const text = "MSI (s) (20:A0) [16:28:34:713]: Error 1304. Error writing to file: C:\\vmsi1\\m\\vetta\\Metoai.exe\r\n";
	const bytes = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, "utf16le")]);
	assert.equal(decodeMsiLog(bytes), text);
	assert.equal(summarizeMsiLog(decodeMsiLog(bytes)).length, 1);
});
