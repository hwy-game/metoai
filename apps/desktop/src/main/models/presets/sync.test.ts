import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	atomicWriteJSON: vi.fn(),
	fetch: vi.fn(),
	getConfig: vi.fn(),
	readFile: vi.fn(),
	replaceConfig: vi.fn(),
	send: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({ readFile: mocks.readFile }));
vi.mock("@vetta/action-rpc", () => ({ getVettaHomePath: () => "C:/test-vetta" }));
vi.mock("@vetta/toolkit/atomic-write", () => ({ atomicWriteJSON: mocks.atomicWriteJSON }));
vi.mock("electron", () => ({
	BrowserWindow: {
		getAllWindows: () => [{ isDestroyed: () => false, webContents: { send: mocks.send } }],
	},
	net: { fetch: mocks.fetch },
}));
vi.mock("../../logger.js", () => ({
	getAppLogger: () => ({ debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() }),
}));
vi.mock("../model-settings-host.js", () => ({
	getDesktopModelSettingsService: () => ({
		getConfig: mocks.getConfig,
		replaceConfig: mocks.replaceConfig,
	}),
}));
vi.mock("./models-dev-snapshot.generated.js", () => ({
	MODELS_DEV_SNAPSHOT: {
		version: 7,
		fetchedAt: "2020-01-01T00:00:00.000Z",
		providers: {},
	},
}));

async function flushBackgroundRefresh(): Promise<void> {
	await new Promise<void>((resolve) => setImmediate(resolve));
	await new Promise<void>((resolve) => setImmediate(resolve));
}

describe("preset catalog background refresh", () => {
	beforeEach(() => {
		vi.resetModules();
		vi.clearAllMocks();
		mocks.readFile.mockRejectedValue(Object.assign(new Error("missing cache"), { code: "ENOENT" }));
		mocks.getConfig.mockResolvedValue({ providers: {} });
	});

	it("在线刷新失败并继续使用随包快照时不广播伪更新", async () => {
		mocks.fetch.mockRejectedValue(new Error("network unavailable"));
		const { listPresetProviders } = await import("./sync.js");

		const initial = await listPresetProviders();
		await flushBackgroundRefresh();
		const duringCooldown = await listPresetProviders();
		await flushBackgroundRefresh();

		expect(initial.catalogSource).toBe("snapshot");
		expect(duringCooldown).toMatchObject({ catalogSource: "snapshot", catalogError: { code: "network" } });
		expect(mocks.fetch).toHaveBeenCalledTimes(1);
		expect(mocks.send).not.toHaveBeenCalled();
	});

	it("在线目录成功替换随包快照时只广播一次更新", async () => {
		mocks.fetch.mockResolvedValue({
			ok: true,
			json: async () => ({
				anthropic: {
					models: {
						"claude-test": { name: "Claude Test", modalities: { output: ["text"] } },
					},
				},
			}),
		});
		const { listPresetProviders } = await import("./sync.js");

		const initial = await listPresetProviders();
		await flushBackgroundRefresh();
		const refreshed = await listPresetProviders();
		await flushBackgroundRefresh();

		expect(initial.catalogSource).toBe("snapshot");
		expect(refreshed.catalogSource).toBe("live");
		expect(mocks.fetch).toHaveBeenCalledTimes(1);
		expect(mocks.send).toHaveBeenCalledOnce();
		expect(mocks.send).toHaveBeenCalledWith("vetta:models:presets-updated");
	});

	it("把已采纳预设的模板字段收敛回目录值", async () => {
		mocks.fetch.mockRejectedValue(new Error("offline"));
		mocks.getConfig.mockResolvedValue({
			providers: {
				// 没有 key：确认收敛不受「有没有填 key」影响（早退之前就要跑）。
				metoai: {
					source: "template",
					templateId: "metoai",
					displayName: "旧名字",
					icon: "metaai",
					api: "openai-completions",
					baseUrl: "https://old.example",
					models: [],
				},
				// 用户自己加的，不该被动。
				custom: {
					source: "custom",
					displayName: "我的",
					icon: "metaai",
					api: "openai-completions",
					baseUrl: "https://mine.example",
					models: [],
				},
			},
		});
		const { syncAdoptedPresets } = await import("./sync.js");

		await syncAdoptedPresets();

		expect(mocks.replaceConfig).toHaveBeenCalledOnce();
		const written = mocks.replaceConfig.mock.calls[0]?.[0] as {
			providers: Record<string, Record<string, unknown>>;
		};
		expect(written.providers.metoai).toMatchObject({
			api: "openai-responses",
			baseUrl: "https://www.metotoken.ai/v1",
			displayName: "MetoAI",
			icon: "metoai",
		});
		expect(written.providers.custom).toMatchObject({
			api: "openai-completions",
			baseUrl: "https://mine.example",
			displayName: "我的",
		});
	});
});
