// @vitest-environment jsdom
/**
 * 首启向导的引导顺序，以及其中的 MetoAI 登录步。
 *
 * 用户看到的第一屏必须是「语言与外观」，点「下一步」才是 MetoAI 登录页
 * （登录页与官网授权页都按当前界面语言呈现，先选语言更合理）。这里用真实 i18n
 * 与真实向导装配走一遍常见流程：选语言 → 登录页（账号授权 / 填 Key）→ 欢迎页，
 * 并确认结束向导后不会立刻被全屏登录引导屏再盖一次。
 */

import type { MetoAiAuthorizeRejection, MetoAiSessionSnapshot } from "@/shared/metoai-types";
import { i18n, initI18n } from "@shared/i18n";
import { MetoAiSessionProvider } from "@shared/hooks/useMetoAiSession";
import { clearMetoAiGateSkipped, markMetoAiGateSkipped } from "@shared/lib/metoai-gate-storage";
import { localModelsConfigAtom, metoaiSessionAtom } from "@shared/store/atoms";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { getDefaultStore } from "jotai";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SETUP_WIZARD_OPEN_EVENT } from "../storage";
import { SetupWizard } from "./SetupWizard";
import { MetoAiGate } from "@domains/metoai/MetoAiGate";

/** 与发布形态一致：lite 构建没有云登录步，MetoAI 步就是向导里的登录入口。 */
vi.mock("@/shared/feature-flags", () => ({ isCloudBuildEnabled: () => false }));

/** 语言与外观两步各有自己的测试；这里只关心步骤顺序，不把主题引擎与主进程拖进来。 */
vi.mock("@shared/hooks/useLanguage", () => ({
	useLanguage: () => ({ language: "zh", languagePreference: "system", setLanguage: vi.fn(async () => undefined) }),
}));
vi.mock("@shared/hooks/useTheme", () => ({
	useTheme: () => ({
		mode: "dark",
		resolved: "dark",
		themeName: "default",
		setMode: vi.fn(),
		setThemeName: vi.fn(),
	}),
}));
vi.mock("@shared/components/BotAvatar", () => ({ BotAvatar: () => null }));

/** 动画不影响步骤切换的语义；真动画在 jsdom 里会让 AnimatePresence 等退出动画。 */
vi.mock("motion/react", () => ({
	AnimatePresence: ({ children }: { children?: ReactNode }) => <>{children}</>,
	LayoutGroup: ({ children }: { children?: ReactNode }) => <>{children}</>,
	motion: {
		div: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
		span: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
	},
}));

/** 模型目录同步会去读主进程；这里只验证「登录 → 落盘 → 刷新目录」这条链路被走到。 */
vi.mock("@shared/store/model-catalog", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@shared/store/model-catalog")>();
	return { ...actual, modelCatalog: { ...actual.modelCatalog, revalidate: vi.fn(async () => undefined) } };
});

const USER = {
	id: 1,
	username: "alice",
	display_name: "Alice",
	quota: 1_000_000,
	used_quota: 0,
	request_count: 0,
};

/** 主进程推送会话变化的入口。 */
let emitSession: (snapshot: MetoAiSessionSnapshot) => void = () => undefined;
let emitAuthorizeRejected: (rejection: MetoAiAuthorizeRejection) => void = () => undefined;

function setupApi() {
	const api = {
		session: vi.fn(async () => ({ ok: true as const, value: { status: "anonymous" as const } })),
		authorize: vi.fn(async () => ({ ok: true as const, value: { status: "started" as const } })),
		reopenAuthorize: vi.fn(async () => ({ ok: true as const, value: undefined })),
		logout: vi.fn(async () => ({ ok: true as const, value: undefined })),
		onSessionChanged: vi.fn((handler: (snapshot: MetoAiSessionSnapshot) => void) => {
			emitSession = handler;
			return () => undefined;
		}),
		onAuthorizeRejected: vi.fn((handler: (rejection: MetoAiAuthorizeRejection) => void) => {
			emitAuthorizeRejected = handler;
			return () => undefined;
		}),
	};
	const models = {
		refreshPresetModels: vi.fn(async () => ({ models: [{ id: "gpt-5" }] })),
		set: vi.fn(async () => undefined),
	};
	const openExternal = vi.fn(async () => undefined);
	(window as unknown as { vetta: unknown }).vetta = {
		metoai: api,
		models,
		shell: { openExternal },
	};
	return { api, models, openExternal };
}

