import { useMetoaiMessageRefresh } from "@domains/message/hooks/useMetoaiMessageRefresh";
import {
	clearReadNotifications,
	deleteNotification,
	markAllNotificationsRead,
	markNotificationRead,
	type NotificationVO,
} from "@shared/lib/api";
import { addReadOfficialMessageIds } from "@shared/lib/message-center-storage";
import {
	authTokenAtom,
	messageCenterLocalStateAtom,
	messageCenterOpenAtom,
	metoaiMessagesAtom,
	notificationsAtom,
	notificationUnreadAtom,
} from "@shared/store/atoms";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { formatRelativeTime } from "./formatRelativeTime";
import {
	buildInappMessageItems,
	buildOfficialMessageItems,
	countUnreadMessageItems,
	type MessageCenterItem,
	parseMessageCenterItemId,
	sortMessageCenterItems,
} from "./message-center-items";
import type { MessageCenterTab } from "./types";

/** 列表区（工具栏 + 条目）的模型；由 tab 决定内容与工具栏可用项。 */
export interface MessageCenterListModel {
	readonly emptyText: string;
	readonly emptyIcon: string;
	readonly hasUnread: boolean;
	readonly showClearRead: boolean;
	readonly markAllReadLabel: string;
	readonly clearReadLabel: string;
	readonly deleteLabel: string;
	readonly items: readonly MessageCenterItem[];
	readonly onMarkAllRead: () => void;
	readonly onClearRead: () => void;
	readonly onMarkRead: (id: string) => void;
	readonly onDelete: (id: string) => void;
}

export interface MessageCenterModel {
	readonly activeTab: MessageCenterTab;
	readonly chatUnread: number;
	readonly close: () => void;
	readonly list: MessageCenterListModel;
	readonly notifUnread: number;
	readonly officialUnread: number;
	readonly open: boolean;
	readonly pendingCount: number;
	readonly setActiveTab: (tab: MessageCenterTab) => void;
	readonly setOpen: (open: boolean) => void;
	readonly totalUnread: number;
}

const EMPTY_ICONS: Record<MessageCenterTab, string> = {
	all: "icon-[solar--inbox-linear]",
	notifications: "icon-[solar--bell-linear]",
	official: "icon-[solar--letter-linear]",
};

/**
 * 消息中心模型：把两套消息源（vetta-serv 站内信 + metotoken 官方消息）折成同一份列表。
 *
 * - 官方消息的已读只存在客户端本地（服务端没有已读接口），站内信已读仍以服务端为准。
 * - 官方消息不可删；`all` tab 的「清空已读」只作用于站内信，所以只在有可清理的已读站内信时出现。
 */
export function useMessageCenterModel(): MessageCenterModel {
	const { t } = useTranslation("message");
	const [activeTab, setActiveTab] = useState<MessageCenterTab>("all");
	const [open, setOpen] = useAtom(messageCenterOpenAtom);
	const token = useAtomValue(authTokenAtom);
	const notifications = useAtomValue(notificationsAtom);
	const setNotifications = useSetAtom(notificationsAtom);
	const notifUnread = useAtomValue(notificationUnreadAtom);
	const setNotifUnread = useSetAtom(notificationUnreadAtom);
	const officialMessages = useAtomValue(metoaiMessagesAtom);
	const [localState, setLocalState] = useAtom(messageCenterLocalStateAtom);

	// 用户点开铃铛时补一次：官方公告随时可能新增，打开时就该看到最新的，而不是上次拉取的结果。
	const refreshOfficialMessages = useMetoaiMessageRefresh();
	useEffect(() => {
		if (open) refreshOfficialMessages();
	}, [open, refreshOfficialMessages]);
	const formatTime = useCallback((timestamp: number) => formatRelativeTime(timestamp, t), [t]);

	const officialItems = useMemo(
		() => buildOfficialMessageItems(officialMessages, new Set(localState.readOfficialIds), formatTime),
		[officialMessages, localState.readOfficialIds, formatTime],
	);
	const inappItems = useMemo(() => buildInappMessageItems(notifications, formatTime), [notifications, formatTime]);

	const officialUnread = countUnreadMessageItems(officialItems);
	const items = useMemo(() => {
		if (activeTab === "official") return sortMessageCenterItems(officialItems);
		if (activeTab === "notifications") return sortMessageCenterItems(inappItems);
		return sortMessageCenterItems([...officialItems, ...inappItems]);
	}, [activeTab, officialItems, inappItems]);

	const markOfficialRead = (ids: readonly number[]): void => {
		if (ids.length === 0) return;
		setLocalState(addReadOfficialMessageIds(localState, ids));
	};

	const markInappRead = (notification: NotificationVO): void => {
		if (notification.read || !token) return;
		setNotifications((prev) => prev.map((item) => (item.id === notification.id ? { ...item, read: true } : item)));
		setNotifUnread((prev) => Math.max(0, prev - 1));
		void markNotificationRead(token, notification.id).catch(console.error);
	};

	const handleMarkRead = (itemId: string): void => {
		const ref = parseMessageCenterItemId(itemId);
		if (!ref) return;
		if (ref.source === "official") {
			markOfficialRead([ref.id]);
			return;
		}
		const notification = notifications.find((item) => item.id === ref.id);
		if (notification) markInappRead(notification);
	};

	const handleMarkAllRead = (): void => {
		markOfficialRead(officialMessages.map((message) => message.id));
		if (!token) return;
		setNotifications((prev) => prev.map((item) => ({ ...item, read: true })));
		setNotifUnread(0);
		void markAllNotificationsRead(token).catch(console.error);
	};

	const handleClearRead = (): void => {
		if (!token) return;
		setNotifications((prev) => prev.filter((item) => !item.read));
		void clearReadNotifications(token).catch(console.error);
	};

	const handleDelete = (itemId: string): void => {
		const ref = parseMessageCenterItemId(itemId);
		if (!ref || ref.source !== "inapp" || !token) return;
		const notification = notifications.find((item) => item.id === ref.id);
		if (!notification) return;
		setNotifications((prev) => prev.filter((item) => item.id !== ref.id));
		if (!notification.read) setNotifUnread((prev) => Math.max(0, prev - 1));
		void deleteNotification(token, ref.id).catch(console.error);
	};

	return {
		activeTab,
		chatUnread: 0,
		close: () => setOpen(false),
		list: {
			emptyText: t(`empty.${activeTab}`),
			emptyIcon: EMPTY_ICONS[activeTab],
			hasUnread: items.some((item) => !item.read),
			showClearRead: activeTab !== "official" && inappItems.some((item) => item.read),
			markAllReadLabel: t("notification.markAllRead"),
			clearReadLabel: t("notification.clearRead"),
			deleteLabel: t("notification.delete"),
			items,
			onMarkAllRead: handleMarkAllRead,
			onClearRead: handleClearRead,
			onMarkRead: handleMarkRead,
			onDelete: handleDelete,
		},
		notifUnread,
		officialUnread,
		open,
		pendingCount: 0,
		setActiveTab,
		setOpen,
		totalUnread: notifUnread + officialUnread,
	};
}
