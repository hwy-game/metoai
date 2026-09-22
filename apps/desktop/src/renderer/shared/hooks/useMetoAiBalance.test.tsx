// @vitest-environment jsdom
/**
 * 侧边栏余额的加载时机、展示与账号隔离。
 *
 * 数据走 `window.vetta.metoai.overview()`（真实 IPC 边界），这里只 mock 这一层，
 * 断言的是用户能观察到的结果：什么时候发请求、界面上拿到的金额是多少、拉取失败会
 * 不会说、登出或换账号后旧账号的余额会不会留在共享原子里。
 */

import type { MetoAiAccountOverview, MetoAiCurrencyConfig, MetoAiIpcResult, MetoAiUser } from "@/shared/metoai-types";
import { act, renderHook, waitFor } from "@testing-library/react";
import { getDefaultStore } from "jotai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { metoaiOverviewAtom, metoaiSessionAtom } from "@shared/store/atoms";
import { useMetoAiBalanceModel } from "./useMetoAiBalance";

// `t` 必须是稳定引用：拉取 effect 依赖它，每次渲染都换新函数会反复重拉。
const { t } = vi.hoisted(() => ({ t: (key: string) => key }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t }) }));

const USER: MetoAiUser = {
	id: 1,
	username: "alice",
	display_name: "Alice",
	quota: 1_000_000,
	used_quota: 500_000,
	request_count: 12,
};

const CURRENCY: MetoAiCurrencyConfig = {
	quotaPerUnit: 500_000,
	displayType: "USD",
	exchangeRate: 1,
	symbol: "$",
	isTokenDisplay: false,
};

/** 1_000_000 额度单位 = $2，已用一半。 */
const OVERVIEW: MetoAiAccountOverview = {
	user: USER,
	siteConfig: { quota_per_unit: 500_000, quota_display_type: "USD" },
	currency: CURRENCY,
};

function ok(value: MetoAiAccountOverview): MetoAiIpcResult<MetoAiAccountOverview> {
	return { ok: true, value };
}

const store = getDefaultStore();

function setupApi(overview: () => Promise<MetoAiIpcResult<MetoAiAccountOverview>>): ReturnType<typeof vi.fn> {
	const spy = vi.fn(overview);
	(window as unknown as { vetta: unknown }).vetta = { metoai: { overview: spy } };
	return spy;
}

/** 当前登录的用户；跨账号用例会换成另一个 id。 */
function signIn(user: MetoAiUser): void {
	store.set(metoaiSessionAtom, { status: "authenticated", user, accessExpiresAt: "" });
}

beforeEach(() => {
	vi.clearAllMocks();
	store.set(metoaiOverviewAtom, null);
	store.set(metoaiSessionAtom, { status: "anonymous" });
});

describe("useMetoAiBalanceModel", () => {
	it("界面没打开时不发请求，也不显示金额", () => {
		signIn(USER);
		const overview = setupApi(async () => ok(OVERVIEW));

		const { result } = renderHook(() => useMetoAiBalanceModel(false));

		expect(overview).not.toHaveBeenCalled();
		expect(result.current).toEqual({ balance: null, used: null, error: null });
	});

	it("打开界面时拉一次，按站点币种规则给出余额与已用", async () => {
		signIn(USER);
		const overview = setupApi(async () => ok(OVERVIEW));

		const { result } = renderHook(() => useMetoAiBalanceModel(true));

		expect(overview).toHaveBeenCalledOnce();
		await waitFor(() => expect(result.current.balance).toBe("$2"));
		expect(result.current.used).toBe("$1");
		expect(result.current.error).toBeNull();
	});

	it("关掉再打开会重拉，充值后的新余额立刻覆盖旧数字", async () => {
		signIn(USER);
		// 原子里是充值前的旧值，站点已经返回充值后的新值。
		store.set(metoaiOverviewAtom, OVERVIEW);
		const overview = setupApi(async () => ok({ ...OVERVIEW, user: { ...USER, quota: 2_000_000 } }));

		const { result, rerender } = renderHook(({ active }: { active: boolean }) => useMetoAiBalanceModel(active), {
			initialProps: { active: true },
		});
		await waitFor(() => expect(result.current.balance).toBe("$4"));

		rerender({ active: false });
		rerender({ active: true });

		expect(overview).toHaveBeenCalledTimes(2);
	});

	it("余额为 0 时显示 $0，而不是未加载的占位符", async () => {
		signIn(USER);
		setupApi(async () => ok({ ...OVERVIEW, user: { ...USER, quota: 0 } }));

		const { result } = renderHook(() => useMetoAiBalanceModel(true));

		await waitFor(() => expect(result.current.balance).toBe("$0"));
	});

	it("拉取失败时给出提示，而不是让旧数字冒充当前余额", async () => {
		signIn(USER);
		setupApi(async () => ({ ok: false, error: { code: "http", message: "站点返回 500", status: 500 } }));

		const { result } = renderHook(() => useMetoAiBalanceModel(true));

		await waitFor(() => expect(result.current.error).toBe("站点返回 500"));
		expect(result.current.balance).toBeNull();
	});

	it("网络类失败退回通用文案", async () => {
		signIn(USER);
		setupApi(async () => ({ ok: false, error: { code: "network", message: "network", status: 0 } }));

		const { result } = renderHook(() => useMetoAiBalanceModel(true));

		await waitFor(() => expect(result.current.error).toBe("account.errorLoad"));
	});

	it("别人账号的概览不会写进原子，界面也不显示", async () => {
		// 会话已经是另一个账号，但站点回来的仍是上一个账号的响应。
		signIn({ ...USER, id: 2, username: "bob", display_name: "Bob" });
		setupApi(async () => ok(OVERVIEW));

		const { result } = renderHook(() => useMetoAiBalanceModel(true));
		await act(async () => undefined);

		expect(store.get(metoaiOverviewAtom)).toBeNull();
		expect(result.current.balance).toBeNull();
	});

	it("登出后迟到的响应不写回原子，避免下一个账号看到上一个的余额", async () => {
		signIn(USER);
		let settle: (result: MetoAiIpcResult<MetoAiAccountOverview>) => void = () => undefined;
		setupApi(
			() =>
				new Promise<MetoAiIpcResult<MetoAiAccountOverview>>((resolve) => {
					settle = resolve;
				}),
		);

		const { rerender } = renderHook(({ active }: { active: boolean }) => useMetoAiBalanceModel(active), {
			initialProps: { active: true },
		});
		// 登出：会话变匿名，调用方随之把 active 置为 false。
		store.set(metoaiSessionAtom, { status: "anonymous" });
		rerender({ active: false });

		await act(async () => {
			settle(ok(OVERVIEW));
		});

		expect(store.get(metoaiOverviewAtom)).toBeNull();
	});
});
