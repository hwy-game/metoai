/**
 * MetoAi 会话：登录态、授权登录动作与登出。
 *
 * 会话快照由主进程推送（`onSessionChanged`）——访问令牌的刷新与吊销都发生在那边，
 * 渲染层不该自己推断登录是否还有效。Provider 只挂一次，设置页、侧边栏和首次引导
 * 通过同一份状态与动作访问，避免重复注册 IPC 监听器。
 *
 * 登录只有一条路：主进程在系统浏览器打开 MetoAi 授权页，用户同意后回调本进程。
 * 因此这里没有用户名/密码，也没有「提交中」的中间态——只有「等待浏览器回调」。
 */

import { isSessionTerminal, MetoAiCallError, unwrapMetoAi } from "@shared/lib/metoai";
import { clearMetoAiStateAtom, metoaiSessionAtom } from "@shared/store/atoms";
import { useAtom, useSetAtom } from "jotai";
import type { ReactNode } from "react";
import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { MetoAiAuthorizeRejection, MetoAiUser } from "@/shared/metoai-types";
import { clearMetoAiGateSkipped } from "../lib/metoai-gate-storage";

/** `idle` 可发起授权；`waiting` 表示授权页已在浏览器打开，等回调。 */
export type MetoAiAuthorizePhase = "idle" | "waiting";

/** 授权被拒绝的原因码 → i18n key。文案在 catalog 里，主进程只回传原因。 */
const AUTHORIZE_ERROR_KEYS = {
	"state-mismatch": "authorize.errorStateMismatch",
	"state-expired": "authorize.errorStateExpired",
	"missing-code": "authorize.errorMissingCode",
	"access-denied": "authorize.errorAccessDenied",
	"exchange-failed": "authorize.errorExchange",
} as const;

type AuthorizeErrorKey =
	| (typeof AUTHORIZE_ERROR_KEYS)[keyof typeof AUTHORIZE_ERROR_KEYS]
	| "authorize.errorSession"
	| "authorize.errorSessionLimit";

/** 换码失败时的站点错误码 → i18n key。 */
const EXCHANGE_ERROR_KEYS: Record<string, AuthorizeErrorKey> = {
	DESKTOP_AUTH_INVALID_GRANT: "authorize.errorExchange",
	DESKTOP_AUTH_REQUEST_INVALID: "authorize.errorExchange",
	AUTH_SESSION_REQUIRED: "authorize.errorSession",
	AUTH_UNAUTHORIZED: "authorize.errorSession",
	AUTH_SESSION_REVOKED: "authorize.errorSession",
	AUTH_TOKEN_EXPIRED: "authorize.errorSession",
	AUTH_SESSION_LIMIT: "authorize.errorSessionLimit",
	AUTH_SESSION_ISSUANCE_LIMIT: "authorize.errorSessionLimit",
};

export interface MetoAiSessionModel {
	authenticated: boolean;
	user: MetoAiUser | null;
	/** 有动作在飞行中（打开浏览器 / 登出）：界面据此禁用按钮。 */
	busy: boolean;
	/** 已翻译的失败提示；null 表示无错误。 */
	error: string | null;
	phase: MetoAiAuthorizePhase;
	actions: {
		startAuthorize: () => Promise<void>;
		reopenAuthorize: () => Promise<void>;
		/** 用户放弃等待：回到可重试状态，不产生任何会话。 */
		cancelAuthorize: () => void;
		logout: () => Promise<void>;
	};
}

const MetoAiSessionContext = createContext<MetoAiSessionModel | null>(null);

/** 服务端返回的中文原因优先展示；它是权威判断，比通用文案有用。 */
function messageOf(error: unknown, fallback: string): string {
	if (error instanceof Error && error.message && error.message !== "network") return error.message;
	return fallback;
}

export function MetoAiSessionProvider({ children }: { children: ReactNode }): JSX.Element {
	const { t } = useTranslation("metoai");
	const [session, setSession] = useAtom(metoaiSessionAtom);
	const clearState = useSetAtom(clearMetoAiStateAtom);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [phase, setPhase] = useState<MetoAiAuthorizePhase>("idle");

	// 启动时对齐一次：主进程可能已经持有上次运行留下的会话。
	useEffect(() => {
		let cancelled = false;
		void window.vetta.metoai
			.session()
			.then((result) => {
				if (!cancelled && result.ok) setSession(result.value);
			})
			.catch(() => undefined);
		return () => {
			cancelled = true;
		};
	}, [setSession]);

	// 回调换码成功由主进程广播：等待状态在这里结束，而不是靠渲染层轮询。
	useEffect(
		() =>
			window.vetta.metoai.onSessionChanged((snapshot) => {
				setSession(snapshot);
				if (snapshot.status === "authenticated") {
					setPhase("idle");
					setError(null);
				}
			}),
		[setSession],
	);

	useEffect(
		() =>
			window.vetta.metoai.onAuthorizeRejected((rejection: MetoAiAuthorizeRejection) => {
				setPhase("idle");
				const codeKey =
					rejection.reason === "exchange-failed" && rejection.code
						? EXCHANGE_ERROR_KEYS[rejection.code]
						: undefined;
				setError(t(codeKey ?? AUTHORIZE_ERROR_KEYS[rejection.reason]));
			}),
		[t],
	);

	useEffect(() => {
		if (session.status === "anonymous") clearState();
	}, [session.status, clearState]);

	const openAuthorizePage = useCallback(
		async (run: () => Promise<unknown>): Promise<void> => {
			if (busy) return;
			setBusy(true);
			setError(null);
			try {
				await run();
				setPhase("waiting");
			} catch (caught) {
				setPhase("idle");
				setError(messageOf(caught, t("authorize.errorOpen")));
			} finally {
				setBusy(false);
			}
		},
		[busy, t],
	);

	const startAuthorize = useCallback(
		() => openAuthorizePage(async () => unwrapMetoAi(await window.vetta.metoai.authorize())),
		[openAuthorizePage],
	);

	const reopenAuthorize = useCallback(
		() => openAuthorizePage(async () => unwrapMetoAi(await window.vetta.metoai.reopenAuthorize())),
		[openAuthorizePage],
	);

	const cancelAuthorize = useCallback((): void => {
		setPhase("idle");
		setError(null);
	}, []);

	const logout = useCallback(async (): Promise<void> => {
		setBusy(true);
		setError(null);
		try {
			const result = await window.vetta.metoai.logout();
			clearMetoAiGateSkipped();
			// 会话已被服务端终结时不必再提示：本地已经登出，界面状态本身就是对的。
			if (!result.ok) {
				const failure = new MetoAiCallError(result.error);
				if (!isSessionTerminal(failure)) setError(messageOf(failure, t("account.errorLogout")));
			}
		} finally {
			setPhase("idle");
			setBusy(false);
		}
	}, [t]);

	const value = useMemo<MetoAiSessionModel>(
		() => ({
			authenticated: session.status === "authenticated",
			user: session.status === "authenticated" ? session.user : null,
			busy,
			error,
			phase,
			actions: { startAuthorize, reopenAuthorize, cancelAuthorize, logout },
		}),
		[session, busy, error, phase, startAuthorize, reopenAuthorize, cancelAuthorize, logout],
	);

	return createElement(MetoAiSessionContext.Provider, { value }, children);
}

export function useMetoAiSessionModel(): MetoAiSessionModel {
	const model = useContext(MetoAiSessionContext);
	if (!model) throw new Error("useMetoAiSessionModel must be used inside MetoAiSessionProvider");
	return model;
}
