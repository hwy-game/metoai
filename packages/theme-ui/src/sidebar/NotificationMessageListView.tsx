import { AnimatePresence, motion } from "motion/react";
import type { JSX } from "react";
import { cn } from "@vetta-org/ui";
import { MESSAGE_CENTER_SPRING } from "./ChatMessageListView";
import { MessageCenterEmptyState } from "./MessageCenterEmptyState";
import { MessageCenterToolbarButton } from "./MessageCenterToolbarButton";

export type NotificationMessageItemLevel = "normal" | "important" | "urgent";

export interface NotificationMessageListItemView {
	/**
	 * Host-supplied namespaced key. Different message sources reuse the same numeric
	 * ids, so this doubles as the React key and the local read key.
	 */
	readonly id: string;
	readonly title: string;
	readonly body: string | null;
	readonly read: boolean;
	/** Already localized; `null` hides the timestamp row (no publish time available). */
	readonly relativeTime: string | null;
	readonly level: NotificationMessageItemLevel;
	/** Server-owned messages (official announcements) cannot be deleted by the client. */
	readonly deletable: boolean;
	/**
	 * Body is Markdown maintained in the admin console. The host decides how to render it
	 * (see `renderBody`), so this package stays independent of any Markdown implementation.
	 */
	readonly markdownBody?: boolean;
}

export interface NotificationMessageListViewProps {
	readonly emptyText: string;
	readonly emptyIcon: string;
	readonly hasUnread: boolean;
	/** Whether the current tab holds anything the "clear read" action can act on. */
	readonly showClearRead: boolean;
	readonly markAllReadLabel: string;
	readonly clearReadLabel: string;
	readonly deleteLabel: string;
	readonly items: readonly NotificationMessageListItemView[];
	readonly onMarkAllRead: () => void;
	readonly onClearRead: () => void;
	readonly onMarkRead: (id: string) => void;
	readonly onDelete: (id: string) => void;
	/** Renders a Markdown body for items with `markdownBody`. Host-supplied on purpose. */
	readonly renderBody?: (body: string) => JSX.Element | null;
}

/** Level decides the accent; unread state decides whether the accent is filled or muted. */
function itemSurfaceClass(item: NotificationMessageListItemView): string {
	if (!item.read) {
		if (item.level === "urgent") return "border-destructive/40 bg-destructive/15 hover:bg-destructive/20";
		if (item.level === "important") return "border-amber-500/40 bg-amber-500/15 hover:bg-amber-500/20";
		return "border-primary/30 bg-primary/5 hover:bg-primary/10";
	}
	return "border-border/50 bg-background hover:bg-accent/20";
}

function itemIconSurfaceClass(item: NotificationMessageListItemView): string {
	if (item.read) return "bg-muted";
	if (item.level === "urgent") return "bg-destructive/15";
	if (item.level === "important") return "bg-amber-500/15";
	return "bg-primary/15";
}

function itemIconClass(item: NotificationMessageListItemView): string {
	if (item.level === "urgent") return "text-destructive";
	if (item.level === "important") return "text-amber-400";
	return item.read ? "text-muted-foreground" : "text-primary";
}

function itemIconName(item: NotificationMessageListItemView): string {
	if (item.level === "urgent") return "icon-[solar--danger-triangle-linear]";
	if (item.level === "important") return "icon-[solar--bell-bing-linear]";
	return "icon-[solar--bell-linear]";
}

function itemDotClass(item: NotificationMessageListItemView): string {
	return item.level === "urgent" ? "bg-destructive" : "bg-primary";
}

export function NotificationMessageListView({
	emptyText,
	emptyIcon,
	hasUnread,
	showClearRead,
	markAllReadLabel,
	clearReadLabel,
	deleteLabel,
	items,
	onMarkAllRead,
	onClearRead,
	onMarkRead,
	onDelete,
	renderBody,
}: NotificationMessageListViewProps): JSX.Element {
	if (items.length === 0) {
		return <MessageCenterEmptyState text={emptyText} icon={emptyIcon} />;
	}

	return (
		<div className="flex flex-col gap-1.5 p-3">
			{(hasUnread || showClearRead) && (
				<div className="flex justify-end gap-1.5 px-0.5">
					{hasUnread && (
						<MessageCenterToolbarButton icon="icon-[solar--check-read-linear]" onClick={onMarkAllRead}>
							{markAllReadLabel}
						</MessageCenterToolbarButton>
					)}
					{showClearRead && (
						<MessageCenterToolbarButton
							icon="icon-[solar--notification-lines-remove-linear]"
							onClick={onClearRead}
						>
							{clearReadLabel}
						</MessageCenterToolbarButton>
					)}
				</div>
			)}
			<AnimatePresence initial={false} mode="popLayout">
				{items.map((notification) => (
					<motion.div
						key={notification.id}
						layout
						initial={{ opacity: 0, y: 8, scale: 0.98 }}
						animate={{ opacity: 1, y: 0, scale: 1 }}
						exit={{ opacity: 0, scale: 0.92, transition: { duration: 0.15 } }}
						transition={MESSAGE_CENTER_SPRING}
						onClick={() => onMarkRead(notification.id)}
						className={cn(
							"group relative cursor-pointer rounded-xl border p-3.5 text-left transition-colors",
							itemSurfaceClass(notification),
						)}
					>
						{notification.deletable && (
							<button
								type="button"
								onClick={(event) => {
									event.stopPropagation();
									onDelete(notification.id);
								}}
								className="absolute -right-1.5 -top-1.5 z-10 flex h-5 w-5 items-center justify-center rounded-full border border-border bg-background text-muted-foreground opacity-0 shadow-sm transition-colors hover:border-destructive/40 hover:bg-destructive hover:text-destructive-foreground group-hover:opacity-100"
								title={deleteLabel}
							>
								<span className="icon-[solar--close-circle-linear] h-3 w-3" />
							</button>
						)}

						<div className="flex items-start gap-3">
							<div
								className={cn(
									"relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
									itemIconSurfaceClass(notification),
								)}
							>
								<span className={cn(itemIconName(notification), "h-4 w-4", itemIconClass(notification))} />
								{!notification.read && (
									<span
										className={cn(
											"absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full ring-1 ring-popover",
											itemDotClass(notification),
										)}
									/>
								)}
							</div>
							<div className="min-w-0 flex-1">
								<p
									className={cn(
										"truncate text-[12px] leading-snug",
										notification.read ? "text-muted-foreground" : "font-semibold text-foreground",
									)}
								>
									{notification.title}
								</p>
								{notification.body &&
									(notification.markdownBody && renderBody ? (
										<div className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
											{renderBody(notification.body)}
										</div>
									) : (
										<p className="mt-1 whitespace-pre-line text-[11px] leading-relaxed text-muted-foreground">
											{notification.body}
										</p>
									))}
								{notification.relativeTime && (
									<p className="mt-1.5 text-[10px] text-muted-foreground/50">{notification.relativeTime}</p>
								)}
							</div>
						</div>
					</motion.div>
				))}
			</AnimatePresence>
		</div>
	);
}
