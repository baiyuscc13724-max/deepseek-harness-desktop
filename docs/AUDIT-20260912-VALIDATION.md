# 2026-09-12 全项目基线与独立验收

## 范围和证据身份

- 维护源码：`D:\DeepSeek-Harness-Desktop\release-v1.0.28-worktree`；`package.json` 当前版本 **1.0.60**，HEAD `c13249132532d73f26fdd5830fe6a225b5f51feb`。
- 当前 Desktop 会话运行在 **1.0.62**，运行目录 `D:\Harness Desktop\HarnessData\runtime\1.0.62-win32-x64` 不是此次维护源码。此次未修改、重启或控制该实例，也未将维护源码测试结果等同于安装版验证。
- Windows，Node **v24.16.0**。本次不发布、不提交、不调用付费API、不读实际私钥/认证配置、不接受快照更新、不执行真实用户浏览器操作。
- 初始脏路径哈希：`.artifacts/audit-20260912/dirty-baseline.json`，114条，SHA256 `77f5a11f542ab6af9cc78cb83c3a5b07ab1f6a2b5df245897f258b909f615685`。仅保存路径与SHA256；删除文件哈希为null。快照于测试/验收修改前形成，并已通知总审。
- 补充源文件路径哈希：`.artifacts/audit-20260912/source-baseline.json`，881条，覆盖代码和测试的适用扩展名；这是后续补充采集，并非与初始114条原子同时快照。排除node_modules、构建和vendor目录。
- 多人共享脏工作区中的测试是有时间窗口的观察，不是不可变commit验证；新增与既有失败须结合初始哈希及成员交付具体差异判断。

## 执行方式

根测试入口 `scripts/run-smoke-tests.mjs` 枚举 `tests/*.test.cjs`，按UTF-8字节排序，普通阶段和串行时序敏感阶段为两个新Node进程；普通阶段失败时不会自动继续时序敏感阶段。首轮基线枚举307个根测试文件（之后新增验收文件不回填首轮计数）。不跳过失败、不修改断言。

`.artifacts/audit-20260912/run-isolated.cjs` 仅继承Windows执行必需环境变量，使用证据目录下独立 HOME/USERPROFILE/APPDATA/LOCALAPPDATA/TMP/TEMP/DSH_HOME，不继承提供商密钥、运行会话标识、真实控制端点或代理。默认不启用需显式开启的Electron/历史alpha2/installed-workbench检查。该隔离降低误访问用户状态的风险，不等于OS级文件/网络沙箱。

| 命令（工作目录均为维护源码） | 结果 | 证据 |
|---|---|---|
| `node scripts/verify-static.mjs` | exit 1；首次失败于278行，workspace-links文案契约不一致 | `static-baseline.log` |
| `node .artifacts/audit-20260912/run-isolated.cjs smoke` | exit 1；295文件，2489 tests / 2425 pass / 35 fail / 29 skip / 0 cancelled，79.440s；性能阶段未进入 | `smoke-baseline.log`、`smoke-result.json` |
| `node .artifacts/audit-20260912/run-isolated.cjs performance` | exit 0；单独执行原计划12个时序敏感文件，155 tests / 152 pass / 0 fail / 3 skip，37.978s | `performance-baseline.log`、`performance-result.json` |
| `node .artifacts/audit-20260912/syntax-baseline.cjs` | exit 1；690次检查，686直接通过，3个浏览器ESM加载模式不符，1个smoke临时fixture在检查前已删除 | `syntax-baseline.log`、`syntax-results.json` |
| `node .artifacts/audit-20260912/syntax-esm.cjs` | exit 0；对上述3个文件以`--input-type=module --check`从stdin仅解析，3/3通过 | `syntax-esm.log`、`syntax-esm-results.json` |
| `node .artifacts/audit-20260912/run-isolated.cjs targeted tests/terminal-service.test.cjs tests/upstream-status.test.cjs tests/user-data-override.test.cjs tests/wallpaper-library-ui.test.cjs tests/project-foundations-runtime.test.cjs tests/project-foundations-tools.test.cjs` | exit 1；串行诊断35 tests / 21 pass / 14 fail / 0 skip；4个文件级退出不再复现，14个Foundations失败仍存在 | `diagnostic-rerun.log`、`targeted-result.json` |
| `node .artifacts/audit-20260912/run-isolated.cjs git-diagnostic` | exit 1；仅选择1个foundation初始化用例，旁路记录fixture Git stderr，不修改生产输入/结果 | `git-diagnostic.log`、`git-failures.jsonl` |
| `node .artifacts/audit-20260912/run-isolated.cjs short-temp` | exit 1；23 tests / 15 pass / 8 fail；仅缩短隔离TMP后6个失败消失，剩余包含fixture commit路径过长 | `short-temp.log`、`short-temp-result.json` |

