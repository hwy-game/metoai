import { fetchMetoaiDesktopMessages } from "@shared/lib/api";
import { languageAtom, metoaiMessagesAtom } from "@shared/store/atoms";
import { useAtomValue, useSetAtom } from "jotai";
import { useCallback } from "react";

let inFlight: Promise<void> | null = null;

export function useMetoaiMessageRefresh(): () => void {
	const language = useAtomValue(languageAtom);
	const setMessages = useSetAtom(metoaiMessagesAtom);
	return useCallback((): void => {
		if (inFlight) return;
		const request = Promise.resolve(fetchMetoaiDesktopMessages({ p: 1, page_size: 20, lang: language }))
			.then((page) => {
				if (page) setMessages(page.list);
			})
			.catch(() => undefined);
		inFlight = request;
		void request.then(() => {
			if (inFlight === request) inFlight = null;
		});
	}, [language, setMessages]);
}
