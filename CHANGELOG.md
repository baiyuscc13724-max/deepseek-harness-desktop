# Changelog

## 1.0.13

- 窗口拖动改为动态空白区域命中：顶部和正文空白处均可拖动，交互控件与文字会自动避让。
- 子代理入口恢复全行点击，并可进入官方实时子会话详情页。
- 缓存显示区分最近一步、热请求、前缀复用、累计冷启动和提供方未报告状态。
- 修复跟随主模型时删除桌面路由兼容预设，导致历史桌面会话无法恢复的问题；用户自建预设保持原样。
- 未变化的模型路由不再在每次启动时重复生成和写入。
- 官方工作区本机路径支持打开、复制和定位；顶部桌宠卡片支持点击外部自动收起。
- Harness JavaScript 运行时收进应用主包，减少安装阶段释放的小文件数量。

## 1.0.12

- 子代理下拉窗口改为自适应宽版布局，最多使用 680 像素并保留视口边距；长任务名、工作区和 TOK 信息不再挤成窄列。
- 子代理列表根据官方运行状态圆点增加三段动态指示器，运行中的代理可以在列表中直接识别，并自动遵循系统“减少动画”设置。
- 启动检查发现桌面新版时主动弹出应用内更新提醒，直接展示本次更新内容，并支持立即后台下载、查看发布页或稍后提醒；设置页也同步显示更新说明。
- DSH 插件市场与通用 Skills 为英文简介自动生成中文摘要，保留可展开的英文原文；增强只应用于桌面版管理的市场副本，不覆盖用户自行升级的更新版本。

## 1.0.11

- 修复桌面宠物台词被透明窗口形状裁成一条横线的问题；台词改为无边框、无底色的清晰悬浮文字。
- 按动画真实可见像素收紧宠物命中范围，台词与右键菜单仅在显示时加入各自的小区域，不再让整块透明窗口拦截鼠标。
- 修复加入桌面宠物入口后，Windows 无边框窗口的可拖动区域被意外缩窄为仅 24 像素，且仍使用旧版拖拽样式声明，导致窗口无法正常拖动的问题。
- 按 Electron 43 的窗口交互规范恢复 36 像素高的完整标题栏拖动区域，同时保留女仆鲸、皮肤入口和原生窗口控制按钮的独立点击区域。
- 增加标题栏命中区域回归测试，防止后续快捷按钮再次挤占窗口拖动区域。

## 1.0.8

- 修复选择已有项目文件夹时报错“win32 folder dialog worker exited before reporting a result”：Windows 桌面包改用系统文件夹选择框，绕开官方 Koffi/COM 对话框子进程的原生崩溃。
- 精简安装包内不参与运行的源码映射、类型声明、测试和示例文件；官方运行时仍保留实体依赖目录，兼容项目、插件、Skill 和子代理的模块链接。

## 1.0.7
- 修复 Electron/Node 24 在 Windows 上直接启动 `npm.cmd` 返回 `spawn EINVAL` 的问题；已用 `dsh-at-file` 完成真实依赖安装、注册及重启加载测试，并用 `anthropics/skills` 完成 18 个 Skills 的真实安装测试。
- 修复全新安装时内置 DSH 插件市场从 `app.asar` 虚拟目录复制失败的问题；现在会从真实的 `app.asar.unpacked` 目录安装到用户 DSH profile。
- 将桌面插件市场加入打包自检和产物审计，发布包必须能在空白用户目录完成安装、注册客户端并启动官方 Web 工作台。
- 补齐主题对最新版官方按钮、选中项、浮层和侧栏导航色彩变量的覆盖，避免青瓷云雾等亮色皮肤叠加官方深色偏好后出现黑色块。
- 插件市场仍保存在用户目录；桌面版或官方 Harness 更新不会覆盖用户自行更新的市场与插件。

## 1.0.6

- 完整固定官方 Harness Web 运行时实际使用、但上游仅声明为 peer dependency 的 18 个 DSH 模块，修复依次出现的 `dsh-scope` 等启动缺包问题。
- 将运行时模块放入真实的 `app.asar.unpacked` 目录并从该目录启动，保证官方 DSH 在 Windows 用户目录创建的 profile 模块链接可用，不再指向不可链接的 ASAR 虚拟目录。
- 按官方 Web profile 要求启用 Node 内部模块钩子，修复 HMR 服务启动条件缺失。
- 发布自检从执行命令行帮助升级为启动隔离的真实 Web 服务并探测本地端口；运行时没有真正就绪时禁止发布。
- 1.0.4 与 1.0.5 已标记为预发布，避免稳定通道继续安装不完整包。

