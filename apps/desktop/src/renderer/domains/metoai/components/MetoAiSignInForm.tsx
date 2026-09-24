/**
 * MetoAi 授权登录入口（展示层）。
 *
 * MetoAi 账号不在客户端收集用户名或密码。用户通过系统浏览器进入
 * MetoAi 完成授权；客户端只负责发起授权，不接触账号凭据。
 *
 * 等待期只给两个动作：重开链接（浏览器被关掉时）与取消（放弃等待，回到可重试状态）。
 */

import { Button } from "@shared/components/ui/button";
import { useTranslation } from "react-i18next";

export interface MetoAiSignInFormProps {
	/** `idle` 可发起授权；`waiting` 表示授权页已在浏览器打开，等回调。 */
	phase: "idle" | "waiting";
	/** 已翻译的失败提示；null 表示无错误。 */
	error: string | null;
	onAuthorize: () => void;
	onReopen: () => void;
	onCancel: () => void;
	/** 打开站点官网：没有账号时注册，浏览器被拦下时兜底。 */
	onOpenSite: () => void;
}

export function MetoAiSignInForm({
	phase,
	error,
	onAuthorize,
	onReopen,
	onCancel,
	onOpenSite,
}: MetoAiSignInFormProps): JSX.Element {
	const { t } = useTranslation("metoai");

	return (
		<div className="space-y-4">
			<div className="rounded-lg border border-border/60 bg-muted/20 px-3 py-2.5 text-[12px] leading-relaxed text-muted-foreground">
				{t(phase === "waiting" ? "authorize.waitingHint" : "authorize.hint")}
			</div>

			{phase === "waiting" ? (
				<div className="space-y-2">
					<div className="text-[13px] font-medium text-foreground">{t("authorize.waitingTitle")}</div>
					<div className="flex items-center gap-2">
						<Button variant="primary" className="h-9 flex-1" onClick={onReopen}>
							{t("authorize.reopen")}
						</Button>
						<Button variant="outline" className="h-9 shrink-0" onClick={onCancel}>
							{t("authorize.cancel")}
						</Button>
					</div>
				</div>
			) : (
				<Button variant="primary" className="h-9 w-full" onClick={onAuthorize}>
					<span className="icon-[solar--login-2-linear] h-4 w-4" />
					{t("authorize.submit")}
				</Button>
			)}

			{error && (
				<div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-[12px] text-destructive">
					{error}
				</div>
			)}

			<div className="flex items-center justify-between gap-3">
				<button type="button" onClick={onOpenSite} className="text-[12px] font-medium text-primary hover:underline">
					{t("authorize.openSite")}
				</button>
				<span className="text-[11px] text-muted-foreground">{t("authorize.secureNote")}</span>
			</div>
		</div>
	);
}
