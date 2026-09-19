import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve, win32 } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { parse } from "yaml";
import { findWindowsSupplementalArtifacts } from "./windows-packaging-contract.mjs";

const execFileAsync = promisify(execFile);
const packageDir = resolve(import.meta.dirname, "..");
const defaultReleaseDir = join(packageDir, "release");

async function assertNonEmptyFile(filePath) {
	const info = await stat(filePath);
	if (!info.isFile() || info.size === 0) {
		throw new Error(`[verify-windows-packages] expected a non-empty file: ${filePath}`);
	}
}

function requireOneSupplementalArtifact(fileNames, extension, releaseDir) {
	const matches = fileNames.filter((fileName) => fileName.endsWith(extension));
	if (matches.length !== 1) {
		throw new Error(
			`[verify-windows-packages] expected one ${extension} package in ${releaseDir}, found ${matches.length}`,
		);
	}
	return matches[0];
}

async function findFiles(root, fileName, relativeRoot = "") {
	const matches = [];
	for (const entry of await readdir(join(root, relativeRoot), { withFileTypes: true })) {
		const relativePath = join(relativeRoot, entry.name);
		if (entry.isDirectory()) {
			matches.push(...(await findFiles(root, fileName, relativePath)));
		} else if (entry.isFile() && entry.name.toLowerCase() === fileName.toLowerCase()) {
			matches.push(join(root, relativePath));
		}
	}
	return matches;
}

async function isValidLayoutRoot(root, expectedVersion) {
	try {
		const manifest = JSON.parse(await readFile(join(root, "current.json"), "utf8"));
		if (manifest?.version !== expectedVersion) return false;
		await Promise.all([
			assertNonEmptyFile(join(root, "Vetta.exe")),
			assertNonEmptyFile(join(root, "versions", expectedVersion, "Vetta.exe")),
			assertNonEmptyFile(join(root, "versions", expectedVersion, "resources", "app.asar")),
		]);
		return true;
	} catch {
		return false;
	}
}

export async function verifyExtractedWindowsLayout(root, expectedVersion) {
	const manifests = await findFiles(root, "current.json");
	const validRoots = [];
	for (const manifestPath of manifests) {
		const candidateRoot = dirname(manifestPath);
		if (await isValidLayoutRoot(candidateRoot, expectedVersion)) validRoots.push(candidateRoot);
	}
	if (validRoots.length !== 1) {
		throw new Error(
			`[verify-windows-packages] expected one complete ${expectedVersion} layout in ${root}, found ${validRoots.length}`,
		);
	}
	return validRoots[0];
}

export async function readExpectedWindowsVersion(releaseDir) {
	const document = parse(await readFile(join(releaseDir, "latest.yml"), "utf8"));
	if (typeof document?.version !== "string" || !/^\d+\.\d+\.\d+$/.test(document.version)) {
		throw new Error("[verify-windows-packages] latest.yml has an invalid version");
	}
	return document.version;
}

// Windows Installer extracts MSI payloads through MAX_PATH-limited APIs, while the packaged app
// already ships paths close to that limit: a hashed asset under
// resources/system-plugins/<plugin>/dist/assets occupies roughly 190 characters on its own.
// Extracting into a deep root such as %TEMP%\vetta-windows-packages-XXXXXX\msi pushes those files
// past 260 characters and msiexec aborts the admin install with "Error 1304" (exit code 1603), so
// the extraction root must stay short and live on a drive root the current user can write.
const EXTRACTION_ROOT_PREFIX = "vmsi-";
const MSI_EXTRACTION_DIR = "m";
const ZIP_EXTRACTION_DIR = "z";
const MAX_SHORT_EXTRACTION_ROOT_LENGTH = 40;
const MSI_LOG_SUMMARY_LINES = 12;

export function resolveExtractionBaseCandidates({ releaseDir, tempDir }) {
	const artifactRoot = win32.parse(releaseDir).root;
	const tempRoot = win32.parse(tempDir).root;
	const candidates = [win32.join(artifactRoot, EXTRACTION_ROOT_PREFIX)];
	if (tempRoot !== artifactRoot) candidates.push(win32.join(tempRoot, EXTRACTION_ROOT_PREFIX));
	candidates.push(win32.join(tempDir, EXTRACTION_ROOT_PREFIX));
	return candidates;
}

