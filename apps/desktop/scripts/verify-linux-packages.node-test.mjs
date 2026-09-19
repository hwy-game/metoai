import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { resolveLinuxPayloadPaths } from "./linux-packaging-contract.mjs";
import {
	parseDebContents,
	parseDebFields,
	parseRpmFields,
	readExpectedVersion,
	readLinuxPayloadPaths,
	verifyLinuxPackageInspection,
} from "./verify-linux-packages.mjs";

// 与 fork 的构建配置一致：productName 决定安装目录，executableName 决定可执行文件名。
const payloadPaths = resolveLinuxPayloadPaths({ productName: "Metoai", executableName: "Vetta" });
const paths = [
	...payloadPaths,
	"/usr/share/applications/Vetta.desktop",
	"/usr/share/icons/hicolor/512x512/apps/Vetta.png",
];

test("Linux package inspection accepts matching Debian and RPM packages", () => {
	assert.doesNotThrow(() =>
		verifyLinuxPackageInspection({
			expectedVersion: "1.2.3",
			requiredPayloadPaths: payloadPaths,
			deb: { name: "vetta", version: "1.2.3", arch: "amd64", paths },
			rpm: { name: "vetta", version: "1.2.3", arch: "x86_64", paths },
		}),
	);
});

test("Linux package inspection rejects wrong identities and incomplete payloads", () => {
	assert.throws(
		() =>
			verifyLinuxPackageInspection({
				expectedVersion: "1.2.3",
				requiredPayloadPaths: payloadPaths,
				deb: { name: "vetta", version: "1.2.2", arch: "amd64", paths },
				rpm: { name: "vetta", version: "1.2.3", arch: "x86_64", paths },
			}),
		/Debian version 1\.2\.2 does not match 1\.2\.3/,
	);
	assert.throws(
		() =>
			verifyLinuxPackageInspection({
				expectedVersion: "1.2.3",
				requiredPayloadPaths: payloadPaths,
				deb: { name: "vetta", version: "1.2.3", arch: "amd64", paths },
				rpm: { name: "vetta", version: "1.2.3", arch: "x86_64", paths: paths.slice(1) },
			}),
		/RPM package is missing \/opt\/Metoai\/Vetta/,
	);
});

test("package command output parsers normalize Debian and RPM metadata", () => {
	assert.deepEqual(
		parseDebFields("Package: vetta\nVersion: 1.2.3\nArchitecture: amd64\nDescription: Vetta\n"),
		{ name: "vetta", version: "1.2.3", arch: "amd64" },
	);
	assert.deepEqual(parseRpmFields("vetta\n1.2.3\nx86_64\n"), {
		name: "vetta",
		version: "1.2.3",
		arch: "x86_64",
	});
	assert.deepEqual(
		parseDebContents(
			"-rwxr-xr-x root/root 123 2026-01-01 00:00 ./opt/Metoai/Vetta\n" +
				"lrwxrwxrwx root/root 0 2026-01-01 00:00 ./usr/bin/vetta -> /opt/Metoai/Vetta\n",
		),
		["/opt/Metoai/Vetta", "/usr/bin/vetta"],
	);
});

test("Linux payload paths follow the staged electron-builder product identity", async () => {
	const stageDir = await mkdtemp(join(tmpdir(), "vetta-linux-layout-"));
	try {
		const builderConfigPath = join(stageDir, "electron-builder.json");
		await writeFile(
			builderConfigPath,
			JSON.stringify({ productName: "Metoai", executableName: "Vetta", linux: { target: ["deb"] } }),
		);
		assert.deepEqual(await readLinuxPayloadPaths(builderConfigPath), [
			"/opt/Metoai/Vetta",
			"/opt/Metoai/resources/package-type",
		]);

		await writeFile(
			builderConfigPath,
			JSON.stringify({ productName: "Metoai", executableName: "Vetta", linux: { executableName: "Metoai" } }),
		);
		assert.deepEqual(await readLinuxPayloadPaths(builderConfigPath), [
			"/opt/Metoai/Metoai",
			"/opt/Metoai/resources/package-type",
		]);

		await rm(builderConfigPath);
		await assert.rejects(
			() => readLinuxPayloadPaths(builderConfigPath),
			/cannot read the staged electron-builder config/,
		);
	} finally {
		await rm(stageDir, { recursive: true, force: true });
	}
});

test("Linux payload paths reject identities that electron-builder would sanitize", () => {
	assert.throws(
		() => resolveLinuxPayloadPaths({ productName: "Metoai Desktop", executableName: "Vetta" }),
		/productName Metoai Desktop is not a plain path segment/,
	);
	assert.throws(
		() => resolveLinuxPayloadPaths({ productName: "Metoai", executableName: "" }),
		/missing executableName/,
	);
});

test("native package verification uses the release manifest version", async () => {
	const releaseDir = await mkdtemp(join(tmpdir(), "vetta-linux-packages-"));
	try {
		await writeFile(join(releaseDir, "latest-linux.yml"), "version: 9.8.7\n");
		assert.equal(await readExpectedVersion(releaseDir), "9.8.7");
	} finally {
		await rm(releaseDir, { recursive: true, force: true });
	}
});
