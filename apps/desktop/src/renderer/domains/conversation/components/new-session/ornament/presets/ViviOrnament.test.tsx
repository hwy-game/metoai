// @vitest-environment jsdom
/**
 * Vivi 装饰件按插槽（hero 宽度）决定是否渲染：页面被压窄时（窗口小、活动面板/侧边栏展开）
 * 素材右锚会压到选项行与标题上，这时整块 Vivi连同显隐按钮都不该出现。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
	useTranslation: () => ({ t: (key: string) => key }),
}));

import { act, fireEvent, render, screen } from "@testing-library/react";
import { ORNAMENT_MIN_SLOT_WIDTH } from "../../constants";
import { ViviOrnament } from "./ViviOrnament";

type ResizeCallback = (entries: { contentRect: { width: number } }[]) => void;

let resizeCallbacks: ResizeCallback[];
let slotWidth: number;

class ResizeObserverStub {
	constructor(private readonly callback: ResizeCallback) {
		resizeCallbacks.push(callback);
	}
	observe(): void {}
	unobserve(): void {}
	disconnect(): void {}
}

function resizeSlot(width: number): void {
	slotWidth = width;
	act(() => {
		for (const callback of resizeCallbacks) callback([{ contentRect: { width } }]);
	});
}

beforeEach(() => {
	resizeCallbacks = [];
	slotWidth = ORNAMENT_MIN_SLOT_WIDTH;
	vi.stubGlobal("ResizeObserver", ResizeObserverStub);
	vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
		() => ({ width: slotWidth, height: 80 }) as DOMRect,
	);
});

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe("ViviOrnament", () => {
	it("插槽够宽时渲染 Vivi 与显隐按钮", () => {
		slotWidth = ORNAMENT_MIN_SLOT_WIDTH;
		render(<ViviOrnament autoplay={false} mounted />);

		expect(screen.getByRole("button", { name: "newSession.mascot.hideMascot" })).toBeTruthy();
	});

	it("插槽过窄时整块 Vivi不渲染", () => {
		slotWidth = ORNAMENT_MIN_SLOT_WIDTH - 1;
		render(<ViviOrnament autoplay={false} mounted />);

		expect(screen.queryByRole("button", { name: "newSession.mascot.hideMascot" })).toBeNull();
	});

	it("插槽被压窄后收起、变宽后恢复", () => {
		render(<ViviOrnament autoplay={false} mounted />);

		resizeSlot(ORNAMENT_MIN_SLOT_WIDTH - 40);
		expect(screen.queryByRole("button", { name: "newSession.mascot.hideMascot" })).toBeNull();

		resizeSlot(ORNAMENT_MIN_SLOT_WIDTH + 40);
		expect(screen.getByRole("button", { name: "newSession.mascot.hideMascot" })).toBeTruthy();
	});
});

describe("ViviOrnament 自动播放", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		// 固定随机：初始动作取 blink（不走爬行那条分支），空闲间隔取最小值 4s。
		vi.spyOn(Math, "random").mockReturnValue(0);
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("挂载后自己动第一下，不需要点播放按钮", () => {
		const { container } = render(<ViviOrnament autoplay mounted />);
		expect(videoAutoplay(container)).toBe(false);
		expect(screen.getByRole("button", { name: "newSession.mascot.playOnce" })).toBeTruthy();

		act(() => {
			vi.advanceTimersByTime(1_000);
		});

		expect(videoAutoplay(container)).toBe(true);
		expect(screen.queryByRole("button", { name: "newSession.mascot.playOnce" })).toBeNull();
	});

	it("一次动作播完后隔几秒再动下一次", () => {
		const { container } = render(<ViviOrnament autoplay mounted />);
		act(() => {
			vi.advanceTimersByTime(1_000);
		});
		const playing = container.querySelector("video");
		expect(playing).not.toBeNull();

		act(() => {
			if (playing) fireEvent.ended(playing);
		});
		expect(videoAutoplay(container)).toBe(false);

		act(() => {
			vi.advanceTimersByTime(4_000);
		});
		expect(videoAutoplay(container)).toBe(true);
	});

	it("关掉头像动效时不自动播放", () => {
		const { container } = render(<ViviOrnament autoplay={false} mounted />);

		act(() => {
			vi.advanceTimersByTime(60_000);
		});

		expect(videoAutoplay(container)).toBe(false);
	});
});

/** 静息态是没开 autoplay 的静止帧，播放态才是带 autoplay 的那枚。 */
function videoAutoplay(container: HTMLElement): boolean {
	return container.querySelector("video")?.autoplay ?? false;
}