## 1.0.5

- 修复 1.0.4 安装包启动时缺少 `@deepseek-ai/cordis-plugin-group` 的问题：将官方启动模块实际导入的 peer dependency 固定为桌面端直接依赖，避免打包器裁剪。
- 打包自检现在会真实加载内置 DSH 命令行依赖图，并检查 `app.asar` 中的关键运行时文件；缺少依赖时禁止发布。

## 1.0.4

- 修复主题层在左侧栏展开或收起时反复扫描整页并强制计算布局造成的窗口卡顿；页面变化与窗口缩放现在合并刷新。
- 修复桌面端误连机器上其他 Harness Web 服务，导致安装包内的新会话修复未生效：桌面端默认使用自身固定版本并监听随机空闲端口。
- 顶部“新会话”和项目行“+”统一立即清空旧工作区、创建独立会话并切换到目标项目；创建失败时恢复原会话。
- 增加双项目真实回归：项目 A、项目 B 可分别连续创建会话，全局入口保持当前项目归属。

## 1.0.3

- 修复项目行“+”复用已有空白会话而看似无响应：项目内快捷入口现在强制创建独立会话，顶部官方“新会话”行为保持不变。
- 消除桌面壳对主模型的重复持久化：官方 `settings.yaml` 是主模型唯一真相，桌面路由文件只保存子代理扩展，并自动迁移旧格式。
- 模型路由改为原子写入并在投影失败时回滚，避免桌面子代理状态与官方设置分叉。
- DSH 子进程启用 Node 24 原生代理支持：兼容环境变量、Windows 系统代理以及无代理直连，不再需要注入自定义网络脚本或强制开启 TUN。
- 官方 Session log 入口移至原生窗口按钮下方，避免占用会话标题区。

## 1.0.2

- 修复安装包内保存独立子代理模型时的 ENOENT：不再用 Node `fs.cp` 直接复制 ASAR 虚拟目录。
- 改为逐文件复制官方 Agent 预设，完整保留 `cordis` 的嵌套 Skills；主模型与继承主模型逻辑不受影响。
- 增加 `cordis + 子代理单独指定模型` 回归测试。

## 1.0.1

- 修复右上角官方会话日志入口、桌面皮肤按钮与 Windows 窗口控制按钮堆叠的问题。
- 官方顶部操作会自动避让桌面壳控制区，并在窗口尺寸变化后重新计算位置。
- 增加发布前回归检查，防止后续官方界面更新再次引入顶部控件重叠。

## 1.0.0

- 修复“立即安装”关闭桌面端后没有拉起安装向导：不再依赖隐藏 PowerShell 接力，改由 Windows 原生方式直接打开已经完成 SHA-256 校验的安装包。
- 只有 Windows 确认安装程序已经成功启动后才退出旧版；启动失败会保留当前程序并显示具体错误。
- 青瓷云雾作为稳定版默认皮肤，动态模型目录、主模型与子代理路由、傻瓜式插件与 Skills 安装进入首个稳定版本。

## 0.9.0-rc.9

- 主模型与子代理从官方随包目录动态识别服务商的全部模型；OpenCode GO 从仅显示默认模型修复为显示完整 16 个模型，并保留用户自定义模型。
- 模型设置新增“刷新模型”，每次打开模型页自动重新读取；切换到插件市场或其他设置页时立即卸载模型路由面板，修复跨页面叠加。
- 内置插件市场升级至 1.2.1：Skill 仓库可自动识别并安装任意子目录中的多个 `SKILL.md`，普通 Skill 不再索要 API Key 或“提交材料”。
- 插件与 Skill 安装改为固定居中的实时进度窗口，不再让卡片消失或把页面滚到顶部；完成后明确显示安装结果。
- 青瓷云雾成为首次安装和旧默认外观的默认皮肤；用户主动选择的其他皮肤保持不变。

## 0.9.0-rc.8

- 下载并校验完成后改用随主题变化的应用内确认页，不再弹出 Windows 系统消息框。
- 点击“立即安装”后先安全退出桌面端，再打开可见的纯中文安装向导，不再静默安装后无反馈。
- 安装包兼容旧版更新器传入的静默参数，从 rc.7 升级时也会自动转为可见中文向导。
- 安装完成页保留“运行 Harness Desktop”选项，方便用户立即回到新版本。

