import { pickUrgentAutoOpenMessageId } from "@domains/project/components/sidebar/message-center/message-center-items";
import { waitForCommittedPaint } from "@shared/lib/committed-paint";
import { addAutoOpenedUrgentMessageId } from "@shared/lib/message-center-storage";
import { messageCenterLocalStateAtom, messageCenterOpenAtom, metoaiMessagesAtom } from "@shared/store/atoms";
import { useAtomValue, useSetAtom } from "jotai";
import { useEffect, useRef } from "react";
import { useMetoaiMessageRefresh } from "./useMetoaiMessageRefresh";

const REFRESH_POLL_INTERVAL_MS = 10 * 60 * 1_000;

export function useMetoaiMessageInit(): void {
	const refresh = useMetoaiMessageRefresh();
	const officialMessages = useAtomValue(metoaiMessagesAtom);
	const localState = useAtomValue(messageCenterLocalStateAtom);
	const setLocalState = useSetAtom(messageCenterLocalStateAtom);
	const setOpen = useSetAtom(messageCenterOpenAtom);
	const autoOpenedThisSessionRef = useRef(false);

	useEffect(() => {
		refresh();
		const refreshIfVisible = (): void => {
			if (document.visibilityState === "visible") refresh();
		};
		window.addEventListener("focus", refreshIfVisible);
		document.addEventListener("visibilitychange", refreshIfVisible);
		const timer = setInterval(() => {
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
		setLocalState(addAutoOpenedUrgentMessageId(localState, urgentId));
		void waitForCommittedPaint().then(() => setOpen(true));
	}, [officialMessages, localState, setLocalState, setOpen]);
}
