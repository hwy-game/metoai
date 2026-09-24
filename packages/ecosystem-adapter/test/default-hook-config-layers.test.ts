import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { discoverClaudeHookHandlers, isClaudeOwnedSource } from "../src/claude-code/hooks/config.js";
import { CLAUDE_CODE_HOOK_PROFILE_ID } from "../src/claude-code/hooks/profile.js";
import { discoverCodexHookHandlers, isCodexOwnedSource } from "../src/codex/hooks/config.js";
import { LATEST_CODEX_HOOK_PROFILE_ID } from "../src/codex/hooks/latest/profile.js";
import { buildDefaultHookConfigLayers } from "../src/default-hook-config-layers.js";

const tempDirs: string[] = [];

afterEach(async () => {
	for (const dir of tempDirs.splice(0)) {
		try {
			const { rm } = await import("node:fs/promises");
			await rm(dir, { recursive: true, force: true });
		} catch {
			// ignore
		}
	}
});

async function makeTempDir(prefix: string): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), prefix));
	tempDirs.push(dir);
	return dir;
}

function sessionStartHooks(command: string): string {
	return JSON.stringify({
		hooks: {
			SessionStart: [
				{
					hooks: [{ type: "command", command }],
				},
			],
		},
	});
}

/** Claude settings.json may carry other keys; hooks stay under "hooks". */
function claudeSettingsWithHooks(command: string): string {
	return JSON.stringify({
		permissions: { allow: ["Bash(*)"] },
		hooks: {
			SessionStart: [
				{
					hooks: [{ type: "command", command }],
				},
			],
		},
	});
}

describe("buildDefaultHookConfigLayers", () => {
	it("includes only Vetta-nested .codex/.claude paths with profile ownership", () => {
		const home = "C:/fake-home";
		const cwd = "C:/projects/demo";
		const layers = buildDefaultHookConfigLayers({
			cwd,
			homeDir: home,
			env: {},
		});

		const paths = layers.flatMap((layer) => (layer.sources ?? []).map((s) => s.path.replace(/\\/g, "/")));
		expect(paths).toEqual([
			"C:/fake-home/.metoai/.codex/hooks.json",
			"C:/fake-home/.metoai/.claude/settings.json",
			"C:/projects/demo/.metoai/.codex/hooks.json",
			"C:/projects/demo/.metoai/.claude/settings.json",
			"C:/projects/demo/.metoai/.claude/settings.local.json",
		]);

		const byProfile = layers.flatMap((layer) =>
			(layer.sources ?? []).map((s) => ({ path: s.path.replace(/\\/g, "/"), profileId: s.profileId })),
		);
		expect(
			byProfile
				.filter((s) => s.path.includes("/.codex/"))
				.every((s) => s.profileId === LATEST_CODEX_HOOK_PROFILE_ID),
		).toBe(true);
		expect(
			byProfile
				.filter((s) => s.path.includes("/.claude/"))
				.every((s) => s.profileId === CLAUDE_CODE_HOOK_PROFILE_ID),
		).toBe(true);

		// Never top-level official homes
		expect(paths.some((p) => p.includes("/fake-home/.codex/") && !p.includes("/.metoai/"))).toBe(false);
		expect(paths.some((p) => p.includes("/fake-home/.claude/") && !p.includes("/.metoai/"))).toBe(false);
		expect(paths.some((p) => p.includes("/demo/.codex/") && !p.includes("/.metoai/"))).toBe(false);
		expect(paths.some((p) => p.includes("/demo/.claude/") && !p.includes("/.metoai/"))).toBe(false);
	});

	it("honors explicit vettaHome", () => {
		const layers = buildDefaultHookConfigLayers({
			cwd: "/p",
			vettaHome: "/custom/vetta",
			env: {},
		});
		const paths = layers.flatMap((l) => (l.sources ?? []).map((s) => s.path.replace(/\\/g, "/")));
		expect(paths).toContain("/custom/vetta/.codex/hooks.json");
		expect(paths).toContain("/custom/vetta/.claude/settings.json");
		expect(paths).not.toContain("/home/u/.metoai/.codex/hooks.json");
	});
});

describe("source ownership filters", () => {
	it("classifies .codex/.claude paths with or without .vetta nesting", () => {
		expect(isCodexOwnedSource({ path: "/home/u/.vetta/.codex/hooks.json" })).toBe(true);
		expect(isCodexOwnedSource({ path: "/repo/.vetta/.codex/hooks.json" })).toBe(true);
		expect(isCodexOwnedSource({ path: "/home/u/.codex/hooks.json" })).toBe(true);
		expect(isCodexOwnedSource({ path: "/repo/.codex/hooks.json" })).toBe(true);
		expect(isCodexOwnedSource({ path: "/repo/.vetta/hooks.json" })).toBe(false);
		expect(isCodexOwnedSource({ path: "/home/u/.vetta/.claude/settings.json" })).toBe(false);
		expect(isCodexOwnedSource({ path: "/plugin/hooks/hooks.json" })).toBe(false);

		expect(isClaudeOwnedSource({ path: "/home/u/.vetta/.claude/settings.json" })).toBe(true);
		expect(isClaudeOwnedSource({ path: "/repo/.vetta/.claude/settings.local.json" })).toBe(true);
		expect(isClaudeOwnedSource({ path: "/home/u/.claude/settings.json" })).toBe(true);
		expect(isClaudeOwnedSource({ path: "/repo/.claude/settings.local.json" })).toBe(true);
		expect(isClaudeOwnedSource({ path: "/repo/.vetta/claude-hooks.json" })).toBe(false);
		expect(isClaudeOwnedSource({ path: "/home/u/.vetta/.codex/hooks.json" })).toBe(false);
	});
});

