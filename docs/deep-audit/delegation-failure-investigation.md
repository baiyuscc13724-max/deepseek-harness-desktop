# 代理团队委派失败调查：7/7 成员在 work_followup 阶段中止

## 0. 结论（已由子会话日志直接证实，取代下文早期的假设）

**根因：子会话调用模型提供方时传输层失败。** 子会话自己的会话日志（`session.jsonl.zstd`，28 个 zstd 帧、解压后 339,756 字节、70 行）记录：

```
{"type":"assistant/chunk","seq":54,"time":1789800063024,"data":{"turn":2,"step":1,"chunk":{"type":"finish","reason":{"kind":"error","failure":{"message":"fetch failed","code":"TRANSPORT"}}}}}
{"type":"llm/retry","seq":55,"time":1789800063025,"data":{"retryId":"…","turn":2,"step":1,"provider":"openai-codex","mode":"normal","policyKey":"[\"normal\",5,[\"EMPTY_RESPONSE\",\"RATE_LIMIT\",\"SERVER\",\"TIMEOUT\",\"TRANSPORT\"…]]"}}
… 同一错误重复出现（seq 58/62/66），间隔约 15 秒 …
{"type":"turn/end","seq":68,"time":1789800107642,"data":{"turn":2,"reason":{"kind":"error","error":{"message":"fetch failed","code":"TRANSPORT"}}}}
```

即：成员的第 2 个 turn（就是 work followup 那一轮）在调用 `openai-codex` 时得到 `fetch failed`/`TRANSPORT`，按策略重试 5 次全部失败后本轮以 error 结束；上游据此产生 `SUBAGENT_ERROR`/`internal`/`work_followup`/`retryable:false`。

**这一条同时解释了三个观测**：① 分类器为何落到兜底分支（`transport fetch failed` 不含 timeout/rate_limit/overload/unavailable 任何关键词）；② 为何失败总在派出后约 40 秒至数分钟（约 15 秒 × 数次重试的预算）；③ 为何成员"零输出、无 claim"（连第一次模型响应都没拿到）。

**修复方向因此改变**：这不是插件/核心接口不兼容，也不是团队代码缺陷，而是**子会话到模型提供方的传输可达性故障**。下一步要查的是"为何根会话能正常调用而子会话失败"（路由/鉴权/代理/环境差异）。

### 本节撤回的早期判断

- 撤回"最可能是 `assertAdmitting` 的 `DRAINING` 或 `throwIfAborted()` 的 abort"——两者都被直接日志否定。
- 撤回"Host 不持久化原因、因此无法推进"——原因就在子会话日志里；**是我先前只解了第一个 zstd 帧**（该文件为追加式多帧，首帧仅 281 字节）才漏掉，并非 Host 未保存。
- 保留已被证据支持的排除项：不是内部子路径缺失、不是服务缺符号方法、不是档案插件陈旧（档案副本与应用自带插件字节相同）。

以下第 1–9 节保留为**历史推理过程**，用于审计追溯；其结论以本节为准。

### 系统级证据与已排除项（2026-09-19 复查）

**7/7 子会话全部失败，且是每个 turn 都失败**（不只是 work followup）。统计 `dsh-home/sessions/--D-DeepSeek-Harness-Desktop--/` 中最近 8 小时内被写入的会话：

| 会话（前 12 位） | origin | turns | 每个 turn 的结局 |
|---|---|---|---|
| 9947273d-311 | subagent | 2 | `error:TRANSPORT`、`error:TRANSPORT` |
| 4910a1b9-7a5 | subagent | 2 | `error:TRANSPORT`、`error:TRANSPORT` |
| f323213f-531 | subagent | 2 | `error:TRANSPORT`、`error:TRANSPORT` |
| 251a36e2-e32 | subagent | 2 | `error:TRANSPORT`、`error:TRANSPORT` |
| 53e9e653-bbf | subagent | 2 | `error:TRANSPORT`、`error:TRANSPORT` |
| 12674b06-011 | subagent | 2 | `error:TRANSPORT`、`error:TRANSPORT` |
| a1e18a84-08a | subagent | 2 | `error:TRANSPORT`、`error:TRANSPORT` |

