/**
 * MetaToken 个人中心 · 充值（展示层）。
 *
 * 金额一律是站点的**展示币种**金额：站点自己按 priceRatio / 分组倍率 / 折扣算实付，
 * 所以这里不做任何额度换算，只把用户输入原样交给预结算与下单接口。
 *
 * 收银台关闭不代表支付成功——到账以服务端回调为准，因此文案明确提示用户稍后核对。
 */

import { Button } from "@shared/components/ui/button";
import { Input } from "@shared/components/ui/input";
import { SettingRow, SettingSection, type SettingSectionMeta } from "@vetta-org/theme-ui/settings";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { MetoAiPaymentChannel, MetoAiTopUpRecord } from "@/shared/metoai-types";
/** 充值记录状态 → i18n key。状态码来自服务端契约，不在这里翻译。 */
const RECORD_STATUS_KEYS = {
	success: "topUp.status.success",
	pending: "topUp.status.pending",
	expired: "topUp.status.expired",
} as const;

export interface MetoAiTopUpSectionProps {

	section: SettingSectionMeta;
	methods: MetoAiPaymentChannel[];
	/** 站点预设金额；为空时由用户自己填。 */
	amountOptions: number[];
	loading: boolean;
	error: string | null;
	quoting: boolean;
	paying: boolean;
	/** 最近一次预结算的实付金额；null 表示还没算。 */
	quote: number | null;
	redemptionEnabled: boolean;
	records: MetoAiTopUpRecord[];
	/** 展示币种符号；TOKENS 口径下为空串。 */
	symbol: string;
	onQuote: (amount: number, method: string) => void;
	onPay: (amount: number, method: string) => void;
	onRedeem: (code: string) => Promise<boolean>;
}

