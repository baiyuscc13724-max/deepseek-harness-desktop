# 验收轮规格：解开"第三轮闭包 vs 1.0.60 候选"的字节漂移

**用途**：这是一份**决策就绪**的规格，供项目所有者决定并执行一次**新的验收轮**。它**不是**让门禁变绿的脚本；它把"需要改什么、改后要重新冻结什么、代价是什么"写清楚。**本会话未执行任何一项。**

## 1. 触发条件（现状）

第三轮已验收证据门（`tests/deep-audit-question-delivery-evidence.test.cjs`）现为 **72/73**，唯一失败：

```
NO explicit historical mapping: round3-independent-fixed-closure
scripts/verify-static.mjs ef5682bb8a95680e5899a6aeedf4e3fd338933f61fe86bb74eac05ee100a0f2f
```

原因：该门通过 `.artifacts/deep-audit-question-delivery-acceptance/integration/integrity.cjs` 的 6571 文件独立闭包核对字节。`scripts/verify-static.mjs` 已被**授权修改**（为使发布静态门在 1.0.60 候选上通过：候选常量 1.0.59→1.0.60、以及 `app.js` 皮肤面板契约由旧精确串改为两条等价且更严格的断言）。`ef5682bb…` 是该文件的**编辑前字节**。

## 2. 机制（`integrity.cjs:11-13` 实测）

- 文件漂移时查 `source-remap-v2/mapping.json` 的条目：`{file, sha256, manifests:[…], originalBytes:…}`；`manifests` 里必须**逐字**包含调用方传入的清单名（本例为 `round3-independent-fixed-closure`）。
- 找不到就抛上面的断言。安装器另有一条**硬编码特例**（`before-v2/mapping.json` 的 `savedPath`）。
- 第 11 行**硬断言** `before.files.length===121` 且 `remap.files.length===16`；第 12 行要求每个条目的 `originalBytes` 文件存在且哈希等于该条目的 `sha256`。

**现有 16 条的实际性质（实测样本）**：其中一条把 `scripts/deep-audit-question-delivery-patch.mjs` 映射到 `…/producer-reconstruction-v1/candidate-v1.mjs`——即**事后重构副本**，不是原始存档。因此该机制**本来就允许"重构证明"**，前提是**明确标注**。

## 3. 执行一次新验收轮所需的三步

1. **新增 1 条映射**（追加到 `source-remap-v2/mapping.json`，使条目数 16→17）：

```json
{
  "file": "scripts/verify-static.mjs",
  "sha256": "ef5682bb8a95680e5899a6aeedf4e3fd338933f61fe86bb74eac05ee100a0f2f",
  "manifests": ["round3-independent-fixed-closure"],
  "originalBytes": ".artifacts/deep-audit-question-delivery/before-v2/original/scripts/verify-static.mjs"
}
```

**`originalBytes` 指向的**是**原始存档**（已实测存在，且其 sha256 **正是** `ef5682bb8a95680e…`）——因此本条目**不需要重构**。

2. **同步计数**：`integrity.cjs:11` 的 `assert.equal(remap.files.length,16)` → `17`。

3. **重新冻结被这两处改动打破的清单**：`integrity.cjs` 自身被至少两处清单钉住——
   - `.artifacts/deep-audit-question-delivery-acceptance/integration/final-freeze.json:66`
   - `.artifacts/deep-audit-question-delivery-acceptance/integration/pre-recovery-v3/manifest.json:39`

   编辑它会使这些清单失配，故必须按该仓库既有做法**重冻结**（`output-manifest.json` 为 15668 项，是否也收录 `mapping.json` **需在动手前逐一核实**——本规格不臆测）。

## 3b. 已查实的完整重冻结影响面（本轮实测，取代第 3 步的"待核实"）

对两个**将被编辑**的文件（`integration/integrity.cjs` 与 `source-remap-v2/mapping.json`）做全量清单检索，得到 **10 处引用、7 份清单**：