对照 2026-09-13 成功的成员 `c6df5c07-7398-4b86-a3ef-6f40883d187e`：3 个 turn 全部 `completed`（3970 事件、129 step、168 次工具调用）。

**失败子会话** log 的关键事实：
- 它在 **turn 1** 就已经失败——即失败与 work followup 的提示词大小无关（turn 1 只有 943 字节的 provisioning 提示），也不是提示词结构问题。
- `subagent/descriptor`：`mode=continuable, provider=spawn, agentProvider=openai-codex, agentModel=gpt-6-astra`
- `sandbox/mode`：`danger-full-access`（source: delegation）
- `approval/policy`：`never`；`permission/preset`：`danger-full-access`
- `request/header` 的 provider/model 与根会话相同（`openai-codex` / `gpt-6-astra`，maxTokens 128000，contextWindow 272000）

**因此以下解释已被排除**：沙箱/审批/权限限制、提示词过大、provider/model 配置不同、团队插件逻辑缺陷、核心接口不兼容、档案插件陈旧。

**结论**：根会话能正常调用模型，而**同一时刻派生的每个子会话在其第一个请求上就 `fetch failed`**。故障位于**子会话的提供方传输路径**（鉴权/代理/端点），而不是沙箱策略或团队代码。`fetch failed` 是 Node 网络层错误，其底层 cause（ECONNREFUSED / ENOTFOUND / TLS 等）未被日志记录。

**尚待确定**：
1. 底层 cause 具体是什么（需要应用侧日志或从子会话等价上下文发起一次探针请求）。
2. 这是**持续性故障**还是某个时段的可达性中断（7 次失败集中在约 15 分钟窗口内，不能排除提供方/网络侧短时故障）。
3. 子会话与根会话在凭证、代理或端点上究竟有何差异。

### 区分根因：根会话被替换到可用后端，子会话没有（2026-09-19 定论）

对照同一时刻的根会话与失败子会话：

| | 声明路由（request/header + request/context） | 实际服务方 |
|---|---|---|
| 根会话 `session-3b7ae16f…`（本会话） | `openai-codex` / `gpt-6-astra` / maxTokens 128000 / contextWindow 272000 | **`opencode-go-v41` / `deepseek-flash`**（会话日志中 1001 条已记录响应全部如此） |
| 失败子会话 `12674b06…` | `openai-codex` / `gpt-6-astra`（`subagent/descriptor` 同为 agentProvider `openai-codex`、agentModel `gpt-6-astra`） | **无任何成功响应**，每个 turn 均 `fetch failed` / `TRANSPORT` |

**结论**：两者声明同一条路由，但根会话的请求**被实际转由可用的 `opencode-go-v41`/`deepseek-flash` 后端服务**，而子会话的请求**没有获得同样的替换**，直接对 `openai-codex` 发起并被传输层拒绝。这解释了全部观测：为什么根会话一切正常、为什么子会话连第一个 turn 都失败、为什么与提示词大小和沙箱策略无关。

**两条修复方向**

