---
status: accepted
---

# desktop i18n 从 zh/en 扩到 8 种语言：完整 catalog 而非「先注册后补译」

ADR-0031 定的框架（i18next + 语义 key + main 持有语言 SoT + 静态打包 catalog）这次没有变。变的是语言数量：在 `zh` / `en` 之外新增 `es` / `fr` / `id` / `vi` / `ru` / `ja`。这条 ADR 记的是扩语言时被迫做出的两个决定，以及为什么它们不能靠「以后再说」拖过去。

## 背景

- `fallbackLng=zh` 是 ADR-0031 为「框架先行、en 后填」设的兜底：那时 en 还没译完，缺译只能回退中文。
- `SUPPORTED_LANGUAGES` 当时是 `["zh", "en"]`，`LANGUAGE_PREFERENCES` 硬写成 `["system", "zh", "en"]`，`resolveAppLanguageFromLocale` 只有一条 `zh* → zh`、其余一律 `en`。
- 语言选择器的自称/英文名在两处各自硬编码（外观设置页与引导向导的语言步骤），两处内容还不一致（en 的 alt 一处写 `英文`、一处写 `English`）。

## 决定

- **语言集合单一事实源**：`LANGUAGE_PREFERENCES` 改为 `["system", ...SUPPORTED_LANGUAGES]`，`FIXED_LANGUAGE_OPTIONS`（自称 + 英文名）进 `config.ts`，外观页与引导向导共用它，删掉两处各自的硬编码数组。加语言的改动点收敛成「`SUPPORTED_LANGUAGES` 加一项 + `FIXED_LANGUAGE_OPTIONS` 加一项 + 归一化表加一项 + `resources.ts` 加 13 条 import + 补 `locales/<lang>/*.json`」。
- **locale 归一化按主语言子标签查表**：`zh-CN` / `es-419` / `id-ID` / `in-ID`（印尼语旧码）/ `ja-JP` 等都能落到对应语言，表里没有的语种仍旧落 `DEFAULT_LANGUAGE`（en）。这条决定了「系统语言」选项对新增语言是否可用——不查表就只能永远回退英文。
- **回退链改成 `["en", "zh"]`**（`FALLBACK_LANGUAGES`，替换原来的 `FALLBACK_LANGUAGE = "zh"`）。新增语言的缺译先落英文而不是中文；`zh` 留在链尾只为「绝不暴露原始 key」。en 与 zh 现已全量对齐，正常路径不会走到第二项，所以这对既有 zh/en 用户是无感改动。
- **新增语言必须一次交完整 catalog，不做「先注册、慢慢补译」**：注册了却缺译的语言，用户会看到中英混排，比没有这个语言更糟。落地方式是先从 en 扁平化出 `ns|dotted.key` 的键值表、分片翻译、再按 en 的嵌套结构回填，保证 key 集合逐字节一致。
- **新增 `resources.test.ts` 作为机械门禁**：逐语言逐 ns 断言 key 集合与 en 相同、非空译（en 本就留空的 key 除外）、`{{placeholder}}` 多重集相同。漏 key 是这类改动唯一的系统性风险，靠人工核对 4620 × 6 条不可行。
- **两个独立窗口的文案目录一并补全**：`renderer/quickpanel/i18n.ts`（内联 `quickpanel` ns）与 `renderer/onboarding/i18n.ts`（只装配 `settings` ns）各有自己的 i18next 实例，不走 `resources`。它们此前只装 `zh` / `en`，新语言会静默回退到中文——面板、引导窗与主窗口语言不一致，且不报任何错。两处改为按 `SUPPORTED_LANGUAGES` 全量装配（快捷面板补齐 6 种语言的内联词条），并各自加 `i18n.test.ts` 断言覆盖全部语言。
- **进入对外动作的语言集合同步放宽**：`appearance.set-language` 此前只接受 `"zh" | "en"`，授权卡片还用 `language === "zh" ? 中文 : English` 二选一显示语言名，选到别的语言会显示成「English」。现在 `plugin-sdk` 的语言联合类型与预设的 JSON Schema enum 都放宽到 8 种，卡片改为从 `FIXED_LANGUAGE_OPTIONS` 取语言自称；随之删掉 `manageApproval.appearance.languageZh` / `languageEn` 两个死 key。`system` 只在设置页与首启向导里作为偏好存在，插件动作只接受固定语言。
- **Windows 安装向导的语言集合同步到 8 种**：`apps/desktop/build/installer.iss` 的 `[Languages]` 从「简体中文 + English」扩到 8 项。这一层与应用内 i18n 没有代码关系（走的是 Inno Setup 自己的语言机制），但同样用户可见，不能只扩应用。西班牙语、法语、俄语、日语直接引用 Inno 官方语言包（`compiler:Languages\*.isl`，Inno Setup 6.7.3 自带 29 种）；简体中文、印尼语、越南语官方没有，用仓库自带的 `installer.zh-cn.isl` / `installer.id-id.isl` / `installer.vi-vn.isl`，三者定义同一组 79 条键（3 条 `[LangOptions]` + 73 条 `[Messages]` + 3 条 `[CustomMessages]`），未定义的条目由 Inno 回退到 `Default.isl` 的英文。**同时把 `english` 提到 `[Languages]` 第一项**：Inno 按用户界面语言匹配 `LanguageID`，匹配不到才取第一项（实测：zh-CN 系统 + 只列西/法的语言表会落到第一项）。此前第一项是简体中文，界面语言不属于这 8 种的用户会被中文向导迎接，与应用内「未识别语言 → 英文」的默认不一致。

