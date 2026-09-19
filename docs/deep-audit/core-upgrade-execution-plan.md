# DeepSeek 核心升版：施工计划（第 ③ 项，已授权、尚未开工）

本文件只写**已经实测确认过的事实**与**执行顺序**，不含推测性细节。配套分析见 `core-compat-upgrade.md`、判定门守卫 `tests/deep-audit-core-compat.test.cjs`。

## 0. 为什么还没开工（诚实说明）

升版涉及 **71 处版本钉（13 个文件）**、**12 个原生门的两类哈希工作**，以及 `node_modules` 的大规模更替。**一旦中途停下，工作树会处在"钉已改、依赖未换"或"依赖已换、门未重派生"的破损状态**。而本轮刚把发布静态门弄到通过（`Static verification passed for Harness Desktop 1.0.60.`），这是升版唯一可用的验收手段。因此：**先固定验收机制与施工顺序，再择一次连续、完整的时间窗执行**；不在余量有限时开工。

## 1. 当前状态（实测）

| 项 | 值 |
|---|---|
| 现有核心钉 | `0.1.2-alpha.5`（维护树 node_modules 与运行实例一致） |
| 目标版本 | `0.1.6-alpha.2`（官方 `alpha` dist-tag；`latest`/`next` 为 `0.1.5-rc.2`） |
| 目标字节 | 已取得，位于**仓库之外**的隔离目录 `D:\DeepSeek-Harness-Desktop\core-compat-upstream\0.1.6-alpha.2`（488 包，`--ignore-scripts`，exit 0） |
| 5 个补丁目标 | **全部 DIFF**（均需重新派生或退役） |
| 原生门（**已全表定案，见 §1i**） | **alpha.5 生效门表共 12 条**（早期"13"是三版列表并集）：**3 个零改动**（`dsh-client-ui-schedule` `214542D7…`、`dsh-session-turn-outline` `A31D5C3E…`、`dsh-storage-domain` `E536BA09…`，全长字节相等）、**5 个可移植**、**4 个需重写**（缺失锚点已逐条指名） |
| 分类 | subagent 的"排队+激活"补丁**已被上游取代**（上游出现 `Symbol.for("dsh.subagent.deliverPrompt")` 与真实 `queuePrompt`/`steerPrompt`）→ **应当退役而非迁移**；**聊天滚动补丁仍需**（其语义目标仍存在，属重派生） |
| 等待编辑清单 | `CORE_COMPAT_TARGET_VERSION=0.1.6-alpha.2 node --test tests/deep-audit-core-compat.test.cjs` 会列出 **32 处**必需编辑 |
| 现有守卫 | `tests/deep-audit-core-compat.test.cjs`，离线基线 **9/9** |

## 1b. 精确规模与一处**不可机械套用**的例外（本轮实测，直接决定施工方式）

**钉的真实规模（逐文件实测）**：要改的是 **71 处钉、13 个文件**——根 `package.json` **26 处**精确钉 `0.1.2-alpha.5`，加 **45 处 caret 钉 `^0.1.2-alpha.5`**（12 个插件清单）。**caret 钉必须一起改**：按 semver 的预发布规则，`^0.1.2-alpha.5` **不匹配** `0.1.6-alpha.2`。分布最集中的是 `plugins/dsh-android/package.json`（**22 处**）。

**例外：`@deepseek-ai/dsh-code-runtime` 无法升到 0.1.6-alpha.2。**

| 实测 | 结果 |
|---|---|
| 该包在已获取的 alpha.2 树（260 个 `@deepseek-ai` 包）中 | **不存在**，且该树中**无任何包引用它**（引用数 0） |
| `npm view @deepseek-ai/dsh-code-runtime@0.1.6-alpha.2` | **E404（无此版本）** |
| 该包实际已发布版本 | …`0.1.2-alpha.5`、`0.1.2-rc.1`、`0.1.3-alpha.2`、`0.1.5-alpha.1`、`0.1.5-alpha.2`、**`0.1.5-rc.2`（最新）** |
| 对照包 `@deepseek-ai/dsh-compaction@0.1.6-alpha.2` | **存在**（说明不是整体获取失败） |

即：**核心 0.1.6-alpha.2 这一版不包含该包**，它的发布停在 `0.1.5-rc.2`。而我们的 `package.json:55` **直接依赖它**，且有 **4 个门/测试**把它当作"应当是 alpha.2 的官方包"：

- `scripts/verify-static.mjs:633,681`（必需包列表）
- `scripts/artifact-audit.mjs:38`
- `tests/official-alpha2-static-release-contract.test.cjs:36`
- `tests/official-alpha2-runtime-contract.test.cjs:24`（并钉住其 sha512 `KGUwcm4s…` 与上游源路径 `packages/code-runtime/code-runtime/package.json`）

**因此升版不能"把 71 处统一改成 0.1.6-alpha.2"**，必须：① 25 个包 → `0.1.6-alpha.2`；② 单独决定 `dsh-code-runtime` 的版本（保持 `0.1.2-alpha.5`，或升到其最新的 `0.1.5-rc.2`）；③ 同步修改上述 4 处"假设核心版本统一"的断言。仓库**既有**文档已预告这一项需要**适配层**（`docs/OFFICIAL-CORE-COMPATIBILITY-AUDIT.zh-CN.md:46`：PTC/`run_code` 需在升级 `dsh-tools` + code runtime + SDK renderer 之后启用）。

