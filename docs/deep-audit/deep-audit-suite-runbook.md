# 深度审计套件运行手册

本文件记录截至 2026-09-19 **实测验证过**的套件运行契约。目的：避免把"没按正确方式运行"误读成"功能坏了"。

## 1. 三条通用规则（都是实测踩出来的）

1. **不能假设 `node --test <文件>` 就是运行方式。** 多个套件在文件内断言必须经规范入口运行，直接运行会以门禁消息失败——例如 `Use fixtures/deep-audit-clipboard-components/run.ps1`、`Use settings fixture run.ps1`。**这类失败不是回归。**
2. **入口脚本必须用 pwsh（PowerShell 7+）**，不能用 Windows PowerShell 5.1。原因：脚本使用 `ProcessStartInfo.ArgumentList`，该属性只存在于 .NET Core / PS7+；在 5.1 下会以 `You cannot call a method on a null-valued expression` 失败，而且**脚本不声明所需 shell**。
3. **`-Run <名称>` 必须未被占用**（同名会被拒绝，防止覆盖既有证据）。名称需匹配 `^[a-zA-Z0-9-]+$`。

## 2. 入口契约（每项均为实测）

| 夹具入口 | 参数 | 产物位置（相对 `.artifacts/`） | 本手册编写时的实测状态 |
|---|---|---|---|
| `deep-audit-clipboard-components/run.ps1` | `-Run` | `deep-audit-round1-clipboard/<Run>/node.tap` | 2 项：baseline 通过、`actual-installed` **红**（冻结安装器钉） |
| `deep-audit-settings-components/run.ps1` | `-Run` | `deep-audit-round2-settings/<Run>/node.tap` | 1 项**红**：`Input drift renderer/app.js`（漂移钉） |
| `deep-audit-settings-save-fix/run.ps1` | `-Run` | `deep-audit-round2-settings-save-fix/<Run>/node.tap` | **4/4 通过** |
| `deep-audit-preview-components/run.ps1` | `-Run` | `deep-audit-round2-preview/<Run>/node.tap` | **1/1 通过** |
| `deep-audit-preview-lifecycle-fix/run.ps1` | **`-Run` + `-Mode before\|after`** | `deep-audit-round2-preview-lifecycle-fix/<Run>/node.tap` | `before` 1/1 通过（两条原始红按预期复现）；`after` **1/1 红**（48 项中仅 `LIFECYCLE-02`，见 §4） |
| `deep-audit-round3-appframe/run.ps1` | `-Run` | `deep-audit-round3-appframe/<Run>/node.tap` | 1 项**红**：与 clipboard 相同的冻结安装器钉（经共享助手） |
| `deep-audit-sidebar-layout/run.ps1` | `-Run` | `deep-audit-round2-sidebar-layout/<Run>/node.tap` | **1 项红，且为设计如此**：`isolated real shell, guest and native sidebar geometry` —— 这是保留的"期望几何红"，用于固化修复前几何（第二轮记录原文：before 的 Node exit 1 是保留期望几何红） |
| `deep-audit-sidebar-layout-fix/run.ps1` | **`-Run` + `-Phase before\|after`（`-Phase` 可选，默认 `after`）** | `deep-audit-round2-sidebar-layout-fix/<Run>/node.tap` | 默认 `after`：**1/1 通过**（与上一条构成 before 红 / after 绿的既定配对） |


### 2b. 入口契约共**四种**形态（勿统一假设）

**形态 D（证据复核类，无 `run.ps1`）**：用**命令行位置参数**而非 PowerShell 参数——例如 `node tests/deep-audit-round1-evidence.test.cjs <run 名>`。该文件自行校验 `process.argv[2]` 匹配 `^[a-zA-Z0-9-]{1,60}$`，并要求 **run 目录与衍生物目录都不存在**（`tests/deep-audit-round1-evidence.test.cjs:5,7`）。**不带参数直接 `node --test` 会在入口处失败**（报 `did not match the regular expression /^[a-zA-Z0-9-]{1,60}$/`）——**那是入口缺失，不是回归**。这一形态与 A/B/C 都不同：它没有包装脚本，参数位置也不同。


