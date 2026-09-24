import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { migrateLegacyHomeDirectory } from "../src/home-directory-migration.js";
import {
	DEFAULT_CONFIG_DIR_NAME,
	getVettaConfigDirName,
	getVettaHomePath,
	LEGACY_CONFIG_DIR_NAME,
	resetVettaHomePathCache,
	VETTA_CONFIG_DIR_ENV,
	VETTA_HOME_ENV,
} from "../src/index.js";

const state = vi.hoisted(() => ({ home: "" }));

vi.mock("node:os", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:os")>();
	return { ...actual, homedir: () => state.home };
});

const temporaryDirectories: string[] = [];

afterEach(() => {
	vi.unstubAllEnvs();
	resetVettaHomePathCache();
	for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function createRoot(): string {
	const directory = mkdtempSync(join(tmpdir(), "vetta-home-migration-"));
	temporaryDirectories.push(directory);
	return directory;
}

describe("旧主目录迁移", () => {
	it("新目录已存在时不动任何一边", () => {
		const root = createRoot();
		const home = join(root, ".metoai");
		const legacyHome = join(root, ".vetta");
		mkdirSync(home);
		mkdirSync(legacyHome);
		writeFileSync(join(home, "marker"), "new", "utf8");
		writeFileSync(join(legacyHome, "marker"), "old", "utf8");

		expect(migrateLegacyHomeDirectory({ home, legacyHome })).toBe(home);
		expect(readFileSync(join(home, "marker"), "utf8")).toBe("new");
		expect(readFileSync(join(legacyHome, "marker"), "utf8")).toBe("old");
	});

	it("只有旧目录时整体重命名到新目录", () => {
		const root = createRoot();
		const home = join(root, ".metoai");
		const legacyHome = join(root, ".vetta");
		mkdirSync(join(legacyHome, "agent"), { recursive: true });
		writeFileSync(join(legacyHome, "agent", "settings.json"), "{}", "utf8");

		expect(migrateLegacyHomeDirectory({ home, legacyHome })).toBe(home);
		expect(existsSync(legacyHome)).toBe(false);
		expect(readFileSync(join(home, "agent", "settings.json"), "utf8")).toBe("{}");
	});

	it("两个目录都不存在时用新目录，也不提前建目录", () => {
		const root = createRoot();
		const home = join(root, ".metoai");

		expect(migrateLegacyHomeDirectory({ home, legacyHome: join(root, ".vetta") })).toBe(home);
		expect(existsSync(home)).toBe(false);
	});

	it("重命名失败时回退到旧目录、告警，且不抛错也不丢数据", () => {
		const root = createRoot();
		const home = join(root, ".metoai");
		const legacyHome = join(root, ".vetta");
		mkdirSync(legacyHome);
		writeFileSync(join(legacyHome, "marker"), "old", "utf8");
		const warn = vi.fn();

		const result = migrateLegacyHomeDirectory({
			home,
			legacyHome,
			rename: () => {
				throw new Error("EPERM: operation not permitted");
			},
			warn,
		});

		expect(result).toBe(legacyHome);
		expect(warn).toHaveBeenCalledOnce();
		expect(existsSync(home)).toBe(false);
		expect(readFileSync(join(legacyHome, "marker"), "utf8")).toBe("old");
	});

	it("并发下另一个进程刚迁移完时采用新目录而不是回退", () => {
		const root = createRoot();
		const home = join(root, ".metoai");
		const legacyHome = join(root, ".vetta");
		mkdirSync(legacyHome);
		const warn = vi.fn();

		const result = migrateLegacyHomeDirectory({
			home,
			legacyHome,
			rename: () => {
				// 模拟另一个进程在同一时刻完成了迁移。
				mkdirSync(home);
				throw new Error("ENOTEMPTY");
			},
			warn,
		});

		expect(result).toBe(home);
		expect(warn).not.toHaveBeenCalled();
	});

	it("重复调用幂等", () => {
		const root = createRoot();
		const home = join(root, ".metoai");
		const legacyHome = join(root, ".vetta");
		mkdirSync(legacyHome);

		expect(migrateLegacyHomeDirectory({ home, legacyHome })).toBe(home);
		expect(migrateLegacyHomeDirectory({ home, legacyHome })).toBe(home);
		expect(existsSync(legacyHome)).toBe(false);
	});
});

describe("主目录解析", () => {
	it("默认目录名改成 .metoai，旧名保留为常量", () => {
		expect(DEFAULT_CONFIG_DIR_NAME).toBe(".metoai");
		expect(LEGACY_CONFIG_DIR_NAME).toBe(".vetta");
		expect(getVettaConfigDirName()).toBe(".metoai");
	});

	it("VETTA_CONFIG_DIR 仍然只覆盖主目录名", () => {
		vi.stubEnv(VETTA_CONFIG_DIR_ENV, ".metoai-dev");
		expect(getVettaConfigDirName()).toBe(".metoai-dev");
	});

	it("首次解析时把 ~/.vetta 整体重命名到 ~/.metoai", () => {
		const root = createRoot();
		state.home = root;
		vi.stubEnv(VETTA_HOME_ENV, "");
		mkdirSync(join(root, ".vetta", "agent"), { recursive: true });
		writeFileSync(join(root, ".vetta", "agent", "settings.json"), "{}", "utf8");
		resetVettaHomePathCache();

		expect(getVettaHomePath()).toBe(join(root, ".metoai"));
		expect(existsSync(join(root, ".vetta"))).toBe(false);
		expect(readFileSync(join(root, ".metoai", "agent", "settings.json"), "utf8")).toBe("{}");
	});

	it("两个目录都不存在时解析到新目录，且不提前建目录", () => {
		const root = createRoot();
		state.home = root;
		vi.stubEnv(VETTA_HOME_ENV, "");
		resetVettaHomePathCache();

		expect(getVettaHomePath()).toBe(join(root, ".metoai"));
		expect(existsSync(join(root, ".metoai"))).toBe(false);
	});

	it("VETTA_HOME 仍然优先于目录名解析", () => {
		vi.stubEnv(VETTA_HOME_ENV, "~/custom-home");
		expect(getVettaHomePath()).toBe(join(state.home, "custom-home"));
	});
});
