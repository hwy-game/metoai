import { describe, expect, it, vi } from "vitest";

vi.mock("../logger.js", () => ({
	getAppLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), log: vi.fn() }),
}));

const { ensureLoopbackCallbackUrl, registerLoopbackHandler, toDeepLinkUrl } = await import("./loopback-callback.js");

const OAUTH_PATH = "/oauth/callback";

// 回环服务是进程级单例：只有第一次 `ensureLoopbackCallbackUrl` 才会真的 `listen`，
// 因此监听参数的 spy 必须在任何用例跑起来之前就装上。
const net = await import("node:net");
const listenSpy = vi.spyOn(net.Server.prototype, "listen");

describe("loopback 回调服务", () => {
	it("按路径分发查询串，并复用同一个端口", async () => {
		const received: string[] = [];
		registerLoopbackHandler(OAUTH_PATH, (search) => received.push(search.toString()));

		const callbackUrl = await ensureLoopbackCallbackUrl(OAUTH_PATH);
		expect(callbackUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/oauth\/callback$/);
		expect(await ensureLoopbackCallbackUrl(OAUTH_PATH)).toBe(callbackUrl);

		const response = await fetch(`${callbackUrl}?state=s1&access_token=t1&refresh_token=r1`);
		expect(response.status).toBe(200);
		await response.text();

		expect(received).toEqual(["state=s1&access_token=t1&refresh_token=r1"]);
	});

	it("未注册的路径返回 404 且不触发任何处理器", async () => {
		const received: string[] = [];
		registerLoopbackHandler(OAUTH_PATH, (search) => received.push(search.toString()));

		const callbackUrl = await ensureLoopbackCallbackUrl(OAUTH_PATH);
		const origin = new URL(callbackUrl).origin;
		const response = await fetch(`${origin}/favicon.ico`);
		expect(response.status).toBe(404);
		await response.text();

		expect(received).toEqual([]);
	});

	it("回调查询串可以拼回自定义 scheme 的深链", () => {
		expect(toDeepLinkUrl("metoai://metotoken/callback", new URLSearchParams("state=s1"))).toBe(
			"metoai://metotoken/callback?state=s1",
		);
		expect(toDeepLinkUrl("metoai://metotoken/callback", new URLSearchParams())).toBe("metoai://metotoken/callback");
	});
	it("只绑定 127.0.0.1，不监听 0.0.0.0 或 ::", async () => {
		const callbackUrl = await ensureLoopbackCallbackUrl("/metotoken/callback");
		expect(new URL(callbackUrl).hostname).toBe("127.0.0.1");

		// 绑定 0.0.0.0 / :: 会让本机任意网卡上的页面都能打进回调入口。
		const hosts = listenSpy.mock.calls.map((args) => (args as unknown[])[1]);
		expect(hosts).toContain("127.0.0.1");
		expect(hosts.filter((host) => host !== "127.0.0.1")).toEqual([]);
	});
});
