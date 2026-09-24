/**
 * MetoAi 控制台的 preload 契约。
 *
 * 所有调用都返回 `MetoAiIpcResult`：失败是**值**而不是异常，因为 `Error` 实例
 * 过不了结构化克隆，异常穿过进程边界后 `code` / `status` 会丢，渲染层就没法区分
 * 「会话已失效」和「网络抖动」。字段形状与线上契约一致（snake_case），见
 * `shared/metoai-types.ts`。
 *
 * 授权登录是两段式：`authorize()` / `reopenAuthorize()` 只负责打开系统浏览器，
 * 结果由 `onSessionChanged`（成功）或 `onAuthorizeRejected`（失败）推送。
 */

import type {
	MetoAiAccountOverview,
	MetoAiAuthorizeRejection,
	MetoAiAuthorizeResult,
	MetoAiIpcResult,
	MetoAiModelAccessResult,
	MetoAiSessionSnapshot,
	MetoAiSiteConfig,
	MetoAiSubscription,
	MetoAiTokenDraft,
	MetoAiTokenPage,
	MetoAiTokenPageQuery,
} from "../../shared/metoai-types.js";

export type * from "../../shared/metoai-types.js";

export interface DesktopMetoAiApi {
	/** 当前会话快照；未登录时只有 `status: "anonymous"`。 */
	session(): Promise<MetoAiIpcResult<MetoAiSessionSnapshot>>;
	/** 账号 + 站点配置 + 由站点配置推出的币种规则，个人中心一次拉齐。 */
	overview(): Promise<MetoAiIpcResult<MetoAiAccountOverview>>;
	/** 公开站点配置（`/api/status`）：币种与站点显示信息。 */
	siteConfig(): Promise<MetoAiIpcResult<MetoAiSiteConfig>>;
	/** 在系统浏览器打开 MetoAi 授权页；成功后进入「等待授权」状态。 */
	authorize(): Promise<MetoAiIpcResult<MetoAiAuthorizeResult>>;
	/** 重新打开当前授权页（复用同一个 state）；没有进行中的授权时重新发起。 */
	reopenAuthorize(): Promise<MetoAiIpcResult<void>>;
	logout(): Promise<MetoAiIpcResult<void>>;
	/** 主动续期；返回是否仍持有有效会话。 */
	refresh(): Promise<MetoAiIpcResult<boolean>>;
	/** 会话变化（登录、登出、被服务端吊销）时触发。返回取消订阅函数。 */
	onSessionChanged(handler: (snapshot: MetoAiSessionSnapshot) => void): () => void;
	/** 授权被拒绝（state 不匹配/过期、用户取消、换码失败）时触发。返回取消订阅函数。 */
	onAuthorizeRejected(handler: (rejection: MetoAiAuthorizeRejection) => void): () => void;

	/** 当前生效的订阅；只读展示，购买与续费都在官网。 */
	subscription(): Promise<MetoAiIpcResult<MetoAiSubscription[]>>;

	tokens(query?: MetoAiTokenPageQuery): Promise<MetoAiIpcResult<MetoAiTokenPage>>;
	createKey(draft: MetoAiTokenDraft): Promise<MetoAiIpcResult<{ id: number; key: string | null }>>;
	deleteKey(id: number): Promise<MetoAiIpcResult<void>>;
	/** 1 启用 / 2 禁用。 */
	setKeyStatus(id: number, status: number): Promise<MetoAiIpcResult<void>>;
	/** 换取完整 key（`sk-` 前缀已补好）。站点对该接口有独立限流，按需调用。 */
	key(id: number): Promise<MetoAiIpcResult<string>>;

	/** 确保 MetoAi 已接进模型配置（复用或签发 Key 并写盘）。幂等。 */
	ensureModels(): Promise<MetoAiIpcResult<MetoAiModelAccessResult>>;
}
