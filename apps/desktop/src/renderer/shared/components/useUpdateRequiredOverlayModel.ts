import type { UpdaterPhase } from "@preload/api";
import { useShortcutScope } from "@shared/shortcuts";
import { updaterStateAtom } from "@shared/store/atoms";
import { useAtomValue } from "jotai";
import { useTranslation } from "react-i18next";

export interface UpdateRequiredOverlayModel {
	readonly title: string;
	readonly reason: string;
	readonly versionLabel?: string;
	readonly releaseNote?: string;
	readonly releaseNotesLabel: string;
	readonly phase: UpdaterPhase;
	/** 0..1；仅 downloading 阶段有值。 */
	readonly progress?: number;
	readonly statusText: string;
	readonly actionLabel?: string;
	readonly onAction?: () => void;
}

/**
 * 强制更新覆盖层的状态：服务端策略要求强制更新时，用户必须先完成更新才能继续使用，
 * 因此覆盖层没有关闭按钮、Esc 与遮罩点击都不生效。
 *
 * 唯一的例外是「要求强制更新、但更新源并没有给出可下载的版本」（`phase === "idle"`）：
 * 那种情况下界面里根本没有出路，硬锁会把用户彻底关在应用外面，所以退回不展示，
 * 只保留侧栏等非阻塞提示——安全阀优先于策略。
 */
export function useUpdateRequiredOverlayModel(): UpdateRequiredOverlayModel | null {
	const { t } = useTranslation("main");
	const state = useAtomValue(updaterStateAtom);

	const active = state.forced === true && state.phase !== "idle";

	// 阻塞式覆盖层：不注册任何关闭绑定，并独占 modal 作用域的键盘（Esc 不生效）。
	useShortcutScope({
		id: "modal:update-required",
		kind: "modal",
		active,
		exclusive: true,
		bindings: [],
	});

	if (!active) return null;

	const progress = state.progress ?? 0;
	const statusText = (() => {
		switch (state.phase) {
			case "idle":
			case "checking":
				return t("updater.forced.checking");
			case "available":
				return t("updater.forced.available");
			case "downloading":
				return t("updater.forced.downloading", { progress: Math.round(progress * 100) });
			case "ready":
				return t("updater.forced.ready");
			case "installing":
				return t("updater.forced.preparing");
			case "error":
				return state.error ?? t("updater.forced.failed");
		}
	})();

	const action = (() => {
		if (state.phase === "available") {
			return { label: t("updater.forced.download"), run: () => void window.vetta.updater.download() };
		}
		if (state.phase === "ready") {
			return { label: t("updater.forced.restart"), run: () => void window.vetta.updater.install() };
		}
		if (state.phase === "error") {
			// 重试直接重走下载：主进程在拿不到待下载版本时会自己重新检查一次。
			return { label: t("updater.forced.retry"), run: () => void window.vetta.updater.download() };
		}
		return null;
	})();

	return {
		title: t("updater.forced.title"),
		reason:
			state.forceReason === "min_supported"
				? t("updater.forced.reasonMinSupported")
				: t("updater.forced.reasonPolicy"),
		versionLabel: state.latestVersion ? t("updater.forced.version", { version: state.latestVersion }) : undefined,
		releaseNote: state.releaseNote,
		releaseNotesLabel: t("updater.forced.releaseNotes"),
		phase: state.phase,
		progress: state.phase === "downloading" ? progress : undefined,
		statusText,
		actionLabel: action?.label,
		onAction: action?.run,
	};
}