## 0.9.0-rc.7

- 在官方设置内加入实时 DSH 插件市场，可浏览、安装、识别和更新社区插件；市场本体与用户插件保存在用户 DSH 目录，桌面版或官方核心升级不会覆盖用户更新。
- 主模型与子代理改为直接选择式界面：子代理可在“跟随主模型”和“单独指定”间切换，并可从同一入口调用官方添加模型功能。
- 顶栏皮肤入口改为与官方窗口按钮一致的轻量图标样式；独立皮肤面板继承当前主题颜色。
- 更新安装改为先关闭桌面端及其本地 Harness 进程，再由后台交接程序启动安装器，避免要求用户手动关闭旧版。
- 保持系统代理、PAC 与无代理直连兼容，更新包继续在后台下载并执行 SHA-256 校验。

## 0.9.0-rc.6

- 在官方“模型”设置中加入主模型与子代理路由：主模型和子代理可分别选择服务商与模型；未配置子代理时默认跟随主模型。
- 独立子代理路由保存到用户目录，并从最新版官方 Agent 预设自动生成桌面管理预设，官方 Harness 更新不会覆盖用户配置。
- 桌面更新检查改用仓库内轻量发布清单，避开 GitHub Releases API 的匿名限流和 HTTP 403。
- 桌面壳顶部新增独立“皮肤”快捷入口，只弹出皮肤选择窗；双击应用后自动关闭并立即展示主题效果。

## 0.9.0-rc.5

- 修复重启后主题变量被官方嵌套配色层覆盖，导致背景、侧栏和文字颜色不一致的问题。
- 主题恢复改为幂等注入，避免主题样式自身触发 DOM 监听并反复重建。
- 更新检查与安装包下载改用 Electron 系统网络通道：自动适配系统代理、PAC 或无代理直连，不写死代理地址。
- 更新包在主进程后台下载并校验，关闭设置页不会中断；下载完成后使用桌面原生弹窗询问是否立即安装。

## 0.9.0-rc.4

- 修复 Windows 无边框窗口顶部拖动区域过窄，导致桌面端几乎无法从屏幕中央拖动的问题。
- 将拖动区域恢复为与系统标题栏一致的 36 像素高度，同时避开最小化、最大化和关闭按钮。
- 增加窗口拖动区域的发布前防回归检查。

## 0.9.0-rc.3

- 在 DeepSeek Harness 官方设置中新增“外观皮肤”，不增加第二套工作台或独立桌面设置。
- 内置官方外观、Deep Ocean、Catppuccin、Nord、Dracula、Gruvbox、Solarized、Tokyo Night、Rosé Pine 等配色。
- 加入 Deep Whale 女仆工坊皮肤，并保留 CC BY-NC-SA 4.0 非商业许可、来源和完整署名链。
- 新增自定义主题，可设置明暗模式、强调色、界面底色、文字颜色和本地背景图。
- 主题卡片改为双击立即应用；真实鼠标第二次点击与标准 `dblclick` 均可触发，选择会持久化。
- 修复会话日志入口与 Windows 窗口按钮区域重叠的问题。
- 修复官方“通用设置 → 打开配置文件”在桌面壳中无响应的问题。

## 0.9.0-rc.2

- 直接使用 DeepSeek Harness 官方 Web UI 作为唯一工作台，删除重复的原生会话、项目和聊天界面。
- 启动时自动拉起官方 Web 核心，不再显示首次启动引导或阻止进入工作台。
- 删除顶部黑色桌面栏和独立桌面设置，模型、权限、插件全部使用官方设置。
- 将桌面版与 Harness 官方核心的自动更新检查嵌入官方“设置 → 通用设置”。
- 修复 Windows 进程启动，固定 electron-builder 26.15.7 与 cross-spawn 7.0.6，并用纯简体中文 Inno Setup 替换会在部分机器上被拦截的 NSIS 安装外壳。
- 新增 Windows 安装落盘冒烟检查，并继续保留 packaged self-test 与发布秘密扫描。
- 删除旧原生工作台的 AgentBridge、Session、Provider、Terminal、Git、Workspace、MCP、Plugin、Skill、诊断后台及对应测试。
- 移除桌面壳对 `node-pty` 的直接依赖、SDK client 和真实 Provider 脚本；仅保留官方 Harness 核心自身所需的 native rebuild/ASAR unpack。
- 安装版、便携版、程序文件、快捷方式和卸载列表统一使用官方 DeepSeek 鲸鱼图标，并由发布验证锁定。

