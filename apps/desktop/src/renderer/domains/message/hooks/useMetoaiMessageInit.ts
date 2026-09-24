import { pickUrgentAutoOpenMessageId } from "@domains/project/components/sidebar/message-center/message-center-items";
import { waitForCommittedPaint } from "@shared/lib/committed-paint";
import { addAutoOpenedUrgentMessageId } from "@shared/lib/message-center-storage";
import { messageCenterLocalStateAtom, messageCenterOpenAtom, metoaiMessagesAtom } from "@shared/store/atoms";
import { useAtomValue, useSetAtom } from "jotai";
import { useEffect, useRef } from "react";
import { useMetoaiMessageRefresh } from "./useMetoaiMessageRefresh";

/**
 * 轮询间隔：官方公告（含 urgent）随时可能新增，一直开着不重启的客户端不能只在启动时拉一次。
 * 间隔内还有「回到前台」兜底，所以不需要为了时效性把间隔压得更短。
 */
const REFRESH_POLL_INTERVAL_MS = 10 * 60 * 1_000;

/**
 * 官方消息（metotoken 维护）初始化：启动拉一次，之后在「回到前台」与固定间隔上刷新。
 *
 * 与站内信不同，这条数据源是匿名公开的，所以不依赖登录 token，未登录也要显示；
 * 失败（离线 / 站点故障 / envelope 异常）一律静默降级——官方消息是尽力而为的附加内容，
 * 不该阻塞 UI、弹错误或污染日志。
 *
 * 另外负责 urgent 消息的自动弹出：只对「未读且没自动弹过」的 urgent 消息触发一次，
 * 且同一次会话最多弹一次（用户关掉之后不会被下一条 urgent 重新顶开）。触发前先把 id
 * 记进本地存储，保证同一个 id 在多次启动间只弹一次——因此刷新出新列表也不会重复弹。
 */
export function useMetoaiMessageInit(): void {
	const refresh = useMetoaiMessageRefresh();
	const officialMessages = useAtomValue(metoaiMessagesAtom);
	const localState = useAtomValue(messageCenterLocalStateAtom);
	const setLocalState = useSetAtom(messageCenterLocalStateAtom);
	const setOpen = useSetAtom(messageCenterOpenAtom);
	const autoOpenedThisSessionRef = useRef(false);

	useEffect(() => {
		refresh();
		// 切回应用会连发 focus 与 visibilitychange，靠 refresh 的单飞防重去重；
		// 页面不可见时的 focus（窗口被遮挡、最小化后恢复）不算回到前台。
		const refreshIfVisible = (): void => {
			if (document.visibilityState !== "visible") return;
			refresh();
		};
		window.addEventListener("focus", refreshIfVisible);
		document.addEventListener("visibilitychange", refreshIfVisible);
		const timer = setInterval(() => {
			// 页面不可见时轮询没有意义，等下一次回到前台再补。
			if (document.visibilityState === "visible") refresh();
		}, REFRESH_POLL_INTERVAL_MS);
		return () => {
			window.removeEventListener("focus", refreshIfVisible);
			document.removeEventListener("visibilitychange", refreshIfVisible);
			clearInterval(timer);
		};
	}, [refresh]);

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
