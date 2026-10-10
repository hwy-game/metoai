import { rm } from "node:fs/promises";
import { basename } from "node:path";
import type { BrowserWindow } from "electron";

import { resolvePackageFileName, type UpdatePackageDownloader } from "./update-download.js";
import { clampCheckInterval, compareVersions, type UpdatePolicy } from "./update-policy.js";
import type {
	UpdateEngine,
	UpdateEngineCheckResult,
	UpdateEngineDownload,
	UpdateEngineInfo,
} from "./updater-engine.js";

const EVENT_CHANNEL = "vetta:updater:state";
const DEFAULT_AUTO_DOWNLOAD_DELAY_MS = 20_000;
const DEFAULT_AUTO_DOWNLOAD_RETRY_DELAYS_MS = [30_000, 120_000, 600_000];
const DEFAULT_DOWNLOAD_STALL_TIMEOUT_MS = 120_000;
// 传输结束后的安装准备阶段没有任何进度事件（Squirrel.Mac 要解包近 1GB 的 bundle
// 再逐个校验签名），停滞超时会误判为下载失败，这里换用一个只防死锁的长兜底。
const DEFAULT_STAGING_TIMEOUT_MS = 600_000;
// 只在启动时检查一次，长期不退出应用的用户就长期收不到更新提示，
// 因此进程内还需要一条周期性重查，外加睡眠唤醒、应用回到前台与用户打开设置菜单时的机会性补查。
const DEFAULT_PERIODIC_CHECK_INTERVAL_MS = 2 * 60 * 60 * 1_000;
// 机会性补查的触发源都可能连发（合盖再开、反复开合菜单、来回切窗口），与上一次检查间隔太近就跳过。
// 间隔不能设得太长：唤醒、回到前台、打开设置菜单这些信号只在「用户此刻在场」时出现，
// 等不到下一个窗口就白白浪费了这次机会。周期性重查另由服务端的 `check_interval_seconds`
// 控制，不受这里影响。
const DEFAULT_BACKGROUND_CHECK_MIN_GAP_MS = 5 * 60 * 1_000;

/**
 * 本次可交付的更新来源：服务端登记了 `download_url` 且引擎能接管下载好的安装包时走
 * `package`，否则回落 electron-updater 的 feed（`engine`）。
 */
type PendingUpdate =
	| { kind: "engine"; info: UpdateEngineInfo }
	| { kind: "package"; version: string; url: string; sha256?: string; sizeBytes?: number; fileName: string };

interface ResolvedUpdateSource {
	pending: PendingUpdate;
	assetFileName?: string;
	totalBytes?: number;
	/** 引擎给出的更新说明，只在服务端没登记 `release_note` 时兜底。 */
	fallbackReleaseNote?: string;
}

interface UpdateSourceResolution {
	source: ResolvedUpdateSource | null;
	/** 选不出通道时给用户看的原因；「服务端说没有更新」时留空。 */
	error?: string;
	/**
	 * 没有任何应用内安装通道时，仍然可以引导用户去手动下载的地址。有值时 `runCheck`
	 * 会照常提示（可关闭），只是主操作变成「前往下载页」而不是静默收口。
	 */
	manualUrl?: string;
}

export type UpdaterPhase = "idle" | "checking" | "available" | "downloading" | "ready" | "installing" | "error";

export interface UpdaterState {
	phase: UpdaterPhase;
	currentVersion: string;
	/** 是否存在「服务端登记了比本机更高的版本」。覆盖层只认这个信号，不再看 phase。 */
	hasUpdate?: boolean;
	/**
	 * 是否存在应用内安装通道。false 时 `hasUpdate` 仍可为 true：覆盖层照常提示，
	 * 但主操作变成「前往下载页」，且强制会被降级为可关闭——拿不到应用内安装包时
	 * 锁死界面等于把用户挡在门外。
	 */
	installable?: boolean;
	/** 没有应用内安装通道时的下载地址（服务端登记值优先，其次产品官网）。 */
	manualDownloadUrl?: string;
	/** 用户已忽略提示的版本。与 `latestVersion` 相同则不再提示；换了版本会重新提示。 */
	dismissedVersion?: string;
	latestVersion?: string;
	releaseNote?: string;
	/** 0..1 */
	progress?: number;
	downloadedBytes?: number;
	totalBytes?: number;
	assetFileName?: string;
	error?: string;
	/** 服务端更新策略要求强制更新时为 true：此时提示不可关闭、下载不可取消。 */
	forced?: boolean;
	/** 强制更新的原因，用于覆盖层区分文案（"当前版本已不再支持" vs 一般强制）。 */
	forceReason?: "" | "policy" | "min_supported";
	/** 最近一次成功获取更新策略的时间（ISO 字符串）；拿不到策略时不更新。 */
	policyCheckedAt?: string;
}

