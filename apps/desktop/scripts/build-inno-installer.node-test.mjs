import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { writeAppUpdateConfig, writeInnoVerificationManifest } from "./build-inno-installer.mjs";
import { resolveUpdatePublishConfig } from "./resolve-update-publish-config.mjs";

test("defaults the installer to English regardless of the Windows UI language or previous install", async () => {
	const installer = await readFile(join(import.meta.dirname, "../build/installer.iss"), "utf8");
	assert.match(installer, /^LanguageDetectionMethod=none$/m);
	assert.match(installer, /^UsePreviousLanguage=no$/m);
	const languagesSectionStart = installer.indexOf("[Languages]");
	const tasksSectionStart = installer.indexOf("[Tasks]", languagesSectionStart);
	assert.notEqual(languagesSectionStart, -1);
	assert.notEqual(tasksSectionStart, -1);
	const firstLanguage = installer
		.slice(languagesSectionStart, tasksSectionStart)
		.split(/\r?\n/)
		.map((line) => line.trim())
		.find((line) => line.startsWith("Name:"));

	assert.equal(firstLanguage, 'Name: "english"; MessagesFile: "compiler:Default.isl"');
});

test("writes updater config into the version directory installed by Inno", async () => {
	const sourceDir = await mkdtemp(join(tmpdir(), "vetta-inno-test-"));
	const version = "0.5.42";
	const resourcesDir = join(sourceDir, "versions", version, "resources");
	await mkdir(resourcesDir, { recursive: true });

	try {
		const publishConfig = resolveUpdatePublishConfig({
			VETTA_UPDATE_PROVIDER: "generic",
			VETTA_UPDATE_URL: "https://releases.openvetta.com/desktop/test",
		});
		assert.ok(publishConfig);
		await writeAppUpdateConfig(sourceDir, version, publishConfig);

		const config = await readFile(join(resourcesDir, "app-update.yml"), "utf8");
		assert.match(config, /provider: generic/);
		assert.match(config, /url: https:\/\/releases\.openvetta\.com\/desktop\/test/);
		assert.match(config, /useMultipleRangeRequest: true/);
		assert.match(config, /updaterCacheDirName: metoai-updater/);
	} finally {
		await rm(sourceDir, { recursive: true, force: true });
	}
});

test("writes a stable versioned file manifest for pre-publish verification", async () => {
	const sourceDir = await mkdtemp(join(tmpdir(), "vetta-inno-test-"));
	const manifestPath = join(sourceDir, "installer.files.json");
	const versionDir = join(sourceDir, "version");
	await mkdir(join(versionDir, "resources"), { recursive: true });
	await Promise.all([
		writeFile(join(versionDir, "MetoAI.exe"), "exe"),
		writeFile(join(versionDir, "resources", "app.asar"), "asar"),
	]);

	try {
		await writeInnoVerificationManifest(versionDir, manifestPath, "1.2.3");
		assert.deepEqual(JSON.parse(await readFile(manifestPath, "utf8")), {
			version: "1.2.3",
			files: [
				{ path: "MetoAI.exe", size: 3 },
				{ path: "resources/app.asar", size: 4 },
			],
		});
	} finally {
		await rm(sourceDir, { recursive: true, force: true });
	}
});
