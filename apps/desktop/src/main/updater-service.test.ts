import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProgressInfo } from "builder-util-runtime";
import type { BrowserWindow } from "electron";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { UpdatePackageDownloader, UpdatePackageDownloadOptions, UpdatePackageSource } from "./update-download.js";
import type { UpdatePolicy } from "./update-policy.js";
import type { UpdateEngine, UpdateEngineCheckResult, UpdateEngineDownload } from "./updater-engine.js";
import { UpdaterService, type UpdaterState } from "./updater-service.js";

const PACKAGE_URL = "https://releases.openvetta.com/desktop/stable/MetoAI-0.6.0.exe";
const PACKAGE_SHA256 = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";
const PACKAGE_FILE_NAME = "MetoAI-0.6.0.exe";

class FakeUpdateEngine implements UpdateEngine {
	checkResult: UpdateEngineCheckResult | null = null;
	installCalls = 0;
	cancelCalls = 0;
	/** 默认 false：非 Windows 版本化布局的引擎接管不了宿主自己下好的安装包。 */
	canAdopt = false;
	adoptCalls = 0;
	adopted: Array<{ path: string; version: string; fileName: string; sizeBytes: number }> = [];
	adoptResult: string[] = [PACKAGE_FILE_NAME];
	private progressHandler: ((progress: ProgressInfo) => void) | null = null;
	private stagingHandler: (() => void) | null = null;
	private resolveDownload: ((paths: string[]) => void) | null = null;

	async checkForUpdates(): Promise<UpdateEngineCheckResult | null> {
		return this.checkResult;
	}

	downloadUpdate(onProgress: (progress: ProgressInfo) => void, onStaging?: () => void): UpdateEngineDownload {
		this.progressHandler = onProgress;
		this.stagingHandler = onStaging ?? null;
		return {
			promise: new Promise<string[]>((resolve) => {
				this.resolveDownload = resolve;
			}),
			cancel: () => {
				this.cancelCalls += 1;
			},
		};
	}

	canInstallDownloadedPackage(): boolean {
		return this.canAdopt;
	}

	async adoptDownloadedPackage(
		pkg: { path: string; version: string; fileName: string; sizeBytes: number },
		onProgress: (progress: ProgressInfo) => void,
		_signal: AbortSignal,
	): Promise<string[]> {
		this.adoptCalls += 1;
		this.adopted.push(pkg);
		onProgress({
			bytesPerSecond: 0,
			delta: pkg.sizeBytes,
			percent: 100,
			total: pkg.sizeBytes,
			transferred: pkg.sizeBytes,
		});
		return this.adoptResult;
	}

	emitProgress(progress: ProgressInfo): void {
		this.progressHandler?.(progress);
	}

	emitStaging(): void {
		this.stagingHandler?.();
	}

	completeDownload(paths: string[]): void {
		this.resolveDownload?.(paths);
	}

	async quitAndInstall(): Promise<void> {
		this.installCalls += 1;
	}
}

const translate = (key: string): string => key;

function createUpToDateEngine(): FakeUpdateEngine {
	const engine = new FakeUpdateEngine();
	engine.checkResult = { hasUpdate: false, info: { version: "0.5.21" } };
	return engine;
}

function createAvailableEngine(): FakeUpdateEngine {
	const engine = new FakeUpdateEngine();
	engine.checkResult = {
		hasUpdate: true,
		info: {
			version: "0.6.0",
			releaseNote: "Release notes",
			assetFileName: PACKAGE_FILE_NAME,
			totalBytes: 1_000,
		},
	};
	return engine;
}

/**
 * 系统事件替身：服务只依赖「订阅返回退订函数」这一个语义，这里用 Set 记录监听者。
 * 事件源本身（Electron 的 powerMonitor / 窗口焦点）由宿主接，不在单测范围内。
 */
function createEventSource(): {
	subscribe: (listener: () => void) => () => void;
	emit: () => void;
	listenerCount: () => number;
} {
	const listeners = new Set<() => void>();
	return {
		subscribe: (listener) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		emit: () => {
			for (const listener of listeners) listener();
		},
		listenerCount: () => listeners.size,
	};
}

function createResumeEvents(): {
	events: { onResume(listener: () => void): () => void };
	emit: () => void;
	listenerCount: () => number;
} {
	const source = createEventSource();
	return {
		emit: source.emit,
		listenerCount: source.listenerCount,
		events: { onResume: source.subscribe },
	};
}

