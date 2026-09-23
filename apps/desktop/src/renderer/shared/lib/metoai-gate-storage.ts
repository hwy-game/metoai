/**
 * MetaToken 首次使用引导的「跳过」标记。
 *
 * 这是跨引导屏、设置页和侧边栏登录入口共享的本地界面偏好，不属于某一个页面。
 */
const GATE_SKIPPED_STORAGE_KEY = "vetta-metoai-gate-skipped";

/**
 * 标记变化时广播（与 setup-wizard/storage.ts 的完成事件同构）。
 *
 * 首启向导结束时会写这个标记，而全屏引导屏此时已经挂载着——只读一次初值的话，
 * 向导一关它就会补弹一次。写入方负责广播，挂载中的引导屏据此重新读取。
 */
export const METOAI_GATE_SKIPPED_EVENT = "vetta-metoai-gate-skipped-changed";

function notifyGateSkippedChanged(): void {
	try {
		window.dispatchEvent(new Event(METOAI_GATE_SKIPPED_EVENT));
	} catch {
		// 无 window 的环境（测试装配 / 预渲染）：调用方自身的状态更新负责本次会话。
	}
}

export function isMetoAiGateSkipped(): boolean {
	try {
		return localStorage.getItem(GATE_SKIPPED_STORAGE_KEY) === "1";
	} catch {
		// 隐私模式 / 存储被禁：当作已跳过，避免每次启动都弹。
		return true;
	}
}

export function markMetoAiGateSkipped(): void {
	try {
		localStorage.setItem(GATE_SKIPPED_STORAGE_KEY, "1");
	} catch {
		// 忽略配额与隐私模式；本次会话内引导屏仍会消失（由广播与组件状态负责）。
	}
	notifyGateSkippedChanged();
}

/** 退出登录后重新显示登录 / 填 Key 入口。 */
export function clearMetoAiGateSkipped(): void {
	try {
		localStorage.removeItem(GATE_SKIPPED_STORAGE_KEY);
	} catch {
		// 忽略配额与隐私模式；读取侧此时本来就当作已跳过。
	}
	notifyGateSkippedChanged();
}
