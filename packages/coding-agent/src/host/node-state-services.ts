import { join } from "node:path";
import { NodeScopedTextStorage } from "@vetta/runtime-node/host";
import { SettingsRuntime } from "../settings/index.js";
import { getAgentDir, resolveProjectConfigDir } from "./node-config.js";

/** Compatibility adapter for Coding Agent entry points that still provide a Node host. */
export function createCodingAgentNodeSettingsRuntime(cwd = process.cwd(), agentDir = getAgentDir()): SettingsRuntime {
	const projectConfigDir = resolveProjectConfigDir(cwd);
	return SettingsRuntime.fromStorage(
		new NodeScopedTextStorage(
			{
				global: join(agentDir, "settings.json"),
				project: join(projectConfigDir.dir, "settings.json"),
			},
			{ project: join(projectConfigDir.legacyDir, "settings.json") },
		),
		{
			clearOnShrink: process.env.PI_CLEAR_ON_SHRINK === "1",
			showHardwareCursor: process.env.PI_HARDWARE_CURSOR === "1",
		},
	);
}