export async function createExtractionRoot({ releaseDir, tempDir = tmpdir(), createDirectory = mkdtemp } = {}) {
	const failures = [];
	for (const candidate of resolveExtractionBaseCandidates({ releaseDir, tempDir })) {
		try {
			return await createDirectory(candidate);
		} catch (error) {
			failures.push(`${candidate} (${error?.code ?? error?.message})`);
		}
	}
	throw new Error(
		`[verify-windows-packages] could not create an extraction directory; tried ${failures.join(", ")}`,
	);
}

export function decodeMsiLog(bytes) {
	if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return bytes.subarray(2).toString("utf16le");
	return bytes.toString("utf8").replace(/^\uFEFF/, "");
}

export function summarizeMsiLog(logText) {
	const summary = [];
	const seen = new Set();
	for (const rawLine of logText.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (!line || seen.has(line)) continue;
		if (!/Error \d{4}|Return value 3|Error writing to file|MainEngineThread is returning [1-9]/.test(line)) continue;
		seen.add(line);
		summary.push(line);
	}
	return summary.slice(-MSI_LOG_SUMMARY_LINES);
}

async function readMsiLogSummary(logPath) {
	try {
		return summarizeMsiLog(decodeMsiLog(await readFile(logPath)));
	} catch {
		return [];
	}
}
async function extractZip(packagePath, destination) {
	await execFileAsync("tar.exe", ["-xf", packagePath, "-C", destination]);
}

async function extractMsi(packagePath, destination) {
	const logPath = join(destination, "msiexec.log");
	try {
		await execFileAsync("msiexec.exe", [
			"/a",
			packagePath,
			"/qn",
			`TARGETDIR=${destination}`,
			"/L*V",
			logPath,
		]);
	} catch (error) {
		const summary = await readMsiLogSummary(logPath);
		const details = summary.length > 0 ? `\n${summary.join("\n")}` : "\n(msiexec wrote no diagnostic log)";
		throw new Error(
			`[verify-windows-packages] msiexec could not extract ${packagePath} (exit code ${error?.code ?? "unknown"}):${details}`,
			{ cause: error },
		);
	}
}

export async function verifyWindowsPackages({ releaseDir = defaultReleaseDir } = {}) {
	if (process.platform !== "win32") {
		throw new Error("[verify-windows-packages] native Windows package verification must run on Windows");
	}
	const expectedVersion = await readExpectedWindowsVersion(releaseDir);
	const releaseFiles = (await readdir(releaseDir, { withFileTypes: true }))
		.filter((entry) => entry.isFile())
		.map((entry) => entry.name);
	const supplementalArtifacts = findWindowsSupplementalArtifacts(releaseFiles, expectedVersion);
	const msiPath = join(releaseDir, requireOneSupplementalArtifact(supplementalArtifacts, ".msi", releaseDir));
	const zipPath = join(releaseDir, requireOneSupplementalArtifact(supplementalArtifacts, ".zip", releaseDir));
	await Promise.all([assertNonEmptyFile(msiPath), assertNonEmptyFile(zipPath)]);

	const extractionRoot = await createExtractionRoot({ releaseDir });
	if (extractionRoot.length > MAX_SHORT_EXTRACTION_ROOT_LENGTH) {
		console.warn(
			`[verify-windows-packages] extraction root ${extractionRoot} is longer than ${MAX_SHORT_EXTRACTION_ROOT_LENGTH} characters; msiexec reports error 1304 once payload paths exceed MAX_PATH`,
		);
	}
	const msiRoot = join(extractionRoot, MSI_EXTRACTION_DIR);
	const zipRoot = join(extractionRoot, ZIP_EXTRACTION_DIR);
	await Promise.all([mkdir(msiRoot, { recursive: true }), mkdir(zipRoot, { recursive: true })]);
	try {
		await extractMsi(msiPath, msiRoot);
		await extractZip(zipPath, zipRoot);
		await Promise.all([
			verifyExtractedWindowsLayout(msiRoot, expectedVersion),
			verifyExtractedWindowsLayout(zipRoot, expectedVersion),
		]);
		console.info(`[verify-windows-packages] MSI and ZIP packages verified: ${expectedVersion}`);
		return { version: expectedVersion, msiPath, zipPath };
	} finally {
		await rm(extractionRoot, { recursive: true, force: true });
	}
}

export async function main() {
	await verifyWindowsPackages();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main().catch((error) => {
		console.error(error);
		process.exitCode = 1;
	});
}
