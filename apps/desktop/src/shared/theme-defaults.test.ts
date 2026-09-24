import { describe, expect, it } from "vitest";
import { DEFAULT_RESOLVED_MODE, DEFAULT_THEME_MODE, WINDOW_SURFACE_COLORS } from "./theme-defaults.js";

describe("主题默认值", () => {
	it("首启默认浅色", () => {
		expect(DEFAULT_THEME_MODE).toBe("light");
		expect(DEFAULT_RESOLVED_MODE).toBe("light");
	});

	it("默认明暗对应的窗口底色是浅色，与深色底不同", () => {
		expect(WINDOW_SURFACE_COLORS[DEFAULT_RESOLVED_MODE]).toBe("#f5f5f7");
		expect(WINDOW_SURFACE_COLORS.light).not.toBe(WINDOW_SURFACE_COLORS.dark);
	});
});
