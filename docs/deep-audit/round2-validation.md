# 第二轮预览与设置独立复核

## 结论与范围

**接受为可复核的局部红证据，不是产品通过、修复完成、全功能验收或当前安装版认证。** 本轮只复核两项作者交付；用户新增的右侧双空栏截图任务不在本报告范围。

- 实际缓存 Electron 43.2.0 / Chromium 150.0.7871.129，新建隐藏窗口与全新 profile。
- 预览独验：35 个组件断言，34 符合、1 红；外层 Node 1 test / 0 pass / 1 fail / 0 skip，exit 1。组件耗时约 5.19 秒。
- 设置独验：47 个期望检查，39 符合、8 红；外层 Node 1 test / 0 pass / 1 fail / 0 skip，exit 1。含补充观察约 15.72 秒。
- 证据门控：8 Node tests 全通过，0 fail/skip/cancel，exit 0，约 0.61 秒。该绿色只表示来源、红结果、边界与负面拒绝相符，**不把前两组改绿**。
- 原 master `598` 域行、`115` USER、`104` 有限接受、历史 `2929/2889 pass/7 fail/33 skip` 均不变。82 项组件检查不是82个用户需求，也不加入历史总数。

主要交付：`tests/deep-audit-round2-evidence.test.cjs`、`docs/deep-audit/coverage-round2.json`，以及 `.artifacts/deep-audit-round2-acceptance/` 的原始独验与绑定证据。

## 实际源码与装载边界

工作目录先经 `pwd` 确认为工作区根，操作位于维护树 `release-v1.0.28-worktree`，已读其 AGENTS。维护候选 `package.json` 为 1.0.60；**没有读取或运行当前 Desktop 1.0.62 GUI/安装产物**，没有安装、构建或发布。本次证明的是候选打包输入的真实组件字节，不声称验证实际安装版。

| 实际输入 | SHA-256 |
|---|---|
| renderer/right-workspace.js | `0ad6dac836c1bb169c4a778246c3d748894a50fae46320518ec77f8eb9796a40` |
| renderer/right-workspace-integration.js | `e0f8c6cf400335cf29a0a99e8172a0abf9a05e566afa1435c18d1195cc7c6919` |
| plugins/dsh-desktop-files/lib/index.js | `b9bb0fdff9f057436ba411f769e2728c7517b1e5635aa1b4bcacf8373c5eb65b` |
| renderer/app.js | `3086aae0818e127ee12ac4db989ab9ed0760c68efbcb67eb3943de069e2064fa` |
| renderer/theme-integration.js | `002e541379cb6d4d0d2eec5cbde03123e860f832c5222aff5e85b830a3cad340` |
| renderer/modal-focus.js | `1d85ed57f85d9d508af10edef70a5cb5ee6dfb4d92ff2413cb064e30a9f481cd` |
| renderer/theme-catalog.js | `23f1ad41624790be5d4425e97923dfdff8f8454c1eef6d2d57ad0692827670ff` |
| renderer/index.html | `1a338ec3017db59fe7f8ae6dc468cc87f77592bb1d61d390309dacad161fafe9` |
| renderer/styles.css | `091929333dedea6eb0892cc32d24be327b476b1738e40490cfe778dda2fe64c8` |
| renderer/right-workspace.css | `ca9cf7220f161672dd894a1bbd46eedf588ae499f9b8cb615948195720a1d60b` |
| 缓存 electron.exe | `8593db40c0c6e5e3c4b6b0a225b1dc9a549ecdf10f6cf2010cf5b6ce869ce07f` |

其他图标、xterm CSS 与 package 完整 hash 在 `baseline.json`；每个 sidecar 行另绑定其实际输入和原始 receipt hash。

### 预览

真实原始 right-workspace 两份 JS/CSS、index 的逐字节 sidebar 子树与原 CSP；真实 files service 复制为临时 `.mjs` 后调用正式导出，读取8个全新合成文件。未重写渲染器或算法。runtimeView 是 inert div；文件数据、来源会话、nonce、消息与延迟回执端口为合成。真实 parent CSP、HTML CSP/sandbox、iframe 脚本、DOM 与生命周期在 Chromium 中执行。

### 设置

完整真实产品表单 markup、原 CSS、theme/modal 模块、app 的实际监听和保存回调。沿用可逆装载 seam：14个自动 script 替注释、收紧 HTML CSP、xterm 路径映射、webview→inert div、只替 app 启动尾部为私有 seed/open/close/snapshot；不改保存/焦点逻辑。证据门控逐项逆向撤销 seam，恢复 SHA 与原源完全相等。官方 guest/父设置链不执行。