/** 只关心「回到前台」时的替身：唤醒订阅是服务要求的必填项，这里给一个不影响断言的空实现。 */
function createForegroundEvents(): {
	events: {
		onResume(listener: () => void): () => void;
		onForeground(listener: () => void): () => void;
	};
	emit: () => void;
	listenerCount: () => number;
} {
	const source = createEventSource();
	return {
		emit: source.emit,
		listenerCount: source.listenerCount,
		events: {
			onResume: () => () => {},
			onForeground: source.subscribe,
		},
	};
}

/** 主进程把状态推给渲染层的那次 IPC 调用，是 `dismissReady()` 唯一的可见行为。 */
function createWindowRecorder(): { win: BrowserWindow; sends: Array<{ channel: string; state: UpdaterState }> } {
	const sends: Array<{ channel: string; state: UpdaterState }> = [];
	const win = {
		isDestroyed: () => false,
		webContents: {
			send: (channel: string, state: UpdaterState) => {
				sends.push({ channel, state });
			},
		},
	} as unknown as BrowserWindow;
	return { sends, win };
}

/** 服务端登记了可交付产物的更新策略；`release_note` 刻意与 feed 不同，用于验证事实源。 */
function availablePolicy(overrides: Partial<UpdatePolicy> = {}): UpdatePolicy {
	return {
		hasUpdate: true,
		forced: false,
		reason: "",
		checkIntervalSeconds: 7_200,
		latestVersion: "0.6.0",
		releaseNote: "服务端更新说明",
		...overrides,
	};
}

/** 服务端说「没有可交付的更新」；`overrides` 用于覆盖检查间隔等字段。 */
function noUpdatePolicy(overrides: Partial<UpdatePolicy> = {}): UpdatePolicy {
	return { hasUpdate: false, forced: false, reason: "", checkIntervalSeconds: 7_200, ...overrides };
}

/** 记录请求参数、按需回报进度，并返回一个不存在的落盘路径（服务端安装包由服务层删除）。 */
function createPackageDownloader(sizeBytes: number): {
	calls: Array<{ source: UpdatePackageSource; options: Omit<UpdatePackageDownloadOptions, "destinationDir"> }>;
	downloader: UpdatePackageDownloader;
} {
	const calls: Array<{ source: UpdatePackageSource; options: Omit<UpdatePackageDownloadOptions, "destinationDir"> }> =
		[];
	const downloader: UpdatePackageDownloader = async (source, options) => {
		calls.push({ source, options });
		const fileName = source.fileName ?? "MetoAI-update.exe";
		options.onProgress?.({ percent: 50, transferred: sizeBytes / 2, total: sizeBytes });
		options.onProgress?.({ percent: 100, transferred: sizeBytes, total: sizeBytes });
		return {
			version: source.version,
			path: join(tmpdir(), "metoai-updater-test", fileName),
			fileName,
			sizeBytes,
		};
	};
	return { calls, downloader };
}

/** 可控的策略来源：`resolve()` 决定下一次 `check()` 看到的服务端结论。 */
function createDeferredPolicy(): {
	provider: () => Promise<UpdatePolicy | null>;
	resolve: (policy: UpdatePolicy | null) => void;
} {
	let settle: (policy: UpdatePolicy | null) => void = () => {};
	const provider = () =>
		new Promise<UpdatePolicy | null>((resolve) => {
			settle = resolve;
		});
	return { provider, resolve: (policy) => settle(policy) };
}

/** 服务端策略：`forced` 为真即「强制更新」，由 metotoken 决定（见 update-policy.ts）。 */
async function createCheckedService(forced: boolean): Promise<{ engine: FakeUpdateEngine; service: UpdaterService }> {
	const engine = createAvailableEngine();
	const service = new UpdaterService(engine, "0.5.21", true, translate, {
		autoDownloadDelayMs: 10_000_000,
		periodicCheckIntervalMs: 0,
		policyProvider: async () => availablePolicy({ forced, reason: forced ? "policy" : "" }),
	});
	await service.check();
	expect(service.getState()).toMatchObject({ phase: "available", hasUpdate: true, forced });
	return { engine, service };
}

/** 走完 check → 下载完成，落到「提示可被忽略 / 不可被忽略」的 ready 阶段。 */
async function createReadyService(forced: boolean): Promise<{ engine: FakeUpdateEngine; service: UpdaterService }> {
	const { engine, service } = await createCheckedService(forced);
	const downloadPromise = service.startDownload();
	engine.completeDownload([PACKAGE_FILE_NAME]);
	await downloadPromise;
	expect(service.getState().phase).toBe("ready");
	return { engine, service };
}

