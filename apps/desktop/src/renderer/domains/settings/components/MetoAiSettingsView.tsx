/**
 * MetaToken 个人中心（展示层）。
 *
 * 登录后按「账号与余额 / API Key / 充值」三段渲染，数据全部来自 view model；
 * 未登录时改为登录表单——设置页是引导屏之外的常驻入口，用户跳过引导后仍能在这里登录。
 */

import { SettingRow, SettingSection } from "@vetta-org/theme-ui/settings";
import { Button } from "@shared/components/ui/button";
import { useTranslation } from "react-i18next";
import { MetoAiSignInForm } from "@domains/metoai/components/MetoAiSignInForm";
import { MetoAiAccountSection } from "./metoai/MetoAiAccountSection";
import { MetoAiKeysSection } from "./metoai/MetoAiKeysSection";
import { MetoAiTopUpSection } from "./metoai/MetoAiTopUpSection";
import type { MetoAiSettingsModel } from "./useMetoAiSettingsModel";

export interface MetoAiSettingsViewProps {
	model: MetoAiSettingsModel;
}

export function MetoAiSettingsView({ model }: MetoAiSettingsViewProps): JSX.Element {
	const { t } = useTranslation("metoai");
	const { t: tSettings } = useTranslation("settings");

	return (
		<div className="mx-auto w-full max-w-[680px] px-8 pt-2 pb-6">
			<h1 className="mb-6 text-[20px] font-bold text-foreground">{model.title}</h1>

			{!model.authenticated ? (
				<SettingSection section={{ id: "metoai-sign-in" }} title={t("signIn.title")} description={t("signIn.subtitle")}>
					<div className="px-5 py-4">
						<MetoAiSignInForm {...model.signIn} onOpenSite={model.onOpenSite} />
					</div>
				</SettingSection>
			) : model.account.user ? (
				<>
					<MetoAiAccountSection
						balance={model.account.balance}
						error={model.account.error}
						loading={model.account.loading}
						modelAccess={model.account.modelAccess}
						onRefresh={model.account.onRefresh}
						onSignOut={model.account.onSignOut}
						requests={model.account.requests}
						section={model.sections.account}
						signingOut={model.account.signingOut}
						used={model.account.used}
						user={model.account.user}
					/>

					<MetoAiKeysSection
						busy={model.keys.busy}
						error={model.keys.error}
						loading={model.keys.loading}
						onCopy={model.keys.onCopy}
						onCreate={model.keys.onCreate}
						onDelete={model.keys.onDelete}
						onReveal={model.keys.onReveal}
						onToggleStatus={model.keys.onToggleStatus}
						rows={model.keys.rows}
						section={model.sections.keys}
					/>

					<MetoAiTopUpSection
						amountOptions={model.topUp.amountOptions}
						error={model.topUp.error}
						loading={model.topUp.loading}
						methods={model.topUp.methods}
						onPay={model.topUp.onPay}
						onQuote={model.topUp.onQuote}
						onRedeem={model.topUp.onRedeem}
						paying={model.topUp.paying}
						quote={model.topUp.quote}
						quoting={model.topUp.quoting}
						records={model.topUp.records}
						redemptionEnabled={model.topUp.redemptionEnabled}
						section={model.sections.topUp}
						symbol={model.topUp.symbol}
					/>
				</>
			) : model.account.error ? (
				<SettingSection
					section={{ id: "metoai-account-error" }}
					title={t("account.title")}
					description={model.account.error}
				>
					<SettingRow border={false} title={t("account.errorLoad")}>
						<Button variant="outline" size="sm" onClick={model.account.onRefresh}>
							{t("account.refresh")}
						</Button>
					</SettingRow>
				</SettingSection>
			) : (
				<SettingSection section={{ id: "metoai-account-loading" }} title={t("account.title")}>
					<SettingRow border={false} title={tSettings("loading")}>
						<span />
					</SettingRow>
				</SettingSection>
			)}
		</div>
	);
}