export type UpdaterTranslate = (key: string, options?: Record<string, unknown>) => string;

/**
 * 宿主提供的系统电源事件。订阅发生在 app ready 之后（Electron 的 `powerMonitor`
 * 在 ready 前不可用），因此这里只暴露订阅函数，由 {@link UpdaterService.onAppReady} 调用。
 */
export interface UpdaterSystemEvents {
	/** 订阅「系统从睡眠/休眠唤醒」，返回取消订阅函数。 */
	onResume(listener: () => void): () => void;
	/**
	 * 订阅「应用回到前台」，返回取消订阅函数。可选：判定方式由宿主决定（见 updater.ts
	 * 基于 browser-window-focus/blur 的离开时长闸门），没有宿主信号时只剩唤醒与周期性重查。
	 */
	onForeground?(listener: () => void): () => void;
}

export interface UpdaterServiceOptions {
	autoDownloadDelayMs?: number;
	autoDownloadRetryDelaysMs?: readonly number[];
	downloadStallTimeoutMs?: number;
	stagingTimeoutMs?: number;
	/** 周期性重查间隔；<= 0 表示关闭周期性重查。 */
	periodicCheckIntervalMs?: number;
	/** 机会性补查（唤醒、打开设置菜单）与上一次检查之间要求的最小间隔。 */
	backgroundCheckMinGapMs?: number;
	systemEvents?: UpdaterSystemEvents;
	/**
	 * 更新策略来源，也是客户端唯一的版本检测来源。不传或返回 `null` 等价于
	 * 「当前没有可交付的更新」：既不弹窗也不强制。由宿主注入（见 updater.ts），
	 * 便于测试替换。
	 */
	policyProvider?: () => Promise<UpdatePolicy | null>;
	/**
	 * 服务端登记了 `download_url` 时使用的安装包下载器。不传则一律回落
	 * electron-updater 的 feed；注入后是否使用还要看引擎能否接管下载好的安装包。
	 */
	downloadPackage?: UpdatePackageDownloader;
	/**
	 * 服务端既没登记 `download_url`、feed 也交付不了时的兜底下载页（产品官网）。
	 * 有它才能保证「后台登记了新版本」一定给用户一条出路；没有时覆盖层退化成「重新检查」。
	 */
	fallbackDownloadUrl?: string;
}

export class UpdaterService {
	private state: UpdaterState;
	private mainWindow: BrowserWindow | null = null;
	private pendingUpdate: PendingUpdate | null = null;
	private activeDownload: UpdateEngineDownload | null = null;
	private autoDownloadTimer: NodeJS.Timeout | null = null;
	private downloadStallTimer: NodeJS.Timeout | null = null;
	private autoDownloadAttempts = 0;
	private autoDownloadOptOut = false;
	private lastProgressEmitAt = 0;
	private lastCheckStartedAt = 0;
	private checkPromise: Promise<UpdaterState> | null = null;
	private periodicCheckTimer: NodeJS.Timeout | null = null;
	private disposeSystemEvents: (() => void) | null = null;
	private readonly autoDownloadDelayMs: number;
	private readonly autoDownloadRetryDelaysMs: readonly number[];
	private readonly downloadStallTimeoutMs: number;
	private readonly stagingTimeoutMs: number;
	private periodicCheckIntervalMs: number;
	private readonly backgroundCheckMinGapMs: number;
	private readonly systemEvents: UpdaterSystemEvents | undefined;
	private readonly policyProvider: (() => Promise<UpdatePolicy | null>) | undefined;
	private readonly downloadPackage: UpdatePackageDownloader | undefined;
	private readonly fallbackDownloadUrl: string | undefined;

