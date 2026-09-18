/**
 * MetaToken 控制台接口（`<site>/api/*`）的线上契约。
 *
 * 字段一律保持服务端原始 snake_case 形状：这套接口与项目下的 metotoken 站点
 * 是同一份后端，保持同名同形才能在两侧对照排查；主进程只负责拆信封
 * （`{success, message, data}`），不做字段改名。
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
	register_enabled?: boolean;
	password_login_enabled?: boolean;
	password_login_encryption_enabled?: boolean;
	turnstile_check?: boolean;
	turnstile_site_key?: string;
	self_use_mode_enabled?: boolean;
	docs_link?: string;
	setup?: boolean;
}

/** 渲染层需要的会话快照。未登录时不含任何用户信息。 */
export type MetoAiSessionSnapshot =
	| { status: "anonymous" }
	| { status: "authenticated"; user: MetoAiUser; accessExpiresAt: string };

/** 登录结果。2FA 用户会先拿到 `two-factor-required`，再补一次验证码。 */
export type MetoAiLoginResult =
	| { status: "ok"; user: MetoAiUser }
	| { status: "two-factor-required"; flowToken: string; expiresAt: string }
	| { status: "failed"; message: string };

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

export interface MetoAiPaymentMethod {
	name: string;
	type: string;
	color?: string;
	min_topup?: number | string;
}

/** `GET /api/user/topup/info` 的 data。 */
export interface MetoAiTopUpInfo {
	enable_online_topup: boolean;
	enable_stripe_topup: boolean;
	enable_creem_topup?: boolean;
	enable_waffo_topup?: boolean;
	enable_waffo_pancake_topup?: boolean;
	enable_redemption?: boolean;
	pay_methods: MetoAiPaymentMethod[];
	min_topup: number;
	stripe_min_topup: number;
	waffo_min_topup?: number;
	waffo_pancake_min_topup?: number;
	amount_options: number[];
	discount: Record<string, number>;
	topup_link?: string;
}

export interface MetoAiTopUpRecord {
	id: number;
	user_id: number;
	amount: number;
	money: number;
	trade_no: string;
	payment_method: string;
	create_time: number;
	complete_time?: number;
	status: "success" | "pending" | "expired";
}

export interface MetoAiTopUpRecordPage {
	items: MetoAiTopUpRecord[];
	total: number;
}

/**
 * 在线支付发起结果。
 *
 * - `form`：网关要求带参 POST（epay 系），由主进程用内置支付窗口提交。
 * - `redirect`：直接可打开的收银台链接（Stripe / Creem / Waffo）。
 */
export type MetoAiPaymentLaunch =
	| { kind: "form"; url: string; params: Record<string, unknown> }
	| { kind: "redirect"; url: string }
	| { kind: "unsupported"; message: string };

export interface MetoAiTokenPageQuery {
	page?: number;
	pageSize?: number;
	keyword?: string;
}

// ─── IPC 边界 ───

/**
 * 站点支付方式标识：`pay_methods[].type`，如 `alipay` / `wechat` / `stripe`。
 *
 * 由站点配置决定、无法穷举（与 IPC 层的校验口径一致），主进程按它分派到 epay
 * 或独立网关接口。**不要**自造 `epay` 这类聚合值：站点只认具体的 `type`。
 */
export type MetoAiPaymentGateway = string;

/**
 * 站点的一个支付渠道。
 *
 * `method` 是服务端认得的方法标识，直接回传给 `POST /api/user/pay`：epay 系是
 * `alipay` / `wechat` 这类具体方式，其余网关就是 `stripe` / `creem` / `waffo` /
 * `waffo_pancake`。两者走不同接口，由主进程按 `method` 分派，渲染层不需要知道。
 */
export interface MetoAiPaymentChannel {
	method: string;
	/** 站点配置的展示名。 */
	name: string;
	minTopUp: number;
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

/** 「登录即用」的准备结果：是否已把 MetaToken 接进模型配置。 */
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
