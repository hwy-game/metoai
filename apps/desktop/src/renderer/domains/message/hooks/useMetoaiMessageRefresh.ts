import { fetchMetoaiDesktopMessages } from "@shared/lib/api";
import { metoaiMessagesAtom } from "@shared/store/atoms";
import { useSetAtom } from "jotai";
import { useCallback } from "react";

/**
 * 官方消息列表的唯一刷新入口：启动、回到前台、可见性变化、定时轮询与打开消息中心
 * 都走它，避免各处重复「请求 + 写 atom + 静默降级」这三件事。
 *
 * 单飞防重：切回应用一次会连发 focus + visibilitychange，打开消息中心也可能与轮询撞上，
 * 同一时刻只允许一个在途请求，后到的调用直接复用它的结果。
 *
 * 失败静默降级（不写日志、不弹错误），官方消息只是消息中心里的一个附加 tab。
 */
let inFlight: Promise<void> | null = null;

export function useMetoaiMessageRefresh(): () => void {
	const setMessages = useSetAtom(metoaiMessagesAtom);
	return useCallback((): void => {
		if (inFlight) return;
		const request = fetchMetoaiDesktopMessages({ p: 1, page_size: 20 })
			.then((page) => {
				setMessages(page.list);
			})
			.catch(() => {
				// 离线 / 站点故障 / envelope 异常都静默收口，保留上一次的列表。
			});
		inFlight = request;
		void request.then(() => {
			if (inFlight === request) inFlight = null;
		});
	}, [setMessages]);
}
