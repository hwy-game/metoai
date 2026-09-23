import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	downloadUpdatePackage,
	resolveExpectedSha256,
	resolvePackageFileName,
	type UpdatePackageProgress,
	type UpdatePackageSource,
} from "./update-download";

/**
 * 服务端版本管理登记的安装包是 electron-updater 之外的第二条下载链路，也是唯一
 * 由宿主自己负责完整性的链路。这里锁住它的三条不变量：只有校验通过的文件才留在
 * 磁盘上（校验/大小不符、被取消都必须删干净），服务端登记的校验值不合法时宁可
 * 拒绝下载也不放行，以及错误信息能区分「网络失败 / 大小不符 / 校验不符」。
 */
const fetchMock = vi.fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>();
const destinationDirs: string[] = [];

const PACKAGE_FILE_NAME = "Metoai-0.6.0-win-x64.exe";
const PACKAGE_URL = `https://dl.example.com/${PACKAGE_FILE_NAME}`;

function createDestinationDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "metoai-update-download-"));
	destinationDirs.push(dir);
	return dir;
}

function createSource(overrides: Partial<UpdatePackageSource> = {}): UpdatePackageSource {
	return { version: "0.6.0", url: PACKAGE_URL, fileName: PACKAGE_FILE_NAME, ...overrides };
}

function sha256Of(body: Uint8Array): string {
	return createHash("sha256").update(body).digest("hex");
}

function createProgressRecorder(): ReturnType<typeof vi.fn<(progress: UpdatePackageProgress) => void>> {
	return vi.fn<(progress: UpdatePackageProgress) => void>();
}

