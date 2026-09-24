import type { MetoaiDesktopMessageVO } from "@shared/lib/api";
import { atom } from "jotai";
import {
	type MessageCenterLocalState,
	normalizeMessageCenterLocalState,
	readMessageCenterLocalState,
	writeMessageCenterLocalState,
} from "../lib/message-center-storage";

/** metotoken 维护的官方消息；匿名公开接口，未登录也有内容。 */
export const metoaiMessagesAtom = atom<MetoaiDesktopMessageVO[]>([]);

const messageCenterLocalStateStateAtom = atom(readMessageCenterLocalState());

/**
 * 消息中心的本地状态（官方消息已读 + urgent 自动弹出记录）。
 * 读写对都走 localStorage：官方消息没有服务端已读接口，客户端也没有删除能力。
 */
export const messageCenterLocalStateAtom = atom(
	(get) => get(messageCenterLocalStateStateAtom),
	(_get, set, value: MessageCenterLocalState) => {
		const next = normalizeMessageCenterLocalState(value);
		writeMessageCenterLocalState(next);
		set(messageCenterLocalStateStateAtom, next);
	},
);
