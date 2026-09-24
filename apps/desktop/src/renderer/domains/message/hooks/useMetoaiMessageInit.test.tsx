// @vitest-environment jsdom
/**
 * 官方消息初始化：拉取时机 + urgent 自动弹出。
 *
 * 拉取时机是这次改动的重点：启动一次、回到前台、可见性变回可见、固定间隔轮询，并且
 * 并发触发只发一次请求；同时锁住 urgent 自动弹出的不变量（每个 id 只弹一次、同一次会话最多一次），
 * 重新拉取到列表不能把它们破掉。
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

const POLL_INTERVAL_MS = 10 * 60 * 1_000;

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

function page(list: MetoaiDesktopMessageVO[]): {
	list: MetoaiDesktopMessageVO[];
	total: number;
	page: number;
	page_size: number;
} {
	return { list, total: list.length, page: 1, page_size: 20 };
}

/** 只对下一次请求生效；用于「第二次拉取拿到不同内容」的场景。 */
function respond(list: MetoaiDesktopMessageVO[]): void {
	fetchMessagesMock.mockResolvedValueOnce(page(list));
}

/** 对之后所有请求都生效；用于不关心返回内容的时机测试。 */
function respondAlways(list: MetoaiDesktopMessageVO[] = []): void {
	fetchMessagesMock.mockResolvedValue(page(list));
}

/** jsdom 的 visibilityState 是只读的，用实例属性盖住原型上的 getter。 */
function setVisibility(state: DocumentVisibilityState): void {
	Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
}

function focusWindow(): void {
	window.dispatchEvent(new Event("focus"));
}

function changeVisibility(state: DocumentVisibilityState): void {
	setVisibility(state);
	document.dispatchEvent(new Event("visibilitychange"));
}

function mount(store: Store): ReturnType<typeof renderHook> {
	const wrapper = ({ children }: { children: ReactNode }) => (
		<JotaiProvider store={store}>{children}</JotaiProvider>
	);
	return renderHook(() => useMetoaiMessageInit(), { wrapper });
}