beforeEach(() => {
	fetchMock.mockReset();
	vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
	for (const dir of destinationDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
	vi.unstubAllGlobals();
});

describe("downloadUpdatePackage", () => {
	it("校验通过时把安装包写进目标目录并上报 100% 进度", async () => {
		const body = new Uint8Array(Buffer.from("metoai-update-payload-v1"));
		const destinationDir = createDestinationDir();
		fetchMock.mockResolvedValue(new Response(body));
		const onProgress = createProgressRecorder();

		const downloaded = await downloadUpdatePackage(
			createSource({ sha256: sha256Of(body), sizeBytes: body.byteLength }),
			{ destinationDir, onProgress },
		);

		expect(downloaded).toEqual({
			version: "0.6.0",
			fileName: PACKAGE_FILE_NAME,
			path: join(destinationDir, PACKAGE_FILE_NAME),
			sizeBytes: body.byteLength,
		});
		expect(readFileSync(downloaded.path).equals(Buffer.from(body))).toBe(true);
		expect(onProgress).toHaveBeenCalled();
		expect(onProgress.mock.calls.at(-1)?.[0]).toMatchObject({
			percent: 100,
			transferred: body.byteLength,
			total: body.byteLength,
		});
	});

	it("校验值不匹配时删掉文件并报错，绝不把未校验的安装包留给安装器", async () => {
		const body = new Uint8Array(Buffer.from("tampered-payload"));
		const destinationDir = createDestinationDir();
		fetchMock.mockResolvedValue(new Response(body));

		await expect(
			downloadUpdatePackage(createSource({ sha256: "0".repeat(64), sizeBytes: body.byteLength }), {
				destinationDir,
			}),
		).rejects.toThrow("update package checksum mismatch");

		expect(existsSync(join(destinationDir, PACKAGE_FILE_NAME))).toBe(false);
		expect(readdirSync(destinationDir)).toEqual([]);
	});

	it("声明大小与实际不符时删掉文件并报出两边的大小", async () => {
		const body = new Uint8Array(Buffer.from("size-mismatch-payload"));
		const destinationDir = createDestinationDir();
		fetchMock.mockResolvedValue(new Response(body));
		const declared = body.byteLength - 1;

		await expect(downloadUpdatePackage(createSource({ sizeBytes: declared }), { destinationDir })).rejects.toThrow(
			`update package size mismatch: expected ${declared} bytes, received ${body.byteLength}`,
		);

		expect(existsSync(join(destinationDir, PACKAGE_FILE_NAME))).toBe(false);
		expect(readdirSync(destinationDir)).toEqual([]);
	});

	it("服务端登记的校验值不合法时，在发起请求之前就拒绝下载", async () => {
		const destinationDir = createDestinationDir();

		expect(() => resolveExpectedSha256("abc123")).toThrow("update package checksum is not a valid sha256");
		await expect(downloadUpdatePackage(createSource({ sha256: "abc123" }), { destinationDir })).rejects.toThrow(
			"update package checksum is not a valid sha256",
		);

		expect(fetchMock).not.toHaveBeenCalled();
		expect(readdirSync(destinationDir)).toEqual([]);
	});

	it("HTTP 状态码不是 2xx 时带上状态码报错", async () => {
		fetchMock.mockResolvedValue(new Response("nope", { status: 404 }));

		await expect(downloadUpdatePackage(createSource(), { destinationDir: createDestinationDir() })).rejects.toThrow(
			"update package request failed with status 404",
		);
	});

	it("请求本身失败时把底层原因带进错误信息", async () => {
		fetchMock.mockRejectedValue(new Error("network down"));

		await expect(downloadUpdatePackage(createSource(), { destinationDir: createDestinationDir() })).rejects.toThrow(
			"update package request failed: network down",
		);
	});

	it("信号已中止时拒绝下载，且不留下任何文件", async () => {
		const body = new Uint8Array(Buffer.from("cancelled-before-start"));
		const destinationDir = createDestinationDir();
		fetchMock.mockResolvedValue(new Response(body));
		const controller = new AbortController();
		controller.abort();

		await expect(
			downloadUpdatePackage(createSource({ sizeBytes: body.byteLength }), {
				destinationDir,
				signal: controller.signal,
			}),
		).rejects.toThrow("update package download failed");

		expect(readdirSync(destinationDir)).toEqual([]);
	});

	it("下载中途被取消时清掉半截文件", async () => {
		// 产出三块后挂住不 close：模拟一条还没结束、也还没新数据的连接。
		let produced = 0;
		const body = new ReadableStream<Uint8Array>({
			pull(controller) {
				if (produced >= 3) return new Promise<void>(() => {});
				produced += 1;
				controller.enqueue(new Uint8Array(1024));
			},
		});
		const destinationDir = createDestinationDir();
		fetchMock.mockResolvedValue(new Response(body));
		const onProgress = createProgressRecorder();
		const controller = new AbortController();

		const download = downloadUpdatePackage(createSource(), {
			destinationDir,
			onProgress,
			signal: controller.signal,
		});
		await vi.waitFor(() => expect(onProgress).toHaveBeenCalled());
		expect(existsSync(join(destinationDir, PACKAGE_FILE_NAME))).toBe(true);

		controller.abort();

		await expect(download).rejects.toThrow("update package download failed");
		expect(existsSync(join(destinationDir, PACKAGE_FILE_NAME))).toBe(false);
		expect(readdirSync(destinationDir)).toEqual([]);
	});
});

describe("resolvePackageFileName", () => {
	it("服务端给的 file_name 合法时原样使用", () => {
		expect(resolvePackageFileName(createSource())).toBe(PACKAGE_FILE_NAME);
	});

	it("file_name 含路径分隔符时退回 URL 末段", () => {
		expect(resolvePackageFileName(createSource({ fileName: "../../evil.exe" }))).toBe(PACKAGE_FILE_NAME);
	});

	it("file_name 含非 ASCII 时退回 URL 末段", () => {
		expect(resolvePackageFileName(createSource({ fileName: "安装包.exe" }))).toBe(PACKAGE_FILE_NAME);
	});

	it("file_name 与 URL 末段都不合法时退回固定名字", () => {
		expect(
			resolvePackageFileName({ version: "0.6.0", url: "https://dl.example.com/安装包.exe", fileName: "../evil" }),
		).toBe("Metoai-0.6.0-update");
		expect(resolvePackageFileName({ version: "0.6.0", url: "not a url", fileName: "" })).toBe("Metoai-0.6.0-update");
	});
});

describe("resolveExpectedSha256", () => {
	it("未登记校验值时返回 null，表示不校验", () => {
		expect(resolveExpectedSha256(undefined)).toBeNull();
		expect(resolveExpectedSha256("")).toBeNull();
		expect(resolveExpectedSha256("   ")).toBeNull();
	});

	it("接受大写十六进制与 sha256: 前缀，归一化成小写裸值", () => {
		const upper = `${"ABCDEF".repeat(10)}1234`;
		expect(upper).toHaveLength(64);

		expect(resolveExpectedSha256(upper)).toBe(upper.toLowerCase());
		expect(resolveExpectedSha256(`sha256:${upper}`)).toBe(upper.toLowerCase());
		expect(resolveExpectedSha256(`  SHA256:${upper}  `)).toBe(upper.toLowerCase());
	});

	it("长度或字符集不合法时拒绝安装", () => {
		expect(() => resolveExpectedSha256("a".repeat(63))).toThrow("update package checksum is not a valid sha256");
		expect(() => resolveExpectedSha256(`${"a".repeat(63)}g`)).toThrow(
			"update package checksum is not a valid sha256",
		);
	});
});
