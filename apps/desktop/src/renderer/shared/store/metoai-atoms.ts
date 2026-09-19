/**
 * MetaToken 个人中心的状态。
 *
 * 只放「跨组件共享的快照」，不放动作——动作在 `domains/metoai/hooks/` 里，
 * 由连接层组合出 view model（见 apps/desktop/AGENTS.md §2）。
 */

import { atom } from "jotai";
import type {
	MetoAiAccountOverview,
	MetoAiErrorPayload,
	MetoAiSessionSnapshot,
	MetoAiSubscription,
	MetoAiToken,
} from "@/shared/metoai-types";

/** 会话快照。App 根部订阅主进程推送后写这里，设置页与引导屏都读它。 */
export const metoaiSessionAtom = atom<MetoAiSessionSnapshot>({ status: "anonymous" });

/** 账号 + 站点配置 + 币种规则。未加载或已登出时为 null。 */
export const metoaiOverviewAtom = atom<MetoAiAccountOverview | null>(null);

export const metoaiTokensAtom = atom<MetoAiToken[]>([]);

/** 当前生效的订阅；未登录或未加载时为空数组。 */
export const metoaiSubscriptionAtom = atom<MetoAiSubscription[]>([]);

/** 最近一次操作的失败原因；界面据此给出行内提示。 */
export const metoaiErrorAtom = atom<MetoAiErrorPayload | null>(null);

/** 已登出时清空所有与账号绑定的快照，避免下一个登录用户看到上一个的余额。 */
export const clearMetoAiStateAtom = atom(null, (_get, set) => {
	set(metoaiOverviewAtom, null);
	set(metoaiTokensAtom, []);
	set(metoaiSubscriptionAtom, []);
	set(metoaiErrorAtom, null);
});
