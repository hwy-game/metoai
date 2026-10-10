// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { METOAI_API_BASE } from "@/shared/metoai";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

const { downloadAbility, fetchAbilityInfo, fetchMarketAbilities } = await import("./api");

beforeEach(() => {
	fetchMock.mockReset();
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe("MetoToken market API", () => {
	it("reads the public market through the MetoToken API base", async () => {
		fetchMock.mockResolvedValueOnce({
			ok: true,
			status: 200,
			json: async () => ({ code: 0, message: "", data: [{ slug: "demo", type: "skill", icon: "icons/demo.png" }] }),
		});

		await expect(fetchMarketAbilities("legacy-vetta-token")).resolves.toMatchObject([
			{ slug: "demo", type: "skill" },
		]);
		expect(fetchMock).toHaveBeenCalledWith(`${METOAI_API_BASE}/abilities/market`);
		expect(fetchMock.mock.calls[0]?.[1]).toBeUndefined();
	});

	it("uses the MetoToken info and download endpoints", async () => {
		fetchMock
			.mockResolvedValueOnce({
				ok: true,
				status: 200,
				json: async () => ({ code: 0, message: "", data: { slug: "demo", type: "plugin", icon: "" } }),
			})
			.mockResolvedValueOnce({
				ok: true,
				status: 200,
				arrayBuffer: async () => new Uint8Array([1, 2]).buffer,
			});

		await fetchAbilityInfo("plugin", "demo", "legacy-vetta-token");
		await downloadAbility("plugin", "demo", "legacy-vetta-token");
		expect(fetchMock).toHaveBeenNthCalledWith(1, `${METOAI_API_BASE}/abilities/plugin/demo/info`);
		expect(fetchMock).toHaveBeenNthCalledWith(2, `${METOAI_API_BASE}/abilities/plugin/demo/download`);
		expect(fetchMock.mock.calls[0]?.[1]).toBeUndefined();
		expect(fetchMock.mock.calls[1]?.[1]).toBeUndefined();
	});
});
