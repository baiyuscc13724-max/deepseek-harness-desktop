# Teams 候选与九项契约：独立复验

## 结论边界

本报告仅复验总审指定的两个产物：恢复后的 Teams 候选，以及九个过期契约测试更新。不是第二次全仓扫描，不代替其他域的生产修复、复制粘贴/手机同步或最终全量验收。维护 checkout 仍为 `D:\DeepSeek-Harness-Desktop\release-v1.0.28-worktree`（源码1.0.60）；运行中的Desktop 1.0.62没有被本复验修改、重启、部署或操作。

**本范围建议接受两份产物**：Teams独立40文件623 tests /621 pass /0 fail /0 cancelled /2 skip；九契约67/67与隔离证明4/4通过。作者的71项实际为后两个不重叠集合，不能称九个文件本身71项。全部指定运行仅各执行一次；138项绑定输入在各次运行前后均无漂移。仍保留深Git成功红、安装版wait_for_change缺口和真实GUI/跨端未覆盖，不代表全产品全部功能已完成。

### 运行结束后的并行源码漂移（必须随签收保留）

上述建议仅限各次执行绑定的输入与契约测试改动。提交前最终hash检查另报exit1：`plugins/dsh-desktop-web-search/lib/index.js`在12:46:24 Teams阶段结束之后被并行域修改；本复验没有改该文件。`post-run-drift.json`于12:50:46记录原hash `24e7f3ccaa3a0a20c4140a7a78be4c97ff385eaf15f4bb01d2a803108ff2a3e1` → 新hash `c3f719465f8dcf31cdcaed67323c94ab56077f5c6982c4d135befb06051f1b02`。这不抹去已完成阶段的无漂移证据，也不能把旧测试结果静默背书给最新Web Search实现。Teams三个被验收生产文件和九个测试未变化；最新搜索实现及整仓集成归相应域/全量验收。未自动重跑本40文件或其他全集。

12:52:21的`delivery-hashes.json`还记录 `tests/deep-audit-integration.test.cjs` 在运行后发生变化：`03cfa035da283ea92033f1d0e51c3e0501b6820d75e81874d801f6041255f02d` → `c42a10cc35cba9ab6e98e5e9f90ec3147a62b600e65e61b82fb60af44ad8771b`。原4项隔离证明仍仅对应原字节；没有将后续测试改动冒充已执行。guard文件本身未列入漂移。

`check-output.cjs`保留最终源码门禁为失败；仅改为先落盘变化与当时交付文件hash，再以exit1结束，不重绑或覆盖原baseline。报告随后补充这两项漂移，最终报告摘要单列`report-sha256.json`；`delivery-hashes.json`旧报告hash保留，不伪称它是更新后报告hash。Markdown结构与代码语法检查不是源码门禁的替代。

总审已确认：Teams三个稳定候选hash可建议接受；九契约的执行证据绑定当时sourcehash，最新Web Search由配置域/新验收只重跑相关契约后，再作当前工作树最终接受。因此本报告对九契约的建议是**代码改动审查通过、冻结输入执行通过，不代替最新集成签收**。不扩大本域范围或重复623项。

## 输入绑定与安全隔离

- 独占输出：`.artifacts/deep-audit-independent-review/` 与本报告；未修改生产、九契约原测试或其他报告。保留第一阶段全部dirty修改。
- `inputs-before.json` 绑定40个Teams文件、九契约、一份四项隔离证明及相关生产/版本/历史快照等共138个文件；这是有限相关输入清单，**不是穷尽动态依赖图**。各次运行记录自己的 `inputs-after.json`，比较前后SHA256。
- Teams三个候选生产SHA256精确匹配作者最终交付：

| 文件 | SHA256 |
|---|---|
| `plugins/dsh-agent-teams/lib/index.js` | `f526ab58cd77ee670a069caf451461bc1207dccefab011589d0af499bbadaf3a` |
| `plugins/dsh-agent-teams/lib/client.js` | `ed8247bdaf14190c885e91be64677dc10e33cc7f1e3ab2f4a6935b36229036ee` |
| `plugins/dsh-agent-teams/lib/git-workspace-adapter.js` | `2d53e573bcab261346b560d77b40fc4176a28b170b067b2769eb54979ed46c4e` |

