import { migrateVersionedConfig } from "@vetta/toolkit/versioned-config";

/**
 * 消息中心的本地状态：官方消息（metotoken 侧）的已读集合，以及「已经自动弹过」的
 * urgent 消息 id。
 *
 * 官方消息由服务端维护，客户端没有已读接口，也没有删除能力，所以这两份状态只存在本机
 * （沿用 file-explorer-preferences.ts 的 localStorage + schemaVersion 版本化做法），
 * 重装即重置。
 */
export interface MessageCenterLocalState {
	schemaVersion: 1;
	/** 已读的官方消息 id（metotoken 的数字 id，与站内信 id 空间无关）。 */
	readOfficialIds: number[];
	/** 已经自动打开过消息中心的 urgent 官方消息 id：同一条只弹一次。 */
	autoOpenedUrgentIds: number[];
}

export const MESSAGE_CENTER_STORAGE_KEY = "vetta-message-center";

export const DEFAULT_MESSAGE_CENTER_LOCAL_STATE: MessageCenterLocalState = {
	schemaVersion: 1,
	readOfficialIds: [],
	autoOpenedUrgentIds: [],
};

/**
 * id 集合的容量上限。官方消息是低频公告，正常远达不到；设上限只是为了不让
 * localStorage 随运行时间无限增长。超出后丢弃最旧的记录（可能让一条很久以前的
 * 消息重新变回未读，这是刻意的取舍：宁可多一个红点，也不要写爆存储）。
 */
const MAX_TRACKED_IDS = 2000;

function normalizeIdList(value: unknown): number[] {
	if (!Array.isArray(value)) return [];
	const ids = new Set<number>();
	for (const item of value) {
		if (typeof item === "number" && Number.isInteger(item) && item > 0) ids.add(item);
	}
	return [...ids].slice(-MAX_TRACKED_IDS);
}

export function normalizeMessageCenterLocalState(value: unknown): MessageCenterLocalState {
	let migrated: Record<string, unknown>;
	try {
		migrated = migrateVersionedConfig(value, { currentVersion: 1, migrations: [] }).config;
	} catch {
		return { ...DEFAULT_MESSAGE_CENTER_LOCAL_STATE };
	}
	return {
		schemaVersion: 1,
		readOfficialIds: normalizeIdList(migrated.readOfficialIds),
		autoOpenedUrgentIds: normalizeIdList(migrated.autoOpenedUrgentIds),
	};
}

export function readMessageCenterLocalState(): MessageCenterLocalState {
	try {
		return normalizeMessageCenterLocalState(JSON.parse(localStorage.getItem(MESSAGE_CENTER_STORAGE_KEY) ?? "null"));
	} catch {
		return { ...DEFAULT_MESSAGE_CENTER_LOCAL_STATE };
	}
}

export function writeMessageCenterLocalState(state: MessageCenterLocalState): void {
	try {
		localStorage.setItem(MESSAGE_CENTER_STORAGE_KEY, JSON.stringify(normalizeMessageCenterLocalState(state)));
	} catch {
		// 配额或隐私模式：本次会话内 UI 仍按内存里的状态工作，重启后回退到未读。
	}
}

/** 追加已读 id（纯函数，去重并保序）。 */
export function addReadOfficialMessageIds(
	state: MessageCenterLocalState,
	ids: readonly number[],
): MessageCenterLocalState {
	return { ...state, readOfficialIds: normalizeIdList([...state.readOfficialIds, ...ids]) };
}

/** 追加「已自动弹出」标记（纯函数）。 */
export function addAutoOpenedUrgentMessageId(state: MessageCenterLocalState, id: number): MessageCenterLocalState {
	return { ...state, autoOpenedUrgentIds: normalizeIdList([...state.autoOpenedUrgentIds, id]) };
}
