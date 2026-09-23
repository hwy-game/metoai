// @vitest-environment jsdom
/**
 * 强制更新覆盖层是最后一道锁：策略要求强制更新时，用户必须先完成更新才能继续用。
 * 这里锁住它的三条边界——该出现时必须出现、Esc 与点击遮罩都不能关掉它、不该出现时绝不出现。
 * 出现条件只有 `forced && hasUpdate`：服务端说强制但没有任何可交付的更新时不能锁住用户，
 * 后台重查的 `checking` 期间 hasUpdate 仍为真，覆盖层也不能跟着闪。
 */
import type { UpdaterState } from "@preload/api";
import { useShortcutScope } from "@shared/shortcuts";
import { updaterStateAtom } from "@shared/store/atoms";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createStore, Provider } from "jotai";
import { describe, expect, it, vi } from "vitest";
import { UpdateRequiredOverlay } from "./UpdateRequiredOverlay";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

function forcedState(overrides: Partial<UpdaterState> = {}): UpdaterState {
	return {
		phase: "ready",
		currentVersion: "0.5.21",
		hasUpdate: true,
		latestVersion: "0.6.0",
		releaseNote: "Release notes",
		progress: 1,
		forced: true,
		forceReason: "min_supported",
		...overrides,
	};
}

function renderOverlay(state: UpdaterState): void {
	const store = createStore();
	store.set(updaterStateAtom, state);
	render(
		<Provider store={store}>
			<UpdateRequiredOverlay />
		</Provider>,
	);
}

describe("UpdateRequiredOverlay", () => {
	it("服务端要求强制更新且更新已就绪时，渲染阻塞式覆盖层并只给出「重启」一条出路", () => {
		renderOverlay(forcedState());

		expect(screen.getByTestId("update-required-overlay")).toBeTruthy();
		expect(screen.getByRole("alertdialog").getAttribute("aria-modal")).toBe("true");
		expect(screen.getByText("updater.forced.title")).toBeTruthy();
		expect(screen.getByText("updater.forced.reasonMinSupported")).toBeTruthy();
		expect(screen.getByTestId("update-required-status").textContent).toBe("updater.forced.ready");
		// 覆盖层里只有「继续更新」一个按钮，没有任何关闭入口。
		expect(screen.getAllByRole("button")).toHaveLength(1);
		expect(screen.getByTestId("update-required-action").textContent).toBe("updater.forced.restart");
	});

	it("强制更新下载中时展示进度", () => {
		renderOverlay(forcedState({ phase: "downloading", progress: 0.42 }));

		expect(screen.getByTestId("update-required-overlay")).toBeTruthy();
		expect(screen.getByTestId("update-required-progress").getAttribute("aria-valuenow")).toBe("42");
		expect(screen.getByTestId("update-required-status").textContent).toBe("updater.forced.downloading");
	});

	it("按下 Esc 不关闭覆盖层，独占的 modal 作用域会吞掉下层 Esc 绑定", async () => {
		const store = createStore();
		store.set(updaterStateAtom, forcedState());
		const closeOnEscape = vi.fn();
		function EscapeCloser(): JSX.Element | null {
			useShortcutScope({
				id: "app:test-escape",
				kind: "app",
				bindings: [{ key: "escape", run: closeOnEscape }],
			});
			return null;
		}

		const keydowns: string[] = [];
		const recordKeydown = (event: KeyboardEvent) => keydowns.push(event.key);
		document.addEventListener("keydown", recordKeydown);
		try {
			render(
				<Provider store={store}>
					<EscapeCloser />
					<UpdateRequiredOverlay />
				</Provider>,
			);

			await userEvent.keyboard("{Escape}");

			// Esc 确实被派发过，否则下面两条断言只是恒真。
			expect(keydowns).toEqual(["Escape"]);
			expect(closeOnEscape).not.toHaveBeenCalled();
			expect(screen.getByTestId("update-required-overlay")).toBeTruthy();
		} finally {
			document.removeEventListener("keydown", recordKeydown);
		}
	});

	it("点击遮罩也不关闭覆盖层", () => {
		renderOverlay(forcedState());
		const overlay = screen.getByTestId("update-required-overlay");
		const clicked: (EventTarget | null)[] = [];
		const recordClick = (event: MouseEvent) => clicked.push(event.target);
		document.addEventListener("click", recordClick);
		try {
			fireEvent.click(overlay);

			// 点击确实落在遮罩上，否则断言只是恒真。
			expect(clicked).toEqual([overlay]);
			expect(screen.getByTestId("update-required-overlay")).toBeTruthy();
		} finally {
			document.removeEventListener("click", recordClick);
		}
	});

	it("非强制更新时不渲染阻塞覆盖层", () => {
		renderOverlay(forcedState({ forced: false, forceReason: "" }));

		expect(screen.queryByTestId("update-required-overlay")).toBeNull();
	});

	it("要求强制更新但没有任何可交付的更新时不展示（安全阀）", () => {
		renderOverlay(forcedState({ hasUpdate: false, phase: "idle", latestVersion: undefined, progress: undefined }));

		expect(screen.queryByTestId("update-required-overlay")).toBeNull();
	});

	// 本次修复的回归点：判据从 `phase !== "idle"` 换成 `hasUpdate`。服务端说强制、
	// 但没有任何真的能装到的更新时不能锁住用户。
	it("服务端要求强制更新但没有任何可交付的更新时不锁住用户", () => {
		renderOverlay(forcedState({ hasUpdate: false }));

		expect(screen.queryByTestId("update-required-overlay")).toBeNull();
	});

	it("服务端要求强制更新但状态里还没有 hasUpdate 信号时不展示", () => {
		renderOverlay(forcedState({ hasUpdate: undefined }));

		expect(screen.queryByTestId("update-required-overlay")).toBeNull();
	});

	// 后台重查会把 phase 打回 checking，此时 hasUpdate 仍为真，覆盖层必须留在原地，
	// 否则用户看到的是弹窗跟着检查节奏反复出现又消失。
	it("后台重查期间只要还有可交付的更新，覆盖层就不闪烁", () => {
		renderOverlay(forcedState({ phase: "checking", hasUpdate: true }));

		expect(screen.getByTestId("update-required-overlay")).toBeTruthy();
		expect(screen.getByTestId("update-required-status").textContent).toBe("updater.forced.checking");
	});
});