### 独立重跑与差异

复核未改作者文件。只在自身 `derived/` 产生两份测试入口：精确改 repo/fixture 解析与 artifact 输出父目录，补强预览 dialog/globalShortcut 及设置 Electron 内 child_process 拒绝端口。设置原有47项检查内容不变，独立补充观察安排在原 runChecks 返回后、原缩放检查前。`derivation.json` 保存每个 before/after/hash，逆变换逐字节等于作者源。实际产品 seam 沿用且独立验证；不是另造 toy 表单或只读作者 log。

## 红证据及保守判定

| 观察 | 独立结果 | 判定 |
|---|---|---|
| HTML close 后停止执行 | 关闭约100ms时心跳9，再约241ms为13；iframe仍连接、面板已关 | 确认实际隐藏后主动执行未停止；不是网络逃逸或真实信息泄露证明 |
| custom pending busy/disabled | disabled=false、aria-busy=null，按钮仍“应用并保存主题” | 待定反馈缺失的真实组件观察 |
| 同轮重复 custom save | 两次button.click发出2个保存请求 | 无去重；不宣称重复扣费或磁盘损坏 |
| custom save 拒绝 | 弹窗仍开，真实未处理拒绝被 fixture 捕获；广义可见文本无失败提示 | 失败反馈缺失；重试可成功 |
| theme save 拒绝 | 弹窗仍开，apply.catch吞错；广义可见文本无失败提示 | 失败反馈缺失；再次选择可恢复 |
| 关闭重开后旧已提交保存成功 | 焦点/新弹窗保留，但外观改成旧主题 | **契约review**：关闭是否取消已提交保存尚无证据；不直接计确定bug |
| A/B逆序主题回执 | B先完成，A后完成，最终真实界面为A | 合成回执条件下的陈旧快照应用风险；native时序未验 |
| 两字段逆序回执 | brightness100/blur2请求先发，brightness100/blur8后发，倒序回执后blur退回2 | 合成条件下字段回退风险；非真实持久化顺序证明 |
| input-only range预览关闭 | 仅input不change后关闭重开仍110，合成持久值82 | **契约review**：界面是关闭而非明确事务取消；真实range通常还有change |

HTML关闭采样使用同一 renderer `performance.now()`：1077.8ms open/8拍，1079.1ms closed/8拍，1179.4ms closed/9拍，1420.7ms closed/13拍。等待100ms后仍新增4拍，排除单个已排队消息解释；对应消息 sourceMatches=true、origin=null。replace文本与destroy均停止执行。生产候选范围是 `right-workspace-integration.js:878–886` 统一close路径。本复核未修改它。

设置生产读取定位为 `app.js:566–579、3488–3512`：异步回执先赋 appearanceState；`theme-integration.js:1074–1086` 的generation只保护之后关闭/焦点，因此旧焦点修复仍通过。需修复时由root另行授权最小scope，本报告不授权写源。

### 排除“fixture存储倒退”混淆的新增独立观察

作者 reply 在交付时更新合成 persisted，故倒序测试同时包含存储倒序。独立 `derived/supplement.js` 把合成存储保持为**按请求顺序已提交的最新B**，只让旧响应快照迟到，不在迟到交付时改存储：

- 主题：显示 porcelain-mist → deep-ocean，persisted 一直为 porcelain-mist。
- 字段：控件blur 8 → 2，persistedBlur 一直为8。

因此陈旧响应无条件覆盖真实renderer的观察不依赖“存储也倒退”的模型。但合成延迟仍不是 native IPC/主进程磁盘可以逆序的证明，不扩大为真实数据丢失结论。完整payload/交付次序在 `settings-independent-v1/independent-observations.json`。

## 正面证据与既有ID

`coverage-round2.json` 只关联6个已有 USER，每行都有 normal/error-recovery/concurrency-switch/isolation/a11y 五维及未验清单；门控在原 master 中逐一核ID存在。

| USER | 新增的有限边界 |
|---|---|
| USER-01a3c4e3ad85 | 来源冻结、detached旧行、A/B/context代次、nonce；真正Host身份链未验 |
| USER-394498c58518 | 真实text/Markdown源码/空文件、binary/超限提示、恢复；非富Markdown或全媒体 |
| USER-815f7e7b046f | 真iframe/CSP/sandbox、脚本/reload、replace/destroy；close红 |
| USER-36be79d18ec4 | 12主题/4模式状态、custom/range与失败/竞态；非全视觉/字体持久化 |
| USER-dabcc40bc9f5 | 真实modal角色、Tab边界/Escape与动态隐藏焦点、十次重开、200% bounds；非全读屏/原生输入 |
| USER-9db0f88b0fdc | 仅空库与合成chooser取消/拒绝、range参数；原生导入、codec/GPU未验 |

