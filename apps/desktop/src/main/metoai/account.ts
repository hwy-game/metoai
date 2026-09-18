/**
 * MetaToken 控制台账户操作：余额、令牌（Key）、充值。
 *
 * 全部走 `authedData` / `authedRaw`（见 `session.ts`），因此调用方不需要关心
 * 访问令牌刷新。这里只做「契约形状 ↔ 领域语义」的转换，不做持久化。
 */

import type {
	MetoAiCurrencyConfig,
	MetoAiPaymentLaunch,
	MetoAiSiteConfig,
	MetoAiTokenDraft,
	MetoAiTokenPage,
	MetoAiTokenPageQuery,
	MetoAiTopUpInfo,
	MetoAiTopUpRecordPage,
	MetoAiUser,
} from "../../shared/metoai-types.js";
import { getAppLogger } from "../logger.js";
import { decodeData, describeError, metoaiRequest } from "./api.js";
import { displayAmountToQuota, resolveCurrencyConfig } from "./quota.js";
import { authedData, authedRaw, cacheUser } from "./session.js";

const log = getAppLogger("metoai");

/** 站点令牌 Key 在库里不带前缀，对外一律补上 `sk-`。 */
const KEY_PREFIX = "sk-";
const SITE_CONFIG_TTL_MS = 5 * 60_000;

