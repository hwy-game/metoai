/**
 * 「应用回到前台」的判定闸门。
 *
 * Electron 的 `browser-window-focus` / `browser-window-blur` 是 app 级事件：任何窗口
 * 获得或失去焦点都会触发，因此只能当作「应用回到前台」的近似，不能直接拿来当触发源——
 * alt-tab、系统弹窗、输入法候选框都会让事件连发。这里要求「真的离开过一段时间」：
 * 失焦时记下时刻，重新获得焦点时与它比较，不足 `minAwayMs` 就当作抖动丢弃。
 *
 * 判定抽成纯逻辑是为了能直接单测边界；Electron 事件订阅留在宿主（见 updater.ts）。
 */
export interface ForegroundGate {
	/** 应用失去焦点（任一窗口 blur）。 */
	noteBlur(): void;
	/** 应用重新获得焦点；返回 true 表示这一次算「回到前台」。 */
	shouldFireOnFocus(): boolean;
}

export interface ForegroundGateOptions {
	/** 少于这个时长的离开不算回到前台。 */
	minAwayMs: number;
	/** 可注入的时钟，便于测试。 */
	now?: () => number;
}

export function createForegroundGate({ minAwayMs, now = Date.now }: ForegroundGateOptions): ForegroundGate {
	let lastBlurAt: number | null = null;
	return {
		noteBlur(): void {
			lastBlurAt = now();
		},
		shouldFireOnFocus(): boolean {
			if (lastBlurAt === null) return false;
			const awayMs = now() - lastBlurAt;
			// 每次获得焦点都消费掉这次失焦记录：短暂离开后回来不算回到前台，也不会把这段
			// 离开时长累计到下一次焦点事件上（否则「alt-tab 出去 1 秒、10 分钟后再切回来」
			// 会被误判成一次长时间的离开）。
			lastBlurAt = null;
			return awayMs >= minAwayMs;
		},
	};
}