	constructor(
		private readonly engine: UpdateEngine,
		currentVersion: string,
		private readonly isPackaged: boolean,
		private readonly translate: UpdaterTranslate,
		options: UpdaterServiceOptions = {},
	) {
		this.state = {
			phase: "idle",
			currentVersion,
		};
		this.autoDownloadDelayMs = options.autoDownloadDelayMs ?? DEFAULT_AUTO_DOWNLOAD_DELAY_MS;
		this.autoDownloadRetryDelaysMs = options.autoDownloadRetryDelaysMs ?? DEFAULT_AUTO_DOWNLOAD_RETRY_DELAYS_MS;
		this.downloadStallTimeoutMs = options.downloadStallTimeoutMs ?? DEFAULT_DOWNLOAD_STALL_TIMEOUT_MS;
		this.stagingTimeoutMs = options.stagingTimeoutMs ?? DEFAULT_STAGING_TIMEOUT_MS;
		this.periodicCheckIntervalMs = options.periodicCheckIntervalMs ?? DEFAULT_PERIODIC_CHECK_INTERVAL_MS;
		this.backgroundCheckMinGapMs = options.backgroundCheckMinGapMs ?? DEFAULT_BACKGROUND_CHECK_MIN_GAP_MS;
		this.systemEvents = options.systemEvents;
		this.policyProvider = options.policyProvider;
		this.downloadPackage = options.downloadPackage;
		this.fallbackDownloadUrl = options.fallbackDownloadUrl;
	}

	setMainWindow(win: BrowserWindow): void {
		this.mainWindow = win;
		this.emit();
	}

	getState(): UpdaterState {
		return { ...this.state };
	}

	async onAppReady(): Promise<void> {
		if (!this.isPackaged) return;
		await this.engine.onAppReady?.();
		// 唤醒与回到前台都是「用户此刻大概率在看应用」的信号，走同一条机会性补查路径；
		// 两者统一在一个闭包里退订，dispose() 不需要知道有几个订阅。
		const disposers: Array<() => void> = [];
		const onResume = this.systemEvents?.onResume(() => {
			void this.syncInBackground();
		});
		if (onResume) disposers.push(onResume);
		const onForeground = this.systemEvents?.onForeground?.(() => {
			void this.syncInBackground();
		});
		if (onForeground) disposers.push(onForeground);
		this.disposeSystemEvents = () => {
			for (const dispose of disposers) dispose();
		};
		void this.check();
		this.schedulePeriodicCheck();
	}

	/** 停止周期性重查并退订系统事件；进程退出或测试收尾时调用。 */
	dispose(): void {
		this.clearPeriodicCheckTimer();
		this.disposeSystemEvents?.();
		this.disposeSystemEvents = null;
	}

	check(): Promise<UpdaterState> {
		if (this.checkPromise) return this.checkPromise;
		this.lastCheckStartedAt = Date.now();
		this.checkPromise = this.runCheck().finally(() => {
			this.checkPromise = null;
		});
		return this.checkPromise;
	}