1. **用户侧（可立即生效）**：把子代理实际使用的路由指向当前可用的后端——即让 `dsh-home/harness-desktop-model-routing.json` 的 `main`/`subagent` 与 GUI 中实际可用（根会话正在使用）的模型一致，或修复 `openai-codex` 通道（重新授权/端点）。**总审未自行改该配置**：它属于运行中实例的数据，改动可能影响当前会话，需你确认后执行。
2. **产品侧（发现的真实缺陷，候选修复）**：上游诊断分类器把这种失败的**性质判错**了。`dsh-subagent/lib/index.js:279-333` 只在错误的 code/message 命中 `activation_teardown_failed`、`timeout`/`timed out`、`rate_limit`/`rate limit`/`overload`/`unavailable` 或 code 为 `pi_ai_error` 时归类；而 `code=TRANSPORT` + `message="fetch failed"` **一个都不命中**，于是落到兜底 `SUBAGENT_ERROR` / `category=internal` / `retryable=false` / `nextAction=view_live_status`。结果是：一次**提供方传输故障**被呈现为"成员内部错误且不可重试"，用户看到的是"成员崩溃"而不是"提供方可重试故障，请重试"。
   - 这属于既有的维护补丁框架（`scripts/patch-official-runtime.mjs`）可以处理的改动：为 `TRANSPORT` / `fetch failed` 增加一条分类规则，映射到 `provider_transient` + `retryable=true` + `nextAction=retry_current_task`。
   - **本轮未修改生产代码**：按既定约束，生产修复须先实证再单独限定任务；此处已完成实证（直接日志+分类器源码），可据此立项。

## 历史记录（推理过程，结论已被第 0 节取代）

## 结论摘要

本轮连续 7 次派出/替换的团队成员**全部**在启动后以同一诊断中止，零输出、零 claim：

```
errorCode: SUBAGENT_ERROR
category : internal
stage    : work_followup
retryable: false
partialOutputPresent: false
```

调查已把失败**收敛到"成员工作提示投递"这一段代码路径**，并排除了若干常见解释；**确切被抛出的错误文本尚未取得**，因为 Host 对成员派生失败不持久化 `rawDetail`/`errorMessage`。因此这不是"尚未查明"，也不是"已修好"——是机制已定位、最后一跳的错误原文待取。

## 1. 已确证的机制链（含证据位置）

| 环节 | 证据 |
|---|---|
| 插件投递成员工作提示 | `dsh-home/profiles/web/node_modules/dsh-agent-teams/lib/index.js:8589` 调用 `queueAgentTeamPrompt(ctx.subagents, lead, childId, workPrompt, …)` |
| 该助手先做能力探测 | 同文件 `5787-5792`：`if (typeof subagents?.[queueSubagentPrompt] !== "function") reject("continuable subagent prompt queue is unavailable", "AGENT_TEAMS_SUBAGENT_UNAVAILABLE")` |
| 符号与助手来自核心内部子路径 | 同文件 `9`：`import { queueHostSubagentPrompt, queueSubagentPrompt } from "@deepseek-ai/dsh-subagent/internal"` |
| 核心内部模块导出两者 | 运行核心 `dsh-subagent/lib/types/internal.js:31,42`（`queueSubagentPrompt = Symbol.for('dsh.subagent.queuePrompt')`；`queueHostSubagentPrompt` 调用 `runtime[queueSubagentPrompt](…)`） |
| 核心服务对象确实暴露该符号方法 | 运行核心 `dsh-subagent/lib/index.js:2870` `[queueSubagentPrompt](parent, childId, content, source, signal) { return this.requireContinuations().queuePrompt(…) }` |
| 我们本地维护补丁确实已应用到运行核心 | 同文件 `881`（`queuePromptWithActivation` 符号）、`1212`（实现）、`2874`（符号方法） |

失败发生在**初始 spawn 成功之后**：子会话已建立（其 `session.jsonl.zstd` 只有一行头记录，成功成员同样如此，说明转录不在此处），但工作提示投递失败，插件随即走 `settleSpawnedChildFailure(..., { phase: "work-followup", cause: error })` 并 `throw annotateStage(error, "work-followup")`（`index.js:8591-8595`）。

## 2. 已排除的解释（附排除理由）

- **不是内部子路径缺失**：运行核心 `dsh-subagent/package.json` 的 `exports` 含 `./internal`，且该目标真实导出两个名字。
- **不是服务缺少符号方法**：`[queueSubagentPrompt]` 在运行核心 `index.js:2870` 明确存在。
- **不是插件自身的"队列不可用"拒绝**：那条消息含 `unavailable`，而核心分类器（`dsh-subagent/lib/index.js:316`）会把含 `unavailable` 的错误归为 `provider_transient` 且 `retryable: true`；我们观测到的是 `internal` + `retryable: false`，两者不符。
- **不是档案插件陈旧**：档案 `web` 里的插件与应用自带插件**版本与字节完全相同**（均为 1.0.61，`lib/index.js` SHA `45dbd8e62ef97689d97bc6406d7cfa04d904c2f5d7fd30b8f5694a8c21fd4f89`）。

