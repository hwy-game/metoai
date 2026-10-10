import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { resolveReleaseInfo } from "./resolve-release-info.mjs";

// 把已打好的桌面端安装包元数据登记到 metotoken 管理端，避免管理员手抄 sha256。
//
// opt-in 的可选步骤：不接入 CI、不改 electron-builder 的 publish/feed 配置，
// 只有管理员显式提供 METOTOKEN_ADMIN_TOKEN 且不加 --dry-run 时才会真的发请求。
// METOTOKEN_ADMIN_TOKEN 的值在任何情况下都不打印、不回显、不写日志（含错误信息与 dry-run 输出）。
//
// 幂等性：唯一键是 (channel, version, platform, arch)，重复执行是覆盖同一条记录而不是新增。

const projectRoot = join(import.meta.dirname, "..");
const updaterMetadataPattern = /^latest(?:-[a-z0-9_-]+)?\.ya?ml$/i;

export const DEFAULT_BASE_URL = "https://www.metotoken.ai";
export const DEFAULT_TIMEOUT_MS = 15000;
export const RELEASE_PATH = "/api/metoai/desktop/releases";
export const CHANNELS = Object.freeze(["stable", "beta"]);
export const PLATFORMS = Object.freeze(["windows", "macos", "linux"]);
export const ARCHITECTURES = Object.freeze(["x64", "arm64"]);
export const POLICIES = Object.freeze(["optional", "forced"]);
export const INSTALLER_EXTENSIONS = Object.freeze({
	windows: Object.freeze([".exe", ".msi"]),
	macos: Object.freeze([".dmg", ".zip"]),
	linux: Object.freeze([".AppImage", ".deb", ".rpm"]),
});

export const HELP_TEXT = `[register-release] 把已打好的桌面端安装包登记到 metotoken 管理端（opt-in，不接入 CI）

用法：
  node apps/desktop/scripts/register-update-release.mjs [选项]

选项：
  --dir <路径>                     产物目录，默认 release（相对当前工作目录解析，通常在 apps/desktop 下运行）
  --file <路径>                    显式指定一个安装包文件，可重复；给了 --file 就不再扫目录
  --channel <stable|beta>          更新通道，默认取 VETTA_R2_PREFIX / VETTA_UPDATE_URL 的末段，取不到用 stable
  --version <x.y.z>                版本号，默认取 VETTA_DESKTOP_RELEASE_VERSION / latest*.yml / package.json
  --platform <windows|macos|linux> 默认按当前运行平台推断
  --arch <x64|arm64>               默认按 process.arch 推断
  --policy <optional|forced>       更新策略，默认 optional
  --min-supported-version <版本>   最低可用版本，默认空串
  --release-note-file <路径>       从文件读 Markdown 作为 release_note；默认取 .github/release-notes/v<版本>.md，
                                   其次 apps/desktop/CHANGELOG.md 的对应小节，都没有则空串
  --rollout-percent <0-100>        灰度比例，默认 100
  --no-publish                     以草稿登记（published: false）
  --dry-run                        只打印将提交的 JSON 与 sha256，不发送任何请求（无需凭据）
  --help                           显示本帮助

环境变量：
  METOTOKEN_ADMIN_TOKEN        管理端凭据（PAT / access_token），真实登记时必填，永不回显
  METOTOKEN_BASE_URL           管理端基址，默认 ${DEFAULT_BASE_URL}
  METOTOKEN_DOWNLOAD_URL_BASE  下载地址前缀，会拼上 file_name；未设置时 download_url 登记为空串
  METOTOKEN_TIMEOUT_MS         单次请求超时，默认 ${DEFAULT_TIMEOUT_MS}

示例：
  node apps/desktop/scripts/register-update-release.mjs --dry-run --dir release
  METOTOKEN_ADMIN_TOKEN=... node apps/desktop/scripts/register-update-release.mjs \\
    --file release/MetoAI-0.5.58-win-x64.exe --channel stable --version 0.5.58`;

function requireEnum(value, allowed, label) {
	if (!allowed.includes(value)) {
		throw new Error(`[register-release] ${label} 只能是 ${allowed.join(" / ")}：${String(value)}`);
	}
	return value;
}

