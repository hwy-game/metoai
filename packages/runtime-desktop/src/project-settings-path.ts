import { createHash } from "node:crypto";
import { join } from "node:path";
import { CONFIG_DIR_NAME, LEGACY_CONFIG_DIR_NAME } from "@vetta/coding-agent/config";
import { isSshProjectUri, normalizeProjectCwd } from "@vetta/ssh-transport";

/**
 * 项目级 settings.json 的落点：写入落点，也是读取首选。
 *
 * 本地项目放在项目自己的 `.metoai/` 下。远程项目放在本机 agent 目录下按项目 URI 分片的
 * 影子目录里：设置存储是同步读写加文件锁，做不到跨网络；而直接 `join(cwd, …)` 会把 URI
 * 拼成相对路径 `ssh:/host/…`，一次写入就在进程 cwd 下建出一棵 `ssh:` 目录。
 *
 * 取舍：远端仓库里签入的 `.metoai/settings.json` 不会被读取，远程项目的项目级设置只存在
 * 于这台机器上。
 */
export function resolveProjectSettingsPath(cwd: string, agentDir: string): string {
	if (!isSshProjectUri(cwd)) return join(cwd, CONFIG_DIR_NAME, "settings.json");
	const key = createHash("sha256")
		.update(normalizeProjectCwd(cwd, (value) => value))
		.digest("hex")
		.slice(0, 24);
	return join(agentDir, "remote-projects", key, "settings.json");
}

/**
 * 品牌改名前的项目级设置路径，只用于读取回退（见 {@link resolveProjectSettingsPath}）。
 *
 * 不回退远程项目：它的旧落点与项目 URI 无关，历史上也只存在于本机影子目录，没有需要兼容的旧文件。
 * 这里也绝不重命名或删除项目里的 `.vetta/`——写入仍然只落 `.metoai/`。
 */
export function resolveLegacyProjectSettingsPath(cwd: string): string | undefined {
	if (isSshProjectUri(cwd)) return undefined;
	return join(cwd, LEGACY_CONFIG_DIR_NAME, "settings.json");
}
