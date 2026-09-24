/**
 * MetoAi 登录面（展示层）。
 *
 * 首次接入的全屏引导屏与首启向导的登录步共用这一个面，两处只在宿主提供的
 * 标题 / 副标题和是否带「跳过」动作上不同；账号授权与 API Key 两条进入路径的
 * 版式、状态和交互因此不会各自漂移。
 */

import { Button } from "@shared/components/ui/button";
import { Input } from "@shared/components/ui/input";
import { METOAI_DISPLAY_NAME, METOAI_LOGO_SRC } from "@/shared/metoai";
import { useId } from "react";
import { useTranslation } from "react-i18next";
import { MetoAiSignInForm, type MetoAiSignInFormProps } from "./MetoAiSignInForm";

/** API Key 直填区的状态与动作；由连接层提供（见 useMetoAiSignInModel）。 */
export interface MetoAiKeyFormState {
	value: string;
	saving: boolean;
	error: string | null;
	onChange: (value: string) => void;
	onSubmit: () => void;
}

export interface MetoAiSignInPanelProps {
	/** 由宿主提供：全屏引导屏与向导步的文案层级不同，版式一致。 */
	title: string;
	subtitle: string;
	/** 账号授权登录区的 view model 与动作（打开官网由本层统一提供）。 */
	signIn: Omit<MetoAiSignInFormProps, "onOpenSite">;
	/** API Key 直填区的状态与动作。 */
	keyForm: MetoAiKeyFormState;
	/** 当前进入方式；两者互斥。 */
	mode: "account" | "key";
	onToggleMode: () => void;
	/** 打开站点官网（注册 / 取 Key 都用它）。 */
	onOpenSite: () => void;
	/** 全屏引导屏的「跳过」；向导步的跳过由向导底部的操作承担，因此不传。 */
	onSkip?: () => void;
}

export function MetoAiSignInPanel({
	title,
	subtitle,
	signIn,
	keyForm,
	mode,
	onToggleMode,
	onOpenSite,
	onSkip,
}: MetoAiSignInPanelProps): JSX.Element {
	const { t } = useTranslation("metoai");

	return (
		<>
			<div className="flex flex-col items-center gap-4 text-center">
				<img src={METOAI_LOGO_SRC} alt={METOAI_DISPLAY_NAME} className="h-12 w-auto" />
				<div>
					<h2 className="text-[15px] font-semibold text-foreground">{title}</h2>
					<p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">{subtitle}</p>
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
				{onSkip && (
					<Button variant="ghost" size="sm" onClick={onSkip}>
						{t("gate.skip")}
					</Button>
				)}
			</div>
		</>
	);
}

function KeyForm({ state, onOpenSite }: { state: MetoAiKeyFormState; onOpenSite: () => void }): JSX.Element {
	const { t } = useTranslation("metoai");
	// 首启向导期间全屏引导屏仍挂载在下面，两处都渲染这个面，id 必须各自唯一。
	const inputId = useId();

	return (
		<div className="space-y-4">
			<div className="space-y-1.5">
				<label htmlFor={inputId} className="text-[12px] font-medium text-foreground">
					{t("gate.keyLabel")}
				</label>
				<div className="flex gap-2">
					<Input
						id={inputId}
						type="password"
						autoComplete="new-password"
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