**由此得到一条施工顺序结论（此前未知）**：第 ③ 项**必须**改 `scripts/verify-static.mjs`，而该文件被第三轮独立闭包钉在 `ef5682bb…`——**所以 §2 的第 ② 项（闭包映射的新验收）是第 ③ 项的前置条件**，两者不是并列关系。

**机械变更清单与回滚备份已就绪**：`.artifacts/deep-audit-core-compat/pin-change-manifest.json`（sha256 `71e641b4…`，逐项列出 file/section/name/from/to，共 71 条）与 `.artifacts/deep-audit-core-compat/pin-rollback/`（13 个清单文件的**原始字节副本**，可逐字节回退）。

## 1c. 预先测得的**插件对新核心的兼容性**（本轮实测，隔离进行，未触碰任何被钉证据）

做法：在 `.artifacts/deep-audit-core-compat/plugin-load-smoke/` 建临时根，用 **junction** 指向已获取的 alpha.2 `node_modules`（不复制、不改动），把仓库 `plugins/` 复制进去，逐个 `import()` 其入口。

**结果：16 个插件中 15 个加载成功，恰好 1 个失败。**

| 结果 | 插件 |
|---|---|
| 成功（15） | `dsh-android`、`dsh-codex-image-bridge`、`dsh-desktop-browser-tools`、`dsh-desktop-compaction`、`dsh-desktop-computer-use`、`dsh-desktop-directory-picker`、`dsh-desktop-files`、`dsh-desktop-mcp-manager`、`dsh-desktop-memory-tools`、`dsh-desktop-progress`、`dsh-desktop-schedules`、`dsh-desktop-web-search`、`dsh-mobile-control`、`dsh-model-admission`、`dsh-session-experience` |
| **失败（1）** | **`dsh-agent-teams`** |

**唯一失败及其确切原因**：

```
The requested module '@deepseek-ai/dsh-subagent/internal' does not provide an export named 'queueSubagentPrompt'
```

我们的 `plugins/dsh-agent-teams/lib/index.js:9` 从该内部模块 import `{ queueHostSubagentPrompt, queueSubagentPrompt }`，并在 `:5819` 用 `subagents?.[queueSubagentPrompt]` 取投递函数。

**alpha.2 里这个接缝已经被换掉**（实测）：
- `exports["./internal"]` 现指向 **`lib/types/internal.js`**（**仅类型**性质），其中以 `export const` 提供两个 **Symbol**：
  - `adjacentAgentSendMessageTool = Symbol.for('dsh.subagent.adjacentAgentSendMessageTool')`
  - **`deliverSubagentPrompt = Symbol.for('dsh.subagent.deliverPrompt')`**
- 真正的投递方法在 `lib/types/continuation.js`：**`queuePrompt(parent, childId, content, source, signal)`** 与 **`steerPrompt(parent, childId, content, source, signal)`**。
- 旧名 `queueSubagentPrompt` **在运行时不可导出**（导入报错即证）；它仍出现在 `lib/types/internal.d.ts:46` 与 `internal.js:42` 中，但**那是类型/声明层面，不是运行时导出**。

**因此升版的代码工作量集中在**：把 `dsh-agent-teams` 的投递调用迁移到 **`Symbol.for('dsh.subagent.deliverPrompt')` + `queuePrompt`/`steerPrompt`**。这与本会话早前的判定一致（当时在 alpha.6 观察到的正是同一对替换），现在**在目标版本 alpha.2 上得到直接证实**。

**两条诚实的限定**：
1. 该冒烟只验证**模块加载层面的 API 表面**（导入是否成立），**不验证运行时行为**——注册、初始化、投递语义仍需在换核后按 §3 步骤回归。
2. 我先前的脚本曾在解析入口时误报 2 个插件"entry missing"，原因是**我的解析器只读 `main` 而没处理字符串形式的 `exports`**；修正后二者均正常加载。**这是我的缺陷，不是插件的问题**——已一并记录以免误导。

### 1c-2. 迁移已被**原型验证**（本轮；仅在隔离副本中进行）

**更正上一小节的措辞**：不是"投递 API 被换掉"，而是**只有那个 Symbol 被换名**。alpha.2 的 `internal.js` 实测导出：

```
export const deliverSubagentPrompt = Symbol.for('dsh.subagent.deliverPrompt');
export function queueHostSubagentPrompt(runtime, parent, childId, content, source, signal)   // ← 名字仍在，签名与我们调用一致
export function steerHostSubagentPrompt(runtime, parent, childId, content, source, signal)  // ← 新增
```

而我们插件只触碰旧 API 的 **3 行**（`lib/index.js:9` 导入、`:5819` 守卫、`:5822` 调用），且 `:5822` 的 `queueHostSubagentPrompt(subagents, parent, childId, content, source, signal)` 与 alpha.2 的签名**逐参数吻合**。

**因此在隔离副本中只改 2 个标识符**：
- `:9` 的 `queueSubagentPrompt` → **`deliverSubagentPrompt`**
- `:5819` 守卫里的 `subagents?.[queueSubagentPrompt]` → **`subagents?.[deliverSubagentPrompt]`**

**结果：`dsh-agent-teams` 在 0.1.6-alpha.2 上成功加载。** 结合 1c 的 15/16，**16/16 个插件均可在目标核心上完成模块加载**。

