// i18n 共享常量 / 类型 / locale 归一化。被 main 进程、renderer、preload 三处共用，
// 故放 src/shared（main 用相对 ../shared 引、renderer 用 @/shared 引）。

/**
 * 当前支持的界面语言（catalog 键）。
 * 新增语言 = 这里加一项 + 补 locales/<lang>/*.json（key 必须与 en 完全一致）
 * + 在 FIXED_LANGUAGE_OPTIONS 补自称 + 重新构建。
 */
export const SUPPORTED_LANGUAGES = ["zh", "en", "es", "fr", "id", "vi", "ru", "ja"] as const;
export type AppLanguage = (typeof SUPPORTED_LANGUAGES)[number];

/**
 * 用户语言偏好（desktop-config.language 持久化值）。
 * - system：跟随 OS locale，启动时解析为 AppLanguage
 * - 其余项：固定语言，取值集合与 SUPPORTED_LANGUAGES 一致
 */
export const LANGUAGE_PREFERENCES = ["system", ...SUPPORTED_LANGUAGES] as const;
export type LanguagePreference = (typeof LANGUAGE_PREFERENCES)[number];

/** 用户未写过 language 时的默认偏好：跟随系统。 */
export const DEFAULT_LANGUAGE_PREFERENCE: LanguagePreference = "system";

/**
 * 系统 locale 无法解析（空串 / 读取失败）时的最终兜底 UI 语言。
 * 与 FALLBACK_LANGUAGES 分离：无法推断时的默认语言 vs 缺译回退语言。
 */
export const DEFAULT_LANGUAGE: AppLanguage = "en";

/**
 * 缺译回退链：先回退英文（所有新增语言的通用兜底），再回退中文。
 * 中文殿后是 ADR-0031 的遗留约定（框架先行时 en 未填），现在 en 已与 zh 全量对齐，
 * 故正常路径不会走到第二项；保留它只为「绝不暴露原始 key」。
 */
export const FALLBACK_LANGUAGES = ["en", "zh"] as const;

/**
 * 语言选择器用的固定语言项：native = 语种自称，alt = 英文名（与 native 相同则 UI 不重复展示）。
 * system 项的 label 由 i18n 注入，不在这里。
 */
export const FIXED_LANGUAGE_OPTIONS: ReadonlyArray<{
	value: AppLanguage;
	native: string;
	alt: string;
}> = [
	{ value: "zh", native: "中文", alt: "Chinese" },
	{ value: "en", native: "English", alt: "English" },
	{ value: "es", native: "Español", alt: "Spanish" },
	{ value: "fr", native: "Français", alt: "French" },
	{ value: "id", native: "Bahasa Indonesia", alt: "Indonesian" },
	{ value: "vi", native: "Tiếng Việt", alt: "Vietnamese" },
	{ value: "ru", native: "Русский", alt: "Russian" },
	{ value: "ja", native: "日本語", alt: "Japanese" },
];

/** 命名空间：按 renderer domain 切分 + common（基础件）+ main（主进程原生 UI）。 */
export const NAMESPACES = [
	"common",
	"main",
	"chat",
	"project",
	"pet",
	"settings",
	"message",
	"skills",
	"abilities",
	"batch-tasks",
	"automation",
	"agent-teams",
	"metoai",
] as const;
export type Namespace = (typeof NAMESPACES)[number];

export function isSupportedLanguage(value: unknown): value is AppLanguage {
	return typeof value === "string" && (SUPPORTED_LANGUAGES as readonly string[]).includes(value);
}

export function isLanguagePreference(value: unknown): value is LanguagePreference {
	return typeof value === "string" && (LANGUAGE_PREFERENCES as readonly string[]).includes(value);
}

/**
 * 主语言子标签 → AppLanguage。`in` 是印尼语的旧 ISO 639-1 码，Chromium 在部分平台仍会给出。
 * 表里没有的语种一律落到 DEFAULT_LANGUAGE（英文），即「认不出就用英文」。
 */
const PRIMARY_LANGUAGE_TAGS: Record<string, AppLanguage> = {
	zh: "zh",
	en: "en",
	es: "es",
	fr: "fr",
	id: "id",
	in: "id",
	vi: "vi",
	ru: "ru",
	ja: "ja",
};

/**
 * 将 OS / Chromium / navigator locale 归一到 AppLanguage。
 * 只看主语言子标签（zh-CN、es-419、pt-BR… 的小写 + `-` 归一化形式），
 * 中文族（zh、zh-CN、zh-Hans、zh-TW…）→ zh；识别不了或空串 → DEFAULT_LANGUAGE。
 */
export function resolveAppLanguageFromLocale(locale: string | null | undefined): AppLanguage {
	const raw = (locale ?? "").trim().toLowerCase().replace(/_/g, "-");
	if (!raw) return DEFAULT_LANGUAGE;
	const primary = raw.split("-")[0] ?? "";
	return PRIMARY_LANGUAGE_TAGS[primary] ?? DEFAULT_LANGUAGE;
}

/** 偏好 → 实际 catalog 语言。system 时用 systemLocale 解析。 */
export function resolveAppLanguage(
	preference: LanguagePreference,
	systemLocale: string | null | undefined,
): AppLanguage {
	if (preference === "system") return resolveAppLanguageFromLocale(systemLocale);
	return preference;
}

/** IPC / preload 首启与切换广播的统一载荷。 */
export interface LanguageState {
	/** 用户偏好（含 system）。 */
	preference: LanguagePreference;
	/** 解析后的实际界面语言（i18next lng）。 */
	language: AppLanguage;
}
