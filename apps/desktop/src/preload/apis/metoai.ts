import type { IpcRenderer } from "electron";
import type { MetoAiSessionSnapshot } from "../../shared/metoai-types.js";
import type { DesktopApi } from "../api.js";
import { onIpcEvent } from "./helper.js";

const METOAI_CHANNELS = {
	SESSION: "vetta:metoai:session",
	SESSION_CHANGED: "vetta:metoai:session-changed",
	LOGIN: "vetta:metoai:login",
	LOGIN_2FA: "vetta:metoai:login-2fa",
	LOGOUT: "vetta:metoai:logout",
	REFRESH: "vetta:metoai:refresh",
	OVERVIEW: "vetta:metoai:overview",
	SITE_CONFIG: "vetta:metoai:site-config",
	TOKENS_LIST: "vetta:metoai:tokens:list",
	TOKENS_CREATE: "vetta:metoai:tokens:create",
	TOKENS_DELETE: "vetta:metoai:tokens:delete",
	TOKENS_SET_STATUS: "vetta:metoai:tokens:set-status",
	TOKENS_KEY: "vetta:metoai:tokens:key",
	TOPUP_INFO: "vetta:metoai:topup:info",
	TOPUP_RECORDS: "vetta:metoai:topup:records",
	TOPUP_QUOTE: "vetta:metoai:topup:quote",
	TOPUP_REDEEM: "vetta:metoai:topup:redeem",
	TOPUP_PAY: "vetta:metoai:topup:pay",
	MODELS_ENSURE: "vetta:metoai:models:ensure",
} as const;

export function createMetoAiApi(ipc: IpcRenderer): Pick<DesktopApi, "metoai"> {
	return {
		metoai: {
			session: () => ipc.invoke(METOAI_CHANNELS.SESSION),
			overview: () => ipc.invoke(METOAI_CHANNELS.OVERVIEW),
			siteConfig: () => ipc.invoke(METOAI_CHANNELS.SITE_CONFIG),
			login: (input) => ipc.invoke(METOAI_CHANNELS.LOGIN, input.username, input.password, input.turnstileToken),
			loginTwoFactor: (input) => ipc.invoke(METOAI_CHANNELS.LOGIN_2FA, input.flowToken, input.code),
			logout: () => ipc.invoke(METOAI_CHANNELS.LOGOUT),
			refresh: () => ipc.invoke(METOAI_CHANNELS.REFRESH),
			onSessionChanged: (handler) =>
				onIpcEvent<MetoAiSessionSnapshot>(ipc, METOAI_CHANNELS.SESSION_CHANGED, handler),
			tokens: (query) => ipc.invoke(METOAI_CHANNELS.TOKENS_LIST, query),
			createKey: (draft) => ipc.invoke(METOAI_CHANNELS.TOKENS_CREATE, draft),
			deleteKey: (id) => ipc.invoke(METOAI_CHANNELS.TOKENS_DELETE, id),
			setKeyStatus: (id, status) => ipc.invoke(METOAI_CHANNELS.TOKENS_SET_STATUS, id, status),
			key: (id) => ipc.invoke(METOAI_CHANNELS.TOKENS_KEY, id),
			topUpInfo: () => ipc.invoke(METOAI_CHANNELS.TOPUP_INFO),
			topUpRecords: (page, pageSize) => ipc.invoke(METOAI_CHANNELS.TOPUP_RECORDS, page, pageSize),
			quote: (amount, method) => ipc.invoke(METOAI_CHANNELS.TOPUP_QUOTE, amount, method),
			redeem: (code) => ipc.invoke(METOAI_CHANNELS.TOPUP_REDEEM, code),
			pay: (amount, method) => ipc.invoke(METOAI_CHANNELS.TOPUP_PAY, amount, method),
			ensureModels: () => ipc.invoke(METOAI_CHANNELS.MODELS_ENSURE),
		},
	};
}
