/**
 * MetoAI 控制台接口（`<site>/api/*`）的线上契约。
 *
 * 线上契约字段一律保持服务端原始 snake_case 形状：这套接口与项目下的 metotoken 站点
 * 是同一份后端，保持同名同形才能在两侧对照排查；主进程只负责拆信封
 * （`{success, message, data}`），不做字段改名。少数**派生**形状（跨接口关联或客户端
 * 自己的概念，如 `MetoAiSubscription` / `MetoAiAuthorizeResult`）例外：它们用客户端命名，
 * 并在各自注释里写明来源。
 *
 * 注意：这里的接口是**控制台**契约，与 `/v1` 的 OpenAI 兼容中转契约无关。
 */

/** `GET /api/user/self` 的 data。quota / used_quota 是整数额度单位，非货币。 */
export interface MetoAiUser {
	id: number;
	username: string;
	display_name: string;
	email?: string;
	quota: number;
	used_quota: number;
	request_count: number;
	aff_code?: string;
	aff_count?: number;
	aff_quota?: number;
	aff_history_quota?: number;
	group?: string;
	status?: number;
	role?: number;
}

export type MetoAiQuotaDisplayType = "USD" | "CNY" | "TOKENS" | "CUSTOM";

/** `GET /api/status` 中个人中心用到的字段（该接口公开、无需鉴权）。 */
export interface MetoAiSiteConfig {
	system_name?: string;
	logo?: string;
	server_address?: string;
	quota_per_unit?: number;
	quota_display_type?: MetoAiQuotaDisplayType;
	usd_exchange_rate?: number;
	/** 每 1 系统美元对应的实付金额（priceRatio）。 */
	price?: number;
	custom_currency_symbol?: string;
	custom_currency_exchange_rate?: number;
	display_in_currency?: boolean;
	self_use_mode_enabled?: boolean;
	docs_link?: string;
	setup?: boolean;
}

/** 渲染层需要的会话快照。未登录时不含任何用户信息。 */
export type MetoAiSessionSnapshot =
	| { status: "anonymous" }
	| { status: "authenticated"; user: MetoAiUser; accessExpiresAt: string };

/** 发起桌面授权的应答：授权页已在系统浏览器打开。 */
export interface MetoAiAuthorizeResult {
	status: "started";
}

/**
 * 授权回调被拒绝的原因码；文案由渲染层查 i18n。
 *
 * `state-mismatch` / `state-expired` / `missing-code` / `access-denied` 来自回调本身；
 * `exchange-failed` 表示回调合法但换码失败（code 过期、verifier 不匹配、浏览器会话已失效等）。
 */
export type MetoAiAuthorizeRejectionReason =
	| "state-mismatch"
	| "state-expired"
	| "missing-code"
	| "access-denied"
	| "exchange-failed";

export interface MetoAiAuthorizeRejection {
	reason: MetoAiAuthorizeRejectionReason;
	/**
	 * 站点错误码（如 `DESKTOP_AUTH_INVALID_GRANT` / `AUTH_SESSION_REVOKED`）；只有
	 * `exchange-failed` 才有。**不传站点文案**：站点失败响应里的 `message` 只是英文
	 * HTTP 状态短语（"Bad Request"、"Conflict"），给用户看没有意义，文案一律由渲染层
	 * 按错误码查 i18n。
	 */
	code?: string;
}

/**
 * 一条用户订阅。
 *
 * 这是**派生形状**（不是服务端原始契约）：由 `GET /api/subscription/self` 与
 * `GET /api/subscription/plans` 关联而来，因此字段用客户端命名。
 */
export interface MetoAiSubscription {
	id: number;
	planId: number;
	/** 套餐标题；plans 里查不到该 plan_id 时为 null，界面回退中性文案。 */
	planTitle: string | null;
	/** 服务端状态：active / expired / cancelled。 */
	status: string;
	/** 额度单位，展示时过币种规则。 */
	amountTotal: number;
	amountUsed: number;
	/** 秒级时间戳。 */
	startTime: number;
	endTime: number;
	/** 下次额度重置时间；null 表示不重置。 */
	nextResetTime: number | null;
	autoRenew: boolean;
}

/** 令牌状态：1 启用 / 2 禁用 / 3 已过期 / 4 已耗尽。 */
export type MetoAiTokenStatus = 1 | 2 | 3 | 4;

/** `GET /api/token/` 的 items 元素。`key` 为脱敏值，完整 key 需另行读取。 */
export interface MetoAiToken {
	id: number;
	name: string;
	key: string;
	status: number;
	remain_quota: number;
	used_quota: number;
	unlimited_quota: boolean;
	/** 秒级时间戳；-1 表示永不过期。 */
	expired_time: number;
	created_time: number;
	accessed_time: number;
	group: string;
	model_limits_enabled: boolean;
	model_limits: string;
	allow_ips: string;
}

export interface MetoAiTokenPage {
	items: MetoAiToken[];
	total: number;
	page: number;
	page_size: number;
}

/** 创建令牌的表单载荷（渲染层语义，主进程负责换算成服务端字段）。 */
export interface MetoAiTokenDraft {
	name: string;
	/** 额度美元数；`unlimited_quota` 为 true 时忽略。 */
	remain_quota_dollars?: number;
	unlimited_quota: boolean;
	/** 秒级时间戳；-1 表示永不过期。 */
	expired_time?: number;
	model_limits?: string[];
	allow_ips?: string;
	group?: string;
}

export interface MetoAiTokenPageQuery {
	page?: number;
	pageSize?: number;
	keyword?: string;
}

/** 个人中心一次拉齐的三份数据：账号、站点配置、由站点配置推出的币种规则。 */
export interface MetoAiAccountOverview {
	user: MetoAiUser;
	siteConfig: MetoAiSiteConfig;
	currency: MetoAiCurrencyConfig;
}

/** 额度单位与展示金额的换算规则，由 `/api/status` 推出。 */
export interface MetoAiCurrencyConfig {
	/** 1 系统美元对应的额度单位数。 */
	quotaPerUnit: number;
	displayType: MetoAiQuotaDisplayType;
	/** 每 1 系统美元折算成展示货币的倍率；TOKENS 下无意义。 */
	exchangeRate: number;
	/** 展示前缀符号；TOKENS 下为空串。 */
	symbol: string;
	/** 金额是否带货币符号（TOKENS 只显示纯数字）。 */
	isTokenDisplay: boolean;
}

/** 「登录即用」的准备结果：是否已把 MetoAI 接进模型配置。 */
export interface MetoAiModelAccessResult {
	ok: boolean;
	/** 本次是否新建了令牌（false 表示复用了已有 Key 或已有配置）。 */
	created: boolean;
	/** 失败原因码；文案由渲染层查 i18n。 */
	reason?: "not-logged-in" | "invalid-key" | "empty-models" | "network" | "unknown-provider" | "unknown";
	detail?: string;
}

/**
 * 跨进程传递的错误形状。`Error` 实例过不了结构化克隆，所以显式拆成字段，
 * 让渲染层既能拿到可读文案，也能按 `code` 区分「会话已失效」等需要改变界面的情况。
 */
export interface MetoAiErrorPayload {
	/** 站点错误码（如 `AUTH_SESSION_REVOKED`），无则为 `http` / `network` / `unknown`。 */
	code: string;
	message: string;
	/** HTTP 状态码；非 HTTP 失败为 0。 */
	status: number;
}

/** IPC 结果信封：错误作为值返回，不让异常穿过进程边界后丢掉结构。 */
export type MetoAiIpcResult<T> = { ok: true; value: T } | { ok: false; error: MetoAiErrorPayload };
