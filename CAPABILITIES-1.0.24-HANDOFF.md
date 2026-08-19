# Harness Desktop 1.0.24 能力施工交接

更新时间：2026-08-19

## 1. 施工位置与保护边界

- 能力施工工作树：`D:\DeepSeek-Harness-Desktop\desktop-capabilities-worktree`
- 分支：`feature/desktop-capabilities-v1.0.24`
- 当前改动：全部尚未提交。
- 不要修改官方 DeepSeek Harness 包源码；扩展均通过 Electron 壳、DSH Web Profile 插件和固定 IPC/本机回环服务完成。
- 不要进入或还原其他工作树。尤其是 `D:\DeepSeek-Harness-Desktop\install-workspace-worktree`，其中已出现用户/其他会话的壁纸、Android 和其他并行改动。
- 本批次没有构建或修改 Android APK。

## 2. 与“更新方式重建”会话的合并注意事项

另一个会话正在重建更新方式，因此下列文件极可能发生冲突，必须人工合并，不能整文件覆盖：

- `electron/main.cjs`
- `package.json`
- `package-lock.json`
- `README.md`
- `CHANGELOG.md`
- `release-notes.md`
- `scripts/release-audit.mjs`
- `scripts/verify-static.mjs`

本工作树已把版本临时升级为 `1.0.24`。更新方式会话完成后，应以其新的增量更新实现为基础，再保留本交接中的插件安装、浏览器/记忆/Computer Use 服务启动、IPC、安全门禁和打包文件白名单。

## 3. 今日完成的能力

### 3.1 体积门禁与仓库瘦身

- 新增 `build/artifact-size-budget.json` 和体积审计脚本/测试。
- Windows 运行包只保留 `zh-CN`、`en-US` 两个 Electron locale。
- 清理依赖源码、map、测试、文档以及 node-pty 非 Windows 构建残留。
- 修复 electron-builder 的负向 `win.files` 规则导致整个仓库误打包的问题；不要重新加入负向-only `build.win.files`。
- `package.json` 使用明确顶层 allowlist。
- 旧一轮完整依赖未打包实测：总目录 434.92 MiB，app.asar 106.35 MiB，app.asar.unpacked 26.85 MiB，locales 1.09 MiB/2 文件。新增插件后的最终制品仍需重新审计。

### 3.2 女仆鲸桌宠优化

- 280 张运行时 PNG 帧改为八个无损 WebP 图集和 JSON manifest。
- 运行时图集约 24.93 MiB；开发源姿态约 33.81 MiB。
- 懒加载、最多保留三个已解码图集、空闲时预取。
- 可见 RGBA 像素逐帧精确验证；完全透明像素的不可见 RGB 在测试中规范化。
- 生成脚本直接从紧凑姿态时间线构建，不再保留重复逻辑帧目录。

主要文件：

- `renderer/pet/pet-sprite-rig.js`
- `renderer/pet/pet.js`
- `renderer/pets/maid-whale/atlas/`
- `scripts/build-maid-whale-atlases.mjs`
- `scripts/build-pet-frame-timelines.cjs`
- `pet-sprite-source/maid-whale/`
- `tests/pet-atlas-lossless.test.cjs`

### 3.3 Capability Broker 与存储管理

- 固定动作白名单、启动随机 Token、loopback/source 校验、TTL、队列上限、取消、停止、敏感动作确认和有界脱敏审计。
- 存储清理采用：扫描 → 预览 Token → 用户明确确认 → 执行。
- 永久保护 sessions、attachments、memories、当前 runtime，以及活跃/近期临时项。
- Marketplace 只清理 `marketplace/cache`，不删除设置和根目录。
- 使用 realpath/lstat 防止符号链接逃逸；递归检查临时目录内部最新 mtime。

主要文件：

- `electron/bridge/capability-broker.cjs`
- `electron/bridge/storage-scan-service.cjs`
- `electron/bridge/storage-cleanup-service.cjs`
- `electron/bridge/storage-management-service.cjs`
- `renderer/storage-manager.js`
- `tests/storage-*.test.cjs`

### 3.4 本地跨会话记忆

- 默认关闭；未开启时不建库、不读写。
- Electron/Node 24 内置 `node:sqlite`，FTS5 优先、LIKE 安全回退，无新增数据库依赖。
- CRUD、搜索、有限召回、导出、单条删除、确认后全部删除。
- 密码、API Key、Token、Cookie、Authorization、银行卡、验证码等默认拒绝保存，也可选择脱敏后保存。
- 模型工具 `local_memory` 只有 `status/search`，不能保存、修改、删除或整库读取。
- 模型召回要求用户同时开启本地记忆和“允许模型按需召回”；最多 8 条，每条正文最多 2000 字符。

