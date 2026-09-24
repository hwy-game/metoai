import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { SettingsRuntime } from "@vetta/coding-agent/settings";
import { NodeScopedTextStorage } from "@vetta/runtime-node/host";
import { afterEach, describe, expect, it } from "vitest";
import { resolveLegacyProjectSettingsPath, resolveProjectSettingsPath } from "./project-settings-path.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
	for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function createProject(): string {
	const directory = mkdtempSync(join(tmpdir(), "project-settings-"));
	temporaryDirectories.push(directory);
	return directory;
}

/** 与 Desktop/CLI 相同的装配：写入落 `.metoai`，读取回退 `.vetta`。 */
function createSettingsRuntime(cwd: string, agentDir: string): SettingsRuntime {
	return SettingsRuntime.fromStorage(
		new NodeScopedTextStorage(
			{
				global: join(agentDir, "settings.json"),
				project: resolveProjectSettingsPath(cwd, agentDir),
			},
			{ project: resolveLegacyProjectSettingsPath(cwd) },
		),
	);
}

function writeProjectSettings(cwd: string, dirName: string, value: unknown): string {
	const path = join(cwd, dirName, "settings.json");
	mkdirSync(join(cwd, dirName), { recursive: true });
	writeFileSync(path, JSON.stringify(value), "utf8");
	return path;
}

describe("项目级设置的落点", () => {
	it("本地项目写在项目自己的 .metoai 下", () => {
		expect(resolveProjectSettingsPath("/work/app", "/home/me/.metoai/agent")).toBe(
			join("/work/app", ".metoai", "settings.json"),
		);
	});

	it("远程项目落在本机 agent 目录里，不会在进程 cwd 下拼出一棵 ssh: 目录", () => {
		const path = resolveProjectSettingsPath("ssh://h1/srv/app", "/home/me/.metoai/agent");
		expect(isAbsolute(path)).toBe(true);
		expect(path.startsWith(join("/home/me/.metoai/agent", "remote-projects"))).toBe(true);
		expect(path).not.toContain("ssh:");
	});

	it("同一个远程项目写法不同也落到同一份，不同项目互不相干", () => {
		const agentDir = "/home/me/.metoai/agent";
		expect(resolveProjectSettingsPath("ssh://h1/srv/app/", agentDir)).toBe(
			resolveProjectSettingsPath("ssh://h1/srv//app", agentDir),
		);
		expect(resolveProjectSettingsPath("ssh://h1/srv/app", agentDir)).not.toBe(
			resolveProjectSettingsPath("ssh://h2/srv/app", agentDir),
		);
	});

	it("远程项目没有旧目录回退", () => {
		expect(resolveLegacyProjectSettingsPath("ssh://h1/srv/app")).toBeUndefined();
	});
});

describe("项目级设置的读取回退与写入落点", () => {
	it("只有 <项目>/.vetta/settings.json 时仍然读得到", () => {
		const cwd = createProject();
		writeProjectSettings(cwd, ".vetta", { skills: ["!legacy-only"] });

		expect(createSettingsRuntime(cwd, join(cwd, "agent")).getProjectSettings().skills).toEqual(["!legacy-only"]);
	});

	it("两个目录都有时优先 .metoai", () => {
		const cwd = createProject();
		writeProjectSettings(cwd, ".vetta", { skills: ["!legacy"] });
		writeProjectSettings(cwd, ".metoai", { skills: ["!current"] });

		expect(createSettingsRuntime(cwd, join(cwd, "agent")).getProjectSettings().skills).toEqual(["!current"]);
	});

	it("写入落 .metoai，且不改动项目里已有的 .vetta/settings.json", async () => {
		const cwd = createProject();
		const legacyPath = writeProjectSettings(cwd, ".vetta", { skills: ["!legacy"] });
		const legacyBefore = readFileSync(legacyPath, "utf8");
		const runtime = createSettingsRuntime(cwd, join(cwd, "agent"));

		runtime.setProjectSkillPaths(["+written"]);
		await runtime.flush();

		const primaryPath = join(cwd, ".metoai", "settings.json");
		expect(existsSync(primaryPath)).toBe(true);
		expect(JSON.parse(readFileSync(primaryPath, "utf8"))).toMatchObject({ skills: ["+written"] });
		expect(readFileSync(legacyPath, "utf8")).toBe(legacyBefore);
		// 旧目录里只有用户自己的文件：读取回退既不写、也不在那里落锁文件。
		expect(readdirSync(join(cwd, ".vetta"))).toEqual(["settings.json"]);
	});

	it("项目里没有旧目录时不会凭空建出 .vetta", async () => {
		const cwd = createProject();
		const runtime = createSettingsRuntime(cwd, join(cwd, "agent"));

		runtime.setProjectSkillPaths(["+fresh"]);
		await runtime.flush();

		expect(existsSync(join(cwd, ".vetta"))).toBe(false);
		expect(existsSync(join(cwd, ".metoai", "settings.json"))).toBe(true);
	});
});
