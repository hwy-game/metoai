import { copyFileSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

const PACKAGE_VERSION_PATTERN = /^[0-9A-Za-z][0-9A-Za-z.+-]{0,63}$/;

function resolveWindowsVersionedBinary(unpackedRoot) {
	const pointerPath = join(unpackedRoot, "current.json");
	let pointer;
	try {
		pointer = JSON.parse(readFileSync(pointerPath, "utf8"));
	} catch (error) {
		throw new Error(`Cannot read Windows packaged version pointer: ${pointerPath}`, { cause: error });
	}

	const version = pointer?.version;
	if (
		typeof version !== "string" ||
		version === "." ||
		version === ".." ||
		!PACKAGE_VERSION_PATTERN.test(version)
	) {
		throw new Error(`Windows packaged E2E has an invalid version pointer: ${String(version)}`);
	}
	return join(unpackedRoot, "versions", version, "Vetta.exe");
}

export function resolvePackagedE2eAppImagePath(packageRoot, version) {
	if (typeof version !== "string" || !PACKAGE_VERSION_PATTERN.test(version)) {
		throw new Error(`Linux packaged E2E has an invalid application version: ${String(version)}`);
	}
	const releaseRoot = join(packageRoot, "release");
	// AppImage 的产物名由构建配置的产品名推导（默认 `${productName}-${version}.AppImage`），
	// 因此按扩展名 + 版本号定位，不写死品牌名。
	const candidates = existsSync(releaseRoot)
		? readdirSync(releaseRoot).filter((fileName) => fileName.endsWith(".AppImage") && fileName.includes(version))
		: [];
	if (candidates.length === 1) return join(releaseRoot, candidates[0]);
	throw new Error(
		`Linux packaged E2E AppImage not found for ${version} in ${releaseRoot} (found ${candidates.length}). Run bun run dist:linux:test first.`,
	);
}

export function stagePackagedE2eAppImage(packageRoot, version, temporaryRoot = tmpdir()) {
	const sourcePath = resolvePackagedE2eAppImagePath(packageRoot, version);
	const stagingRoot = mkdtempSync(join(temporaryRoot, "vetta-packaged-e2e-appimage-"));
	const appImagePath = join(stagingRoot, basename(sourcePath));
	try {
		copyFileSync(sourcePath, appImagePath);
		return { appImagePath, stagingRoot };
	} catch (error) {
		rmSync(stagingRoot, { recursive: true, force: true });
		throw error;
	}
}

export function resolvePackagedE2eBinaryPath(packageRoot, platform = process.platform) {
	const releaseRoot = join(packageRoot, "release");
	const candidates =
		platform === "win32"
			? [resolveWindowsVersionedBinary(join(releaseRoot, "win-unpacked"))]
			: platform === "darwin"
				? [
						join(releaseRoot, "mac-arm64", "Vetta.app", "Contents", "MacOS", "Vetta"),
						join(releaseRoot, "mac", "Vetta.app", "Contents", "MacOS", "Vetta"),
						join(releaseRoot, "mac-x64", "Vetta.app", "Contents", "MacOS", "Vetta"),
					]
				: platform === "linux"
					? [join(releaseRoot, "linux-unpacked", "Vetta")]
					: [];

	const found = candidates.find((candidate) => existsSync(candidate));
	if (found) return found;
	throw new Error(
		[
			`Packaged Electron binary not found for ${platform}. Run a pack script for this platform first, e.g.:`,
			"  bun run pack:win:test",
			"  bun run pack:linux:test",
			`Tried:\n${candidates.map((candidate) => `  - ${candidate}`).join("\n")}`,
		].join("\n"),
	);
}
