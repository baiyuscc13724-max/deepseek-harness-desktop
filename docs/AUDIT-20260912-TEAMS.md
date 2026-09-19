# Agent Teams 自动化与恢复可靠性审计（2026-09-12）

## 范围与证据边界

- 首轮范围为维护源码 `plugins/dsh-agent-teams/lib/index.js`、`tests/agent-teams-autopilot.test.cjs` 和本文；恢复轮另修 `client.js`、`git-workspace-adapter.js`，新增 `tests/audit-team-autonomy.test.cjs`、`tests/agent-teams-git-path-preflight.test.cjs`，同步一条 `tests/agent-teams-ui.test.cjs` 的源码契约。本轮未安装、发布、打包或修改承载审计的运行插件/会话/授权状态。
- 开始时维护 checkout 已有大量未提交变更。`index.js` 修改前 SHA-256：`405467D7C10A391F41D73D20C080CFBE79A5E8A5D9DCCCF19EDCBFC942D84264`。`agent-teams-autopilot.test.cjs` 开始时未出现在 `git status --short` 的脏文件中。
- 既有变更包含专业能力与交付协议、任务动作投影、运行中成员原位 steer 的实现等；保留它们，不归为本轮新修复。Git 相对 HEAD 的整份 diff **不等于**本成员的新增变更。
- 状态机、admission、grant 与共享 fixture 耦合，采取一个写者顺序修复；未子委派。结构判断已记录到 claim-bound checkpoint。

## 新发现与最小修复

### 1. 安全自动重提交的 CAS 预览错误误撤销 grant

**复现**：当前精确自动 Goal 回合、安全内部计划、完整有效 grant；仅传过期 revision、过期 hash、缺少 revision 或缺少 hash。原实现虽按预期拒绝 CAS，却在统一 catch 撤销 autopilot、轮换授权并 disarm Goal。四个新增子测试修复前全部失败，失败差异显示 `active -> revoked`，原因分别为 `AGENT_TEAMS_STALE_PLAN` / `AGENT_TEAMS_PLAN_CAS_REQUIRED`。

**修复**：`commitTeamPlan` 先保留原本所有当前 root/项目/Stop/Goal/grant/能力/效果校验，仅对随后四处 CAS 校验实际生成的**同一个异常对象**记录 recoverable 标记。catch 不再为这个无副作用预览拒绝撤销原 grant；旧 revision/hash 仍不能提交。刷新 Host 快照后的精确请求正常成功。不是按错误码广泛豁免，也不生成新的授权。

**反向验证**：项目变更、Stop、pause epoch 漂移、未知能力、confirm_each，分别组合正确 CAS 与错误 CAS；风险必须先被拒绝，grant 仍撤销、Goal 仍 disarm。既有未授权普通回合、缺 grant、未知外部结果、预算等边界回归不放宽。

### 2. Ready 成员转达等待 admission 后使用旧 active 快照

**复现**：ready 成员转达进入 admission；在最终 operation 前将持久团队状态改为 paused。原实现检查 admission 前读取的旧 `targetTeam`，仍调用队列 API；新增 Stop 负测修复前报 `Missing expected rejection`。

**修复**：ready 投递与 running steer 一样，在实际派发之前从 store 重新读取 source/target，确认当前 active、成员身份、固定 root、跨团队约束和取消信号。准备消息时捕获 source/target pauseEpoch，两个投递分支都复核；即使 Stop 后显式 Resume 回 active，也不能借旧消息跨 epoch 启动。保持最终检查与调用之间无新增 await。

**反向/正向验证**：未暂停 ready 消息仅派发一次，返回 `queued`；admission 后 paused 或 epoch 已推进时零派发。未将 transport acceptance 冒充模型 `delivered`。

## 既有修复的行为复核（非本轮生产新增）

- 单槽全占用、已注册 running 子成员有精确 adopted run：转达只同步 steer；不新增 admission 槽位或 waiter，不再次 queue activation，回执为 queued。新增独立 fixture 验证通过；专业能力协议测试另有真实插件注册路径的相同覆盖。
- 自动恢复 retry 保留精确 claim/lease，not_started admission 失败可恢复，outcome_unknown 仍隔离；任务必须 claimant 提交后由 root 独立接受才能解锁依赖/收尾。
- 7 MiB 历史、20 次重复投影，一/双团队 parking 保持无额外写入；实际 submission/dependency/failure 转换才触发有界 wake。