系统短临时目录复核：`node .artifacts/audit-20260912/run-isolated.cjs system-temp`，exit 0，23 tests / 23 pass / 0 fail / 0 skip，56.432s；证据`system-temp.log`、`system-temp-result.json`。仅新建专用临时fixture目录并在结束删除，HOME/APPDATA/DSH_HOME继续隔离；没有访问真实配置。此结果支持长路径环境归因，不消除深实际项目路径上的产品兼容边界。

首轮两个不重叠阶段合计2644 tests / 2577 pass / 35 fail / 32 skip。后续诊断重跑**不叠加**进该首轮计数。语法适用解析共689项通过；已删除的临时fixture单列不计为生产语法失败，也不计通过。

所有日志位于 `.artifacts/audit-20260912`。

## 已确认静态基线失败

`verify-static.mjs:278` 要求 `renderer/workspace-links-integration.js` 含 `右键可打开所在文件夹或复制路径`，首次检查即失败。尚未运行至其后门禁，不能把后续门禁视为通过。阅读另发现445行固定候选版本1.0.59，与当前package的1.0.60冲突；这是静态观察，而非该次执行的第二个失败结果。不会为了使门禁变绿而修改版本或弱化契约。

## 模块覆盖矩阵

以下是**测试文件归类与执行范围**，不是语句/分支覆盖率。精确307文件列表见`root-test-inventory.json`；按文件名前缀单归类，跨功能测试只计一次。

| 分组 | 普通/时序文件 | 目录与验证层级 | 状态/缺口 |
|---|---:|---|---|
| 协作/Git/质量 | 75/4 | `plugins/dsh-agent-teams`、`electron/bridge`；授权、存储、隔离、Git fixture、质量证据、自动接力 | Foundations首轮14失败受长路径影响；不是实际项目合并/运行会话验证 |
| 浏览器/桌面控制/Android控制 | 32/0 | `electron/bridge`、对应plugins；策略/控制服务本地fixture和源代码契约 | indicator旧结构断言1项失败；无真实桌面/浏览器/手机动作 |
| 移动/同步/中继 | 31/2 | `mobile`、`services/wss-relay`、`electron/bridge`；JS/本地TCP/WS fixture、源码契约 | 版本断言失败；无Android/iOS原生编译及设备测试 |
| 发行/组件/官方运行时 | 48/0 | `scripts`、`.github/workflows`、feeds/manifests、源码node_modules只读兼容检查 | 版本/历史hash/文档漂移；未发行打包或云发布 |
| 存储/记忆 | 8/0 | `electron/bridge`及plugins；临时目录扫描、清理、加密和界面契约 | 本组首轮无单列失败；未扫描真实用户存储 |
| 界面/皮肤/文件/终端/宠物 | 38/3 | `renderer`、`guest-bridge`、`electron/pet`；VM DOM、状态/预算、Windows PTY fixture | 5项旧交互契约失败；terminal和wallpaper文件级退出串行不复现；非视觉/Electron整体验收 |
| 模型/插件/运行基础 | 65/3 | 其余plugins、bridge、scripts；提供商mock、安装fixture、会话/进程配置 | 部分插件版本断言失败；真实LLM/MCP提供商未调用 |

## 首轮35个失败的分类

