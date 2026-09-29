import type { MarketAbility } from "@shared/lib/api";
import { useTranslation } from "react-i18next";

export interface CloudExpertCardProps {
	readonly expert: MarketAbility;
}

export function CloudExpertCard({ expert }: CloudExpertCardProps): JSX.Element {
	const { t } = useTranslation("agent-teams");
	const subcategory = typeof expert.detail.subcategory === "string" ? expert.detail.subcategory : "";
	const categoryLabel = [expert.category, subcategory].filter(Boolean).join(" / ");

	return (
		<article className="rounded-xl border border-border/50 bg-card/40 p-4">
			<div className="flex items-start gap-3">
				<div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-lg text-primary">
					{expert.icon ? <img src={expert.icon} alt="" className="h-8 w-8 rounded-lg object-cover" /> : "✦"}
				</div>
				<div className="min-w-0 flex-1">
					<h3 className="truncate text-[14px] font-semibold text-foreground">{expert.name}</h3>
					<p className="mt-1 line-clamp-2 text-[12px] leading-relaxed text-muted-foreground/80">{expert.description}</p>
					<div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
						{categoryLabel && <span className="rounded-full bg-muted px-2 py-0.5">{categoryLabel}</span>}
						<span className="rounded-full bg-primary/10 px-2 py-0.5 text-primary">{t("center.cloudExpertReadOnly")}</span>
					</div>
				</div>
			</div>
		</article>
	);
}
