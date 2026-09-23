import { resolvedThemeAtom } from "@shared/store/atoms";
import { MarkdownPreviewView } from "@vetta-org/theme-ui/activity";
import { Button } from "@shared/components/ui/button";
import { useAtomValue } from "jotai";
import { useCallback } from "react";
import { createPortal } from "react-dom";
import {
	type UpdateRequiredOverlayModel,
	useUpdateRequiredOverlayModel,
} from "./useUpdateRequiredOverlayModel";

/**
 * 更新说明由 metotoken 后台登记，是 markdown。这里复用活动面板的 markdown 渲染器：
 * 它会把链接点击交给 `shell.openExternal`，避免在弹窗里把整个渲染进程导航走。
 */
function UpdateReleaseNotes({ content }: { readonly content: string }): JSX.Element {
	const theme = useAtomValue(resolvedThemeAtom);
	const onOpenExternal = useCallback((href: string) => {
		void window.vetta.shell.openExternal(href);
	}, []);

	return (
		<div className="[&_.markdown-body]:p-0">
			<MarkdownPreviewView content={content} theme={theme} onOpenExternal={onOpenExternal} />
		</div>
	);
}

/**
 * 阻塞式强制更新覆盖层：没有关闭按钮，Esc 与点击遮罩都不关闭。
 * 用户能做的只有「继续更新」——下载、重启安装，或失败后重试。
 */
function UpdateRequiredOverlayView({
	actionLabel,
	onAction,
	phase,
	progress,
	reason,
	releaseNote,
	releaseNotesLabel,
	statusText,
	title,
	versionLabel,
}: UpdateRequiredOverlayModel): JSX.Element {
	return (
		<div
			className="fixed inset-0 z-[100] flex items-center justify-center bg-background/80"
			data-testid="update-required-overlay"
		>
			<div
				role="alertdialog"
				aria-modal="true"
				aria-labelledby="update-required-title"
				className="w-[420px] max-w-[calc(100vw-2rem)] rounded-xl border border-border bg-popover p-5 shadow-lg"
			>
				<div className="flex items-start gap-2.5">
					<span className="mt-0.5 icon-[solar--download-minimalistic-linear] h-4 w-4 shrink-0 text-primary" />
					<div className="min-w-0">
						<h2 id="update-required-title" className="text-[15px] font-semibold text-foreground">
							{title}
						</h2>
						<p className="mt-1.5 text-[12px] text-muted-foreground">{reason}</p>
					</div>
				</div>

				{versionLabel && <p className="mt-3 text-[13px] font-medium text-foreground">{versionLabel}</p>}

				{releaseNote && (
					<div className="mt-2">
						<p className="text-[11px] font-medium text-muted-foreground">{releaseNotesLabel}</p>
						<div className="mt-1.5 max-h-[40vh] overflow-auto rounded-lg border border-border bg-secondary/50 p-3">
							<UpdateReleaseNotes content={releaseNote} />
						</div>
					</div>
				)}

				{phase === "downloading" && (
					<div
						className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-secondary"
						role="progressbar"
						aria-valuemin={0}
						aria-valuemax={100}
						aria-valuenow={Math.round((progress ?? 0) * 100)}
						data-testid="update-required-progress"
					>
						<div
							className="h-full rounded-full bg-primary"
							style={{ width: `${Math.round((progress ?? 0) * 100)}%` }}
						/>
					</div>
				)}

				<p className="mt-4 text-[12px] text-muted-foreground" data-testid="update-required-status">
					{statusText}
				</p>

				{actionLabel && onAction && (
					<div className="mt-4 flex justify-end">
						<Button variant="primary" size="sm" onClick={onAction} data-testid="update-required-action">
							{actionLabel}
						</Button>
					</div>
				)}
			</div>
		</div>
	);
}

/**
 * 全局挂载点使用的容器：挂到 `document.body`，否则会被 `AppFrame` 的 `isolate`
 * 困在 stacking context 里，压不住 body-portal 出来的 Drawer / Dialog。
 */
export function UpdateRequiredOverlay(): JSX.Element | null {
	const model = useUpdateRequiredOverlayModel();
	if (!model) return null;
	return createPortal(<UpdateRequiredOverlayView {...model} />, document.body);
}
