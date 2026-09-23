// 快捷面板自带一份内联文案目录，不在主窗口的 resources 里，
// 所以 resources.test.ts 的全量比对覆盖不到它：新增语言时最容易漏的就是这里，
// 漏了不会报错，只是面板静默回退到中文、与主窗口语言不一致。

import { describe, expect, it } from "vitest";
import { SUPPORTED_LANGUAGES } from "@/shared/i18n/config";
import { quickPanelResources } from "./i18n";

const NS = "quickpanel";

type Catalog = Record<string, unknown>;

function flatten(value: unknown, path = "", out: Map<string, unknown> = new Map()): Map<string, unknown> {
	if (Array.isArray(value)) {
		for (const [index, item] of value.entries()) flatten(item, `${path}[${index}]`, out);
		return out;
	}
	if (value && typeof value === "object") {
		for (const key of Object.keys(value)) flatten((value as Catalog)[key], path ? `${path}.${key}` : key, out);
		return out;
	}
	out.set(path, value);
	return out;
}

const placeholders = (text: string) => (text.match(/\{\{[^}]*\}\}/g) ?? []).sort().join("|");

const bundles = quickPanelResources as unknown as Record<string, Record<string, Catalog>>;

describe("quick panel catalog", () => {
	it("covers every supported language", () => {
		expect(Object.keys(quickPanelResources).sort()).toEqual([...SUPPORTED_LANGUAGES].sort());
	});

	it.each([...SUPPORTED_LANGUAGES])("%s matches en", (language) => {
		const expected = flatten(bundles.en[NS]);
		const catalog = flatten(bundles[language][NS]);

		expect([...catalog.keys()].sort()).toEqual([...expected.keys()].sort());

		const mismatched = [...expected.entries()]
			.filter(
				([key, source]) =>
					typeof source === "string" && placeholders(source) !== placeholders(String(catalog.get(key))),
			)
			.map(([key]) => key);
		expect(mismatched).toEqual([]);

		const empty = [...catalog.entries()]
			.filter(([, value]) => typeof value !== "string" || value.trim() === "")
			.map(([key]) => key);
		expect(empty).toEqual([]);
	});
});
