/**
 * 主进程语言 IPC 的边界：renderer（含插件 official.appearance.setLanguage 与设置页）只能写
 * 已知语言偏好，未知码必须被拒而不是落到配置里。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18N_SET_LANGUAGE_CHANNEL, registerI18nIpc } from "./i18n.js";

const ipc = vi.hoisted(() => ({
	handlers: new Map<string, (...args: unknown[]) => unknown>(),
	listeners: new Map<string, (...args: unknown[]) => unknown>(),
}));

const mocks = vi.hoisted(() => ({
	applyLanguagePreference: vi.fn((preference: string) => ({ preference, language: preference })),
	getLanguageState: vi.fn(() => ({ preference: "system", language: "en" })),
	readDesktopConfig: vi.fn(async () => ({
		projects: [],
		archivedProjects: [],
		workspacePath: "C:/workspace",
		defaultExecutionMode: "full-access",
	})),
	writeDesktopConfig: vi.fn(async () => undefined),
	rebuildTrayContextMenu: vi.fn(),
	installApplicationMenu: vi.fn(),
}));

vi.mock("electron", () => ({
	BrowserWindow: { getAllWindows: () => [] },
	ipcMain: {
		on: (channel: string, handler: (...args: unknown[]) => unknown) => ipc.listeners.set(channel, handler),
		handle: (channel: string, handler: (...args: unknown[]) => unknown) => ipc.handlers.set(channel, handler),
		removeHandler: vi.fn(),
		removeListener: vi.fn(),
	},
}));
vi.mock("../i18n/index.js", () => ({
	applyLanguagePreference: mocks.applyLanguagePreference,
	getAppLanguage: () => "en",
	getLanguagePreference: () => "system",
	getLanguageState: mocks.getLanguageState,
}));
vi.mock("../app-menu.js", () => ({ installApplicationMenu: mocks.installApplicationMenu }));
vi.mock("../tray-manager.js", () => ({ rebuildTrayContextMenu: mocks.rebuildTrayContextMenu }));
vi.mock("./fs.js", () => ({
	readDesktopConfig: mocks.readDesktopConfig,
	writeDesktopConfig: mocks.writeDesktopConfig,
}));

function setLanguageHandler(): (...args: unknown[]) => unknown {
	registerI18nIpc();
	const handler = ipc.handlers.get(I18N_SET_LANGUAGE_CHANNEL);
	if (!handler) throw new Error("set-language handler was not registered");
	return handler;
}

describe("i18n set-language IPC", () => {
	beforeEach(() => {
		ipc.handlers.clear();
		ipc.listeners.clear();
		vi.clearAllMocks();
	});

	it.each(["zh", "en", "es", "fr", "id", "vi", "ru", "ja"])(
		"persists %s as a fixed language preference",
		async (language) => {
			const handler = setLanguageHandler();

			await expect(handler({}, language)).resolves.toEqual({ preference: language, language });

			expect(mocks.applyLanguagePreference).toHaveBeenCalledWith(language);
			expect(mocks.writeDesktopConfig).toHaveBeenCalledWith(expect.objectContaining({ language }));
			expect(mocks.rebuildTrayContextMenu).toHaveBeenCalledOnce();
			expect(mocks.installApplicationMenu).toHaveBeenCalledOnce();
		},
	);

	it("rejects an unsupported language without touching the persisted config", async () => {
		const handler = setLanguageHandler();

		await expect(handler({}, "pt")).resolves.toBeUndefined();

		expect(mocks.applyLanguagePreference).not.toHaveBeenCalled();
		expect(mocks.writeDesktopConfig).not.toHaveBeenCalled();
	});

	it("keeps the settings page able to follow the system locale", async () => {
		const handler = setLanguageHandler();

		await expect(handler({}, "system")).resolves.toEqual({ preference: "system", language: "system" });

		expect(mocks.applyLanguagePreference).toHaveBeenCalledWith("system");
	});
});