export function toFullKey(raw: string): string {
	const trimmed = raw.trim();
	return trimmed.startsWith(KEY_PREFIX) ? trimmed : `${KEY_PREFIX}${trimmed}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readNumber(value: unknown, fallback = 0): number {
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (typeof value === "string") {
		const parsed = Number.parseFloat(value);
		if (Number.isFinite(parsed)) return parsed;
	}
	return fallback;
}

// ------------------------------------------------------------------ 站点与账户

let cachedSiteConfig: { value: MetoAiSiteConfig; fetchedAt: number } | null = null;

/** `GET /api/status`：公开接口，未登录也能读，用于币种与站点信息。 */
export async function fetchSiteConfig(): Promise<MetoAiSiteConfig> {
	const response = await metoaiRequest("/status", { timeoutMs: 10_000 });
	const config = await decodeData<MetoAiSiteConfig>("/status", response);
	cachedSiteConfig = { value: config, fetchedAt: Date.now() };
	return config;
}

/**
 * 取站点配置。额度换算（余额展示、Key 额度输入）都依赖它，因此这里做一层短 TTL
 * 缓存，避免每敲一个字符就重新拉一次 `/api/status`。拉取失败时退到过期缓存，
 * 再不行就用兜底配置，让个人中心仍可渲染。
 */
export async function getSiteConfig(): Promise<MetoAiSiteConfig> {
	if (cachedSiteConfig && Date.now() - cachedSiteConfig.fetchedAt < SITE_CONFIG_TTL_MS) {
		return cachedSiteConfig.value;
	}
	try {
		return await fetchSiteConfig();
	} catch (error) {
		log.debug(`site config unavailable, falling back: ${describeError(error)}`);
		return cachedSiteConfig?.value ?? {};
	}
}

export async function getCurrencyConfig(): Promise<MetoAiCurrencyConfig> {
	return resolveCurrencyConfig(await getSiteConfig());
}

/** `GET /api/user/self`：刷新余额/用量并覆盖本地缓存的用户快照。 */
export async function fetchSelf(): Promise<MetoAiUser> {
	const user = await authedData<MetoAiUser>("/user/self");
	cacheUser(user);
	return user;
}

// -------------------------------------------------------------------- 令牌管理

/** `GET /api/token/`：分页列出当前用户的令牌（`key` 为脱敏值）。 */
export function listTokens(query: MetoAiTokenPageQuery = {}): Promise<MetoAiTokenPage> {
	return authedData<MetoAiTokenPage>("/token/", {
		query: {
			p: query.page ?? 1,
			page_size: query.pageSize ?? 50,
			keyword: query.keyword,
		},
	});
}

/**
 * `POST /api/token/` 不返回新令牌的 id 或 key，因此先用 id 集合做差找出新条目，
 * 再按需换取完整 key。比「按名字找最新一条」更稳：同名令牌不会互相干扰。
 */
async function findNewTokenId(before: ReadonlySet<number>, name: string): Promise<number | null> {
	const page = await listTokens({ page: 1, pageSize: 100 });
	const items = page.items ?? [];
	for (const token of items) {
		if (!before.has(token.id) && token.name === name) return token.id;
	}
	// 同名可能是并发写入；退一步取最新的未知 id，避免把「已创建」误判为失败。
	for (const token of items) {
		if (!before.has(token.id)) return token.id;
	}
	return null;
}

export async function createToken(draft: MetoAiTokenDraft): Promise<{ id: number; key: string | null }> {
	const currency = await getCurrencyConfig();
	const before = new Set((await listTokens({ page: 1, pageSize: 100 })).items.map((token) => token.id));

	const body: Record<string, unknown> = {
		name: draft.name,
		unlimited_quota: draft.unlimited_quota,
		remain_quota: draft.unlimited_quota ? 0 : displayAmountToQuota(draft.remain_quota_dollars ?? 0, currency),
		expired_time: draft.expired_time ?? -1,
		model_limits_enabled: (draft.model_limits?.length ?? 0) > 0,
		model_limits: (draft.model_limits ?? []).join(","),
		allow_ips: draft.allow_ips ?? "",
		group: draft.group ?? "",
		auto_groups: [],
		cross_group_retry: false,
	};
	await authedData<unknown>("/token/", { method: "POST", body });

	const id = await findNewTokenId(before, draft.name);
	if (id === null) {
		log.warn("token created but the new entry was not found in the list");
		return { id: 0, key: null };
	}
	return { id, key: await revealTokenKey(id).catch(() => null) };
}

/** `POST /api/token/:id/key`：换取完整 key（站点对该接口有独立限流）。 */
export async function revealTokenKey(id: number): Promise<string> {
	const data = await authedData<{ key?: string }>(`/token/${id}/key`, { method: "POST" });
	return toFullKey(data.key ?? "");
}

export async function deleteToken(id: number): Promise<void> {
	await authedData<unknown>(`/token/${id}`, { method: "DELETE" });
}

/** 启停令牌。`status_only` 让服务端只改状态，不要求回传其余字段。 */
export async function setTokenStatus(id: number, status: number): Promise<void> {
	await authedData<unknown>("/token/", {
		method: "PUT",
		query: { status_only: 1 },
		body: { id, status },
	});
}

// ---------------------------------------------------------------------- 充值

/** `GET /api/user/topup/info`：可用支付方式、最小充值额与预设金额。 */

export function getTopUpInfo(): Promise<MetoAiTopUpInfo> {
	return authedData<MetoAiTopUpInfo>("/user/topup/info");
}

/** `GET /api/user/topup/self`：本账号的充值记录。 */
export function listTopUpRecords(page = 1, pageSize = 20): Promise<MetoAiTopUpRecordPage> {
	return authedData<MetoAiTopUpRecordPage>("/user/topup/self", {
		query: { p: page, page_size: pageSize },
	});
}

/** `POST /api/user/topup`：兑换码充值。`data` 是本次入账的额度单位。 */
export async function redeemCode(code: string): Promise<number> {
	const data = await authedData<unknown>("/user/topup", { method: "POST", body: { key: code.trim() } });
	return readNumber(data);
}

/**
 * 独立网关各自的接口路径。不在这张表里的方法都按 epay 系处理——站点把支付宝/
 * 微信这类自配方式统一放在 `/user/pay`，靠 `payment_method` 区分。
 */
const DEDICATED_GATEWAYS: Record<string, { amount: string; pay: string }> = {
	stripe: { amount: "/user/stripe/amount", pay: "/user/stripe/pay" },
	// Creem 的预结算复用 Stripe 的口径，站点前端也是这么发的。
	creem: { amount: "/user/stripe/amount", pay: "/user/creem/pay" },
	waffo: { amount: "/user/waffo/amount", pay: "/user/waffo/pay" },
	waffo_pancake: { amount: "/user/waffo-pancake/amount", pay: "/user/waffo-pancake/pay" },
};

const EPAY_ROUTES = { amount: "/user/amount", pay: "/user/pay" } as const;

function routesFor(method: string): { amount: string; pay: string } {
	return DEDICATED_GATEWAYS[method] ?? EPAY_ROUTES;
}

/**
 * 预结算：返回**实付**金额（站点已按 priceRatio / 分组倍率 / 折扣算过）。
 * 该接口不套标准信封，故用 raw。
 */
export async function quoteAmount(amount: number, method: string): Promise<number> {
	const payload = await authedRaw<{ data?: unknown }>(routesFor(method).amount, {
		method: "POST",
		body: { amount: Math.floor(amount) },
	});
	return readNumber(payload?.data);
}

/**
 * 站点各网关返回的收银台字段名不一致，统一收敛成 `MetoAiPaymentLaunch`。
 *
 * epay 系给的是「网关地址 + 待提交参数」（必须带参 POST），其余网关给的是
 * 可直接打开的收银台链接。
 */
function toLaunch(payload: unknown, isEpay: boolean): MetoAiPaymentLaunch {
	if (!isRecord(payload)) return { kind: "unsupported", message: "unexpected-response" };
	const data = isRecord(payload.data) ? payload.data : {};

	if (isEpay) {
		const url = typeof payload.url === "string" ? payload.url : "";
		if (!url) return { kind: "unsupported", message: "missing-pay-url" };
		return { kind: "form", url, params: data };
	}

	const link =
		(typeof data.pay_link === "string" && data.pay_link) ||
		(typeof data.checkout_url === "string" && data.checkout_url) ||
		(typeof data.payment_url === "string" && data.payment_url) ||
		"";
	if (!link) return { kind: "unsupported", message: "missing-pay-link" };
	return { kind: "redirect", url: link };
}

/**
 * 发起在线支付。
 *
 * epay 系需要把具体支付方式放进 `payment_method`，并返回 `form` 由内置收银台
 * 窗口提交；独立网关把方式写进路径，返回 `redirect` 直接打开收银台。
 */
export async function requestPayment(amount: number, method: string): Promise<MetoAiPaymentLaunch> {
	const isEpay = !(method in DEDICATED_GATEWAYS);
	const body: Record<string, unknown> = { amount: Math.floor(amount) };
	if (isEpay) body.payment_method = method;

	const payload = await authedRaw<unknown>(routesFor(method).pay, { method: "POST", body, timeoutMs: 30_000 });
	if (isRecord(payload) && payload.message === "error") {
		return { kind: "unsupported", message: typeof payload.data === "string" ? payload.data : "pay-failed" };
	}
	return toLaunch(payload, isEpay);
}

/** 记录一笔充值失败/取消时的可读原因，避免错误信息只留在渲染层。 */
export function logPaymentIssue(method: string, error: unknown): void {
	log.warn(`payment ${method} failed: ${describeError(error)}`);
}
