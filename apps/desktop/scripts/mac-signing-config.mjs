export const MAC_SIGNING_ENV_KEYS = [
	"CSC_LINK",
	"CSC_NAME",
	"CSC_KEY_PASSWORD",
	"APPLE_TEAM_ID",
	"APPLE_ID",
	"APPLE_APP_SPECIFIC_PASSWORD",
	"APPLE_API_KEY",
	"APPLE_API_KEY_ID",
	"APPLE_API_ISSUER",
];

// macOS 产物的三种签名模式，构建侧一律按 mode 分支（不要各自再判断“有没有签名”）。
// 三种模式的用户可见差异见 docs/deploy/apple-code-signing.md：
// - signed：凭据齐全 → Developer ID 签名 + hardened runtime + 公证，用户双击 DMG 直接启动，
//   自动更新可用。
// - adhoc：一个凭据都没有 → electron-builder 以 identity "-" 做 ad-hoc 签名。用户不再看到
//   「已损坏」，改为「未知开发者」，首次打开需要右键→打开，或到「系统设置 → 隐私与安全性 →
//   仍要打开」放行；ad-hoc 签名每次构建都不同，mac 自动更新不可用。
// - unsigned：显式 VETTA_MAC_ADHOC_SIGN=0 → 完全不签名，用户只能靠 DMG 里的
//   「修复已损坏.app」摘掉隔离属性。
export const MAC_SIGNING_MODES = Object.freeze({
	SIGNED: "signed",
	ADHOC: "adhoc",
	UNSIGNED: "unsigned",
});

function hasValue(env, key) {
	return typeof env[key] === "string" && env[key].trim().length > 0;
}

function readZeroOneFlag(env, key) {
	const value = env[key]?.trim();
	if (value && value !== "0" && value !== "1") {
		throw new Error(`${key} must be "0" or "1"`);
	}
	return value;
}

export function hasMacSigningEnvironment(env = process.env) {
	return MAC_SIGNING_ENV_KEYS.some((key) => hasValue(env, key));
}

export function resolveMacSigningConfig(env = process.env) {
	const skipNotarizeValue = readZeroOneFlag(env, "VETTA_SKIP_NOTARIZE");
	// ad-hoc 是缺省回退，显式设 0 才退回完全未签名；值非法直接报错，避免静默产出意外产物。
	const adhocValue = readZeroOneFlag(env, "VETTA_MAC_ADHOC_SIGN");

	if (!hasMacSigningEnvironment(env)) {
		if (skipNotarizeValue === "1") {
			throw new Error("VETTA_SKIP_NOTARIZE=1 requires macOS signing credentials");
		}
		return {
			mode: adhocValue === "0" ? MAC_SIGNING_MODES.UNSIGNED : MAC_SIGNING_MODES.ADHOC,
		};
	}

	const skipNotarize = skipNotarizeValue === "1";
	const missing = [];
	if (!hasValue(env, "CSC_LINK") && !hasValue(env, "CSC_NAME")) {
		missing.push("CSC_LINK or CSC_NAME");
	}
	if (!hasValue(env, "APPLE_TEAM_ID")) missing.push("APPLE_TEAM_ID");
	if (!skipNotarize) {
		const hasApiKey =
			hasValue(env, "APPLE_API_KEY") &&
			hasValue(env, "APPLE_API_KEY_ID") &&
			hasValue(env, "APPLE_API_ISSUER");
		const hasAppleId =
			hasValue(env, "APPLE_ID") && hasValue(env, "APPLE_APP_SPECIFIC_PASSWORD");
		if (!hasApiKey && !hasAppleId) {
			missing.push(
				"APPLE_API_KEY + APPLE_API_KEY_ID + APPLE_API_ISSUER, or APPLE_ID + APPLE_APP_SPECIFIC_PASSWORD",
			);
		}
	}
	if (missing.length > 0) {
		throw new Error(
			`macOS signing credentials are incomplete; missing: ${missing.join("; ")}. ` +
				"See docs/deploy/apple-code-signing.md, or clear all CSC_* and APPLE_* variables " +
				"for an ad-hoc signed build (VETTA_MAC_ADHOC_SIGN=0 for a fully unsigned build).",
		);
	}

	return {
		mode: MAC_SIGNING_MODES.SIGNED,
		notarize: !skipNotarize,
		teamId: env.APPLE_TEAM_ID.trim(),
	};
}
