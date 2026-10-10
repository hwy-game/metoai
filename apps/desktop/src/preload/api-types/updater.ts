export type UpdaterPhase = "idle" | "checking" | "available" | "downloading" | "ready" | "installing" | "error";

export interface UpdaterState {
	phase: UpdaterPhase;
	currentVersion: string;
	/** 是否存在「服务端登记了比本机更高的版本」。覆盖层只认这个信号，不再看 phase。 */
	hasUpdate?: boolean;
	/**
	 * 是否存在应用内安装通道。false 时 `hasUpdate` 仍可为 true：覆盖层照常提示，
	 * 但主操作变成「前往下载页」，且提示可关闭。
	 */
	installable?: boolean;
	/** 没有应用内安装通道时的下载地址，覆盖层用它渲染「前往下载页」。 */
	manualDownloadUrl?: string;
	/** 用户已忽略提示的版本；与 `latestVersion` 相同则不再提示。 */
	dismissedVersion?: string;
	latestVersion?: string;
	releaseNote?: string;
	/** 0..1 */
	progress?: number;
	downloadedBytes?: number;
	totalBytes?: number;
	assetFileName?: string;
	error?: string;
	/** 服务端更新策略要求强制更新时为 true：提示不可关闭、下载不可取消。 */
	forced?: boolean;
	/** 强制更新的原因，用于覆盖层区分文案。 */
	forceReason?: "" | "policy" | "min_supported";
	/** 最近一次成功获取更新策略的时间（ISO 字符串）；拿不到策略时不更新。 */
	policyCheckedAt?: string;
}

export interface DesktopUpdaterApi {
	check(): Promise<UpdaterState>;
	/** 机会性后台补查：忙碌或距上次检查太近时静默跳过，不改变 UI 的忙碌态。 */
	sync(): Promise<void>;
	getState(): Promise<UpdaterState>;
	getCurrentVersion(): Promise<string>;
	/** 启动后台下载（无感）。返回最终状态。 */
	download(): Promise<UpdaterState>;
	/** 立即重启并安装（仅当 state.phase === "ready"） */
	install(): Promise<void>;
	/** 用户点"稍后"：关闭提示；应用退出时由 electron-updater 自动安装 */
	dismiss(): Promise<void>;
	/** 取消待下载或正在进行的下载；已下载完成时不执行操作 */
	cancel(): Promise<void>;
	/** 订阅状态变化。返回取消函数。 */
	onStateChanged(handler: (state: UpdaterState) => void): () => void;
}
