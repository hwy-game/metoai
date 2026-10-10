/**
 * 宿主数据根的判定规则（品牌改名后为 `~/.metoai`）。
 *
 * 插件必须在目标机器上算出与宿主同一个目录，而且**绝不能抢先创建新目录**——宿主下次
 * 启动看到新目录已存在就会判定迁移完成，用户主目录里的数据会整份看起来丢失。所以这里
 * 用真实 node 跑那段脚本（生产里也是 `ctx.command.run` 起子进程），只把 HOME/USERPROFILE
 * 指到临时目录：`os.homedir()` 在 Windows 看 USERPROFILE，在 POSIX 看 HOME。
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	HOST_CONFIG_DIR_NAME,
	LEGACY_HOST_CONFIG_DIR_NAME,
	RESOLVE_HOST_DATA_ROOT_SCRIPT,
} from "../src/shared/host-data-root";

const temporaryDirectories: string[] = [];

afterEach(async () => {
	await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function temporaryHome(): Promise<string> {
	const home = await mkdtemp(join(tmpdir(), "vetd-data-root-"));
	temporaryDirectories.push(home);
	return home;
}

function resolveDataRoot(home: string): string {
	const result = spawnSync(process.execPath, ["-e", RESOLVE_HOST_DATA_ROOT_SCRIPT], {
		encoding: "utf8",
		env: { ...process.env, HOME: home, USERPROFILE: home },
	});
	if (result.status !== 0) throw new Error(`resolve script failed: ${result.stderr}`);
	return result.stdout.trim();
}

describe("宿主数据根", () => {
	it("宿主已迁移完时用新目录", async () => {
		const home = await temporaryHome();
		await mkdir(join(home, HOST_CONFIG_DIR_NAME), { recursive: true });

		expect(resolveDataRoot(home)).toBe(join(home, HOST_CONFIG_DIR_NAME));
	});

	it("只剩旧目录时跟着宿主用旧目录，且不抢先创建新目录", async () => {
		const home = await temporaryHome();
		await mkdir(join(home, LEGACY_HOST_CONFIG_DIR_NAME), { recursive: true });

		expect(resolveDataRoot(home)).toBe(join(home, LEGACY_HOST_CONFIG_DIR_NAME));
		expect(existsSync(join(home, HOST_CONFIG_DIR_NAME))).toBe(false);
	});

	it("两个目录都不存在时用新目录", async () => {
		const home = await temporaryHome();

		expect(resolveDataRoot(home)).toBe(join(home, HOST_CONFIG_DIR_NAME));
		expect(existsSync(join(home, LEGACY_HOST_CONFIG_DIR_NAME))).toBe(false);
	});
});