## 3. 由排除法得到的判定

核心分类器（`dsh-subagent/lib/index.js:279-333`）只有在错误的 `code` 与 `message` **同时不匹配**已知形态时才落到 `SUBAGENT_ERROR`；已知形态包括 `activation_teardown_failed`、`timeout`/`timed out`、`rate_limit`/`rate limit`/`overload`/`unavailable`、以及 `pi_ai_error`。

我们的错误一个都不匹配，因此**最可能是一个 `TypeError` 或普通 `Error`**，在核心 `queuePrompt` 投递路径内部（`requireContinuations().queuePrompt(...)` 或其下游）为这个精确的父子对抛出。这是一处**真实的投递路径故障／兼容性断裂**，不是守卫拒绝。

补充事实：本地维护补丁在运行核心上**已应用**（`queuePromptWithActivation` 三处齐备），所以不能把原因简单归为"补丁没打上"；但也正因为运行核心带着本地补丁，补丁与 1.0.62 上游代码的交互是必须排查的候选。

## 4. 为什么还不能直接给出修复

- Host 对成员派生失败**不保存** `rawDetail`/`errorMessage`（存储里只有上面 6 个字段），日志层也没有落盘：应用 `AppData/Roaming/deepseek-harness-desktop` 下无运行日志，`HarnessData/dsh-home` 无日志目录，会话日志只有头记录。
- 运行实例属于禁止操作范围（不替换/不重启/不改动），因此不能就地插桩取错误原文。

## 5. 候选项精化（本轮新增）

核心分类器（`dsh-subagent/lib/index.js:279-333`）只有在错误 `code` 与 `message` **同时**不含 `activation_teardown_failed`、`timeout`/`timed out`、`rate_limit`/`rate limit`/`overload`/`unavailable`，且 code 不是 `pi_ai_error` 时，才落到 `SUBAGENT_ERROR`。

沿投递路径 `[queueSubagentPrompt]` → `requireContinuations().queuePrompt(...)`（`index.js:1205`）→ `deliverToChild(...)`（`index.js:1221`）逐点核对后，**两个抛出点都能精确产生我们观测到的诊断**：

| 候选 | 抛出内容 | 是否含识别关键词 | 与观测是否一致 |
|---|---|---|---|
| `assertAdmitting(parent)`（`index.js:1452`，在 `deliverToChild` 内 `1222`/`1245` 两处调用） | code `DRAINING`，消息 "continuable subagents are draining; the operation was not admitted" | **否** | **一致**（落到 SUBAGENT_ERROR / internal / retryable:false） |
| `options.signal.throwIfAborted()`（`index.js:1246`） | 抛出信号的 abort 原因，通常是 `AbortError: This operation was aborted` | **否** | **一致** |

两者都指向**父/子生命周期时序**，而不是"接口不存在"。`assertAdmitting` 的语义是：一旦管理器或**这个确切父树**开始 draining，就拒绝新投递——即工作提示到达时，父树已被判定为正在收尾。

时序旁证：文档记录本插件受管 Team worker 的准入等待上限是 **30 秒**（`docs/AGENT-TEAMS-TASKBOARD-DESIGN-DRAFT.zh-CN.md:994`），而我们的失败发生在派出后约 40 秒至数分钟，与"等待后失败"的形状相符；但这一点是**时间形状上的吻合，不是证明**。

持久化侧普查（最新账本 `hot-4596`）：`errorCode` 共 6 处且**全部是 `SUBAGENT_ERROR`**，`errorStage`/`errorMessage`/`rawDetail` 均为 0 处。即 Host 确实只留 code，不留原因——这也解释了为什么单靠现有持久化证据无法再前进一步。