## 测试记录

修改前核心基线：145/145 通过（autopilot、lifecycle-hardening、runtime、planning-contract、task-submission-protocol）。初始命令曾包含不存在的 `tests/agent-teams-passive-wait.test.cjs`；当前 Node runner 未执行该缺失文件，**145 不代表有 passive-wait 覆盖**。

复现命令：

```powershell
node --test --test-name-pattern="safe automatic recommit CAS" tests/agent-teams-autopilot.test.cjs
# 修复前：四个行为子测试均红，父测试也记 fail。
node --test --test-name-pattern="relay steers|ready-member relay" tests/agent-teams-autopilot.test.cjs
# 修复前：running/ready正常路径绿，admission 后 Stop 负测红。
```

集成回归命令：

```powershell
node --test tests/agent-teams-autopilot.test.cjs tests/agent-teams-lifecycle-hardening.test.cjs tests/agent-teams-runtime.test.cjs tests/agent-teams-planning-contract.test.cjs tests/agent-teams-task-submission-protocol.test.cjs tests/agent-teams-stop.test.cjs tests/agent-teams-concurrency.test.cjs tests/agent-teams-task-occ.test.cjs tests/agent-teams-professional-capabilities.test.cjs tests/agent-teams-domain.test.cjs
```

首轮候选随后被独立验收判为**不通过**：真实注册路径大用例超过60秒超时，根因是 ready relay 把外部 dispatch Promise 返回给持有全局队列的 `store.read`。首轮 fake store 未模拟此锁。以下恢复轮记录纠正此缺陷；不能用首轮 scoped diff/语法通过抵消当时运行超时。详见 `AUDIT-20260912-VALIDATION.md` 的未提交候选验收。

## 已安装实例局限 / 未证实的根因

协调者报告本轮已安装实例：team_message 对 running/ready 成员出现约30秒 admission timeout，failed_delivery 导致 wait_for_change 立即 attention；直接父子 send_message 可送达；team_status 未投影 autopilot grant，即便安全 direct-human recommit 成功。这里只记录**协调者观察**，未访问私有授权状态、未据此修改当前实例，也不能把源码 fixture 通过当成安装版已修复。

维护源码的 `team_status` 当前没有 `wait_for_change` 实现，且没有源测试 `tests/agent-teams-passive-wait.test.cjs`；不能将安装版等待行为与本次源码结果混同。既有 `deriveAttention` 保留 failed 消息，因为后续给同一收件人的无关成功不是该旧 payload 的重试证明；本轮未通过删除警告伪造可等待。未知/未绑定 admission generation 也未被强制释放以掩盖真实生命周期问题。

建议后续在发布集成阶段核对实际组件版本与最终交付一致性，单独建立消息重试/确认血缘与 passive-wait 行为验收；不在本任务无界扩张或绕过 Stop/权限/审批边界。

## 恢复轮：新增修复与复现证据

### 3. 真实 Store 全局锁等待环（高优先，已修）

`AgentTeamsStore.read` 在 `queueStoreMutation` 内 `await reader(document)`。原候选在 reader 内 `return queueAgentTeamPrompt(...)`，因此外部消息接受没有完成时，所有团队的存储写入都被挂住。runtime 真实插件注册用例等待无关 `startTeam` 后才释放 relayGate，形成闭环。

新增 `real Store relay releases the global queue while transport acceptance is pending` 使用真实磁盘 Store，不是 fake read：修复前1500ms内无关 mutation 未完成，明确1项断言失败；测试随后主动释放门闩并完整清理，没有遗留挂起任务。修复在 `read` 中**同步检查最新权限并发起队列调用**，但不返回其Promise；立即安装 resolve/reject 双处理器，在 `read` 解锁后等待并传播结果。既没有把权限检查挪到旧快照，也没有吞掉 transport error。

精确注册路径命令（90秒上限，不接受超时为通过）：

```powershell
node --test --test-timeout=90000 --test-name-pattern="real Store relay|ready-member relay|model tools create a team, spawn independent members, and relay with non-user authority" tests/agent-teams-autopilot.test.cjs tests/agent-teams-runtime.test.cjs
```

