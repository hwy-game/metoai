import type { MetoaiDesktopMessageVO, NotificationVO } from "@shared/lib/api";

/**
 * 消息中心的合并视图项。
 *
 * 两套消息的 id 空间会撞（站内信是 vetta-serv 的数字 id，官方消息是 metotoken 的数字 id），
 * 所以 React key 与本地已读键统一用带命名空间前缀的 `id`，数字 id 只在解析来源时使用。
 */
export type MessageCenterItemLevel = "normal" | "important" | "urgent";

export type MessageCenterItemSource = "official" | "inapp";

export interface MessageCenterItem {
	/** 命名空间键，形如 `official-12` / `inapp-12`。 */
	readonly id: string;
	readonly title: string;
	readonly body: string | null;
	readonly read: boolean;
	/** 服务端没有发布时间时为 null，UI 不渲染时间行。 */
	readonly relativeTime: string | null;
	readonly level: MessageCenterItemLevel;
	/** 官方消息由服务端维护，客户端只标已读、不能删。 */
	readonly deletable: boolean;
	/** 正文是 Markdown（管理台用 Markdown 输入框维护）；站内信是纯文本。 */
	readonly markdownBody: boolean;
	/** 排序用原始时间戳；无发布时间为 null（排最后）。 */
	readonly timestamp: number | null;
}

export interface MessageCenterItemRef {
	readonly source: MessageCenterItemSource;
	readonly id: number;
}

export const OFFICIAL_MESSAGE_ID_PREFIX = "official-";
export const INAPP_MESSAGE_ID_PREFIX = "inapp-";

export function officialMessageItemId(id: number): string {
	return `${OFFICIAL_MESSAGE_ID_PREFIX}${id}`;
}

export function inappMessageItemId(id: number): string {
	return `${INAPP_MESSAGE_ID_PREFIX}${id}`;
}

/** 解析命名空间键；前缀或数字不合法时返回 null，绝不猜来源。 */
export function parseMessageCenterItemId(itemId: string): MessageCenterItemRef | null {
	const match = /^(official|inapp)-(\d+)$/.exec(itemId);
	if (!match) return null;
	const id = Number(match[2]);
	if (!Number.isSafeInteger(id)) return null;
	return { source: match[1] as MessageCenterItemSource, id };
}

function parseTimestamp(value: string | null): number | null {
	if (!value) return null;
	const time = new Date(value).getTime();
	return Number.isFinite(time) ? time : null;
}

function compareMessageCenterItems(left: MessageCenterItem, right: MessageCenterItem): number {
	const diff = (right.timestamp ?? 0) - (left.timestamp ?? 0);
	if (diff !== 0) return diff;
	return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

/** 发布时间倒序；同一时间按命名空间键兜底，保证顺序稳定。 */
export function sortMessageCenterItems(items: readonly MessageCenterItem[]): MessageCenterItem[] {
	return [...items].sort(compareMessageCenterItems);
}

/** 官方消息 → 视图项；已读状态来自客户端本地集合。 */
export function buildOfficialMessageItems(
	messages: readonly MetoaiDesktopMessageVO[],
	readIds: ReadonlySet<number>,
	formatTime: (timestamp: number) => string,
): MessageCenterItem[] {
	return messages.map((message) => {
		const timestamp = parseTimestamp(message.published_at);
		return {
			id: officialMessageItemId(message.id),
			title: message.title,
			body: message.body.trim() ? message.body : null,
			read: readIds.has(message.id),
			relativeTime: timestamp === null ? null : formatTime(timestamp),
			level: message.level,
			deletable: false,
			markdownBody: true,
			timestamp,
		};
	});
}

/** 站内信 → 视图项；级别恒为 normal，可删。 */
export function buildInappMessageItems(
	notifications: readonly NotificationVO[],
	formatTime: (timestamp: number) => string,
): MessageCenterItem[] {
	return notifications.map((notification) => {
		const timestamp = parseTimestamp(notification.created_at);
		return {
			id: inappMessageItemId(notification.id),
			title: notification.title,
			body: notification.body || null,
			read: notification.read,
			relativeTime: timestamp === null ? null : formatTime(timestamp),
			level: "normal",
			deletable: true,
			markdownBody: false,
			timestamp,
		};
	});
}

export function countUnreadMessageItems(items: readonly MessageCenterItem[]): number {
	return items.reduce((total, item) => total + (item.read ? 0 : 1), 0);
}

/**
 * 需要自动打开消息中心时返回那条 urgent 消息的 id，否则 null。
 * 只挑未读、且没自动弹过的 urgent 消息，取最近一条。
 */
export function pickUrgentAutoOpenMessageId(
	messages: readonly MetoaiDesktopMessageVO[],
	readIds: ReadonlySet<number>,
	autoOpenedIds: ReadonlySet<number>,
): number | null {
	let candidate: MetoaiDesktopMessageVO | null = null;
	let candidateTimestamp = -1;
	for (const message of messages) {
		if (message.level !== "urgent") continue;
		if (readIds.has(message.id) || autoOpenedIds.has(message.id)) continue;
		const timestamp = parseTimestamp(message.published_at) ?? 0;
		if (candidate !== null && timestamp <= candidateTimestamp) continue;
		candidate = message;
		candidateTimestamp = timestamp;
	}
	return candidate?.id ?? null;
}