	/**
	 * 检测、弹窗内容与下载来源都以 metotoken 的版本管理为准（见 docs/adr/0120）。
	 *
	 * 判定顺序：
	 * 1. 拿不到策略 → 认为「没有可交付的更新」，并清掉上一次的强制态与版本字段；
	 * 2. 策略说没有更高版本 → 同上；
	 * 3. 策略登记了更高版本，但既没有可用的 `download_url`、feed 也给不出这个版本
	 *    → 同样按「没有更新」收口。宁可暂时不提示，也不能弹一条永远装不上的强制提示。
	 */
	private async runCheck(): Promise<UpdaterState> {
		if (!this.isPackaged) {
			this.setState({
				phase: "error",
				error: this.translate("updater.errors.developmentUnsupported"),
			});
			return this.getState();
		}

		this.setState({ phase: "checking", error: undefined });

		const policy = await this.resolvePolicy();
		if (!policy) {
			// 拿不到策略：清掉上一次的强制态，避免旧的「必须更新」残留。
			this.resetToIdle();
			return this.getState();
		}

		// 采用夹取后的服务端建议间隔：既对齐策略，也不会比默认更激进。这一段必须在
		// 「有没有更新」的判断之前——管理台调小间隔的目的就是让「刚发布的新版本」更快被
		// 发现，而还没看到新版本的客户端恰恰全都走下面的早退分支。
		// clampCheckInterval 返回秒，而 periodicCheckIntervalMs 是毫秒：漏掉换算会让间隔
		// 缩短 1000 倍（默认 2 小时变 7.2 秒），变成对更新服务端的高频轮询。
		this.periodicCheckIntervalMs = clampCheckInterval(policy.checkIntervalSeconds) * 1_000;
		this.setState({ policyCheckedAt: new Date().toISOString() });
		// 若已有待触发的周期定时器，用新间隔重新对齐；关闭周期重查时不主动开启。
		if (this.periodicCheckTimer) this.schedulePeriodicCheck();

		// 只有「服务端登记的版本高于本机」才继续；否则这次检查就是「没有更新」。
		const latestVersion = policy.hasUpdate ? policy.latestVersion : undefined;
		if (!latestVersion || compareVersions(latestVersion, this.state.currentVersion) <= 0) {
			this.resetToIdle();
			return this.getState();
		}

		const resolution = await this.resolveUpdateSource(policy, latestVersion);
		if (!resolution.source) {
			// 没有应用内安装通道，但有一条能引导用户手动下载的地址：仍然提示，只是把主操作
			// 换成「前往下载页」。强制在这里降级为可关闭——用户拿不到应用内安装包时锁死界面
			// 等于把人挡在门外，那正是改造前「永远装不上的强制提示」的成因。
			if (resolution.manualUrl) {
				console.warn(`[updater] no in-app package for ${latestVersion}; prompting a manual download`);
				this.pendingUpdate = null;
				this.cancelScheduledAutoDownload();
				this.setState({
					phase: "available",
					hasUpdate: true,
					installable: false,
					manualDownloadUrl: resolution.manualUrl,
					forced: false,
					forceReason: "",
					latestVersion,
					releaseNote: policy.releaseNote,
					assetFileName: undefined,
					totalBytes: undefined,
					progress: undefined,
					downloadedBytes: undefined,
					error: undefined,
				});
				return this.getState();
			}
			console.warn(`[updater] no deliverable package for ${latestVersion}; keeping the user unblocked`);
			this.resetToIdle(resolution.error);
			return this.getState();
		}

		this.pendingUpdate = resolution.source.pending;
		this.autoDownloadAttempts = 0;
		this.setState({
			phase: "available",
			hasUpdate: true,
			installable: true,
			manualDownloadUrl: undefined,
			forced: policy.forced,
			forceReason: policy.reason,
			// 界面上的版本号与更新说明一律取服务端登记值：它是唯一事实源，
			// feed 只负责把安装包送到本地。
			latestVersion,
			releaseNote: policy.releaseNote ?? resolution.source.fallbackReleaseNote,
			assetFileName: resolution.source.assetFileName,
			totalBytes: resolution.source.totalBytes,
			progress: undefined,
			downloadedBytes: undefined,
			error: undefined,
		});
		this.scheduleAutoDownload(this.autoDownloadDelayMs);
		return this.getState();
	}

	/** 策略来源：provider 未注入、抛错或返回 `null` 都算「拿不到策略」。 */
	private async resolvePolicy(): Promise<UpdatePolicy | null> {
		if (!this.policyProvider) return null;
		try {
			return await this.policyProvider();
		} catch (error) {
			console.warn("[updater] update policy provider failed", error);
			return null;
		}
	}
	/**
	 * 手动下载兜底地址：服务端登记的 `download_url`（已过下载白名单校验）优先，
	 * 否则退回构建期注入的产品官网。两者都没有时返回 undefined。
	 */
	private resolveManualUrl(policy: UpdatePolicy): string | undefined {
		if (policy.downloadUrl) return policy.downloadUrl;
		const site = this.fallbackDownloadUrl?.trim();
		return site && site.length > 0 ? site : undefined;
	}

