import { useTranslation } from "react-i18next";
import { MessageCenterDialogView } from "@vetta-org/theme-ui/sidebar";
import { MessageCenterContent } from "./MessageCenterContent";
import { MessageCenterTabs } from "./MessageCenterTabs";
import type { MessageCenterTab } from "./types";
import type { MessageCenterListModel } from "./useMessageCenterModel";

export function MessageCenterDialog({
	activeTab,
	chatUnread,
	list,
	notifUnread,
	officialUnread,
	open,
	pendingCount,
	onClose,
	onOpenChange,
	onSelectTab,
}: {
	activeTab: MessageCenterTab;
	chatUnread: number;
	list: MessageCenterListModel;
	notifUnread: number;
	officialUnread: number;
	open: boolean;
	pendingCount: number;
	onClose: () => void;
	onOpenChange: (open: boolean) => void;
	onSelectTab: (tab: MessageCenterTab) => void;
}): JSX.Element {
	const { t } = useTranslation("message");

	return (
		<MessageCenterDialogView
			open={open}
			title={t("title")}
			onClose={onClose}
			onOpenChange={onOpenChange}
			tabs={
				<MessageCenterTabs
					activeTab={activeTab}
					chatUnread={chatUnread}
					notifUnread={notifUnread}
					officialUnread={officialUnread}
					pendingCount={pendingCount}
					onSelect={onSelectTab}
				/>
			}
			content={<MessageCenterContent activeTab={activeTab} list={list} />}
		/>
	);
}
