/**
 * MetoAI 个人中心 · 账号与余额（展示层）。
 *
 * 只渲染传入的 view model：余额与用量已经是格式化好的文本（币种规则在主进程按
 * `/api/status` 推出，见 `domains/metoai/hooks/useMetoAiAccount.ts`）。
 *
 * 分区标题属于设置域的 `settings` ns，本组件自身的文案属于 `metoai` ns，因此绑两次
 * `useTranslation`（与 `useSettingsPageModel` 的 `t` / `tCommon` 同一写法）。
 */

import { Button } from "@shared/components/ui/button";
import { SettingRow, SettingSection, type SettingSectionMeta } from "@vetta-org/theme-ui/settings";
import { useTranslation } from "react-i18next";
import type { MetoAiUser } from "@/shared/metoai-types";

export interface MetoAiModelAccessState {
	/** 模型配置里已有 MetoAI 的 Key。 */
	connected: boolean;
	busy: boolean;
	/** 最近一次接入的结果文案；null 表示本次会话还没有动作。 */
	message: string | null;
	onConnect: () => void;
}

export interface MetoAiAccountSectionProps {
	section: SettingSectionMeta;
	user: MetoAiUser;
	/** 已按站点币种规则格式化。 */
	balance: string;
	used: string;
	requests: number;
	loading: boolean;
	error: string | null;
	onRefresh: () => void;
	signingOut: boolean;
	onSignOut: () => void;
	modelAccess: MetoAiModelAccessState;
}

export function MetoAiAccountSection({
	section,
	user,
	balance,
	used,
	requests,
	loading,
	error,
	onRefresh,
	signingOut,
	onSignOut,
	modelAccess,
}: MetoAiAccountSectionProps): JSX.Element {
	const { t } = useTranslation("metoai");
	const identity = user.display_name?.trim() || user.username;

	return (
		<SettingSection section={section}>
			<SettingRow title={identity} description={`@${user.username}`}>
				<Button variant="outline" size="sm" onClick={onRefresh} disabled={loading}>
					{t("account.refresh")}
				</Button>
			</SettingRow>

			<SettingRow title={t("account.balance")}>
				<span className="text-[15px] font-semibold tabular-nums text-foreground">{balance}</span>
			</SettingRow>

			<SettingRow title={t("account.used")}>
				<span className="text-[13px] tabular-nums text-muted-foreground">{used}</span>
			</SettingRow>

			<SettingRow title={t("account.requests")}>
				<span className="text-[13px] tabular-nums text-muted-foreground">{requests}</span>
			</SettingRow>

			<SettingRow
				title={t("account.modelAccess")}
				description={
					modelAccess.message ??
					(modelAccess.connected ? t("account.modelAccessReady") : t("account.modelAccessHint"))
				}
			>
				<Button variant="outline" size="sm" onClick={modelAccess.onConnect} disabled={modelAccess.busy}>
					{modelAccess.busy ? t("account.modelAccessSyncing") : t("account.modelAccessAction")}
				</Button>
			</SettingRow>

			<SettingRow title={t("account.title")} description={error ?? undefined} border={false}>
				<Button variant="destructive" size="sm" onClick={onSignOut} disabled={signingOut}>
					{signingOut ? t("account.signingOut") : t("account.signOut")}
				</Button>
			</SettingRow>
		</SettingSection>
	);
}
