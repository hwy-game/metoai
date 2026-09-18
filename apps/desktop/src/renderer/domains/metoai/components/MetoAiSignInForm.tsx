/**
 * MetaToken 账号登录表单（展示层）。
 *
 * 只负责输入与提交：登录、2FA、Turnstile 的状态与动作全部由调用方的 view model
 * 传入。引导屏与设置 → MetaToken 共用它，所以这里不读取任何业务状态。
 */

import { Button } from "@shared/components/ui/button";
import { Input } from "@shared/components/ui/input";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { MetoAiTwoFactorChallenge } from "../hooks/useMetoAiSession";
import type { TurnstileState } from "../hooks/useTurnstile";

export interface MetoAiSignInFormProps {
	busy: boolean;
	/** 已翻译的失败提示；null 表示无错误。 */
	error: string | null;
	/** 非 null 时进入二次验证步骤。 */
	twoFactor: MetoAiTwoFactorChallenge | null;
	turnstile: TurnstileState;
	/** 站点要求 Turnstile 且已配置 site key。 */
	turnstileRequired: boolean;
	/** 站点是否开放注册；决定是否提示去官网注册。 */
	registerEnabled: boolean;
	onLogin: (username: string, password: string) => void | Promise<unknown>;
	onSubmitTwoFactor: (code: string) => void | Promise<unknown>;
	onCancelTwoFactor: () => void;
	onOpenSite: () => void;
}

export function MetoAiSignInForm({
	busy,
	error,
	twoFactor,
	turnstile,
	turnstileRequired,
	registerEnabled,
	onLogin,
	onSubmitTwoFactor,
	onCancelTwoFactor,
	onOpenSite,
}: MetoAiSignInFormProps): JSX.Element {
	const { t } = useTranslation("metoai");
	const [username, setUsername] = useState("");
	const [password, setPassword] = useState("");
	const [code, setCode] = useState("");
	const usernameRef = useRef<HTMLInputElement>(null);
	const codeRef = useRef<HTMLInputElement>(null);

	// 两步各自聚焦第一个输入框，键盘用户不必再点一次。
	useEffect(() => {
		const frame = requestAnimationFrame(() => {
			if (twoFactor) codeRef.current?.focus();
			else usernameRef.current?.focus();
		});
		return () => cancelAnimationFrame(frame);
	}, [twoFactor]);

	useEffect(() => {
		if (twoFactor) setCode("");
	}, [twoFactor]);

	const submitCredentials = (): void => {
		const nextUsername = username.trim();
		if (!nextUsername || !password || busy) return;
		void onLogin(nextUsername, password);
	};

	if (twoFactor) {
		return (
			<div className="space-y-4">
				<div className="space-y-1.5">
					<div className="text-[13px] font-semibold text-foreground">{t("login.twoFactorTitle")}</div>
					<p className="text-[12px] leading-relaxed text-muted-foreground">{t("login.twoFactorHint")}</p>
				</div>

				<div className="space-y-1.5">
					<label htmlFor="metoai-2fa-code" className="text-[12px] font-medium text-foreground">
						{t("login.twoFactorCode")}
					</label>
					<Input
						id="metoai-2fa-code"
						ref={codeRef}
						inputMode="numeric"
						autoComplete="one-time-code"
						maxLength={6}
						value={code}
						disabled={busy}
						onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
						onKeyDown={(event) => {
							if (event.key === "Enter" && code.length === 6) void onSubmitTwoFactor(code);
						}}
						className="h-9 tracking-[0.4em]"
					/>
				</div>

				{error && <FormError message={error} />}

				<div className="flex items-center gap-2">
					<Button
						variant="primary"
						onClick={() => void onSubmitTwoFactor(code)}
						disabled={busy || code.length !== 6}
						className="h-9 flex-1"
					>
						{busy ? t("login.submitting") : t("login.twoFactorSubmit")}
					</Button>
					<Button variant="outline" onClick={onCancelTwoFactor} disabled={busy} className="h-9">
						{t("login.twoFactorCancel")}
					</Button>
				</div>
			</div>
		);
	}

	return (
		<div className="space-y-4">
			<div className="space-y-1.5">
				<label htmlFor="metoai-username" className="text-[12px] font-medium text-foreground">
					{t("login.username")}
				</label>
				<Input
					id="metoai-username"
					ref={usernameRef}
					autoComplete="username"
					value={username}
					disabled={busy}
					placeholder={t("login.usernamePlaceholder")}
					onChange={(event) => setUsername(event.target.value)}
					onKeyDown={(event) => {
						if (event.key === "Enter") submitCredentials();
					}}
					className="h-9"
				/>
			</div>

			<div className="space-y-1.5">
				<label htmlFor="metoai-password" className="text-[12px] font-medium text-foreground">
					{t("login.password")}
				</label>
				<Input
					id="metoai-password"
					type="password"
					autoComplete="current-password"
					value={password}
					disabled={busy}
					placeholder={t("login.passwordPlaceholder")}
					onChange={(event) => setPassword(event.target.value)}
					onKeyDown={(event) => {
						if (event.key === "Enter") submitCredentials();
					}}
					className="h-9"
				/>
			</div>

			{/* Turnstile 关闭时容器仍然挂着（ref 由 hook 持有），不渲染任何可见内容。 */}
			{turnstileRequired && (
				<div className="space-y-1.5">
					<div ref={turnstile.containerRef} />
					{turnstile.failed ? (
						<p className="text-[12px] text-destructive">{t("login.turnstileFailed")}</p>
					) : !turnstile.token ? (
						<p className="text-[12px] text-muted-foreground">{t("login.turnstileHint")}</p>
					) : null}
				</div>
			)}

			{error && <FormError message={error} />}

			<Button
				variant="primary"
				onClick={submitCredentials}
				disabled={busy || !username.trim() || !password}
				className="h-9 w-full"
			>
				{busy ? t("login.submitting") : t("login.submit")}
			</Button>

			<div className="flex items-center justify-between gap-3">
				<button
					type="button"
					onClick={onOpenSite}
					className="text-[12px] font-medium text-primary hover:underline"
				>
					{t("login.openSite")}
				</button>
				{registerEnabled && <span className="text-[11px] text-muted-foreground">{t("login.registerHint")}</span>}
			</div>
		</div>
	);
}

function FormError({ message }: { message: string }): JSX.Element {
	return (
		<div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-[12px] text-destructive">
			{message}
		</div>
	);
}
