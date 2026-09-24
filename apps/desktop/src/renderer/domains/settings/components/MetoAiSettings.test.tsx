// @vitest-environment jsdom
/**
 * MetoAI 个人中心：从设置页进入后的常见流程。
 *
 * 覆盖未登录 → 浏览器授权 → 看到余额 / 订阅 / Key，订阅段与官网入口的展示，
 * 以及新建 Key、删除前确认这些用户真正会走一遍的操作；数据全部走
 * `window.vetta.metoai`，因此这里 mock 的是 IPC 边界，组件与 hook 都是真实装配。
 */

import type {
	MetoAiAuthorizeRejection,
	MetoAiIpcResult,
	MetoAiSessionSnapshot,
	MetoAiSubscription,
} from "@/shared/metoai-types";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { getDefaultStore } from "jotai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MetoAiSessionProvider } from "@shared/hooks/useMetoAiSession";
import { confirmDialogAtom, localModelsConfigAtom, metoaiSessionAtom } from "@shared/store/atoms";
import { MetoAiSettings } from "./MetoAiSettings";

// `t` 必须是稳定引用：各 hook 的加载 effect 依赖它，每次渲染都换新函数会反复重拉。
const { t } = vi.hoisted(() => ({ t: (key: string) => key }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t, i18n: { exists: () => true } }) }));

const USER = {
	id: 1,
	username: "alice",
	display_name: "Alice",
	quota: 1_000_000,
	used_quota: 500_000,
	request_count: 12,
};

const TOKEN = {
	id: 7,
	name: "My Laptop",
	key: "abc123",
	status: 1,
	remain_quota: 0,
	used_quota: 0,
	unlimited_quota: true,
	expired_time: -1,
	created_time: 1_700_000_000,
	accessed_time: 0,
	group: "",
	model_limits_enabled: false,
	model_limits: "",
	allow_ips: "",
};

const SITE_CONFIG = { quota_per_unit: 500_000, quota_display_type: "USD" };
const CURRENCY = {
	quotaPerUnit: 500_000,
	displayType: "USD",
	exchangeRate: 1,
	symbol: "$",
	isTokenDisplay: false,
};

/** 一条生效中的订阅：1_000_000 额度单位 = $2，已用一半。 */
const SUBSCRIPTION = {
	id: 3,
	planId: 7,
	planTitle: "Pro 套餐",
	status: "active",
	amountTotal: 1_000_000,
	amountUsed: 500_000,
	startTime: 1_700_000_000,
	endTime: 1_772_000_000,
	nextResetTime: 1_750_000_000,
	autoRenew: true,
};

function ok<T>(value: T): { ok: true; value: T } {
	return { ok: true, value };
}

function baseApi() {
	return {
		session: vi.fn(async () => ok({ status: "anonymous" })),
		siteConfig: vi.fn(async () => ok(SITE_CONFIG)),
		overview: vi.fn(async () => ok({ user: USER, siteConfig: SITE_CONFIG, currency: CURRENCY })),
		tokens: vi.fn(async () => ok({ items: [TOKEN], total: 1, page: 1, page_size: 100 })),
		createKey: vi.fn(async () => ok({ id: 9, key: "sk-newkey" })),
		deleteKey: vi.fn(async () => ok(undefined)),
		setKeyStatus: vi.fn(async () => ok(undefined)),
		key: vi.fn(async () => ok("sk-abc123")),
		subscription: vi.fn(async () => ok([SUBSCRIPTION])),
		authorize: vi.fn(async () => ok({ status: "started" as const })),
		reopenAuthorize: vi.fn(async () => ok(undefined)),
		logout: vi.fn(async () => ok(undefined)),
		refresh: vi.fn(async () => ok(true)),
		ensureModels: vi.fn(async () => ok({ ok: true, created: false })),
		onSessionChanged: vi.fn((handler: (snapshot: MetoAiSessionSnapshot) => void) => {
			emitSession = handler;
			return () => undefined;
		}),
		onAuthorizeRejected: vi.fn((handler: (rejection: MetoAiAuthorizeRejection) => void) => {
			emitAuthorizeRejected = handler;
			return () => undefined;
		}),
	};
}

type MetoAiApi = ReturnType<typeof baseApi>;

/** 主进程推送会话变化与授权拒绝的入口。 */
let emitSession: (snapshot: MetoAiSessionSnapshot) => void = () => undefined;
let emitAuthorizeRejected: (rejection: MetoAiAuthorizeRejection) => void = () => undefined;
let openExternal: ReturnType<typeof vi.fn>;

