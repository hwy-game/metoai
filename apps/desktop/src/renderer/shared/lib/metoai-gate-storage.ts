/**
 * MetaToken 首次使用引导的「跳过」标记。
 *
 * 这是跨引导屏、设置页和侧边栏登录入口共享的本地界面偏好，不属于某一个页面。
 */
const GATE_SKIPPED_STORAGE_KEY = "vetta-metoai-gate-skipped";

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
		// 忽略配额与隐私模式；本次会话内引导屏仍会消失（由组件状态负责）。
	}
}

/** 退出登录后重新显示登录 / 填 Key 入口。 */
export function clearMetoAiGateSkipped(): void {
	try {
		localStorage.removeItem(GATE_SKIPPED_STORAGE_KEY);
	} catch {
		// 忽略配额与隐私模式；读取侧此时本来就当作已跳过。
	}
}
