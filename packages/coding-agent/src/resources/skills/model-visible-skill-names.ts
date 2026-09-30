import type { Skill } from "./contracts.js";

/** Produces stable, collision-free labels for prompts while keeping resource ids internal. */
export function createModelVisibleSkillNames(
	skills: readonly Pick<Skill, "name" | "alias">[],
): ReadonlyMap<string, string> {
	const names = new Map<string, string>();
	const used = new Set<string>();

	for (const skill of skills) {
		const base = removeProductNames(skill.alias ?? skill.name) || "skill";
		let visibleName = base;
		let suffix = 2;
		while (used.has(visibleName)) visibleName = `${base}-${suffix++}`;
		used.add(visibleName);
		names.set(skill.name, visibleName);
	}

	return names;
}

function removeProductNames(value: string): string {
	return value
		.replace(/meto[\s_-]*ai/gi, "application")
		.replace(/vetta/gi, "application")
		.replace(/[\s_]+/g, "-")
		.replace(/-+/g, "-")
		.replace(/^-|-$/g, "");
}
