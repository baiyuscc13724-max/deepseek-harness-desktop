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
- 模型只能操作当前可用的活动标签；右栏隐藏仅影响预览，普通结构化动作可继续在后台运行；URL 必须公网且 origin 已授权。
- 密码、Cookie、Authorization、Token、验证码、银行卡字段和值永久禁止读取或输入。
- 支付、购买、银行操作永久禁止；上传、下载、提交、发布、删除等关键动作会自动打开右栏并逐次人工确认。
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

### 3.8 消息文字选择与复制修复

- 修复官方工作台选区背景透明、拖选后看不出范围的问题；选区颜色会跟随当前品牌主题并保持 32% 透明度。
- 页面已有选区时，左键点击非输入区域可立即清除，并且不妨碍重新拖选。
- 按 `Esc` 可清除页面选区。
- 右键菜单在有选区时增加“取消选择”，同时保留“复制”和“全选”。
- 不影响 input、textarea、contenteditable 和 textbox 内部选择。
- 专项测试与隔离 Electron 真实运行验证通过：选区背景不透明、pointer 清除和 Esc 清除均成功。

主要文件：

- `renderer/theme-integration.js`
- `electron/main.cjs`
- `tests/text-selection-ui.test.cjs`
- `scripts/diagnose-text-selection-runtime.mjs`

### 3.9 可切换界面模式

- 新增独立于现有皮肤的界面模式字段：`official`、`aurora`、`spatial`、`tactile`。
- 皮肤继续控制颜色与壁纸；界面模式只控制材质、层级、阴影和克制动效，切换不会重载或中断会话。
- 顶部调色板面板增加“皮肤 / 界面模式”页签；官方设置页也注入同一组模式和恢复入口。
- 极光玻璃仅在侧栏、输入区和对话框使用低透明玻璃；空间专注仅轻度降低辅助区域存在感；触感实体只增强主要输入控件和对话框，不给所有导航项堆叠阴影。
- 不添加装饰性“鲸”字头像，不修改或隐藏官方核心功能。
- 增加“减少动态效果”和“低性能模式”；同时遵循系统 `prefers-reduced-motion`，低性能模式关闭背景模糊与复杂阴影。
- 状态白名单写入 `appearance`，schemaVersion 升至 6；旧用户自动使用 `official`，现有主题、配色与壁纸保持不变。
- 手机端固定回退 `official`，本批次不修改 Android UI。
- 隔离 Electron 真实验证通过：壳层快速入口、四模式切换、官方设置入口、guest 同步、降级开关和恢复官方外观均成功。

主要文件：

- `electron/store/app-state-store.cjs`
- `electron/preload.cjs`
- `electron/main.cjs`
- `renderer/index.html`
- `renderer/styles.css`
- `renderer/app.js`
- `renderer/theme-integration.js`
- `tests/ui-mode-integration.test.cjs`

### 3.10 Computer Use 截图隐私清理

- 截图只保存在 `HarnessData/computer-use/screenshots`，文件名使用严格白名单格式和随机 UUID。
- 单文件上限 12 MiB；会话内最多保留 12 张、合计 48 MiB、最长 6 小时。
- 每次写入前后执行有界清理；只删除严格匹配的常规 PNG 文件，不跟随符号链接，也不删除同目录其他文件。
- 应用启动、Computer Use 新会话开启、关闭和模型 `stop` 都会清理托管截图；应用退出会等待清理完成后再真正退出。
- 截图在 Computer Use 开启期间保持可用；关闭或接管后按 session-only 策略删除。
- 专项测试验证数量、字节、年龄、单文件限制、无关文件保护和全部生命周期挂点。

主要文件：

- `electron/bridge/computer-use-screenshot-store.cjs`
- `electron/main.cjs`
- `tests/computer-use-screenshot-store.test.cjs`

### 3.11 独立浏览器 Profile 完整隐私重置