## 6. 要与不要

- **要**：在维护树内做一次受控复现并插桩，捕获被抛出的原始错误对象（`code`、`message`、`name`），据此判定是 `DRAINING` 还是 abort，再定位到核心、插件还是本地补丁。
- **不要**：据此就断言"接口不兼容"或"插件太旧"——以上两点均已被排除（见第 2 节）。
- **不要**：把 6 次 `SUBAGENT_ERROR` 当作 6 个不同问题；它们是同一条件的 6 次复现。

## 7. 为什么还不能直接给出修复

Host 对成员派生失败**不保存** `rawDetail`/`errorMessage`（第 5 节普查证实：账本里只有 6 个 `SUBAGENT_ERROR`，没有任何原因字段）；应用侧也没有运行日志（`AppData/Roaming/deepseek-harness-desktop` 无 log，`HarnessData/dsh-home` 无日志目录，子会话日志只有一行头记录）。运行实例又属于禁止操作范围（不替换/不重启/不改动），因此**不能就地插桩**取错误原文。第 5 节的两个候选目前**只有排除法支持，没有直接证据**。

## 8. 下一步（在维护树内，无需额外授权）

1. 在维护树内搭一个**受控复现**：同版本插件 + 对应核心，用合成 parent/child 走同一 `queueHostSubagentPrompt` 路径，捕获被抛出的原始错误及其 `code`，以判定是 `DRAINING` 还是 abort。
2. 按捕获到的错误定位是核心代码、本地维护补丁，还是插件调用形态；据此产出最小修复与回归测试。
3. 与核心兼容任务（`7d6fb1ee`）合并考虑：运行外壳/插件为 1.0.61、实际核心为 1.0.62，这个**版本错配本身**就是用户所说"核心有更新版本、需要完成兼容更新"的一部分；委派失败很可能是同一断裂面的一种表现。

## 9. 诚实边界

- 以上是代码级机制定位与排除，**不是**已复现的根因证明；确切错误原文仍未取得。
- 未运行、未改动运行实例；未发布；未触碰当前 GUI/账户/设备/剪贴板。
- 两个第四轮证据流（旧安装迁移、大快照时延）因委派不可用而由总审在主路线推进，其中手机链基线已复现成功（`run-2026-09-19T06-42-15-777Z-365216`，`ok:true`，Manifest JVM 31 项通过），但多样本矩阵仍未做。

## 10. 可立即执行的恢复步骤（用户侧；总审未擅自执行）

第 60 行的定论给出了恢复路径。**这是你一条命令级别的决定，不是代码修复**：

**要做的事**：把 `D:\Harness Desktop\HarnessData\dsh-home\harness-desktop-model-routing.json` 里的 `main` 与 `subagent` 指向**根会话实际被服务的那个组合**。该文件当前内容为：

```json
{
  "schemaVersion": 4,
  "main":     { "provider": "openai-codex",  "model": "gpt-6-astra" },
  "subagent": { "provider": "openai-codex",  "model": "gpt-6-astra", "inheritMain": true },
  "basePreset": "standard"
}
```

而根会话的日志记录显示它实际由 **provider `opencode-go-v41` / model `deepseek-flash`** 服务（1,001 条已记录响应），子会话则因直接打 `openai-codex` 而以 `fetch failed`/`TRANSPORT` 失败。因此把两个分支改成该可用组合（`provider: "opencode-go-v41"`, `model: "deepseek-flash"`）应当恢复委派。**若 GUI 的模型选择器对同一模型显示不同的 id，以 GUI 为准**（provider id 可能带版本后缀）。

**我没有自行改这个文件**，理由有两条：① 它属于**运行中实例的数据**，改动可能立刻影响当前会话；② 我无法在改动前确认 GUI 中哪些 provider 当前可用。