**仍然诚实的限定**：这只证明**模块加载**成立，**不证明运行时行为**。alpha.2 的 `[deliverSubagentPrompt](parent, childId, content, source, signal, delivery)` 带第 6 个 `delivery` 参数（`"steer"` 否则排队），我们的辅助函数只传 5 个参数（即走排队路径）——**这一语义一致性需要在换核后按 §3 回归验证**。

**本次原型只在 `.artifacts/deep-audit-core-compat/plugin-load-smoke/` 的副本中进行；仓库内 `plugins/dsh-agent-teams/lib/index.js` 未改动。**

### 1d. 导入表面差异检查（本轮；静态、只读）

把仓库里**所有** `@deepseek-ai/*` 导入说明符（`from` / `require(` / `import(`）静态抽出，逐个与 alpha.2 的 `package.json#exports` 映射核对，以在动手前找出**全部"子路径被移除"类**破坏。

| 项 | 结果 |
|---|---|
| 我们代码使用的不同说明符 | **22** |
| 在 alpha.2 中可解析 | **21** |
| **子路径被移除**（包在、该子路径不在） | **0** |
| 包整体不存在 | **1**：`@deepseek-ai/dsh-client-runtime/client` |

**关于那唯一一项**：其引用文件**全部位于 `.release-state/mobile-pr47-v1.0.61/…` 历史快照目录**（不是活动代码），而该包在 `scripts/verify-static.mjs:645` 的 `REMOVED_DSH_ROOTS` 中**早已被登记为"已移除根"**。因此**活动代码零破坏**。

**与 1c 的关系（两种检查互补，这是要点）**：
- **1c 的插件加载冒烟**检查的是**具名导出**——它抓到了 `queueSubagentPrompt` 这类"子路径还在、但导出名换了"的破坏；
- **本节的导入表面差异**检查的是**子路径存在性**——结果是 0。
- 只做其中一种都会漏：单看子路径会漏掉改名的导出，单看插件加载则覆盖不到非插件代码的导入。

### 1e. 门表重派生：已完成的部分与**确切的剩余量**（本轮汇总自既有派生工件）

**已定且无需再算的 3 个门**（字节完全一致，**不是假设**——它们的哈希与既有 alpha.4/alpha.5 表记录**精确相等**，证明这三个包跨版本跃迁内容不变）：
`dsh-client-ui-schedule`、`dsh-session-turn-outline`、`dsh-storage-domain`。

**必须重派生的门**（已算出 **OFFICIAL** 目标哈希，`alpha5 → alpha2`）：

| 包 | 文件 | alpha.5 | alpha.2 |
|---|---|---|---|
| `dsh-api-session-controller` | `lib/client.js` | `F2EC317D1C1F…` | `E4ABAE846622…` |
| `dsh-client-connection` | `lib/client.js` | `1B8E76D7FB14…` | `2AE9BBA70673…` |
| `dsh-api-gateway` | `lib/index.js` | `C69E238A1B9B…` | `4410B2A92FB1…` |
| `dsh-api-remotes` | `lib/index.js` | `2258A0D4037B…` | `679AFCC5D98A…` |
| `dsh-session-projection-cache` | `lib/index.js` | `95BC052F468A…` | `434E85695DFD…` |
| `dsh-storage-json` | `lib/index.js` | `DE4CF45C829E…` | `293B76E38E9D…` |

**4 个维护补丁目标的 alpha.2 官方哈希**（同表）：
`dsh-client-ui-user-questions/lib/client.js` `5F519DA46515…`、`dsh-subagent/lib/index.js` `31509492FAE7…`、`dsh-mcp-client/lib/index.js` `C8E43A1E782E…`、`dsh-client-ui-subagent/lib/client.js` `B1A103602E74…`。

**锚点存活情况**：27 个判别性锚点中 **24 个逐字存活**；**≥4 个确定丢失**（含 subagent 的 queue-prompt 那一个）。

**确切的剩余机械工作量（这是执行者真正要做的）**：
1. 为上述需重派生的门**重写补丁体**，随后才能算出各自的 **PATCHED** 哈希——**现有工件只含 OFFICIAL 哈希**，因为补丁体未重派生前 patched 值**不可能存在**（这一点工件里已如实标注，我也保持同一立场，不预填猜测值）。
2. 4 个补丁目标逐个重派生；其中 subagent 的排队补丁**应退役**（上游已换接缝，见 §1c-2 的 2 标识符迁移）。
3. 其余 4 个门未进入上表的原因是其既无 alpha.5 基线或形态不同——**执行时须逐一核对，本计划不预填**。

### 1f. 补丁体能否"移植"还是必须"重写"（本轮实测；据此把剩余工作再收窄）

> **本小节的表格已被 §1i 取代，且其判定已知有误**（判据来自坏解析器抓到的垃圾锚点）。保留于此仅为记录推理过程；**请以 §1i 为最终结论**。

对每个待重派生的门，取出安装器门表里**该包的必需锚点**，逐个在 alpha.2 的目标文件中做**精确子串**核对。

**先说限度**：我的提取脚本还把 `lib`、`client.js`、`index.js`、`Remote`、`stream` 这类**路径/通用片段**也一并当成了"锚点"，因此上表的**锚点计数不可信**；有意义的判据是**有辨识度的字符串是否存在**。下列结论只基于后者。

