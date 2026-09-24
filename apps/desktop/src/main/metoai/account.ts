/**
 * MetoAI 控制台账户操作：余额、令牌（Key）、订阅状态。
 *
 * 全部走 `authedData`（见 `session.ts`），因此调用方不需要关心访问令牌刷新。
 * 这里只做「契约形状 ↔ 领域语义」的转换，不做持久化。充值与订阅购买一律不在
 * 客户端发生：那是站点网页的事，客户端只读状态并给出官网入口。
 */

import type {
	MetoAiCurrencyConfig,
	MetoAiSiteConfig,
	MetoAiSubscription,
	MetoAiTokenDraft,
	MetoAiTokenPage,
	MetoAiTokenPageQuery,
	MetoAiUser,
} from "../../shared/metoai-types.js";
import { getAppLogger } from "../logger.js";
import { decodeData, describeError, metoaiRequest } from "./api.js";
import { displayAmountToQuota, resolveCurrencyConfig } from "./quota.js";
import { authedData, cacheUser } from "./session.js";

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

// -------------------------------------------------------------------- 订阅状态

/** `GET /api/subscription/plans` 的元素：套餐只用来把 `plan_id` 翻成标题。 */
interface SubscriptionPlanEntry {
	plan?: { id?: unknown; title?: unknown };
}

/** `GET /api/subscription/self` 的 data（只取当前生效的订阅）。 */
interface SubscriptionSelfPayload {
	subscriptions?: Array<{ subscription?: unknown }>;
}

/**
 * 当前生效的订阅。`/api/subscription/self` 只给 `plan_id`，标题要另外拉一次
 * `/api/subscription/plans` 关联；plans 不可用时标题留空，由界面回退中性文案，
 * 而不是让整段订阅状态跟着失败。
 */
export async function fetchSubscription(): Promise<MetoAiSubscription[]> {
	const [self, plans] = await Promise.all([
		authedData<SubscriptionSelfPayload>("/subscription/self"),
		authedData<SubscriptionPlanEntry[]>("/subscription/plans").catch((error: unknown) => {
			log.debug(`subscription plans unavailable: ${describeError(error)}`);
			return [] as SubscriptionPlanEntry[];
		}),
	]);

	const titles = new Map<number, string>();
	for (const entry of Array.isArray(plans) ? plans : []) {
		const id = readNumber(entry?.plan?.id, 0);
		const title = typeof entry?.plan?.title === "string" ? entry.plan.title.trim() : "";
		if (id > 0 && title) titles.set(id, title);
	}

	const items = Array.isArray(self?.subscriptions) ? self.subscriptions : [];
	const subscriptions: MetoAiSubscription[] = [];
	for (const entry of items) {
		const subscription = toSubscription(entry?.subscription, titles);
		if (subscription) subscriptions.push(subscription);
	}
	return subscriptions;
}

function toSubscription(raw: unknown, titles: Map<number, string>): MetoAiSubscription | null {
	if (!isRecord(raw)) return null;
	const id = readNumber(raw.id, 0);
	if (id <= 0) return null;
	const planId = readNumber(raw.plan_id, 0);
	return {
		id,
		planId,
		planTitle: titles.get(planId) ?? null,
		status: typeof raw.status === "string" ? raw.status : "",
		amountTotal: readNumber(raw.amount_total, 0),
		amountUsed: readNumber(raw.amount_used, 0),
		startTime: readNumber(raw.start_time, 0),
		endTime: readNumber(raw.end_time, 0),
		nextResetTime: readNumber(raw.next_reset_time, 0) || null,
		autoRenew: raw.auto_renew === true,
	};
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
