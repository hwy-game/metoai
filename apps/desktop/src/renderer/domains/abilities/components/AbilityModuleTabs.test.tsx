// @vitest-environment jsdom
import { i18n, initI18n } from "@shared/i18n";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { AbilityModuleCount } from "../types";
import { AbilityModuleTabs } from "./AbilityModuleTabs";

const counts: AbilityModuleCount[] = [
	{ module: "skill", total: 3 },
	{ module: "scene", total: 0 },
	{ module: "mcp", total: 2 },
	{ module: "plugin", total: 1 },
	{ module: "bundle", total: 0 },
];

describe("AbilityModuleTabs", () => {
	it("lists every module with its count and marks the active one", async () => {
		initI18n();
		await i18n.changeLanguage("zh");
		render(<AbilityModuleTabs modules={counts} value="mcp" onChange={() => undefined} />);

		// 五个模块都要在，空模块也占位：tab 不能随数据增删而移位。
		expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
			"技能3",
			"场景0",
			"MCP2",
			"插件1",
			"套装0",
		]);
		expect(screen.getByRole("tab", { selected: true }).textContent).toBe("MCP2");
	});

	it("reports the clicked module and follows the interface language", async () => {
		initI18n();
		await i18n.changeLanguage("en");
		const onChange = vi.fn();
		render(<AbilityModuleTabs modules={counts} value="skill" onChange={onChange} />);

		expect(screen.getByRole("tab", { name: /Bundle/ })).toBeTruthy();
		await userEvent.click(screen.getByRole("tab", { name: /Plugin/ }));
		expect(onChange).toHaveBeenCalledWith("plugin");
		// 受控组件：点击不改自己的选中态，由调用方决定。
		expect(screen.getByRole("tab", { selected: true }).textContent).toBe("Skill3");
	});
});