## 关键取舍

**为什么是「全量对齐 en」而不是「以 zh 为源翻 6 种语言」**：ADR-0031 定的是「zh 为准、en 后填」，但 zh 里存在英文不需要的量词（如 `settings.images` 的「张」在 en 是空串）。以 en 为结构模板、把「en 留空的 key」在其它语言也视为可留空，能同时满足「key 集合一致」和「不强迫译文填无意义的量词」。代价是 zh 与 en 的「语义源」地位在实现上被拉平了——`i18next.d.ts` 的 key 类型增强仍以 zh 为准，语义 key 的所有权没变。

**为什么不做懒加载**：ADR-0031 已否决（打包后 `__dirname` 失效 + 首帧 async 闪）。8 种语言 × 13 ns 全量内联后 bundle 体积明显上升，这是这次扩语言的真实代价；换来的是同步 init、零 fs、不闪。若语言继续增长到需要热加语言，再按 ADR-0031「后续若改变主意」那条引 backend 懒加载。

**插件 catalog 不跟着扩**：插件的 `locales/<lang>.json` 由插件作者提供（ADR-0033），宿主只按当前 locale → 插件 `defaultLocale` → 裸 key 回退。系统预设插件目前只有 `zh` / `en`，选新增语言时这些插件的文案会回退到插件声明的默认语言。这是 ADR-0033 的既定行为，不在本次范围内扩。

## 后果

- 用户在「外观 → 语言」与首启向导里可以选 8 种语言 + 跟随系统；「跟随系统」现在对 `es` / `fr` / `id` / `vi` / `ru` / `ja` 系统同样生效。
- 新增语言的 `settings.json` 等 catalog 里，`languageHint` 一类「列举支持语言」的文案不再逐一点名语言，避免每加一种语言都要回头改 8 个文件。
- `FALLBACK_LANGUAGE` 单数常量被 `FALLBACK_LANGUAGES` 替换，引用点只有 main 与 renderer 两处 i18next init。
- `quickpanel` / `onboarding` 的文案目录与主 catalog 一样必须随语言扩展，两处各有一个 `i18n.test.ts` 拦漏装。
- `appearance.set-language` 现在能切到全部 8 种语言，授权卡片显示语言自称而非「中文 / English」二选一；`manageApproval.appearance.languageZh` / `languageEn` 已从 8 个 `common.json` 中删除。
- Windows 安装与卸载向导支持 8 种语言；安装时选择的语言会写进卸载信息，卸载程序沿用同一个语言。
- 安装包语言文件与应用 catalog 是两套独立机制：应用加语言时，如果该语言不在 Inno 官方语言包里，还要在 `apps/desktop/build/` 另外补一份 `.isl`，否则安装向导会少一项——应用内一切正常，只有安装包缺语言。
- 系统语言不在安装包语言列表里时（如德语、韩语、葡萄牙语）落到英文（第一项），不再落到简体中文。
