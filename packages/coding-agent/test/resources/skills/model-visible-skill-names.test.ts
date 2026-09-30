import { describe, expect, it } from "vitest";
import { createModelVisibleSkillNames } from "../../../src/resources/skills/model-visible-skill-names.js";

describe("model-visible skill names", () => {
	it("removes product names without changing internal skill identifiers", () => {
		const names = createModelVisibleSkillNames([
			{ name: "vetta-ui-design" },
			{ name: "remotion-video" },
			{ name: "metoai-assistant" },
		]);

		expect(names.get("vetta-ui-design")).toBe("application-ui-design");
		expect(names.get("remotion-video")).toBe("remotion-video");
		expect(names.get("metoai-assistant")).toBe("application-assistant");
	});

	it("adds stable suffixes when neutralization causes a collision", () => {
		const names = createModelVisibleSkillNames([{ name: "vetta-design" }, { name: "application-design" }]);

		expect(names.get("vetta-design")).toBe("application-design");
		expect(names.get("application-design")).toBe("application-design-2");
	});
});
