/**
 * MetaToken 会话：登录态、登录/登出动作、登录表单需要的公开站点配置。
 *
 * 会话快照由主进程推送（`onSessionChanged`）——访问令牌的刷新与吊销都发生在那边，
 * 渲染层不该自己推断登录是否还有效。这里只负责订阅并把结果写进 atom，让设置页与
 * 首次引导屏共用同一份状态。
 */

import { isSessionTerminal, MetoAiCallError, unwrapMetoAi } from "@shared/lib/metoai";
import { clearMetoAiStateAtom, metoaiSessionAtom } from "@shared/store/atoms";
import { useAtom, useSetAtom } from "jotai";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { MetoAiSiteConfig, MetoAiUser } from "@/shared/metoai-types";
import { type TurnstileState, useTurnstile } from "./useTurnstile";

export interface MetoAiTwoFactorChallenge {
	flowToken: string;
	expiresAt: string;
}

export interface MetoAiSessionModel {
	authenticated: boolean;
	user: MetoAiUser | null;
	/** 公开站点配置；未就绪时为 null，界面应显示加载态而不是错误。 */
	siteConfig: MetoAiSiteConfig | null;
	busy: boolean;
	/** 已翻译的失败提示；null 表示无错误。 */
	error: string | null;
	twoFactor: MetoAiTwoFactorChallenge | null;
	turnstile: TurnstileState;
	/** 是否需要在提交前拿到 Turnstile token。 */
	turnstileRequired: boolean;
	actions: {
		login: (username: string, password: string) => Promise<boolean>;
		submitTwoFactor: (code: string) => Promise<boolean>;
		cancelTwoFactor: () => void;
		logout: () => Promise<void>;
	};
}

/** 服务端返回的中文原因优先展示；它是权威判断，比通用文案有用。 */
function messageOf(error: unknown, fallback: string): string {
	if (error instanceof Error && error.message && error.message !== "network") return error.message;
	return fallback;
}

export function useMetoAiSessionModel(theme: "light" | "dark" = "dark"): MetoAiSessionModel {
	const { t } = useTranslation("metoai");
	const [session, setSession] = useAtom(metoaiSessionAtom);
	const clearState = useSetAtom(clearMetoAiStateAtom);
	const [siteConfig, setSiteConfig] = useState<MetoAiSiteConfig | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [twoFactor, setTwoFactor] = useState<MetoAiTwoFactorChallenge | null>(null);

	const turnstileRequired = siteConfig?.turnstile_check === true;
	const turnstile = useTurnstile(turnstileRequired, siteConfig?.turnstile_site_key, theme);

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

	useEffect(() => window.vetta.metoai.onSessionChanged(setSession), [setSession]);

	useEffect(() => {
		if (session.status === "anonymous") clearState();
	}, [session.status, clearState]);

	// 站点配置在登录前就要读（注册开关、Turnstile、站点名），失败不阻塞表单。
	useEffect(() => {
		let cancelled = false;
		void window.vetta.metoai
			.siteConfig()
			.then((result) => {
				if (!cancelled && result.ok) setSiteConfig(result.value);
			})
			.catch(() => undefined);
		return () => {
			cancelled = true;
		};
	}, []);

	const login = useCallback(
		async (username: string, password: string): Promise<boolean> => {
			if (busy) return false;
			setBusy(true);
			setError(null);
			try {
				const result = unwrapMetoAi(
					await window.vetta.metoai.login({
						username,
						password,
						...(turnstile.token ? { turnstileToken: turnstile.token } : {}),
					}),
				);
				if (result.status === "failed") {
					setError(messageOf(new Error(result.message), t("login.errorFailed")));
					return false;
				}
				if (result.status === "two-factor-required") {
					setTwoFactor({ flowToken: result.flowToken, expiresAt: result.expiresAt });
					return false;
				}
				setSession({ status: "authenticated", user: result.user, accessExpiresAt: "" });
				return true;
			} catch (caught) {
				setError(messageOf(caught, t("login.errorNetwork")));
				return false;
			} finally {
				setBusy(false);
			}
		},
		[busy, setSession, t, turnstile.token],
	);

	const submitTwoFactor = useCallback(
		async (code: string): Promise<boolean> => {
			if (!twoFactor || busy) return false;
			setBusy(true);
			setError(null);
			try {
				const result = unwrapMetoAi(
					await window.vetta.metoai.loginTwoFactor({ flowToken: twoFactor.flowToken, code }),
				);
				if (result.status !== "ok") {
					setError(t("login.errorTwoFactor"));
					return false;
				}
				setTwoFactor(null);
				setSession({ status: "authenticated", user: result.user, accessExpiresAt: "" });
				return true;
			} catch (caught) {
				setError(messageOf(caught, t("login.errorTwoFactor")));
				return false;
			} finally {
				setBusy(false);
			}
		},
		[busy, setSession, t, twoFactor],
	);

	const logout = useCallback(async (): Promise<void> => {
		setBusy(true);
		try {
			const result = await window.vetta.metoai.logout();
			// 会话已被服务端终结时不必再提示：本地已经登出，界面状态本身就是对的。
			if (!result.ok) {
				const failure = new MetoAiCallError(result.error);
				if (!isSessionTerminal(failure)) setError(messageOf(failure, t("account.errorLogout")));
			}
		} finally {
			setTwoFactor(null);
			setBusy(false);
		}
	}, [t]);

	return useMemo(
		() => ({
			authenticated: session.status === "authenticated",
			user: session.status === "authenticated" ? session.user : null,
			siteConfig,
			busy,
			error,
			twoFactor,
			turnstile,
			turnstileRequired,
			actions: {
				login,
				submitTwoFactor,
				cancelTwoFactor: () => {
					setTwoFactor(null);
					setError(null);
				},
				logout,
			},
		}),
		[session, siteConfig, busy, error, twoFactor, turnstile, turnstileRequired, login, submitTwoFactor, logout],
	);
}
