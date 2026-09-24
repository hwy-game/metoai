import { resolvedThemeAtom } from "@shared/store/atoms";
import { MarkdownPreviewView } from "@vetta-org/theme-ui/activity";
import { NotificationMessageListView as ThemeNotificationMessageListView } from "@vetta-org/theme-ui/sidebar";
import { useAtomValue } from "jotai";
import { useCallback } from "react";
import type { MessageCenterListModel } from "./useMessageCenterModel";

/**
 * 官方消息的正文是 Markdown（管理台用 Markdown 输入框维护）。这里复用活动面板的渲染器：
 * 它会把链接点击交给 `shell.openExternal`，避免在弹层里把整个渲染进程导航走。
 */
function MessageBodyMarkdown({ content }: { readonly content: string }): JSX.Element {
	const theme = useAtomValue(resolvedThemeAtom);
	const onOpenExternal = useCallback((href: string) => {
		void window.vetta.shell.openExternal(href);
	}, []);

	return (
		<div className="[&_.markdown-body]:p-0 [&_.markdown-body]:text-[11px]">
			<MarkdownPreviewView content={content} theme={theme} onOpenExternal={onOpenExternal} />
		</div>
	);
}

export function NotificationMessageListView(model: MessageCenterListModel): JSX.Element {
	// theme-ui 不依赖任何 Markdown 实现，渲染器由宿主注入（见 NotificationMessageListViewProps）。
	const renderBody = useCallback((body: string) => <MessageBodyMarkdown content={body} />, []);

	return (
		<ThemeNotificationMessageListView
			emptyText={model.emptyText}
			emptyIcon={model.emptyIcon}
			hasUnread={model.hasUnread}
			showClearRead={model.showClearRead}
			markAllReadLabel={model.markAllReadLabel}
			clearReadLabel={model.clearReadLabel}
			deleteLabel={model.deleteLabel}
			items={model.items}
			onMarkAllRead={model.onMarkAllRead}
			onClearRead={model.onClearRead}
			onMarkRead={model.onMarkRead}
			onDelete={model.onDelete}
			renderBody={renderBody}
		/>
	);
}