| 门 | 有辨识度的锚点 | 判定 |
|---|---|---|
| `dsh-api-session-controller` | 全部存活 | **可移植**（仅更新哈希） |
| `dsh-api-gateway` | 全部存活 | **可移植** |
| `dsh-api-remotes` | 全部存活 | **可移植** |
| `dsh-storage-json` | 全部存活（`function acceptedStamps(descriptor) {`、`async backupRecord(table, key) {`、`await this.tracked(rename(path, moved));`） | **可移植** |
| **`dsh-client-connection`** | **丢失**：`backoffMaxMs: 1e4` | **需调整补丁体** |
| **`dsh-session-projection-cache`** | **丢失**：`compatibleVersions: [3, 4]` | **需调整补丁体** |

**这收敛出一个可执行的结论**：待重派生的门里，**4 个只需更新哈希**，**2 个需要改补丁体**，且**丢失的确切字符串已经指名**（`backoffMaxMs: 1e4`、`compatibleVersions: [3, 4]`）——执行者可直接从这两处入手，不必先做全量差异分析。

注：`dsh-client-ui-user-questions` 在门表中**没有条目**，因为它是**补丁目标**而非原生门——这与既有分类一致，不是遗漏。

**过程诚实记录**：本脚本第一次运行因**我写错了正则转义**（临时脚本里用了双重转义）而把全部锚点报成"未解析"，并输出了一整列"必须重写"的**假结论**。修正后才得到上表。**这正是本会话反复出现的同一类错误：工具报错不等于被测对象有问题。**

### 1g. **更正 1f**：逐条读原始表项后的最终判定（本轮）

> **本小节的表格亦已被 §1i 取代**（它对 5 个门给的是"未定案"）。保留于此为记录更正过程；**请以 §1i 为最终结论**。


1f 的那个"4 可移植 / 2 需重写"是**错的**，因为它的判据是我**松解析器抓到的垃圾锚点**（`lib`、`client.js`、`Remote`、`stream`）。为定准，我改为**直接读安装器表项原文**并逐条核对**有辨识度的锚点**。

**权威判定（6 个待重派生的门）**：

| 门 | 必需锚点（读自表项原文） | alpha.2 核对 | 判定 |
|---|---|---|---|
| `dsh-api-session-controller` | `loadThrough(seq)`、`maxMessages: 200`、`survives connection generations` | 前两个**存在**（`lib/client.js:1775`、`:1795`），**第三个缺失** | **需重写** |
| `dsh-client-connection` | `var ConnectionController = class`、`connection: manual reconnect requested`、`backoffMaxMs: 1e4` | 前两个存在，**`backoffMaxMs: 1e4` 缺失** | **需重写** |
| `dsh-session-projection-cache` | `compatibleVersions: [3, 4]`、`invalidRecords: "backup-and-skip"`、`isSeeded: z$1.boolean().optional()` | **`compatibleVersions: [3, 4]` 缺失** | **需重写** |
| `dsh-api-gateway` | `Remote`、`stream` | 均存在 | 可移植，**但判据弱**（锚点过于通用） |
| `dsh-api-remotes` | `Remote`、`stream` | 均存在 | 可移植，**但判据弱**（同上） |
| `dsh-storage-json` | `function acceptedStamps(descriptor) {`、`async backupRecord(table, key) {`、`await this.tracked(rename(path, moved));` | 三条均存在 | **可移植**（判据强：锚点独特） |

**修正后的工作量**：**3 个门需改补丁体**（且丢失的字符串已指名）、**3 个可移植**（其中 2 个的判据只是通用词，执行时仍应逐条复核）。相对 1f，`dsh-api-session-controller` 与 `dsh-session-projection-cache` 的判定**由"可移植"翻转为"需重写"**。

**这条检查里我的脚本连续失败三次**（松解析 → 双重转义正则 → 含方括号的锚点破坏"最后一个数组"启发式），每次都产出过**看似完整的假结论**。最终结论**只来自读原文**。这值得作为流程教训写在这里：**在这类"提取表项→逐条核对"的任务上，宁可读原文，不要相信自己的解析器。**

### 1h. 门表**原文**（本轮逐字读出，可作为执行者的权威清单）与**尚未定案**的项

安装器里 alpha.5 门表 = `OFFICIAL_ALPHA4_CAPABILITY_ARTIFACTS`（**9 条**，`scripts/patch-official-runtime.mjs:3185-3193`）展开 + **3 条**新增（`:3207-3209`）= **12 条**。逐字读出的锚点：