1. **版本契约8项**：desktop-compaction、desktop-directory-picker-plugin-service、desktop-web-search、mobile-control-plugin-service、model-admission-plugin-service各1项；mobile-release-version 1项；release-version-sync 2项。实际1.0.60而测试固定1.0.59，属于已存在版本基线漂移；未改发行版本或断言。
2. **历史hermetic 3项**：`official-followup-hermetic-acceptance` 两个固化源码hash和一个CHANGELOG alpha5历史标记失败；不自动接受新hash。
3. **Foundations 14项**：runtime 10项、tools 4项。相同隔离条件串行仍失败；Git探针显示worktree内部目录264字符，`git -c core.longpaths=true ... worktree add` exit128 `not a git repository`。仅缩短TMP18字符，初始化/部分打开恢复，剩余fixture直接`git commit`在约261字符`COMMIT_EDITMSG`报`Filename too long`。前者是生产adapter调用边界，后者是测试helper未携带longpaths；不能混为一个生产根因。该阈值是此次实测重现条件，非对所有Windows/Git版本的普遍阈值保证。
4. **交互契约6项**（只读评估，未修改这些测试）：
   - `computer-use-indicator:149` 要求路由后无条件sync；现main只对非status同步，实际动作仍同步。旧语法断言不等于指示器真实不可用。
   - `right-workspace-ui:99` 要求`factory.loadDocumentPreview(target`；现行文件预览已重构为来源绑定描述符，需新链行为证明，不能只替换regex。
   - `right-workspace-ui:219` 要求直接`openLocalTarget(file.destination`；现main先编码file URL及回解校验，再打开，属于路径加固替代。
   - `text-selection-ui:8` 要求Electron `role:'copy'`；现代码明确向精确guest WebContents调用`copy`，避免外壳焦点错误。
   - `workspace-links-interaction:85` 要求裸`local.path`的“打开此项目”；现改为来源/session绑定文件流程。
   - `workspace-links-interaction:94` fixture对resolver传裸绝对字符串；现resolver主动拒绝无`sourceKind:'workspace-link'`输入。null不能证明合法来源的绝对文件无法打开。
5. **文件级异常退出4项**：terminal-service、upstream-status、user-data-override、wallpaper-library-ui。首轮仅记录`test failed`而无充分异常原因，同环境串行全部通过；标为不可稳定复现/根因未定，不以重跑覆盖首轮失败。

## 未覆盖和限制

- 原生Android Gradle/设备测试、iOS Xcode/模拟器、macOS/Linux平台执行未运行；Windows上的源码字符串测试不替代这些测试。
- 当前1.0.62安装实例端到端功能、真实桌面/浏览器交互、实际手机配对、真实LLM/MCP/外网服务没有验证。
- 发行打包、签名、升级/回滚安装和GitHub/CNB发布均未执行；相关测试仅为fixture/契约层。
- 默认跳过的历史兼容或需显式开启测试，在最终计数中单列，不能计入通过。
- 根smoke只发现根目录`.test.cjs`，嵌套fixture、独立Electron入口以及其他语言测试不是自动全量覆盖。

## 独立修复验收

### 凭据隔离：第一轮独立行为验收

`node .artifacts/audit-20260912/run-isolated.cjs acceptance-provider tests/audit-provider-isolation.test.cjs tests/provider-credential-isolation-runtime.test.cjs tests/model-settings-key-override-runtime.test.cjs tests/model-settings-key-override.test.cjs`：exit 0，44 tests / 44 pass / 0 fail / 0 skip，7.705s，证据`acceptance-provider.log`、`acceptance-provider-result.json`。

只读源码node_modules v3的SHA256 `2171f31250c0970d1cc9a9733a241364306d99146e5baec8d0775066d7ae3388`，内存应用当前补丁后的v4 SHA256 `28a7850e44bc24cdd0e5e7222eb0fe655877d1433db59f8ff435934528ba0207`；第二次patch changed=false。证据`provider-patch-hashes.json`。这只证明补丁输出，不等于正式安装入口已接受该迁移。

总审完成共享安装胶合后，执行`node .artifacts/audit-20260912/run-isolated.cjs acceptance-glue tests/audit-cross-feature-regression.test.cjs`：exit 0，4 tests / 4 pass / 0 fail / 0 skip，0.129s，证据`acceptance-glue.log`。**精确v3→v4安装已实际执行**，并覆盖已v4幂等、未知完整标记/损坏标记/错误包身份拒绝且输入字节不变。仅对临时package fixture调用安装函数，没有修改node_modules。若将来环境已无精确v3原文，迁移用例明确skip而非伪造输入。

随后仅将测试名称中的“atomically”删去，避免误称安装器writeFile具有原子性保证；以`acceptance-glue-final`模式重跑仍4/4通过（日志`acceptance-glue-final.log`）。未注入写入中途故障，**不证明安装写入原子性**。该纯描述调整后的测试hash在`acceptance-final-hashes.json`单列，先前manifest保留。

### MCP 保存恢复：独立验收

已独立阅读生产diff（index/client）与14项新增行为用例：以atomicWrite成功作为Map/revision提交边界，dispose失败保留句柄并返回unknown cleanup；reconnect和删除共用事务队列；同步ref阻止同一事件轮重复提交；客户端区分写成功、读取失败和清理未知。插件package版本差异已在初始脏基线中，不归本轮。

