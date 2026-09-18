/**
 * Cloudflare Turnstile 小组件。
 *
 * 站点在 `turnstile_check` 开启时要求登录请求带上 `turnstile` 查询参数，token 由
 * 这个小组件产出（见 metotoken `middleware/turnstile-check.go`）。脚本只在真正需要
 * 时加载一次：多数部署没开这个开关，不该为它多一次第三方请求。
 */

import { useEffect, useRef, useState } from "react";

const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
const SCRIPT_ID = "cf-turnstile-script";

interface TurnstileApi {
	render: (
		container: HTMLElement,
		options: {
			sitekey: string;
			callback: (token: string) => void;
			"expired-callback": () => void;
			"error-callback": () => void;
			theme?: "auto" | "light" | "dark";
		},
	) => string;
	remove: (widgetId: string) => void;
}

declare global {
	interface Window {
		turnstile?: TurnstileApi;
	}
}

let scriptPromise: Promise<void> | null = null;

function loadScript(): Promise<void> {
	scriptPromise ??= new Promise<void>((resolve, reject) => {
		if (window.turnstile) {
			resolve();
			return;
		}
		const existing = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
		const script = existing ?? document.createElement("script");
		script.addEventListener("load", () => resolve(), { once: true });
		script.addEventListener("error", () => reject(new Error("turnstile-script-failed")), { once: true });
		if (!existing) {
			script.id = SCRIPT_ID;
			script.src = SCRIPT_SRC;
			script.async = true;
			document.head.appendChild(script);
		}
	});
	return scriptPromise;
}

export interface TurnstileState {
	/** 挂载容器；`enabled` 为 false 时不渲染任何东西，ref 可以一直挂着。 */
	containerRef: React.RefObject<HTMLDivElement | null>;
	token: string | null;
	/** 校验失败（脚本被拦或挑战报错）；界面据此提示用户重试。 */
	failed: boolean;
}

/**
 * `enabled` 由站点的 `turnstile_check` 决定；`siteKey` 为空时视为未配置，不加载脚本
 * ——服务端会拒绝登录，但那是配置问题，不该让界面卡在加载第三方脚本上。
 */
export function useTurnstile(enabled: boolean, siteKey: string | undefined, theme: "light" | "dark"): TurnstileState {
	const containerRef = useRef<HTMLDivElement>(null);
	const [token, setToken] = useState<string | null>(null);
	const [failed, setFailed] = useState(false);
	const active = enabled && Boolean(siteKey);

	useEffect(() => {
		if (!active) {
			setToken(null);
			return;
		}
		let cancelled = false;
		let widgetId: string | undefined;

		void loadScript()
			.then(() => {
				if (cancelled || !containerRef.current || !window.turnstile) return;
				widgetId = window.turnstile.render(containerRef.current, {
					sitekey: siteKey as string,
					theme,
					callback: (next) => setToken(next),
					"expired-callback": () => setToken(null),
					"error-callback": () => setFailed(true),
				});
			})
			.catch(() => {
				if (!cancelled) setFailed(true);
			});

		return () => {
			cancelled = true;
			if (widgetId && window.turnstile) window.turnstile.remove(widgetId);
			setToken(null);
		};
	}, [active, siteKey, theme]);

	return { containerRef, token, failed };
}
