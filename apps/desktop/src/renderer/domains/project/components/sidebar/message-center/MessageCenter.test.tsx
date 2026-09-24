// @vitest-environment jsdom
/**
 * 消息中心现在合并两套消息源：vetta-serv 站内信 + metotoken 官方消息。
 * 这里锁住用户真正会看到的连续操作：打开消息中心 → 看到两套消息并集 → 切到「官方消息」→
 * 官方消息可标已读但没有删除入口（服务端维护），站内信仍可删；铃铛角标计入两边的未读。
 * 两套数字 id 会撞，所以同一个数字 id 必须同时出现且互不覆盖。
 */
import type { MetoaiDesktopMessageVO, NotificationVO } from "@shared/lib/api";
import {
	messageCenterOpenAtom,
	metoaiMessagesAtom,
	notificationsAtom,
	notificationUnreadAtom,
} from "@shared/store/atoms";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createStore, Provider } from "jotai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MessageCenter } from "./MessageCenter";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

// motion 的 layout 动画需要 ResizeObserver；jsdom 没有实现。
if (typeof globalThis.ResizeObserver === "undefined") {
	globalThis.ResizeObserver = class {
		observe(): void {}
		unobserve(): void {}
		disconnect(): void {}
	} as unknown as typeof ResizeObserver;
}

const OFFICIAL_MESSAGES: MetoaiDesktopMessageVO[] = [
	{
		id: 12,
		title: "官方紧急",
		body: "紧急正文",
		level: "urgent",
		published_at: "2026-09-24T10:00:00Z",
	},
	{
		id: 13,
		title: "官方重要",
		body: "重要正文",
		level: "important",
		published_at: "2026-09-23T10:00:00Z",
	},
	{
		id: 14,
		title: "官方公告",
		body: "普通正文",
		level: "normal",
		published_at: "2026-09-22T10:00:00Z",
	},
];

// 同一个数字 id 12：站内信与官方消息各一条，用来证明命名空间键不冲突。
const NOTIFICATIONS: NotificationVO[] = [
	{
		id: 12,
		type: "system",
		title: "站内信 12",
		body: "站内信正文",
		read: false,
		created_at: "2026-09-21T10:00:00Z",
	},
];

function renderMessageCenter(): void {
	const store = createStore();
	store.set(messageCenterOpenAtom, true);
	store.set(metoaiMessagesAtom, OFFICIAL_MESSAGES);
	store.set(notificationsAtom, NOTIFICATIONS);
	store.set(notificationUnreadAtom, 2);
	render(
		<Provider store={store}>
			<MessageCenter />
		</Provider>,
	);
}

beforeEach(() => {
	localStorage.clear();
});

describe("MessageCenter", () => {
	it("渲染「全部 / 通知 / 官方消息」三个 tab，并带各自的未读数", () => {
		renderMessageCenter();

		expect(screen.getByText("tabs.all")).toBeTruthy();
		expect(screen.getByText("tabs.notifications")).toBeTruthy();
		expect(screen.getByText("tabs.official")).toBeTruthy();

		expect(screen.getByRole("button", { name: /tabs\.notifications/ }).textContent).toContain("2");
		expect(screen.getByRole("button", { name: /tabs\.official/ }).textContent).toContain("3");
	});

	it("铃铛角标计入官方消息与站内信两边的未读", () => {
		renderMessageCenter();

		// 站内信未读 2 + 官方消息未读 3。
		expect(screen.getByTitle("triggerTitle").textContent).toContain("5");
	});

	it("all tab 是两套消息的并集，数字 id 相同的条目同时出现", () => {
		renderMessageCenter();

		expect(screen.getByText("官方紧急")).toBeTruthy();
		expect(screen.getByText("官方重要")).toBeTruthy();
		expect(screen.getByText("官方公告")).toBeTruthy();
		expect(screen.getByText("站内信 12")).toBeTruthy();
	});

	it("级别决定官方消息的强调色：urgent 走 destructive、important 走 amber", () => {
		renderMessageCenter();

		expect(screen.getByText("官方紧急").closest(".group")?.className).toContain("bg-destructive/15");
		expect(screen.getByText("官方重要").closest(".group")?.className).toContain("bg-amber-500/15");
		expect(screen.getByText("官方公告").closest(".group")?.className).toContain("bg-primary/5");
	});

	it("切到官方消息 tab 后只显示官方消息", async () => {
		renderMessageCenter();

		await userEvent.click(screen.getByRole("button", { name: /tabs\.official/ }));

		// 切 tab 走 AnimatePresence mode="wait"：旧内容要等退出动画结束才卸载。
		await waitFor(() => expect(screen.queryByText("站内信 12")).toBeNull());
		expect(screen.getByText("官方紧急")).toBeTruthy();
	});

	it("官方消息没有删除入口，站内信仍然可删", async () => {
		renderMessageCenter();

		// all tab：只有站内信那一条带删除按钮。
		expect(document.querySelectorAll('button[title="notification.delete"]')).toHaveLength(1);

		await userEvent.click(screen.getByRole("button", { name: /tabs\.official/ }));
		await waitFor(() => expect(screen.queryByText("站内信 12")).toBeNull());

		expect(document.querySelectorAll('button[title="notification.delete"]')).toHaveLength(0);
		// 官方 tab 里没有可清理的已读站内信，「清空已读」不该出现。
		expect(screen.queryByText("notification.clearRead")).toBeNull();
	});

	it("点击官方消息把它标为已读，并落到本地存储", async () => {
		renderMessageCenter();

		await userEvent.click(screen.getByText("官方紧急"));

		expect(screen.getByText("官方紧急").closest(".group")?.className).toContain("border-border/50");
		expect(localStorage.getItem("vetta-message-center")).toContain("12");
	});

	it("官方 tab 的「全部已读」把官方消息未读清零并写入本地存储", async () => {
		renderMessageCenter();

		await userEvent.click(screen.getByRole("button", { name: /tabs\.official/ }));
		await userEvent.click(screen.getByText("notification.markAllRead"));

		const stored = JSON.parse(localStorage.getItem("vetta-message-center") ?? "{}") as {
			readOfficialIds?: number[];
		};
		expect(stored.readOfficialIds?.sort()).toEqual([12, 13, 14]);
		// 官方消息未读清零，站内信未读 2 保持不变。
		expect(screen.getByTitle("triggerTitle").textContent).toContain("2");
	});
});
