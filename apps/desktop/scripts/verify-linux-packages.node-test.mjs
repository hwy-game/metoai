import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
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
const payloadPaths = resolveLinuxPayloadPaths({ productName: "MetoAI", executableName: "MetoAI" });
const paths = [
	...payloadPaths,
	"/usr/share/applications/MetoAI.desktop",
	"/usr/share/icons/hicolor/512x512/apps/MetoAI.png",
];

// 与构建 workflow 写下的载荷配置投影路径一致：它随 checkpoint 进入验收 job 的 release/。
const payloadProjectionPath = join(import.meta.dirname, "..", "release", "linux-payload-config.json");

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
		/RPM package is missing \/opt\/MetoAI\/MetoAI/,
	);
});

test("package command output parsers normalize Debian and RPM metadata", () => {
	assert.deepEqual(
		parseDebFields("Package: vetta\nVersion: 1.2.3\nArchitecture: amd64\nDescription: MetoAI\n"),
		{ name: "vetta", version: "1.2.3", arch: "amd64" },
	);
	assert.deepEqual(parseRpmFields("vetta\n1.2.3\nx86_64\n"), {
		name: "vetta",
		version: "1.2.3",
		arch: "x86_64",
	});
	assert.deepEqual(
		parseDebContents(
			"-rwxr-xr-x root/root 123 2026-01-01 00:00 ./opt/MetoAI/MetoAI\n" +
				"lrwxrwxrwx root/root 0 2026-01-01 00:00 ./usr/bin/vetta -> /opt/MetoAI/MetoAI\n",
		),
		["/opt/MetoAI/MetoAI", "/usr/bin/vetta"],
	);
});

test("Linux payload paths follow the staged electron-builder product identity", async () => {
	const stageDir = await mkdtemp(join(tmpdir(), "vetta-linux-layout-"));
	try {
		const builderConfigPath = join(stageDir, "electron-builder.json");
		await writeFile(
			builderConfigPath,
			JSON.stringify({ productName: "MetoAI", executableName: "MetoAI", linux: { target: ["deb"] } }),
		);
		assert.deepEqual(await readLinuxPayloadPaths(builderConfigPath), [
			"/opt/MetoAI/MetoAI",
			"/opt/MetoAI/resources/package-type",
		]);

		await writeFile(
			builderConfigPath,
			JSON.stringify({ productName: "MetoAI", executableName: "MetoAI", linux: { executableName: "MetoAI" } }),
		);
		assert.deepEqual(await readLinuxPayloadPaths(builderConfigPath), [
			"/opt/MetoAI/MetoAI",
			"/opt/MetoAI/resources/package-type",
		]);

		await rm(builderConfigPath);
		// 显式传入不存在的投影路径：两个候选都缺失时才算读不到载荷配置。
		await assert.rejects(
			() => readLinuxPayloadPaths(builderConfigPath, join(stageDir, "linux-payload-config.json")),
			/cannot read the staged electron-builder config/,
		);
	} finally {
		await rm(stageDir, { recursive: true, force: true });
	}
});

test("Linux payload paths reject identities that electron-builder would sanitize", () => {
	assert.throws(
		() => resolveLinuxPayloadPaths({ productName: "MetoAI Desktop", executableName: "MetoAI" }),
		/productName MetoAI Desktop is not a plain path segment/,
	);
	assert.throws(
		() => resolveLinuxPayloadPaths({ productName: "MetoAI", executableName: "" }),
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

// 发布流程把构建和验收拆到两个 runner：验收 job 上 staged 配置必然不存在，
// 只能读构建时随 checkpoint 归档进 release/ 的载荷配置投影。
test("Linux payload paths fall back to the checkpoint payload projection", async () => {
	const stageDir = await mkdtemp(join(tmpdir(), "vetta-linux-projection-"));
	const previousProjection = await readFile(payloadProjectionPath, "utf8").catch(() => null);
	try {
		await mkdir(dirname(payloadProjectionPath), { recursive: true });
		await writeFile(
			payloadProjectionPath,
			JSON.stringify({ productName: "MetoAI", executableName: "MetoAI", linux: { executableName: "MetoAI" } }),
		);
		// 只传缺失的 staged 路径：投影路径必须由默认值补上。
		assert.deepEqual(await readLinuxPayloadPaths(join(stageDir, "electron-builder.json")), [
			"/opt/MetoAI/MetoAI",
			"/opt/MetoAI/resources/package-type",
		]);
	} finally {
		if (previousProjection === null) await rm(payloadProjectionPath, { force: true });
		else await writeFile(payloadProjectionPath, previousProjection);
		await rm(stageDir, { recursive: true, force: true });
	}
});

test("Linux payload path lookup reports every candidate path it tried", async () => {
	const stageDir = await mkdtemp(join(tmpdir(), "vetta-linux-missing-"));
	try {
		const builderConfigPath = join(stageDir, "electron-builder.json");
		const projectionPath = join(stageDir, "linux-payload-config.json");
		await assert.rejects(
			() => readLinuxPayloadPaths(builderConfigPath, projectionPath),
			(error) => {
				assert.match(error.message, /cannot read the staged electron-builder config/);
				assert.ok(error.message.includes(builderConfigPath), error.message);
				assert.ok(error.message.includes(projectionPath), error.message);
				return true;
			},
		);
	} finally {
		await rm(stageDir, { recursive: true, force: true });
	}
});
