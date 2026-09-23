import { describe, expect, it } from "vitest";
import { NAMESPACES, SUPPORTED_LANGUAGES } from "./config.js";
import { resources } from "./resources.js";

type Catalog = Record<string, unknown>;

/** 扁平化成 `dotted.path` / `path[0]` → 译文，便于按 key 集合做全量比对。 */
function flatten(value: unknown, path: string, out: Map<string, unknown>): Map<string, unknown> {
	if (Array.isArray(value)) {
		for (const [index, item] of value.entries()) flatten(item, `${path}[${index}]`, out);
		return out;
	}
	if (value && typeof value === "object") {
		for (const key of Object.keys(value)) {
			flatten((value as Catalog)[key], path ? `${path}.${key}` : key, out);
		}
		return out;
	}
	out.set(path, value);
	return out;
}

function placeholders(text: string): string[] {
	return (text.match(/\{\{[^}]*\}\}/g) ?? []).sort();
}

const reference = new Map(
	NAMESPACES.map((ns) => [ns, flatten((resources.en as Record<string, Catalog>)[ns], "", new Map())]),
);

describe("i18n catalogs", () => {
	it("registers exactly the supported languages", () => {
		expect(Object.keys(resources).sort()).toEqual([...SUPPORTED_LANGUAGES].sort());
	});

	it("registers every namespace for every language", () => {
		for (const language of SUPPORTED_LANGUAGES) {
			expect(Object.keys(resources[language]).sort(), language).toEqual([...NAMESPACES].sort());
		}
	});

	// 新增语言最容易出的错是漏 key / 漏译：i18next 遇到缺 key 会回退到另一种语言，
	// 界面上表现为「一半西班牙语一半中文」，只有全量比对才能拦住。
	describe.each([...SUPPORTED_LANGUAGES])("%s", (language) => {
		it.each([...NAMESPACES])("has the same keys as en for %s", (ns) => {
			const catalog = flatten((resources[language] as Record<string, Catalog>)[ns], "", new Map());
			const expected = reference.get(ns);
			expect(expected).toBeDefined();
			// 只比键集合：key 顺序不影响 i18next 查找，且 zh 与 en 在个别命名空间本来顺序不同。
			expect([...catalog.keys()].sort()).toEqual([...(expected as Map<string, unknown>).keys()].sort());
		});

		it.each([...NAMESPACES])("leaves no empty string in %s", (ns) => {
			const catalog = flatten((resources[language] as Record<string, Catalog>)[ns], "", new Map());
			const expected = reference.get(ns) as Map<string, unknown>;
			// en 里本来就留空的 key（如中文量词「张」在英文不需要）不要求新语言填值。
			const empty = [...catalog.entries()]
				.filter(([key, value]) => expected.get(key) !== "" && (typeof value !== "string" || value.trim() === ""))
				.map(([key]) => key);
			expect(empty).toEqual([]);
		});

		it.each([...NAMESPACES])("keeps the same interpolation placeholders in %s", (ns) => {
			const catalog = flatten((resources[language] as Record<string, Catalog>)[ns], "", new Map());
			const expected = reference.get(ns) as Map<string, unknown>;
			const mismatched = [...expected.entries()]
				.filter(([key, source]) => {
					const translated = catalog.get(key);
					if (typeof source !== "string" || typeof translated !== "string") return false;
					return placeholders(source).join("|") !== placeholders(translated).join("|");
				})
				.map(([key]) => key);
			expect(mismatched).toEqual([]);
		});
	});
});