| 门 | 目标文件 | alpha.5 官方哈希 | 必需锚点（原文） |
|---|---|---|---|
| `dsh-api-session-controller` | `lib/client.js` | `F2EC317D…` | `loadThrough(seq)`、`maxMessages: 200`、`survives connection generations` |
| `dsh-client-ui-chat` | `lib/client.js` | `9C9874C5…` | `function TurnNavigatorRail(`、`function mergeTurnRailItems(`、`useProjection("turnOutline")` |
| `dsh-client-ui-conversation` | `lib/client.js` | `7EE5792B…` | `function QueueThumb(`、`function queueImageRefs(`、`conversation.input.attachments` |
| `dsh-client-connection` | `lib/client.js` | `1B8E76D7…` | `var ConnectionController = class`、`connection: manual reconnect requested`、`backoffMaxMs: 1e4` |
| `dsh-client-ui-schedule` | `lib/client.js` | `214542D7…` | `function ScheduleCatalogAction(`、`formatScheduleFrequency`、`schedule-catalog` |
| `dsh-session-turn-outline` | `lib/index.js` | `A31D5C3E…` | `key: "turnOutline"`、`turnOutlineProjectionDefinition` |
| `dsh-api-gateway` | `lib/index.js` | `C69E238A…` | `Remote`、`stream` |
| `dsh-api-remotes` | `lib/index.js` | `2258A0D4…` | `Remote`、`stream` |
| `dsh-session` | `lib/index.js` | `BE25B05F…` | `function SessionSeq(value) {`、`inheritedEventCount;`、`ownEvents() {`、`return this.snapshotEvents(this.inheritedEventCount);` |
| `dsh-client-ui-attachment` | `lib/client.js` | `4E166AB5…`（official） | `function MessageImage(`、`function ImageGallery(`、`conversation.trajectory.images` |
| `dsh-session-projection-cache` | `lib/index.js` | `95BC052F…` | `compatibleVersions: [3, 4]`、`invalidRecords: "backup-and-skip"`、`isSeeded: z$1.boolean().optional()` |
| `dsh-storage-domain` | `lib/index.js` | `E536BA09…` | `spec.compatibleVersions ?? []`、`spec.invalidRecords !== "backup-and-skip" || unit.backupRecord === void 0`、`const moved = await unit.backupRecord(table, key);` |

**已定案（经真正跑通的检查）**：

| 判定 | 门 | 依据 |
|---|---|---|
| **零改动** | `dsh-client-ui-schedule`、`dsh-session-turn-outline`、`dsh-storage-domain` | **全长 64 位哈希与表内值逐字节相等** |
| **可移植** | `dsh-client-ui-chat` | 3 个锚点**全部逐字存在**（脚本正常执行的一次） |
| **需重写** | `dsh-api-session-controller` | 锚点 `survives connection generations` **缺失**（另两条存在于 `:1775`/`:1795`） |
| **需重写** | `dsh-client-connection` | 锚点 `backoffMaxMs: 1e4` **缺失**（另两条 `var ConnectionController = class`、`connection: manual reconnect requested` 存在） |
| **需重写** | `dsh-session-projection-cache` | 锚点 `compatibleVersions: [3, 4]` **缺失** |

**尚未定案（本轮未取得可靠结果，明确留空而非填猜测）**：`dsh-session`、`dsh-client-ui-attachment`、`dsh-api-gateway`、`dsh-api-remotes`。原因：这些表项以**变量**引用路径（`conversationRuntime`、`sessionRuntime`、`attachmentUiRuntime`），而我的路径拼接/定位脚本在此处**连续失败**——最近一次它甚至对这几个包报"PACKAGE ABSENT"，而**我在同一会话前一步刚刚成功列出过它们的 `lib/` 内容**（`index.js`、`invariant.js` 等），因此该报错**确定是我脚本的假象**。**执行者可直接用上表的锚点字符串逐一核对**——那是可靠的输入。

**本轮新增的一条可靠结论**：**`dsh-client-ui-conversation` 需重写**——在 `lib/client.js` 中 `function QueueThumb(` 与 `conversation.input.attachments` **存在**，但 **`function queueImageRefs(` 缺失**。至此"需重写"共 **4 个门**（api-session-controller、client-connection、session-projection-cache、client-ui-conversation）。

### 1i. 门表 12 条**全部定案**（本轮完成）

用一个**不含任何技巧**的 Node 脚本（包名与锚点全部硬编码、不用正则、不拼 PowerShell 路径、只读 `lib/index.js` 与 `lib/client.js`）重跑，**一次成功**，补齐最后 4 个门——**印证此前 5 次失败全部是我的工具缺陷，不是数据问题**。

| 判定 | 门（共 12 条） | 依据 |
|---|---|---|
| **零改动（3）** | `dsh-client-ui-schedule`、`dsh-session-turn-outline`、`dsh-storage-domain` | **全长 64 位哈希与表内值逐字节相等** |
| **可移植（5）** | `dsh-client-ui-chat`、`dsh-api-gateway`、`dsh-api-remotes`、**`dsh-session`**、**`dsh-client-ui-attachment`** | 全部锚点**逐字存在**（chat/session/attachment 的锚点独特、判据强；gateway/remotes 的锚点只是 `Remote`/`stream`，**判据弱**，执行时仍应复核） |
| **需重写（4）** | `dsh-api-session-controller`、`dsh-client-connection`、`dsh-session-projection-cache`、`dsh-client-ui-conversation` | 各有一条锚点**确定缺失**：`survives connection generations` / `backoffMaxMs: 1e4` / `compatibleVersions: [3, 4]` / `function queueImageRefs(` |

**3 + 5 + 4 = 12**，与门表条目数一致，**无未定案项**。

**因此 ③ 的门工作可精确表述为**：3 条零工作量；5 条**只需补 alpha.2 的官方/补丁哈希**（补丁体可直接沿用）；4 条**需要改补丁体**，且**缺失的锚点字符串已逐条指名**。

### 1j. 重要范围发现：分类器修复在**新核心上无处可"移植"**（本轮实测）

本节同时修正一个可能的误解——**②（分类器修复）不会随升版自动延续**。

**实测**：

