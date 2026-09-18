/**
 * MetaToken 控制台的 preload 契约。
 *
 * 所有调用都返回 `MetoAiIpcResult`：失败是**值**而不是异常，因为 `Error` 实例
 * 过不了结构化克隆，异常穿过进程边界后 `code` / `status` 会丢，渲染层就没法区分
 * 「会话已失效」和「网络抖动」。字段形状与线上契约一致（snake_case），见
 * `shared/metoai-types.ts`。
 */

import type {
	MetoAiAccountOverview,
	MetoAiIpcResult,
	MetoAiLoginResult,
	MetoAiModelAccessResult,
	MetoAiPaymentLaunch,
	MetoAiSessionSnapshot,
	MetoAiSiteConfig,
	MetoAiTokenDraft,
	MetoAiTokenPage,
	MetoAiTokenPageQuery,
	MetoAiTopUpInfo,
	MetoAiTopUpRecordPage,
} from "../../shared/metoai-types.js";

export type * from "../../shared/metoai-types.js";

export interface DesktopMetoAiApi {
	/** 当前会话快照；未登录时只有 `status: "anonymous"`。 */
	session(): Promise<MetoAiIpcResult<MetoAiSessionSnapshot>>;
	/** 账号 + 站点配置 + 由站点配置推出的币种规则，个人中心一次拉齐。 */
	overview(): Promise<MetoAiIpcResult<MetoAiAccountOverview>>;
	/** 公开站点配置（`/api/status`）。登录前用它决定表单形态与是否需要 Turnstile。 */
	siteConfig(): Promise<MetoAiIpcResult<MetoAiSiteConfig>>;
	login(input: {
		username: string;
		password: string;
		turnstileToken?: string;
	}): Promise<MetoAiIpcResult<MetoAiLoginResult>>;
	/** 二次验证补码；`flowToken` 来自上一次登录返回的 `two-factor-required`。 */
	loginTwoFactor(input: { flowToken: string; code: string }): Promise<MetoAiIpcResult<MetoAiLoginResult>>;
	logout(): Promise<MetoAiIpcResult<void>>;
	/** 主动续期；返回是否仍持有有效会话。 */
	refresh(): Promise<MetoAiIpcResult<boolean>>;
	/** 会话变化（登录、登出、被服务端吊销）时触发。返回取消订阅函数。 */
	onSessionChanged(handler: (snapshot: MetoAiSessionSnapshot) => void): () => void;

	tokens(query?: MetoAiTokenPageQuery): Promise<MetoAiIpcResult<MetoAiTokenPage>>;
	createKey(draft: MetoAiTokenDraft): Promise<MetoAiIpcResult<{ id: number; key: string | null }>>;
	deleteKey(id: number): Promise<MetoAiIpcResult<void>>;
	/** 1 启用 / 2 禁用。 */
	setKeyStatus(id: number, status: number): Promise<MetoAiIpcResult<void>>;
	/** 换取完整 key（`sk-` 前缀已补好）。站点对该接口有独立限流，按需调用。 */
	key(id: number): Promise<MetoAiIpcResult<string>>;

	topUpInfo(): Promise<MetoAiIpcResult<MetoAiTopUpInfo>>;
	topUpRecords(page?: number, pageSize?: number): Promise<MetoAiIpcResult<MetoAiTopUpRecordPage>>;
	/** 预结算，返回实付金额（站点已算过倍率与折扣）。 */
	quote(amount: number, method: string): Promise<MetoAiIpcResult<number>>;
	/** 兑换码充值；返回本次入账的额度单位。 */
	redeem(code: string): Promise<MetoAiIpcResult<number>>;
	/** 发起在线支付；`form` 会打开内置收银台窗口并在关闭后返回。 */
	pay(amount: number, method: string): Promise<MetoAiIpcResult<MetoAiPaymentLaunch>>;

	/** 确保 MetaToken 已接进模型配置（复用或签发 Key 并写盘）。幂等。 */
	ensureModels(): Promise<MetoAiIpcResult<MetoAiModelAccessResult>>;
}
