# ADR-0120：版本检测与更新弹窗以 metotoken 版本管理为唯一事实源

## 状态

已接受。本决策取代 [ADR-0119](0119-update-policy-drives-forcing-only.md) 的第 1、2、3 条。

## 背景

ADR-0119 把客户端消费的策略面冻结为 `forced` / `reason` / `check_interval_seconds`，安装包的版本、来源、校验与安装全部归 electron-updater feed，并把「让客户端消费 `latest` 元数据」列为后续可选方向，前置条件是元数据签名与下载代理。

这条决策带来了一个可复现的线上故障：管理台登记了一条 `version=1.0.0`、`policy=forced`、但没有任何产物（`download_url` / `file_name` / `sha256` 全空）的记录，任何 0.5.x 客户端都会拿到 `{ has_update: true, forced: true, latest: { version: "1.0.0", ... } }`；而 feed（GitHub Release）里最新只有 0.5.60。用户看到的是「需要更新才能继续使用」弹窗反复出现又消失。根因有三处，互相叠加：

1. `UpdaterService.runCheck()` 先置 `phase: "checking"` 再应用策略，而覆盖层的可见性判据是 `state.forced === true && state.phase !== "idle"`，于是**旧一轮的 `forced` 在检查进行中依然可见**。
2. 无更新分支从不清 `forced`，还照样写入 `latestVersion` / `releaseNote`，界面因此留下一条装不上的提示。
3. `applyPolicy()` 只消费 `forced` / `reason` / `check_interval_seconds`；界面上的「最新版本」与更新说明取的是 feed 的 `result.info.version` / `releaseNote`。**用户被告知要升到某个版本，和实际能装到的版本可以完全不同**，这正是「登记了等于没登记」的来源。

## 决策

1. **单一事实源**：客户端「有没有更新、更新到哪个版本、更新说明是什么、是否强制」只取 metotoken `GET /api/desktop/update/check` 的 `latest`。feed 不再参与版本判定，只负责把安装包送到本地。
2. **交付通道两条，按可用性择优**：
   - 服务端登记了 `download_url`，且引擎能接管宿主自己下载的安装包（当前只有 Windows 的 Inno 版本化布局）→ 客户端按 `download_url` 下载、校验 `sha256`（登记了就必须通过；大小不符或校验不符一律删除文件并报错），再交给引擎走既有安装准备流程；
   - 否则回落 electron-updater feed，但要求 feed 给出的版本**不低于**策略登记的版本。
   两条都不成立 → 按「没有可交付的更新」收口。
3. **fail-open 一条规则**：任何「服务端说强制、却没有任何可交付的更新」的情形（拿不到策略、登记版本不高于本机、没有可用交付通道）统一收敛为**「无更新、不强制」**，并清掉上一次的 `forced` 与版本字段，同时 `console.warn` 记录原因。宁可暂时不提示，也不能把用户锁在一个永远装不上的弹窗里。`policyCheckedAt` 刻意保留——它记录的是「上一次成功拿到策略」的时间，不是本次结果。
4. **弹窗可见性改用显式信号**：`UpdaterState.hasUpdate`（boolean）取代 `phase !== "idle"`，覆盖层判据为 `forced === true && hasUpdate === true`。后台重查期间 `hasUpdate` 与 `forced` 都保持不变，因此不再闪烁。
5. `latest.version` 不高于本机版本时，策略层直接收敛为「无更新、不强制」；`forced` 不再单独决定弹窗。
6. `sha256` 只在归一化后是 64 位十六进制时采用；登记了但不合法则丢弃并记 warn（不因为一个录入错误让整条更新通道装不上——丢弃后的风险与「压根没登记」完全相同）。下载器自身对非法校验值仍然 fail-closed，在发起请求之前就拒绝。
7. 本决策取代 ADR-0119 的第 1、2、3 条（策略面冻结为三字段、安装包归 feed、`download_url` 只做白名单校验后丢弃）。第 4 条「强制更新必须 fail-open」继续有效，只是收口方式从「静默不弹窗」改为「显式收敛为无更新」；第 5、6 条（登记脚本、开发态不注入策略来源）继续有效。

## 已知限制与未完成

- **平台覆盖**：自下载通道目前只在 Windows 的 Inno 版本化布局可用（`canInstallDownloadedPackage()`）。macOS 的 Squirrel.Mac 只安装自己 appcast 里带 sha512 的 ZIP，因此 macOS 仍走 feed 回落。
- **下载地址白名单**：`ALLOWED_DOWNLOAD_HOSTS` 只允许 `releases.openvetta.com` 与 GitHub 的资源域。把安装包放到 R2 或自建域名会被丢弃，从而回落 feed；要接第三方存储必须先扩白名单。
- **元数据签名仍然缺失**：`/api/desktop/update/check` 是匿名接口，响应可被中间人篡改。ADR-0119 指出的前置条件（元数据签名 + 下载代理）本次没有实现，`sha256` 只能防传输损坏，防不了「策略被改指向攻击者的包」——攻击者可以连 `sha256` 一起改。**在把自下载通道当成主通道之前必须补上。**
- **下载层能力缺口**：自下载通道不实现断点续传与差分下载，失败即整包重下。

## 备选方案

- **维持 ADR-0119 的现状（只改文档）**：这正是本次线上故障的成因，否决。
- **让 metotoken 直接做 electron-updater 的 feed**：客户端改动最小，但需要为每个平台维护 `latest.yml`、blockmap 与多段 Range，已在 `metotoken/docs/desktop-update-policy.md` 中否决。
- **自下载通道同时覆盖 macOS**：需要自己实现 appcast 与 sha512 校验，超出本次范围，作为后续方向。
- **先做元数据签名再做单一事实源**：更安全，但线上故障要求立刻止血。本次以「服务端登记值 + 可交付性校验」先解决「弹窗装不上」，签名列为后续必做项。

## 后果

- 管理台登记的版本号与更新说明会真正出现在客户端界面上；feed 里的版本号不再显示。
- 后台误登记（版本不更高、没有产物、非法 `sha256`）不再锁死用户，只在主进程日志里留 warn。
- 客户端每次检查都要请求 metotoken；metotoken 不可达时表现为「没有更新」，与 ADR-0119 的 fail-open 语义一致。
- 发布流程必须同时满足两处：管理台登记（含 `download_url` / `sha256`）与 feed 产物。Windows 上两条都能装；**macOS 上必须保证 feed 里的版本不低于登记版本，否则 macOS 用户收不到更新**。
- 新增「下载 → 校验 → 交给 Inno」这条链路（`apps/desktop/src/main/update-download.ts`），错误信息区分网络失败 / 大小不符 / 校验不符，便于区分「下载坏了」与「装不上」。
- 覆盖层渲染更新说明改走 `MarkdownPreviewView`，外链由既有拦截逻辑交给系统浏览器打开。