function renderWizard(): void {
	render(
		<MetoAiSessionProvider>
			<SetupWizard />
		</MetoAiSessionProvider>,
	);
}

const store = getDefaultStore();

beforeEach(async () => {
	vi.clearAllMocks();
	localStorage.clear();
	initI18n();
	await i18n.changeLanguage("zh");
	store.set(metoaiSessionAtom, { status: "anonymous" });
	store.set(localModelsConfigAtom, { providers: {} });
});

describe("首启向导的 MetoAI 登录步", () => {
	it("第一屏是「语言与外观」，下一页才是 MetoAI 登录页", async () => {
		setupApi();
		renderWizard();

		expect(screen.getByRole("heading", { name: "语言与外观" })).toBeTruthy();
		expect(screen.queryByRole("heading", { name: "登录 MetoAI" })).toBeNull();

		await userEvent.click(screen.getByRole("button", { name: "下一步" }));

		expect(await screen.findByRole("heading", { name: "登录 MetoAI" })).toBeTruthy();
		expect(screen.getByText("登录可选，点「下一步」继续")).toBeTruthy();
		expect(screen.getByRole("button", { name: "在浏览器中授权登录" })).toBeTruthy();
		expect(screen.queryByRole("heading", { name: "语言与外观" })).toBeNull();
	});

	it("登录页顶部用 MetoAI 自己的品牌标识", async () => {
		setupApi();
		renderWizard();
		await userEvent.click(screen.getByRole("button", { name: "下一步" }));

		// 以前这里渲染的是 provider 图标位（Meta 的商标），不是 MetoAI 的品牌标识。
		const logo = await screen.findByRole("img", { name: "MetoAI" });
		expect(logo.getAttribute("src")).toBe("./metoai-logo.png");
	});

	it("账号授权成功后自动进入下一步", async () => {
		const { api } = setupApi();
		renderWizard();
		await userEvent.click(screen.getByRole("button", { name: "下一步" }));

		await userEvent.click(await screen.findByRole("button", { name: "在浏览器中授权登录" }));
		expect(api.authorize).toHaveBeenCalledOnce();

		await act(async () => {
			emitSession({ status: "authenticated", user: USER, accessExpiresAt: "" });
		});

		expect(await screen.findByRole("heading", { name: "欢迎使用 MetoAI" })).toBeTruthy();
	});

	it("改用 API Key 接入后同样自动进入下一步", async () => {
		const { models } = setupApi();
		renderWizard();
		await userEvent.click(screen.getByRole("button", { name: "下一步" }));

		await userEvent.click(await screen.findByRole("button", { name: "改用 API Key 登录" }));
		await userEvent.type(screen.getByLabelText("API Key"), "sk-metoai-test");
		await userEvent.click(screen.getByRole("button", { name: "保存并进入" }));

		expect(models.refreshPresetModels).toHaveBeenCalledWith("metoai", "sk-metoai-test");
		expect(models.set).toHaveBeenCalledWith(
			expect.objectContaining({
				providers: expect.objectContaining({
					metoai: expect.objectContaining({ apiKey: "sk-metoai-test" }),
				}),
			}),
		);

		// 主进程落盘后 models.json 里只剩 `***`，配置随之变成「已接入」。
		await act(async () => {
			store.set(localModelsConfigAtom, { providers: { metoai: { apiKey: "***" } } });
		});

		expect(await screen.findByRole("heading", { name: "欢迎使用 MetoAI" })).toBeTruthy();
	});

	it("直接跳过登录也能走完向导，且不再被全屏登录引导屏盖回来", async () => {
		setupApi();
		renderWizard();

		await userEvent.click(screen.getByRole("button", { name: "下一步" }));
		await userEvent.click(screen.getByRole("button", { name: "下一步" }));

		expect(await screen.findByRole("heading", { name: "欢迎使用 MetoAI" })).toBeTruthy();

		await userEvent.click(screen.getByRole("button", { name: "开始使用" }));

		expect(screen.queryByRole("heading", { name: "欢迎使用 MetoAI" })).toBeNull();
		// 向导已经给过登录机会，全屏引导屏不该在向导结束后立刻补一次。
		expect(localStorage.getItem("vetta-metoai-gate-skipped")).toBe("1");
	});

	it("向导与全屏引导屏同时挂载时，两处登录面互不串扰", async () => {
		setupApi();
		render(
			<MetoAiSessionProvider>
				{/* 与 RootGlobalOverlays 相同的顺序：引导屏在前，向导在后盖住它 */}
				<MetoAiGate />
				<SetupWizard />
			</MetoAiSessionProvider>,
		);

		await userEvent.click(screen.getByRole("button", { name: "下一步" }));

		// 两处登录面都在 DOM 里，都切到 API Key 方式：标签必须各自指向自己的输入框。
		for (const toggle of await screen.findAllByRole("button", { name: "改用 API Key 登录" })) {
			await userEvent.click(toggle);
		}

		const inputs = screen.getAllByLabelText("API Key");
		expect(inputs).toHaveLength(2);
		expect(inputs[0].id).not.toBe(inputs[1].id);
	});

	it("走完向导后全屏引导屏不会补弹一次", async () => {
		setupApi();
		render(
			<MetoAiSessionProvider>
				{/* 与 RootGlobalOverlays 相同的顺序：引导屏在前，向导在后盖住它 */}
				<MetoAiGate />
				<SetupWizard />
			</MetoAiSessionProvider>,
		);

		// 向导在语言页时引导屏已经挂在下面：同一时刻两处登录面都存在。
		await userEvent.click(screen.getByRole("button", { name: "下一步" }));
		expect(screen.getAllByRole("heading", { name: "登录 MetoAI" })).toHaveLength(2);

		// 不登录直接走完向导：结束向导就等于已经给过登录机会，引导屏必须跟着收起。
		await userEvent.click(screen.getByRole("button", { name: "下一步" }));
		await userEvent.click(await screen.findByRole("button", { name: "开始使用" }));

		expect(screen.queryByRole("heading", { name: "登录 MetoAI" })).toBeNull();
	});

	it("登录后按「上一步」退回登录页时不会被立刻弹回下一步", async () => {
		const { models } = setupApi();
		renderWizard();
		await userEvent.click(screen.getByRole("button", { name: "下一步" }));

		// 用 API Key 接入：本步自动前进到欢迎页。
		await userEvent.click(await screen.findByRole("button", { name: "改用 API Key 登录" }));
		await userEvent.type(screen.getByLabelText("API Key"), "sk-metoai-test");
		await userEvent.click(screen.getByRole("button", { name: "保存并进入" }));
		expect(models.set).toHaveBeenCalled();
		await act(async () => {
			store.set(localModelsConfigAtom, { providers: { metoai: { apiKey: "***" } } });
		});
		expect(await screen.findByRole("heading", { name: "欢迎使用 MetoAI" })).toBeTruthy();

		// 「上一步」是用户的明确意图：已经接入不等于要自动跳过这一步，否则按钮等于失效。
		await userEvent.click(screen.getByRole("button", { name: "上一步" }));

		expect(screen.getByRole("heading", { name: "登录 MetoAI" })).toBeTruthy();
		expect(screen.queryByRole("heading", { name: "欢迎使用 MetoAI" })).toBeNull();
	});

	it("退出登录清掉标记后，引导屏无需重启就重新出现", async () => {
		setupApi();
		markMetoAiGateSkipped();
		render(
			<MetoAiSessionProvider>
				<MetoAiGate />
			</MetoAiSessionProvider>,
		);
		expect(screen.queryByRole("heading", { name: "登录 MetoAI" })).toBeNull();

		// 登出时 useMetoAiSession 会调用它：标记清掉后引导屏要立刻回来，不用重启应用。
		await act(async () => {
			clearMetoAiGateSkipped();
		});

		expect(await screen.findByRole("heading", { name: "登录 MetoAI" })).toBeTruthy();
	});

	it("关掉向导后再从设置里打开，向导仍能正常渲染", async () => {
		setupApi();
		renderWizard();

		// 先走完向导：向导关闭时 SetupWizardView 会提前 return，这一次渲染不调用任何 Hook。
		await userEvent.click(screen.getByRole("button", { name: "下一步" }));
		await userEvent.click(screen.getByRole("button", { name: "下一步" }));
		await userEvent.click(await screen.findByRole("button", { name: "开始使用" }));
		expect(screen.queryByRole("heading", { name: "欢迎使用 MetoAI" })).toBeNull();

		// 设置 → 通用 →「启动App引导」走的是同一个入口；Hook 数量前后必须一致。
		await act(async () => {
			window.dispatchEvent(new Event(SETUP_WIZARD_OPEN_EVENT));
		});

		expect(await screen.findByRole("heading", { name: "语言与外观" })).toBeTruthy();
	});
});
