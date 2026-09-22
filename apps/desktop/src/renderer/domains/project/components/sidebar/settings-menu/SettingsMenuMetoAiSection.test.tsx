// @vitest-environment jsdom
import type { MetoAiUser } from "@/shared/metoai-types";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SettingsMenuMetoAiSection } from "./SettingsMenuMetoAiSection";
import type { SettingsMenuMetoAiModel } from "./types";

const { t } = vi.hoisted(() => ({ t: (key: string) => key }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t }) }));

const USER: MetoAiUser = {
	id: 1,
	username: "alice",
	display_name: "Alice",
	email: "alice@example.com",
	quota: 1_000_000,
	used_quota: 100_000,
	request_count: 12,
};

function model(overrides: Partial<SettingsMenuMetoAiModel> = {}): SettingsMenuMetoAiModel {
	return {
		user: null,
		balance: null,
		used: null,
		busy: false,
		error: null,
		phase: "idle",
		actions: {
			login: vi.fn(),
			reopen: vi.fn(),
			cancel: vi.fn(),
			logout: vi.fn(),
		},
		...overrides,
	};
}

describe("SettingsMenuMetoAiSection", () => {
	it("未登录时显示登录按钮，点击后触发授权动作", async () => {
		const current = model();
		render(<SettingsMenuMetoAiSection model={current} />);

		await userEvent.click(screen.getByRole("button", { name: "menu.login" }));

		expect(current.actions.login).toHaveBeenCalledOnce();
		expect(screen.queryByText("Alice")).toBeNull();
	});

	it("已登录时只给一行身份与余额，点击退出触发登出", async () => {
		const current = model({ user: USER, balance: "$2", used: "$0.2" });
		render(<SettingsMenuMetoAiSection model={current} />);

		expect(screen.getByText("Alice")).toBeTruthy();
		expect(screen.getByText("account.balance")).toBeTruthy();
		expect(screen.getByText("$2")).toBeTruthy();
		expect(screen.getByText("account.used")).toBeTruthy();
		expect(screen.getByText("$0.2")).toBeTruthy();
		// 明细（邮箱、请求数）留在设置页，小拉窗里不再重复。
		expect(screen.queryByText("alice@example.com")).toBeNull();

		await userEvent.click(screen.getByRole("button", { name: "menu.logout" }));

		expect(current.actions.logout).toHaveBeenCalledOnce();
	});

	it("昵称为空时身份行回退到用户名", () => {
		render(
			<SettingsMenuMetoAiSection
				model={model({ user: { ...USER, display_name: "  " }, balance: "$2", used: "$0.2" })}
			/>,
		);

		expect(screen.getByText("alice")).toBeTruthy();
	});

	it("余额还没拉到时给出占位符而不是空值", () => {
		render(<SettingsMenuMetoAiSection model={model({ user: USER })} />);

		expect(screen.getAllByText("-")).toHaveLength(2);
	});

	it("余额先到时已用仍是占位符，两个数字各自独立", () => {
		render(<SettingsMenuMetoAiSection model={model({ user: USER, balance: "$2" })} />);

		expect(screen.getByText("$2")).toBeTruthy();
		expect(screen.getAllByText("-")).toHaveLength(1);
	});

	it("登出进行中时按钮显示进度且不可重复触发", async () => {
		const current = model({ user: USER, balance: "$2", used: "$0.2", busy: true });
		render(<SettingsMenuMetoAiSection model={current} />);

		await userEvent.click(screen.getByRole("button", { name: "menu.signingOut" }));

		expect(current.actions.logout).not.toHaveBeenCalled();
	});

	it("等待授权时提供重开与取消，并展示失败提示", async () => {
		const current = model({
			phase: "waiting",
			error: "authorize.errorAccessDenied",
		});
		render(<SettingsMenuMetoAiSection model={current} />);

		expect(screen.getByText("menu.waiting")).toBeTruthy();
		expect(screen.getByText("authorize.errorAccessDenied")).toBeTruthy();
		await userEvent.click(screen.getByRole("button", { name: "menu.reopen" }));
		await userEvent.click(screen.getByRole("button", { name: "menu.cancel" }));

		expect(current.actions.reopen).toHaveBeenCalledOnce();
		expect(current.actions.cancel).toHaveBeenCalledOnce();
	});
});