| 被编辑的文件 | 出现于清单 | 该清单条目数 | 清单内记录的哈希 |
|---|---|---|---|
| `integrity.cjs` | `integration/final-freeze.json` | 37 | `c7cc230f455a…` |
| `integrity.cjs` | `integration/pre-recovery-v3/manifest.json` | 8 | `c7cc230f455a…` |
| `integrity.cjs` | `integration/integrity-before.json` / `integrity-after.json` | 34396 各 | `a48759841900…` |
| `integrity.cjs` | `integration/pre-recovery-v3/integrity-before.json` | 34396 | `a48759841900…` |
| `integrity.cjs` | `before-v2/original/.artifacts/deep-audit-round3-acceptance/final-freeze.json` | 179 | `a48759841900…` |
| **`source-remap-v2/mapping.json`** | **`deep-audit-question-delivery/final-freeze.json`** | **7354** | `81359b7eae0d…` |
| `source-remap-v2/mapping.json` | `integration/integrity-before.json` / `-after.json` | 34396 各 | `81359b7eae0d…` |
| `source-remap-v2/mapping.json` | `integration/pre-recovery-v3/integrity-before.json` | 34396 | `81359b7eae0d…` |

**这暴露出一条会被忽略的连锁**：`deep-audit-question-delivery/final-freeze.json`（7354 项）**本身**被 `integrity.cjs:17` 以常量 `f2e1ffcc73fcb6f96403edee457c8392fa0d05b5b7474e7634f438d3bfbd78c3` **逐字节钉住**，而它又钉住 `mapping.json`。因此实际链路是：

```
改 mapping.json (+1 条目, 16→17)
  → final-freeze.json 中 mapping.json 的条目失配
    → 必须重冻结 final-freeze.json
      → 其自身哈希改变，必须更新 integrity.cjs:17 的常量
        → integrity.cjs 改变，又使上表 6 份引用它的清单失配
          → 必须继续重冻结那些清单
```

**即：这不是"改两处"，而是一次自底向上的多清单重冻结**，涉及 7 份清单 + 至少 2 个清单内常量。**本会话未执行其中任何一步**，并据此更正第 3 步里"至少两处"的保守表述：**实际为 7 份清单**。

## 4. 代价与风险（必须让所有者知情）

- **这会改写已验收证据的口径**：新增例外条目 + 改计数 + 重冻结多个清单。它**不弱化**字节校验（仍比对原始字节），但**改变了"哪些文件被允许漂移"的清单**，因此**必须由项目所有者决定并留痕**，不能由代理人顺手完成。
- 若不做：**发布静态门通过、第三轮证据门 72/73**——两者不可同时为绿（同一个 1.0.60 候选）。这是**结构性的**，不是可以两头讨好的状态。
- 若做：两门可同时为绿，且漂移被**记录在案**（附原始字节可复核）。

## 5. 与第 ③ 项（核心升版）的硬性依赖

核心升版**必须**编辑 `scripts/verify-static.mjs`（生产门钉住"官方核心 = 0.1.2-alpha.5"，升版必然要改；此外 alpha.2 里**不存在** `@deepseek-ai/dsh-code-runtime`——`npm view` 实测 404，其最后发布版本为 `0.1.5-rc.2`——若沿用现有必需包列表，升版后门禁必然失败）。

**因此顺序是：先做本规格（验收轮），再做升版。** 二者不是并列关系。

## 6. 本会话的边界声明

- 本会话**未**新增映射、**未**改计数、**未**重冻结任何清单、**未**编辑 `integrity.cjs`。
- 本会话**未**执行核心升版；其机械变更清单（71 条）与回滚备份已备好，见 `.artifacts/deep-audit-core-compat/pin-change-manifest.json`（sha256 `71e641b4…`）与 `pin-rollback/`。

## 7. **实测更正：本规格低估了连锁（已执行 D3 前三步并回退）**

在获得授权后，我**实际执行了本规格的第 1–3 步**并逐步用门禁验证（每一步都有备份，最终**全部逐字节还原**，门禁回到 72/73 的单条红项）。实测结果**比本规格写的更深**：

| 步骤 | 实测效果 |
|---|---|
| ① 加 1 条映射（16→17） |`NO explicit historical mapping … round3-independent-fixed-closure … verify-static.mjs` **消失** → 映射本身有效 |
| ② `integrity.cjs` 计数 16→17 | 红项变为 `byte identity …/source-remap-v2/mapping.json` → 证实 `A/final-freeze.json`（7354 项）钉住映射文件 |
| ③ 更新该 freeze 条目 + 其自身钉值（`f2e1ffcc…`→`0489bbd6…`）| **红项再次变化**：`NO explicit historical mapping: .artifacts/deep-audit-question-delivery/core-after-v1/source-before.json scripts/verify-static.mjs ef5682bb…` |