function requireVersion(version, source) {
	const value = String(version ?? "")
		.trim()
		.replace(/^v/, "");
	if (!/^\d+\.\d+\.\d+$/.test(value)) {
		throw new Error(`[register-release] ${source} 的版本号不是 x.y.z 形式：${String(version)}`);
	}
	return value;
}

/** 平台推断：win32 → windows，darwin → macos，linux → linux。 */
export function platformForNodePlatform(nodePlatform = process.platform) {
	if (nodePlatform === "win32") return "windows";
	if (nodePlatform === "darwin") return "macos";
	if (nodePlatform === "linux") return "linux";
	throw new Error(`[register-release] 无法从 ${String(nodePlatform)} 推断平台，请显式传 --platform`);
}

/** 架构推断：x64 → x64，arm64 → arm64。 */
export function archForNodeArch(nodeArch = process.arch) {
	if (nodeArch === "x64") return "x64";
	if (nodeArch === "arm64") return "arm64";
	throw new Error(`[register-release] 无法从 ${String(nodeArch)} 推断架构，请显式传 --arch`);
}

export function isInstallerFile(fileName, platform) {
	const extensions = INSTALLER_EXTENSIONS[platform];
	if (!extensions) throw new Error(`[register-release] 未知平台：${String(platform)}`);
	const lower = String(fileName).toLowerCase();
	return extensions.some((extension) => lower.endsWith(extension.toLowerCase()));
}

function parseRolloutPercent(raw) {
	if (!/^\d{1,3}$/.test(raw)) {
		throw new Error(`[register-release] --rollout-percent 必须是 0-100 的整数：${raw}`);
	}
	const value = Number(raw);
	if (value > 100) throw new Error(`[register-release] --rollout-percent 必须是 0-100 的整数：${raw}`);
	return value;
}

export function parseArguments(argv = []) {
	const options = {
		dir: "release",
		files: [],
		channel: undefined,
		version: undefined,
		platform: undefined,
		arch: undefined,
		policy: "optional",
		minSupportedVersion: "",
		releaseNoteFile: undefined,
		rolloutPercent: 100,
		published: true,
		dryRun: false,
		help: false,
	};
	if (argv.includes("--help")) return { ...options, help: true };

	for (let index = 0; index < argv.length; index += 1) {
		const argument = argv[index];
		const readValue = (name) => {
			const value = argv[index + 1];
			if (value === undefined || value.startsWith("--")) {
				throw new Error(`[register-release] ${name} 缺少取值`);
			}
			index += 1;
			return value;
		};
		switch (argument) {
			case "--dir":
				options.dir = readValue("--dir");
				break;
			case "--file":
				options.files.push(readValue("--file"));
				break;
			case "--channel":
				options.channel = requireEnum(readValue("--channel").trim().toLowerCase(), CHANNELS, "--channel");
				break;
			case "--version":
				options.version = requireVersion(readValue("--version"), "--version");
				break;
			case "--platform":
				options.platform = requireEnum(readValue("--platform").trim().toLowerCase(), PLATFORMS, "--platform");
				break;
			case "--arch":
				options.arch = requireEnum(readValue("--arch").trim().toLowerCase(), ARCHITECTURES, "--arch");
				break;
			case "--policy":
				options.policy = requireEnum(readValue("--policy").trim().toLowerCase(), POLICIES, "--policy");
				break;
			case "--min-supported-version":
				options.minSupportedVersion = readValue("--min-supported-version");
				break;
			case "--release-note-file":
				options.releaseNoteFile = readValue("--release-note-file");
				break;
			case "--rollout-percent":
				options.rolloutPercent = parseRolloutPercent(readValue("--rollout-percent"));
				break;
			case "--no-publish":
				options.published = false;
				break;
			case "--dry-run":
				options.dryRun = true;
				break;
			default:
				throw new Error(`[register-release] 未知参数：${argument}`);
		}
	}
	return options;
}