首次修复后6/6通过，总11.82s；原超时大用例11.70s。随后隔离全Teams中再次通过。

### 4. admission等待期间被禁用仍可派发（安全强化，已修）

真实Store8种最终边界：paused、Stop后epoch推进、成员retired、shutdownUnconfirmed、设置disabled、root对象替换、AbortSignal取消、transport立即reject。修复前仅disabled漏拒（父/子合计2 fail）；在running和ready分支最后一次store.read补 `assertEnabled(document)`，修复后9/9通过。除transport应收到一次派发再失败，其余均零派发；failed回执被保留，失败后全局Store写入仍能推进。

### 5. 设置与恢复面板事件竞态（已修）

`audit-team-autonomy.test.cjs` 在VM加载**完整client模块**，使用持久hook槽位和显式render/effect边界，所有fetch都是测试内fake，没有实际Host授权/网络/设置写入。它不是React DOM或浏览器布局验证。

- 设置同帧双击Save原发两次POST，现同步request ref仅发一次；失败结束后允许用户明确重试。
- Session A保存未结束切至B，A迟到回执原把B显示的8覆盖为2并显示保存成功。现回执绑定context对象+active生命周期+精确request；旧scope不改新视图、授权缓存或busy状态。
- 初始读取失败原展示未经读取的默认值且没有重载路径。现未知状态不展示可提交表单，只显示可访问错误和“重试”；重新读到权威设置才恢复表单。
- 恢复outcome确认对话框原同帧双击调用两次reconcile；现同步单飞锁、同步throw转拒绝、失败释放锁。暂停状态不接受旧“确认已送达”提交；未跳过人工确认。
- 既有Retry/Replace的共享requestRef防重入，以及全部WorkspaceNav纯本地导航，新增行为回归通过。
- 原6项回归修复前4 fail/2 pass；修复后6/6。旧UI源码契约从无guard的 `then(applyState)` 改为断言精确 `if(current()) applyState(state)`，保留冲突后重读权威配置的要求，而不是删除测试。

### 6. Windows深Git路径：写入前防护已加，完整支持仍未解决

独立红测 `deep-audit-session-files.test.cjs` 的 `Windows deep canonical Git worktree remains usable without shortening roots` 由另一成员拥有，本成员只运行/读取，**未修改其成功断言**。

在Bundled Git `2.53.0.windows.2` 复现：bare repository 236字符，worktree行政metadata 289字符，workspace 224字符。原initialize在 `fetch` 时exit128 `fatal: '$GIT_DIR' too big`，`core.longpaths=true`不能消除。

有限试验及撤回：

1. 原canonical repositoryPath作cwd，`--git-dir .`可过fetch，但worktree add仍遇同一硬错误。
2. 原root不变、add使用相对path，错误转为289字符metadata `not a git repository`。
3. 单独及组合 `worktree.useRelativePaths=true` 都未完成open。
4. 上述relative-cwd、relative-add与config试验全部撤回，未提交别名、搬迁、格式扩展或Git定制fork。最终生产diff仅含只读预检方法和三个调用点，可用 `git diff -- plugins/dsh-agent-teams/lib/git-workspace-adapter.js` 核验。

