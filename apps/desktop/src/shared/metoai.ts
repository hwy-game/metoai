/**
 * MetaToken 中转站相关的共享常量。
 * 主进程(catalog.ts 预设目录)与渲染层(引导屏)共用,避免两处各写一份。
 */
export const METOAI_PRESET_ID = "metoai";
export const METOAI_SITE_URL = "https://api.metotoken.ai";
export const METOAI_BASE_URL = "https://api.metotoken.ai/v1";
export const METOAI_DISPLAY_NAME = "MetaToken";
export const METOAI_ICON = "metaai";
/**
 * 站点 API 前缀。个人中心(登录/余额/Key/充值)走这套接口,
 * 与 /v1 的中转接口不同域:前者是控制台契约,后者是 OpenAI 兼容契约。
 */
export const METOAI_API_BASE = `${METOAI_SITE_URL}/api`;