**白名单约束（两次核对，结论以第二次为准）**：同一 `dsh-home/settings.yaml` 里有

- `providers.opencode-go-v41`：存在，`displayName: opencode GO (V4.1 Flash)`，`models: [{ id: deepseek-flash }]`；
- `agent-default-model`：`provider: opencode-go-v41` / `model: deepseek-flash`（即桌面自己用的就是这对）；
- **`subagent-model-selection` 白名单**：只列了 `opencode-go/deepseek-v4-flash`、`opencode-go/deepseek-v4-flash-vision-exp`，以及 `openai-codex` 的 `gpt-5.6-terra`/`luna`/`sol`/`gpt-6-astra`——**不包含 `opencode-go-v41`**。

因此把 `subagent` 直接指向 `opencode-go-v41/deepseek-flash` **很可能被该逐 Session 白名单拒绝**。两条可行路径，任选其一：

- **A（推荐，改动最小）**：把 `harness-desktop-model-routing.json` 的 `main`/`subagent` 指向**已在白名单内且当前可用**的组合 `provider: "opencode-go"` / `model: "deepseek-v4-flash"`。
- **B**：先把 `opencode-go-v41/deepseek-flash` 加进 `subagent-model-selection` 白名单，再按第 10 节原文指向它。

**更正（第二次核对 `settings.yaml:70-84`）**：该白名单的 **`enabled: false`**（第 71 行），即 `subagent-model-selection` **当前并未生效**，因此**不会**拦截 `opencode-go-v41/deepseek-flash`。所以：

- 上一轮我说"很可能被白名单拒绝"**过强，予以更正**——在 `enabled: false` 的当前状态下，路径 A 与路径 B 之外，**原文第 10 节那条最直接的改法（`subagent` → `opencode-go-v41`/`deepseek-flash`）本身也是可行的**；
- 路径 A（指向白名单内已有的 `opencode-go`/`deepseek-v4-flash`）依然是最保守的选择；
- 路径 B（改白名单）**只在**你打算启用 `subagent-model-selection` 时才需要；
- 若将来把该开关打开，白名单就会真正生效，届时未列入的 `opencode-go-v41/deepseek-flash` 会被拒——**这是"现在可以、以后可能不行"的差别**，值得记住。

**两条路径我都未执行**：`settings.yaml` 与路由文件同属运行中实例的数据。

**改完后如何验证（一条）**：派生一名成员，然后解码它的会话日志看 turn 结局——若不再出现 `error:TRANSPORT` 而是 `completed`，即恢复成功：

```powershell
node -e 'const fs=require("fs"),z=require("zlib");const f="D:/Harness Desktop/HarnessData/dsh-home/sessions/--D-DeepSeek-Harness-Desktop--/<子会话ID>/session.jsonl.zstd";const buf=fs.readFileSync(f),magic=Buffer.from([0x28,0xb5,0x2f,0xfd]);let o=[],i=0;while((i=buf.indexOf(magic,i))!==-1){o.push(i);i+=4}const out=[];for(let k=0;k<o.length;k++){const e=k+1<o.length?o[k+1]:buf.length;try{out.push(z.zstdDecompressSync(buf.subarray(o[k],e)))}catch{}}for(const l of Buffer.concat(out).toString("utf8").split(/\r?\n/)){if(!l)continue;let j;try{j=JSON.parse(l)}catch{continue}if(j.type==="turn/end")console.log(j.data?.turn,j.data?.reason?.kind,j.data?.reason?.error?.code||"")}'
```

**注意必须解全部帧**：该日志是追加式多帧 zstd，只解首帧（281 字节）会误判为"没有内容"——本调查早期就是这样误判过一次。

**另一条并行的修复（代码侧，待授权）**：即使路由恢复，也应实施第 ② 项分类修复，让**下一次**任何提供方传输故障都被标注为**可重试的提供方故障**，而不是"成员内部错误、不可重试"。规格与已执行的正/负向验证见 `delegation-classifier-fix-spec.md`。