源码定位：[Git v2.53.0 setup.c](https://raw.githubusercontent.com/git/git/v2.53.0/setup.c) 的 `setup_explicit_git_dir` 对GIT_DIR做 `PATH_MAX - 40` 检查；`read_gitfile_gently` 在realpath前检查is_git_directory。[builtin/worktree.c](https://raw.githubusercontent.com/git/git/v2.53.0/builtin/worktree.c) 的add_worktree把工作树path/.git放入子进程GIT_DIR。引用的是官方tag源码，不声称取得当前生产堆栈。

最终最小防护不写固定长度阈值：向**实际可信Git二进制**发出只读 `--git-dir <原计划路径> rev-parse --is-bare-repository`；仅精确识别它返回的 `fatal: '$GIT_DIR' too big`。initialize在任何mkdir/init/fetch前预检；task-worktree在prune/add前预检；merge-worktree在add前预检。返回 `GIT_ADMIN_PATH_TOO_LONG` 和可操作错误，说明需要真正较短的canonical存储配置或更新Git支持，不能通过alias混淆身份；不会自动更换用户路径。

新增2项实际Git fixture通过：深authority没有任何init/fetch/worktree调用，authority/workspaceRoot均尚不存在，source HEAD/status不变；深workspace没有prune/add且目录仍为空；正常路径initialize→open→读取fixture文件→close仍工作。**这些是防半成品与错误恢复证据，不是把原深路径成功用例变绿。** metadata-only超长、其他Git内部限制仍可能在后续命令失败，不承诺本预检覆盖全部路径失败。

## 全功能审查清单（功能层级，不是分支覆盖率）

标记：**B**=实际模块/处理器/Store/临时Git行为回归；**S**=源码契约/静态界面检查；**G**=安装版或跨端边界缺口。表中Tests均指维护源码，不能外推为安装版每按钮已点过。

| 功能/按钮或阶段 | 安全与交互检查 | 证据 / 层级 |
|---|---|---|
| 代理团队入口、回到负责人对话 | 原会话打开而非fork/resume；缺能力可恢复错误 | UI、product-experience；B/S |
| 启用/关闭自动组队 | Host设置入口；有活动团队的禁用冲突不伪成功 | runtime、UI；B/S |
| 设置成员上限、同时工作上限 | 1–8整数范围、数值输入禁用状态 | configured-capacity、UI；B/S |
| 设置自动接力开关、预算、Save | 1–200；保留Host授权流程；双击/失败/切session | authorization-service、autopilot、audit-team-autonomy；B |
| 设置首次加载、错误重试 | 不用默认值冒充权威配置；明确reload | audit-team-autonomy；B |
| 进展与成果、画布、成员、消息、自动化导航 | 所有按钮具名、唯一目标、本地导航零HTTP副作用 | audit-team-autonomy；B |
| 活动团队切换、已关闭团队历史 | 显式选择；不会隐式恢复团队或关闭后台执行 | UI、workbench-ui；B/S |
| 新团队模板/准备草稿 | 只写composer draft，不自动发送 | runtime、UI；B/S |
| 更多操作：新增成员/另一团队/建任务/协调/总结/关闭 | 每一项只生成有明确team目标的草稿 | client ActiveTeam prompts；UI；S |
| 暂停团队的继续按钮、关闭后的新目标按钮 | 仍需用户发出草稿；不通过点击直接越过Stop | UI、stop、runtime；B/S |
| 成员目录、活动侧栏、历史展开/更多 | 打开既有目录；按需加载；隐藏不取消工作 | UI、workbench-ui；B/S |
| 画布放大/缩小/重置、节点选择 | 有边界与可访问标签；只改变视图/打开精确实体 | UI、product-experience；B/S |
| 任务卡/详情/关闭、键盘Escape与Tab | 精确taskId；失效选择恢复；fixed inspector焦点约束 | UI、product-experience；B |
| 已完成/取消历史、submitted状态 | submitted≠accepted；取消不归活动列；结果文本安全展示 | task-submission-protocol、product-experience；B |
| 工作流/检查点/技能/交付详情 | 标注未验证/无法归因；技能已绑定≠已加载；不执行路径文本 | professional-capabilities、UI；B/S |
| Retry失败成员、Replace成员 | 仅故障成员/固定root；保留或撤销精确claim/lease | runtime、autopilot、audit-team-autonomy；B |
| 恢复未知结果确认已送达/未送达/取消 | 精确request+revision；人工确认；无重复投递 | lifecycle-hardening、runtime、audit-team-autonomy；B |
| 消息页、返回画布、inbound去重 | 仅元数据；queued不冒充delivered；跨团队不泄正文 | runtime、UI；B/S |
| 项目任务菜单：刷新/创建/认领/允许的状态转换 | request/OCC边界；只有Host投影允许动作 | UI、workbench-ui、cross-session系列；B/S |
| 项目自动化：刷新/定义动作/run动作 | 与Session reminders分离；批准/执行不由UI伪造 | UI、workbench-ui；S（真实跨端由基础域验收） |
| 提醒面板：刷新、打开完整提醒页 | 只读取/导航；不把提醒当Goal或Team恢复授权 | client AutomationWorkspace；S |
| 项目成员：创建/邀请/复制/准备加入/批准/完成加入 | schema限定与权限投影；复制码不执行；未用真实账号操作 | UI/workbench契约；S/G |
| LAN：开启/停止/连接/刷新；Relay：保存/连接/断开 | 由Desktop桥实际认证；插件侧仅动作白名单/状态显示 | client ProjectTeamEntry；S/G（桥属其他成员） |
| 协作席位：筛选/加载更多/详情/关闭/准备请求 | 脱敏project投影、分页、不可用状态；根会话身份由Host | cross-session-board、workbench-ui；B/S |
| L1/L2/L3路由、start/bootstrap | 同回合幂等、纯前置校验、任务先于成员发布 | planning-contract、runtime、multi-team-routing-policy；B |
| 草稿修改→CAS commit→首次发布 | 正确hash/revision；stale CAS不能扩大权限且不误撤销安全grant | planning-contract、autopilot；B |
| task创建/依赖/文件占用/capability/effect | 冲突/跨项目/未知权限/确认型效果fail-closed | domain、task-occ、planning-contract；B |
| task claim→checkpoint→submit/complete别名 | exact claimant、claimId/epoch；报告不等于完成 | task-submission-protocol、runtime；B |
| root accept/reject/reopen/cancel/assign/unassign/release | OCC/暂停epoch；提交前不能accept；账本保留 | task-occ、task-submission-protocol、runtime；B |
| 提交→独立接受→解锁依赖→收尾 | 未接受不能关；最后可分配成员不遗弃pending工作 | domain、runtime、autopilot；B |
| 运行中steer、ready重新admit | running不吃第二槽；realStore不持全局锁等transport | autopilot、runtime、professional-capabilities；B |
| admission等待后Stop/Resume/disable/成员变化 | 最新快照+epoch+root+signal；失败不留锁 | autopilot新增realStore8边界；B |
| failed retry/replace/reconcile、not_started/unknown | 精确恢复身份、有限重试、未知不得复制成员 | lifecycle-hardening、runtime、autopilot；B |
| Stop、两阶段Resume、epoch失效 | Stop阻新写；明确Resume不隐式唤醒；异常节点隔离 | stop、runtime、lifecycle-hardening；B |
| graceful退役/关闭、force取消、orphan/handoff/adopt | 未完成任务不漏账；失败关闭不伪closed；同项目/精确root | runtime、domain、lifecycle-hardening；B |
| 全局默认授权→精确team grant→自动回合 | 缺grant/撤销/漂移不造唤醒；安全重提交可复用 | authorization-service、autopilot；B |
| 停泊/有界事件唤醒/预算/去重 | 7MiB历史20轮无额外写；仅有效持久转换触发 | autopilot、performance；B |
| 选中团队attention隔离 | 真实Store中旧team failed_delivery不污染无关team | autopilot新增attention-isolation；B |
| `team_status(wait_for_change)`被动等待 | 维护源码注册参数仅team_id，没有wait实现 | index注册与grep；G（安装1.0.62另查） |
| 活状态SSE/断线/重连/隐藏页/卸载 | monotonic快照、单subscription、过时回执拒绝、timer清理 | UI、workbench-ui、loading-regression；B/S |
| Git workspace/bundle/merge/CAS/cleanup | 仅临时repo；来源身份/签名摘要/孤立worktree边界保留 | git-workspace-adapter、git-bundle-transfer；B |
| Windows深路径 | 实际Git预检零半成品；完整成功链明确仍红 | git-path-preflight；B，成功支持G |
| 子代理driver与workflow seam | 只读alpha.5依赖映射；成员禁止hidden workflow/subagent工具 | node_modules入口阅读+插件MANAGED_MEMBER_DENIED_TOOLS；S/G |

## 版本差异与只读依赖映射

- 维护 `index.js` 的team_status注册只有 `team_id`，没有 `wait_for_change` 参数/实现；`deriveAttention` 从传入team.messages取failedDeliveries，并非全局消息集合。新增真实Store两团队回归证明旧历史失败不会污染另一个team的attention，仍保留旧payload审计。因此安装1.0.62“attention空却wait.reason=attention”在本维护源码**无对应等待实现可修**，已向总审交接，未增造第二套等待机制。
- `node_modules/@deepseek-ai/dsh-subagent/lib/types/internal.js:42-43` 的 `queueHostSubagentPrompt` 只是同步调用symbol队列接口；它返回Promise不能作为无锁回调。已阅读 `dsh-subagent-in-process-driver` 与 `dsh-workflow` package.json，都是 `0.1.2-alpha.5`；driver是spawn/fork共用子运行驱动，workflow是Service seam，不是完整编排引擎。只读这些依赖，不修改node_modules或安装版；没有付费LLM工作流端到端证明。
- 无真实GUI点击/多尺寸截图/安装版HMR验收；Markdown报告仅结构检查，不调用运行实例右栏预览。

## 最终执行与隔离说明

- 所有整套测试由新Node进程运行，空env起步仅保留Windows执行路径/系统/CPU变量，另设独立临时HOME/USERPROFILE/APPDATA/LOCALAPPDATA/TMP/TEMP/DSH_HOME及CI；不继承提供商密钥、DSH能力端点、会话授权、代理或真实应用配置。Git fixture另禁用系统/全局gitconfig和交互认证。
- 新UI回归的fetch全部fake；新realStore回归的agents/goals/admission/transport全部fixture，仅Store真实磁盘；Git回归只使用mkdtemp内自己新建的source/authority/worktree，可信bundled Git进程本身是真执行。已有服务测试使用fixture桥/临时状态或本地测试server；未开启两项安装/Electron opt-in。环境隔离不是OS网络/文件沙箱，不能夸大为任何未知第三方代码都不可能联网。
- 修复初次整套：`node --test --test-concurrency=1 --test-timeout=90000 tests/agent-teams*.test.cjs`，587 tests /585 pass/0 fail/2 skip，82.54s。此时尚未包含恢复轮UI、late-disabled、attention与Git预检新增项。
- UI+Git预检定向：49/49通过，3.14s；源码diff检查通过。旧UI有一条源码正则因改为scope guard短暂失败，已更新为检查精确guard并由VM行为断言覆盖，不是产品残余运行失败。
- 最终恢复验收：40个测试文件，**623 tests / 621 pass / 0 fail / 0 cancelled / 2 skip / 0 todo，150354.8389ms，进程exit 0**。Node `v24.16.0`；本次受管后台作业 `pwsh-65` 已收集终态，没有遗留测试作业。两项skip是 `artifact-fixture smoke boots real DSH Web...` 与 `Agent Teams P1 release-blocking matrix...` 的既有opt-in门禁；不声称通过它们或已完成发布验收。
- 最终测试中的原真实注册路径大用例：10661.7144ms；真实Store锁回归45.3503ms；最后围栏8种变化均通过；安全CAS四种误用及10种风险/CAS组合全部通过。Git正常生命周期、bundle验证、head CAS、失败FIFO恢复均通过；UI六项真实handler回归全部通过。
- 这次恢复没有增加生产修复：保留前两次候选，只复读核对、运行最终回归并补完本文。上述较早红→绿和587项记录来自继承报告/交接；本次独立直接观察的是623项终态与下列文件哈希。开始核对时没有正在执行的Node测试，也没有本恢复会话可收集的旧job，因此只启动这一轮最终全集。

### 可复验命令

工作目录为维护checkout。以下与最终执行同构：空环境白名单，不修改当前进程/用户永久环境；先记录完整文件列表，37个 `agent-teams*.test.cjs` 加3个相关行为文件。不要用运行实例的授权环境直接替换隔离环境。

```powershell
node -e 'const fs=require("node:fs"),os=require("node:os"),p=require("node:path"),cp=require("node:child_process"); const root=fs.mkdtempSync(p.join(os.tmpdir(),"teams-final-recovery-")); const env={}; for(const key of ["PATH","Path","SystemRoot","SYSTEMROOT","WINDIR","ComSpec","COMSPEC","PATHEXT","PROCESSOR_ARCHITECTURE","NUMBER_OF_PROCESSORS"]) if(process.env[key])env[key]=process.env[key]; for(const key of ["HOME","USERPROFILE","APPDATA","LOCALAPPDATA","TMP","TEMP","DSH_HOME"]) {env[key]=p.join(root,key);fs.mkdirSync(env[key],{recursive:true});} Object.assign(env,{CI:"1",GIT_CONFIG_NOSYSTEM:"1",GIT_CONFIG_GLOBAL:p.join(root,"empty.gitconfig"),GIT_TERMINAL_PROMPT:"0"});fs.writeFileSync(env.GIT_CONFIG_GLOBAL,""); const tests=fs.readdirSync("tests").filter(x=>/^agent-teams.*\.test\.cjs$/.test(x)).map(x=>"tests/"+x).concat(["tests/audit-team-autonomy.test.cjs","tests/git-workspace-adapter.test.cjs","tests/git-bundle-transfer.test.cjs"]); console.log(JSON.stringify({tempRoot:root,node:process.version,files:tests})); const child=cp.spawn(process.execPath,["--test","--test-concurrency=1","--test-timeout=90000",...tests],{env,stdio:"inherit"});child.on("exit",code=>{console.log("FINAL_EXIT="+code);process.exitCode=code??1;});'
node --check plugins/dsh-agent-teams/lib/index.js
node --check plugins/dsh-agent-teams/lib/client.js
node --check plugins/dsh-agent-teams/lib/git-workspace-adapter.js
git diff --check -- plugins/dsh-agent-teams tests/agent-teams*.test.cjs tests/audit-team-autonomy.test.cjs docs/AUDIT-20260912-TEAMS.md
```

三项语法检查及scoped diff-check均exit 0。UI针对性技能检索 `double submit error recovery --domain ux` 返回 Error Recovery / Submit Feedback / Error Messages：现有重试入口、busy与成功/错误反馈、role=alert符合此次修复目标；未进行视觉改版、布局或真实React DOM验收。

### 新旧文件指纹与归属

HEAD=`c13249132532d73f26fdd5830fe6a225b5f51feb`。表中旧值是**当前HEAD blob**的SHA-256，不是任务开始时的脏文件快照；新值是本次最终验收读取的工作树文件字节。前述首轮 `index.js` 起始脏hash另行保留，其他起始脏文件hash未从可信记录取得，不能用HEAD冒充。换行差异也可能改变文件字节哈希。

| 文件 | HEAD blob SHA-256 | 最终工作树 SHA-256 |
|---|---|---|
| `plugins/dsh-agent-teams/lib/index.js` | `7b5e141f1907fefbc5528481a816ab10df9022aecfd2b850db7b41f057a14134` | `f526ab58cd77ee670a069caf451461bc1207dccefab011589d0af499bbadaf3a` |
| `plugins/dsh-agent-teams/lib/client.js` | `5a6a9ed1b2019d99495e3cfa680f945f08c6cc11e551347d16f645ff3904a271` | `ed8247bdaf14190c885e91be64677dc10e33cc7f1e3ab2f4a6935b36229036ee` |
| `plugins/dsh-agent-teams/lib/git-workspace-adapter.js` | `b3d88fb5fc221758647d21d2422bf1a8a0a5a5c4cd5a680947ade022dbbf4d4d` | `2d53e573bcab261346b560d77b40fc4176a28b170b067b2769eb54979ed46c4e` |
| `tests/agent-teams-autopilot.test.cjs` | `1010d340b1ed3f2b109b620e1e15e4e36a609e36a2f2725674e05419af71ba51` | `793d27dc2bc501b9de00ef8819a9afa0708983863d3f0d84c50f197ae63a8c94` |
| `tests/agent-teams-ui.test.cjs` | `f5b9989198a8fc32d2b28c64103fabda2f0dcbc6077bdbf1e52d710029c80ae4` | `301a25e217707ea05f2edf5efbafe66d3621128fb49d457986ec48cc522d1c3b` |
| `tests/audit-team-autonomy.test.cjs` | 新增，HEAD无文件 | `4485765ac063f3919dea1ef1c3a6ef7e27dee3cd2b91ad15635af4b300c09172` |
| `tests/agent-teams-git-path-preflight.test.cjs` | 新增，HEAD无文件 | `679e24a0adc0b0d71997bf558c08b089cd26d41a63a2016476276f5350329dda` |

最终交付结论：**本任务范围内的候选修复与上述维护源码回归可提交独立验收；不代表全项目或安装版已全绿。** 深canonical Git成功链仍是已知未解决项，独立红测未改动；`wait_for_change`不在维护源码实现内；两项opt-in与真实GUI/跨端/付费模型链路未覆盖。Provider/MCP已验收输出、当前运行实例、授权与发布状态均未由本次恢复改动。