/** 版本号来源：显式参数 > VETTA_DESKTOP_RELEASE_VERSION > release/latest*.yml > apps/desktop/package.json。 */
export async function resolveReleaseVersion({ env = process.env, directory = resolve("release") } = {}) {
	const configured = env.VETTA_DESKTOP_RELEASE_VERSION?.trim();
	if (configured) return requireVersion(configured, "VETTA_DESKTOP_RELEASE_VERSION");

	const entries = await readdir(directory, { withFileTypes: true }).catch((error) => {
		if (error?.code === "ENOENT") return [];
		throw error;
	});
	const versions = new Set();
	for (const entry of entries) {
		if (!entry.isFile() || !updaterMetadataPattern.test(entry.name)) continue;
		const document = await readFile(join(directory, entry.name), "utf8").catch(() => "");
		const match = /^version:\s*"?([^"\s]+)"?\s*$/m.exec(document);
		if (match && /^\d+\.\d+\.\d+$/.test(match[1])) versions.add(match[1]);
	}
	if (versions.size === 1) return [...versions][0];

	const packageVersion = JSON.parse(await readFile(join(projectRoot, "package.json"), "utf8")).version;
	return requireVersion(packageVersion, "apps/desktop/package.json");
}

/** 通道来源：VETTA_R2_PREFIX / VETTA_UPDATE_URL 的末段，取不到用 stable。 */
export function resolveDefaultChannel(env = process.env) {
	for (const candidate of [env.VETTA_R2_PREFIX, env.VETTA_UPDATE_URL]) {
		const value = candidate?.trim();
		if (!value) continue;
		const segment = value
			.replace(/\/+$/, "")
			.split("/")
			.filter(Boolean)
			.at(-1)
			?.toLowerCase();
		if (CHANNELS.includes(segment)) return segment;
	}
	return "stable";
}

export function resolveTimeoutMs(env = process.env) {
	const raw = env.METOTOKEN_TIMEOUT_MS?.trim();
	if (!raw) return DEFAULT_TIMEOUT_MS;
	const value = Number(raw);
	if (!Number.isInteger(value) || value <= 0) {
		throw new Error(`[register-release] METOTOKEN_TIMEOUT_MS 必须是正整数：${raw}`);
	}
	return value;
}

/** 管理端凭据。缺失时抛错；错误信息只提环境变量名，绝不包含凭据值。 */
export function requireAdminToken(env = process.env) {
	const token = env.METOTOKEN_ADMIN_TOKEN?.trim();
	if (!token) {
		throw new Error(
			"[register-release] 缺少管理端访问凭据：请设置环境变量 METOTOKEN_ADMIN_TOKEN（管理端 PAT / access_token）；该值永远不会被打印或写日志",
		);
	}
	return token;
}

export function buildDownloadUrl(base, fileName) {
	const prefix = String(base ?? "").trim();
	if (!prefix) return "";
	return `${prefix.replace(/\/+$/, "")}/${encodeURIComponent(fileName)}`;
}

export function buildReleasePayload({
	channel,
	version,
	platform,
	arch,
	policy = "optional",
	minSupportedVersion = "",
	releaseNote = "",
	downloadUrl = "",
	fileName,
	sizeBytes,
	sha256,
	rolloutPercent = 100,
	published = true,
}) {
	requireEnum(channel, CHANNELS, "--channel");
	const normalizedVersion = requireVersion(version, "--version");
	requireEnum(platform, PLATFORMS, "--platform");
	requireEnum(arch, ARCHITECTURES, "--arch");
	requireEnum(policy, POLICIES, "--policy");
	if (typeof fileName !== "string" || fileName.length === 0) {
		throw new Error("[register-release] 缺少 file_name");
	}
	if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 0) {
		throw new Error(`[register-release] size_bytes 非法：${String(sizeBytes)}`);
	}
	if (!/^[0-9a-f]{64}$/.test(String(sha256))) {
		throw new Error(`[register-release] sha256 必须是 64 位小写 hex：${String(sha256)}`);
	}
	if (!Number.isInteger(rolloutPercent) || rolloutPercent < 0 || rolloutPercent > 100) {
		throw new Error(`[register-release] rollout_percent 必须是 0-100 的整数：${String(rolloutPercent)}`);
	}
	return {
		channel,
		version: normalizedVersion,
		platform,
		arch,
		policy,
		min_supported_version: minSupportedVersion ?? "",
		release_note: releaseNote ?? "",
		download_url: downloadUrl ?? "",
		file_name: fileName,
		size_bytes: sizeBytes,
		sha256,
		rollout_percent: rolloutPercent,
		published: Boolean(published),
	};
}

