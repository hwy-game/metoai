import { afterEach, describe, expect, it, vi } from "vitest";

const ENV_KEY = "VETTA_METOAI_SITE_URL";
const PRODUCTION_SITE = "https://www.metotoken.ai";

/** 常量在模块加载时求值，所以每个用例都要清模块缓存后再 import。 */
async function loadMetoAi(override?: string): Promise<typeof import("./metoai")> {
	vi.resetModules();
	if (override === undefined) delete process.env[ENV_KEY];
	else process.env[ENV_KEY] = override;
	return import("./metoai");
}

afterEach(() => {
	delete process.env[ENV_KEY];
	vi.resetModules();
});

describe("metoai site constants", () => {
	it("defaults to the production site when the override is unset", async () => {
		const mod = await loadMetoAi();
		expect(mod.METOAI_SITE_URL).toBe(PRODUCTION_SITE);
		expect(mod.METOAI_BASE_URL).toBe(`${PRODUCTION_SITE}/v1`);
		expect(mod.METOAI_API_BASE).toBe(`${PRODUCTION_SITE}/api`);
	});

	it("honours VETTA_METOAI_SITE_URL and keeps the derived prefixes in sync", async () => {
		const mod = await loadMetoAi("http://localhost:3000");
		expect(mod.METOAI_SITE_URL).toBe("http://localhost:3000");
		expect(mod.METOAI_BASE_URL).toBe("http://localhost:3000/v1");
		expect(mod.METOAI_API_BASE).toBe("http://localhost:3000/api");
	});

	it("trims whitespace and trailing slashes, and falls back when blank", async () => {
		const trimmed = await loadMetoAi("  http://127.0.0.1:3000/  ");
		expect(trimmed.METOAI_SITE_URL).toBe("http://127.0.0.1:3000");
		expect(trimmed.METOAI_API_BASE).toBe("http://127.0.0.1:3000/api");

		const blank = await loadMetoAi("   ");
		expect(blank.METOAI_SITE_URL).toBe(PRODUCTION_SITE);
	});
});