- `contracts-before` 的九份原始字节，逐项SHA256与其manifest **9/9匹配**；逐份旧字节→新测试diff已保存为本域 `*.test.cjs.diff`。不是只看Git HEAD后声称知道原始脏差异。Teams的 `teams-head-diff.txt` 仅供最终源码审查；相对HEAD的整份差异不等于本轮作者新增改动。
- 先读取现有 `.artifacts/deep-audit-20260912/offline-guard.cjs`；只读借用guard，不调用会写其他域证据或扫描全仓的旧runner。独立 `run.cjs` 从空env白名单起步，仅保留Windows系统/CPU变量；PATH仅Node、bundled Git、System32。每阶段各新建专用短TMP及独立HOME/USERPROFILE/APPDATA/LOCALAPPDATA/DSH_HOME；清理只针对本阶段创建的临时根。
- 不继承DSH控制/会话/能力端点、认证、提供商密钥、代理、真实Git全局/系统配置或GUI opt-in。Git禁止交互认证；以临时空global config与`GIT_CONFIG_NOSYSTEM=1`隔离。
- Node guard只允许**当前进程实际创建登记**且仍存活的fixture server端口/pipe；不是放行整个loopback。60131固定拒绝；没有真实端点请求。全局fetch/net受guard，非Node原生Git不是OS网络/文件沙箱；其路径和操作仅为已审查的本地临时repo。这不能证明任意未知第三方代码永远不可能绕过猴子补丁。
- 已知另域合成memory写入事故保持`outcome_unknown`边界：没有查询真实库、调用remember或探测真实能力端点，没有宣称删除/回滚该事故。

### 明确未执行，与skip分开

以下四项位于未纳入的 `official-runtime-patch` / `release-publisher` 文件，本runner还拒绝这两个文件意外入组；**未执行，不计pass，也不加到skip数**。没有为证明过滤而运行它们：

1. `installed alpha.5 MCP client and Goal tool`
2. `one publisher command exposes`
3. `publisher fails closed unless the desktop manifest`
4. `the real release audit`

九契约中的installer是明确传入 `mkdtemp` 内 `dshHome` 的真实临时安装函数，读取维护源码bundle、写临时profile，并非执行运行目录CLI或patch真实node_modules。例如 `model-admission-plugin-service.test.cjs:39-64`、`desktop-compaction.test.cjs:340`附近及各installer测试均如此；fixture在finally/t.after回收。

## 独立代码审查

### Teams

| 检查 | 独立观察及意义 |
|---|---|
| 真实Store锁外await | `index.js:9197-9221` 在最新store.read回调内同步鉴权及发起dispatch，但不返回外部Promise；立即装resolve/reject处理器，read解锁后才await dispatch。原`store.read:4311-4321`全库队列仍保持序列化，没有通过弱化Store修补。同步throw仍向外传播。 |
| 最后授权边界 | running与ready分支均在末端read内检查enabled、精确root、两team active、source/target pauseEpoch、身份和取消；running还比对原child对象、parent和admission generation/runId。没有在最后检查与dispatch之间新增await。 |
| 真实锁回归 | `agent-teams-autopilot.test.cjs:2001-2035` 新建实际磁盘AgentTeamsStore，transport挂起时要求无关mutation在1.5s内推进，再释放/settle/清理；不是原fake read。:2039-2081覆盖paused/resumed/retired/unconfirmed/disabled/root-replaced/aborted/transport八种边界，验证零派发或一次失败、持久failed与后续mutation可推进。 |
| CAS异常分流 | `commitTeamPlan:7738-7840` 先执行精确自动轮、当前root/项目/Stop/grant/能力/效果校验，后四处CAS预览错误才标记同一个异常对象。catch不是按错误码广泛豁免，未绕过危险状态撤销。安全四类误用与风险叠加旧CAS的10种负面组合仍在测试。 |
| 设置防重及换会话 | `client.js:3543-3597` 同步saveRef阻同帧双写；read/load使用alive+context对象，save使用context.active+精确request。切到B后A回执不能写值/授权/成功提示/busy。初始读取失败不展示可提交默认表单，有`role=alert`和重试。失败重读权威配置仍有current guard。 |
| 恢复与本地导航 | reconciliation同步requestRef、确认后再提交、同步throw归拒绝、finally释放；暂停阻止“已送达”。retry/replace共享锁。六项VM测试调用完整client实际handlers，导航有名且只修改本地view，无fetch。仍非React DOM、键盘焦点或布局验证。 |
| Git防半成品 | Git adapter最终diff只含只读探测与initialize/task/merge三个调用点；实际Git `--git-dir ... rev-parse --is-bare-repository` 精确识别`$GIT_DIR too big`，没有魔法长度、alias或更换canonical路径。initialize在mkdir/init/fetch之前，task/merge在prune/add之前探测。两新增测试运行真实bundled Git并验证无写入、源HEAD/status未变与正常生命周期。 |
| 安装版本缺口 | 当前源码team_status仅注册team_id，无wait_for_change实现；不能将源码fixtures通过等同于安装1.0.62被动等待/授权投影问题已修。 |

前次不通过证据仍完整保留在 `AUDIT-20260912-VALIDATION.md`：旧候选runtime:1139大用例60秒cancelled；最初基线该项23.448s通过。恢复后的独立结果按本报告测试表给出，不覆写原失败。

