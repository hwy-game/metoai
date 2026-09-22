import { afterEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

vi.mock("../logger.js", () => ({
	getAppLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

vi.mock("../utils/integrity.js", () => ({
	verifySha256: vi.fn(),
}));

vi.mock("../abilities/ability-ledger.js", () => ({
	recordAbilityInstall: vi.fn(),
}));

vi.mock("./skill-service.js", () => ({
	ensureDirWritable: vi.fn(),
	getSkillBaseDir: vi.fn(() => "C:/tmp/skills"),
	readSkillsManifest: vi.fn(() => ({})),
	recordSkillResourceEvent: vi.fn(),
	writeSkillsManifest: vi.fn(),
}));

vi.mock("@vetta/action-rpc", () => ({
	getVettaHomePath: () => "C:/tmp/vetta-home",
}));

vi.mock("node:fs/promises", () => ({
	mkdir: vi.fn().mockResolvedValue(undefined),
	rm: vi.fn().mockResolvedValue(undefined),
	writeFile: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("node:fs", async () => {
	const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
	return {
		...actual,
		existsSync: vi.fn(() => true),
		readFileSync: vi.fn(() => "---\nversion: 9.9.9\n---\n"),
	};
});

vi.mock("node:child_process", () => ({
	execSync: vi.fn(),
}));

afterEach(() => {
	fetchMock.mockReset();
	vi.clearAllMocks();
});

describe("installSkillFromMarketSlug", () => {
	it("fetches info and archive then installs", async () => {
		const infoBody = {
			code: 0,
			data: {
				slug: "demo",
				name: "Demo",
				description: "desc",
				version: "1.2.3",
				sha256: undefined,
			},
		};
		fetchMock
			.mockResolvedValueOnce({
				ok: true,
				json: async () => infoBody,
			})
			.mockResolvedValueOnce({
				ok: true,
				arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
			});

		const { installSkillFromMarketSlug } = await import("./skill-market-install.js");
		const result = await installSkillFromMarketSlug("skill", "demo");
		expect(result).toEqual({
			name: "demo",
			type: "skill",
			version: "1.2.3",
			updated: false,
		});
		expect(fetchMock).toHaveBeenNthCalledWith(1, "https://api.metotoken.ai/api/abilities/skill/demo/info", {
			headers: { Accept: "application/json" },
		});
		expect(fetchMock).toHaveBeenNthCalledWith(2, "https://api.metotoken.ai/api/abilities/skill/demo/download", {
			headers: { Accept: "application/octet-stream" },
		});
	});
});

describe("MetoToken 市场（匿名）", () => {
	it("仍可匿名拉取并安装市场能力", async () => {
		fetchMock
			.mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					code: 0,
					data: { slug: "demo", name: "Demo", description: "desc", version: "1.2.3" },
				}),
			})
			.mockResolvedValueOnce({
				ok: true,
				arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
			});
		const { installSkillFromMarketSlug } = await import("./skill-market-install.js");
		await expect(installSkillFromMarketSlug("skill", "demo")).resolves.toMatchObject({ name: "demo", type: "skill" });
		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(fetchMock).toHaveBeenNthCalledWith(1, "https://api.metotoken.ai/api/abilities/skill/demo/info", {
			headers: { Accept: "application/json" },
		});
	});
});