- “清除当前站点”继续要求用户勾选确认，同时清除站点存储、站点代码缓存、活动连接和该 origin 的模型授权。
- “重置整个独立 Profile”明确清除登录存储、HTTP 缓存、HTTP 认证缓存、代码缓存、DNS 缓存、活动连接、浏览历史、全部站点授权、待确认请求和本次运行的脱敏审计元数据。
- Profile 面板只显示授权数量和脱敏审计条数，不暴露审计正文、Cookie、密码、令牌或页面内容。
- 浏览器审计 `clear()` 同时重置 entries、total 和 dropped，避免删除后仍残留可推断使用历史的累计计数。
- 隔离 Electron 真实验证通过：重置前 1 个授权/8 条审计，重置后授权 0、审计 0、后退历史关闭、站点数据 false。

主要文件：

- `electron/bridge/browser-audit.cjs`
- `electron/bridge/browser-security-policy.cjs`
- `electron/main.cjs`
- `renderer/index.html`
- `renderer/browser-sidebar.js`
- `tests/browser-audit.test.cjs`
- `tests/browser-security-policy.test.cjs`
- `tests/browser-sidebar-ui.test.cjs`

### 3.12 Computer Use 确认队列隐私强化

- 将主进程内的临时 `Map` 替换为独立、可测试的有界确认存储。
- 普通输入文本不再以明文进入确认 fingerprint；只保留 SHA-256 指纹，公开状态也不返回 fingerprint。
- 相同动作和参数的重复请求复用同一个确认 ID，避免重复弹出和队列膨胀。
- 待确认队列最多 32 项，超过上限明确拒绝；状态读取、确认和拒绝都会主动清理过期项。
- 确认严格绑定动作、坐标、滚动量和输入指纹，60 秒内有效，只能消费一次；错误参数、过期 ID 和重复消费均拒绝。
- Computer Use 关闭、`stop` 和应用退出继续立即清空整个确认存储。

主要文件：

- `electron/bridge/computer-use-confirmation-store.cjs`
- `electron/main.cjs`
- `tests/computer-use-confirmation-store.test.cjs`

### 3.13 本机回环能力服务生命周期强化

- Browser/Memory/Computer Use 模型工具共用的回环服务启动与停止现在串行化，并发启动只生成一个端点和一枚随机令牌。
- 启动前删除旧状态文件及严格匹配的崩溃临时令牌文件，不触碰同目录其他文件。
- 状态文件继续使用 0600 原子写入；写入或 rename 失败时会关闭已监听端口、清空内存令牌并删除临时文件。
- 跟踪所有活动 socket；停止时先使 generation 失效，再销毁连接并关闭监听，已通过鉴权但尚未完成的请求不能在停机后继续派发结果。
- 服务重启始终轮换令牌，旧 Bearer token 对新端点返回 401；停止后状态文件删除且旧端点不可连接。

主要文件：

- `electron/bridge/browser-control-server.cjs`
- `tests/browser-control-server.test.cjs`

### 3.14 本地记忆安全擦除与导出副本控制

- SQLite 打开时强制启用并验证 `PRAGMA secure_delete = ON`；无法启用时拒绝打开记忆数据库。
- “删除全部”在事务删除后截断 WAL、执行 `VACUUM` 并再次 checkpoint，清除 FTS/空闲页中的正文痕迹，同时清空内存审计条目及累计元数据。
- 专项测试使用唯一明文标记检查数据库、WAL 和 SHM 文件，删除后均不存在该正文。
- UI 明确显示“安全删除已启用”，并将操作表述为安全擦除而非普通逻辑删除。
- 增加独立复选项，用户可选择同时删除 `HarnessData/memory-exports` 中由本应用按固定命名生成的 JSON 副本。
- 导出清理只删除严格匹配的常规文件，不跟随符号链接，不删除 `keep.json` 等其他文件；默认不擅自删除用户主动导出的副本。

主要文件：

- `electron/bridge/memory-service.cjs`
- `electron/main.cjs`
- `renderer/index.html`
- `renderer/memory-manager.js`
- `tests/memory-service.test.cjs`
- `tests/memory-ui.test.cjs`

### 3.15 存储清理预览快照与 TOCTOU 防护

