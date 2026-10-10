import { cn } from "@vetta-org/ui";
import { useTranslation } from "react-i18next";
import { ABILITY_TYPE_ICON, ABILITY_TYPE_LABEL_KEY } from "../lib/ability-presentation";
import type { AbilityModule, AbilityModuleCount } from "../types";

/**
 * 列表一级导航：按能力形态分模块，模块内再按分类分组。
 *
 * 计数来自当前 scope + 搜索词，所以它同时充当「换个模块有没有东西」的线索：
 * 即便当前模块是空的，用户也能从别处的数字找到内容。
 */
export function AbilityModuleTabs({
	modules,
	value,
	onChange,
}: {
	modules: AbilityModuleCount[];
	value: AbilityModule;
	onChange: (module: AbilityModule) => void;
}): JSX.Element {
	const { t } = useTranslation("abilities");

	return (
		<div
			role="tablist"
			aria-label={t("page.title")}
			className="flex flex-wrap items-center gap-0.5 rounded-lg bg-secondary p-0.5"
		>
			{modules.map(({ module, total }) => {
				const active = module === value;
				return (
					<button
						key={module}
						type="button"
						role="tab"
						aria-selected={active}
						onClick={() => onChange(module)}
						className={cn(
							"relative flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1 text-[12px] font-medium transition-colors duration-150",
							active
								? "bg-background text-foreground ring-1 ring-inset ring-primary/30"
								: "text-muted-foreground hover:text-foreground/70",
						)}
					>
						<span className={cn("h-3.5 w-3.5", ABILITY_TYPE_ICON[module])} />
						{t(ABILITY_TYPE_LABEL_KEY[module])}
						<span className={cn("text-[11px] tabular-nums", active ? "text-muted-foreground" : "text-muted-foreground/60")}>
							{total}
						</span>
					</button>
				);
			})}
		</div>
	);
}