/** 产物枚举：显式 --file 优先；否则扫目录并按平台扩展名过滤。 */
export async function collectInstallerFiles({ directory = resolve("release"), platform, files = [] } = {}) {
	if (files.length > 0) {
		const collected = [];
		const skipped = [];
		for (const file of files) {
			const filePath = resolve(file);
			const info = await stat(filePath).catch(() => undefined);
			if (!info?.isFile()) {
				throw new Error(`[register-release] --file 指向的文件不存在或不是普通文件：${filePath}`);
			}
			const fileName = basename(filePath);
			if (!isInstallerFile(fileName, platform)) {
				skipped.push(filePath);
				continue;
			}
			collected.push({ fileName, filePath });
		}
		if (collected.length === 0) {
			throw new Error(
				`[register-release] --file 指定的文件都不是 ${platform} 安装包（支持 ${INSTALLER_EXTENSIONS[platform].join(" / ")}）：${skipped.join(", ")}`,
			);
		}
		return { files: collected, skipped };
	}

	const entries = await readdir(directory, { withFileTypes: true }).catch((error) => {
		if (error?.code === "ENOENT") {
			throw new Error(`[register-release] 产物目录不存在：${directory}（用 --dir 指定，或先执行打包）`);
		}
		throw error;
	});
	const matched = entries
		.filter((entry) => entry.isFile() && isInstallerFile(entry.name, platform))
		.map((entry) => entry.name)
		.sort();
	if (matched.length === 0) {
		throw new Error(
			`[register-release] 目录 ${directory} 中没有 ${platform} 可识别的安装包（支持 ${INSTALLER_EXTENSIONS[platform].join(" / ")}）`,
		);
	}
	return {
		files: matched.map((fileName) => ({ fileName, filePath: join(directory, fileName) })),
		skipped: [],
	};
}

export async function sha256File(filePath) {
	const hash = createHash("sha256");
	for await (const chunk of createReadStream(filePath)) hash.update(chunk);
	return hash.digest("hex");
}

function describeBody(body, token) {
	const normalized = String(body ?? "")
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, 300);
	// 防御性脱敏：即使服务端把请求头回显进响应体，也不允许凭据出现在日志或错误里。
	// 只在凭据足够长时才替换，避免退化输入（例如 1 个字符）把正文里的普通字母也吃掉。
	const redacted =
		typeof token === "string" && token.length >= 8 ? normalized.split(token).join("***") : normalized;
	return redacted || "(空响应)";
}

export async function postRelease({
	baseUrl = DEFAULT_BASE_URL,
	token,
	payload,
	timeoutMs = DEFAULT_TIMEOUT_MS,
	fetchImpl = fetch,
}) {
	const url = `${String(baseUrl).trim().replace(/\/+$/, "")}${RELEASE_PATH}`;
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), timeoutMs);
	let response;
	try {
		response = await fetchImpl(url, {
			method: "POST",
			headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
			body: JSON.stringify(payload),
			signal: controller.signal,
		});
	} catch (error) {
		const reason = error?.name === "AbortError" ? `请求超时（${timeoutMs}ms）` : (error?.message ?? String(error));
		throw new Error(`[register-release] POST ${url} 失败：${reason}`);
	} finally {
		clearTimeout(timeout);
	}

	const text = await response.text().catch(() => "");
	if (!response.ok) {
		throw new Error(`[register-release] POST ${url} 返回 HTTP ${response.status}：${describeBody(text, token)}`);
	}
	let envelope;
	try {
		envelope = JSON.parse(text);
	} catch (error) {
		throw new Error(`[register-release] POST ${url} 的响应不是合法 JSON：${describeBody(text, token)}`, {
			cause: error,
		});
	}
	if (envelope?.code !== 0) {
		throw new Error(
			`[register-release] 管理端拒绝登记（code=${String(envelope?.code)}）：${describeBody(envelope?.message, token)}`,
		);
	}
	return envelope;
}

/** 现行发布说明约定：仓库根 .github/release-notes/v<版本>.md（见 apps/desktop/CHANGELOG.md 顶部说明）。 */
export function releaseNotesPathFor(version) {
	return join(projectRoot, "..", "..", ".github", "release-notes", `v${version}.md`);
}

