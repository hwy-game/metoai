/**
 * 开发模式下的本机回环（loopback）回调服务。
 *
 * 自定义 scheme 在开发模式的 macOS/Linux 上根本走不通：dev 跑的是
 * node_modules 里的 Electron.app（bundle id com.github.Electron，Info.plist
 * 没有 CFBundleURLTypes），LaunchServices 只会把自定义 scheme 派发给声明过该
 * scheme 的 bundle——也就是安装版 /Applications/MetoAI.app。结果是门户回调
 * 拉起了另一个已安装的应用，开发中的实例永远收不到回调。
 * `app.setAsDefaultProtocolClient` 也救不了：macOS 上它只是把 scheme 的默认
 * handler 指向当前 bundle id，且系统拉起 bundle 时不会带上 dist/main/index.js
 * 这个 argv，即便注册成功也只会开出一个空的 Electron 窗口。
 *
 * 所以开发模式改走标准的 loopback 回调：主进程在 127.0.0.1 上监听一个临时
 * 端口，回调地址指向 `http://127.0.0.1:<port><path>`。打包后仍旧走自定义 scheme 深链。
 *
 * 服务本身不认识任何业务，只维护「路径 → 处理器」注册表（云登录与 MetoAI
 * 授权各占一条路径）。放在 `main/` 根目录而不是 `cloud/` 下，是因为 lite 构建
 * （VETTA_CLOUD_ENABLED=false）会把整个 cloud chunk 裁掉，而 MetoAI 授权
 * 在 lite 构建里同样需要 loopback。
 */

import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { getAppLogger } from "./logger.js";

const log = getAppLogger("auth");

/** 收到某条路径的回调查询串后要做的事；由业务侧注册。 */
export type LoopbackCallbackHandler = (search: URLSearchParams) => void;

/** dev-only 页面，仅在开发者本机浏览器一闪而过，不进 i18n。 */
const RESPONSE_HTML = `<!doctype html><meta charset="utf-8"><title>MetoAI</title><body style="font:16px system-ui;padding:48px">Authorized. You can close this window.</body>`;

const handlers = new Map<string, LoopbackCallbackHandler>();
let origin: string | null = null;
let starting: Promise<string> | null = null;

/** 注册某条路径的处理器；同一路径重复注册以最后一次为准。 */
export function registerLoopbackHandler(path: string, handler: LoopbackCallbackHandler): void {
	handlers.set(path, handler);
}

/**
 * 惰性启动回环服务并返回 `http://127.0.0.1:<port><path>`；已启动则复用同一端口。
 * 服务常驻到进程退出（unref，不阻塞退出）。
 */
export async function ensureLoopbackCallbackUrl(path: string): Promise<string> {
	if (origin) return `${origin}${path}`;
	return `${await ensureOrigin()}${path}`;
}

/** 把回调查询串拼回自定义 scheme 的深链形式（`<scheme>://host/path?a=b`）。 */
export function toDeepLinkUrl(base: string, search: URLSearchParams): string {
	const query = search.toString();
	return query ? `${base}?${query}` : base;
}

function ensureOrigin(): Promise<string> {
	if (origin) return Promise.resolve(origin);
	starting ??= start().catch((error: unknown) => {
		starting = null;
		throw error;
	});
	return starting;
}

function start(): Promise<string> {
	return new Promise((resolve, reject) => {
		const server = createServer((req, res) => {
			const requestUrl = new URL(req.url ?? "/", "http://127.0.0.1");
			const handler = handlers.get(requestUrl.pathname);
			if (!handler) {
				res.writeHead(404).end();
				return;
			}
			res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(RESPONSE_HTML);
			handler(requestUrl.searchParams);
		});
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => {
			const { port } = server.address() as AddressInfo;
			origin = `http://127.0.0.1:${port}`;
			server.unref();
			log.info(`开发模式回环回调已就绪：${origin}`);
			resolve(origin);
		});
	});
}
