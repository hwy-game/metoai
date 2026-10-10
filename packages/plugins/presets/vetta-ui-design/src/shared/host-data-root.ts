/**
 * 宿主用户主目录下的数据根（品牌改名后是 `~/.metoai`）。
 *
 * 插件的 `fs` 是项目作用域的，写不到主目录，只能自己用 `node` 在目标机器上算一次路径；
 * 而主目录的解析权在宿主手里（见 Desktop 的 `getVettaHomePath`）。插件不在宿主进程里、
 * 拿不到宿主算出来的结果，所以这里按同一套规则自己判一次：
 *
 * - 新目录存在 → 用它（宿主已经迁移完，或本来就在新名字下）。
 * - 新目录不存在、旧目录存在 → 宿主那次整体重命名没成功（跨盘、被占用、权限），它仍在用
 *   旧目录，这里必须跟着用旧目录。**绝不能抢先创建新目录**：宿主下次启动看到新目录已存在，
 *   会直接判定迁移完成，用户主目录里的会话、设置、登录态就整份看起来丢失了。
 * - 两个都不存在 → 用新目录，让宿主按新名字创建。
 *
 * 求值发生在 `cwd` 所属的那台机器上，所以本地与远端各自得到自己的主目录。
 */
export const HOST_CONFIG_DIR_NAME = ".metoai";
export const LEGACY_HOST_CONFIG_DIR_NAME = ".vetta";

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
