import { UserAvatar } from "@shared/components/UserAvatar";
import { useTranslation } from "react-i18next";
import { SettingsMenuActionButton } from "./SettingsMenuActionButton";
import type { SettingsMenuMetoAiModel } from "./types";

interface SettingsMenuMetoAiSectionProps {
	model: SettingsMenuMetoAiModel;
}

/**
 * 侧边栏设置小拉窗里的 MetoAI 账号区。
 *
 * 打开这个拉窗的人只想知道两件事：现在是谁登录的、还剩多少额度。所以这里只有一张卡：
 * 一行身份，一行「余额（主）/ 已用（次）」。Key、订阅、请求数、充值入口这些明细都留在
 * 设置页——那里也是同一组「余额 / 已用」文案与币种规则的来源，同一概念只有一个说法。
 */
export function SettingsMenuMetoAiSection({ model }: SettingsMenuMetoAiSectionProps): JSX.Element {
	const { t } = useTranslation("metoai");

	if (!model.user) {
		return (
			<div>
				{model.phase === "waiting" ? (
					<div className="space-y-0.5">
						<div className="px-2.5 pb-1 text-[11px] leading-relaxed text-muted-foreground">
							{t("menu.waiting")}
						</div>
						<SettingsMenuActionButton icon="icon-[solar--refresh-linear]" onClick={model.actions.reopen}>
							{t("menu.reopen")}
						</SettingsMenuActionButton>
						<SettingsMenuActionButton icon="icon-[solar--close-circle-linear]" onClick={model.actions.cancel}>
							{t("menu.cancel")}
						</SettingsMenuActionButton>
					</div>
				) : (
					<div className="space-y-0.5">
						{model.busy && (
							<div className="px-2.5 pb-1 text-[11px] text-muted-foreground">{t("menu.opening")}</div>
						)}
						<SettingsMenuActionButton
							icon="icon-[solar--login-2-linear]"
							onClick={() => {
								if (!model.busy) model.actions.login();
							}}
						>
							{t("menu.login")}
						</SettingsMenuActionButton>
					</div>
				)}
				{model.error && <MetoAiSectionError message={model.error} />}
			</div>
		);
	}

	return (
		<div>
			{/* 与上方配额块同一套「小型状态区」样式（bg-accent/50 + rounded-md），让人一眼看成一类东西。 */}
			<div className="mx-2 my-1.5 rounded-md bg-accent/50 px-2 py-1.5">
				<div className="flex min-w-0 items-center gap-1.5">
					<UserAvatar
						nickname={model.user.display_name}
						username={model.user.username}
						className="h-4 w-4 shrink-0"
						textClassName="text-[10px]"
					/>
					<span className="min-w-0 truncate text-[11px] text-muted-foreground">
						{model.user.display_name?.trim() || model.user.username}
					</span>
				</div>
				{/* 余额是这块里唯一需要一眼看到的信息，字号与字重都压过同一行的「已用」。 */}
				<div className="mt-1 flex min-w-0 items-baseline justify-between gap-2">
					<div className="flex min-w-0 items-baseline gap-1">
						<span className="shrink-0 text-[11px] text-muted-foreground">{t("account.balance")}</span>
						<span className="min-w-0 truncate text-[15px] font-semibold tabular-nums text-foreground">
							{model.balance ?? "-"}
						</span>
					</div>
					<div className="flex shrink-0 items-baseline gap-1">
						<span className="text-[10px] text-muted-foreground">{t("account.used")}</span>
						<span className="text-[11px] tabular-nums text-muted-foreground">{model.used ?? "-"}</span>
					</div>
				</div>
			</div>

			<SettingsMenuActionButton
				icon="icon-[solar--logout-2-linear]"
				onClick={() => {
					if (!model.busy) model.actions.logout();
				}}
			>
				{model.busy ? t("menu.signingOut") : t("menu.logout")}
			</SettingsMenuActionButton>

			{model.error && <MetoAiSectionError message={model.error} />}
		</div>
	);
}

/**
 * 会话错误与余额拉取失败共用同一行提示：拉窗太小，分两处说反而看不清。
 * 失败必须说出来——静默会把上一次的数字冒充成现在的余额。
 */
function MetoAiSectionError({ message }: { message: string }): JSX.Element {
	return (
		<div className="mx-2.5 mt-1 rounded-md border border-destructive/30 bg-destructive/10 px-2 py-1.5 text-[11px] leading-relaxed text-destructive">
			{message}
		</div>
	);
}