| 形态 | 例子 | 说明 |
|---|---|---|
| A. 仅 `-Run` | clipboard-components、settings-components、settings-save-fix、preview-components、round3-appframe、sidebar-layout | 最常见 |
| B. `-Run` + **必需**模式 | `preview-lifecycle-fix`（`-Mode before\|after` 为 Mandatory） | 必须显式给模式，漏给会直接报"缺少必需参数" |
| C. `-Run` + **可选**模式（带默认） | `sidebar-layout-fix`（`-Phase` 默认 `after`） | 漏给会**静默使用默认值**，可能跑成与预期不同的相位 |

形态 C 最危险：它不会报错，如果不看参数行就调用，可能以为在跑 before 而实际跑的是 after（或反之）。**调用前读参数行**，不要按同类样式推断。


## 3. 可直接 `node --test` 且已实测通过的套件

`deep-audit-question-delivery-evidence`（73/73）、`deep-audit-core-compat`（9/9）、`deep-audit-round4-question-install-compat`（4/4）、`deep-audit-mobile-manifest-paging`（9/9）、`deep-audit-marketplace-install`（17/17）、`agent-teams-lifecycle-hardening`（8/8）、`agent-teams-runtime`（37/37）、`deep-audit-interaction`（27/27）、`deep-audit-browser-control`（9/10，1 skipped）、`deep-audit-round4-relay-backpressure`（8/8）、`modal-focus`（11/11）、`mobile-web-accessibility`（7/7）。

**仍为红的直接运行套件（均为冻结参考类，非功能缺陷）**：`deep-audit-question-card-install`（6 项中 1 红：退役 CLI 字串）。

## 4. 已知并被显式保留的限制（勿当新缺陷上报）

- `LIFECYCLE-02 controller destroy detaches sidebar and stops iframe`：实测 48 项中仅此 1 红，观测为 `connected:false`（节点脱离**通过**）+ `beats:false`（瞬时窗口内心跳计数变化）。第二轮记录已明确**两不结论**：既不确认"持续执行漏洞"，也不认定"只是排队消息"，并把该限制保留至今（`docs/deep-audit/round2-status.md:22`、`round2-fixes-validation.md:16,42-44`；其中 48/48 的探针版**不能替代**两次 47/48）。

## 5. 冻结参考类红项一图

| 红项 | 钉的是什么 | 已发生的变化 | 连锁影响 |
|---|---|---|---|
| clipboard `actual-installed` | 安装器 SHA `cecd16cc…` | 第三轮**获授权**改动后为 `058d1385…` | 同一钉在共享助手 `fixtures/deep-audit-clipboard-components/install-current.cjs:10`，**同时压住 appframe 套件**；改钉会打红 `deep-audit-round1-evidence:18`（钉助手自身 SHA `e043c712…`）与 appframe 的输入集合相等断言——**一行修法必然失败** |
| settings-components | `renderer/app.js` SHA `3086aae0…` | 当前为 `560354dc…`（项目已记录的当前值） | 输入漂移检测器；与功能无关 |
| 旧安装套件 | CLI 字串 `questionCardChanged` | 现行改用 `questionDeliveryChanged` | 旧套件保留未迁移；新成对候选 4/4 **不掩盖**它 |

## 6. 最重要的教训

- **"看起来新，不等于真的新"**：判定一条红为"新缺陷"前，**先按名称检索历史记录**。`LIFECYCLE-02` 就写在历史里，差点被当成新发现上报。
- **"锚点消失，不等于缺陷消失"**：核心升版时聊天滚动补丁的锚点消失，但其语义目标（三处 pending 早退）仍然存在，属**需重派生**而非退役。
- **静态 grep 的"未找到"不是"不存在"**：我曾据一次 grep 断言旧安装 API 整体消失，实跑证明只有 1 条断言失败。
- **单帧解压不是全文**：子会话日志是追加式多帧 zstd，只解首帧（281 字节）会得出"Host 未保存原因"的错误结论；全部 28 帧（339,756 字节）才揭示真因。