function setupApi(overrides: Partial<MetoAiApi> = {}): MetoAiApi {
	const api = { ...baseApi(), ...overrides };
	openExternal = vi.fn(async () => undefined);
	(window as unknown as { vetta: unknown }).vetta = {
		metoai: api,
		shell: { openExternal },
		models: { get: vi.fn(async () => ({ providers: {} })) },
	};
	return api;
}

/** 已登录的起始状态：设置页是引导屏之外的常驻入口，用户进来时通常已经登录过。 */
function authenticatedApi(overrides: Partial<MetoAiApi> = {}): MetoAiApi {
	return setupApi({
		session: vi.fn(async () => ok({ status: "authenticated" as const, user: USER, accessExpiresAt: "" })),
		...overrides,
	});
}


function renderSettings(): void {
	render(
		<MetoAiSessionProvider>
			<MetoAiSettings />
		</MetoAiSessionProvider>,
	);
}
const store = getDefaultStore();

beforeEach(() => {
	vi.clearAllMocks();
	store.set(metoaiSessionAtom, { status: "anonymous" });
	store.set(localModelsConfigAtom, { providers: {} });
	store.set(confirmDialogAtom, null);
});

describe("MetoAI 个人中心", () => {
	it("未登录时先授权，登录成功后看到余额、订阅与 Key", async () => {
		const api = setupApi();
		renderSettings();

		await userEvent.click(await screen.findByRole("button", { name: "authorize.submit" }));
		expect(api.authorize).toHaveBeenCalledOnce();

		// 授权页已在浏览器打开：界面切到「等待授权」，并给出重开与取消。
		expect(await screen.findByText("authorize.waitingTitle")).toBeTruthy();
		expect(screen.getByRole("button", { name: "authorize.reopen" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "authorize.cancel" })).toBeTruthy();

		// 浏览器里同意授权后，主进程换码成功并推送会话。
		await act(async () => {
			emitSession({ status: "authenticated", user: USER, accessExpiresAt: "" });
		});

		// 余额按站点币种规则展示：1_000_000 额度单位 ÷ 500_000 = $2。
		expect(await screen.findByText("$2")).toBeTruthy();
		expect(await screen.findByText(/sk-abc123/)).toBeTruthy();
		expect(await screen.findByText("Pro 套餐")).toBeTruthy();
		expect(screen.queryByRole("button", { name: "authorize.submit" })).toBeNull();
	});

	it("授权被拒绝时回到可重试状态并显示原因", async () => {
		setupApi();
		renderSettings();

		await userEvent.click(await screen.findByRole("button", { name: "authorize.submit" }));
		await screen.findByText("authorize.waitingTitle");

		await act(async () => {
			emitAuthorizeRejected({ reason: "access-denied" });
		});

		expect(await screen.findByText("authorize.errorAccessDenied")).toBeTruthy();
		expect(screen.getByRole("button", { name: "authorize.submit" })).toBeTruthy();
	});

	it("订阅段展示套餐、额度用量与到期时间，并能去官网管理", async () => {
		authenticatedApi();
		renderSettings();

		const expiresAt = new Date(SUBSCRIPTION.endTime * 1000).toLocaleDateString();
		const nextResetAt = new Date(SUBSCRIPTION.nextResetTime * 1000).toLocaleDateString();

		expect(
			await screen.findByText(
				`subscription.status.active · subscription.usage $1 / $2 · subscription.expiresAt ${expiresAt} · subscription.nextResetAt ${nextResetAt} · subscription.autoRenewOn`,
			),
		).toBeTruthy();

		await userEvent.click(screen.getByRole("button", { name: "subscription.manage" }));
		expect(openExternal).toHaveBeenCalledWith("https://www.metotoken.ai/subscriptions");
	});

	it("充值、订阅、兑换码、账户资料与用量明细都跳官网对应页面", async () => {
		authenticatedApi();
		renderSettings();

		const buttons = await screen.findAllByRole("button", { name: "webActions.open" });
		for (const button of buttons) await userEvent.click(button);

		expect(openExternal.mock.calls.map((call) => call[0])).toEqual([
			"https://www.metotoken.ai/wallet",
			"https://www.metotoken.ai/subscriptions",
			"https://www.metotoken.ai/redemption-codes",
			"https://www.metotoken.ai/profile",
			"https://www.metotoken.ai/account-usage",
		]);
	});

	it("新建 Key 会写入站点并刷新列表", async () => {
		let items = [TOKEN];
		const api = authenticatedApi({
			tokens: vi.fn(async () => ok({ items, total: items.length, page: 1, page_size: 100 })),
			createKey: vi.fn(async () => {
				items = [...items, { ...TOKEN, id: 9, name: "CI", key: "newkey" }];
				return ok({ id: 9, key: "sk-newkey" });
			}),
		});
		renderSettings();

		await userEvent.click(await screen.findByRole("button", { name: "keys.create" }));
		await userEvent.type(screen.getByLabelText("keys.name"), "CI");
		await userEvent.click(screen.getByRole("button", { name: "keys.confirm" }));

		expect(api.createKey).toHaveBeenCalledWith({ name: "CI", unlimited_quota: true, expired_time: -1 });
		expect(await screen.findByText(/sk-newkey/)).toBeTruthy();
	});

	it("余额加载失败时给出重试入口，重试成功后展示余额", async () => {
		let failing = true;
		const api = authenticatedApi({
			overview: vi.fn(async () => {
				if (failing) return { ok: false as const, error: { code: "network", message: "boom", status: 0 } };
				return ok({ user: USER, siteConfig: SITE_CONFIG, currency: CURRENCY });
			}),
		});
		renderSettings();

		expect(await screen.findByText("account.errorLoad")).toBeTruthy();

		failing = false;
		await userEvent.click(screen.getByRole("button", { name: "account.refresh" }));

		expect(await screen.findByText("$2")).toBeTruthy();
		expect(api.overview).toHaveBeenCalledTimes(2);
	});

	it("删除 Key 先确认，确认后才调用站点删除", async () => {
		const api = authenticatedApi();
		renderSettings();

		await userEvent.click(await screen.findByRole("button", { name: "keys.delete" }));

		const confirmation = store.get(confirmDialogAtom);
		expect(confirmation?.title).toBe("keys.deleteConfirmTitle");
		expect(api.deleteKey).not.toHaveBeenCalled();

		await act(async () => {
			confirmation?.onConfirm(false);
		});
		expect(api.deleteKey).toHaveBeenCalledWith(TOKEN.id);
	});

	it("换码失败时按站点错误码展示 i18n 文案，而不是英文 HTTP 短语", async () => {
		setupApi();
		renderSettings();

		await userEvent.click(await screen.findByRole("button", { name: "authorize.submit" }));
		await screen.findByText("authorize.waitingTitle");

		// 站点失败响应的 message 只是英文状态短语（"Bad Request"），不能当用户文案。
		await act(async () => {
			emitAuthorizeRejected({ reason: "exchange-failed", code: "DESKTOP_AUTH_INVALID_GRANT" });
		});
		expect(await screen.findByText("authorize.errorExchange")).toBeTruthy();
		expect(screen.queryByText("Bad Request")).toBeNull();

		await act(async () => {
			emitAuthorizeRejected({ reason: "exchange-failed", code: "AUTH_SESSION_LIMIT" });
		});
		expect(await screen.findByText("authorize.errorSessionLimit")).toBeTruthy();
	});

	it("订阅拉取失败时显示错误，且不显示「没有订阅」空态", async () => {
		authenticatedApi({
			// 显式声明成 IPC 结果联合：接口一直失败，不需要「先失败后成功」的两段式。
			subscription: vi.fn(
				async (): Promise<MetoAiIpcResult<MetoAiSubscription[]>> => ({
					ok: false,
					error: { code: "network", message: "network", status: 0 },
				}),
			),
		});
		renderSettings();

		expect(await screen.findByText("subscription.errorLoad")).toBeTruthy();
		expect(screen.queryByText("subscription.empty")).toBeNull();
	});

	it("退出登录会清掉「已跳过引导」标记，下次启动重新出现登录入口", async () => {
		// 本地 Key 由主进程在 logout IPC 里清掉（见 main/metoai/logout.test.ts）；
		// 这里验证渲染层补齐的另一半：不再把用户当成已经做过选择。
		const api = authenticatedApi();
		localStorage.setItem("vetta-metoai-gate-skipped", "1");
		renderSettings();

		await userEvent.click(await screen.findByRole("button", { name: "account.signOut" }));

		expect(api.logout).toHaveBeenCalledOnce();
		expect(localStorage.getItem("vetta-metoai-gate-skipped")).toBeNull();
	});

});