- 破坏性清理现在必须携带服务端保存的已确认预览快照；底层服务在缺少快照时直接拒绝执行。
- 预览候选记录路径、类型、树大小以及目录的 dev/ino/mode/size/mtime/birthtime 身份；这些底层身份不会返回给渲染器。
- 执行时重新扫描，但只保留与预览快照完全一致的候选；预览后新出现的旧 runtime、缓存或 temp 条目不会被顺带删除。
- 删除前再次检查路径包含关系、受保护目录、当前 runtime、符号链接/目录联接及最终文件身份。
- 同名目录在预览后被删除并替换，即使名称仍满足清理规则，也会因身份变化而跳过并要求重新预览。
- 预览仍为一次性、10 分钟 TTL、有界队列；应用失败或成功后均不能重复消费同一预览 ID。

主要文件：

- `electron/bridge/storage-cleanup-service.cjs`
- `electron/bridge/storage-management-service.cjs`
- `tests/storage-cleanup-service.test.cjs`
- `tests/storage-management-service.test.cjs`

### 3.16 独立浏览器 Profile 原子重置

- 新增浏览器操作代次协调器；Profile 重置开始时使此前取得的用户导航和模型操作 ticket 全部失效，并拒绝重入重置。
- 重置立即清空活动标签与一次性确认，将真实网页切换到 `about:blank`，并在清理前后关闭活动连接，避免旧页面继续写回站点数据。
- 全量重置继续清除 storage/cache/auth/code/DNS、导航历史、站点授权和审计元数据；单站点清理仅撤销对应 origin。
- 模型 observe/navigate/type/click 在异步步骤和最终副作用前后复核代次，重置期间不能返回旧页面内容或继续操作。
- 右栏在重置期间显示明确进度状态，并禁用地址栏、导航、授权、确认和重复清理操作；重置失败也会释放禁用态。

主要文件：

- `electron/bridge/browser-operation-coordinator.cjs`
- `electron/bridge/browser-security-policy.cjs`
- `electron/main.cjs`
- `renderer/browser-sidebar.js`
- `tests/browser-operation-coordinator.test.cjs`
- `tests/browser-security-policy.test.cjs`
- `tests/browser-sidebar-ui.test.cjs`

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

- 全仓测试：`npm run test:smoke` → **317/317 通过**。
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
  - Computer Use 截图会话级清理、12 张/48 MiB/6 小时保留门禁、无关文件保护通过；
  - 可切换界面模式的壳层入口、官方设置入口、guest 同步、降级和恢复官方外观通过；
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
4. 重新构建全新 win-unpacked，不复用现有 `dist-capabilities`。
5. 运行 `node scripts/artifact-audit.mjs <新输出目录>`。
6. 运行打包后 self-test；此前旧构建曾出现 300 秒挂起，源码 self-test 已通过，但最终新构建必须重新验证。
7. 构建安装版和便携版，验证覆盖升级、全新安装、卸载保留/删除策略。
8. 生成 SHA256SUMS，并检查安装包、便携版、ASAR、asar.unpacked、locales 和桌宠预算。
9. 更新 `release-manifest.json`。当前文件仍指向 v1.0.23。
10. GitHub 发布 v1.0.24 后再执行固定命令：`npm run release:cnb-cloud`。
11. 验证 CNB 直接下载链接和 SHA-256；不要构建或上传 Android APK。

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

当前已固化但不宣称客户端可用的协议边界：

- Bridge 健康状态与已配对 meta 明确返回 `platformNeutral: true`、`capabilityNegotiation: true`。
- `protocolClientPlatforms` 声明协议可承载 `android`、`ios`，同时 `implementedClients` 只声明当前真实存在的 `android`，不会误报 iOS 已支持。
- 设备持久化 schemaVersion 3 增加白名单字段 `platform`、`deviceClass`、`appVersion`；旧记录安全迁移为 `unknown/null`。
- Android/iOS 设备类型只作为状态元数据；控制命令仍只按客户端实际上报的 capability 放行。测试证明模拟 iOS 客户端只能使用其声明的 screenshot/filePicker，不能调用未声明的 Android 专属能力。
- 当前 Android 未上报新字段时由配对 User-Agent 安全推断，保持现有 APK 向后兼容；本批次没有构建或修改 APK。
- 桌面 Computer Use 继续由 Windows `mainWindow` 适配器实现；未来 macOS 必须新增独立宿主适配器和系统授权层，不能复用或绕过 Windows 权限模型。
