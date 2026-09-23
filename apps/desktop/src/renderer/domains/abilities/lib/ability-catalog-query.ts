import {
	ABILITY_MODULES,
	type AbilityItem,
	type AbilityModule,
	type AbilityModuleCount,
	type AbilityScope,
} from "../types";
import { isMarketAbilityListed } from "./merge-ability-catalogs";

/** 除分页外的全部筛选条件；模块 tab 的计数复用同一套口径。 */
export interface AbilityCatalogFilter {
	scope: AbilityScope;
	keyword?: string;
	category?: string;
	types?: AbilityItem["type"][];
	sourceIds?: string[];
}

export interface AbilityCatalogQuery extends AbilityCatalogFilter {
	page: number;
	pageSize: number;
}

export interface AbilityCatalogPage {
	items: AbilityItem[];
	total: number;
	page: number;
	pageSize: number;
	pageCount: number;
}

/** 只使用不会随安装操作变化的字段排序，避免卡片在操作后跳位。 */
export function compareAbilities(a: AbilityItem, b: AbilityItem): number {
	if (a.downloadCount !== b.downloadCount) return b.downloadCount - a.downloadCount;
	const titleOrder = a.title.localeCompare(b.title);
	return titleOrder || a.id.localeCompare(b.id);
}

function sourceId(item: AbilityItem): string {
	return item.catalogSource.id;
}

/** 是否为通用 Skill（~/.agents/skills 等通用 Agent 技能目录）。 */
export function isUniversalSkill(item: AbilityItem): boolean {
	return item.type === "skill" && Boolean(item.skillSource?.startsWith("agents-"));
}

/** 是否为手动安装/本地创建的能力（本地导入的 skill、本地插件包/npm 插件、手动添加的 MCP 服务）。 */
export function isManuallyInstalledAbility(item: AbilityItem): boolean {
	if (!item.installed || item.isBuiltin) return false;
	if (item.isCustom) return true;
	if (item.type === "plugin") {
		return item.plugin?.source === "archive" || item.plugin?.source === "npm";
	}
	if (item.type === "skill") {
		return (
			(item.skillProvenance?.kind === "native" && item.skillProvenance.scope === "custom") ||
			item.skillSource === "user" ||
			item.skillSource === "project"
		);
	}
	if (item.type === "mcp") {
		return !item.fromMarket && item.origin?.kind !== "github-marketplace" && !item.preset;
	}
	return false;
}

/** 「公开」展示已列入市场的条目以及 Vetta 内置能力。 */
export function isAbilityListedInDiscover(item: AbilityItem): boolean {
	return (item.fromMarket && (!item.market || isMarketAbilityListed(item.market))) || item.isBuiltin;
}

/** 「个人」只展示通用 skill 和手动安装的能力。 */
export function isAbilityListedInPersonal(item: AbilityItem): boolean {
	return isUniversalSkill(item) || isManuallyInstalledAbility(item);
}

/**
 * 唯一的筛选实现：列表分页与模块 tab 计数都走这里，避免两处口径漂移
 * （否则 tab 上的数字会和切过去以后看到的条数不一致）。
 */
function filterAbilities(items: AbilityItem[], filter: AbilityCatalogFilter): AbilityItem[] {
	const keyword = filter.keyword?.trim().toLowerCase() ?? "";
	const types = filter.types ? new Set(filter.types) : null;
	const sourceIds = filter.sourceIds ? new Set(filter.sourceIds) : null;
	const isPublic = filter.scope === "discover" || (filter.scope as string) === "public";
	return items
		.filter((item) => (isPublic ? isAbilityListedInDiscover(item) : isAbilityListedInPersonal(item)))
		.filter((item) => !keyword || item.searchTerms.some((term) => term.toLowerCase().includes(keyword)))
		.filter((item) => !filter.category || item.category === filter.category)
		.filter((item) => !types || types.has(item.type))
		.filter((item) => !sourceIds || sourceIds.has(sourceId(item)))
		.sort(compareAbilities);
}

export function queryAbilityCatalog(items: AbilityItem[], query: AbilityCatalogQuery): AbilityCatalogPage {
	const filtered = filterAbilities(items, query);
	const page = Number.isInteger(query.page) && query.page > 0 ? query.page : 1;
	const pageSize = Number.isInteger(query.pageSize) && query.pageSize > 0 ? query.pageSize : 60;
	// 内置能力随 App 分发、数量有限，整组返回不参与分页：它们 downloadCount 为 0 会排在最后，
	// 若按扁平列表切片，「Vetta 内置」分组只会出现零星几条，分组计数也跟着显示成已加载数。
	const builtin = filtered.filter((item) => item.isBuiltin);
	const paged = filtered.filter((item) => !item.isBuiltin);
	const total = filtered.length;
	return {
		items: [...paged.slice((page - 1) * pageSize, page * pageSize), ...builtin],
		total,
		page,
		pageSize,
		pageCount: Math.ceil(paged.length / pageSize),
	};
}

/**
 * 模块 tab 计数：忽略模块与分类筛选，只保留 scope + 搜索词。
 *
 * 每个模块都要出现（含 0），否则 tab 会随数据增删而移位，用户找不到刚才那个模块。
 */
export function countAbilitiesByModule(
	items: AbilityItem[],
	filter: Omit<AbilityCatalogFilter, "types" | "category">,
): AbilityModuleCount[] {
	const filtered = filterAbilities(items, filter);
	return ABILITY_MODULES.map((module) => ({
		module,
		total: filtered.filter((item) => item.type === module).length,
	}));
}

/**
 * 默认模块：数据到达前先落在「技能」，一旦有内容就落在**第一个有条目的模块**，
 * 免得只装了插件的用户打开页面看到一个空模块。用户点过模块 tab 后不再自动改选。
 */
export function pickDefaultModule(counts: AbilityModuleCount[]): AbilityModule {
	return counts.find((entry) => entry.total > 0)?.module ?? ABILITY_MODULES[0];
}
