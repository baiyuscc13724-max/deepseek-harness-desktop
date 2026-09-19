# 连带影响检查记录（第 ④ 轮，2026-09-19）

**目的**：本轮为推进发布静态门，改动了 `README.md`、`release-notes.md`、`scripts/verify-static.mjs`、`renderer/workspace-links-integration.js`。本文记录**这些改动是否波及其它已通过套件**——这是"改动后必须自查"的一步，而不是结论性验收。

## 1. 先精确定位受影响面（而非盲目全跑）

在 `tests/` 中检索谁读取这三类文件，得到**唯一的哈希钉消费者**：`tests/helpers/official-followup-hermetic.cjs`，它钉住

| 文件 | 钉住值（前 8 位） |
|---|---|
| `scripts/verify-static.mjs` | `66585d57…` |
| `README.md` | `964e1ec2…` |
| `release-notes.md` | `e2795a87…` |

使用者只有一处：`tests/official-followup-hermetic-acceptance.test.cjs`。

## 2. 实跑结果

| 套件 | 结果 | 定性 |
|---|---|---|
| `official-alpha2-static-release-contract` | **2/2 通过** | 不受影响 |
| `browser-model-tools-ui` | **1/1 通过** | 不受影响 |
| `deep-audit-core-compat` | **9/9 通过** | 不受影响 |
| `release-version-sync` | 修前 1/2 → **修后 2/2 通过** | 见第 3 节：**我引入后又修好的两门冲突** |
| `official-followup-hermetic-acceptance` | **9/14，3 项失败** | 见第 4 节 |

## 3. 我确实引入过一处"两个门互相冲突"（已修复）

我为满足 `verify-static.mjs:574` 的精确串 `上一稳定版：**v1.0.59**`，把 README 的"**当前**稳定版"改成了"**上一**稳定版"——结果打红了 `release-version-sync.test.cjs:71`，后者用正则要求 README 含 `当前稳定版：**v<semver>**`。

**两个门要的是不同措辞，且都合理**（一个描述"上一稳定版"，一个要求"明确标识当前稳定版"）。修法：**让 README 同时满足两者**——保留 `上一稳定版：**v1.0.59**`，并**另起一行**写明 `当前稳定版：**v1.0.59**`（含下注说明候选未发布、不替换其资产）。修后两门同时通过：

- `release-version-sync` **2/2** ✓
- `verify-static` **通过（1.0.60）** ✓

**教训**：改一处被**多个**门/套件钉住的文案时，必须**先找出全部消费者**再改；只盯着当前正在推的那道门，就会把一个失败换成另一个失败。

## 4. `official-followup-hermetic-acceptance` 的 3 项失败（如实区分归属）

| 失败项 | 具体断言 | 归属 |
|---|---|---|
| `v1.0.59 hot/cold safety acceptance binds the reviewed product and proof sources without moving history` | `reviewed source drift: plugins/dsh-agent-teams/lib/index.js` | **与我无关**：该文件本会话从未改动，属既有未提交改动 |
| `v1.0.59 cloud performance recovery binds exact optimized sources and unchanged safety gates` | `optimized source drift: plugins/dsh-agent-teams/lib/index.js` | **与我无关**（同上） |
| `publication scan binds accepted hashes and classifies every stale historical token` | 涉及 accepted hashes / stale tokens；我实测**三个被钉文件的钉值均不等于工作树** | **至少部分与我的改动有关**（该套件钉的正是我改的 `verify-static.mjs` / `README.md` / `release-notes.md`） |

**关于第三项的一个必要限定（避免过度断言）**：我有理由认为它在**我改动之前就已失败**——该助手钉的是 **v1.0.59 发布快照**的字节，而工作树在我动手前**已经是 1.0.60 候选**（README 当时写的是 `下一发布候选：**v1.0.60（待验收）**`）且 `README.md`/`release-notes.md`/`verify-static.mjs` 三者本就处于本地未提交修改状态，因此**不可能**等于 v1.0.59 快照的哈希。

**但这是推理，不是字节级证明**：我**没有保存改动前的字节**，所以无法用哈希回溯证实"改前即已失败"。**这一点如实标注，不做更强声明。**

## 5. 结论与后续

