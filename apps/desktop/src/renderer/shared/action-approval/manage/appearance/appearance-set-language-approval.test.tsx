// @vitest-environment jsdom
/**
 * 界面语言审批卡的回归点：语言标题必须来自语种自称，而不是「非中文即英文」的二选一。
 * 8 种界面语言上线后，旧实现会把 ja / vi / ru … 全部显示成英文，用户看到的是错误的语言名。
 */
import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ActiveActionApproval } from "../../useActionApproval";
import { AppearanceSetLanguageApprovalContent } from "./AppearanceSetLanguageApproval";

const LANGUAGE_AUTONYMS: Array<[string, string]> = [
	["zh", "中文"],
	["en", "English"],
	["es", "Español"],
	["fr", "Français"],
	["id", "Bahasa Indonesia"],
	["vi", "Tiếng Việt"],
	["ru", "Русский"],
	["ja", "日本語"],
];

vi.mock("../useManageApprovalShell", () => ({
	useManageApprovalFrame: () => ({
		Frame: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
		t: (key: string) => key,
		frameLabels: () => ({
			reject: "reject",
			confirm: "confirm",
			responding: "responding",
			permission: "permission",
		}),
	}),
}));

vi.mock("../ApprovalParts", () => ({
	ApprovalTargetCard: ({ title, subtitle }: { title: string; subtitle?: string }) => (
		<div data-testid="approval-target" data-title={title} data-subtitle={subtitle} />
	),
	ApprovalImpactCard: () => <div data-testid="approval-impact" />,
	ApprovalRawFallback: () => <div data-testid="approval-raw" />,
}));

function renderCard(input: unknown): void {
	const approval = {
		request: { approvalId: "approval-1", permission: "appearance.write", input },
		responding: false,
		error: null,
		countdown: { formatted: "00:30", isTimedOut: false, remainingSeconds: 30 },
		approve: vi.fn(),
		reject: vi.fn(),
	} as unknown as ActiveActionApproval;
	render(<AppearanceSetLanguageApprovalContent approval={approval} />);
}

function targetCard(): HTMLElement {
	return screen.getByTestId("approval-target");
}

describe("AppearanceSetLanguageApproval", () => {
	it.each(LANGUAGE_AUTONYMS)("labels %s with its own autonym", (language, autonym) => {
		renderCard({ type: "set-language", language });

		expect(targetCard().getAttribute("data-title")).toBe(autonym);
		// 副标题仍是原始语言码，方便用户/排障对照。
		expect(targetCard().getAttribute("data-subtitle")).toBe(language);
	});

	it("falls back to the raw code instead of inventing a label", () => {
		renderCard({ type: "set-language", language: "pt" });

		expect(targetCard().getAttribute("data-title")).toBe("pt");
	});

	it("renders the raw fallback for inputs that are not a set-language request", () => {
		renderCard({ type: "set", mode: "dark" });

		expect(screen.queryByTestId("approval-target")).toBeNull();
		expect(screen.getByTestId("approval-raw")).toBeTruthy();
	});
});
