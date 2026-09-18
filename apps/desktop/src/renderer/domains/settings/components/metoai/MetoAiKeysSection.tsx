/**
 * MetaToken 个人中心 · API Key（展示层）。
 *
 * 完整 Key 只在用户显式点「显示完整 Key」后才向站点换取（该接口有独立限流），
 * 换取结果只留在本组件的局部状态里，不写进全局 atom。
 */

import { Button } from "@shared/components/ui/button";
import { Input } from "@shared/components/ui/input";
import { Switch } from "@shared/components/ui/switch";
import { SettingRow, SettingSection, type SettingSectionMeta } from "@vetta-org/theme-ui/settings";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { MetoAiKeyRow } from "@domains/metoai/hooks/useMetoAiAccount";

export interface MetoAiKeyDraft {
	name: string;
	unlimited: boolean;
	amount: number;
}

export interface MetoAiKeysSectionProps {
	section: SettingSectionMeta;
	rows: MetoAiKeyRow[];
	loading: boolean;
	error: string | null;
	/** 创建/删除/启停进行中时禁用对应操作。 */
	busy: boolean;
	onCreate: (draft: MetoAiKeyDraft) => Promise<boolean>;
	onDelete: (id: number) => void;
	onToggleStatus: (id: number, enabled: boolean) => void;
	/** 换取完整 Key；失败返回 null。 */
	onReveal: (id: number) => Promise<string | null>;
	onCopy: (text: string) => void;
}

export function MetoAiKeysSection({
	section,
	rows,
	loading,
	error,
	busy,
	onCreate,
	onDelete,
	onToggleStatus,
	onReveal,
	onCopy,
}: MetoAiKeysSectionProps): JSX.Element {
	const { t } = useTranslation("metoai");
	const { t: tSettings } = useTranslation("settings");
	const [creating, setCreating] = useState(false);

	return (
		<SettingSection
			section={section}
			description={t("keys.description")}
			// 新建入口放在分区标题旁：有 Key 之后也要能再建一把，不能只靠空状态里的按钮。
			title={
				<div className="flex items-center justify-between">
					<span>{section.title}</span>
					<Button variant="ghost" size="sm" onClick={() => setCreating(true)} disabled={creating}>
						<span className="icon-[mdi--plus] h-3.5 w-3.5" />
						{t("keys.create")}
					</Button>
				</div>
			}
		>
			{rows.length === 0 && (
				<div className="px-5 py-8 text-center text-[12px] text-muted-foreground">
					{loading ? tSettings("loading") : t("keys.empty")}
				</div>
			)}

			{rows.map((row) => (
				<KeyRow
					key={row.id}
					busy={busy}
					onCopy={onCopy}
					onDelete={onDelete}
					onReveal={onReveal}
					onToggleStatus={onToggleStatus}
					row={row}
				/>
			))}

			{creating && (
				<CreateKeyRow
					busy={busy}
					onCancel={() => setCreating(false)}
					onCreate={async (draft) => {
						const ok = await onCreate(draft);
						if (ok) setCreating(false);
						return ok;
					}}
				/>
			)}

			{error && (
				<div className="border-t border-border px-5 py-3 text-[12px] text-destructive">{error}</div>
			)}
		</SettingSection>
	);
}