beforeEach(() => {
	fetchMessagesMock.mockReset();
	localStorage.clear();
	setVisibility("visible");
});

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
	setVisibility("visible");
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

	it("窗口重新获得焦点时再拉一次，列表换成最新内容", async () => {
		respond([urgentMessage({ level: "normal", id: 1, title: "旧公告" })]);
		respond([urgentMessage({ level: "normal", id: 2, title: "新公告" })]);
		const store = createStore();

		mount(store);
		await waitFor(() => expect(store.get(metoaiMessagesAtom)).toHaveLength(1));

		focusWindow();

		await waitFor(() => expect(fetchMessagesMock).toHaveBeenCalledTimes(2));
		await waitFor(() => expect(store.get(metoaiMessagesAtom)[0]?.title).toBe("新公告"));
	});

	it("页面不可见时的 focus 不拉取", async () => {
		respondAlways();
		const store = createStore();

		mount(store);
		await waitFor(() => expect(fetchMessagesMock).toHaveBeenCalledTimes(1));

		setVisibility("hidden");
		focusWindow();
		await Promise.resolve();

		expect(fetchMessagesMock).toHaveBeenCalledTimes(1);
	});

	it("页面从隐藏变回可见时拉取，隐藏过程中不拉", async () => {
		respondAlways();
		const store = createStore();

		mount(store);
		await waitFor(() => expect(fetchMessagesMock).toHaveBeenCalledTimes(1));

		changeVisibility("hidden");
		await Promise.resolve();
		expect(fetchMessagesMock).toHaveBeenCalledTimes(1);

		changeVisibility("visible");
		await waitFor(() => expect(fetchMessagesMock).toHaveBeenCalledTimes(2));
	});

	it("focus 与可见性变化连发时只发一次请求，且之后仍能再拉", async () => {
		respondAlways();
		const store = createStore();

		mount(store);
		await waitFor(() => expect(fetchMessagesMock).toHaveBeenCalledTimes(1));

		// 切回应用会同时收到 focus 与 visibilitychange：第二次调用必须复用第一次的在途请求。
		focusWindow();
		document.dispatchEvent(new Event("visibilitychange"));
		expect(fetchMessagesMock).toHaveBeenCalledTimes(2);

		await waitFor(() => expect(store.get(metoaiMessagesAtom)).toEqual([]));
		expect(fetchMessagesMock).toHaveBeenCalledTimes(2);

		// 在途请求结束后，下一次回到前台仍会重新拉取：单飞不会把后续刷新永久挡掉。
		focusWindow();
		expect(fetchMessagesMock).toHaveBeenCalledTimes(3);
	});

	it("每 10 分钟轮询一次，页面隐藏时跳过", async () => {
		vi.useFakeTimers();
		respondAlways();
		const store = createStore();

		mount(store);
		await vi.advanceTimersByTimeAsync(0);
		expect(fetchMessagesMock).toHaveBeenCalledTimes(1);

		await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS - 1);
		expect(fetchMessagesMock).toHaveBeenCalledTimes(1);

		await vi.advanceTimersByTimeAsync(1);
		expect(fetchMessagesMock).toHaveBeenCalledTimes(2);

		// 最小化 / 切走时轮询没有意义，等回到前台再补。
		setVisibility("hidden");
		await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
		expect(fetchMessagesMock).toHaveBeenCalledTimes(2);
	});

	it("卸载后不再拉取，也不再轮询", async () => {
		vi.useFakeTimers();
		respondAlways();
		const store = createStore();

		const { unmount } = mount(store);
		await vi.advanceTimersByTimeAsync(0);
		expect(fetchMessagesMock).toHaveBeenCalledTimes(1);

		unmount();
		focusWindow();
		document.dispatchEvent(new Event("visibilitychange"));
		await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 3);

		expect(fetchMessagesMock).toHaveBeenCalledTimes(1);
	});

	it("重新拉取失败时保留已有列表，不抛错也不关掉已打开的消息中心", async () => {
		respond([urgentMessage({ level: "normal" })]);
		const store = createStore();

		mount(store);
		await waitFor(() => expect(store.get(metoaiMessagesAtom)).toHaveLength(1));

		fetchMessagesMock.mockRejectedValueOnce(new Error("offline"));
		focusWindow();

		await waitFor(() => expect(fetchMessagesMock).toHaveBeenCalledTimes(2));
		await Promise.resolve();
		expect(store.get(metoaiMessagesAtom)).toHaveLength(1);
		expect(store.get(messageCenterOpenAtom)).toBe(false);
	});

	it("重新拉取到同一条 urgent 不会重复弹出", async () => {
		respondAlways([urgentMessage()]);
		const store = createStore();

		mount(store);
		await waitFor(() => expect(store.get(messageCenterOpenAtom)).toBe(true));
		// 用户看完关掉。
		store.set(messageCenterOpenAtom, false);

		focusWindow();
		await waitFor(() => expect(fetchMessagesMock).toHaveBeenCalledTimes(2));
		await Promise.resolve();

		expect(store.get(messageCenterOpenAtom)).toBe(false);
		expect(store.get(messageCenterLocalStateAtom).autoOpenedUrgentIds).toEqual([21]);
	});

	it("同一次会话里新到的 urgent 也不会再弹一次", async () => {
		respond([urgentMessage({ id: 21 })]);
		const store = createStore();

		mount(store);
		await waitFor(() => expect(store.get(messageCenterOpenAtom)).toBe(true));
		store.set(messageCenterOpenAtom, false);

		respond([urgentMessage({ id: 22 })]);
		focusWindow();
		await waitFor(() => expect(fetchMessagesMock).toHaveBeenCalledTimes(2));
		await Promise.resolve();

		expect(store.get(messageCenterOpenAtom)).toBe(false);
	});
});