`node .artifacts/audit-20260912/run-isolated.cjs acceptance-mcp tests/audit-settings-recovery.test.cjs tests/mcp-manager-domain.test.cjs tests/mcp-manager-runtime.test.cjs tests/mcp-manager-ui.test.cjs tests/desktop-mcp-manager-plugin-service.test.cjs tests/session-experience.test.cjs tests/settings-layout-ui.test.cjs`：exit 0，49 tests / 49 pass / 0 fail / 0 skip，1.430s，证据`acceptance-mcp.log`。使用临时假配置、内存hook调度器、假fetch与假连接，非真实React DOM/Electron端到端；dispose未知仍是未知，不宣称真实进程已停止。

上述凭据/MCP验收精确文件SHA256见`acceptance-provider-mcp-hashes.json`。对相应生产文件及独立测试运行`git diff --check -- ...` exit 0。

### Teams：未提交未验收候选

原团队修复成员异常退出，尚未完成claim-bound提交，恢复又受Host权限边界拒绝。这里只按总审要求读取候选并执行只读/fixture现状检查，**不替代其生产任务、不接受其交付、不宣称运行实例恢复**。

候选实际存在于`plugins/dsh-agent-teams/lib/index.js`与`tests/agent-teams-autopilot.test.cjs`；没有`tests/audit-team-autonomy.test.cjs`或`tests/agent-teams-passive-wait.test.cjs`。已读候选两处核心：CAS recoverable异常只能在当前授权安全检查之后标记且按异常对象身份区分；relay在admission后重新读取source/target并复核pauseEpoch，旧active快照不能越过Stop。候选报告中最终回执尚待记录，不能代替验收。

候选10文件串行检查（执行前已确认每个文件存在）：

```powershell
node .artifacts/audit-20260912/run-isolated.cjs acceptance-team-candidate tests/agent-teams-autopilot.test.cjs tests/agent-teams-lifecycle-hardening.test.cjs tests/agent-teams-runtime.test.cjs tests/agent-teams-planning-contract.test.cjs tests/agent-teams-task-submission-protocol.test.cjs tests/agent-teams-stop.test.cjs tests/agent-teams-concurrency.test.cjs tests/agent-teams-task-occ.test.cjs tests/agent-teams-professional-capabilities.test.cjs tests/agent-teams-domain.test.cjs
```

运行停在runtime:1139的`model tools create a team, spawn independent members, and relay with non-user authority`，没有最终计数。按总审确认终止后台job，Host回执`killed before exit`；保留`acceptance-team-candidate.log`265行部分输出。**主动终止不是代码exit1失败，也不把前面绿色项加总为全套通过**。

仅对该项做一次有界诊断：

```powershell
node .artifacts/audit-20260912/run-isolated.cjs acceptance-team-bounded --test-timeout=60000 '--test-name-pattern=model tools create a team, spawn independent members, and relay with non-user authority' tests/agent-teams-runtime.test.cjs
```

exit 1，1 test / 0 pass / 0 fail / **1 cancelled**，明确`test timed out after 60000ms`，60.117s。日志`acceptance-team-bounded.log`、命令回执`acceptance-team-bounded-result.json`。同一原始首轮大测试曾在23.448s通过；该候选不能验收。

独立代码审查发现强等待环线索：新ready relay在`index.js:9196-9209`的`store.read`回调中返回异步`queueAgentTeamPrompt`；真实`store.read:4311-4321`在全库`queueStoreMutation`中await reader；原测试`runtime:2183-2195`在relayGate挂起期间先await unrelated startTeam，之后才releaseRelay。前者占读队列等待dispatch释放，后者需要同一队列提交后才释放dispatch。新增autopilot测试的fake store不模拟真实串行锁，无法捕获该环。未取得运行栈，因此将其标为高置信代码级归因线索，而非伪造栈定位；未修改候选、未修复其生产任务。候选hash见`unsubmitted-team-candidate-hashes.json`，两个文件语法及scoped diff检查exit 0，不抵消运行超时。

## 本批验收结论与待办

- **可提交本验证任务**：全项目可行基线及局限已记录；凭据行为44/44和安装胶合4/4、MCP行为49/49均独立通过；只读/fixture候选检查及超时证据已提交总审。
- **不是全产品完成/全绿证明**：旧版本/历史hash/6项UI契约仍未更新，4个首轮文件异常未定根因，Windows深路径边界未修。运行中1.0.62实例从未修改或验证，不声称已部署修复。
- **Teams未提交未验收**：候选精确用例60s超时，原生产任务仍须在Host允许的真实聊天新轮次恢复后修复、由原/恢复成员claim-bound提交，再重新验收；本验证提交不替代该生产交付。
- 所有后台任务已收集终态；无持续执行的测试或未声明的后台工作。
