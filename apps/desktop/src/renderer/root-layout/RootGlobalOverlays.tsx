import { FilePreviewDialog } from "../domains/file-preview/components/FilePreviewDialog";
import { KnowledgeDropOverlay } from "../domains/knowledge-base/components/KnowledgeDropOverlay";
import { MetoAiGate } from "../domains/metoai/MetoAiGate";
import { PluginGlobalSlotHost } from "../domains/plugins/components/PluginGlobalSlotHost";
import { SetupWizard } from "../domains/setup-wizard";
import { ActionApprovalCenter } from "../shared/action-approval/ActionApprovalCenter";
import { AppearancePickerApproval } from "../shared/action-approval/appearance/AppearancePickerApproval";
import { ThemeChangeApproval } from "../shared/action-approval/appearance/ThemeChangeApproval";
import { BatchTasksExecutionApproval } from "../shared/action-approval/batch-tasks/BatchTasksExecutionApproval";
import { BatchTasksProjectApproval } from "../shared/action-approval/batch-tasks/BatchTasksProjectApproval";
import { BatchTasksTaskApproval } from "../shared/action-approval/batch-tasks/BatchTasksTaskApproval";
import { GenericActionApproval } from "../shared/action-approval/GenericActionApproval";
import { DomainManageApprovals } from "../shared/action-approval/manage/DomainManageApprovals";
import { NavigationOpenApproval } from "../shared/action-approval/navigation/NavigationOpenApproval";
import { SchedulerCreateApproval } from "../shared/action-approval/scheduler/SchedulerCreateApproval";
import { SchedulerDeleteApproval } from "../shared/action-approval/scheduler/SchedulerDeleteApproval";
import { SchedulerExecutionApproval } from "../shared/action-approval/scheduler/SchedulerExecutionApproval";
import { SchedulerToggleApproval } from "../shared/action-approval/scheduler/SchedulerToggleApproval";
import { SchedulerUpdateApproval } from "../shared/action-approval/scheduler/SchedulerUpdateApproval";
import { SshPromptDialog } from "../shared/components/SshPromptDialog";
import { UpdateRequiredOverlay } from "../shared/components/UpdateRequiredOverlay";
import { UpdateRestartDialog } from "../shared/components/UpdateRestartDialog";
import { Toaster } from "../shared/components/ui/Toaster";
import { ConfirmDialog } from "../shared/components/ui/confirm-dialog";
import { useThemeComponent } from "@vetta-org/theme-sdk";

export function RootGlobalOverlays(): JSX.Element {
	const ThemedConfirmDialog = useThemeComponent("root.confirmDialog", ConfirmDialog);
	const ThemedFilePreviewDialog = useThemeComponent("root.filePreviewDialog", FilePreviewDialog);
	const ThemedUpdateRestartDialog = useThemeComponent("root.updateRestartDialog", UpdateRestartDialog);
	const ThemedGenericActionApproval = useThemeComponent("root.genericActionApproval", GenericActionApproval);
	const ThemedAppearancePickerApproval = useThemeComponent("root.approval.appearancePicker", AppearancePickerApproval);
	const ThemedThemeChangeApproval = useThemeComponent("root.approval.themeChange", ThemeChangeApproval);
	const ThemedNavigationOpenApproval = useThemeComponent("root.approval.navigationOpen", NavigationOpenApproval);
	const ThemedBatchTasksProjectApproval = useThemeComponent("root.approval.batchTasksProject", BatchTasksProjectApproval);
	const ThemedBatchTasksTaskApproval = useThemeComponent("root.approval.batchTasksTask", BatchTasksTaskApproval);
	const ThemedBatchTasksExecutionApproval = useThemeComponent(
		"root.approval.batchTasksExecution",
		BatchTasksExecutionApproval,
	);
	const ThemedSchedulerCreateApproval = useThemeComponent("root.approval.schedulerCreate", SchedulerCreateApproval);
	const ThemedSchedulerUpdateApproval = useThemeComponent("root.approval.schedulerUpdate", SchedulerUpdateApproval);
	const ThemedSchedulerDeleteApproval = useThemeComponent("root.approval.schedulerDelete", SchedulerDeleteApproval);
	const ThemedSchedulerToggleApproval = useThemeComponent("root.approval.schedulerToggle", SchedulerToggleApproval);
	const ThemedSchedulerExecutionApproval = useThemeComponent("root.approval.schedulerExecution", SchedulerExecutionApproval);
	const ThemedKnowledgeDropOverlay = useThemeComponent("root.knowledgeDropOverlay", KnowledgeDropOverlay);
	const ThemedToaster = useThemeComponent("root.toaster", Toaster);

	return (
		<>
			<ThemedConfirmDialog />
			<ThemedFilePreviewDialog />
			<ThemedUpdateRestartDialog />
			<SshPromptDialog />
			<ActionApprovalCenter />
			<ThemedGenericActionApproval />
			<DomainManageApprovals />
			<ThemedAppearancePickerApproval />
			<ThemedThemeChangeApproval />
			<ThemedNavigationOpenApproval />
			<ThemedBatchTasksProjectApproval />
			<ThemedBatchTasksTaskApproval />
			<ThemedBatchTasksExecutionApproval />
			<ThemedSchedulerCreateApproval />
			<ThemedSchedulerUpdateApproval />
			<ThemedSchedulerDeleteApproval />
			<ThemedSchedulerToggleApproval />
			<ThemedSchedulerExecutionApproval />
			<PluginGlobalSlotHost />
			<ThemedKnowledgeDropOverlay />
			<ThemedToaster />
			{/*
			 * MetoAI 首次接入引导：必须排在 SetupWizard 之前——两者都是 z-[100] 全屏层，
			 * DOM 靠后的向导才能盖住它，用户才会先看到「语言与外观」而不是登录页。
			 * 向导里的登录步结束后会写「跳过」标记，这里便不再弹出。
			 */}
			<MetoAiGate />
			{/* 首次启动引导：盖在其它 overlay 之上；完成后写 localStorage 并通知 SidebarTour */}
			<SetupWizard />
			{/* 强制更新：阻塞式覆盖层，服务端策略要求且更新源给出可下载版本时才渲染 */}
			<UpdateRequiredOverlay />
		</>
	);
}
