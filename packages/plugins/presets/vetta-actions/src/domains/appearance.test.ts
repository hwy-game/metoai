import type { PluginJsonSchema } from "@vetta-org/plugin-sdk";
import { describe, expect, it, vi } from "vitest";
import { registerAppearanceActions } from "./appearance";

/** 与 Desktop 的 SUPPORTED_LANGUAGES 对齐；插件包不能 import apps/desktop，故在此重复一份。 */
const SUPPORTED_LANGUAGES = ["zh", "en", "es", "fr", "id", "vi", "ru", "ja"] as const;

type Registered = {
	id: string;
	publicId?: string;
	effect: string;
	examples?: Array<{ description: string; input: unknown }>;
	handler: (args: { input: unknown; signal: AbortSignal }) => Promise<unknown>;
	assertReady?: (args: { input: unknown; signal: AbortSignal }) => Promise<void>;
	inputSchema: PluginJsonSchema;
};

function createMockCtx() {
	const registered: Registered[] = [];
	const official = {
		appearance: {
			help: vi.fn().mockResolvedValue({ type: "help" }),
			get: vi.fn().mockResolvedValue({ type: "get" }),
			set: vi.fn().mockResolvedValue({ type: "set" }),
			setLanguage: vi.fn().mockResolvedValue({ type: "set-language" }),
			listThemeIds: vi.fn().mockReturnValue(["default"]),
		},
	};
	const ctx = {
		official,
		appActions: {
			register: (def: Registered) => {
				registered.push(def);
			},
		},
	};
	return { ctx: ctx as never, registered, official };
}

function findAction(registered: Registered[], id: string): Registered {
	const action = registered.find((item) => item.id === id);
	if (!action) throw new Error(`action not registered: ${id}`);
	return action;
}

/**
 * `set-language` 分支的 language 枚举就是 schema 的接受集合——宿主用 ajv 按 enum 校验输入，
 * 所以直接读它既能锁住「8 个语言码都收」，也能锁住「别的码被拒」。
 */
function schemaLanguageEnum(schema: PluginJsonSchema): string[] {
	const branches = (schema as { oneOf?: Array<{ properties?: Record<string, { enum?: unknown }> }> }).oneOf ?? [];
	const values = branches.map((branch) => branch.properties?.language?.enum).find((value) => value !== undefined);
	if (!Array.isArray(values)) throw new Error("set-language 分支缺少 language 枚举");
	return values.map(String);
}

describe("registerAppearanceActions", () => {
	it("registers appearance.query and appearance.theme with public ids", () => {
		const { ctx, registered } = createMockCtx();
		registerAppearanceActions(ctx);
		expect(registered.map((item) => item.publicId)).toEqual(["appearance.query", "appearance.theme"]);
	});

	it("accepts every supported interface language and still rejects unsupported codes", () => {
		const { ctx, registered } = createMockCtx();
		registerAppearanceActions(ctx);
		const accepted = schemaLanguageEnum(findAction(registered, "appearance.theme").inputSchema);
		expect(accepted).toEqual([...SUPPORTED_LANGUAGES]);
		expect(accepted).not.toContain("pt");
	});

	it("forwards every supported language to the official appearance api", async () => {
		const { ctx, registered, official } = createMockCtx();
		registerAppearanceActions(ctx);
		const manage = findAction(registered, "appearance.theme");
		const signal = new AbortController().signal;
		for (const language of SUPPORTED_LANGUAGES) {
			await expect(manage.handler({ input: { type: "set-language", language }, signal })).resolves.toEqual({
				type: "set-language",
			});
			expect(official.appearance.setLanguage).toHaveBeenLastCalledWith(language);
		}
	});

	it("shows a non-Chinese, non-English example so the action is not read as zh/en only", () => {
		const { ctx, registered } = createMockCtx();
		registerAppearanceActions(ctx);
		const languages = (findAction(registered, "appearance.theme").examples ?? [])
			.map((example) => (example.input as { language?: string }).language)
			.filter((language): language is string => language !== undefined);
		expect(languages).toContain("en");
		expect(languages.some((language) => language !== "zh" && language !== "en")).toBe(true);
	});
});