## 0.9.0-rc.1

- 新增安装包级 `--self-test` 模式：不创建 GUI，直接验证 Renderer、bundled Harness、userData、Headless Bridge 与 Web Compatibility。
- GitHub Actions Windows 构建在发布前会真实启动 `win-unpacked` 桌面程序执行 self-test；失败则阻断 Release。
- self-test 支持输出脱敏 JSON 报告，不读取项目文件、不输出 API Key。
- 新增 packaged self-test 单元测试与 release contract 校验。
- 新增 Windows RC1 最短人工验收清单，明确自动化与必须实机验证的边界。
- Release workflow 降低默认权限，并增加并发控制与超时。

## 0.8.0

- 新增首次启动向导：环境、模型、工作区完成后进入工作台。
- 新增 DiagnosticsService：检查 Node/Harness/userData/safeStorage/Provider/Workspace/Git/pnpm/Web Runtime。
- 新增脱敏诊断 JSON 导出与 Web Runtime 一键恢复。
- 新增 AppStateStore，持久化 onboarding 完成状态和更新检查偏好。
- 新增 UpdateService，分离 Harness Desktop 与 DeepSeek Harness Core 更新检查；核心不静默自动升级。
- Electron 升级并固定到 43.2.0，使用 Node 24.x 运行时以满足当前 Harness engine 要求。
- Windows NSIS 改为安装向导并允许选择安装目录，保留 portable。
- GitHub Actions tag 构建在三平台全部审计通过后自动创建 GitHub Release，并生成统一 SHA256SUMS.txt。
- smoke tests 扩展至 38 项。

## 0.7.0

- 新增 MCP / Skills / Harness Plugins 原生扩展中心。
- MCP 支持 stdio 与 Streamable HTTP，并以临时 Cordis `--patch` 注入官方 `dsh-mcp-client`。
- MCP 敏感配置优先使用 Electron safeStorage；不可用时不明文落盘。
- Skill 管理遵循 Harness 官方本地发现优先级，`.agents` 兼容来源只读。
- Plugin 管理委托官方 `dsh plugin --profile`，支持 headless / web Profile。
- 增加 Electron 导航/弹窗安全硬化与发布审计脚本。
- 新增 MCP、Skill、Plugin smoke tests。

## 0.6.0

- TerminalManager 新增 `node-pty@1.1.0` 后端、PTY resize、Ctrl+C 中断与 pipe fallback。
- Workspace 新增文件/文件夹创建、重命名和系统回收站/废纸篓删除入口。
- 修正 mutation path 的 symlink 语义：重命名/删除针对 symlink 条目本身，不误操作其真实目标。
- Git Diff 新增结构化 hunk 解析。
- 新增 hunk 级 Stage、Unstage、Discard，并通过当前 patch hash 防止旧 Diff 误应用。
- 新增“计划”Pane，按 Session 持久化展示 Plan、Subagent、Tool、Permission 与状态时间线。
- Preload / IPC 扩展 Workspace mutation、Terminal capability/resize、Git hunk API。
- Release 构建启用 native dependency rebuild。
- smoke tests 扩展至 20 项。

## 0.5.0

- 新增原生项目文件树与按需目录展开。
- 新增 2 MiB 内 UTF-8 文件预览/编辑、原子保存和 mtime 冲突保护。
- 新增工作区路径穿越与 symlink 边界防护。
- 新增真实本地 Shell TerminalManager 与独立 Agent 日志视图。
- Git Review 新增暂存、取消暂存、撤销 tracked 修改；未跟踪文件拒绝自动删除。
- SDK 事件标准化扩展到 `tool/call`、`tool/result`、Plan/Todo、Subagent 与 Permission。
- 新增 Tool/Plan/Subagent/Permission 原生事件卡片。
- 新增仅 localhost / 127.0.0.1 的开发服务器内嵌预览。
- smoke tests 扩展到 16 项。

## 0.4.0

- 新增 OpenCode Go Provider 预设。
- 新增 DeepSeek V4 Flash / Pro 模型选择。
- 新增 Electron safeStorage 密钥持久化；不可用时仅内存保存。
- 新增真实 Provider smoke 脚本。

## 0.3.0

- 原生 Session、Headless AgentBridge、Git Diff、Terminal 日志。
- SDK JSON-RPC 适配入口。
- 官方 Web UI 兼容模式。
