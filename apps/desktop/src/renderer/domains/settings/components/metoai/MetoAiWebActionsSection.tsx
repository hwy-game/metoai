/**
 * MetaToken 个人中心 · 官网入口（展示层）。
 *
 * 充值、订阅、兑换码、账户资料、用量明细全部在 MetaToken 官网办理：客户端只打开
 * 对应页面，不再应用内收款、也不再内置收银台。浏览器里通常已经是登录态——授权
 * 登录时建立的会话就在那里。
 */

import { Button } from "@shared/components/ui/button";
import { SettingRow, SettingSection, type SettingSectionMeta } from "@vetta-org/theme-ui/settings";
import { useTranslation } from "react-i18next";

export interface MetoAiWebActionsSectionProps {
	section: SettingSectionMeta;
	onTopUp: () => void;
	onSubscription: () => void;
	onRedeem: () => void;
	onProfile: () => void;
	onUsage: () => void;
}

export function MetoAiWebActionsSection({
	section,
	onTopUp,
	onSubscription,
	onRedeem,
	onProfile,
	onUsage,
}: MetoAiWebActionsSectionProps): JSX.Element {
	const { t } = useTranslation("metoai");

	const actions = [
		{ key: "topUp", title: t("webActions.topUp"), description: t("webActions.topUpHint"), run: onTopUp },
		{
			key: "subscription",
			title: t("webActions.subscription"),
			description: t("webActions.subscriptionHint"),
			run: onSubscription,
		},
		{ key: "redeem", title: t("webActions.redeem"), description: t("webActions.redeemHint"), run: onRedeem },
		{ key: "profile", title: t("webActions.profile"), description: t("webActions.profileHint"), run: onProfile },
		{ key: "usage", title: t("webActions.usage"), description: t("webActions.usageHint"), run: onUsage },
	];

	return (
		<SettingSection section={section} description={t("webActions.description")}>
			{actions.map((action, index) => (
				<SettingRow
					key={action.key}
					title={action.title}
					description={action.description}
					border={index < actions.length - 1}
				>
					<Button variant="outline" size="sm" onClick={action.run}>
						{t("webActions.open")}
					</Button>
				</SettingRow>
			))}
		</SettingSection>
	);
}
