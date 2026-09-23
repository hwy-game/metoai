// 快捷面板独立 i18next 实例（面板窗口走独立 ns、内联自己的文案目录）。语言真相源
// = main 解析结果（config.language 或系统 locale）：preload 经 sendSync 暴露
// window.vettaQuickPanel.initialLanguage，与主窗口同源；navigator 仅作 bridge 缺失时的兜底。
//
// 文案目录必须覆盖 SUPPORTED_LANGUAGES 全部语言：面板不在主窗口的 resources 里，
// 缺一种语言就会回退到中文，面板与主窗口语言不一致。

import i18next from "i18next";
import { initReactI18next, useTranslation } from "react-i18next";
import { type AppLanguage, FALLBACK_LANGUAGES, resolveAppLanguageFromLocale } from "@/shared/i18n/resources";

const QUICK_PANEL_NS = "quickpanel";

export const quickPanelResources = {
	zh: {
		[QUICK_PANEL_NS]: {
			placeholder: "向 Vetta 提问…",
			recentTitle: "最近会话",
			emptyTitle: "暂无最近会话",
			emptyHint: "在上方输入即可开始新对话",
			status: {
				running: "运行中",
				pending: "待答",
			},
			time: {
				now: "刚刚",
				minutes: "{{count}} 分钟",
				hours: "{{count}} 小时",
				days: "{{count}} 天",
				weeks: "{{count}} 周",
				months: "{{count}} 个月",
				years: "{{count}} 年",
			},
		},
	},
	en: {
		[QUICK_PANEL_NS]: {
			placeholder: "Ask Vetta…",
			recentTitle: "Recent",
			emptyTitle: "No recent conversations",
			emptyHint: "Type above to start a new chat",
			status: {
				running: "Running",
				pending: "Awaiting",
			},
			time: {
				now: "just now",
				minutes: "{{count}}m",
				hours: "{{count}}h",
				days: "{{count}}d",
				weeks: "{{count}}w",
				months: "{{count}}mo",
				years: "{{count}}y",
			},
		},
	},
	es: {
		[QUICK_PANEL_NS]: {
			placeholder: "Pregunta a Vetta…",
			recentTitle: "Recientes",
			emptyTitle: "Sin conversaciones recientes",
			emptyHint: "Escribe arriba para iniciar un chat",
			status: {
				running: "En curso",
				pending: "Pendiente",
			},
			time: {
				now: "ahora mismo",
				minutes: "{{count}} min",
				hours: "{{count}} h",
				days: "{{count}} d",
				weeks: "{{count}} sem",
				months: "{{count}} mes",
				years: "{{count}} a",
			},
		},
	},
	fr: {
		[QUICK_PANEL_NS]: {
			placeholder: "Demandez à Vetta…",
			recentTitle: "Récents",
			emptyTitle: "Aucune conversation récente",
			emptyHint: "Saisissez du texte ci-dessus pour démarrer",
			status: {
				running: "En cours",
				pending: "En attente",
			},
			time: {
				now: "à l'instant",
				minutes: "{{count}} min",
				hours: "{{count}} h",
				days: "{{count}} j",
				weeks: "{{count}} sem",
				months: "{{count}} mois",
				years: "{{count}} an",
			},
		},
	},
	id: {
		[QUICK_PANEL_NS]: {
			placeholder: "Tanya Vetta…",
			recentTitle: "Terbaru",
			emptyTitle: "Belum ada percakapan terbaru",
			emptyHint: "Ketik di atas untuk memulai obrolan baru",
			status: {
				running: "Berjalan",
				pending: "Menunggu",
			},
			time: {
				now: "baru saja",
				minutes: "{{count}} mnt",
				hours: "{{count}} j",
				days: "{{count}} hr",
				weeks: "{{count}} mgg",
				months: "{{count}} bln",
				years: "{{count}} thn",
			},
		},
	},
	vi: {
		[QUICK_PANEL_NS]: {
			placeholder: "Hỏi Vetta…",
			recentTitle: "Gần đây",
			emptyTitle: "Chưa có hội thoại gần đây",
			emptyHint: "Nhập ở trên để bắt đầu cuộc trò chuyện mới",
			status: {
				running: "Đang chạy",
				pending: "Đang chờ",
			},
			time: {
				now: "vừa xong",
				minutes: "{{count}} phút",
				hours: "{{count}} giờ",
				days: "{{count}} ngày",
				weeks: "{{count}} tuần",
				months: "{{count}} tháng",
				years: "{{count}} năm",
			},
		},
	},
	ru: {
		[QUICK_PANEL_NS]: {
			placeholder: "Спросите Vetta…",
			recentTitle: "Недавние",
			emptyTitle: "Нет недавних сессий",
			emptyHint: "Введите запрос выше, чтобы начать новый чат",
			status: {
				running: "Выполняется",
				pending: "Ожидает",
			},
			time: {
				now: "только что",
				minutes: "{{count}} мин",
				hours: "{{count}} ч",
				days: "{{count}} д",
				weeks: "{{count}} нед",
				months: "{{count}} мес",
				years: "{{count}} г",
			},
		},
	},
	ja: {
		[QUICK_PANEL_NS]: {
			placeholder: "Vetta に質問…",
			recentTitle: "最近",
			emptyTitle: "最近のセッションはありません",
			emptyHint: "上に入力すると新しい会話を開始できます",
			status: {
				running: "実行中",
				pending: "応答待ち",
			},
			time: {
				now: "たった今",
				minutes: "{{count}} 分",
				hours: "{{count}} 時間",
				days: "{{count}} 日",
				weeks: "{{count}} 週間",
				months: "{{count}} か月",
				years: "{{count}} 年",
			},
		},
	},
} as const;

function detectLanguage(): AppLanguage {
	// 真相源：main 已按 config 或系统 locale 解析（preload sendSync）；缺失时回退 navigator。
	const fromBridge = window.vettaQuickPanel?.initialLanguage;
	return resolveAppLanguageFromLocale(fromBridge ?? navigator.language);
}

/** 跟随 App 语言切换实时刷新；返回取消订阅函数。 */
export function subscribeQuickPanelLanguage(): () => void {
	const bridge = window.vettaQuickPanel;
	if (!bridge?.onLanguageChanged) return () => {};
	return bridge.onLanguageChanged((lang) => {
		const next = resolveAppLanguageFromLocale(lang);
		void i18n.changeLanguage(next);
		document.documentElement.lang = next;
	});
}

export const i18n = i18next.createInstance();

/** 在 React 挂载前同步调用。资源内联、同步装载，init 返回即就绪、首帧不闪。 */
export function initQuickPanelI18n(): void {
	if (i18n.isInitialized) return;
	const lng = detectLanguage();
	void i18n.use(initReactI18next).init({
		resources: quickPanelResources,
		lng,
		fallbackLng: [...FALLBACK_LANGUAGES],
		ns: [QUICK_PANEL_NS],
		defaultNS: QUICK_PANEL_NS,
		initAsync: false,
		interpolation: { escapeValue: false },
		returnNull: false,
		react: { useSuspense: false },
	});
	document.documentElement.lang = lng;
}

// 项目对 i18next 做了全局类型增强（只认主窗口的 ns/key），面板用独立 ns 会被判非法 key。
// 这里把 t 收窄成面板自己的签名（双重断言绕过增强，非 any），各组件统一走此 hook。
export type QuickPanelTranslate = (key: string, options?: { count?: number }) => string;

export function useQuickPanelTranslation(): QuickPanelTranslate {
	const { t } = useTranslation();
	return t as unknown as QuickPanelTranslate;
}
