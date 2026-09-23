import { type AppLanguage, FIXED_LANGUAGE_OPTIONS } from "@/shared/i18n/config";
import { type ActiveActionApproval, useActionApproval } from "../../useActionApproval";
import {
	ApprovalImpactCard,
	ApprovalRawFallback,
	ApprovalTargetCard,
} from "../ApprovalParts";
import { useManageApprovalFrame } from "../useManageApprovalShell";

interface Input { type: "set-language"; language: AppLanguage; }

/** 语言码 → 语种自称（中文 / English / 日本語 …）；表里没有的码原样返回，不编造译名。 */
export function resolveLanguageNativeLabel(language: string): string {
	return FIXED_LANGUAGE_OPTIONS.find((option) => option.value === language)?.native ?? language;
}

function parseInput(input: unknown): Input | null {
	if (typeof input !== "object" || input === null || Array.isArray(input)) return null;
	const r = input as Record<string, unknown>;
	if (r.type !== "set-language") return null;
	return r as unknown as Input;
}

export function AppearanceSetLanguageApproval(): JSX.Element | null {
	const approval = useActionApproval("appearance.set-language");
	if (!approval) return null;
	return <AppearanceSetLanguageApprovalContent key={approval.request.approvalId} approval={approval} />;
}

/** 导出给组件测试：审批输入到展示文案的整条渲染路径在这里，测试直接渲染它。 */
export function AppearanceSetLanguageApprovalContent({ approval }: { approval: ActiveActionApproval }): JSX.Element {
	const { Frame, t, frameLabels } = useManageApprovalFrame();
	const { request, responding, error, approve, reject } = approval;
	const input = parseInput(request.input);
	const icon = "icon-[mdi--translate]";

	return (
		<Frame
			presentation="dialog"
			title={t("manageApproval.appearance.ops.set-language.title")}
			summary={t("manageApproval.appearance.ops.set-language.summary")}
			icon={icon}
			badge={t("manageApproval.appearance.ops.set-language.badge")}
			labels={frameLabels(request.permission, t("manageApproval.appearance.ops.set-language.confirm"))}
			responding={responding}
			countdown={approval.countdown.formatted}
			error={error}
			onReject={reject}
			onApprove={() => approve()}
			canApprove={Boolean(input)}
		>
			{input ? (
				<>
					<ApprovalTargetCard icon="icon-[mdi--translate]" title={resolveLanguageNativeLabel(input.language)} subtitle={input.language} />
					<ApprovalImpactCard
						icon={icon}
						title={t("manageApproval.afterActionTitle")}
						description={t("manageApproval.appearance.ops.set-language.impact")}
						
					/>
					
				</>
			) : (
				<ApprovalRawFallback input={request.input} />
			)}
		</Frame>
	);
}
