// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
	addAutoOpenedUrgentMessageId,
	addReadOfficialMessageIds,
	DEFAULT_MESSAGE_CENTER_LOCAL_STATE,
	MESSAGE_CENTER_STORAGE_KEY,
	normalizeMessageCenterLocalState,
	readMessageCenterLocalState,
	writeMessageCenterLocalState,
} from "./message-center-storage";

beforeEach(() => {
	localStorage.clear();
});

describe("消息中心本地状态归一", () => {
	it("缺失或损坏的存储回退到默认值", () => {
		expect(normalizeMessageCenterLocalState(null)).toEqual(DEFAULT_MESSAGE_CENTER_LOCAL_STATE);
		expect(normalizeMessageCenterLocalState("nope")).toEqual(DEFAULT_MESSAGE_CENTER_LOCAL_STATE);
		expect(normalizeMessageCenterLocalState({ readOfficialIds: "1,2" })).toEqual({
			schemaVersion: 1,
			readOfficialIds: [],
			autoOpenedUrgentIds: [],
		});
	});

	it("丢掉非法 id 并去重", () => {
		expect(
			normalizeMessageCenterLocalState({
				schemaVersion: 1,
				readOfficialIds: [3, 3, -1, 0, 1.5, "4", null, 7],
				autoOpenedUrgentIds: [9],
			}),
		).toEqual({ schemaVersion: 1, readOfficialIds: [3, 7], autoOpenedUrgentIds: [9] });
	});

	it("不认识的更高版本按默认值处理", () => {
		expect(normalizeMessageCenterLocalState({ schemaVersion: 99, readOfficialIds: [1] })).toEqual(
			DEFAULT_MESSAGE_CENTER_LOCAL_STATE,
		);
	});
});

describe("消息中心本地状态读写", () => {
	it("写盘后能原样读回（重装即重置 = 只存本地）", () => {
		writeMessageCenterLocalState({ schemaVersion: 1, readOfficialIds: [1, 2], autoOpenedUrgentIds: [2] });

		expect(JSON.parse(localStorage.getItem(MESSAGE_CENTER_STORAGE_KEY) ?? "null")).toEqual({
			schemaVersion: 1,
			readOfficialIds: [1, 2],
			autoOpenedUrgentIds: [2],
		});
		expect(readMessageCenterLocalState()).toEqual({
			schemaVersion: 1,
			readOfficialIds: [1, 2],
			autoOpenedUrgentIds: [2],
		});
	});

	it("空存储读到默认值", () => {
		expect(readMessageCenterLocalState()).toEqual(DEFAULT_MESSAGE_CENTER_LOCAL_STATE);
	});
});

describe("已读与自动弹出记录", () => {
	it("追加已读 id 时去重", () => {
		const state = addReadOfficialMessageIds(DEFAULT_MESSAGE_CENTER_LOCAL_STATE, [5, 5, 6]);
		const next = addReadOfficialMessageIds(state, [6, 7]);

		expect(next.readOfficialIds).toEqual([5, 6, 7]);
		expect(next.autoOpenedUrgentIds).toEqual([]);
	});

	it("urgent 自动弹出记录只影响 autoOpenedUrgentIds", () => {
		const state = addAutoOpenedUrgentMessageId(
			{ schemaVersion: 1, readOfficialIds: [1], autoOpenedUrgentIds: [] },
			4,
		);

		expect(state).toEqual({ schemaVersion: 1, readOfficialIds: [1], autoOpenedUrgentIds: [4] });
	});

	it("同一个 urgent id 重复记录不会重复出现", () => {
		const once = addAutoOpenedUrgentMessageId(DEFAULT_MESSAGE_CENTER_LOCAL_STATE, 4);
		const twice = addAutoOpenedUrgentMessageId(once, 4);

		expect(twice.autoOpenedUrgentIds).toEqual([4]);
	});
});