describe("UpdaterService", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.clearAllTimers();
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	describe("version detection source", () => {
		it("takes the version and the release note from the server policy, not from the feed", async () => {
			// feed 里出现了一个比服务端登记更高的版本：界面仍然只认服务端登记值，
			// feed 只负责把安装包送到本地。
			const engine = createAvailableEngine();
			engine.checkResult = {
				hasUpdate: true,
				info: { version: "0.7.0", releaseNote: "feed notes", assetFileName: "MetoAI-0.7.0.exe", totalBytes: 2_000 },
			};
			const service = new UpdaterService(engine, "0.5.21", true, translate, {
				autoDownloadDelayMs: 10_000_000,
				periodicCheckIntervalMs: 0,
				policyProvider: async () => availablePolicy(),
			});

			await service.check();

			expect(service.getState()).toMatchObject({
				phase: "available",
				hasUpdate: true,
				currentVersion: "0.5.21",
				latestVersion: "0.6.0",
				releaseNote: "服务端更新说明",
				assetFileName: "MetoAI-0.7.0.exe",
			});
		});

		it("falls back to the feed release note when the server registers none", async () => {
			const engine = createAvailableEngine();
			const service = new UpdaterService(engine, "0.5.21", true, translate, {
				autoDownloadDelayMs: 10_000_000,
				periodicCheckIntervalMs: 0,
				policyProvider: async () => availablePolicy({ releaseNote: undefined }),
			});

			await service.check();

			expect(service.getState()).toMatchObject({ phase: "available", releaseNote: "Release notes" });
		});

		it("never consults the feed when no policy provider is configured", async () => {
			const engine = createAvailableEngine();
			const checkSpy = vi.spyOn(engine, "checkForUpdates");
			const service = new UpdaterService(engine, "0.5.21", true, translate, {
				autoDownloadDelayMs: 10_000_000,
				periodicCheckIntervalMs: 0,
			});

			await service.check();

			expect(checkSpy).not.toHaveBeenCalled();
			expect(service.getState()).toMatchObject({
				phase: "idle",
				hasUpdate: false,
				latestVersion: undefined,
				error: undefined,
			});
			expect(service.getState().forced).toBeFalsy();
		});

		it("stays unblocked when the server forces a version that is not higher than this build", async () => {
			// 线上真实故障：后台登记了一条与本机同版本（甚至更低）的记录并勾了强制。
			const engine = createAvailableEngine();
			const service = new UpdaterService(engine, "0.5.21", true, translate, {
				autoDownloadDelayMs: 10_000_000,
				periodicCheckIntervalMs: 0,
				policyProvider: async () => availablePolicy({ forced: true, reason: "policy", latestVersion: "0.5.21" }),
			});

			await service.check();

			expect(service.getState()).toMatchObject({ phase: "idle", hasUpdate: false, forced: false, forceReason: "" });
		});

		it("stays unblocked when the server forces an update with no deliverable package", async () => {
			// 服务端说强制、但既没有 download_url、feed 也给不出这个版本：
			// 宁可暂时不提示，也不能弹一条永远装不上的强制提示。
			const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
			const engine = createUpToDateEngine();
			const service = new UpdaterService(engine, "0.5.21", true, translate, {
				autoDownloadDelayMs: 10_000_000,
				periodicCheckIntervalMs: 0,
				policyProvider: async () => availablePolicy({ forced: true, reason: "policy" }),
			});

			await service.check();

			expect(service.getState()).toMatchObject({
				phase: "idle",
				hasUpdate: false,
				forced: false,
				forceReason: "",
				latestVersion: undefined,
				releaseNote: undefined,
				error: undefined,
			});
			expect(warn).toHaveBeenCalled();
		});

		it("prompts a manual download when the server version has no in-app package", async () => {
			// 服务端登记了更高版本、但本机没有任何应用内安装通道：仍然提示（可关闭），主操作
			// 换成「前往下载页」——「后台登记了就一定让用户看见」是这里的口径。
			const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
			const engine = createUpToDateEngine();
			const service = new UpdaterService(engine, "0.5.21", true, translate, {
				autoDownloadDelayMs: 10_000_000,
				periodicCheckIntervalMs: 0,
				fallbackDownloadUrl: "https://metoai.example.com/download",
				policyProvider: async () => availablePolicy({ forced: true, reason: "policy" }),
			});

			await service.check();

			expect(service.getState()).toMatchObject({
				phase: "available",
				hasUpdate: true,
				installable: false,
				manualDownloadUrl: "https://metoai.example.com/download",
				latestVersion: "0.6.0",
				// 拿不到应用内安装包时强制降级为可关闭：否则用户被锁在门外，正是改造前的故障。
				forced: false,
				forceReason: "",
			});
			expect(warn).toHaveBeenCalled();
		});

		it("prefers the registered download_url over the fallback download page", async () => {
			const engine = createUpToDateEngine();
			const service = new UpdaterService(engine, "0.5.21", true, translate, {
				autoDownloadDelayMs: 10_000_000,
				periodicCheckIntervalMs: 0,
				fallbackDownloadUrl: "https://metoai.example.com/download",
				policyProvider: async () =>
					availablePolicy({ downloadUrl: "https://releases.openvetta.com/MetoAI-0.6.0.exe" }),
			});

			await service.check();

			expect(service.getState()).toMatchObject({
				phase: "available",
				installable: false,
				manualDownloadUrl: "https://releases.openvetta.com/MetoAI-0.6.0.exe",
				forced: false,
			});
		});

		it("keeps the forced state visible while a re-check is in flight", async () => {
			const engine = createAvailableEngine();
			const deferred = createDeferredPolicy();
			const service = new UpdaterService(engine, "0.5.21", true, translate, {
				autoDownloadDelayMs: 10_000_000,
				periodicCheckIntervalMs: 0,
				policyProvider: deferred.provider,
			});

			const first = service.check();
			deferred.resolve(availablePolicy({ forced: true, reason: "policy" }));
			await first;
			expect(service.getState()).toMatchObject({ phase: "available", hasUpdate: true, forced: true });

			const second = service.check();
			// 覆盖层的可见性判据是 forced && hasUpdate，两者都必须在后台重查期间保持，
			// 否则每次周期检查都会让弹窗闪一下（线上「一闪一闪」的根因）。
			expect(service.getState()).toMatchObject({ phase: "checking", hasUpdate: true, forced: true });

			deferred.resolve(availablePolicy({ forced: true, reason: "policy" }));
			await second;
			expect(service.getState()).toMatchObject({ phase: "available", hasUpdate: true, forced: true });
		});

		it("drops a previously forced state when the policy becomes unavailable", async () => {
			const engine = createAvailableEngine();
			let policy: UpdatePolicy | null = availablePolicy({ forced: true, reason: "policy" });
			const service = new UpdaterService(engine, "0.5.21", true, translate, {
				autoDownloadDelayMs: 10_000_000,
				periodicCheckIntervalMs: 0,
				policyProvider: async () => policy,
			});

			await service.check();
			const forcedState = service.getState();
			expect(forcedState.forced).toBe(true);
			expect(forcedState.policyCheckedAt).toBeDefined();

			// 拿不到策略时必须回落成「无强制约束」，不能把上一次的强制态留在界面上。
			policy = null;
			await service.check();

			const state = service.getState();
			expect(state.forced).toBe(false);
			expect(state.forceReason).toBe("");
			// policyCheckedAt 记录的是「上一次成功拿到策略」的时间，本次失败不清空。
			expect(state.policyCheckedAt).toBe(forcedState.policyCheckedAt);
			expect(state).toMatchObject({
				phase: "idle",
				hasUpdate: false,
				latestVersion: undefined,
				releaseNote: undefined,
				error: undefined,
			});
		});

		it("does not consult the server in development mode", async () => {
			const engine = createAvailableEngine();
			const checkSpy = vi.spyOn(engine, "checkForUpdates");
			const provider = vi.fn(async () => availablePolicy());
			const service = new UpdaterService(engine, "0.5.21", false, translate, { policyProvider: provider });

			await service.check();

			expect(provider).not.toHaveBeenCalled();
			expect(checkSpy).not.toHaveBeenCalled();
			expect(service.getState()).toMatchObject({
				phase: "error",
				error: "updater.errors.developmentUnsupported",
			});
		});
	});

	describe("download channel", () => {
		it("downloads the server package and hands it to the engine without consulting the feed", async () => {
			const engine = createAvailableEngine();
			engine.canAdopt = true;
			const checkSpy = vi.spyOn(engine, "checkForUpdates");
			const { calls, downloader } = createPackageDownloader(1_024);
			const service = new UpdaterService(engine, "0.5.21", true, translate, {
				autoDownloadDelayMs: 10_000_000,
				periodicCheckIntervalMs: 0,
				downloadPackage: downloader,
				policyProvider: async () =>
					availablePolicy({
						downloadUrl: PACKAGE_URL,
						fileName: PACKAGE_FILE_NAME,
						sha256: PACKAGE_SHA256,
						sizeBytes: 1_024,
					}),
			});

			await service.check();
			expect(service.getState()).toMatchObject({
				phase: "available",
				latestVersion: "0.6.0",
				assetFileName: PACKAGE_FILE_NAME,
				totalBytes: 1_024,
			});

			const downloadPromise = service.startDownload();
			await downloadPromise;

			expect(checkSpy).not.toHaveBeenCalled();
			expect(calls).toHaveLength(1);
			expect(calls[0]?.source).toMatchObject({
				version: "0.6.0",
				url: PACKAGE_URL,
				fileName: PACKAGE_FILE_NAME,
				sha256: PACKAGE_SHA256,
				sizeBytes: 1_024,
			});
			expect(engine.adoptCalls).toBe(1);
			expect(engine.adopted[0]).toMatchObject({ version: "0.6.0", fileName: PACKAGE_FILE_NAME, sizeBytes: 1_024 });
			expect(service.getState()).toMatchObject({
				phase: "ready",
				progress: 1,
				assetFileName: PACKAGE_FILE_NAME,
			});
		});

		it("compresses the package download progress before the local install preparation", async () => {
			const engine = createAvailableEngine();
			engine.canAdopt = true;
			const { downloader } = createPackageDownloader(1_024);
			const service = new UpdaterService(engine, "0.5.21", true, translate, {
				autoDownloadDelayMs: 10_000_000,
				periodicCheckIntervalMs: 0,
				downloadPackage: downloader,
				policyProvider: async () =>
					availablePolicy({ downloadUrl: PACKAGE_URL, fileName: PACKAGE_FILE_NAME, sizeBytes: 1_024 }),
			});
			const { sends, win } = createWindowRecorder();
			await service.check();
			service.setMainWindow(win);
			sends.length = 0;

			await service.startDownload();

			// 网络阶段只占 0～90%，剩下 10% 留给 Inno 展开新版本目录的本地准备。
			const progresses = sends.map((send) => send.state.progress);
			expect(progresses).toContain(0.45);
			expect(progresses).toContain(0.9);
			expect(service.getState().progress).toBe(1);
		});

		it("falls back to the feed when the engine cannot adopt a downloaded package", async () => {
			const engine = createAvailableEngine();
			engine.canAdopt = false;
			const checkSpy = vi.spyOn(engine, "checkForUpdates");
			const { calls, downloader } = createPackageDownloader(1_024);
			const service = new UpdaterService(engine, "0.5.21", true, translate, {
				autoDownloadDelayMs: 10_000_000,
				periodicCheckIntervalMs: 0,
				downloadPackage: downloader,
				policyProvider: async () => availablePolicy({ downloadUrl: PACKAGE_URL, fileName: PACKAGE_FILE_NAME }),
			});

			await service.check();

			expect(checkSpy).toHaveBeenCalledTimes(1);
			expect(calls).toHaveLength(0);
			expect(engine.adoptCalls).toBe(0);
			expect(service.getState()).toMatchObject({ phase: "available", assetFileName: PACKAGE_FILE_NAME });
		});

		it("falls back to the feed when no package downloader is configured", async () => {
			const engine = createAvailableEngine();
			engine.canAdopt = true;
			const checkSpy = vi.spyOn(engine, "checkForUpdates");
			const service = new UpdaterService(engine, "0.5.21", true, translate, {
				autoDownloadDelayMs: 10_000_000,
				periodicCheckIntervalMs: 0,
				policyProvider: async () => availablePolicy({ downloadUrl: PACKAGE_URL, fileName: PACKAGE_FILE_NAME }),
			});

			await service.check();

			expect(checkSpy).toHaveBeenCalledTimes(1);
			expect(engine.adoptCalls).toBe(0);
			expect(service.getState()).toMatchObject({ phase: "available", assetFileName: PACKAGE_FILE_NAME });
		});
	});

	describe("download mechanics", () => {
		it("reports progress and marks the downloaded update ready", async () => {
			const { engine, service } = await createCheckedService(false);

			const downloadPromise = service.startDownload();
			engine.emitProgress({
				bytesPerSecond: 100,
				delta: 500,
				percent: 50,
				total: 1_000,
				transferred: 500,
			});
			expect(service.getState()).toMatchObject({
				phase: "downloading",
				progress: 0.5,
				downloadedBytes: 500,
			});

			engine.completeDownload([PACKAGE_FILE_NAME]);
			await downloadPromise;

			expect(service.getState()).toMatchObject({
				phase: "ready",
				progress: 1,
			});
			await service.install();
			expect(engine.installCalls).toBe(1);
		});

		it("cancels an active download without surfacing a download error", async () => {
			const { engine, service } = await createCheckedService(false);
			void service.startDownload();

			service.cancel();

			expect(engine.cancelCalls).toBe(1);
			expect(service.getState()).toMatchObject({
				phase: "idle",
				error: undefined,
			});
		});

		it("cancels a stalled download and allows the user to retry", async () => {
			const engine = createAvailableEngine();
			const service = new UpdaterService(engine, "0.5.21", true, translate, {
				autoDownloadDelayMs: 10_000_000,
				periodicCheckIntervalMs: 0,
				downloadStallTimeoutMs: 1_000,
				policyProvider: async () => availablePolicy(),
			});
			await service.check();
			void service.startDownload();

			await vi.advanceTimersByTimeAsync(900);
			engine.emitProgress({
				bytesPerSecond: 100,
				delta: 100,
				percent: 10,
				total: 1_000,
				transferred: 100,
			});
			await vi.advanceTimersByTimeAsync(900);
			expect(engine.cancelCalls).toBe(0);

			await vi.advanceTimersByTimeAsync(100);
			expect(engine.cancelCalls).toBe(1);
			expect(service.getState()).toMatchObject({
				phase: "error",
				progress: undefined,
				error: "updater.errors.downloadFailed",
			});
		});

		it("does not treat Squirrel.Mac staging as a stalled download", async () => {
			const engine = createAvailableEngine();
			const service = new UpdaterService(engine, "0.5.21", true, translate, {
				autoDownloadDelayMs: 10_000_000,
				periodicCheckIntervalMs: 0,
				downloadStallTimeoutMs: 1_000,
				stagingTimeoutMs: 10_000,
				policyProvider: async () => availablePolicy(),
			});
			await service.check();
			const downloadPromise = service.startDownload();

			// 引擎把网络阶段压缩到 0～90%，暂存期间进度停在这里不再变化。
			engine.emitProgress({
				bytesPerSecond: 100,
				delta: 1_000,
				percent: 90,
				total: 1_000,
				transferred: 1_000,
			});
			engine.emitStaging();
			expect(service.getState()).toMatchObject({
				phase: "downloading",
				progress: 0.9,
				downloadedBytes: 1_000,
			});

			// 暂存期间没有任何进度事件，短停滞超时不得触发。
			await vi.advanceTimersByTimeAsync(5_000);
			expect(engine.cancelCalls).toBe(0);
			expect(service.getState().phase).toBe("downloading");

			engine.completeDownload(["/Applications/MetoAI.app"]);
			await downloadPromise;
			expect(service.getState().phase).toBe("ready");
		});

		it("gives up when Squirrel.Mac never finishes staging", async () => {
			const engine = createAvailableEngine();
			const service = new UpdaterService(engine, "0.5.21", true, translate, {
				autoDownloadDelayMs: 10_000_000,
				periodicCheckIntervalMs: 0,
				downloadStallTimeoutMs: 1_000,
				stagingTimeoutMs: 10_000,
				policyProvider: async () => availablePolicy(),
			});
			await service.check();
			void service.startDownload();

			engine.emitStaging();
			await vi.advanceTimersByTimeAsync(10_000);

			expect(engine.cancelCalls).toBe(1);
			expect(service.getState()).toMatchObject({
				phase: "error",
				error: "updater.errors.downloadFailed",
			});
		});

		it("keeps a downloaded update ready when cancel is requested", async () => {
			const { engine, service } = await createCheckedService(false);
			const downloadPromise = service.startDownload();
			engine.completeDownload([PACKAGE_FILE_NAME]);
			await downloadPromise;

			service.cancel();

			expect(engine.cancelCalls).toBe(0);
			expect(service.getState().phase).toBe("ready");
		});
	});

	describe("background re-checks", () => {
		it("re-checks on the server-provided schedule even while the client is up to date", async () => {
			const engine = createUpToDateEngine();
			// 服务端把间隔定为 30 分钟：它必须覆盖构造参数里的 1 分钟，否则管理台调小间隔
			// 对「已经是最新版」的客户端完全无效，而这类客户端正是要等新版本的那批。
			const provider = vi.fn(async () => noUpdatePolicy({ checkIntervalSeconds: 1_800 }));
			const service = new UpdaterService(engine, "0.5.21", true, translate, {
				periodicCheckIntervalMs: 60_000,
				policyProvider: provider,
			});

			await service.onAppReady();
			await vi.advanceTimersByTimeAsync(0);
			expect(provider).toHaveBeenCalledTimes(1);

			await vi.advanceTimersByTimeAsync(60_000);
			expect(provider).toHaveBeenCalledTimes(1);

			await vi.advanceTimersByTimeAsync(1_740_000);
			expect(provider).toHaveBeenCalledTimes(2);

			await vi.advanceTimersByTimeAsync(1_800_000);
			expect(provider).toHaveBeenCalledTimes(3);

			service.dispose();
			await vi.advanceTimersByTimeAsync(1_800_000);
			expect(provider).toHaveBeenCalledTimes(3);
		});

		it("does not re-check while an update is already available or downloading", async () => {
			const engine = createAvailableEngine();
			const provider = vi.fn(async () => availablePolicy());
			const service = new UpdaterService(engine, "0.5.21", true, translate, {
				autoDownloadDelayMs: 10_000_000,
				periodicCheckIntervalMs: 60_000,
				policyProvider: provider,
			});

			await service.onAppReady();
			await vi.advanceTimersByTimeAsync(0);
			expect(service.getState().phase).toBe("available");

			await vi.advanceTimersByTimeAsync(180_000);
			expect(provider).toHaveBeenCalledTimes(1);

			service.dispose();
		});

		it("checks again after the machine wakes from sleep", async () => {
			const engine = createUpToDateEngine();
			const provider = vi.fn(async () => noUpdatePolicy({ checkIntervalSeconds: 1_800 }));
			const resume = createResumeEvents();
			const service = new UpdaterService(engine, "0.5.21", true, translate, {
				periodicCheckIntervalMs: 600_000,
				backgroundCheckMinGapMs: 60_000,
				systemEvents: resume.events,
				policyProvider: provider,
			});

			await service.onAppReady();
			await vi.advanceTimersByTimeAsync(0);
			expect(provider).toHaveBeenCalledTimes(1);

			// 距离上一次检查太近的唤醒（合盖再开、切换电源）不应重复请求更新源。
			await vi.advanceTimersByTimeAsync(30_000);
			resume.emit();
			await vi.advanceTimersByTimeAsync(0);
			expect(provider).toHaveBeenCalledTimes(1);

			await vi.advanceTimersByTimeAsync(60_000);
			resume.emit();
			await vi.advanceTimersByTimeAsync(0);
			expect(provider).toHaveBeenCalledTimes(2);

			// 唤醒补查后周期重新对齐到服务端间隔，补查之后的一个完整间隔才再查一次。
			await vi.advanceTimersByTimeAsync(1_799_000);
			expect(provider).toHaveBeenCalledTimes(2);
			await vi.advanceTimersByTimeAsync(1_000);
			expect(provider).toHaveBeenCalledTimes(3);

			service.dispose();
			expect(resume.listenerCount()).toBe(0);
		});

		it("checks again when the app comes back to the foreground", async () => {
			const engine = createUpToDateEngine();
			const provider = vi.fn(async () => noUpdatePolicy({ checkIntervalSeconds: 1_800 }));
			const foreground = createForegroundEvents();
			const service = new UpdaterService(engine, "0.5.21", true, translate, {
				periodicCheckIntervalMs: 600_000,
				backgroundCheckMinGapMs: 60_000,
				systemEvents: foreground.events,
				policyProvider: provider,
			});

			await service.onAppReady();
			await vi.advanceTimersByTimeAsync(0);
			expect(provider).toHaveBeenCalledTimes(1);

			// 与上一次检查间隔太近的「回到前台」不该重复请求更新源：切窗口会连发焦点事件。
			await vi.advanceTimersByTimeAsync(30_000);
			foreground.emit();
			await vi.advanceTimersByTimeAsync(0);
			expect(provider).toHaveBeenCalledTimes(1);

			await vi.advanceTimersByTimeAsync(60_000);
			foreground.emit();
			await vi.advanceTimersByTimeAsync(0);
			expect(provider).toHaveBeenCalledTimes(2);

			// 补查后周期重新对齐到服务端间隔，与唤醒补查的语义一致。
			await vi.advanceTimersByTimeAsync(1_799_000);
			expect(provider).toHaveBeenCalledTimes(2);
			await vi.advanceTimersByTimeAsync(1_000);
			expect(provider).toHaveBeenCalledTimes(3);

			service.dispose();
			expect(foreground.listenerCount()).toBe(0);
		});

		it("keeps the minimum gap short enough for foreground signals to matter", async () => {
			const engine = createUpToDateEngine();
			const provider = vi.fn(async () => noUpdatePolicy({ checkIntervalSeconds: 1_800 }));
			const foreground = createForegroundEvents();
			const service = new UpdaterService(engine, "0.5.21", true, translate, {
				periodicCheckIntervalMs: 600_000,
				systemEvents: foreground.events,
				policyProvider: provider,
			});

			await service.onAppReady();
			await vi.advanceTimersByTimeAsync(0);
			expect(provider).toHaveBeenCalledTimes(1);

			// 默认间隔必须是分钟级：前台信号只在用户在场时出现，等到下一次机会的代价太高。
			await vi.advanceTimersByTimeAsync(4 * 60_000);
			foreground.emit();
			await vi.advanceTimersByTimeAsync(0);
			expect(provider).toHaveBeenCalledTimes(1);

			await vi.advanceTimersByTimeAsync(60_000);
			foreground.emit();
			await vi.advanceTimersByTimeAsync(0);
			expect(provider).toHaveBeenCalledTimes(2);

			service.dispose();
		});

		it("subscribes and unsubscribes both system event sources", async () => {
			const engine = createUpToDateEngine();
			const provider = vi.fn(async () => noUpdatePolicy());
			const resume = createResumeEvents();
			const foreground = createForegroundEvents();
			const service = new UpdaterService(engine, "0.5.21", true, translate, {
				periodicCheckIntervalMs: 600_000,
				systemEvents: { onResume: resume.events.onResume, onForeground: foreground.events.onForeground },
				policyProvider: provider,
			});
			await service.onAppReady();

			expect(resume.listenerCount()).toBe(1);
			expect(foreground.listenerCount()).toBe(1);

			service.dispose();

			expect(resume.listenerCount()).toBe(0);
			expect(foreground.listenerCount()).toBe(0);
		});

		it("syncs opportunistically when the user opens the settings menu", async () => {
			const engine = createUpToDateEngine();
			const provider = vi.fn(async () => noUpdatePolicy());
			const service = new UpdaterService(engine, "0.5.21", true, translate, {
				backgroundCheckMinGapMs: 60_000,
				periodicCheckIntervalMs: 600_000,
				policyProvider: provider,
			});

			await service.onAppReady();
			await vi.advanceTimersByTimeAsync(0);
			expect(provider).toHaveBeenCalledTimes(1);

			// 反复开合菜单不应反复请求更新源。
			await service.syncInBackground();
			await service.syncInBackground();
			expect(provider).toHaveBeenCalledTimes(1);

			await vi.advanceTimersByTimeAsync(60_000);
			await service.syncInBackground();
			expect(provider).toHaveBeenCalledTimes(2);

			service.dispose();
		});

		it("does not sync in the background while a download is in flight", async () => {
			const engine = createAvailableEngine();
			const provider = vi.fn(async () => availablePolicy());
			const service = new UpdaterService(engine, "0.5.21", true, translate, {
				autoDownloadDelayMs: 10_000_000,
				backgroundCheckMinGapMs: 0,
				periodicCheckIntervalMs: 0,
				policyProvider: provider,
			});
			await service.check();
			void service.startDownload();
			expect(service.getState().phase).toBe("downloading");
			expect(provider).toHaveBeenCalledTimes(1);

			await service.syncInBackground();

			expect(provider).toHaveBeenCalledTimes(1);
			expect(service.getState().phase).toBe("downloading");
			service.cancel();
			service.dispose();
		});
	});

	describe("forced update semantics", () => {
		it("ignores dismiss while the server forces the update", async () => {
			const { service } = await createReadyService(true);
			const { sends, win } = createWindowRecorder();
			service.setMainWindow(win);
			sends.length = 0;
			const before = service.getState();

			service.dismissReady();

			expect(service.getState()).toEqual(before);
			// 强制更新期间连「把状态推给渲染层」都不做，渲染层不会收到任何可以收尾的信号。
			expect(sends).toHaveLength(0);
		});

		it("notifies the renderer on dismiss when the update is optional", async () => {
			const { service } = await createReadyService(false);
			const { sends, win } = createWindowRecorder();
			service.setMainWindow(win);
			sends.length = 0;
			const before = service.getState();

			service.dismissReady();

			// 忽略会把「被忽略的版本」记进状态：覆盖层据此不再显示，服务端换版本后才重新显示。
			expect(service.getState()).toEqual({ ...before, dismissedVersion: before.latestVersion });
			expect(sends.map((send) => send.channel)).toEqual(["vetta:updater:state"]);
			expect(sends[0]?.state.phase).toBe("ready");
		});

		it("ignores cancel while the server forces the update", async () => {
			const { engine, service } = await createCheckedService(true);
			void service.startDownload();
			const before = service.getState();
			expect(before.phase).toBe("downloading");

			service.cancel();

			expect(service.getState()).toEqual(before);
			expect(engine.cancelCalls).toBe(0);
		});

		it("cancels an optional download", async () => {
			const { engine, service } = await createCheckedService(false);
			void service.startDownload();
			expect(service.getState().phase).toBe("downloading");

			service.cancel();

			expect(engine.cancelCalls).toBe(1);
			expect(service.getState()).toMatchObject({
				phase: "idle",
				hasUpdate: false,
				forced: false,
				latestVersion: undefined,
			});
		});
	});
});
