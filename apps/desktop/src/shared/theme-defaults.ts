/**
 * 主进程与渲染进程共用的主题默认值。
 *
 * 渲染层的首屏着色（`renderer/shared/theme/apply.ts`）与主进程的原生控件、窗口底色
 * 必须取同一份默认明暗，否则系统处于深色模式时首启会出现「窗口是深色、页面是浅色」。
 */

/** 明暗模式：浅色 / 深色 / 跟随系统。 */
export type ThemeMode = "light" | "dark" | "auto";

/** 已解析的明暗。 */
export type ResolvedMode = "light" | "dark";

/** 首次启动（本地没有存过模式）时的默认明暗：浅色。 */
export const DEFAULT_THEME_MODE = "light" satisfies ThemeMode;

/**
 * 首帧尚未解析前的兜底明暗，必须与 {@link DEFAULT_THEME_MODE} 一致。
 * 默认模式若改成 auto，这里会因类型不匹配报错，届时需要显式决定兜底值。
 */
export const DEFAULT_RESOLVED_MODE: ResolvedMode = DEFAULT_THEME_MODE;

/**
 * 非 macOS 的窗口底色，取渲染层浅/深基色（macOS 走 vibrancy，不使用这两个值）。
 * 页面着色前窗口先按默认明暗绘制，避免露出系统深色底。
 */
export const WINDOW_SURFACE_COLORS: Record<ResolvedMode, string> = {
	light: "#f5f5f7",
	dark: "#161616",
};
