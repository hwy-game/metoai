/**
 * MetoAI 个人中心 · 订阅（展示层）。
 *
 * 只读：套餐名、状态、额度用量、到期与重置时间、自动续费都由 view model 传进来
 * （额度与时间在连接层按站点币种规则格式化）。购买、续费、取消一律去官网办理，
 * 客户端不发起任何扣费。
 */

import { Button } from "@shared/components/ui/button";
import { SettingRow, SettingSection, type SettingSectionMeta } from "@vetta-org/theme-ui/settings";
import { useTranslation } from "react-i18next";
import type { MetoAiSubscriptionRow } from "@domains/metoai/hooks/useMetoAiAccount";

export interface MetoAiSubscriptionSectionProps {
	section: SettingSectionMeta;
	rows: MetoAiSubscriptionRow[];
	loading: boolean;
	error: string | null;
	/** 去官网管理订阅（购买 / 续费 / 取消）。 */
	onManage: () => void;
}

export function MetoAiSubscriptionSection({
	section,
	rows,
	loading,
	error,
	onManage,
}: MetoAiSubscriptionSectionProps): JSX.Element {
	const { t } = useTranslation("metoai");
	const { t: tSettings } = useTranslation("settings");

	return (
		<SettingSection
			section={section}
			description={t("subscription.description")}
			title={
				<div className="flex items-center justify-between">
					<span>{section.title}</span>
					<Button variant="ghost" size="sm" onClick={onManage}>
						<span className="icon-[solar--link-circle-linear] h-3.5 w-3.5" />
						{t("subscription.manage")}
					</Button>
				</div>
			}
		>
			{rows.length === 0 && !error && (
				<div className="px-5 py-8 text-center text-[12px] text-muted-foreground">
					{loading ? tSettings("loading") : t("subscription.empty")}
				</div>
			)}

			{rows.map((row) => (
				<SettingRow
					key={row.id}
					title={row.planTitle ?? t("subscription.unknownPlan")}
					description={[
						t(row.statusLabelKey),
						`${t("subscription.usage")} ${row.used} / ${row.total}`,
						`${t("subscription.expiresAt")} ${row.expiresAt}`,
						row.nextResetAt ? `${t("subscription.nextResetAt")} ${row.nextResetAt}` : "",
						row.autoRenew ? t("subscription.autoRenewOn") : t("subscription.autoRenewOff"),
					]
						.filter(Boolean)
						.join(" · ")}
				>
					<span />
				</SettingRow>
			))}

			{error && <div className="border-t border-border px-5 py-3 text-[12px] text-destructive">{error}</div>}
		</SettingSection>
	);
}
