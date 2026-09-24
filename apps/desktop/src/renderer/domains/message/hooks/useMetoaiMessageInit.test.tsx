// @vitest-environment jsdom
/**
 * 官方消息初始化 + urgent 自动弹出。这里锁住三件事：
 * - 拉取失败静默降级（不抛、不弹、不阻塞），列表保持空；
 * - 未读 urgent 消息会在主窗口绘制后自动打开一次消息中心，并把 id 落到本地；
 * - 同一个 id 只自动弹一次：重启（重新挂载）后不再弹。
 *
 * 官方消息接口是匿名公开的外部边界，这里整体替换掉，避免测试真的打网络。
 */
import type { ReactNode } from "react";
import type { MetoaiDesktopMessageVO } from "@shared/lib/api";
import { MESSAGE_CENTER_STORAGE_KEY } from "@shared/lib/message-center-storage";
import { messageCenterLocalStateAtom, messageCenterOpenAtom, metoaiMessagesAtom } from "@shared/store/atoms";
import { renderHook, waitFor } from "@testing-library/react";
import { createStore, Provider as JotaiProvider } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { fetchMessagesMock } = vi.hoisted(() => ({ fetchMessagesMock: vi.fn() }));

vi.mock("@shared/lib/api", async (importOriginal) => ({
	...(await importOriginal<typeof import("@shared/lib/api")>()),
	fetchMetoaiDesktopMessages: fetchMessagesMock,
}));

const { useMetoaiMessageInit } = await import("./useMetoaiMessageInit");

type Store = ReturnType<typeof createStore>;

function urgentMessage(overrides: Partial<MetoaiDesktopMessageVO> = {}): MetoaiDesktopMessageVO {
	return {
		id: 21,
		title: "紧急公告",
		body: "正文",
		level: "urgent",
		published_at: "2026-09-24T10:00:00Z",
		...overrides,
	};
}

function respond(list: MetoaiDesktopMessageVO[]): void {
	fetchMessagesMock.mockResolvedValueOnce({
		list,
		total: list.length,
		page: 1,
		page_size: 20,
	});
}

function mount(store: Store): void {
	const wrapper = ({ children }: { children: ReactNode }) => (
		<JotaiProvider store={store}>{children}</JotaiProvider>
	);
	renderHook(() => useMetoaiMessageInit(), { wrapper });
}

beforeEach(() => {
	fetchMessagesMock.mockReset();
	localStorage.clear();
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe("useMetoaiMessageInit", () => {
	it("拉到官方消息后写入 atom，未登录也照常请求", async () => {
		respond([urgentMessage({ level: "normal" })]);
		const store = createStore();

		mount(store);

		await waitFor(() => expect(store.get(metoaiMessagesAtom)).toHaveLength(1));
		expect(fetchMessagesMock).toHaveBeenCalledTimes(1);
		expect(store.get(messageCenterOpenAtom)).toBe(false);
	});

	it("拉取失败时静默降级：不抛错、不打开消息中心、列表保持空", async () => {
		fetchMessagesMock.mockRejectedValueOnce(new Error("offline"));
		const store = createStore();

		mount(store);

		await waitFor(() => expect(fetchMessagesMock).toHaveBeenCalledTimes(1));
		await Promise.resolve();
		expect(store.get(metoaiMessagesAtom)).toEqual([]);
		expect(store.get(messageCenterOpenAtom)).toBe(false);
	});

	it("存在未读 urgent 消息时自动打开一次，并记下已弹出", async () => {
		respond([urgentMessage()]);
		const store = createStore();

		mount(store);

		await waitFor(() => expect(store.get(messageCenterOpenAtom)).toBe(true));
		expect(store.get(messageCenterLocalStateAtom).autoOpenedUrgentIds).toEqual([21]);
		const stored = JSON.parse(localStorage.getItem(MESSAGE_CENTER_STORAGE_KEY) ?? "{}") as {
			autoOpenedUrgentIds?: number[];
		};
		expect(stored.autoOpenedUrgentIds).toEqual([21]);
	});

	it("同一个 urgent id 重新挂载后不再自动弹出", async () => {
		respond([urgentMessage()]);
		const store = createStore();
		store.set(messageCenterLocalStateAtom, { schemaVersion: 1, readOfficialIds: [], autoOpenedUrgentIds: [21] });

		mount(store);

		await waitFor(() => expect(store.get(metoaiMessagesAtom)).toHaveLength(1));
		await Promise.resolve();
		expect(store.get(messageCenterOpenAtom)).toBe(false);
	});

	it("已读的 urgent 消息不触发自动弹出", async () => {
		respond([urgentMessage()]);
		const store = createStore();
		store.set(messageCenterLocalStateAtom, { schemaVersion: 1, readOfficialIds: [21], autoOpenedUrgentIds: [] });

		mount(store);

		await waitFor(() => expect(store.get(metoaiMessagesAtom)).toHaveLength(1));
		await Promise.resolve();
		expect(store.get(messageCenterOpenAtom)).toBe(false);
	});
});
