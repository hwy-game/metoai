/**
 * MetoAI 余额：把账号概览里的额度按站点币种规则格式化，给侧边栏这类只做展示的
 * 小界面使用。
 *
 * 只在 `active` 为真（用户真的打开了这个界面）时拉取，而不是应用启动就拉：概览是
 * 站点接口，没必要为「可能永远不会看余额」的用户先付这笔请求。每次打开都重拉一次，
 * 因为用户充值后第一眼看的就是这里；重拉期间保留上一次的值，界面不会闪。
 *
 * 结果经 `writeMetoAiOverviewAtom` 落库，由它按用户 id 卡住跨账号的迟到响应；
 * `active`（调用方传「打开且已登录」）则负责关掉界面后不再更新状态。
 */

import { currencyFromOverview, formatQuota, unwrapMetoAi } from "@shared/lib/metoai";
import { metoaiOverviewAtom, writeMetoAiOverviewAtom } from "@shared/store/atoms";
import { useAtomValue, useSetAtom } from "jotai";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

export interface MetoAiBalanceModel {
	/** 已按站点币种规则格式化的余额；还没拉到时为 null，界面显示占位符。 */
	balance: string | null;
	used: string | null;
	/** 已翻译的拉取失败提示；null 表示这次没有失败。 */
	error: string | null;
}

export function useMetoAiBalanceModel(active: boolean): MetoAiBalanceModel {
	const { t } = useTranslation("metoai");
	const overview = useAtomValue(metoaiOverviewAtom);
	const writeOverview = useSetAtom(writeMetoAiOverviewAtom);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		if (!active) return;
		let cancelled = false;
		void window.vetta.metoai
			.overview()
			.then((result) => {
				if (cancelled) return;
				writeOverview(unwrapMetoAi(result));
				setError(null);
			})
			.catch((caught: unknown) => {
				if (cancelled) return;
				// 失败要说出来：拉窗里那块金额是用户判断「还够不够用」的依据，
				// 静默失败会让人把上一次的数字当成现在的余额。
				setError(caught instanceof Error && caught.message !== "network" ? caught.message : t("account.errorLoad"));
			});
		return () => {
			cancelled = true;
		};
	}, [active, writeOverview, t]);

	const currency = currencyFromOverview(overview);
	return {
		balance: overview ? formatQuota(overview.user.quota, currency) : null,
		used: overview ? formatQuota(overview.user.used_quota, currency) : null,
		error,
	};
}