1. **旧的终端诊断词汇在 alpha.2 整个核心（260 包）里完全不存在**：`SUBAGENT_ABNORMAL_END`、`boundedSubagentTerminalDiagnostic`、`SUBAGENT_PROVIDER_UNAVAILABLE`、`view_live_status` **零命中**。而当前运行核心（0.1.2-alpha.5）的 `dsh-subagent/lib/index.js` 里，这些正是分类逻辑的主体。
2. 我尝试把已交付的分类补丁套用到 alpha.2 的 `dsh-subagent/lib/index.js`：**锚点出现 0 次、分类器函数不存在**，因此**无从移植**。
3. alpha.2 的 `dsh-subagent/lib/` 新增了 **`run-settlement.js`、`error.js`、`continuation.js`** 等；但 `run-settlement.js`（2584B）与 `error.js`（424B）**不含任何 retry/transient/transport 相关词**——**新模型同样不区分"可重试的传输故障"**。
4. **`fetch failed` 在新核心里出现于 `dsh-llm/lib/types/error.js:83` 与 `dsh-llm/lib/index.js:179`**——即**传输故障的知识搬到了 LLM 层**。

**结论（对计划的实质影响）**：

- **② 的修复对当前运行时代仍然有效且已交付**（独立脚本 + 7/7 测试 + 正负向验证）；
- **但升版后必须"重新表达"，而不是移植**：新核心的等价位置在 **`dsh-llm` 的错误处理**（已识别 `fetch failed`）与 `dsh-subagent` 的 `run-settlement.js`/`error.js` 之间，**需要先判定上游是否已自行区分可重试性**——若已区分，则这一项在升版后**应退役**而非重写。
- 因此"4 个补丁目标"中的 subagent 那一项，**不属于"重写同一词汇表"，而属于"目标代码已迁移"**。

**过程诚实记录（又一个脚本陷阱）**：我第一次套用补丁时，脚本**打印出了一个"patched hash"**——但那是**锚点未命中、`replace` 空操作**的结果（官方与补丁哈希相同、`added bytes: 0` 才暴露它）。**"脚本打印了数字"不等于"替换发生了"**；这两个哈希相同的输出若不加核对，会被当成一次成功的派生。

### 1k. 上游设计指引：新核心要求**按 `HarnessError.code` 路由**，不要解析消息（本轮实测）

读完 §1j 指向的两处 `fetch failed` 后，结论是**它们都只在文档注释里**：

- `dsh-llm/lib/types/error.js`（及 `lib/index.js` 的同名副本）中，`fetch failed` 出现在 **`errorChain()` 的 JSDoc**：说明该函数会展开 `cause` 链与 `AggregateError` 成员，好让"undici 的 `TypeError: fetch failed` 这类传输包装**不再掩盖底层失败**"。
- 同一段 JSDoc 给出**明确指引**：**"Diagnostic-surface rendering only（messages, notices, logs）——never parse the result; route on `HarnessError.code`."**
- 新核心确实有**按消息分类**的先例：`isQuotaExceededError(detail)`（识别配额/余额类终止性错误）——**但传输故障不在其中**。

**因此对 ②（分类器修复）的最终判断**：

1. **在目标核心上，传输故障仍未被判定为可重试**（旧词汇表整体消失，新模块 `run-settlement.js`/`error.js` 无相关词，LLM 层只做诊断渲染）——**这个缺陷在新核心上依然存在**，不是"上游已经修好"。
2. **但正确的修法在新模型里变了**：上游要求**按结构化 `HarnessError.code` 路由**。当前 0.1.2-alpha.5 的核心**没有**传输错误码，所以我当时只能用消息匹配（`code==="transport"` / `"fetch failed"`）——那是**在旧模型下的合理最小修法**。
3. 升版后 ② 应当**重新表达为**："确保提供方传输故障以**可重试的结构化 code** 浮出，并让桌面侧重试/`nextAction` 路径识别该 code"，而**不是**再写一次消息匹配。
4. 执行前需先确认一件事：**升级后的 provider 层是否已把 `fetch failed` 归一为某个结构化 code**（若是，则 ② 只需"识别该 code"；若否，则需要先在 provider 层补齐该 code）。

### 1l. 新发现的升级风险：**桌面侧的诊断消费面**（本轮；§1k 第 4 点的答案带来）

为回答"谁在消费可重试判定"，我检索了本仓库的 `retryable` / `nextAction` 使用点，得到一个**既重要又未列入原计划**的结论：

**桌面侧不是被动透传核心的诊断，而是自己按 `category` 重新推导。**

- `plugins/dsh-agent-teams/lib/index.js:876-942`：`terminalDiagnosticNextAction(rawNextAction, category)`，其中 **`:912` `if (["provider_transient","lifecycle_timeout"].includes(category)) return "retry_current_task";`**，**`:940` `retryable: … : ["provider_transient","lifecycle_timeout","backpressure"].includes(category)`**
- `plugins/dsh-agent-teams/lib/project-team-board.js:110-117`：同一套回退逻辑
- `plugins/dsh-agent-teams/lib/client.js:935-936`：**界面**另有一份安全码/类别白名单（`safeCodes`、`safeCategories`、`safeStages`、`safeActions`），并据此渲染"可重试/不可重试"与下一步动作文案

**这三处共同消费一个诊断形状**：`{ errorCode, category, stage, retryable, partialOutputPresent, nextAction }`。而 §1j 已证明：**该词汇表（含 `provider_transient`、`view_live_status`、`SUBAGENT_*` 码）在 alpha.2 整个核心中零命中**。