describe("vetta-nested path discovery", () => {
	it("loads Codex handlers from the vetta home and the legacy project dir, ignores top-level official + Claude", async () => {
		const home = await makeTempDir("vetta-codex-home-");
		const project = await makeTempDir("vetta-codex-proj-");
		// 用户层是品牌改名后的主目录；项目层故意只用旧目录，覆盖读取回退。
		const vettaHome = join(home, ".metoai");

		await mkdir(join(vettaHome, ".codex"), { recursive: true });
		await mkdir(join(project, ".vetta", ".codex"), { recursive: true });
		// Top-level official + Claude must be ignored by default layers
		await mkdir(join(home, ".codex"), { recursive: true });
		await mkdir(join(project, ".codex"), { recursive: true });
		await mkdir(join(project, ".vetta", ".claude"), { recursive: true });

		await writeFile(join(vettaHome, ".codex", "hooks.json"), sessionStartHooks("echo codex-user"), "utf8");
		await writeFile(join(project, ".vetta", ".codex", "hooks.json"), sessionStartHooks("echo codex-project"), "utf8");
		await writeFile(join(home, ".codex", "hooks.json"), sessionStartHooks("echo official-user"), "utf8");
		await writeFile(join(project, ".codex", "hooks.json"), sessionStartHooks("echo official-project"), "utf8");
		await writeFile(
			join(project, ".vetta", ".claude", "settings.json"),
			claudeSettingsWithHooks("echo claude-only"),
			"utf8",
		);

		const layers = buildDefaultHookConfigLayers({
			cwd: project,
			homeDir: home,
			env: {},
		});
		const result = await discoverCodexHookHandlers(layers);
		expect(result.diagnostics).toEqual([]);
		expect(result.handlers.map((h) => h.command)).toEqual(["echo codex-user", "echo codex-project"]);
	});

	it("loads Claude handlers from the legacy project dir including extra keys", async () => {
		const home = await makeTempDir("vetta-claude-home-");
		const project = await makeTempDir("vetta-claude-proj-");
		const vettaHome = join(home, ".metoai");

		await mkdir(join(vettaHome, ".claude"), { recursive: true });
		await mkdir(join(project, ".vetta", ".claude"), { recursive: true });
		await mkdir(join(home, ".claude"), { recursive: true });
		await mkdir(join(project, ".claude"), { recursive: true });
		await mkdir(join(project, ".vetta", ".codex"), { recursive: true });

		await writeFile(join(vettaHome, ".claude", "settings.json"), claudeSettingsWithHooks("echo claude-user"), "utf8");
		await writeFile(
			join(project, ".vetta", ".claude", "settings.json"),
			claudeSettingsWithHooks("echo claude-project"),
			"utf8",
		);
		await writeFile(
			join(project, ".vetta", ".claude", "settings.local.json"),
			claudeSettingsWithHooks("echo claude-local"),
			"utf8",
		);
		await writeFile(join(home, ".claude", "settings.json"), claudeSettingsWithHooks("echo official-user"), "utf8");
		await writeFile(
			join(project, ".claude", "settings.json"),
			claudeSettingsWithHooks("echo official-project"),
			"utf8",
		);
		await writeFile(join(project, ".vetta", ".codex", "hooks.json"), sessionStartHooks("echo codex-only"), "utf8");

		const layers = buildDefaultHookConfigLayers({
			cwd: project,
			homeDir: home,
			env: {},
		});
		const result = await discoverClaudeHookHandlers(layers, { projectDir: project });
		expect(result.diagnostics).toEqual([]);
		expect(result.handlers.map((h) => h.command)).toEqual([
			"echo claude-user",
			"echo claude-project",
			"echo claude-local",
		]);
	});

	it("项目 hooks 首选新目录，只有旧目录时仍然读得到且不会跑两遍", async () => {
		const home = await makeTempDir("metoai-hooks-home-");
		const project = await makeTempDir("metoai-hooks-proj-");
		await mkdir(join(home, ".metoai", ".codex"), { recursive: true });
		await mkdir(join(project, ".vetta", ".codex"), { recursive: true });
		await writeFile(join(home, ".metoai", ".codex", "hooks.json"), sessionStartHooks("echo codex-user"), "utf8");
		await writeFile(
			join(project, ".vetta", ".codex", "hooks.json"),
			sessionStartHooks("echo legacy-project"),
			"utf8",
		);

		// 品牌改名不该让用户已有的项目 hooks 静默失效。
		const legacyOnly = await discoverCodexHookHandlers(
			buildDefaultHookConfigLayers({ cwd: project, homeDir: home, env: {} }),
		);
		expect(legacyOnly.diagnostics).toEqual([]);
		expect(legacyOnly.handlers.map((h) => h.command)).toEqual(["echo codex-user", "echo legacy-project"]);

		await mkdir(join(project, ".metoai", ".codex"), { recursive: true });
		await writeFile(join(project, ".metoai", ".codex", "hooks.json"), sessionStartHooks("echo new-project"), "utf8");

		// 新文件出现后旧目录必须让位：两处都读会让同一个 hook 跑两遍。
		const bothPresent = await discoverCodexHookHandlers(
			buildDefaultHookConfigLayers({ cwd: project, homeDir: home, env: {} }),
		);
		expect(bothPresent.handlers.map((h) => h.command)).toEqual(["echo codex-user", "echo new-project"]);
	});
});
