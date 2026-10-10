import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import lockfile from "proper-lockfile";

/**
 * File-backed text storage keyed by a caller-owned scope type.
 *
 * `legacyReadPaths` 是品牌改名等迁移期的读取回退：主路径不存在时才读旧路径，
 * 写入永远落主路径。用户仓库里已经存在的旧文件因此保持可读，也不会被就地改写。
 */
export class NodeScopedTextStorage<Scope extends string> {
	constructor(
		private readonly paths: Readonly<Record<Scope, string>>,
		private readonly legacyReadPaths?: Readonly<Partial<Record<Scope, string>>>,
	) {}

	withLock(scope: Scope, operation: (current: string | undefined) => string | undefined): void {
		const path = this.paths[scope];
		const directory = dirname(path);
		const legacyPath = this.legacyReadPaths?.[scope];
		const primaryExists = existsSync(path);
		const readPath = primaryExists ? path : legacyPath && existsSync(legacyPath) ? legacyPath : undefined;
		let release: (() => void) | undefined;
		try {
			// 只锁主路径：读取回退不碰旧目录，连锁文件也不在用户仓库里创建。
			if (primaryExists) release = lockfile.lockSync(path, { realpath: false });
			const current = readPath ? readFileSync(readPath, "utf-8") : undefined;
			const next = operation(current);
			if (next === undefined) return;
			if (!existsSync(directory)) mkdirSync(directory, { recursive: true });
			if (!release) release = lockfile.lockSync(path, { realpath: false });
			writeFileSync(path, next, "utf-8");
		} finally {
			release?.();
		}
	}
}