	/**
	 * 选一条真能把 `latestVersion` 装到本机的通道：优先服务端登记的可下载包
	 * （还要求引擎能接管下载好的安装包），否则回落 electron-updater feed，并要求
	 * feed 给出的版本不低于策略版本。两者都不可用 → `source` 为 `null`，此时仍会带上
	 * `manualUrl`（能引导用户手动下载的地址），让调用方照常提示而不是静默收口。
	 */
	private async resolveUpdateSource(policy: UpdatePolicy, latestVersion: string): Promise<UpdateSourceResolution> {
		const adopt = this.engine.adoptDownloadedPackage?.bind(this.engine);
		if (policy.downloadUrl && this.downloadPackage && adopt && this.engine.canInstallDownloadedPackage?.()) {
			const fileName = resolvePackageFileName({
				version: latestVersion,
				url: policy.downloadUrl,
				fileName: policy.fileName,
			});
			return {
				source: {
					pending: {
						kind: "package",
						version: latestVersion,
						url: policy.downloadUrl,
						sha256: policy.sha256,
						sizeBytes: policy.sizeBytes,
						fileName,
					},
					assetFileName: fileName,
					totalBytes: policy.sizeBytes,
				},
			};
		}

		let result: UpdateEngineCheckResult | null;
		try {
			result = await this.engine.checkForUpdates();
		} catch (error) {
			console.error("[updater] update feed check failed", error);
			return { source: null, manualUrl: this.resolveManualUrl(policy) };
		}
		if (!result) {
			return {
				source: null,
				error: this.translate("updater.errors.configurationUnavailable"),
				manualUrl: this.resolveManualUrl(policy),
			};
		}
		if (!result.hasUpdate || compareVersions(result.info.version, latestVersion) < 0) {
			return { source: null, manualUrl: this.resolveManualUrl(policy) };
		}

		return {
			source: {
				pending: { kind: "engine", info: result.info },
				assetFileName: result.info.assetFileName,
				totalBytes: result.info.totalBytes,
				fallbackReleaseNote: result.info.releaseNote,
			},
		};
	}

	/**
	 * 收口到「没有可交付的更新」：清掉上一次的强制态与版本字段，避免策略不可达或
	 * 后台误登记时界面留着一条装不上的提示。`policyCheckedAt` 刻意保留——它记录的
	 * 是「上一次成功拿到策略」的时间，不是本次结果。
	 */
	private resetToIdle(error?: string): void {
		this.pendingUpdate = null;
		this.cancelScheduledAutoDownload();
		this.setState({
			phase: "idle",
			hasUpdate: false,
			installable: undefined,
			manualDownloadUrl: undefined,
			forced: false,
			forceReason: "",
			latestVersion: undefined,
			releaseNote: undefined,
			progress: undefined,
			downloadedBytes: undefined,
			totalBytes: undefined,
			assetFileName: undefined,
			error,
		});
	}

	async startDownload(options?: { auto?: boolean }): Promise<UpdaterState> {
		const auto = options?.auto === true;
		if (this.state.phase === "downloading" || this.state.phase === "ready") return this.getState();
		if (!this.isPackaged) {
			if (!auto) {
				this.setState({
					phase: "error",
					error: this.translate("updater.errors.developmentUnsupported"),
				});
			}
			return this.getState();
		}

		if (!auto) {
			this.autoDownloadOptOut = false;
			this.cancelScheduledAutoDownload();
		}
		let pending = this.pendingUpdate;
		if (!pending) {
			await this.check();
			pending = this.pendingUpdate;
			if (this.state.phase !== "available" || !pending) return this.getState();
		}

		this.setState({
			phase: "downloading",
			progress: 0,
			downloadedBytes: 0,
			totalBytes: pending.kind === "engine" ? pending.info.totalBytes : pending.sizeBytes,
			error: undefined,
		});

		const download =
			pending.kind === "package"
				? this.startPackageDownload(pending)
				: this.engine.downloadUpdate(
						(progress) => this.onProgress(progress),
						() => this.onStaging(),
					);
		this.activeDownload = download;
		this.resetDownloadStallTimer(download);
		try {
			const paths = await download.promise;
			if (this.activeDownload !== download) return this.getState();
			const downloadedPath = paths.at(-1);
			this.clearDownloadStallTimer();
			this.activeDownload = null;
			this.setState({
				phase: "ready",
				progress: 1,
				downloadedBytes: this.state.totalBytes,
				assetFileName: downloadedPath ? basename(downloadedPath) : this.state.assetFileName,
				error: undefined,
			});
		} catch (error) {
			if (this.activeDownload !== download) return this.getState();
			this.clearDownloadStallTimer();
			this.activeDownload = null;
			console.error("[updater] download failed", error);
			if (auto) {
				this.setState({
					phase: "available",
					progress: undefined,
					downloadedBytes: undefined,
					error: undefined,
				});
			} else {
				this.setState({
					phase: "error",
					error: this.translate("updater.errors.downloadFailed"),
				});
			}
		}
		return this.getState();
	}