主要文件：

- `electron/bridge/memory-censor.cjs`
- `electron/bridge/memory-service.cjs`
- `renderer/memory-manager.js`
- `plugins/dsh-desktop-memory-tools/`
- `electron/bridge/desktop-memory-tools-plugin-service.cjs`
- `tests/memory-*.test.cjs`
- `tests/desktop-memory-tools-plugin-service.test.cjs`

### 3.5 Codex 风格右栏浏览器

- Electron `WebContentsView`，右侧栏入口、地址栏、前进/后退/刷新/停止。
- 固定独立持久化分区：`persist:harness-side-browser`，不得与官方 `persist:harness` 共用。
- 用户在真实网页中亲自登录；提供本站登录数据清理和完整独立 Profile 重置。
- 非 HTTP(S) 导航拒绝；浏览器权限默认拒绝。
- 站点授权按 origin、按 read/click/type/upload/download/submit 分权，默认拒绝，TTL 过期和撤销支持。
- 模型只能操作当前可见活动标签；URL 必须公网且 origin 已授权。
- 密码、Cookie、Authorization、Token、验证码、银行卡字段和值永久禁止读取或输入。
- 支付、购买、银行操作永久禁止；提交、发布、删除等动作逐次人工确认。
- 审计只保存 canonical origin 和白名单元数据，不保存页面正文或输入值。

主要文件：

- `electron/bridge/browser-*.cjs`
- `electron/bridge/browser-control-server.cjs`
- `renderer/browser-sidebar.js`
- `plugins/dsh-desktop-browser-tools/`
- `electron/bridge/desktop-browser-tools-plugin-service.cjs`
- `tests/browser-*.test.cjs`
- `tests/desktop-browser-tools-plugin-service.test.cjs`

### 3.6 工作区选择窗口修复

问题：官方 Windows 目录选择器由 DSH 子进程启动，容易藏到后台或难以获得焦点。

修复：

- 新增受支持的 DSH Web Profile 客户端插件，优先级 `-100` 覆盖官方单槽选择器。
- 通过 context-isolated guest preload IPC 调用 Electron 主进程。
- 使用 `dialog.showOpenDialogSync(mainWindow, ...)` 创建由 Harness Desktop 主窗口拥有的原生“选择工作区目录”窗口。
- 不向官方网页暴露任意文件系统能力。

主要文件：

- `plugins/dsh-desktop-directory-picker/`
- `electron/bridge/desktop-directory-picker-plugin-service.cjs`
- `electron/guest-preload.cjs`
- `tests/desktop-directory-picker-plugin-service.test.cjs`

### 3.7 受限 Computer Use

- 每次启动默认关闭。
- 严格限制为 Harness Desktop 自身窗口，不截取或操作其他 Windows 应用。
- 动作：status、screenshot、click、type、scroll、stop。
- click/type/scroll 均要求逐次用户确认，确认绑定动作参数、一次性、60 秒过期。
- 密码、令牌、验证码、银行卡和秘密文本永久禁止输入。
- 截图保存到 `HarnessData/computer-use/screenshots`，返回本地文件路径供已有 `read_image` 能力读取。
- stop 立即清空确认并交还用户。
- 不执行 Shell、脚本或任意系统命令。

发布前建议补充：截图目录数量/年龄清理策略，避免长期使用后积累。

主要文件：

- `plugins/dsh-desktop-computer-use/`
- `electron/bridge/desktop-computer-use-plugin-service.cjs`
- `tests/desktop-computer-use.test.cjs`
- `electron/main.cjs`
- `renderer/browser-sidebar.js`

## 4. DSH Web Profile 第一方插件

当前需要保留并打包为 asarUnpack：

- `plugins/dsh-mobile-control/**/*`
- `plugins/dsh-desktop-directory-picker/**/*`
- `plugins/dsh-desktop-browser-tools/**/*`
- `plugins/dsh-desktop-memory-tools/**/*`
- `plugins/dsh-desktop-computer-use/**/*`

对应 installer service 会复制到：

`DSH_HOME/profiles/web/node_modules/<package>`

并幂等插入 `profiles/web/cordis.patch.yml`。不要直接修改官方 DSH Profile 基线。

## 5. 已完成验证

