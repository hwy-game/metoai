/**
 * 引导屏的「跳过」标记。
 *
 * 引导屏只在首次使用且未接入 MetaToken 时出现；用户明确跳过之后就不再拦截，
 * 否则每次启动都要先关掉它。登录入口在设置 → MetaToken 里一直可用，跳过不等于
 * 放弃这个能力。与 `shared/setup-wizard/storage.ts` 一样用 localStorage：这是一条
 * 纯界面偏好，丢了只会让引导屏再出现一次。
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

/**
 * 退出登录时清掉「已跳过」标记：用户主动登出后，下次启动要重新给出登录 / 填 Key 入口，
 * 否则引导屏会一直按「用户已经做过选择」处理。
 */
export function clearMetoAiGateSkipped(): void {
	try {
		localStorage.removeItem(GATE_SKIPPED_STORAGE_KEY);
	} catch {
		// 忽略配额与隐私模式；读取侧此时本来就当作已跳过。
	}
}