	/**
	 * 走服务端登记的安装包：先下载并按 `sha256` 校验，再交给引擎走同一套安装准备
	 * 流程。进度语义与 electron-updater 路径保持一致——网络阶段占 0～90%，剩下 10%
	 * 是 Inno Setup 展开新版本目录的本地准备。
	 */
	private startPackageDownload(pending: Extract<PendingUpdate, { kind: "package" }>): UpdateEngineDownload {
		const downloader = this.downloadPackage;
		const abortController = new AbortController();
		const promise = (async () => {
			if (!downloader) throw new Error("no update package downloader is configured");
			const adopt = this.engine.adoptDownloadedPackage?.bind(this.engine);
			if (!adopt) throw new Error("this engine cannot install a downloaded update package");

			const downloaded = await downloader(
				{
					version: pending.version,
					url: pending.url,
					fileName: pending.fileName,
					sha256: pending.sha256,
					sizeBytes: pending.sizeBytes,
				},
				{
					signal: abortController.signal,
					onProgress: (progress) =>
						this.onProgress({ ...progress, percent: Math.min(90, progress.percent * 0.9) }),
				},
			);

			// 传输已结束：后面是本地安装准备，不再产生网络进度。
			this.onStaging();
			const preparedPaths = await adopt(downloaded, (progress) => this.onProgress(progress), abortController.signal);
			// 安装器已经把新版本展开到 storeRoot，源安装包不再需要；失败路径刻意保留它，
			// 便于排查「装不上」到底是下载还是安装的问题。
			void rm(downloaded.path, { force: true }).catch((error) => {
				console.warn("[updater] unable to remove the downloaded update package", error);
			});
			return preparedPaths;
		})();

		return { promise, cancel: () => abortController.abort() };
	}

	async install(): Promise<void> {
		if (this.state.phase !== "ready") return Promise.resolve();
		this.setState({ phase: "installing" });
		try {
			await this.engine.quitAndInstall();
		} catch (error) {
			console.error("[updater] install failed", error);
			this.setState({
				phase: "error",
				error: this.translate("updater.errors.installFailed"),
			});
		}
	}

	/**
	 * 用户点「忽略」：记住被忽略的版本，提示不再出现（服务端换了版本会重新出现）。
	 * 强制更新期间不可忽略——用户必须先完成更新。
	 *
	 * `ready` 阶段额外 emit 一次：横幅自己按版本记忆忽略状态，这里只是把最新快照
	 * 重新推给监听者。
	 */
	dismissReady(): void {
		// 强制更新期间提示不可关闭：用户必须先完成更新。
		if (this.state.forced) return;
		// 记到状态里而不是只留在渲染层：覆盖层按「已忽略的版本 ≠ 最新版本」决定是否显示，
		// 因此重查命中同一版本时不会又把提示弹回来。`setState` 自己就会 emit，不必再推一次。
		if (this.state.latestVersion) {
			this.setState({ dismissedVersion: this.state.latestVersion });
			return;
		}
		if (this.state.phase === "ready") this.emit();
	}

	cancel(): void {
		// 强制更新期间不可取消下载/回退，否则用户能绕过强制约束。
		if (this.state.forced) return;
		if (this.state.phase === "ready" || this.state.phase === "installing") return;
		this.autoDownloadOptOut = true;
		this.cancelScheduledAutoDownload();
		const download = this.activeDownload;
		this.clearDownloadStallTimer();
		this.activeDownload = null;
		download?.cancel();
		this.pendingUpdate = null;
		this.setState({
			phase: "idle",
			hasUpdate: false,
			installable: undefined,
			manualDownloadUrl: undefined,
			latestVersion: undefined,
			releaseNote: undefined,
			progress: undefined,
			downloadedBytes: undefined,
			totalBytes: undefined,
			assetFileName: undefined,
			error: undefined,
		});
	}

	/**
	 * 后台重查只在没有进行中的更新流程时发生：已经处于 available/downloading/ready/installing
	 * 时重查没有新信息，还会打断正在进行的下载状态。
	 */
	private async checkIfNotBusy(): Promise<void> {
		if (this.state.phase !== "idle" && this.state.phase !== "error") return;
		await this.check();
	}

