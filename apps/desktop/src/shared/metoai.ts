/**
 * MetaToken 中转站相关的共享常量。
 * 主进程(catalog.ts 预设目录)与渲染层(引导屏/能力市场)共用,避免两处各写一份。
 *
 * 站点地址可用 `VETTA_METOAI_SITE_URL` 覆盖(构建期开关,见 .env.example)：
 * 本地联调指向 `http://localhost:3000` 就能直接读本地 metotoken 的市场与账号数据。
 * 主进程由 vite.main.config.ts 内联全部 `VETTA_*`,渲染层由 vite.config.ts 显式 define,
 * 两边默认值都落到下面这个常量,保证不漂移。
 */
export const METOAI_PRESET_ID = "metoai";

/** 线上站点。未设 `VETTA_METOAI_SITE_URL` 时的默认值。 */
const METOAI_DEFAULT_SITE_URL = "https://api.metotoken.ai";

/** 覆盖值去掉尾部斜杠,避免拼出 `//api` 这种前缀。 */
export const METOAI_SITE_URL =
	(process.env.VETTA_METOAI_SITE_URL ?? "").trim().replace(/\/+$/, "") || METOAI_DEFAULT_SITE_URL;

export const METOAI_BASE_URL = `${METOAI_SITE_URL}/v1`;
export const METOAI_DISPLAY_NAME = "MetaToken";
export const METOAI_ICON = "metaai";
/**
 * 品牌标识（renderer 资产，相对 renderer 根目录，见 `src/renderer/public/`）。
 * 引导屏与首启向导的登录页共用；`METOAI_ICON` 是 provider 图标位，指向 Meta 的商标，
 * 不能拿它当 MetaToken 的品牌标识。
 */
export const METOAI_LOGO_SRC = "./metoai-logo.png";
/**
 * 站点 API 前缀。个人中心(登录/余额/Key/充值)与能力市场走这套接口,
 * 与 /v1 的中转接口不同域:前者是控制台契约,后者是 OpenAI 兼容契约。
 */
export const METOAI_API_BASE = `${METOAI_SITE_URL}/api`;