- 我的改动**没有**波及 `release-version-sync`（修后）、`official-alpha2-static-release-contract`、`browser-model-tools-ui`、`deep-audit-core-compat`、`release-publisher`（**36/36**）。
- **已修复我引入的两门冲突**，现在 `verify-static` 与 `release-version-sync` **同时通过**。
- `official-followup-hermetic-acceptance` 的失败属**冻结钉类**（v1.0.59 发布快照 vs 1.0.60 候选工作树），**不是功能缺陷**；其中两项明确源于我未触碰的 `plugins/dsh-agent-teams/lib/index.js`。
- 若要让该套件在候选工作树上转绿，需按仓库既有做法为其加入**显式旧字节映射**，或等候选发布后以其快照重钉——**这属于发布流程决定，本会话未做**。

## 6. 主动应用同一纪律：`renderer/workspace-links-integration.js` 的全部消费者

上一节的教训是"改一处被多个门/套件钉住的文案前，先找出**全部**消费者"。本轮把这条纪律**主动**用在另一个被我改动的文件上（我在其中恢复了 `右键可打开所在文件夹或复制路径` 这句提示）。检索 `tests/` 得到 **4 个消费者**，全部重跑通过：

| 消费者 | 结果 |
|---|---|
| `guest-context-menu` | **2/2 通过** |
| `modal-focus` | **11/11 通过** |
| `right-workspace-ui` | **11/11 通过** |
| `workspace-links-interaction` | **6/6 通过** |

合计 **30/30**。其中 `modal-focus` 与 `workspace-links-interaction` 我在**改动前**跑过（分别为 11/11、6/6），改动后**结果不变**——因此该文件的提示恢复**未造成任何连带破坏**，且**恢复了 HEAD 本就有的契约**。

**方法论备注**：这两次检查（第 1 节与本节）用的是同一套动作——**先枚举消费者，再实跑全部消费者，逐项区分"我造成的"与"既有的"**。它在第 3 节真的抓到了一条我引入的跨门冲突；本节则给出"无影响"的正面证据。相比笼统地"再跑一遍测试"，它**同时更省时间和更可信**。

## 7. 终局验收发现的硬冲突：第三轮独立闭包 vs 发布门（未擅自处理）

**现象**：终局复核时第三轮已验收证据门为 **72/73**（本轮早前为 73/73），唯一失败断言：

```
NO explicit historical mapping: round3-independent-fixed-closure scripts/verify-static.mjs ef5682bb8a95680e5899a6aeedf4e3fd338933f61fe86bb74eac05ee100a0f2f
```

**归属**：`ef5682bb…` 是 `scripts/verify-static.mjs` 的**编辑前字节**（我本会话最早的 `deep-audit-core-compat/source-before.json:8` 即记录此值）。**我的授权编辑改变了它，因此该闭包（它钉住 6571 个文件）不再匹配。**

**闭包的实际机制**（读 `.artifacts/deep-audit-question-delivery-acceptance/integration/integrity.cjs:11-13`）：
- `historical()` 在文件漂移时，查 `source-remap-v2/mapping.json` 中 `{file, sha256, originalBytes, manifests}` 的条目；找不到就抛上面这条断言。**安装器另有一条特例**（`before-v2/mapping.json` 的 `savedPath`）。
- 第 11 行**硬断言 `before.files.length===121` 且 `remap.files.length===16`**；第 12 行要求每个映射的 `originalBytes` 文件存在且哈希相符。

**因此修复这条红需要一次"新的验收决定"**：新增一条把 `verify-static.mjs` 的 `ef5682bb…` 映射到归档原件的条目，**并把 `integrity.cjs` 的计数从 16 改成 17**。**材料是齐的**——归档原件确实存在：`.artifacts/deep-audit-question-delivery/before-v2/original/scripts/verify-static.mjs` 的哈希就是 `ef5682bb8a95680e…`。

**我为什么没有动手**：那是**验收证据基础设施**（独立闭包 + 它的计数断言）。擅自加条目与改计数，等于**自行改写已验收证据的口径**——这正是本会话一贯拒绝做的事（"授权改动不应悄悄改写旧证据"）。

**这就是一处真实的门与门不兼容**：**同一个 1.0.60 候选无法同时满足**——(a) 发布静态门通过（需要改 `verify-static.mjs` 的候选常量与一条契约），与 (b) 第三轮闭包字节不变（`ef5682bb…`）。二者只能靠一次**记录的、计数同步更新**的映射（即新一轮验收）来并存。**两年前/上一轮的作者正是这样处理的**（`source-remap-v2` 的 16 条与安装器特例都是当时新开的验收口径）。

**当前状态如实标注**：发布门 **通过**；第三轮证据门 **72/73**，唯一红项为上述"待新验收映射"，**不是功能缺陷**。


