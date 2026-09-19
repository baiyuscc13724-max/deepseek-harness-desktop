# 委派失败诊断分类的修复规格（候选，未实施）

## 1. 缺陷

一次**提供方传输故障**被上报为"成员内部错误且不可重试"。

已证实的观测（2026-09-19，7/7 子会话）：每个子会话的每个 turn 都以
`{"kind":"error","failure":{"message":"fetch failed","code":"TRANSPORT"}}` 结束（子会话 `session.jsonl.zstd` 直接记录），而 Host 存储与 `team_status` 呈现的是：

```
errorCode: SUBAGENT_ERROR
category : internal
stage    : work_followup
retryable: false
nextAction: view_live_status
```

后果：用户看到的是"成员崩溃、不可重试"，而真实情况是"提供方暂时不可达、应当重试"。这会误导用户放弃或手动替换成员，并掩盖真正需要处理的对象（路由/凭据/端点），也解释了为什么"派成员总是失败且看起来像代码坏了"。

## 2. 根因位置（当前运行核心 0.1.2-alpha.5）

`node_modules/@deepseek-ai/dsh-subagent/lib/index.js:279-333` 的分类逻辑：在 `stopReason === "error"` 分支里，只有错误的 `code`/`message` 命中以下任一项才被正确归类 —

- 含 `activation_teardown_failed` → teardown/retirement
- `code === "pi_ai_error"` 且 message 含 `not found` 或为空 → `PI_AI_ERROR` / provider_transient / retryable
- 含 `timeout` / `timed out` → `SUBAGENT_TIMEOUT` / lifecycle_timeout / retryable
- 含 `rate_limit` / `rate limit` / `overload` / `unavailable`，或 `code === "pi_ai_error"` → provider_transient / retryable
- **否则** → `SUBAGENT_ERROR`，默认 `category: internal`、`retryable: false`、`nextAction: view_live_status`

`code = "TRANSPORT"`、`message = "fetch failed"` 一个都不命中，因此落入兜底。分类器函数 `boundedSubagentTerminalDiagnostic` 未在包导出面暴露（`lib/index.js:3175` 的导出清单不含它），所以无法直接单测；证据由"真实失败记录 + 源码分支"共同构成。

## 3. 建议修复（最小、可验证、不改语义边界）

在既有维护补丁框架（`scripts/patch-official-runtime.mjs`）内，为 `dsh-subagent` 增加一条**分类规则**：把传输层失败映射为可重试的提供方故障，而不是内部错误。

- 判定条件（按最小充分性设计，避免吞掉真实的内部错误）：`rawCode === "transport"`（大小写归一后）**或** `rawMessage` 含 `fetch failed`。
- 归入：`code: "SUBAGENT_PROVIDER_UNAVAILABLE"`（或保留一个明确的新码）、`category: "provider_transient"`、`stage: "provider_dispatch"`、`retryable: true`、`nextAction: "retry_current_task"`。
- **不得**放宽任何安全门、不得改变非 error 分支、不得影响 `partialOutputPresent` 语义。

实施要求（与仓库既有做法一致）：
1. 新增 `OFFICIAL_ALPHA5_*` 形式的锚点与哈希常量，官方哈希与补丁后哈希都必须为**逐字节完整产物哈希**，不接受 marker/部分补丁豁免。
2. 锚点必须取自当前实际文件文本（分类器所在分支），安装器在锚点缺失或源哈希不匹配时**拒绝**，而不是模糊匹配。
3. 幂等：已打过补丁的产物必须被识别为"已知完整补丁产物"并可重放为 changed:false。
4. 版本门：新规则只能挂在明确的核心版本契约下；遇到未知版本必须 fail closed（沿用现有 `OFFICIAL_ALPHA*_VERSION` 模式）。

## 4. 验证计划

- **正向**：对 `{ code: "TRANSPORT", message: "fetch failed" }` 断言得到 provider_transient + retryable:true + retry_current_task。
- **负向（必须全部保持原行为）**：`activation_teardown_failed`、`timeout`、`rate_limit`、`overload`、`unavailable`、`pi_ai_error`、以及一个**普通内部异常**（如 `TypeError: x is not a function`）都必须仍然落到原来的分类；尤其要证明新规则没有把内部错误误报为可重试。
- **安装器门**：官方哈希/锚点漂移、未知版本、部分补丁、二次安装幂等，均按既有安装器测试模式覆盖。
- **端到端形态**：用与本次相同的方式（子会话日志 + Host 诊断）复核——即"记录 `TRANSPORT` 的失败不再呈现为 internal/不可重试"。

## 5. 与本次委派失败的区分（不要混淆两件事）

- **本规格修的是"报错方式"**：让传输故障被正确标注为可重试的提供方故障。
- **它不修"传输为何失败"**：当前子会话被派发到 `openai-codex`/`gpt-6-astra` 并在传输层失败，而根会话实际由 `opencode-go-v41`/`deepseek-flash` 服务。要恢复委派能力，需要（用户侧）把子代理路由指向可用后端或修复 `openai-codex` 通道；这一项**不是代码补丁能解决的**，且总审未擅自改运行实例配置。

