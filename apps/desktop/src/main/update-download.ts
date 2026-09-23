import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, rm, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

/**
 * 服务端版本管理登记（`latest.download_url`）的安装包下载器。
 *
 * 这是 electron-updater 之外的第二条下载链路，只在引擎无法接管时才被走到
 * （目前是 Windows 的 Inno 版本化布局，见 `updater-engine.ts` 的
 * `canInstallDownloadedPackage`）。因此这里刻意不实现断点续传与差分下载：
 * 安装包按服务端登记的 `sha256` 校验，校验不过就删掉重下，绝不把未经校验的文件
 * 交给安装器；失败时错误信息要能区分「网络失败」「大小不符」「校验不符」，
 * 否则运维看到的现象都是「更新装不上」。
 */

const SAFE_FILE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

export interface UpdatePackageSource {
	version: string;
	url: string;
	fileName?: string;
	/** 服务端登记的 sha256；未登记时不校验，登记了但不合法则拒绝安装。 */
	sha256?: string;
	sizeBytes?: number;
}

export interface UpdatePackageProgress {
	/** 0..100，仅由已传输字节推导；拿不到总长度时为 0。 */
	percent: number;
	transferred: number;
	total: number;
}

export interface DownloadedUpdatePackage {
	version: string;
	path: string;
	fileName: string;
	sizeBytes: number;
}

export interface UpdatePackageDownloadOptions {
	/** 落盘目录，由宿主提供（通常是 userData 下的固定子目录）。 */
	destinationDir: string;
	onProgress?: (progress: UpdatePackageProgress) => void;
	signal?: AbortSignal;
}

/**
 * 宿主注入服务层的下载器：落盘目录属于宿主职责（`userData` 下的固定子目录），
 * 因此调用方只提供来源、进度回调与取消信号，`destinationDir` 由注入方补齐。
 */
export type UpdatePackageDownloader = (
	source: UpdatePackageSource,
	options: Omit<UpdatePackageDownloadOptions, "destinationDir">,
) => Promise<DownloadedUpdatePackage>;

function describeError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function fileNameFromUrl(url: string): string | undefined {
	try {
		return basename(new URL(url).pathname) || undefined;
	} catch {
		return undefined;
	}
}

/**
 * 服务端给的 `file_name` 只当建议：不合法（含路径分隔符、`.`/`..`、非 ASCII 等）
 * 就退回 URL 末段，再退回一个固定名字。返回值一定可以直接拼进目标目录。
 */
export function resolvePackageFileName(source: Pick<UpdatePackageSource, "version" | "url" | "fileName">): string {
	for (const candidate of [source.fileName, fileNameFromUrl(source.url)]) {
		if (candidate !== undefined && SAFE_FILE_NAME_PATTERN.test(candidate)) return candidate;
	}
	return `Metoai-${source.version}-update`;
}

/**
 * 校验值归一化：未登记 → `null`（不校验）；登记了但不是 64 位十六进制 → 抛错。
 * 宁可装不上，也不能在服务端已经给出校验值的情况下放行未校验的文件。
 */
export function resolveExpectedSha256(sha256: string | undefined): string | null {
	const normalized = sha256
		?.trim()
		.replace(/^sha256:/i, "")
		.toLowerCase();
	if (!normalized) return null;
	if (!SHA256_PATTERN.test(normalized)) {
		throw new Error("update package checksum is not a valid sha256");
	}
	return normalized;
}

function readDeclaredTotal(response: Response, sizeBytes: number | undefined): number | undefined {
	const header = response.headers.get("content-length");
	const parsed = header === null ? Number.NaN : Number.parseInt(header, 10);
	if (Number.isFinite(parsed) && parsed > 0) return parsed;
	return sizeBytes !== undefined && sizeBytes > 0 ? sizeBytes : undefined;
}

async function discard(path: string): Promise<void> {
	try {
		await rm(path, { force: true });
	} catch (error) {
		console.warn("[update-download] unable to remove a partial download", error);
	}
}

export async function downloadUpdatePackage(
	source: UpdatePackageSource,
	options: UpdatePackageDownloadOptions,
): Promise<DownloadedUpdatePackage> {
	const fileName = resolvePackageFileName(source);
	const expectedSha256 = resolveExpectedSha256(source.sha256);
	const destination = join(options.destinationDir, fileName);

	await mkdir(options.destinationDir, { recursive: true });
	await discard(destination);

	let response: Response;
	try {
		response = await fetch(source.url, {
			headers: { Accept: "application/octet-stream" },
			redirect: "follow",
			signal: options.signal,
		});
	} catch (error) {
		throw new Error(`update package request failed: ${describeError(error)}`);
	}
	if (!response.ok) throw new Error(`update package request failed with status ${response.status}`);
	if (!response.body) throw new Error("update package response has no body");

	const total = readDeclaredTotal(response, source.sizeBytes);
	const hash = createHash("sha256");
	let transferred = 0;
	const meter = new Transform({
		transform(chunk: Buffer, _encoding, callback) {
			hash.update(chunk);
			transferred += chunk.length;
			options.onProgress?.({
				percent: total === undefined ? 0 : Math.min(100, (transferred / total) * 100),
				transferred,
				total: total ?? transferred,
			});
			callback(null, chunk);
		},
	});

	try {
		await pipeline(
			Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]),
			meter,
			createWriteStream(destination),
			{
				signal: options.signal,
			},
		);
	} catch (error) {
		await discard(destination);
		throw new Error(`update package download failed: ${describeError(error)}`);
	}

	const sizeBytes = (await stat(destination)).size;
	if (source.sizeBytes !== undefined && source.sizeBytes > 0 && sizeBytes !== source.sizeBytes) {
		await discard(destination);
		throw new Error(`update package size mismatch: expected ${source.sizeBytes} bytes, received ${sizeBytes}`);
	}

	if (expectedSha256 !== null && hash.digest("hex") !== expectedSha256) {
		await discard(destination);
		throw new Error("update package checksum mismatch");
	}

	return { version: source.version, path: destination, fileName, sizeBytes };
}
