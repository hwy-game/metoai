// @vitest-environment jsdom
/**
 * MetaToken 个人中心：从设置页进入后的常见流程。
 *
 * 覆盖未登录 → 登录 → 看到余额 / Key / 充值渠道，以及新建 Key、删除前确认、
 * 发起充值这些用户真正会走一遍的连续操作；数据全部走 `window.vetta.metoai`，
 * 因此这里 mock 的是 IPC 边界，组件与 hook 都是真实装配。
 */

import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { getDefaultStore } from "jotai";
import { beforeEach, describe, expect, it, vi } from "vitest";
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

const SITE_CONFIG = { quota_per_unit: 500_000, quota_display_type: "USD", register_enabled: true };
const CURRENCY = {
	quotaPerUnit: 500_000,
	displayType: "USD",
	exchangeRate: 1,
	symbol: "$",
	isTokenDisplay: false,
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
		topUpInfo: vi.fn(async () =>
			ok({
				enable_online_topup: true,
				enable_stripe_topup: false,
				enable_redemption: true,
				pay_methods: [{ name: "支付宝", type: "alipay", min_topup: 1 }],
				min_topup: 1,
				stripe_min_topup: 1,
				amount_options: [10, 50],
				discount: {},
			}),
		),
		topUpRecords: vi.fn(async () => ok({ items: [], total: 0 })),
		quote: vi.fn(async () => ok(10)),
		redeem: vi.fn(async () => ok(500_000)),
		pay: vi.fn(async () => ok({ kind: "redirect", url: "https://pay.example.com" })),
		login: vi.fn(async () => ok({ status: "ok", user: USER })),
		loginTwoFactor: vi.fn(async () => ok({ status: "ok", user: USER })),
		logout: vi.fn(async () => ok(undefined)),
		refresh: vi.fn(async () => ok(true)),
		ensureModels: vi.fn(async () => ok({ ok: true, created: false })),
		onSessionChanged: vi.fn(() => () => {}),
	};
}

type MetoAiApi = ReturnType<typeof baseApi>;

function setupApi(overrides: Partial<MetoAiApi> = {}): MetoAiApi {
	const api = { ...baseApi(), ...overrides };
	(window as unknown as { vetta: unknown }).vetta = {
		metoai: api,
		shell: { openExternal: vi.fn(async () => undefined) },
		models: { get: vi.fn(async () => ({ providers: {} })) },
	};
	return api;
}

/** 已登录的起始状态：设置页是引导屏之外的常驻入口，用户进来时通常已经登录过。 */
function authenticatedApi(overrides: Partial<MetoAiApi> = {}): MetoAiApi {
	return setupApi({
		session: vi.fn(async () => ok({ status: "authenticated", user: USER, accessExpiresAt: "" })),
		...overrides,
	});
}

const store = getDefaultStore();

beforeEach(() => {
	vi.clearAllMocks();
	store.set(metoaiSessionAtom, { status: "anonymous" });
	store.set(localModelsConfigAtom, { providers: {} });
	store.set(confirmDialogAtom, null);
});

describe("MetaToken 个人中心", () => {
	it("未登录时先登录，登录后看到余额、Key 与充值渠道", async () => {
		const api = setupApi();
		render(<MetoAiSettings />);

		await userEvent.type(await screen.findByLabelText("login.username"), "alice");
		await userEvent.type(screen.getByLabelText("login.password"), "s3cret");
		await userEvent.click(screen.getByRole("button", { name: "login.submit" }));

		expect(api.login).toHaveBeenCalledWith({ username: "alice", password: "s3cret" });

		// 余额按站点币种规则展示：1_000_000 额度单位 ÷ 500_000 = $2。
		expect(await screen.findByText("$2")).toBeTruthy();
		expect(await screen.findByText(/sk-abc123/)).toBeTruthy();
		expect(await screen.findByRole("button", { name: "支付宝" })).toBeTruthy();
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
		render(<MetoAiSettings />);

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
		render(<MetoAiSettings />);

		expect(await screen.findByText("account.errorLoad")).toBeTruthy();

		failing = false;
		await userEvent.click(screen.getByRole("button", { name: "account.refresh" }));

		expect(await screen.findByText("$2")).toBeTruthy();
		expect(api.overview).toHaveBeenCalledTimes(2);
	});

	it("删除 Key 先确认，确认后才调用站点删除", async () => {
		const api = authenticatedApi();
		render(<MetoAiSettings />);

		await userEvent.click(await screen.findByRole("button", { name: "keys.delete" }));

		const confirmation = store.get(confirmDialogAtom);
		expect(confirmation?.title).toBe("keys.deleteConfirmTitle");
		expect(api.deleteKey).not.toHaveBeenCalled();

		await act(async () => {
			confirmation?.onConfirm(false);
		});
		expect(api.deleteKey).toHaveBeenCalledWith(TOKEN.id);
	});

	it("填好金额与支付方式后可以支付，也能用兑换码充值", async () => {
		const api = authenticatedApi();
		render(<MetoAiSettings />);

		await userEvent.type(await screen.findByLabelText("topUp.amount"), "20");
		// 输入金额即预结算，实付金额由站点算出。
		expect(api.quote).toHaveBeenLastCalledWith(20, "alipay");

		await userEvent.click(screen.getByRole("button", { name: "topUp.pay" }));
		expect(api.pay).toHaveBeenCalledWith(20, "alipay");

		await userEvent.type(screen.getByLabelText("topUp.redemption"), "CODE-1");
		await userEvent.click(screen.getByRole("button", { name: "topUp.redeem" }));
		expect(api.redeem).toHaveBeenCalledWith("CODE-1");
	});
});
