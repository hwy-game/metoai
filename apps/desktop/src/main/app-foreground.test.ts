/**
 * 「应用回到前台」的判定边界。
 *
 * 这里只测纯逻辑：宿主（updater.ts）把 Electron 的 app 级 focus/blur 事件喂进来，
 * 真正的问题是「哪些焦点事件值得当成回到前台」，而不是事件有没有接上。
 */
import { describe, expect, it } from "vitest";

import { createForegroundGate } from "./app-foreground.js";

const MIN_AWAY_MS = 30_000;

/** 可控时钟：判定边界是时间差，测试不该真的等 30 秒。 */
function createClock(): { now: () => number; advance: (ms: number) => void } {
	let current = 1_000_000;
	return {
		now: () => current,
		advance: (ms: number) => {
			current += ms;
		},
	};
}

describe("createForegroundGate", () => {
	it("does not fire while the app never lost focus", () => {
		const gate = createForegroundGate({ minAwayMs: MIN_AWAY_MS });

		expect(gate.shouldFireOnFocus()).toBe(false);
	});

	it("ignores an alt-tab that returns before the threshold", () => {
		const clock = createClock();
		const gate = createForegroundGate({ minAwayMs: MIN_AWAY_MS, now: clock.now });

		gate.noteBlur();
		clock.advance(MIN_AWAY_MS - 1);

		expect(gate.shouldFireOnFocus()).toBe(false);
	});

	it("fires on the threshold and not before it", () => {
		const clock = createClock();
		const gate = createForegroundGate({ minAwayMs: MIN_AWAY_MS, now: clock.now });

		gate.noteBlur();
		clock.advance(MIN_AWAY_MS);

		expect(gate.shouldFireOnFocus()).toBe(true);
	});

	it("requires a new blur before it can fire again", () => {
		const clock = createClock();
		const gate = createForegroundGate({ minAwayMs: MIN_AWAY_MS, now: clock.now });

		gate.noteBlur();
		clock.advance(MIN_AWAY_MS * 2);
		expect(gate.shouldFireOnFocus()).toBe(true);

		// 同一次离开只算一次回到前台：焦点事件可能重复到达（切窗口、系统弹窗）。
		clock.advance(MIN_AWAY_MS * 2);
		expect(gate.shouldFireOnFocus()).toBe(false);

		gate.noteBlur();
		clock.advance(MIN_AWAY_MS);
		expect(gate.shouldFireOnFocus()).toBe(true);
	});

	it("does not accumulate a short away period into a later focus event", () => {
		const clock = createClock();
		const gate = createForegroundGate({ minAwayMs: MIN_AWAY_MS, now: clock.now });

		gate.noteBlur();
		clock.advance(1_000);
		expect(gate.shouldFireOnFocus()).toBe(false);

		// 没有新的失焦，就不该把 1 秒前那次短暂离开算成「离开很久」。
		clock.advance(MIN_AWAY_MS * 10);
		expect(gate.shouldFireOnFocus()).toBe(false);
	});
});
