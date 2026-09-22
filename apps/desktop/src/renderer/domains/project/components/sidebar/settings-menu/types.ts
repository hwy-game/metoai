import type { ThemeMode } from "@shared/store/atoms";
import type { MetoAiUser } from "@/shared/metoai-types";

export interface SettingsMenuThemeOption {
	icon: string;
	label: string;
	value: ThemeMode;
}

export interface SettingsMenuMetoAiModel {
	/** 已登录的用户；null 表示未登录，界面改显示登录入口。 */
	user: MetoAiUser | null;
	/** 已按站点币种规则格式化的余额与已用；还没拉到站点配置时为 null。 */
	balance: string | null;
	used: string | null;
	busy: boolean;
	error: string | null;
	phase: "idle" | "waiting";
	actions: {
		login(): void;
		reopen(): void;
		cancel(): void;
		logout(): void;
	};
}

export interface SettingsMenuModel {
	fiveHourRemainingPercent: number;
	fiveHourResetAt?: string;
	goBadgeColor?: string;
	goBadgeText?: string;
	goEnabled: boolean;
	mode: ThemeMode;
	/** Claw（IM）是否在线，控制头像 item 内 Claw 状态徽章展示。 */
	clawOnline: boolean;
	/** Claw 徽章 tooltip 文案。 */
	clawTitle: string;
	open: boolean;
	/** 云服务（登录/订阅）是否编入本构建；lite 下隐藏账户区段。 */
	cloudEnabled: boolean;
	subscriptionTierName?: string;
	themeOptions: SettingsMenuThemeOption[];
	user: {
		avatar?: string | null;
		nickname?: string | null;
		username?: string | null;
	} | null;
	metoai: SettingsMenuMetoAiModel;
	actions: {
		login(): void;
		logout(): void;
		openSettings(): void;
		setMode(mode: ThemeMode, event: React.MouseEvent<HTMLButtonElement>): void;
		setOpen(open: boolean): void;
	};
}
