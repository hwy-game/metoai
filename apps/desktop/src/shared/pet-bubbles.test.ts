import { describe, expect, it } from "vitest";
import {
	DEFAULT_PET_BUBBLE_STYLE_ID,
	normalizePetBubbleStyleId,
	PET_BUBBLE_STYLES,
	VISIBLE_PET_BUBBLE_STYLES,
} from "./pet-bubbles";

describe("桌宠气泡样式开放范围", () => {
	it("设置页只开放普通气泡，其余样式仍留在目录里", () => {
		expect(VISIBLE_PET_BUBBLE_STYLES.map((style) => style.id)).toEqual([DEFAULT_PET_BUBBLE_STYLE_ID]);
		expect(PET_BUBBLE_STYLES.length).toBeGreaterThan(VISIBLE_PET_BUBBLE_STYLES.length);
	});

	it("存量配置里被隐藏的样式归一到普通气泡", () => {
		expect(normalizePetBubbleStyleId("stoat_christmas_corner_border_set")).toBe(DEFAULT_PET_BUBBLE_STYLE_ID);
		expect(normalizePetBubbleStyleId("christmas")).toBe(DEFAULT_PET_BUBBLE_STYLE_ID);
		expect(normalizePetBubbleStyleId("not-a-style")).toBe(DEFAULT_PET_BUBBLE_STYLE_ID);
		expect(normalizePetBubbleStyleId(undefined)).toBe(DEFAULT_PET_BUBBLE_STYLE_ID);
		expect(normalizePetBubbleStyleId("plain")).toBe("plain");
	});
});
