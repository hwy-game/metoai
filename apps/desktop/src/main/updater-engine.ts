import { link, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import type { ProgressInfo, UpdateInfo } from "builder-util-runtime";
import { CancellationToken, CURRENT_APP_INSTALLER_FILE_NAME } from "builder-util-runtime";
import type { AppUpdater, ResolvedUpdateFileInfo } from "electron-updater";

import type { InnoWindowsUpdateController } from "./inno-windows-update.js";

export interface UpdateEngineInfo {
	version: string;
	releaseNote?: string;
	assetFileName?: string;
	totalBytes?: number;
}

export interface UpdateEngineCheckResult {
	hasUpdate: boolean;
	info: UpdateEngineInfo;
}

export interface UpdateEngineDownload {
	promise: Promise<string[]>;
	cancel(): void;
}

export interface UpdateEngine {
	onAppReady?(): Promise<void>;
	checkForUpdates(): Promise<UpdateEngineCheckResult | null>;
	/**
	 * `onStaging` 表示传输已结束、进入不再产生 progress 的安装准备阶段
	 * （macOS 下即 Squirrel.Mac 解包与签名校验），调用方据此改用更长的兜底超时。
	 */
	downloadUpdate(onProgress: (progress: ProgressInfo) => void, onStaging?: () => void): UpdateEngineDownload;
	quitAndInstall(): Promise<void>;
	/**
	 * 引擎能否接管宿主自行下载好的安装包（服务端 `download_url`）。
	 * Windows 的 Inno 版本化布局可以：直接把 exe 交给 Inno Setup 展开新版本目录；
	 * macOS 的 Squirrel.Mac 只安装自己 appcast 里带 sha512 的 ZIP，因此不支持。
	 */
	canInstallDownloadedPackage?(): boolean;
	/**
	 * 用宿主已下载并校验过的安装包走同一套安装准备流程，返回可安装的产物路径。
	 * 只有 `canInstallDownloadedPackage()` 为真时才可调用。
	 */
	adoptDownloadedPackage?(
		pkg: { path: string; version: string; fileName: string; sizeBytes: number },
		onProgress: (progress: ProgressInfo) => void,
		signal: AbortSignal,
	): Promise<string[]>;
}

/**
 * 把控制权交给安装器前后各需要一次介入，缺任何一个这条链路都会静默失败，
 * 三种失败模式见 quitAndInstall 的注释与 mac-installer-handoff.ts。
 */
export interface UpdateEngineQuitHooks {
	/** 交棒前：标记应用正在退出，并跑完退出清理。 */
	prepare?: () => Promise<void> | void;
	/** 交棒后：等安装器接手，再真正结束本进程。 */
	finalize?: () => Promise<void>;
}

export interface NativeMacUpdateEvents {
	onUpdateDownloaded(listener: () => void): () => void;
	onError(listener: (error: Error) => void): () => void;
}

interface UpdateProviderAccess {
	updateInfoAndProvider: {
		provider: {
			resolveFiles(info: UpdateInfo): Array<ResolvedUpdateFileInfo>;
		};
	} | null;
	downloadedUpdateHelper: {
		cacheDir: string;
	} | null;
}

function resolveUpdateFiles(updater: AppUpdater, info: UpdateInfo): Array<ResolvedUpdateFileInfo> {
	const provider = (updater as unknown as UpdateProviderAccess).updateInfoAndProvider?.provider;
	return provider?.resolveFiles(info) ?? [];
}

async function promoteDownloadedInstaller(updater: AppUpdater, installerPath: string): Promise<void> {
	const cacheDir = (updater as unknown as UpdateProviderAccess).downloadedUpdateHelper?.cacheDir;
	if (!cacheDir) return;
	const currentInstallerPath = join(cacheDir, CURRENT_APP_INSTALLER_FILE_NAME);
	const temporaryPath = `${currentInstallerPath}.${process.pid}.tmp`;
	await rm(temporaryPath, { force: true });
	try {
		await link(installerPath, temporaryPath);
		await rm(currentInstallerPath, { force: true });
		await rename(temporaryPath, currentInstallerPath);
	} catch (error) {
		await Promise.all([
			rm(temporaryPath, { force: true }),
			rm(currentInstallerPath, { force: true }),
			rm(join(cacheDir, "current.blockmap"), { force: true }),
		]);
		throw error;
	}
}

function normalizeReleaseNotes(releaseNotes: UpdateInfo["releaseNotes"]): string | undefined {
	if (typeof releaseNotes === "string") return releaseNotes || undefined;
	if (!Array.isArray(releaseNotes)) return undefined;

	const notes = releaseNotes
		.map((item) => item.note)
		.filter((note): note is string => typeof note === "string" && note.length > 0);
	return notes.length > 0 ? notes.join("\n\n") : undefined;
}

function getAssetFileName(url: string): string | undefined {
	try {
		const pathname = new URL(url).pathname;
		const fileName = pathname.split("/").pop();
		return fileName ? decodeURIComponent(fileName) : undefined;
	} catch {
		const fileName = url.split(/[\\/]/).pop();
		return fileName || undefined;
	}
}

function mapUpdateInfo(info: UpdateInfo): UpdateEngineInfo {
	const file = info.files[0];
	return {
		version: info.version,
		releaseNote: normalizeReleaseNotes(info.releaseNotes),
		assetFileName: file ? getAssetFileName(file.url) : undefined,
		totalBytes: file?.size,
	};
}

function waitForNativeMacUpdate(events: NativeMacUpdateEvents): { promise: Promise<void>; dispose: () => void } {
	let disposed = false;
	let removeUpdateDownloadedListener = () => {};
	let removeErrorListener = () => {};

	const dispose = () => {
		if (disposed) return;
		disposed = true;
		removeUpdateDownloadedListener();
		removeErrorListener();
	};
	const promise = new Promise<void>((resolve, reject) => {
		removeUpdateDownloadedListener = events.onUpdateDownloaded(() => {
			dispose();
			resolve();
		});
		removeErrorListener = events.onError((error) => {
			dispose();
			reject(error);
		});
	});

	return { promise, dispose };
}

export class ElectronUpdaterEngine implements UpdateEngine {
	private useInnoUpdate = false;

	constructor(
		private readonly updater: AppUpdater,
		private readonly innoWindowsUpdate?: InnoWindowsUpdateController,
		private readonly nativeMacUpdateEvents?: NativeMacUpdateEvents,
		private readonly quitHooks: UpdateEngineQuitHooks = {},
	) {
		this.updater.autoDownload = false;
		this.updater.autoInstallOnAppQuit = !innoWindowsUpdate;
		this.updater.allowDowngrade = false;
		this.updater.disableWebInstaller = true;
		this.updater.logger = {
			info: (message?: unknown) => console.info("[updater]", message),
			warn: (message?: unknown) => console.warn("[updater]", message),
			error: (message?: unknown) => console.error("[updater]", message),
			debug: (message: string) => console.debug("[updater]", message),
		};
		// electron-updater 会同时通过 Promise 和 error 事件报告失败。
		// 保留监听器，避免 EventEmitter 将未监听的 error 当作进程级异常。
		this.updater.on("error", (error) => {
			console.error("[updater]", error);
		});
	}

	async onAppReady(): Promise<void> {
		await this.innoWindowsUpdate?.markCurrentVersionHealthy();
	}

	async checkForUpdates(): Promise<UpdateEngineCheckResult | null> {
		const result = await this.updater.checkForUpdates();
		if (!result) return null;
		const info = mapUpdateInfo(result.updateInfo);
		const innoAsset = result.isUpdateAvailable
			? this.innoWindowsUpdate?.select(result.updateInfo, resolveUpdateFiles(this.updater, result.updateInfo))
			: null;
		this.useInnoUpdate = innoAsset !== null && innoAsset !== undefined;
		return {
			hasUpdate: result.isUpdateAvailable,
			info: innoAsset ? { ...info, ...innoAsset } : info,
		};
	}

	canInstallDownloadedPackage(): boolean {
		return this.innoWindowsUpdate !== undefined;
	}

	async adoptDownloadedPackage(
		pkg: { path: string; version: string; fileName: string; sizeBytes: number },
		onProgress: (progress: ProgressInfo) => void,
		signal: AbortSignal,
	): Promise<string[]> {
		const innoWindowsUpdate = this.innoWindowsUpdate;
		if (!innoWindowsUpdate) throw new Error("this build cannot install an externally downloaded package");
		this.useInnoUpdate = true;
		innoWindowsUpdate.selectDownloadedPackage(pkg);
		// 差分下载的基线缓存只有 electron-updater 自己下过包时才存在：有就顺手同步过去，
		// 没有也不影响本次安装（activate() 不读这个缓存）。
		await promoteDownloadedInstaller(this.updater, pkg.path)
			.then(() => console.info("[updater] differential cache baseline promoted"))
			.catch((error) => console.warn("[updater] unable to promote differential cache baseline", error));
		console.info("[updater] preparing a server-provided Windows version with Inno Setup", pkg.path);
		const preparedPaths = await innoWindowsUpdate.prepareDownloadedInstaller(pkg.path, onProgress, signal);
		console.info("[updater] server-provided Windows version is ready", preparedPaths[0]);
		return preparedPaths;
	}

	downloadUpdate(onProgress: (progress: ProgressInfo) => void, onStaging?: () => void): UpdateEngineDownload {
		const cancellationToken = new CancellationToken();
		const abortController = new AbortController();
		// 两个平台的下载后都还有一段本地安装准备（Windows 的 Inno 展开版本目录、
		// macOS 的 Squirrel.Mac 解包与验签），因此网络阶段统一压缩到 0～90%，
		// 「90% 之后是本地准备而非网络问题」这条排障语义在两端一致。
		const listener = (progress: ProgressInfo) => {
			const hasLocalPreparation = this.useInnoUpdate || this.nativeMacUpdateEvents !== undefined;
			onProgress(
				hasLocalPreparation
					? {
							...progress,
							percent: Math.min(90, progress.percent * 0.9),
						}
					: progress,
			);
		};
		this.updater.on("download-progress", listener);
		const nativeMacReadiness = this.nativeMacUpdateEvents
			? waitForNativeMacUpdate(this.nativeMacUpdateEvents)
			: undefined;
		if (nativeMacReadiness) {
			console.info("[updater] waiting for Squirrel.Mac to stage the update");
		}

		const updaterDownloadPromise = this.updater.downloadUpdate(cancellationToken);
		// electron-updater 在把 ZIP 喂完给 Squirrel.Mac 的那一刻就 resolve，之后的解包与
		// 签名校验不再产生 download-progress 事件，必须显式告知调用方进入了暂存阶段。
		const stagedDownloadPromise = nativeMacReadiness
			? Promise.all([
					updaterDownloadPromise.then((downloadedPaths) => {
						onStaging?.();
						return downloadedPaths;
					}),
					nativeMacReadiness.promise,
				]).then(([downloadedPaths]) => {
					console.info("[updater] Squirrel.Mac update is ready to install");
					return downloadedPaths;
				})
			: updaterDownloadPromise;
		const promise = stagedDownloadPromise
			.then(async (downloadedPaths) => {
				if (!this.useInnoUpdate || !this.innoWindowsUpdate) return downloadedPaths;
				const installerPath = downloadedPaths[0];
				if (!installerPath) throw new Error("electron-updater did not return a Windows installer");
				await promoteDownloadedInstaller(this.updater, installerPath)
					.then(() => console.info("[updater] differential cache baseline promoted"))
					.catch((error) => console.warn("[updater] unable to promote differential cache baseline", error));
				console.info("[updater] preparing downloaded Windows version with Inno Setup", installerPath);
				const preparedPaths = await this.innoWindowsUpdate.prepareDownloadedInstaller(
					installerPath,
					onProgress,
					abortController.signal,
				);
				console.info("[updater] downloaded Windows version is ready", preparedPaths[0]);
				return preparedPaths;
			})
			.finally(() => {
				nativeMacReadiness?.dispose();
				this.updater.off("download-progress", listener);
			});

		return {
			promise,
			cancel: () => {
				abortController.abort();
				cancellationToken.cancel();
			},
		};
	}

	async quitAndInstall(): Promise<void> {
		// 交棒前：标记「正在退出」并跑完退出清理。不标记的话窗口 close 守卫会把关闭
		// 改成隐藏，而 Squirrel.Mac 走 NSApp terminate 语义，任一窗口 preventDefault
		// 就取消整个终止流程——症状是「点了重启但应用没退」。
		await this.quitHooks.prepare?.();
		if (this.useInnoUpdate && this.innoWindowsUpdate) {
			await this.innoWindowsUpdate.activate();
		} else {
			this.updater.quitAndInstall(true, true);
		}
		// 交棒后：等安装器接手再结束进程。既不能立刻硬 exit（Squirrel 还没提交
		// launchd 作业），也不能不 exit（本进程挂着 sidecar 等句柄不会自行退出，而
		// launchd 要等目标进程退出才 spawn ShipIt）。两种都实测失败过，
		// 详见 mac-installer-handoff.ts。
		await this.quitHooks.finalize?.();
	}
}
