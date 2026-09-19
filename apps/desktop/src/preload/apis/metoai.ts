import type { IpcRenderer } from "electron";
import type { MetoAiAuthorizeRejection, MetoAiSessionSnapshot } from "../../shared/metoai-types.js";
import type { DesktopApi } from "../api.js";
import { onIpcEvent } from "./helper.js";

const METOAI_CHANNELS = {
	SESSION: "vetta:metoai:session",
	SESSION_CHANGED: "vetta:metoai:session-changed",
	AUTHORIZE: "vetta:metoai:authorize",
	AUTHORIZE_REOPEN: "vetta:metoai:authorize:reopen",
	AUTHORIZE_REJECTED: "vetta:metoai:authorize-rejected",
	LOGOUT: "vetta:metoai:logout",
	REFRESH: "vetta:metoai:refresh",
	OVERVIEW: "vetta:metoai:overview",
	SUBSCRIPTION: "vetta:metoai:subscription",
	SITE_CONFIG: "vetta:metoai:site-config",
	TOKENS_LIST: "vetta:metoai:tokens:list",
	TOKENS_CREATE: "vetta:metoai:tokens:create",
	TOKENS_DELETE: "vetta:metoai:tokens:delete",
	TOKENS_SET_STATUS: "vetta:metoai:tokens:set-status",
	TOKENS_KEY: "vetta:metoai:tokens:key",
	MODELS_ENSURE: "vetta:metoai:models:ensure",
} as const;

export function createMetoAiApi(ipc: IpcRenderer): Pick<DesktopApi, "metoai"> {
	return {
		metoai: {
			session: () => ipc.invoke(METOAI_CHANNELS.SESSION),
			overview: () => ipc.invoke(METOAI_CHANNELS.OVERVIEW),
			siteConfig: () => ipc.invoke(METOAI_CHANNELS.SITE_CONFIG),
			authorize: () => ipc.invoke(METOAI_CHANNELS.AUTHORIZE),
			reopenAuthorize: () => ipc.invoke(METOAI_CHANNELS.AUTHORIZE_REOPEN),
			logout: () => ipc.invoke(METOAI_CHANNELS.LOGOUT),
			refresh: () => ipc.invoke(METOAI_CHANNELS.REFRESH),
			onSessionChanged: (handler) =>
				onIpcEvent<MetoAiSessionSnapshot>(ipc, METOAI_CHANNELS.SESSION_CHANGED, handler),
			onAuthorizeRejected: (handler) =>
				onIpcEvent<MetoAiAuthorizeRejection>(ipc, METOAI_CHANNELS.AUTHORIZE_REJECTED, handler),
			subscription: () => ipc.invoke(METOAI_CHANNELS.SUBSCRIPTION),
			tokens: (query) => ipc.invoke(METOAI_CHANNELS.TOKENS_LIST, query),
			createKey: (draft) => ipc.invoke(METOAI_CHANNELS.TOKENS_CREATE, draft),
			deleteKey: (id) => ipc.invoke(METOAI_CHANNELS.TOKENS_DELETE, id),
			setKeyStatus: (id, status) => ipc.invoke(METOAI_CHANNELS.TOKENS_SET_STATUS, id, status),
			key: (id) => ipc.invoke(METOAI_CHANNELS.TOKENS_KEY, id),
			ensureModels: () => ipc.invoke(METOAI_CHANNELS.MODELS_ENSURE),
		},
	};
}
