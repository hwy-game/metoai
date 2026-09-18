/**
 * 首次使用引导屏（展示层）。
 *
 * 只在「未接入 MetaToken 且用户没跳过」时覆盖主界面。两种进入方式：
 * 账号登录（登录后主进程会自动签发 Key 并写进模型配置）或直接填已有 Key。
 * 任何一条路走通、或用户点跳过，这个覆盖层就消失。
 */

import { Button } from "@shared/components/ui/button";
import { Input } from "@shared/components/ui/input";
import { METOAI_DISPLAY_NAME, METOAI_ICON } from "@/shared/metoai";
import { getProviderIcon } from "@vetta-org/theme-ui/shared";
import { useTranslation } from "react-i18next";
import { MetoAiSignInForm, type MetoAiSignInFormProps } from "./components/MetoAiSignInForm";

export interface MetoAiKeyFormState {
	value: string;
	saving: boolean;
	error: string | null;
	onChange: (value: string) => void;
	onSubmit: () => void;
}

export interface MetoAiGateViewProps {
	/** 账号登录区的 view model 与动作（打开官网由本层统一提供）。 */
	signIn: Omit<MetoAiSignInFormProps, "onOpenSite">;
	/** API Key 直填区的状态与动作。 */
	keyForm: MetoAiKeyFormState;
	/** 当前进入方式；两者互斥。 */
	mode: "account" | "key";
	onToggleMode: () => void;
	onSkip: () => void;
	/** 打开站点官网（注册 / 取 Key 都用它）。 */
	onOpenSite: () => void;
}

export function MetoAiGateView({
	signIn,
	keyForm,
	mode,
	onToggleMode,
	onSkip,
	onOpenSite,
}: MetoAiGateViewProps): JSX.Element {
	const { t } = useTranslation("metoai");
	const iconSrc = getProviderIcon(METOAI_ICON);

	return (
		<div className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-background p-6 text-foreground">
			<div className="w-full max-w-[400px]">
				<div className="flex flex-col items-center gap-4 text-center">
					{iconSrc ? (
						<img src={iconSrc} alt={METOAI_DISPLAY_NAME} className="h-14 w-14 rounded-2xl" />
					) : (
						<div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/15 text-xl font-bold text-primary">
							M
						</div>
					)}
					<div>
						<h1 className="text-[22px] font-bold">{t("gate.title")}</h1>
						<p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">{t("gate.subtitle")}</p>
					</div>
				</div>

				<div className="mt-6">
					{mode === "account" ? (
						<MetoAiSignInForm {...signIn} onOpenSite={onOpenSite} />
					) : (
						<KeyForm state={keyForm} onOpenSite={onOpenSite} />
					)}
				</div>

				<div className="mt-5 flex items-center justify-between gap-3 border-t border-border pt-4">
					<button
						type="button"
						onClick={onToggleMode}
						className="text-[12px] font-medium text-primary hover:underline"
					>
						{mode === "account" ? t("gate.manualKey") : t("gate.loginInstead")}
					</button>
					<Button variant="ghost" size="sm" onClick={onSkip}>
						{t("gate.skip")}
					</Button>
				</div>
			</div>
		</div>
	);
}

function KeyForm({ state, onOpenSite }: { state: MetoAiKeyFormState; onOpenSite: () => void }): JSX.Element {
	const { t } = useTranslation("metoai");

	return (
		<div className="space-y-4">
			<div className="space-y-1.5">
				<label htmlFor="metoai-key" className="text-[12px] font-medium text-foreground">
					{t("gate.keyLabel")}
				</label>
				<div className="flex gap-2">
					<Input
						id="metoai-key"
						type="password"
						value={state.value}
						disabled={state.saving}
						placeholder={t("gate.keyPlaceholder")}
						onChange={(event) => state.onChange(event.target.value)}
						onKeyDown={(event) => {
							if (event.key === "Enter") state.onSubmit();
						}}
						className="h-9"
					/>
					<Button
						variant="primary"
						onClick={state.onSubmit}
						disabled={!state.value.trim() || state.saving}
						className="h-9 shrink-0"
					>
						{state.saving ? t("gate.saving") : t("gate.save")}
					</Button>
				</div>
			</div>

			{state.error && (
				<div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-[12px] text-destructive">
					{state.error}
				</div>
			)}

			<div className="flex items-center justify-between gap-3">
				<button type="button" onClick={onOpenSite} className="text-[12px] font-medium text-primary hover:underline">
					{t("gate.getKey")}
				</button>
				<span className="text-[11px] text-muted-foreground">{t("gate.secureNote")}</span>
			</div>
		</div>
	);
}
