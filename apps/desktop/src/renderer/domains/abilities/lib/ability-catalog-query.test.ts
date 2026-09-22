import type { TFunction } from "i18next";
import { describe, expect, it } from "vitest";
import type { AbilityItem, SkillAbility } from "../types";
import { countAbilitiesByModule, pickDefaultModule, queryAbilityCatalog } from "./ability-catalog-query";
import { buildMcpAbilities } from "./build-ability-items";

function ability(index: number, overrides: Partial<SkillAbility> = {}): SkillAbility {
	const slug = `ability-${String(index).padStart(3, "0")}`;
	return {
		id: `skill:${slug}`,
		slug,
		type: "skill",
		catalogSource: { kind: "server", id: "server" },
		title: `Ability ${String(index).padStart(3, "0")}`,
		description: "",
		category: "General",
		tags: [],
		author: "",
		license: "MIT",
		version: "1.0.0",
		installed: false,
		enabled: false,
		readonly: false,
		needsUpdate: false,
		setupRequired: false,
		busy: false,
		downloadCount: 0,
		isCustom: false,
		isBuiltin: false,
		fromMarket: true,
		searchTerms: [slug, `keyword-${index}`],
		...overrides,
	};
}

describe("queryAbilityCatalog", () => {
	it("paginates the in-memory catalog without changing the source", () => {
		const items = Array.from({ length: 125 }, (_, index) => ability(index));

		const page = queryAbilityCatalog(items, { scope: "discover", page: 2, pageSize: 60 });

		expect(page).toMatchObject({ total: 125, page: 2, pageSize: 60, pageCount: 3 });
		expect(page.items).toHaveLength(60);
		expect(page.items[0]?.slug).toBe("ability-060");
	});

	it("returns every builtin ability regardless of the page window", () => {
		const market = Array.from({ length: 80 }, (_, index) =>
			ability(index, { downloadCount: 1000 - index, installed: true }),
		);
		const builtin = Array.from({ length: 12 }, (_, index) =>
			ability(500 + index, {
				category: "",
				catalogSource: { kind: "builtin", id: "builtin" },
				isBuiltin: true,
				fromMarket: false,
				installed: true,
			}),
		);

		const page = queryAbilityCatalog([...market, ...builtin], { scope: "mine", page: 1, pageSize: 60 });

		expect(page.total).toBe(92);
		expect(page.items.filter((item) => item.isBuiltin)).toHaveLength(12);
		expect(page.items.filter((item) => !item.isBuiltin)).toHaveLength(60);
	});

	it("filters locally by keyword, category, type and source", () => {
		const github = ability(1, {
			category: "Design",
			catalogSource: {
				kind: "github",
				id: "community",
				name: "Community",
				repository: "https://github.com/example/community",
			},
			origin: {
				kind: "github-marketplace",
				sourceId: "community",
				marketplace: "community",
				marketplaceVersion: "1.0.0",
				repository: "https://github.com/example/community",
			},
		});
		const server = ability(2, { category: "Design" });

		const page = queryAbilityCatalog([server, github], {
			scope: "discover",
			keyword: "keyword-1",
			category: "Design",
			types: ["skill"],
			sourceIds: ["community"],
			page: 1,
			pageSize: 60,
		});

		expect(page.items.map((item) => item.id)).toEqual([github.id]);
	});

	it("sorts deterministically and limits mine to installed abilities", () => {
		const second = ability(2, { installed: true, title: "Same" });
		const first = ability(1, { installed: true, title: "Same" });

		const page = queryAbilityCatalog([second, ability(3), first], {
			scope: "mine",
			page: 1,
			pageSize: 60,
		});

		expect(page.items.map((item) => item.id)).toEqual([first.id, second.id]);
	});

	it("does not synthesize retired built-in MCP entries in discover", () => {
		const t = ((key: string) => key) as unknown as TFunction<"settings">;
		const presets = buildMcpAbilities(
			[],
			{
				ledger: {},
				skillManifest: {},
				localSkills: [],
				plugins: [],
				mcpConfig: { mcpServers: {} },
				oauthAuthByName: {},
				mcpSetupStatus: {},
				busyIds: new Set<string>(),
			},
			t,
		);

		const page = queryAbilityCatalog(presets, { scope: "discover", page: 1, pageSize: 60 });

		expect(page.items).toEqual([]);
	});

	it("keeps discover ordering stable when installation state changes", () => {
		const popular = ability(1, { downloadCount: 100 });
		const other = ability(2, { downloadCount: 10, installed: true, needsUpdate: true, setupRequired: true });

		const before = queryAbilityCatalog([other, popular], { scope: "discover", page: 1, pageSize: 60 });
		const after = queryAbilityCatalog(
			[
				{ ...other, installed: false, needsUpdate: false, setupRequired: false },
				{ ...popular, installed: true },
			],
			{ scope: "discover", page: 1, pageSize: 60 },
		);

		expect(before.items.map((item) => item.id)).toEqual([popular.id, other.id]);
		expect(after.items.map((item) => item.id)).toEqual([popular.id, other.id]);
	});
});

/** 只关心 type / 安装态时用：按 type 造条目，其余字段沿用 skill 的默认值。 */
function typedAbility(
	index: number,
	type: AbilityItem["type"],
	slug: string,
	overrides: Partial<AbilityItem> = {},
): AbilityItem {
	return {
		...ability(index, { slug, id: `${type}:${slug}`, searchTerms: [slug, `keyword-${index}`] }),
		type,
		...overrides,
	} as AbilityItem;
}

describe("countAbilitiesByModule", () => {
	const items = [
		typedAbility(1, "skill", "docx"),
		typedAbility(2, "skill", "pdf", { installed: true }),
		typedAbility(3, "mcp", "notion", { installed: true }),
		typedAbility(4, "plugin", "feishu", { installed: true }),
	];

	it("counts every module including the empty ones, following scope and keyword", () => {
		expect(countAbilitiesByModule(items, { scope: "discover" })).toEqual([
			{ module: "skill", total: 2 },
			{ module: "scene", total: 0 },
			{ module: "mcp", total: 1 },
			{ module: "plugin", total: 1 },
			{ module: "bundle", total: 0 },
		]);
		// 换 scope 就是换口径：数字虚高会让 tab 骗人。
		expect(countAbilitiesByModule(items, { scope: "mine" })).toEqual([
			{ module: "skill", total: 1 },
			{ module: "scene", total: 0 },
			{ module: "mcp", total: 1 },
			{ module: "plugin", total: 1 },
			{ module: "bundle", total: 0 },
		]);
		expect(countAbilitiesByModule(items, { scope: "discover", keyword: "pdf" })).toEqual([
			{ module: "skill", total: 1 },
			{ module: "scene", total: 0 },
			{ module: "mcp", total: 0 },
			{ module: "plugin", total: 0 },
			{ module: "bundle", total: 0 },
		]);
	});

	it("keeps the same totals as the list each module points at", () => {
		for (const { module, total } of countAbilitiesByModule(items, { scope: "discover" })) {
			const page = queryAbilityCatalog(items, { scope: "discover", types: [module], page: 1, pageSize: 60 });
			expect(page.total).toBe(total);
		}
	});

	it("lands on the first non-empty module, falling back to skills", () => {
		const pluginsOnly = countAbilitiesByModule([typedAbility(5, "plugin", "feishu")], { scope: "discover" });
		expect(pickDefaultModule(pluginsOnly)).toBe("plugin");
		expect(pickDefaultModule(countAbilitiesByModule([], { scope: "discover" }))).toBe("skill");
	});
});
