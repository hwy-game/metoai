import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import {
	archForNodeArch,
	buildDownloadUrl,
	buildReleasePayload,
	collectInstallerFiles,
	isInstallerFile,
	main,
	parseArguments,
	platformForNodePlatform,
	postRelease,
	releaseNotesPathFor,
	requireAdminToken,
	resolveDefaultChannel,
	resolveTimeoutMs,
	sha256File,
} from "./register-update-release.mjs";

const TOKEN_SENTINEL = "admin-pat-sentinel-0123456789abcdef";
const SHA256_EMPTY = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const SHA256_HELLO_WORLD = "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9";

const CONTRACT_FIELDS = [
	"arch",
	"channel",
	"download_url",
	"file_name",
	"min_supported_version",
	"platform",
	"policy",
	"published",
	"release_note",
	"rollout_percent",
	"sha256",
	"size_bytes",
	"version",
];

function createRecorder() {
	const lines = [];
	const record = (level) => (...args) => lines.push(`${level} ${args.map(String).join(" ")}`);
	return {
		logger: { log: record("log"), warn: record("warn"), error: record("error") },
		text: () => lines.join("\n"),
	};
}

async function withTempDir(run) {
	const directory = await mkdtemp(join(tmpdir(), "vetta-register-release-"));
	try {
		return await run(directory);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
}

function captureError(run) {
	try {
		run();
	} catch (error) {
		return error;
	}
	throw new Error("期望调用抛错，但没有抛出");
}

async function captureRejection(run) {
	try {
		await run();
	} catch (error) {
		return error;
	}
	throw new Error("期望调用失败，但没有失败");
}

async function startReleaseServer(handler) {
	const requests = [];
	const server = createServer((request, response) => {
		let body = "";
		request.on("data", (chunk) => {
			body += chunk;
		});
		request.on("end", () => {
			requests.push({ method: request.method, url: request.url, headers: request.headers, body });
			handler(response, body);
		});
	});
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	const { port } = server.address();
	return {
		baseUrl: `http://127.0.0.1:${port}`,
		requests,
		close: async () => {
			server.closeAllConnections?.();
			await new Promise((resolve) => server.close(resolve));
		},
	};
}

function jsonEnvelope(body) {
	return (response) => {
		response.writeHead(200, { "Content-Type": "application/json" });
		response.end(JSON.stringify(body));
	};
}

function validPayload(overrides = {}) {
	return {
		channel: "stable",
		version: "0.5.58",
		platform: "windows",
		arch: "x64",
		policy: "optional",
		minSupportedVersion: "",
		releaseNote: "",
		downloadUrl: "",
		fileName: "Metoai-0.5.58-win-x64.exe",
		sizeBytes: 426940214,
		sha256: "a".repeat(64),
		rolloutPercent: 100,
		published: true,
		...overrides,
	};
}

test("sha256File 对已知内容给出期望的 64 位小写 hex", async () => {
	await withTempDir(async (directory) => {
		const emptyPath = join(directory, "empty.bin");
		const helloPath = join(directory, "hello.txt");
		await writeFile(emptyPath, "");
		await writeFile(helloPath, "hello world");

		assert.equal(await sha256File(emptyPath), SHA256_EMPTY);
		assert.equal(await sha256File(helloPath), SHA256_HELLO_WORLD);
		assert.equal(await sha256File(helloPath), createHash("sha256").update("hello world").digest("hex"));
	});
});

test("parseArguments 支持 --dry-run、重复 --file、--no-publish 与全部显式取值", () => {
	const defaults = parseArguments([]);
	assert.equal(defaults.dir, "release");
	assert.deepEqual(defaults.files, []);
	assert.equal(defaults.channel, undefined);
	assert.equal(defaults.version, undefined);
	assert.equal(defaults.platform, undefined);
	assert.equal(defaults.arch, undefined);
	assert.equal(defaults.policy, "optional");
	assert.equal(defaults.minSupportedVersion, "");
	assert.equal(defaults.rolloutPercent, 100);
	assert.equal(defaults.published, true);
	assert.equal(defaults.dryRun, false);
	assert.equal(defaults.help, false);

	const options = parseArguments([
		"--dry-run",
		"--file",
		"first.exe",
		"--file",
		"second.msi",
		"--no-publish",
		"--channel",
		"beta",
		"--version",
		"v1.2.3",
		"--platform",
		"macos",
		"--arch",
		"arm64",
		"--policy",
		"forced",
		"--min-supported-version",
		"1.0.0",
		"--rollout-percent",
		"25",
		"--release-note-file",
		"notes.md",
		"--dir",
		"dist",
	]);
	assert.deepEqual(options.files, ["first.exe", "second.msi"]);
	assert.equal(options.dryRun, true);
	assert.equal(options.published, false);
	assert.equal(options.channel, "beta");
	assert.equal(options.version, "1.2.3");
	assert.equal(options.platform, "macos");
	assert.equal(options.arch, "arm64");
	assert.equal(options.policy, "forced");
	assert.equal(options.minSupportedVersion, "1.0.0");
	assert.equal(options.rolloutPercent, 25);
	assert.equal(options.releaseNoteFile, "notes.md");
	assert.equal(options.dir, "dist");
	assert.equal(parseArguments(["--help"]).help, true);
});

test("parseArguments 拒绝非法 --policy / --rollout-percent / 未知参数", () => {
	assert.throws(() => parseArguments(["--policy", "urgent"]), /--policy/);
	assert.throws(() => parseArguments(["--rollout-percent", "101"]), /rollout-percent/);
	assert.throws(() => parseArguments(["--rollout-percent", "-1"]), /rollout-percent/);
	assert.throws(() => parseArguments(["--rollout-percent", "abc"]), /rollout-percent/);
	assert.throws(() => parseArguments(["--channel", "nightly"]), /--channel/);
	assert.throws(() => parseArguments(["--platform", "freebsd"]), /--platform/);
	assert.throws(() => parseArguments(["--arch", "ia32"]), /--arch/);
	assert.throws(() => parseArguments(["--version", "1.2"]), /--version/);
	assert.throws(() => parseArguments(["--dir"]), /缺少取值/);
	assert.throws(() => parseArguments(["--unknown"]), /未知参数/);
});

test("平台与架构推断映射正确", () => {
	assert.equal(platformForNodePlatform("win32"), "windows");
	assert.equal(platformForNodePlatform("darwin"), "macos");
	assert.equal(platformForNodePlatform("linux"), "linux");
	assert.throws(() => platformForNodePlatform("freebsd"), /--platform/);

	assert.equal(archForNodeArch("x64"), "x64");
	assert.equal(archForNodeArch("arm64"), "arm64");
	assert.throws(() => archForNodeArch("ia32"), /--arch/);
});

test("通道与超时默认值可被环境变量覆盖", () => {
	assert.equal(resolveDefaultChannel({}), "stable");
	assert.equal(resolveDefaultChannel({ VETTA_R2_PREFIX: "desktop/beta" }), "beta");
	assert.equal(resolveDefaultChannel({ VETTA_UPDATE_URL: "https://releases.example.com/desktop/stable/" }), "stable");
	assert.equal(resolveTimeoutMs({}), 15000);
	assert.equal(resolveTimeoutMs({ METOTOKEN_TIMEOUT_MS: "3000" }), 3000);
	assert.throws(() => resolveTimeoutMs({ METOTOKEN_TIMEOUT_MS: "0" }), /METOTOKEN_TIMEOUT_MS/);
});

test("download_url 前缀做斜杠归一化，未配置时为空串", () => {
	assert.equal(buildDownloadUrl("", "Metoai-1.2.3-win-x64.exe"), "");
	assert.equal(buildDownloadUrl(undefined, "Metoai-1.2.3-win-x64.exe"), "");
	assert.equal(
		buildDownloadUrl("https://releases.example.com/desktop/stable/", "Metoai-1.2.3-win-x64.exe"),
		"https://releases.example.com/desktop/stable/Metoai-1.2.3-win-x64.exe",
	);
	assert.equal(
		buildDownloadUrl("https://releases.example.com/desktop/stable", "Metoai Setup 1.2.3.exe"),
		"https://releases.example.com/desktop/stable/Metoai%20Setup%201.2.3.exe",
	);
});

test("buildReleasePayload 的字段名与契约完全一致", () => {
	const payload = buildReleasePayload(
		validPayload({
			releaseNote: "- 修复启动崩溃",
			downloadUrl: "https://releases.example.com/desktop/stable/Metoai-0.5.58-win-x64.exe",
		}),
	);
	assert.deepEqual(Object.keys(payload).sort(), CONTRACT_FIELDS);
	assert.deepEqual(payload, {
		channel: "stable",
		version: "0.5.58",
		platform: "windows",
		arch: "x64",
		policy: "optional",
		min_supported_version: "",
		release_note: "- 修复启动崩溃",
		download_url: "https://releases.example.com/desktop/stable/Metoai-0.5.58-win-x64.exe",
		file_name: "Metoai-0.5.58-win-x64.exe",
		size_bytes: 426940214,
		sha256: "a".repeat(64),
		rollout_percent: 100,
		published: true,
	});
});

test("buildReleasePayload 拒绝非法枚举、非法 sha256 与非法 rollout_percent", () => {
	assert.throws(() => buildReleasePayload(validPayload({ policy: "urgent" })), /--policy/);
	assert.throws(() => buildReleasePayload(validPayload({ platform: "android" })), /--platform/);
	assert.throws(() => buildReleasePayload(validPayload({ arch: "ia32" })), /--arch/);
	assert.throws(() => buildReleasePayload(validPayload({ channel: "nightly" })), /--channel/);
	assert.throws(() => buildReleasePayload(validPayload({ sha256: "A".repeat(64) })), /64 位小写 hex/);
	assert.throws(() => buildReleasePayload(validPayload({ sha256: "a".repeat(63) })), /64 位小写 hex/);
	assert.throws(() => buildReleasePayload(validPayload({ rolloutPercent: 150 })), /rollout_percent/);
	assert.throws(() => buildReleasePayload(validPayload({ sizeBytes: -1 })), /size_bytes/);
});

test("collectInstallerFiles 按平台识别产物并拒绝空目录", async () => {
	await withTempDir(async (directory) => {
		await writeFile(join(directory, "Metoai-1.2.3-win-x64.exe"), "exe");
		await writeFile(join(directory, "Metoai-1.2.3-win-x64.msi"), "msi");
		await writeFile(join(directory, "latest.yml"), "version: 1.2.3\n");

		const { files, skipped } = await collectInstallerFiles({ directory, platform: "windows" });
		assert.deepEqual(
			files.map((file) => file.fileName),
			["Metoai-1.2.3-win-x64.exe", "Metoai-1.2.3-win-x64.msi"],
		);
		assert.deepEqual(skipped, []);
		await assert.rejects(() => collectInstallerFiles({ directory, platform: "linux" }), /没有 linux 可识别的安装包/);
		await assert.rejects(
			() => collectInstallerFiles({ directory: join(directory, "missing"), platform: "windows" }),
			/产物目录不存在/,
		);
	});
});

test("isInstallerFile 覆盖三平台的扩展名", () => {
	assert.equal(isInstallerFile("Metoai-0.5.58-win-x64.exe", "windows"), true);
	assert.equal(isInstallerFile("Metoai-0.5.58-win-x64.msi", "windows"), true);
	assert.equal(isInstallerFile("Metoai-0.5.58-arm64-mac.dmg", "macos"), true);
	assert.equal(isInstallerFile("Metoai-0.5.58-arm64-mac.zip", "macos"), true);
	assert.equal(isInstallerFile("Metoai-0.5.58.AppImage", "linux"), true);
	assert.equal(isInstallerFile("vetta_0.5.58_amd64.deb", "linux"), true);
	assert.equal(isInstallerFile("vetta-0.5.58.x86_64.rpm", "linux"), true);
	assert.equal(isInstallerFile("Metoai-0.5.58-win-x64.exe", "macos"), false);
	assert.equal(isInstallerFile("latest.yml", "linux"), false);
	assert.throws(() => isInstallerFile("a.exe", "android"), /未知平台/);
});

test("缺少 METOTOKEN_ADMIN_TOKEN 时报错且错误信息不含凭据", async () => {
	const missing = captureError(() => requireAdminToken({}));
	assert.match(missing.message, /METOTOKEN_ADMIN_TOKEN/);
	assert.ok(!missing.message.includes("Bearer"));
	// 只说明缺哪个环境变量，不含任何形如 PAT 的长串
	assert.ok(!/[A-Za-z0-9_-]{32,}/.test(missing.message));

	// 非 dry-run 且缺凭据：直接失败，不做任何产物枚举
	const missingCredential = await captureRejection(() => main({ argv: [], env: {} }));
	assert.match(missingCredential.message, /METOTOKEN_ADMIN_TOKEN/);
	assert.ok(!missingCredential.message.includes("Bearer"));
});

test("默认发布说明路径指向仓库根的 .github/release-notes", () => {
	const notePath = releaseNotesPathFor("0.5.58");
	assert.match(notePath.replace(/\\/g, "/"), /\/\.github\/release-notes\/v0\.5\.58\.md$/);
	// 目录必须真实存在，否则说明相对层级算错了（apps/desktop/scripts → 仓库根是两级向上）
	assert.equal(existsSync(dirname(notePath)), true);
});

test("--dry-run 打印将提交的 JSON 且不发送任何 HTTP 请求", async () => {
	await withTempDir(async (directory) => {
		const installerPath = join(directory, "Metoai-1.2.3-win-x64.exe");
		const content = "dry-run-installer-bytes";
		await writeFile(installerPath, content);
		const server = await startReleaseServer(jsonEnvelope({ code: 0, message: "", data: {} }));
		try {
			const recorder = createRecorder();
			const summary = await main({
				argv: [
					"--dry-run",
					"--file",
					installerPath,
					"--platform",
					"windows",
					"--arch",
					"x64",
					"--version",
					"1.2.3",
				],
				env: { METOTOKEN_BASE_URL: server.baseUrl, METOTOKEN_ADMIN_TOKEN: TOKEN_SENTINEL },
				logger: recorder.logger,
			});

			assert.equal(server.requests.length, 0);
			assert.equal(summary.succeeded, 0);
			assert.equal(summary.failed, 0);
			assert.equal(summary.skipped, 1);
			assert.match(recorder.text(), /登记完成：成功 0 \/ 失败 0 \/ 跳过 1/);
			assert.match(recorder.text(), new RegExp(`"sha256": "${createHash("sha256").update(content).digest("hex")}"`));
			assert.match(recorder.text(), new RegExp(`"size_bytes": ${Buffer.byteLength(content)}`));
			// 1.2.3 在仓库里没有对应的发布说明：release_note 必须是空串而不是 undefined
			assert.match(recorder.text(), /"release_note": ""/);
			assert.ok(!recorder.text().includes(TOKEN_SENTINEL));
			assert.ok(!recorder.text().includes("Bearer"));
		} finally {
			await server.close();
		}
	});
});

test("真实登记把契约字段 POST 到管理端，且日志不回显凭据", async () => {
	await withTempDir(async (directory) => {
		const installerPath = join(directory, "Metoai-1.2.3-win-x64.exe");
		const notePath = join(directory, "notes.md");
		const content = "installer-bytes";
		await writeFile(installerPath, content);
		await writeFile(notePath, "## 1.2.3\n\n- 修复启动崩溃\n");
		const server = await startReleaseServer(jsonEnvelope({ code: 0, message: "", data: { id: 7 } }));
		try {
			const recorder = createRecorder();
			const summary = await main({
				argv: [
					"--file",
					installerPath,
					"--platform",
					"windows",
					"--arch",
					"x64",
					"--version",
					"1.2.3",
					"--channel",
					"stable",
					"--release-note-file",
					notePath,
				],
				env: {
					METOTOKEN_BASE_URL: server.baseUrl,
					METOTOKEN_ADMIN_TOKEN: TOKEN_SENTINEL,
					METOTOKEN_DOWNLOAD_URL_BASE: "https://releases.example.com/desktop/stable/",
				},
				logger: recorder.logger,
			});

			assert.equal(summary.succeeded, 1);
			assert.equal(summary.failed, 0);
			assert.equal(summary.skipped, 0);
			assert.equal(server.requests.length, 1);

			const [request] = server.requests;
			assert.equal(request.method, "POST");
			assert.equal(request.url, "/api/metoai/desktop/releases");
			assert.equal(request.headers.authorization, `Bearer ${TOKEN_SENTINEL}`);
			assert.equal(request.headers["content-type"], "application/json");

			const payload = JSON.parse(request.body);
			assert.deepEqual(Object.keys(payload).sort(), CONTRACT_FIELDS);
			assert.equal(payload.channel, "stable");
			assert.equal(payload.version, "1.2.3");
			assert.equal(payload.platform, "windows");
			assert.equal(payload.arch, "x64");
			assert.equal(payload.policy, "optional");
			assert.equal(payload.min_supported_version, "");
			assert.equal(payload.release_note, "## 1.2.3\n\n- 修复启动崩溃\n");
			assert.equal(
				payload.download_url,
				"https://releases.example.com/desktop/stable/Metoai-1.2.3-win-x64.exe",
			);
			assert.equal(payload.file_name, "Metoai-1.2.3-win-x64.exe");
			assert.equal(payload.size_bytes, Buffer.byteLength(content));
			assert.equal(payload.sha256, createHash("sha256").update(content).digest("hex"));
			assert.match(payload.sha256, /^[0-9a-f]{64}$/);
			assert.equal(payload.rollout_percent, 100);
			assert.equal(payload.published, true);

			assert.match(recorder.text(), /登记完成：成功 1 \/ 失败 0 \/ 跳过 0/);
			assert.ok(!recorder.text().includes(TOKEN_SENTINEL));
		} finally {
			await server.close();
		}
	});
});

test("--no-publish 与 --rollout-percent 进入请求体", async () => {
	await withTempDir(async (directory) => {
		const installerPath = join(directory, "Metoai-1.2.3-win-x64.msi");
		await writeFile(installerPath, "msi-bytes");
		const server = await startReleaseServer(jsonEnvelope({ code: 0, message: "", data: {} }));
		try {
			await main({
				argv: [
					"--file",
					installerPath,
					"--platform",
					"windows",
					"--arch",
					"x64",
					"--version",
					"1.2.3",
					"--no-publish",
					"--rollout-percent",
					"0",
					"--policy",
					"forced",
					"--min-supported-version",
					"1.2.0",
				],
				env: { METOTOKEN_BASE_URL: server.baseUrl, METOTOKEN_ADMIN_TOKEN: TOKEN_SENTINEL },
				logger: createRecorder().logger,
			});
			const payload = JSON.parse(server.requests[0].body);
			assert.equal(payload.published, false);
			assert.equal(payload.rollout_percent, 0);
			assert.equal(payload.policy, "forced");
			assert.equal(payload.min_supported_version, "1.2.0");
			assert.equal(payload.download_url, "");
		} finally {
			await server.close();
		}
	});
});

test("code != 0 的响应被判定为失败并计入失败数", async () => {
	await withTempDir(async (directory) => {
		const installerPath = join(directory, "Metoai-1.2.3-win-x64.exe");
		await writeFile(installerPath, "installer");
		const server = await startReleaseServer(jsonEnvelope({ code: 1, message: "sha256 校验不一致" }));
		try {
			const recorder = createRecorder();
			const summary = await main({
				argv: ["--file", installerPath, "--platform", "windows", "--arch", "x64", "--version", "1.2.3"],
				env: { METOTOKEN_BASE_URL: server.baseUrl, METOTOKEN_ADMIN_TOKEN: TOKEN_SENTINEL },
				logger: recorder.logger,
			});

			assert.equal(summary.succeeded, 0);
			assert.equal(summary.failed, 1);
			assert.match(recorder.text(), /code=1/);
			assert.match(recorder.text(), /sha256 校验不一致/);
			assert.match(recorder.text(), /登记完成：成功 0 \/ 失败 1 \/ 跳过 0/);
			assert.ok(!recorder.text().includes(TOKEN_SENTINEL));
		} finally {
			await server.close();
		}
	});
});

test("postRelease 把非 2xx、非法 JSON、超时都判为失败", async () => {
	const payload = buildReleasePayload(validPayload());
	const notFound = async () => new Response("upstream boom", { status: 500 });
	await assert.rejects(
		() => postRelease({ token: "t", payload, fetchImpl: notFound }),
		/返回 HTTP 500：upstream boom/,
	);

	const invalidJson = async () =>
		new Response("<html>not json</html>", { status: 200, headers: { "Content-Type": "text/html" } });
	await assert.rejects(() => postRelease({ token: "t", payload, fetchImpl: invalidJson }), /不是合法 JSON/);

	const server = await startReleaseServer(() => {});
	try {
		await assert.rejects(
			() =>
				postRelease({
					baseUrl: server.baseUrl,
					token: TOKEN_SENTINEL,
					payload,
					timeoutMs: 200,
				}),
			/请求超时（200ms）/,
		);
	} finally {
		await server.close();
	}
});

test("响应体回显凭据时错误信息仍被脱敏", async () => {
	const payload = buildReleasePayload(validPayload());
	const echo = async () =>
		new Response(`{"code":1,"message":"bad header Bearer ${TOKEN_SENTINEL}"}`, {
			status: 200,
			headers: { "Content-Type": "application/json" },
		});
	const error = await captureRejection(() => postRelease({ token: TOKEN_SENTINEL, payload, fetchImpl: echo }));
	assert.ok(!error.message.includes(TOKEN_SENTINEL));
	assert.match(error.message, /code=1/);
});
