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
	/** 非强制提示才给「忽略」；强制更新必须先完成更新。 */
	readonly dismissable: boolean;
	readonly dismissLabel: string;
	readonly onDismiss: () => void;
}

/**
 * 更新提示覆盖层的状态。出现条件有两条：
 *
 * 1. **强制更新**（`forced && hasUpdate`）：用户必须先完成更新才能继续使用，因此没有
 *    关闭按钮、Esc 与遮罩点击都不生效；
 * 2. **服务端登记了更高版本、但本机没有应用内安装通道**（`hasUpdate && !installable`）：
 *    照常提示，但主操作换成「前往下载页」，并且可以忽略——后台登记了新版本就一定让用户
 *    看见，同时不能因为拿不到安装包就把人锁在门外。
 *
 * 用 `hasUpdate` 而不是 `phase !== "idle"`，是因为后者在每次重查的 `checking` 期间会把
 * 上一次的 `forced` 重新当成「有待更新」，表现为弹窗随检查节奏反复出现又消失。
 * `dismissedVersion` 由主进程维护：忽略过的版本不再提示，服务端换了版本会重新提示。
 */
export function useUpdateRequiredOverlayModel(): UpdateRequiredOverlayModel | null {
	const { t } = useTranslation("main");
	const state = useAtomValue(updaterStateAtom);

	const forced = state.forced === true;
	// 没有应用内安装通道：只能引导用户去下载页手动安装。
	const manual = state.hasUpdate === true && state.installable === false;
	const active = state.hasUpdate === true && (forced || manual) && state.dismissedVersion !== state.latestVersion;

	// 只有阻塞式覆盖层才独占 modal 作用域的键盘（Esc 不生效）；可忽略的提示不抢键盘。
	useShortcutScope({
		id: "modal:update-required",
		kind: "modal",
		active: active && forced,
		exclusive: true,
		bindings: [],
	});

	if (!active) return null;

	const progress = state.progress ?? 0;
	const statusText = (() => {
		if (manual) {
			return state.manualDownloadUrl ? t("updater.manual.status") : t("updater.manual.statusNoUrl");
		}
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
		if (manual) {
			const url = state.manualDownloadUrl;
			if (url) {
				return {
					label: t("updater.manual.openDownloadPage"),
					run: () => void window.vetta.shell.openExternal(url),
				};
			}
			// 连下载页都没有（服务端没登记 download_url、构建也没注入官网）：至少让用户能
			// 再查一次——后台补上产物后就会走到真正的下载通道。
			return { label: t("updater.manual.recheck"), run: () => void window.vetta.updater.check() };
		}
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
		title: manual ? t("updater.manual.title") : t("updater.forced.title"),
		reason: manual
			? t("updater.manual.reason")
			: state.forceReason === "min_supported"
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
		dismissable: !forced,
		dismissLabel: t("updater.manual.dismiss"),
		onDismiss: () => void window.vetta.updater.dismiss(),
	};
}
