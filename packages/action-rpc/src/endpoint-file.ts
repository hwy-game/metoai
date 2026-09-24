import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { migrateLegacyHomeDirectory } from "./home-directory-migration.js";
import type { ActionRpcEndpoint } from "./types.js";

export const ACTION_RPC_ENDPOINT_FILE_ENV = "VETTA_ACTION_RPC_ENDPOINT_FILE";
export const VETTA_HOME_ENV = "VETTA_HOME";
export const VETTA_CONFIG_DIR_ENV = "VETTA_CONFIG_DIR";

/**
 * 默认配置目录名。这是整个仓库主目录的唯一来源（~/<name>）。
 * VETTA_CONFIG_DIR 只覆盖这个名字（按环境隔离，如 dev），不改项目内目录。
 */
export const DEFAULT_CONFIG_DIR_NAME = ".metoai";

/** 品牌改名前的默认配置目录名。只用于把旧主目录整体迁移到新名字。 */
export const LEGACY_CONFIG_DIR_NAME = ".vetta";

function expandTilde(p: string): string {
	if (p === "~") return homedir();
	if (p.startsWith("~/")) return join(homedir(), p.slice(2));
	return p;
}

/** 配置目录名。VETTA_CONFIG_DIR 覆盖，否则用默认品牌名。 */
export function getVettaConfigDirName(): string {
	return process.env[VETTA_CONFIG_DIR_ENV] || DEFAULT_CONFIG_DIR_NAME;
}

/**
 * 与 `configDirName` 对应的旧目录名；没有对应旧命名时返回 undefined。
 * 覆盖值（如 `.metoai-dev`）只迁移同后缀的旧值（`.vetta-dev`），避免误动真实主目录。
 */
function getLegacyConfigDirName(configDirName: string): string | undefined {
	if (configDirName === DEFAULT_CONFIG_DIR_NAME) return LEGACY_CONFIG_DIR_NAME;
	if (configDirName.startsWith(DEFAULT_CONFIG_DIR_NAME)) {
		return `${LEGACY_CONFIG_DIR_NAME}${configDirName.slice(DEFAULT_CONFIG_DIR_NAME.length)}`;
	}
	return undefined;
}

const homePathCache = new Map<string, string>();

let homeMigrationWarningHandler: ((message: string, error: unknown) => void) | undefined;

/** 宿主（如 Desktop 主进程）可以接管迁移失败的告警，让它进宿主日志而不是 stdout。 */
export function setVettaHomeMigrationWarningHandler(
	handler: ((message: string, error: unknown) => void) | undefined,
): void {
	homeMigrationWarningHandler = handler;
}

/** 测试用：清掉按配置目录名缓存的主目录解析结果。 */
export function resetVettaHomePathCache(): void {
	homePathCache.clear();
}

/**
 * 用户主目录下的数据根。VETTA_HOME（绝对路径，支持 ~ 展开）作为逃生口优先，
 * 否则为 ~/<configDirName>，并在首次解析时把旧品牌主目录整体重命名过来。
 *
 * 重命名失败（跨盘、被占用、权限）时回退到旧目录：宁可继续用旧目录，也不能丢数据或让启动失败。
 */
export function getVettaHomePath(): string {
	const explicit = process.env[VETTA_HOME_ENV];
	if (explicit) return expandTilde(explicit);
	const configDirName = getVettaConfigDirName();
	const cached = homePathCache.get(configDirName);
	if (cached) return cached;
	const home = join(homedir(), configDirName);
	const legacyDirName = getLegacyConfigDirName(configDirName);
	const resolved = legacyDirName
		? migrateLegacyHomeDirectory({
				home,
				legacyHome: join(homedir(), legacyDirName),
				warn: (message, error) => {
					if (homeMigrationWarningHandler) homeMigrationWarningHandler(message, error);
					else console.warn(`[vetta-home-migration] ${message}`, error);
				},
			})
		: home;
	homePathCache.set(configDirName, resolved);
	return resolved;
}

export function getActionRpcEndpointFilePath(): string {
	const envPath = process.env[ACTION_RPC_ENDPOINT_FILE_ENV];
	if (envPath) return envPath;
	return join(getVettaHomePath(), "action-server.json");
}

function parseActionRpcEndpoint(value: unknown, endpointFilePath: string): ActionRpcEndpoint {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error(`Invalid action server endpoint file: ${endpointFilePath}`);
	}
	const input = value as Record<string, unknown>;
	if (
		input.transport !== "http" ||
		typeof input.url !== "string" ||
		input.url.length === 0 ||
		typeof input.token !== "string" ||
		input.token.length === 0
	) {
		throw new Error(`Invalid action server endpoint file: ${endpointFilePath}`);
	}
	return { transport: "http", url: input.url, token: input.token };
}

/** Read and validate the endpoint advertised by the running Desktop host. */
export async function readActionRpcEndpoint(): Promise<ActionRpcEndpoint> {
	const endpointFilePath = getActionRpcEndpointFilePath();
	const raw = await readFile(endpointFilePath, "utf8");
	return parseActionRpcEndpoint(JSON.parse(raw) as unknown, endpointFilePath);
}
