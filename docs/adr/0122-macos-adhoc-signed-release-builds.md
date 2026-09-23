# ADR-0122：macOS 发布构建在没有 Apple 凭据时使用 ad-hoc 签名

## 状态

已接受。保留 [ADR-0003](0003-dmg-repair-helper.md) 的三图标 DMG 版式与「修复已损坏.app」（作为 ad-hoc 模式的兜底），不取代该 ADR。

## 背景

tag `v0.5.61` 的 desktop-release 运行（run id 35839501131 与 35833627465）在矩阵阶段整轮失败，线上一个平台都没发出去：

1. 两个 mac job（`macos-arm64` / `macos-x64`）都在「Configure macOS signing and notarization」这一步 `exit 1`：仓库与后台都没有配置那 6 个 mac Secret，而该步骤把 `REQUIRE_RELEASE_SIGNATURE` 取自 `needs.prepare.outputs.should-publish == 'true'`，tag 构建必然为真，于是「没有凭据」被当成「必须失败」。
2. windows 与 linux 两个 job 构建成功，但 `build` 是矩阵 job，任一腿失败即整个 job 失败 → `publish-r2` 与 `publish-github`（`needs: [prepare, quality, build]`）全部被 skipped。
3. 净效果：唯一能交付的 Windows / Linux 产物也发不出去，用户拿不到任何新版本。

同时 `docs/deploy/apple-code-signing.md` 当时写的是「完全没有这些 Secrets 时，tag 和手动构建都允许生成未签名包」，与实际行为相反，说明「按是否 tag 构建决定是否硬失败」这个判据本身站不住。

## 决策

1. **没有凭据就走 ad-hoc 签名，而不是报错**。electron-builder 26 原生支持 `mac.identity: "-"`（`app-builder-lib/out/mac/MacTargetHelper.js` 对 `-` 构造 `Identity("-", undefined)`）。用户不再看到「已损坏」，改为「未知开发者」，首次打开需要右键→打开，或到「系统设置 → 隐私与安全性 → 仍要打开」放行。
2. **ad-hoc 必须配 `hardenedRuntime: false`**。hardened runtime 默认启用 library validation，会拒绝 Team ID 不同的预签名 Electron framework，应用会启动即失败；`identity: "-"` 下 entitlements 不再生效，因此也不写 entitlements。
3. **签名模式成为单一事实源**：`resolveMacSigningConfig()` 返回 `{ mode: "signed" | "adhoc" | "unsigned" }`（`signed` 另带 `notarize` / `teamId`），构建侧一律按 `mode` 分支。`VETTA_MAC_ADHOC_SIGN=0` 显式退回完全未签名；凭据只配一半仍然报错。
4. **DMG 保留「修复已损坏.app」作兜底**：ad-hoc 消除了「已损坏」，但未公证的包仍可能被 Gatekeeper 拦下，摘掉 `com.apple.quarantine` 依然有效。只有 `signed` 模式回到两图标版式。
5. **tag 构建不再因缺凭据硬失败**，改为把警告写进日志与 `GITHUB_STEP_SUMMARY`。收紧开关改为仓库 / Environment 变量 `MACOS_REQUIRE_SIGNATURE`（步骤内变量名仍叫 `REQUIRE_RELEASE_SIGNATURE`），维护者配好真证书后可以把它设成 `true` 重新收紧。
6. **mac 降级为尽力而为平台**：matrix 的两条 mac 条目带 `bestEffort: true`，job 上 `continue-on-error: ${{ matrix.bestEffort == true }}`，mac 失败显示为红色 job 但不再让整轮发布作废。
7. **新增 `release-gate` job 做确定性放行**：它不看 job 成败，只看产物是否存在——windows 的 `release/latest.yml`、linux 的 `release/latest-linux.yml` 缺失就让 gate 失败（publish 随之被跳过，与改造前一致），任一 `latest-mac-*.yml` 存在才把 `macos` 计入 `built-platforms`。两个 publish job 改为 `needs: [prepare, quality, release-gate]`。
8. **feed 校验按实际产出平台收口**：`verify-update-feed.mjs` 新增 `VETTA_UPDATE_FEED_PLATFORMS`，publish 从 `release-gate.outputs.built-platforms` 传入。这不是放宽校验——列出的平台仍逐个校验元数据版本与产物可达性，只是不再把「mac 缺席」当成失败。

## 备选方案

- **坚持硬失败（维持现状）**：这正是本次线上故障。缺凭据时把整个多平台发布作废，代价与收益完全不成比例，否决。
- **完全未签名（`identity: null`）**：改动最小，但用户看到的是「已损坏」，只能依赖 DMG 里的修复助手，观感与成功率都最差。保留为显式选项（`VETTA_MAC_ADHOC_SIGN=0`），不作为默认。
- **在 CI 里自签证书并导入钥匙串**：自签身份不受 Gatekeeper 信任，用户看到的仍然是「无法验证开发者」，而且会掩盖「凭据缺失」这一事实，否决。
- **用 `afterPack` / `afterSign` 钩子自己调 `codesign -s -`**：electron-builder 在「没有发生签名」时会跳过 `afterSign` 并留下 warn（`out/platformPackager.js`），而 `afterPack` 早于 fuses 改写与嵌套二进制签名，顺序不对。ad-hoc 下我们需要的正是让 electron-builder 自己按 `identity: "-"` 走完整条签名流程，否决。

## 后果

- 没有 Apple 凭据也能发出一轮包含 mac 产物的发布，Windows / Linux 不再被 mac 拖累。
- mac 用户多一次放行操作（右键→打开或系统设置），这是 ad-hoc 签名的固有代价。
- **mac 自动更新不可用**：ad-hoc 签名每次构建都不同，Squirrel.Mac 要求前后版本使用同一 Developer ID 身份才会接受更新，只能手动下载安装包。
- ad-hoc 包无法公证，`spctl` 不会给出 `accepted`；`verify:updates:mac` 在未设 `VETTA_REQUIRE_MAC_SIGNATURE=1` 时会跳过签名校验，构建侧不再断言签名与公证。
- feed 里的 mac 条目可以合法缺失：`merge-mac-update-metadata.mjs` 在没有 `latest-mac-*.yml` 时打印 info 并正常退出，`publish-update-artifacts-r2.mjs` 也不要求 mac 产物。
- 配好真证书后应把 `MACOS_REQUIRE_SIGNATURE=true` 打开，并考虑把 `VETTA_MAC_ADHOC_SIGN` 的默认值翻转为 `0`，让 ad-hoc 变成显式选择。