function KeyRow({
	row,
	busy,
	onDelete,
	onToggleStatus,
	onReveal,
	onCopy,
}: {
	row: MetoAiKeyRow;
	busy: boolean;
	onDelete: (id: number) => void;
	onToggleStatus: (id: number, enabled: boolean) => void;
	onReveal: (id: number) => Promise<string | null>;
	onCopy: (text: string) => void;
}): JSX.Element {
	const { t } = useTranslation("metoai");
	const [fullKey, setFullKey] = useState<string | null>(null);
	const [revealing, setRevealing] = useState(false);
	const [revealError, setRevealError] = useState(false);

	const enabled = row.status === 1;

	const reveal = async (): Promise<void> => {
		if (revealing) return;
		setRevealing(true);
		setRevealError(false);
		try {
			const key = await onReveal(row.id);
			if (key) setFullKey(key);
			else setRevealError(true);
		} finally {
			setRevealing(false);
		}
	};

	const quotaText = row.unlimited ? t("keys.unlimited") : row.quota;
	const expiryText = row.expiry === "never" ? t("keys.never") : row.expiry;

	return (
		<>
			<SettingRow
				title={row.name}
				description={[
					fullKey ?? row.maskedKey,
					t(row.statusLabelKey),
					`${t("keys.quota")} ${quotaText}`,
					`${t("keys.used")} ${row.used}`,
					`${t("keys.expiry")} ${expiryText}`,
					row.group ? `${t("keys.group")} ${row.group}` : "",
				]
					.filter(Boolean)
					.join(" · ")}
			>
				<div className="flex items-center justify-end gap-1.5">
					<Button
						variant="ghost"
						size="sm"
						onClick={() => (fullKey ? onCopy(fullKey) : void reveal())}
						disabled={revealing}
					>
						{revealing ? t("keys.revealing") : fullKey ? t("keys.copy") : t("keys.reveal")}
					</Button>
					<Button
						variant="ghost"
						size="sm"
						onClick={() => onToggleStatus(row.id, !enabled)}
						disabled={busy}
					>
						{enabled ? t("keys.disable") : t("keys.enable")}
					</Button>
					<Button variant="ghost" size="sm" onClick={() => onDelete(row.id)} disabled={busy}>
						{t("keys.delete")}
					</Button>
				</div>
			</SettingRow>

			{revealError && (
				<div className="border-t border-border px-5 py-2 text-[12px] text-destructive">
					{t("keys.revealFailed")}
				</div>
			)}
		</>
	);
}

function CreateKeyRow({
	busy,
	onCreate,
	onCancel,
}: {
	busy: boolean;
	onCreate: (draft: MetoAiKeyDraft) => Promise<boolean>;
	onCancel: () => void;
}): JSX.Element {
	const { t } = useTranslation("metoai");
	const [name, setName] = useState("");
	const [unlimited, setUnlimited] = useState(true);
	const [amount, setAmount] = useState("");
	const [submitting, setSubmitting] = useState(false);

	const amountValue = Number.parseFloat(amount);
	const valid = name.trim().length > 0 && (unlimited || Number.isFinite(amountValue));

	const submit = async (): Promise<void> => {
		if (!valid || submitting) return;
		setSubmitting(true);
		try {
			await onCreate({ name: name.trim(), unlimited, amount: unlimited ? 0 : amountValue });
		} finally {
			setSubmitting(false);
		}
	};

	return (
		<div className="space-y-3 border-t border-border px-5 py-4">
			<div className="space-y-1.5">
				<label htmlFor="metoai-key-name" className="text-[12px] font-medium text-foreground">
					{t("keys.name")}
				</label>
				<Input
					id="metoai-key-name"
					value={name}
					disabled={submitting}
					placeholder={t("keys.namePlaceholder")}
					onChange={(event) => setName(event.target.value)}
					className="h-8"
				/>
			</div>

			<div className="flex items-center justify-between gap-4">
				<span className="text-[12px] font-medium text-foreground">{t("keys.unlimited")}</span>
				<Switch checked={unlimited} onCheckedChange={setUnlimited} disabled={submitting} />
			</div>

			{!unlimited && (
				<div className="space-y-1.5">
					<label htmlFor="metoai-key-quota" className="text-[12px] font-medium text-foreground">
						{t("keys.quota")}
					</label>
					<Input
						id="metoai-key-quota"
						inputMode="decimal"
						value={amount}
						disabled={submitting}
						onChange={(event) => setAmount(event.target.value)}
						className="h-8"
					/>
					<p className="text-[11px] text-muted-foreground">{t("keys.quotaHint")}</p>
				</div>
			)}

			<div className="flex items-center justify-end gap-2">
				<Button variant="ghost" size="sm" onClick={onCancel} disabled={submitting}>
					{t("keys.cancel")}
				</Button>
				<Button variant="primary" size="sm" onClick={() => void submit()} disabled={!valid || submitting || busy}>
					{submitting ? t("keys.creating") : t("keys.confirm")}
				</Button>
			</div>
		</div>
	);
}