后两个预览USER旧master的compaction占位关联不冒充真实入口；旁表补充实际 renderer/service hashes，但旧master状态和链接不改。所有行 `wholeUserAccepted=false`，不泛化整个USER通过。

## 安全、坏证据拒绝与冻结

- 外层 PowerShell `ProcessStartInfo.Environment.Clear()`，只放固定OS目录、Node目录PATH、新 HOME/USERPROFILE/APPDATA/LOCALAPPDATA/TEMP/TMP/DSH_HOME 与单个audit输出变量。Electron再次白名单；无账户、代理、真实profiles、token或当前GUI端口环境。
- 装产品前拒绝 Node net/tls/http/https/http2/dgram/dns/fetch/WebSocket；Electron剪贴板/shell/dialog/globalShortcut/捕获/net/子进程端口封堵；renderer clipboard/execCommand/network/guest端口拒绝。所有调用数组为空，未运行账户/设备/native clipboard/原生选择器/下载/发布。
- 专用session exact fileURL白名单。预览唯一 `127.0.0.1:9/preview-fixture` 只是 in-process protocol resource标识，4次处理均直接返回fresh文件字节，无socket或HTTP服务；没有一般localhost允许。CSP/sandbox在负例到达fallback前拒绝，fallback/navigation数组为空。
- `.invalid`仅作攻击资源标识；未触60131、当前GUI、公网或真实配置。缓存公共依赖只读，未安装或下载依赖。
- 这些是可审查的能力端口封堵和实际调用轨迹，不是OS级系统调用sandbox或全机抓包认证。隐藏窗口/backgroundThrottling=false不支持生产功耗推断。
- 负面门控：11份仅内存变异receipt（错source hash、伪pass位、删红、伪停心跳、插当前GUI URL/native调用、错engine、清failed、network异常、重复场景名）全部被拒；另2份伪全USER通过/篡改历史计数sidecar被拒。未改磁盘原证据，也未实际调用坏端口。
- `baseline.json` 与 `after.json`：旧两份final-freeze所列全部文件及自身、master/round1两个sidecar共362个冻结路径；另外14个本轮输入、23个作者文件/报告/receipt前后0漂移。两份freeze均逐条按各自保存sha核验，不只比较当次快照。
- master SHA始终为 `8d5cad11503953cb9044a96902ab92d718cb21ae17107313549c5e45fb527794`；round1 sidecar `c047ba5428ab4ba7c6402f5e747d5b2859bc0241ab332d29a64c5dd73ff78b87`；reconnect sidecar `1206a950ffb1f8aa8a5f2e826e04531ab1e3ceaad2086cebd2b6f93f113c729c`。

## 复跑与交付校验

维护树运行，不直接继承用户环境执行Node，不使用npm/npx或全量suite：

```powershell
# 用新的Run名，既有目录会被安全拒绝；预期保留红断言exit1。
& ./.artifacts/deep-audit-round2-acceptance/run.ps1 -Kind preview -Run independent-v2
& ./.artifacts/deep-audit-round2-acceptance/run.ps1 -Kind settings -Run independent-v2
# 门控绑定已经冻结的v1证据，不会自动批准新的v2产物。
& ./.artifacts/deep-audit-round2-acceptance/run.ps1 -Kind evidence -Run verify-v2
```

`prepare.cjs`/`summarize.cjs`使用wx只创建首次快照，拒绝覆盖；不是让后来源码无条件替代本轮输入的更新器。源hash变更或failure.json存在时停止，按新任务重建独立绑定，不为了绿结果更改预期。

本轮两后台作业 `pwsh-153`、`pwsh-154` 均完成并通过 job_output 收齐；两个exit1已查明是保留的组件红断言。其余准备/汇总/门控均前台结束，无遗留后台作业。

documents 与 ui-ux-pro-max 已加载。定向反馈查询首次不匹配，收窄后命中 Error Recovery/Error Messages，只采纳可见错误/恢复提示的推荐，不把建议替代产品契约。本报告做 Markdown结构与数据复核；任务禁止当前GUI，因此未打开右栏预览、未声称人工视觉认证。
