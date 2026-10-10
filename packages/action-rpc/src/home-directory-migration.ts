import { existsSync, renameSync } from "node:fs";

export interface HomeDirectoryMigrationOptions {
	/** 新品牌主目录，也是迁移目标与后续写入落点。 */
	readonly home: string;
	/** 品牌改名前的旧主目录。 */
	readonly legacyHome: string;
	/** 便于测试注入；缺省用 `node:fs`。 */
	readonly exists?: (path: string) => boolean;
	readonly rename?: (from: string, to: string) => void;
	readonly warn?: (message: string, error: unknown) => void;
}

function safeExists(exists: (path: string) => boolean, path: string): boolean {
	try {
		return exists(path);
	} catch {
		return false;
	}
}

function defaultWarn(message: string, error: unknown): void {
	console.warn(`[vetta-home-migration] ${message}`, error);
}

/**
 * 把品牌改名前的用户主目录整体重命名到新目录，并返回最终可用的主目录。
 *
 * 语义（幂等、并发安全、绝不抛错）：
 * - 新目录已存在（含另一个进程刚迁移完）→ 直接用新目录，不碰旧目录。
 * - 只有旧目录存在 → 尝试 `rename`；成功用新目录。
 * - `rename` 失败（跨盘、被占用、权限）→ 回退返回旧目录，让应用照常启动，数据留在原处。
 * - 两个都不存在 → 返回新目录，由调用方照旧 mkdir。
 */
export function migrateLegacyHomeDirectory(options: HomeDirectoryMigrationOptions): string {
	const exists = options.exists ?? existsSync;
	const rename = options.rename ?? ((from: string, to: string) => renameSync(from, to));
	const warn = options.warn ?? defaultWarn;
	const { home, legacyHome } = options;
	if (home === legacyHome) return home;
	if (safeExists(exists, home)) return home;
	if (!safeExists(exists, legacyHome)) return home;
	try {
		rename(legacyHome, home);
		return home;
	} catch (error) {
		// 并发下另一个进程可能刚完成迁移：先确认新目录，避免把成功的迁移判成失败。
		if (safeExists(exists, home)) return home;
		warn(`failed to migrate ${legacyHome} to ${home}; continuing with ${legacyHome}`, error);
		return legacyHome;
	}
}
