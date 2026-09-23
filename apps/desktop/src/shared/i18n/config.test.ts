import { describe, expect, it } from "vitest";
import {
	FALLBACK_LANGUAGES,
	FIXED_LANGUAGE_OPTIONS,
	isLanguagePreference,
	isSupportedLanguage,
	LANGUAGE_PREFERENCES,
	resolveAppLanguage,
	resolveAppLanguageFromLocale,
	SUPPORTED_LANGUAGES,
} from "./config.js";

describe("i18n config", () => {
	it("offers every supported language plus system as a preference", () => {
		expect([...LANGUAGE_PREFERENCES]).toEqual(["system", ...SUPPORTED_LANGUAGES]);
	});

	it("labels every fixed language exactly once, in SUPPORTED_LANGUAGES order", () => {
		expect(FIXED_LANGUAGE_OPTIONS.map((option) => option.value)).toEqual([...SUPPORTED_LANGUAGES]);
	});

	it("keeps every fallback language actually supported", () => {
		for (const language of FALLBACK_LANGUAGES) {
			expect(isSupportedLanguage(language)).toBe(true);
		}
	});

	it("accepts every supported language as a preference and rejects unknown ones", () => {
		for (const language of SUPPORTED_LANGUAGES) {
			expect(isLanguagePreference(language)).toBe(true);
		}
		expect(isLanguagePreference("system")).toBe(true);
		expect(isLanguagePreference("pt")).toBe(false);
		expect(isLanguagePreference("")).toBe(false);
		expect(isLanguagePreference(undefined)).toBe(false);
	});

	describe("resolveAppLanguageFromLocale", () => {
		it.each([
			["zh", "zh"],
			["zh-CN", "zh"],
			["zh-Hans", "zh"],
			["zh_TW", "zh"],
			["en-US", "en"],
			["es-419", "es"],
			["fr-FR", "fr"],
			["id-ID", "id"],
			["in-ID", "id"],
			["vi-VN", "vi"],
			["ru-RU", "ru"],
			["ja-JP", "ja"],
			["JA-jp", "ja"],
			["ES", "es"],
		])("maps %s to %s", (locale, expected) => {
			expect(resolveAppLanguageFromLocale(locale)).toBe(expected);
		});

		it("falls back to the default language for empty or unrecognized locales", () => {
			for (const locale of ["", "   ", null, undefined, "pt-BR", "de-DE", "-"]) {
				expect(resolveAppLanguageFromLocale(locale)).toBe("en");
			}
		});
	});

	describe("resolveAppLanguage", () => {
		it("resolves system through the OS locale", () => {
			expect(resolveAppLanguage("system", "ja-JP")).toBe("ja");
			expect(resolveAppLanguage("system", "pt-BR")).toBe("en");
		});

		it("ignores the OS locale for a pinned language", () => {
			expect(resolveAppLanguage("ru", "en-US")).toBe("ru");
		});
	});
});