- 全仓测试：`npm run test:smoke` → **288/288 通过**。
- 静态契约：`node scripts/verify-static.mjs` → 通过（版本 1.0.24）。
- 发布配置：`node scripts/release-audit.mjs` → 通过。
- 依赖：`npm ls --depth=0` → 通过，0 个缺失顶层依赖。
- `git diff --check` → 无 whitespace error，仅有 LF→CRLF 提示。
- 源码 Electron 自检通过：
  - product 1.0.24
  - Electron 43.2.0 / Node 24.18.0
  - rendererEntry、bundledHarness、runtimeWebBoot、nodeRuntime、userData、desktopMarketplace、webCompatibility 全部 true。
- 真实隔离运行验证：
  - 右栏浏览器、独立 Profile、地址栏、Profile 面板通过；
  - browser_control 授权后 observe 成功，撤销后 permission-denied；
  - local_memory 开启召回后命中，关闭后 memory-recall-disabled；
  - Computer Use 默认关闭、窗口截图、逐次确认、敏感输入拒绝、stop 接管通过；
  - 工作区原生窗口可见且 owner 正确指向 Harness Desktop 主窗口。

## 6. 尚未完成/不得直接跳过

用户已明确要求当前会话不要再打包，因为另一个会话正在重建更新方式。

消息到达前，后台 `electron-builder --dir` 恰好已完成，只生成：

- `dist-capabilities/win-unpacked`

它没有生成安装包或便携版，没有上传发布；该目录被忽略，不应直接作为正式发布依据。可在整合后删除并重建。

正式发布前必须由更新方式会话完成以下工作：

1. 把新的增量更新实现与本工作树人工合并。
2. 检查 `electron/main.cjs`、preload、package 和发布脚本冲突。
3. 再次运行 `npm ci`（如 lock 有变化）、`npm run verify`、`node scripts/release-audit.mjs`。
4. 补充 Computer Use 截图清理策略并测试。
5. 重新构建全新 win-unpacked，不复用现有 `dist-capabilities`。
6. 运行 `node scripts/artifact-audit.mjs <新输出目录>`。
7. 运行打包后 self-test；此前旧构建曾出现 300 秒挂起，源码 self-test 已通过，但最终新构建必须重新验证。
8. 构建安装版和便携版，验证覆盖升级、全新安装、卸载保留/删除策略。
9. 生成 SHA256SUMS，并检查安装包、便携版、ASAR、asar.unpacked、locales 和桌宠预算。
10. 更新 `release-manifest.json`。当前文件仍指向 v1.0.23。
11. GitHub 发布 v1.0.24 后再执行固定命令：`npm run release:cnb-cloud`。
12. 验证 CNB 直接下载链接和 SHA-256；不要构建或上传 Android APK。

## 7. 发布资料

- 版本：`1.0.24`
- GitHub 目标 Tag：`v1.0.24`
- 预期 Windows 安装版名：`Harness-Desktop-1.0.24-win-x64.exe`
- 预期 Windows 便携版名：`Harness-Desktop-1.0.24-portable-x64.exe`
- 校验文件：`SHA256SUMS.txt`
- Release notes：`release-notes.md` 已更新为 1.0.24 草稿。
- Changelog：`CHANGELOG.md` 已新增 1.0.24。
- README：下载链接已预置为 v1.0.24；发布前确认实际文件名一致。
- CNB 发布命令：`npm run release:cnb-cloud`
- CNB 安装版直接下载模板：
  `https://cnb.cool/baiyuscc13724-max/deepseek-harness-desktop/-/releases/download/v1.0.24/Harness-Desktop-1.0.24-win-x64.exe`
- CNB 便携版直接下载模板：
  `https://cnb.cool/baiyuscc13724-max/deepseek-harness-desktop/-/releases/download/v1.0.24/Harness-Desktop-1.0.24-portable-x64.exe`

## 8. macOS/iOS 后续边界

当前实际支持矩阵：

- Windows desktop ↔ Android：支持。
- macOS desktop ↔ Android：当前没有已验证 macOS 桌面版，因此未支持。
- Windows desktop ↔ iPhone/iOS：当前没有 iOS App，因此未支持。
- macOS desktop ↔ iOS：当前未支持。

未来配对协议应保持 OS 无关：Windows/macOS desktop 可与 Android/iOS 进行会话同步、附件和通知；设备控制能力必须 capability 协商。iOS 受沙箱/App Store 限制，不能复制 Android 全套控制；macOS Computer Use 需要独立的辅助功能与屏幕录制授权。Apple 组合优先采用 LAN + Tailscale，并为 iOS 后台限制接入 APNs。