**因此新增一项升级兼容风险（需在执行前核实，我尚未核实）**：**换核后，桌面侧的 `dsh-agent-teams` 诊断消费是否仍能收到它期望的形状？** 若新核心不再产出 `category`/`nextAction`，则：
- 桌面侧会回退到默认值（`view_live_status` / `retryable:false`）——**即使核心侧修好了，界面仍会显示"不可重试"**；
- 这意味着 ② 的正确落点**可能必须包含桌面侧**，而不只是核心侧的分类器。

**待核实的具体位置**（执行前逐项确认，本计划不预判）：alpha.2 的 `dsh-subagent` 是否仍向外提供同形状的终结诊断；若否，新形状是什么；`dsh-agent-teams` 的三处消费点需要怎样适配。

**这一条的来源值得记录**：它不是我专门去找的，而是**在回答"谁消费这个判定"时顺带发现的**——一个此前只按"核心侧分类器"规划的修复，实际上横跨核心与桌面两侧。

### 1m. **已核实**：桌面所消费的诊断契约在新核心里完全不存在（本轮；确定结论）

**核实方式**：在新核心全库（260 个 `@deepseek-ai` 包，`*.js` + `*.d.ts`）中检索**极具辨识度的字段名与类别词**：

| 检索词 | 全库命中 |
|---|---|
| `partialOutputPresent` | **0** |
| `provider_transient` | **0** |
| `SUBAGENT_ABNORMAL_END` / `SUBAGENT_PROVIDER_UNAVAILABLE` / `view_live_status`（§1j 已测） | **0** |
| `dsh-subagent` 包内 `partialOutputPresent`/`nextAction`/`errorCode`/`retryable` | **1，且是注释**（`lib/types/list-children.js:309`） |

**结论（确定）**：桌面 `dsh-agent-teams` 三处消费点所期待的诊断形状 `{ errorCode, category, stage, retryable, partialOutputPresent, nextAction }`——**在新核心里没有任何生产者**。

**因此换核后的后果是确定的**（不是"可能"）：核心不再产出该形状 → 桌面三处回退到默认值（`view_live_status` / `retryable:false`）→ **"可重试"提示与下一步指引会静默消失**，与核心侧是否正确分类无关。

**这对 ③ 的实质影响（必须写入范围）**：③ 不再只是"改钉 + 重派生门"，它**包含一条功能性工作流**：**重建（或明确退役）核心→桌面的诊断契约**。
- 若选择"重建"：需要在新核心里为新诊断形状选定生产者（`dsh-subagent` 的 `run-settlement.js`/`error.js` 是候选，但它们当前不含 retry/transient 词），并适配桌面三处消费点；
- 若选择"退役"：则须**显式承认**这些界面提示不再存在，而不是让它们退化成默认文案。

**对 ② 的连带影响**：② 的修复作用于**该契约的核心侧产出**。换核后契约两端需**一起重新设计**——这也是为什么 §1k 的第 3 点（"重新表达"）不仅是措辞问题，而是**契约重建**的一部分。

### 1n. 替代契约的实际形状（本轮读完 `run-settlement.js` 全文；70 行）

新核心 `dsh-subagent/lib/types/run-settlement.js`（全文 70 行）把一次子运行结局映射为 Jobs 结果：

| 子结局 | 新核心产出 |
|---|---|
| `completed` | `{ status: 'completed', output: <finalText> }` |
| `aborted` **且无** `diagnostic` | `{ status: 'killed' }`（本地取消） |
| `aborted` **有** `diagnostic`，以及 `error` / `max-tokens` / `refusal` / 其它 | `{ status: 'failed', detail }` |

其中 `detail = stopReason + (diagnostic === undefined ? '' : "; diagnostic: " + diagnostic)`。

**关键观察（三点）**：

1. **新模型里没有"可重试性"这个概念**：产出只有 `status`（completed/failed/killed）与一个 **`detail` 字符串**——**没有 category、没有 errorCode、没有 retryable、没有 nextAction**。
2. **`diagnostic` 是"提供方写的自由文本"**（注释原文："provider-authored detail"），**不是结构化对象**。
3. 因此桌面侧的 `retryable`/`nextAction` 推导在换核后**没有任何结构化输入**可依。

**而新核心自己的指引（§1k）明确反对解析文本**：`errorChain()` 的 JSDoc 写着 "never parse the result; **route on `HarnessError.code`**"。两条合起来给出的唯一合理方向是：

> **可重试性应由 provider/LLM 层的结构化 `HarnessError.code` 承载，并沿着 `child-agent`/`continuation` 路径传到桌面**；而不是让桌面去解析 `detail` 文本。

**执行前需要核实的下一处**（本计划不预判）：`dsh-llm` 是否已把传输失败归一为某个结构化 code，以及该 code 是否随子运行结局上行到桌面可见的位置。若两者都不成立，则"重建该契约"就是 ③ 里**工作量最大的一项功能性工作**，而非附带项。

### 1o. 已核实：新核心**有**结构化 code 接缝，但传输故障落为 **`UNKNOWN`**（本轮；把风险收窄为小改动）

读 `dsh-llm/lib/types/adapter-failure.js`（108 行；`normalizeLlmFailure`）得到确定结论：