	/**
	 * 机会性补查：系统唤醒、应用回到前台、用户打开设置菜单等「此刻用户大概率在看应用」的时机。
	 * 触发源可能连发，因此与上一次检查间隔不足时直接跳过；补查后重新对齐周期，
	 * 避免刚查完又被积压的定时器再查一次。
	 */
	async syncInBackground(): Promise<void> {
		if (!this.isPackaged) return;
		if (Date.now() - this.lastCheckStartedAt < this.backgroundCheckMinGapMs) return;
		await this.checkIfNotBusy();
		this.schedulePeriodicCheck();
	}

	private schedulePeriodicCheck(): void {
		this.clearPeriodicCheckTimer();
		if (this.periodicCheckIntervalMs <= 0) return;
		const timer = setTimeout(() => {
			this.periodicCheckTimer = null;
			void this.runPeriodicCheck();
		}, this.periodicCheckIntervalMs);
		// 更新检查不应该单独把进程钉在事件循环里。
		timer.unref?.();
		this.periodicCheckTimer = timer;
	}

	private async runPeriodicCheck(): Promise<void> {
		await this.checkIfNotBusy();
		this.schedulePeriodicCheck();
	}

	private clearPeriodicCheckTimer(): void {
		if (!this.periodicCheckTimer) return;
		clearTimeout(this.periodicCheckTimer);
		this.periodicCheckTimer = null;
	}

	private onProgress(progress: { percent: number; transferred: number; total: number }): void {
		if (this.activeDownload) this.resetDownloadStallTimer(this.activeDownload);
		const now = Date.now();
		if (now - this.lastProgressEmitAt < 250 && progress.transferred < progress.total) return;
		this.lastProgressEmitAt = now;
		this.state = {
			...this.state,
			progress: Math.max(0, Math.min(1, progress.percent / 100)),
			downloadedBytes: progress.transferred,
			totalBytes: progress.total,
		};
		this.emit();
	}

	// 安装准备阶段没有进度事件，进度停在引擎给出的最后一个网络值（90%），
	// 与 Windows 的 Inno 阶段语义一致；这里只把停滞超时换成更长的兜底。
	private onStaging(): void {
		const download = this.activeDownload;
		if (!download || this.state.phase !== "downloading") return;
		this.resetDownloadStallTimer(download, this.stagingTimeoutMs);
	}

	private scheduleAutoDownload(delayMs: number): void {
		if (this.autoDownloadOptOut || this.autoDownloadTimer) return;
		this.autoDownloadTimer = setTimeout(() => {
			this.autoDownloadTimer = null;
			void this.runAutoDownload();
		}, delayMs);
	}

	private async runAutoDownload(): Promise<void> {
		if (this.state.phase !== "available") return;
		this.autoDownloadAttempts += 1;
		const result = await this.startDownload({ auto: true });
		if (result.phase === "ready" || this.autoDownloadOptOut) return;
		const retryDelay = this.autoDownloadRetryDelaysMs[this.autoDownloadAttempts - 1];
		if (retryDelay !== undefined) this.scheduleAutoDownload(retryDelay);
	}

	private cancelScheduledAutoDownload(): void {
		if (!this.autoDownloadTimer) return;
		clearTimeout(this.autoDownloadTimer);
		this.autoDownloadTimer = null;
	}

	private resetDownloadStallTimer(download: UpdateEngineDownload, timeoutMs = this.downloadStallTimeoutMs): void {
		this.clearDownloadStallTimer();
		this.downloadStallTimer = setTimeout(() => {
			if (this.activeDownload !== download) return;
			this.downloadStallTimer = null;
			this.activeDownload = null;
			download.cancel();
			this.setState({
				phase: "error",
				progress: undefined,
				downloadedBytes: undefined,
				error: this.translate("updater.errors.downloadFailed"),
			});
		}, timeoutMs);
	}

	private clearDownloadStallTimer(): void {
		if (!this.downloadStallTimer) return;
		clearTimeout(this.downloadStallTimer);
		this.downloadStallTimer = null;
	}

	private setState(patch: Partial<UpdaterState>): void {
		this.state = { ...this.state, ...patch };
		this.emit();
	}

	private emit(): void {
		const win = this.mainWindow;
		if (!win || win.isDestroyed()) return;
		win.webContents.send(EVENT_CHANNEL, this.state);
	}
}
