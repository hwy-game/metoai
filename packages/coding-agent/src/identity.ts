/** Stable Coding Agent identity and configuration contract. */
export const PACKAGE_NAME = "@vetta/coding-agent";
export const APP_NAME = "vetta";

// Project-local resources always use the branded directory. VETTA_CONFIG_DIR only changes the home root.
export const CONFIG_DIR_NAME = ".metoai";
/**
 * 品牌改名前的项目内配置目录。只用于**读取回退**：写入一律落 {@link CONFIG_DIR_NAME}，
 * 也绝不重命名用户仓库里已经存在的旧目录。
 */
export const LEGACY_CONFIG_DIR_NAME = ".vetta";
/** 项目内配置目录候选，按读取优先级排列：新目录优先，旧目录回退。 */
export const PROJECT_CONFIG_DIR_NAMES: readonly string[] = [CONFIG_DIR_NAME, LEGACY_CONFIG_DIR_NAME];

export const ENV_AGENT_DIR = `${APP_NAME.toUpperCase()}_CODING_AGENT_DIR`;
export const ENV_PACKAGE_DIR = `${APP_NAME.toUpperCase()}_PACKAGE_DIR`;
export const ENV_SHARE_VIEWER_URL = `${APP_NAME.toUpperCase()}_SHARE_VIEWER_URL`;
export const ENV_SERVER_URL = `${APP_NAME.toUpperCase()}_SERVER_URL`;

/** Default server URL for remote provider/model configs. */
export const DEFAULT_SERVER_URL = "http://127.0.0.1:8080/api/v1";