- 该函数把适配器边界抛出的值归一为**提供商中立事实对**：**`{ message, code }`**（注释称其适合作为 "terminal finish chunk"）。
- 若抛出物不是 `Error`：`new HarnessError(thrownMessage(value), 'UNKNOWN', { cause: value })`。
- `harnessErrorCode(error) { return error instanceof HarnessError ? error.code : 'UNKNOWN' }`。

**因此**：一个普通的 `TypeError: fetch failed`（undici 传输包装）在这一层得到的结构化 code 就是 **`'UNKNOWN'`**——**与"任何未知失败"无法区分**。

**这把 §1n 的开放项收窄成一个明确、可落地的小改动**：

- **不是"要重建整套契约"**：新核心**已有** `{message, code}` 这个接缝，也**已有** `HarnessError.code` 这条上游认可的路由依据（§1k）。
- **真正的缺口是一处"缺码"**：适配器边界**没有为传输/网络失败指定专属 code**，于是它落入 `UNKNOWN`。桌面因此仍无法把"可重试的提供方传输中断"与"未知内部错误"区分开。
- **升版后的正确修法（对应 ② 的新形态）**：在适配器边界（`normalizeLlmFailure` 及其调用方，或更上游的 fetch 适配器）为**传输失败赋予一个专属 code**，并让桌面把该 code 映射为可重试提示——**符合上游"按 `HarnessError.code` 路由"的指引**，而不是解析 `detail` 文本。

**结论**：我在当前核心上修的缺陷（传输故障被当成不可重试的内部错误），**在新核心上以另一种形式依然存在**（不是"分类器类别错"，而是"边界处缺码 → `UNKNOWN`"）。**但补法比原先估计的小得多，且位置明确。**
















## 2. 验收机制（本轮新增可用）

- **发布静态门**：`node scripts/verify-static.mjs` —— **本轮已首次跑到通过**（1.0.60）。升版后必须仍然通过；它是版本/打包/IPC/单工作台契约的主验收。
- **第三轮已验收证据门**：`node tests/deep-audit-question-delivery-evidence.test.cjs` —— 当前 **73/73**。注意：**它钉住若干文件的精确字节**，升版若触及被钉文件，必须走"显式旧字节映射"或按既定流程登记，**不得删断言**。
- **核心守卫**：`tests/deep-audit-core-compat.test.cjs` —— 升版后其钉应与新版本一致。
- **维护补丁链**：安装器 + 本轮新增的独立脚本（`scripts/deep-audit-subagent-transport-patch.mjs`）都按 **alpha.5 的精确哈希**判定，版本一变即 **fail closed**（拒绝打补丁）。这是**设计如此**，但意味着升版时必须为新版本提供新的锚点/哈希表，否则安装会直接抛错。

## 3. 建议执行顺序（每步都可独立验证、可回退）

1. **冻结现状**：确认三门状态（发布门**通过**、第三轮证据门**当前 72/73**——唯一红项即 §2 的验收映射、核心守卫 **9/9**），并记录 `git status` 基线（当前 16 个 `package.json` 类文件处于未提交修改）。**注意：§2 的验收轮是后续步骤的前置，见 §1b 末段。**
2. **改钉**：按 §1b 的机械清单改 **71 处 / 13 文件**（根 26 处精确钉 + 45 处 caret 钉；后者**必须一起改**，因为 `^0.1.2-alpha.5` 按 semver 不匹配 `0.1.6-alpha.2`）。其中 `@deepseek-ai/dsh-code-runtime` **无 alpha.2 版本**，需单独定版本。
3. **换依赖**：用目标字节替换 `node_modules` 中对应的 `@deepseek-ai/*` 包（来源为已取得的隔离目录，**不访问公网**）。
4. **逐门处理（12 条，见 §1i）**：**3 条零改动（不要碰）**；**5 条可移植**——只需重算 alpha.2 的官方/补丁哈希并更新常量；**4 条需重写**——先按各自缺失的锚点调整补丁体，再重算哈希。**每门单独验证**。
5. **处理补丁类**：subagent 排队补丁**退役**（上游已换接缝）；聊天滚动补丁**重派生**锚点与哈希；其余补丁目标逐个重派生并补哈希（清单见 §1e）。
6. **重建/退役诊断契约**（**新增，见 §1j–§1n**）：新核心**完全没有**桌面所消费的诊断形状，桌面三处消费点会静默回退。必须显式选择"重建"或"退役"。
7. **重跑三门**：发布门通过、第三轮证据门按既定映射流程恢复绿、核心守卫与新版本一致。
6. **重跑三门**：发布门通过、第三轮证据门按既定映射流程恢复绿、核心守卫与新版本一致。
7. **回归**：重跑本会话已建立的可直接运行套件集（见 `deep-audit-suite-runbook.md` 第 3 节），确认无新的未归类红。

## 4. 回退

- 步骤 2 与 3 各自的字节状态应在执行前落盘保存（含精确哈希），保证可**逐字节**回退——本会话已用同一手法成功回退过一次安装器改动（`EXACT REVERT PROVEN: true`）。
- 若步骤 4 中途失败：优先回到步骤 3 的依赖状态，此时仅"钉已改"未完成，可整体回退到步骤 1。

## 5. 本次不做的边界

不发布、不打 tag、不触碰运行实例、不使用 sibling `repo-publish` 检出；升版只作用于**维护树**。