## 6b. 可直接执行的补丁提案（本轮补充；仍未落盘）

**锚点位置已核实两处一致**：维护树 `node_modules/@deepseek-ai/dsh-subagent/lib/index.js` 与运行核心 `dsh-subagent/lib/index.js` 的该段代码行号与内容相同（`pi_ai_error` 分支在 305 行、`unavailable` 分支在 316–317 行、兜底在 **322** 行），因此该锚点在两边都稳定。

**锚点**（第 322 行，`}` 前为**三个制表符**缩进；`else` 分支唯一）：

```
			} else code = "SUBAGENT_ERROR";
```

**替换为**（在兜底之前插入新分支；字段全部显式赋值，不继承默认值）：

```
			} else if (rawCode === "transport" || rawMessage.includes("fetch failed")) {
				code = "SUBAGENT_PROVIDER_UNAVAILABLE";
				category = "provider_transient";
				stage = "provider_dispatch";
				retryable = true;
				nextAction = "retry_current_task";
			} else code = "SUBAGENT_ERROR";
```

**为什么这样写而不是改 message 文本**：
- `rawCode` 与 `rawMessage` 在该分支内已由第 298–300 行归一为小写，`rawCode === "transport"` 与 `rawMessage.includes("fetch failed")` 都直接可用，无需新增解析。
- 新分支插在**所有既有分支之后**，因此 `timeout`/`rate_limit`/`overload`/`unavailable`/`pi_ai_error`/`activation_teardown_failed` 的既有语义**完全不受影响**——这正是负向回归要证明的点。
- 显式写出全部五个字段，避免依赖第 270–278 行的默认值（默认值正是当前把传输故障标成 `internal`/`retryable:false` 的来源）。

**配套要求（沿用第 3 节）**：新增 `OFFICIAL_ALPHA5_*` 锚点与哈希常量，官方哈希与补丁后哈希都必须是逐字节完整产物哈希；锚点缺失或源哈希不匹配时**拒绝**；已打补丁的产物可识别并重放为 `changed:false`；未知核心版本 fail closed。

**机械校验（本轮，纯内存、未落盘）**：对维护树 `node_modules/@deepseek-ai/dsh-subagent/lib/index.js`（3,176 行）执行上述替换并核验：

| 校验项 | 结果 |
|---|---|
| 锚点出现次数 | **1**（唯一） |
| 新增行 / 删除行 | **+6 / 0**（纯插入） |
| 新增字节 | **255** |
| 新分支位置在兜底 `SUBAGENT_ERROR` **之前** | 是 |
| `out.replace(替换文本, 锚点) === 原文` | **是** —— 证明除该插入外**没有任何其他改动** |

这组数字同时是后续安装器派生哈希时的输入规模参考（官方哈希 → 打补丁后哈希的差量即 255 字节、6 行）。

**仍未做**：本轮**没有**修改任何生产文件，也没有写入安装器；上面只是经行号核实后的可执行提案，等待授权后按仓库既有维护补丁流程实施并跑负向回归。

## 6. 状态与授权需求

- **未实施**：本轮只完成诊断与规格，没有改动任何生产文件。
- **需要**：一个新限定的生产修复任务（按第三轮既有模式：先实证、再限定范围、独立复核），或用户直接授权后由总审实施并跑安装器测试。

## 8. §4 验证计划已离线执行（本轮，6/6 通过）

`tests/deep-audit-round4-classifier-proposal.test.cjs` 从**产品文件中提取真实分类函数文本**（不重写实现），分别对**原文**与**应用 6 行插入后**的文本求值并逐用例比对，全部通过：

| 用例 | 结果 |
|---|---|
| 提案是唯一锚点上的纯 6 行插入 | 通过（且反向替换可逐字节还原原文） |
| 观测到的委派失败在**当前**代码中被误判 | 通过——原文给出 `SUBAGENT_ERROR / internal / work_followup / retryable:false / view_live_status` |
| 应用提案后同一输入被正确归类 | 通过——`SUBAGENT_PROVIDER_UNAVAILABLE / provider_transient / provider_dispatch / retryable:true / retry_current_task` |
| **既有分支语义不变（负向回归）** | 通过——12 个其它用例（aborted、max-tokens、refusal、completed、teardown、pi_ai_error×2、timeout、rate limit、overload、unavailable、ENOENT）前后**完全一致** |
| 提案不会把真实内部错误变成可重试 | 通过——`TypeError` 与 `ENOENT` 仍为 `SUBAGENT_ERROR` 且 `retryable:false` |
| `partialOutputPresent` 语义不受影响 | 通过（true/false 均不变） |

**这一步的意义**：规格此前只有"计划"，现在**正向与负向验证都已实际执行**，且用的是产品里真实的函数文本，不是我对逻辑的复述。**仍未安装**：本轮没有修改任何生产文件、没有写入安装器。

