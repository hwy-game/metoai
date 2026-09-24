// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { METOAI_API_BASE } from "@/shared/metoai";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

const { fetchMetoaiDesktopMessages } = await import("./api");

beforeEach(() => {
	fetchMock.mockReset();
});

afterEach(() => {
	vi.restoreAllMocks();
});

function respond(data: unknown): void {
	fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ code: 0, message: "", data }) });
}

describe("MetoToken 官方消息 API", () => {
	it("走公开 API base，按 p / page_size 分页，且不带任何凭据", async () => {
		respond({ list: [], total: 0, page: 2, page_size: 5 });

		await fetchMetoaiDesktopMessages({ p: 2, page_size: 5 });

		expect(fetchMock).toHaveBeenCalledWith(`${METOAI_API_BASE}/desktop/messages?p=2&page_size=5`);
		expect(fetchMock.mock.calls[0]?.[1]).toBeUndefined();
	});

	it("默认拉第一页 20 条", async () => {
		respond({ list: [], total: 0, page: 1, page_size: 20 });

		await fetchMetoaiDesktopMessages();

		expect(fetchMock).toHaveBeenCalledWith(`${METOAI_API_BASE}/desktop/messages?p=1&page_size=20`);
	});

	it("归一未知级别与非字符串字段，缺 list 时给出空数组", async () => {
		respond({
			list: [{ id: 12, title: "标题", body: "**Markdown** 正文", level: "URGENT", published_at: null }],
		});

		const page = await fetchMetoaiDesktopMessages();

		expect(page.list).toEqual([
			{ id: 12, title: "标题", body: "**Markdown** 正文", level: "normal", published_at: null },
		]);
		expect(page.page).toBe(1);
		expect(page.page_size).toBe(20);

		fetchMock.mockReset();
		respond({ total: 3 });
		await expect(fetchMetoaiDesktopMessages()).resolves.toMatchObject({ list: [], total: 3 });
	});

	it("envelope code 非 0 时抛错", async () => {
		fetchMock.mockResolvedValueOnce({
			ok: true,
			status: 200,
			json: async () => ({ code: 500, message: "boom", data: null }),
		});

		await expect(fetchMetoaiDesktopMessages()).rejects.toThrow("boom");
	});
});