export function MetoAiTopUpSection({
	section,
	methods,
	amountOptions,
	loading,
	error,
	quoting,
	paying,
	quote,
	redemptionEnabled,
	records,
	symbol,
	onQuote,
	onPay,
	onRedeem,
}: MetoAiTopUpSectionProps): JSX.Element {
	const { t } = useTranslation("metoai");
	const { t: tSettings } = useTranslation("settings");

	const [amount, setAmount] = useState("");
	const [method, setMethod] = useState<string | null>(null);
	const [code, setCode] = useState("");
	const [redeeming, setRedeeming] = useState(false);

	// 渠道列表异步到达；默认选中第一个，避免用户先点金额才发现没选支付方式。
	useEffect(() => {
		if (methods.length === 0) {
			setMethod(null);
			return;
		}
		setMethod((current) => (current && methods.some((item) => item.method === current) ? current : methods[0].method));
	}, [methods]);

	const selected = methods.find((item) => item.method === method) ?? null;
	const amountValue = Number.parseFloat(amount);
	const amountValid = Number.isFinite(amountValue) && amountValue > 0;
	const belowMinimum = amountValid && selected != null && amountValue < selected.minTopUp;
	const canPay = amountValid && !belowMinimum && selected != null && !paying;

	const changeAmount = (next: string): void => {
		setAmount(next);
		const parsed = Number.parseFloat(next);
		if (Number.isFinite(parsed) && parsed > 0 && method) onQuote(parsed, method);
	};

	const redeem = async (): Promise<void> => {
		const trimmed = code.trim();
		if (!trimmed || redeeming) return;
		setRedeeming(true);
		try {
			const ok = await onRedeem(trimmed);
			if (ok) setCode("");
		} finally {
			setRedeeming(false);
		}
	};

	return (
		<>
			<SettingSection section={section} description={t("topUp.description")}>
				{methods.length === 0 ? (
					<SettingRow title={loading ? tSettings("loading") : t("topUp.noMethods")} border={false}>
						<span />
					</SettingRow>
				) : (
					<>
						<div className="space-y-3 border-b border-border px-5 py-4">
							<div className="space-y-1.5">
								<label htmlFor="metoai-topup-amount" className="text-[12px] font-medium text-foreground">
									{t("topUp.amount")}
								</label>
								<Input
									id="metoai-topup-amount"
									inputMode="decimal"
									value={amount}
									disabled={paying}
									placeholder={t("topUp.amountPlaceholder")}
									onChange={(event) => changeAmount(event.target.value)}
									className="h-8"
								/>
							</div>

							{amountOptions.length > 0 && (
								<div className="flex flex-wrap gap-1.5">
									{amountOptions.map((option) => (
										<button
											key={option}
											type="button"
											onClick={() => changeAmount(String(option))}
											className="rounded-lg border border-border px-2.5 py-1 text-[12px] font-medium text-foreground transition-colors hover:bg-accent"
										>
											{`${symbol}${option}`}
										</button>
									))}
								</div>
							)}

							<div className="space-y-1.5">
								<span className="text-[12px] font-medium text-foreground">{t("topUp.method")}</span>
								<div className="flex flex-wrap gap-1.5">
									{methods.map((item) => (
										<button
											key={item.method}
											type="button"
											onClick={() => {
												setMethod(item.method);
												if (amountValid) onQuote(amountValue, item.method);
											}}
											aria-pressed={item.method === method}
											className={
												item.method === method
													? "rounded-lg border border-primary/50 bg-primary/10 px-2.5 py-1 text-[12px] font-medium text-foreground"
													: "rounded-lg border border-border px-2.5 py-1 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-accent"
											}
										>
											{item.name}
										</button>
									))}
								</div>
							</div>

							{selected && selected.minTopUp > 0 && (
								<p className="text-[11px] text-muted-foreground">
									{t("topUp.minTopUp", { amount: `${symbol}${selected.minTopUp}` })}
								</p>
							)}

							<div className="flex items-center justify-between gap-4">
								<span className="text-[12px] text-muted-foreground">
									{quoting
										? t("topUp.quoting")
										: quote != null
											? t("topUp.payable", { amount: `${symbol}${quote}` })
											: t("topUp.payNote")}
								</span>
								<Button
									variant="primary"
									size="sm"
									disabled={!canPay}
									onClick={() => selected && onPay(amountValue, selected.method)}
								>
									{paying ? t("topUp.paying") : t("topUp.pay")}
								</Button>
							</div>
						</div>
					</>
				)}

				{redemptionEnabled && (
					<div className="space-y-1.5 border-b border-border px-5 py-4">
						<label htmlFor="metoai-topup-code" className="text-[12px] font-medium text-foreground">
							{t("topUp.redemption")}
						</label>
						<div className="flex gap-2">
							<Input
								id="metoai-topup-code"
								value={code}
								disabled={redeeming}
								placeholder={t("topUp.redemptionPlaceholder")}
								onChange={(event) => setCode(event.target.value)}
								onKeyDown={(event) => {
									if (event.key === "Enter") void redeem();
								}}
								className="h-8"
							/>
							<Button
								variant="outline"
								size="sm"
								onClick={() => void redeem()}
								disabled={!code.trim() || redeeming}
								className="shrink-0"
							>
								{redeeming ? t("topUp.redeeming") : t("topUp.redeem")}
							</Button>
						</div>
					</div>
				)}

				{error && <div className="border-t border-border px-5 py-3 text-[12px] text-destructive">{error}</div>}
			</SettingSection>

			<SettingSection section={{ id: `${section.id}-records` }} title={t("topUp.records")}>
				{records.length === 0 ? (
					<SettingRow title={t("topUp.recordsEmpty")} border={false}>
						<span />
					</SettingRow>
				) : (
					records.map((record, index) => (
						<SettingRow
							key={record.id}
							title={t(`topUp.status.${record.status}`)}
							description={new Date(record.create_time * 1000).toLocaleString()}
							border={index < records.length - 1}
						>
							<span className="text-[13px] tabular-nums text-foreground">
								{`${symbol}${record.money}`}
							</span>
						</SettingRow>
					))
				)}
			</SettingSection>
		</>
	);
}