深canonical Git成功红测 `deep-audit-session-files.test.cjs` **不在本次40文件名单**，没有删除、改断言或重跑。预检通过仅表示防半成品与清晰拒绝，metadata-only长行政目录和完整深路径成功链仍未解决。不能把短临时路径的正常Git成功冒充深路径支持。

### 九契约是否仅“涂绿”

| 文件/组 | 核对结论 |
|---|---|
| compaction / directory-picker / web-search / mobile-control / model-admission五个installer | 删除固定过期1.0.59，改为读取实际源bundle manifest，并比对返回/临时目标版本及名称。原patch单例、幂等、坏core重装恢复、Host-only身份与临时backup检查保留；mobile新增finally清理。这验证安装一致性，不证明发布版本正确或整个安装事务具备崩溃原子性。 |
| mobile-release-version | 直接解析checked-in properties的字面值，再核root集成版本、mobile revision关系、编码与reader/资产名。原独立数值编码、历史单调性和非法输入负面未删。没有把读取器返回值与自己简单自比。 |
| release-version-sync | 从当前root semver导出候选身份，核lock、15自有插件、独立第三方版本、移动/iOS、UA、workflow与示例。README稳定历史与当前候选分别约束；未改README/历史hash/manifest来涂绿。全零checksum仅示例身份，不声称真实发行签名/哈希有效。 |
| browser-codex-api | 实际生产`runBrowserPlaywrightOperation`的fill会DOM.focus→verify.focused→同一WebContents.selectAll→Input.insertText。旧fake未回focused/未提供selectAll而提前失败；新fake补当前受信输入契约并记录调用顺序。focused:false负面要求零selectAll/insertText及cleanup；原dblclick/partial fill/select失败仍unknown outcome。未操作真实浏览器或剪贴板。 |
| desktop-ui-automation | 实际WindowsDesktopUi要求`controlSource.perform`回focused才回落provider.keyboard。新fake提供聚焦回执并验证顺序；新增无回执时focus-unverified、零keyboard、零坐标fallback，旧安全/跨浏览器/stale/Stop负面保留。不是实际Windows UIA/系统剪贴板验收。 |

上述调整与现存生产路径一致，未发现以改生产版本/删负面断言/重写历史hash制造成功的行为。

## 可复验命令、计数与证据

工作目录均为维护checkout。`run.cjs`的groups由首次快照固定：Teams37个agent-teams*.test.cjs加audit-team-autonomy、git-workspace-adapter、git-bundle-transfer，共40文件；九契约精确路径在 `inputs-before.json`。每次新Node、串行、单测90秒/阶段10分钟上限；拒绝覆盖既有运行目录。

| 命令 | 独立结果 | 证据 |
|---|---|---|
| `node .artifacts/deep-audit-independent-review/run.cjs snapshot` | 138个相关输入绑定；未执行生产 | `inputs-before.json` |
| `node .artifacts/deep-audit-independent-review/run.cjs proof` | exit0；4 tests /4 pass /0fail/skip/cancelled；0.418s；输入无漂移 | `proof/command.json`、`proof/output.log`、`proof/result.json` |
| `node .artifacts/deep-audit-independent-review/run.cjs contracts` | exit0；67 tests /67 pass /0fail/skip/cancelled；1.122s；输入无漂移 | `contracts/command.json`、`contracts/output.log`、`contracts/result.json` |
| `node .artifacts/deep-audit-independent-review/run.cjs teams` | exit0；623 tests /621 pass /0fail/cancelled /2skip；151.392s；输入无漂移 | `teams/command.json`、`teams/output.log`、`teams/result.json` |

原曾60s超时的runtime注册大用例此次11.421s通过；真实Store锁回归45.591ms通过，八种晚期围栏/即时transport拒绝全部通过；真实Git预检两项、设置/恢复/导航六项handler回归均通过。两项skip精确为`artifact-fixture smoke boots real DSH Web, proves state and SSE, and renders desktop plus 390x844 Electron viewports`和`Agent Teams P1 release-blocking matrix dynamically executes every security and durability gate`，仍为未启用的opt-in，非通过。

Teams日志SHA256 `c5d4c62fc4180187ef7a4fbbdd360b717e289d0c4d991dac139a62148c68773f`；两后台job均已收集exit0终态，无遗留测试。

proof日志SHA256 `35e51a3c419bb4e1d65f395bbc267f37f5f32f2831f81c9ce5b4950f2d44ebeb`；contracts日志SHA256 `cd0ddec3ee71d6d3a1d52b962ce2ee8aca1b6ca707e93e263c445bc38e78ab67`。九份old→new `git diff --no-index` exit1表示存在差异，不是执行故障；其他diff错误会使保存命令失败。

本报告仅供固定总审独立接受。作者完成、此次工具成功与全产品全部功能通过是不同层级；禁止把本复验升格为真实安装/发布/手机端完成证据。