async function resolveReleaseNote({ options, version }) {
	if (options.releaseNoteFile) {
		const notePath = resolve(options.releaseNoteFile);
		try {
			return await readFile(notePath, "utf8");
		} catch (error) {
			throw new Error(`[register-release] 无法读取 --release-note-file：${notePath}`, { cause: error });
		}
	}
	const releaseNotesPath = releaseNotesPathFor(version);
	const releaseNotes = await readFile(releaseNotesPath, "utf8").catch(() => undefined);
	if (releaseNotes !== undefined) return releaseNotes;
	// 历史版本回落到 CHANGELOG.md 的对应小节，复用既有解析工具。
	const changelogPath = join(projectRoot, "CHANGELOG.md");
	const changelog = await readFile(changelogPath, "utf8").catch(() => undefined);
	if (changelog && new RegExp(`^## \\[${version.replace(/\./g, "\\.")}\\]`, "m").test(changelog)) {
		return resolveReleaseInfo(changelogPath, version)?.releaseNotes ?? "";
	}
	return "";
}

export async function main({ argv = process.argv.slice(2), env = process.env, fetchImpl = fetch, logger = console } = {}) {
	const options = parseArguments(argv);
	if (options.help) {
		logger.log(HELP_TEXT);
		return { help: true, succeeded: 0, failed: 0, skipped: 0, files: [] };
	}

	const token = options.dryRun ? undefined : requireAdminToken(env);
	const version = options.version ?? (await resolveReleaseVersion({ env }));
	const channel = options.channel ?? resolveDefaultChannel(env);
	const platform = options.platform ?? platformForNodePlatform();
	const arch = options.arch ?? archForNodeArch();
	const releaseNote = await resolveReleaseNote({ options, version });
	const baseUrl = env.METOTOKEN_BASE_URL?.trim() || DEFAULT_BASE_URL;
	const timeoutMs = resolveTimeoutMs(env);
	const downloadUrlBase = env.METOTOKEN_DOWNLOAD_URL_BASE?.trim() ?? "";

	const { files, skipped: skippedFiles } = await collectInstallerFiles({
		directory: resolve(options.dir),
		platform,
		files: options.files,
	});

	logger.log(`[register-release] ${channel} ${version} ${platform}/${arch} → ${baseUrl}${RELEASE_PATH}`);
	logger.log(
		`[register-release] 待登记 ${files.length} 个安装包${options.dryRun ? "（dry-run：不会发送任何请求）" : "（重复执行是覆盖同一条记录）"}`,
	);
	if (downloadUrlBase) {
		logger.log(`[register-release] download_url 前缀：${downloadUrlBase}`);
	} else {
		logger.warn(
			"[register-release] 未设置 METOTOKEN_DOWNLOAD_URL_BASE，download_url 将登记为空串；请在管理台手动补上下载地址",
		);
	}
	for (const skippedFile of skippedFiles) {
		logger.warn(`[register-release] 跳过非 ${platform} 安装包：${skippedFile}`);
	}

	let succeeded = 0;
	let failed = 0;
	for (const { fileName, filePath } of files) {
		const info = await stat(filePath);
		const sha256 = await sha256File(filePath);
		const payload = buildReleasePayload({
			channel,
			version,
			platform,
			arch,
			policy: options.policy,
			minSupportedVersion: options.minSupportedVersion,
			releaseNote,
			downloadUrl: buildDownloadUrl(downloadUrlBase, fileName),
			fileName,
			sizeBytes: info.size,
			sha256,
			rolloutPercent: options.rolloutPercent,
			published: options.published,
		});

		if (options.dryRun) {
			logger.log(`[register-release] dry-run ${fileName}（sha256=${sha256}，${info.size} 字节）`);
			logger.log(JSON.stringify(payload, null, 2));
			continue;
		}

		try {
			await postRelease({ baseUrl, token, payload, timeoutMs, fetchImpl });
			succeeded += 1;
			logger.log(`[register-release] 已登记 ${fileName}（sha256=${sha256}，${info.size} 字节）`);
		} catch (error) {
			failed += 1;
			logger.error(error instanceof Error ? error.message : String(error));
		}
	}

	const skipped = skippedFiles.length + (options.dryRun ? files.length : 0);
	logger.log(`登记完成：成功 ${succeeded} / 失败 ${failed} / 跳过 ${skipped}`);
	return { succeeded, failed, skipped, files: files.map((file) => file.fileName) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main()
		.then((summary) => {
			if (summary.failed > 0) process.exitCode = 1;
		})
		.catch((error) => {
			console.error(error instanceof Error ? error.message : error);
			process.exitCode = 1;
		});
}
