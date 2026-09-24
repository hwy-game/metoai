import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { CLAUDE_CODE_HOOK_PROFILE_ID } from "./claude-code/hooks/profile.js";
import { LATEST_CODEX_HOOK_PROFILE_ID } from "./codex/hooks/latest/profile.js";
import type { HookConfigLayer, HookConfigSource } from "./hooks/types.js";

/** 项目 / 用户配置目录名（品牌默认）。 */
export const VETTA_HOOK_CONFIG_DIR_NAME = ".metoai";
/** 品牌改名前的配置目录名；只用于读取回退，见 {@link buildDefaultHookConfigLayers}。 */
export const LEGACY_VETTA_HOOK_CONFIG_DIR_NAME = ".vetta";

export interface BuildDefaultHookConfigLayersOptions {
	/** Session project working directory. */
	cwd: string;
	/**
	 * Vetta user data root.
	 * Default: `~/.metoai` (HOME / USERPROFILE / os.homedir()).
	 * Coding Agent should pass `getVettaHomePath()` so `VETTA_HOME` applies.
	 */
	vettaHome?: string;
	/**
	 * Project config directory name under cwd. Default: `.metoai`.
	 * Override only for tests or non-standard layouts; 显式覆盖时不启用旧目录回退。
	 */
	configDirName?: string;
	/**
	 * Override home directory (tests). Default: HOME / USERPROFILE / os.homedir().
	 * Used only when `vettaHome` is omitted.
	 */
	homeDir?: string;
	/** Environment for HOME resolution. Default process.env. */
	env?: NodeJS.ProcessEnv;
}

/**
 * Build host config layers for ecosystem hook discovery under Vetta paths only.
 *
 * Mirrors official Codex/Claude directory layout **inside** Vetta roots:
 *
 * 1. User:
 *    - `<vettaHome>/.codex/hooks.json`
 *    - `<vettaHome>/.claude/settings.json`
 * 2. Project:
 *    - `<cwd>/.metoai/.codex/hooks.json`
 *    - `<cwd>/.metoai/.claude/settings.json`
 *    - `<cwd>/.metoai/.claude/settings.local.json`
 *
 * 项目层对品牌改名前的 `<cwd>/.vetta/...` 做读取回退：只在对应的新文件不存在时才把它当来源，
 * 和设置类存储同一条规则（见 NodeScopedTextStorage）。两处都读会让同一个 hook 跑两遍。
 *
 * Does **not** read top-level official homes (`~/.codex`, `~/.claude`, project
 * `.codex` / `.claude` at cwd root). Hosts that need those must pass explicit layers.
 *
 * Each source carries `profileId` so Codex and Claude adapters never claim each other's files.
 * Missing files are ignored at discovery time (ENOENT).
 *
 * File formats match the original ecosystems (Codex `hooks.json`; Claude settings with `"hooks"`).
 */
export function buildDefaultHookConfigLayers(options: BuildDefaultHookConfigLayersOptions): HookConfigLayer[] {
	const env = options.env ?? process.env;
	const homeDir = options.homeDir ?? resolveHomeDir(env);
	const vettaHome = options.vettaHome ?? join(homeDir, VETTA_HOOK_CONFIG_DIR_NAME);
	const configDirName = options.configDirName ?? VETTA_HOOK_CONFIG_DIR_NAME;
	const projectVettaDir = join(options.cwd, configDirName);
	const legacyProjectVettaDir =
		options.configDirName === undefined ? join(options.cwd, LEGACY_VETTA_HOOK_CONFIG_DIR_NAME) : undefined;

	const userCodexDir = join(vettaHome, ".codex");
	const userClaudeDir = join(vettaHome, ".claude");
	const projectCodexDir = join(projectVettaDir, ".codex");
	const projectClaudeDir = join(projectVettaDir, ".claude");

	return [
		{
			directory: userCodexDir,
			enabled: true,
			label: "vetta-user-codex",
			sources: [codexSource(join(userCodexDir, "hooks.json"))],
		},
		{
			directory: userClaudeDir,
			enabled: true,
			label: "vetta-user-claude",
			sources: [claudeSource(join(userClaudeDir, "settings.json"))],
		},
		{
			directory: projectCodexDir,
			enabled: true,
			label: "vetta-project-codex",
			sources: projectSources(projectVettaDir, legacyProjectVettaDir, ".codex", ["hooks.json"], codexSource),
		},
		{
			directory: projectClaudeDir,
			enabled: true,
			label: "vetta-project-claude",
			sources: projectSources(
				projectVettaDir,
				legacyProjectVettaDir,
				".claude",
				["settings.json", "settings.local.json"],
				claudeSource,
			),
		},
	];
}

/**
 * 项目层来源：首选新目录下的文件，旧目录只在对应的新文件不存在时顶上。
 * 存在性判断针对文件本身而不是目录——新目录常常只因写入项目设置就存在了，
 * 那时把旧 hooks 整组丢掉仍然是个回归。
 */
function projectSources(
	projectDir: string,
	legacyProjectDir: string | undefined,
	subDirectory: string,
	fileNames: readonly string[],
	makeSource: (path: string) => HookConfigSource,
): HookConfigSource[] {
	return fileNames.map((fileName) => {
		const primary = join(projectDir, subDirectory, fileName);
		if (existsSync(primary) || legacyProjectDir === undefined) return makeSource(primary);
		const legacy = join(legacyProjectDir, subDirectory, fileName);
		return makeSource(existsSync(legacy) ? legacy : primary);
	});
}

function codexSource(path: string): HookConfigSource {
	return { path, profileId: LATEST_CODEX_HOOK_PROFILE_ID };
}

function claudeSource(path: string): HookConfigSource {
	return { path, profileId: CLAUDE_CODE_HOOK_PROFILE_ID };
}

function resolveHomeDir(env: NodeJS.ProcessEnv): string {
	const fromEnv = env.HOME || env.USERPROFILE;
	if (fromEnv && fromEnv.length > 0) return fromEnv;
	return homedir();
}
