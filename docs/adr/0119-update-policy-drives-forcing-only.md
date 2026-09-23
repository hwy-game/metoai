# ADR-0119：更新策略只驱动强制与节奏，安装包仍由 electron-updater feed 交付

## 状态

已被 [ADR-0120](0120-version-detection-from-metotoken.md) 取代：第 1、2、3 条（策略面冻结为三字段、安装包归 feed、`download_url` 只做白名单校验后丢弃）不再成立；第 4 条「强制更新必须 fail-open」与第 5、6 条继续有效。下方内容保留为当时的决策记录。

## 背景

MetaToken 托管 metoai 的版本策略（契约与数据模型见 `metotoken/docs/desktop-update-policy.md`）：管理台登记版本、`policy`（`optional` / `forced`）、`min_supported_version`、`release_note`、`download_url` / `file_name` / `size_bytes` / `sha256` 与灰度比例；客户端匿名请求 `GET /api/desktop/update/check`，拿到 `{ has_update, forced, reason, check_interval_seconds, latest }`。

响应里的 `latest` 描述了「最新版是谁、更新说明是什么、安装包在哪、校验值多少」，文档也把它写成客户端的输入，容易被读成「客户端据此提示、下载并校验」。实际实现里客户端从未消费这些字段：

- `UpdaterService.applyPolicy()`（`apps/desktop/src/main/updater-service.ts:213`）只读 `forced`、`reason`、`check_interval_seconds`。
- `hasUpdate`、`latestVersion`、`releaseNote`、`downloadUrl`、`sha256`、`sizeBytes`、`publishedAt` 在生产代码中没有消费方：`apps/desktop/src/main/update-policy.ts` 解析它们，`downloadUrl` 额外过一次白名单校验后即丢弃（`:137`、`:217`），`latestVersion` 只在解析阶段用于安全阀判定（`:207`，`forced` 必须伴随更高版本）。
- 界面上显示的「最新版本」与更新说明来自 electron-updater feed：`updater-service.ts:174-175`、`:189-190` 取的是 `result.info.version` / `result.info.releaseNote`。
- 下载、增量差分、安装与重启全部由 electron-updater 按 `app-update.yml` 指向的 GitHub Release 完成。

也就是说，**策略决定「必须更新」和「多久查一次」，决定不了「更新到哪个版本、从哪里下、内容是否可信」**。两件事在文档里并列陈述时没有区分，会让运维以为在管理台登记版本与 sha256 就等于接管了发布，也会让后续开发误以为 `downloadUrl` 已是可用输入。

## 决策

1. 客户端消费的更新策略面冻结为三个字段：`forced`、`reason`、`check_interval_seconds`。契约里的其余字段是登记与运维事实，当前不由客户端消费；要新增消费方必须同时更新本 ADR 与 `metotoken/docs/desktop-update-policy.md`。
2. 安装包的版本、来源、校验与安装仍归 electron-updater feed，MetaToken 不承载 feed（不维护 `latest.yml`、blockmap 与多段 Range 代理）。「有没有可下载的新版本」以 feed 为准，策略只能把这次更新从「可选」升级为「强制」。
3. `download_url` 继续只做白名单校验（`https:` + 已知 host），不通过就丢弃；它当前不是下载输入，因此校验失败不影响 `forced` 与 `has_update`。
4. 强制更新必须 fail-open。MetaToken 不可达、超时、响应不合法、`code != 0`，或策略与 feed 不一致（`forced` 为真但 feed 没有更高的可下载版本）时，一律按「没有强制策略」继续运行。覆盖层只在 `state.forced === true && state.phase !== "idle"` 时出现（`apps/desktop/src/renderer/shared/components/useUpdateRequiredOverlayModel.ts:33`），因此策略与 feed 不一致的净效果是**静默不弹窗**：既不锁死用户，也不给出一条永远装不上的强制提示。
5. 为了让管理台登记的版本与 feed 实际交付的版本不脱节，登记动作走 `apps/desktop/scripts/register-update-release.mjs`（按 `(channel, version, platform, arch)` 幂等 upsert），不手抄校验值。该脚本目前是 opt-in，接入发布流水线属于待办，不在本决策范围内。
6. 开发态不注入策略来源：`app.isPackaged` 为假时 `policyProvider` 直接返回 `null`（`apps/desktop/src/main/updater.ts:134`），因此强制更新链路只能在打包产物上验证。

## 备选方案

- **让客户端消费 `latest` 元数据（提示 + 下载 + 校验）**：界面文案、版本号、下载地址与校验值全部以 MetaToken 为源，能一次性消除这处落差。代价是客户端要重做 electron-updater 已经承担的工作：断点续传、差分下载、安装包校验与安装触发，还要处理「策略指向更高版本而 feed 落后」的中间态；并且必须同时引入元数据签名（Ed25519）与下载代理，否则匿名接口就成了可被篡改的更新通道。这是后续可选方向，不是当前契约。
- **让 MetaToken 直接做 electron-updater 的 feed**：客户端改动最小，但要为每个平台维护 `latest.yml`、blockmap 与多段 Range；差分下载在跳转链上失效时，用户侧表现为「更新永远失败」。已在 `metotoken/docs/desktop-update-policy.md` 中否决。
- **只改文档、不改实现**（本决策采纳）：承认现状并写清楚。成本最低、零回归风险，代价是管理台里的版本说明与下载地址目前只是运维记录。
- **删掉契约中未被消费的字段**：契约会更诚实，但会丢掉灰度发布与版本核对所需的事实，而且删除已上线接口的字段属于破坏性变更。

## 后果

- 管理台登记的版本号与 feed 里实际发布的版本不一致时，**客户端以 feed 为准**；管理台设 `forced` 只有在 feed 已提供更高版本时才会生效，否则强制更新不会出现。
- 管理台填写的更新说明不会出现在客户端更新界面，界面显示的是 feed（GitHub Release）里的说明。
- `sha256` / `size_bytes` 目前只作登记与人工核对，不参与客户端校验；安装包自校验仍由 electron-updater 按 `latest.yml` 里的校验值完成。
- 强制更新的唯一可靠触发条件是「feed 有更高版本」与「策略判定 `forced`」同时成立，这条组合必须在打包产物上验证，开发态覆盖不到。
- 一旦要打通下载层（备选方案第一条），前置条件是元数据签名与下载代理，并且需要新的 ADR 记录这次契约变更。
