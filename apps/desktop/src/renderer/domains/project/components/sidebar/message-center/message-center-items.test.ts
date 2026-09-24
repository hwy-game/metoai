import type { MetoaiDesktopMessageVO, NotificationVO } from "@shared/lib/api";
import { describe, expect, it } from "vitest";
import {
	buildInappMessageItems,
	buildOfficialMessageItems,
	countUnreadMessageItems,
	inappMessageItemId,
	type MessageCenterItem,
	officialMessageItemId,
	parseMessageCenterItemId,
	pickUrgentAutoOpenMessageId,
	sortMessageCenterItems,
} from "./message-center-items";

function official(overrides: Partial<MetoaiDesktopMessageVO> & { id: number }): MetoaiDesktopMessageVO {
	return {
		title: `官方 ${overrides.id}`,
		body: "正文",
		level: "normal",
		published_at: "2026-09-24T10:00:00Z",
		...overrides,
	};
}

function inapp(overrides: Partial<NotificationVO> & { id: number }): NotificationVO {
	return {
		type: "system",
		title: `站内信 ${overrides.id}`,
		body: "正文",
		read: false,
		created_at: "2026-09-24T10:00:00Z",
		...overrides,
	};
}

const formatTime = (timestamp: number): string => `t:${timestamp}`;

describe("消息中心命名空间键", () => {
	it("两套 id 空间相同时生成互不相等的键", () => {
		expect(officialMessageItemId(12)).toBe("official-12");
		expect(inappMessageItemId(12)).toBe("inapp-12");
		expect(officialMessageItemId(12)).not.toBe(inappMessageItemId(12));
	});

	it("解析回来源与数字 id", () => {
		expect(parseMessageCenterItemId("official-12")).toEqual({ source: "official", id: 12 });
		expect(parseMessageCenterItemId("inapp-7")).toEqual({ source: "inapp", id: 7 });
	});

	it("无法识别的键返回 null 而不是猜一个来源", () => {
		for (const value of ["12", "official-", "official-abc", "other-1", "official-1-2", ""]) {
			expect(parseMessageCenterItemId(value), value).toBeNull();
		}
	});
});

describe("消息中心正文渲染方式", () => {
	it("官方消息标为 Markdown，站内信标为纯文本", () => {
		const officialItems = buildOfficialMessageItems([official({ id: 1 })], new Set(), formatTime);
		const inappItems = buildInappMessageItems([inapp({ id: 1 })], formatTime);

		// 管理台用 Markdown 输入框维护官方消息正文，列表必须走 Markdown 渲染；
		// 站内信是纯文本，按 whitespace-pre-line 渲染即可。
		expect(officialItems[0]?.markdownBody).toBe(true);
		expect(inappItems[0]?.markdownBody).toBe(false);
	});
});

describe("官方消息视图项", () => {
	it("已读状态来自客户端本地集合，且不可删除", () => {
		const messages = [official({ id: 1 }), official({ id: 2 })];
		const items = buildOfficialMessageItems(messages, new Set([2]), formatTime);

		expect(items.map((item) => [item.id, item.read, item.deletable])).toEqual([
			["official-1", false, false],
			["official-2", true, false],
		]);
	});

	it("保留级别，空正文归一为 null", () => {
		const items = buildOfficialMessageItems(
			[official({ id: 3, level: "urgent", body: "   " })],
			new Set(),
			formatTime,
		);

		expect(items[0]?.level).toBe("urgent");
		expect(items[0]?.body).toBeNull();
	});

	it("没有发布时间时不渲染时间行，也不参与时间排序", () => {
		const items = buildOfficialMessageItems([official({ id: 4, published_at: null })], new Set(), formatTime);

		expect(items[0]?.relativeTime).toBeNull();
		expect(items[0]?.timestamp).toBeNull();
	});
});

describe("站内信视图项", () => {
	it("级别恒为 normal，且可删除", () => {
		const items = buildInappMessageItems([inapp({ id: 5 })], formatTime);

		expect(items[0]).toMatchObject({ id: "inapp-5", level: "normal", deletable: true, read: false });
	});
});

describe("合并与排序", () => {
	it("all tab 是两套消息的并集，按时间倒序且键不冲突", () => {
		const merged: MessageCenterItem[] = sortMessageCenterItems([
			...buildOfficialMessageItems(
				[official({ id: 1, published_at: "2026-09-24T10:00:00Z" })],
				new Set(),
				formatTime,
			),
			...buildInappMessageItems([inapp({ id: 1, created_at: "2026-09-24T12:00:00Z" })], formatTime),
		]);

		expect(merged.map((item) => item.id)).toEqual(["inapp-1", "official-1"]);
		expect(new Set(merged.map((item) => item.id)).size).toBe(2);
	});

	it("没有时间的条目排在最后", () => {
		const merged = sortMessageCenterItems([
			...buildOfficialMessageItems([official({ id: 9, published_at: null })], new Set(), formatTime),
			...buildInappMessageItems([inapp({ id: 9, created_at: "2026-09-24T12:00:00Z" })], formatTime),
		]);

		expect(merged.map((item) => item.id)).toEqual(["inapp-9", "official-9"]);
	});
});

describe("未读计数", () => {
	it("统计两套消息里未读的条目", () => {
		const items = [
			...buildOfficialMessageItems([official({ id: 1 }), official({ id: 2 })], new Set([2]), formatTime),
			...buildInappMessageItems([inapp({ id: 3, read: true }), inapp({ id: 4 })], formatTime),
		];

		expect(countUnreadMessageItems(items)).toBe(2);
	});

	it("全部已读时为 0", () => {
		const items = buildOfficialMessageItems([official({ id: 1 })], new Set([1]), formatTime);

		expect(countUnreadMessageItems(items)).toBe(0);
	});
});

describe("urgent 自动弹出", () => {
	it("未读且没自动弹过时给出该消息 id", () => {
		expect(pickUrgentAutoOpenMessageId([official({ id: 11, level: "urgent" })], new Set(), new Set())).toBe(11);
	});

	it("已读的 urgent 不触发", () => {
		expect(pickUrgentAutoOpenMessageId([official({ id: 11, level: "urgent" })], new Set([11]), new Set())).toBeNull();
	});

	it("自动弹过的 urgent 不再触发（每条只弹一次）", () => {
		expect(pickUrgentAutoOpenMessageId([official({ id: 11, level: "urgent" })], new Set(), new Set([11]))).toBeNull();
	});

	it("只认 urgent，normal / important 不触发", () => {
		const messages = [official({ id: 1 }), official({ id: 2, level: "important" })];

		expect(pickUrgentAutoOpenMessageId(messages, new Set(), new Set())).toBeNull();
	});

	it("多条候选时取最近一条", () => {
		const messages = [
			official({ id: 1, level: "urgent", published_at: "2026-09-20T10:00:00Z" }),
			official({ id: 2, level: "urgent", published_at: "2026-09-24T10:00:00Z" }),
			official({ id: 3, level: "urgent", published_at: null }),
		];

		expect(pickUrgentAutoOpenMessageId(messages, new Set(), new Set())).toBe(2);
	});
});
