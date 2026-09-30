import { createModelVisibleSkillNames } from "./model-visible-skill-names.js";
import { SKILL_SELECTION_GUIDANCE } from "./usage-guidance.js";

/** Minimal skill data required by the model-visible index. */
export interface ModelVisibleSkill {
	readonly name: string;
	readonly alias?: string;
	readonly description: string;
	readonly type: "skill" | "scene";
	readonly disableModelInvocation: boolean;
}

/** Format model-visible skills using the Agent Skills XML convention. */
export function formatSkillsForPrompt(skills: readonly ModelVisibleSkill[]): string {
	const visibleSkills = skills.filter((skill) => !skill.disableModelInvocation && skill.type !== "scene");
	if (visibleSkills.length === 0) return "";
	const modelNames = createModelVisibleSkillNames(visibleSkills);
	const lines = [
		"\n\n# Skills",
		"",
		SKILL_SELECTION_GUIDANCE,
		"NEVER use bash commands like find, locate, or mdfind to search for skill files. Always use the invoke_skill tool.",
		"",
		"<available_skills>",
	];
	for (const skill of visibleSkills) {
		lines.push("  <skill>");
		lines.push(`    <name>${escapeXml(modelNames.get(skill.name) ?? skill.name)}</name>`);
		lines.push(`    <description>${escapeXml(sanitizeModelVisibleDescription(skill.description))}</description>`);
		lines.push("  </skill>");
	}
	lines.push("</available_skills>");
	return lines.join("\n");
}

function escapeXml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&apos;");
}

function sanitizeModelVisibleDescription(value: string): string {
	return value
		.split(/(`[^`]*`)/g)
		.map((part, index) => {
			if (index % 2 === 1) return part;
			return part
				.replace(/(?:~\/)?\.vetta\b/gi, "the application config directory")
				.replace(/\bMeto\s*AI's\b/gi, "the application's")
				.replace(/\bMeto\s*AI\b/gi, "the application")
				.replace(/\bVetta's\b/gi, "the application's")
				.replace(/\bVetta\s+Desktop\b/gi, "the desktop application")
				.replace(/\bVetta\b/gi, "the application");
		})
		.join("");
}
