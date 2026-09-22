export type UpdaterPhase = "idle" | "checking" | "available" | "downloading" | "ready" | "installing" | "error";

export interface UpdaterState {
	phase: UpdaterPhase;
	currentVersion: string;
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