**关键更正**：`scripts/verify-static.mjs` 的**同一文件+哈希**被**远不止**闭包一个清单期待——还有 **18 个逐运行 `source-before.json`**（`core-after-v1/v2/v3`、`core-before-v1/v3`、`recovery-matrix-v1..v4`、`final-matrix-v2`、`recovery-bounds-v1`、`recovery-legacy-v1/v2`、`recovery-uncached-v1/v2` 等）以及 **UI 运行**的记录。而 `integrity.cjs:25` 对 UI 运行用的是**硬等值 `check()`，没有映射钩子**。

**因此第 1 步的映射必须把上述全部清单名列入 `manifests`；而更严重的是：任何走 `check()` 硬等值的记录（UI 运行）都无法用映射解决，只能改写那些已归档记录本身。**

**结论**：本规格原先的"7 份清单 + 2 个常量"**不足**。真正的完整代价是**改写一批已归档的运行记录**（或在无钩子的硬校验下不可实现）。这属于**远超"加一条映射"的证据改写**，因此我**停手并完整回退**，把选择权交回所有者。

**回退证明**：五份文件均已按字节还原，哈希为 `mapping.json 81359b7e…`、`A/final-freeze.json f2e1ffcc…`、`integrity.cjs c7cc230f…`、`I/final-freeze.json a7e21c7c…`、`I/pre-recovery-v3/manifest.json 50a537547…`；门禁回到 **72/73**，唯一红项与本规格第 1 节所述完全一致。

## 8. 真因的完整量化与**比例性决定**（本会话作出，不再等待）

扫描 **40 份归档清单**（`source-before.json` / `final-freeze.json` / `integrity-before.json` / `output-manifest.json`，`A` 与 `R` 两棵树），逐一比对本会话改动过的四个文件：

| 文件 | 当前哈希 | **陈旧归档记录条数** |
|---|---|---|
| `scripts/verify-static.mjs` | `23d42d7d…` | **34** |
| `README.md` | `3af6e7d3…` | **32** |
| `release-notes.md` | `3475178b…` | **0**（未被这些清单记录，或已一致） |
| `renderer/workspace-links-integration.js` | `59058db8…` | **0** |

**因此那道门的红项只由两个文件造成，共 66 条陈旧记录**（且其中 UI 运行的那部分走 `check()` 硬等值、**没有映射钩子**）。这解释了为什么"加一条映射"远远不够。

**我的决定（依据比例原则，并依你"全部授权 / 自己排查解决"的要求作出）**：**不重定基这 66 条历史记录**。理由三点：

1. **性质**：那不是"加例外"，而是**改写约 18 次已验收运行的输入溯源记录**——改写后这些记录将不再如实描述"当时工作树是什么样"。以 66 条历史记录的失真，换取一个**关于过去交付**的遗留门变绿，代价与收益不成比例。
2. **结构冲突才是根因**：发布静态门**要求**改动 `README.md` 与 `verify-static.mjs`（候选/稳定版身份串、`app.js` 契约），而第三轮遗留门的**记录**又要求这两个文件保持旧字节。**两者不能用"改一个门"调和**，只能在"重定基历史"与"承认遗留门已被取代"之间选一个。我选后者。
3. **诚实性**：把门标为"**已被取代 + 精确原因（2 个文件、66 条记录）**"，比让门变绿却让 66 条记录失真，更接近事实。

**因此第三轮证据门的最终状态是**：**72/73**，唯一红项 = `NO explicit historical mapping … scripts/verify-static.mjs ef5682bb…`，**已定性为"发布候选对齐与本门历史记录之间的结构性冲突"，非功能缺陷**；其精确原因（2 个文件 / 66 条记录）记录在案，可供任何复核者独立重算。

**若所有者认为该门必须变绿**：做法已明确（重定基 34+32 条记录，并对无钩子的硬校验记录同样处理），本会话**已备好全部备份与逐步脚本**，可在授权后执行；我**不擅自做**。


