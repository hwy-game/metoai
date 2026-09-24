import { pickUrgentAutoOpenMessageId } from "@domains/project/components/sidebar/message-center/message-center-items";
import { fetchMetoaiDesktopMessages } from "@shared/lib/api";
import { waitForCommittedPaint } from "@shared/lib/committed-paint";
import { addAutoOpenedUrgentMessageId } from "@shared/lib/message-center-storage";
import { messageCenterLocalStateAtom, messageCenterOpenAtom, metoaiMessagesAtom } from "@shared/store/atoms";
import { useAtomValue, useSetAtom } from "jotai";
import { useEffect, useRef } from "react";

/**
 * 官方消息（metotoken 维护）初始化：启动拉一次列表。
 *
 * 与站内信不同，这条数据源是匿名公开的，所以不依赖登录 token，未登录也要显示；
 * 失败（离线 / 站点故障 / envelope 异常）一律静默降级——官方消息是尽力而为的附加内容，
 * 不该阻塞 UI、弹错误或污染日志。
 *
 * 另外负责 urgent 消息的自动弹出：只对「未读且没自动弹过」的 urgent 消息触发一次，
 * 且同一次会话最多弹一次（用户关掉之后不会被下一条 urgent 重新顶开）。触发前先把 id
 * 记进本地存储，保证同一个 id 在多次启动间只弹一次。
 */
export function useMetoaiMessageInit(): void {
	const setMessages = useSetAtom(metoaiMessagesAtom);
	const officialMessages = useAtomValue(metoaiMessagesAtom);
	const localState = useAtomValue(messageCenterLocalStateAtom);
	const setLocalState = useSetAtom(messageCenterLocalStateAtom);
	const setOpen = useSetAtom(messageCenterOpenAtom);
	const autoOpenedThisSessionRef = useRef(false);

	useEffect(() => {
		let active = true;
		void fetchMetoaiDesktopMessages({ p: 1, page_size: 20 })
			.then((page) => {
				if (active) setMessages(page.list);
			})
			.catch(() => {
				// 静默降级：不写日志、不弹错误，消息中心只是少一个 tab 的内容。
			});
		return () => {
			active = false;
		};
	}, [setMessages]);

	useEffect(() => {
		if (autoOpenedThisSessionRef.current) return;
		const urgentId = pickUrgentAutoOpenMessageId(
			officialMessages,
			new Set(localState.readOfficialIds),
			new Set(localState.autoOpenedUrgentIds),
		);
		if (urgentId === null) return;
		autoOpenedThisSessionRef.current = true;
		// 先落盘再弹：重挂载或重启都不会把同一条 urgent 再弹一次。
		setLocalState(addAutoOpenedUrgentMessageId(localState, urgentId));
		// 等主窗口完成首帧绘制，避免应用启动最初的几帧就被消息中心抢走注意力。
		void waitForCommittedPaint().then(() => setOpen(true));
	}, [officialMessages, localState, setLocalState, setOpen]);
}
