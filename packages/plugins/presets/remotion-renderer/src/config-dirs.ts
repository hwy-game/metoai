/**
 * 品牌改名后的配置目录名。两处落点用的是同一个事实：
 *
 * - `HOST_CONFIG_DIR_NAME`：用户主目录下的数据根（宿主 `getVettaHomePath` 的默认值）。
 * - `PROJECT_CONFIG_DIR_NAME`：项目内的配置目录（与 coding-agent 的 `CONFIG_DIR_NAME` 对齐）。
 *
 * 插件不在宿主进程里，拿不到宿主解析出来的主目录，只能在目标机器上按同一套规则自己判一次：
 * 新目录存在就用它；否则旧目录存在时说明宿主那次整体重命名没成功、仍在用旧目录，这里必须
 * 跟着用旧目录——**绝不能抢先创建新目录**，否则宿主下次启动会误判迁移已完成，用户主目录里
 * 的会话、设置、登录态就整份看起来丢失了；两个都不存在时才用新目录。
 *
 * 求值发生在目标机器上，所以本机与远端各自得到自己的主目录。
 */
export const HOST_CONFIG_DIR_NAME = ".metoai";
export const LEGACY_HOST_CONFIG_DIR_NAME = ".vetta";
/** 项目内数据目录；写入一律用它，旧的 `.vetta` 只作为读取回退。 */
export const PROJECT_CONFIG_DIR_NAME = ".metoai";

export const RESOLVE_HOST_DATA_ROOT_SCRIPT = [
	"const fs=require('fs'),os=require('os'),p=require('path');",
	"const home=os.homedir();",
	`const next=p.join(home,'${HOST_CONFIG_DIR_NAME}');`,
	"if(fs.existsSync(next)){process.stdout.write(next);}",
	"else{",
	`const legacy=p.join(home,'${LEGACY_HOST_CONFIG_DIR_NAME}');`,
	"process.stdout.write(fs.existsSync(legacy)?legacy:next);",
	"}",
].join("");
