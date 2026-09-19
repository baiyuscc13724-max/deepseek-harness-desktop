# 核心会话订阅修复：安装链与当前索引整合

日期：2026-09-12。范围仅为已接受的 SessionInputShell queue unsubscribe 修复的必要安装交付；不新增编辑/提交/会话产品行为，不更改核心作者冻结的测试、原报告或 coverage-session-core。

## 当前状态

**FINAL_READY，待总审独立接受。** `acceptance-session-core-install-v2` 在隔离 HOME/环境、offline guard 和四项固定排除下运行：91 tests，88 pass，3 个原 alpha.2 skip，0 fail/cancel；约 2347ms。精确事件归属为核心安装 5/5、冻结核心 28/28、runtime-storage 16/16、official composition 13/13、official patch 26 pass/3 skip。事件解析错误 0，source/test/audit drift 均 0。源与测试在该通过记录后冻结，仅补此报告及当前索引的验证元数据。

保留首次 run `acceptance-session-core-install-v1`：测试启动前 code 7，Windows 自定义 reporter 绝对路径被 ESM 当作 `d:` scheme，`ERR_UNSUPPORTED_ESM_URL_SCHEME`，事件文件为空，不是产品红/绿证据。总审/验收修复 reporter 为 file URL 后才运行新 v2 目录。本成员未改 scope 外 runner/reporter，未去掉四项固定过滤。

最终源文件 SHA-256（不是安装后 client artifact hash）：

| 文件 | SHA-256 |
|---|---|
| `scripts/deep-audit-session-core-patch.mjs` | `E86C9D2D96D850D8E0BF545E3343A793C7729CD173F6B0A9252B33458B2952BC` |
| `scripts/patch-official-runtime.mjs` | `034CFD41CC9E78C46ED6ABA1D1971236F496EDF3D587F2342FF039450BB239DF` |
| `tests/deep-audit-session-core-install.test.cjs` | `BC04B80C2FFFFCF8270FF568E4B75B69A85A8CA492BE385D17BC6FD97AA638B5` |
| `tests/deep-audit-runtime-storage.test.cjs` | `1DE38E31AA5B512A8272E67393F1AA88AC27583B5027D7003DC06716FDC9E78A` |

证据：`.artifacts/deep-audit-20260912/acceptance-session-core-install-v2/result.json`；事件 SHA `2313475ED1950D469C98C0D5B4AC71C4DA1C9A687776DB4C4F32C1E8CD143527`，TAP log SHA `C28AB415FB4FB06105C91AEB08936F9D742AA76C46E5E07EA7A3D8A425743A9C`。四个 JS 源/测试 syntax check 和 diff-check 通过。

## 精确包与四个完整组合

只接受 `@deepseek-ai/dsh-client-ui-conversation@0.1.2-alpha.5`。行为 BEFORE/AFTER 与核心作者已接受候选一致；新增的是完整源字节证明和安装调用。

| 完整输入状态 | 输入 SHA-256 | 核心修复后完整 SHA-256 |
|---|---|---|
| official | `7EE5792B3F15AC1B691EEE7D373869101F8C7D336FC22B3F66D082612E4B1BAE` | `B15A5B70AA45D4CD2B8E6943B491AAD1AC5CA28C1921FABEF97C224304B3F14B` |
| visibility | `6F797EB8E87C07E33B9EF35EAACC0ECA9BC122E04E14D176EA81354FD53358A2` | `AD31C94C8DD1C7ABA3AAB3470DA20837682F714C82A2A15182EFBD8C6CC17E94` |
| imageQueue | `F74FE0B737247960AFD92416768A6EADC030259700AE91C0E83966C45BC27DC1` | `81888F259D71D874A2D5D9DBF0412EE8DFD00797CBE5EA46FB69395116287646` |
| visibility + imageQueue（正常安装最终入口） | `C1D6C06786CB52B51892A162E72D2F9C011FEB7F751E849306F36E63CE5DBE04` | **`30F413CC27BE08F0B57A472440495B033EA8B708E281D465CD5BBE3E45CD0066`** |

不是仅以 anchor/marker 或 normalized 局部串承诺可信。完整 hash 必须落在这四对之一；同形状追加字符、CRLF 变化、未知或重复形状均拒绝。已经完整打补丁的四种输出逐字节幂等。restore 先验证完整输入/输出，再恢复唯一订阅块并复核对应原始 hash；不能先剥 marker 再把未知字节“洗”为可信上游。

## 正常安装顺序与重入

1. alpha.5 native capability 预检。
2. 既有 composer visibility 胶合。
3. 原有 provider v4 / marketplace 1.5.5 BBA241 等安装逻辑。
4. 既有三文件 image/queue 组合安装。
5. 新 `patchInstalledSessionCoreClient(file)`。

核心 adapter 验证包名/版本及所有完整 hash，使用现有 `writePatchedRuntimeFile`，不退回直接截断 writeFile。可在测试中为该 writer 注入故障端口，实际目标始终为临时包。

重复整个安装流程不能被旧预检误判：native capability 和 image/queue 的 conversation normalize 仅在完整 hash 验证后恢复 core，再走既有 visibility 及 official/image-queue 完整证明；旧包版本逻辑和既有官方证明常量不放宽。native alpha.5 capability 函数允许显式临时 node_modules 根，避免测试调用默认真实目标。

五个临时安装用例覆盖：

- 与 provider v4、marketplace BBA241 同顺序实际调用正式 adapter，完整安装与重复无变化；源码检查 CLI 的核心调用确实在 image/queue 之后，但不执行 CLI。
- 四对 input/output 和逆序 core→visibility→image/queue 收敛到相同完整最终 hash。
- 包名/版本不符、同形状异 hash、最终漂移拒绝且无覆盖；native 与 image/queue 重入仍拒绝漂移。
- writer 的 rename 注入 EPERM，旧文件字节不变、临时文件清理、正常重试成功。
- 从实际临时安装后的完整 bundle 导出真实 SessionInputShell，执行 100 个 bundled Lexical 编辑器生命周期，检查 queue 订阅取消一次、无销毁后发布及无 queue 路径。外部 React/Cordis/snapshot-store 为端口替身，不复制理想编辑器算法。

## 历史 100 项与当前 102 项

`coverage-runtime-storage.json` 原 `scriptInventory`、`baseline`、runs/features 均保留；新增 `currentScriptInventory` 引用原 groups 加两个精确增量：`deep-audit-marketplace-patch.mjs`、`deep-audit-session-core-patch.mjs`。

查漏 fixture 继续严格相等枚举全部当前顶层脚本，拒绝重复、少列或多列；同时锁定历史对象 canonical JSON SHA，防止把历史 100 改成新计数或覆盖旧 baseline：

- 历史 inventory：`787B735932F1C0511B309D287DC216E256A3EF9EB83B733251F50B398FC8AA63`
- 历史 baseline：`F5E1E62A30C7FB2BA05C3F42EEACFA2074101F4DA0568E7D46EC63CBCE38C54C`

旧共享 installer 的已接受 SHA 为 `710E8BCD47A604F481121EA8D336A815527A3373BD2374CAF8E2E585DDDDAEB8`。当前源另有 currentSha256，不把旧 hash 伪装成新代码通过证据。索引计数不等于动态执行了 102 个脚本。

## 安全复跑与边界

使用现有隔离 runner，它固定拒绝外部覆盖 skip-pattern，并内置四个精确排除名称：

- `installed alpha.5 MCP client and Goal tool are exact complete patched artifacts`
- `one publisher command exposes the immutable resumable release order`
- `publisher fails closed unless the desktop manifest is signed and verified before commit or mirroring`
- `the real release audit accepts the checked-in publisher contract`

```powershell
node .artifacts/deep-audit-20260912/run-isolated.cjs acceptance-session-core-install-v3 tests/deep-audit-session-core-install.test.cjs tests/deep-audit-session-core.test.cjs tests/deep-audit-runtime-storage.test.cjs tests/official-runtime-patch.test.cjs tests/official-runtime-patch-composition.test.cjs
```

每个 mode 必须用新名，保留旧 evidence 目录，不覆盖失败证据。整个任务不运行默认 node_modules installer、发布 CLI 或当前运行的 1.0.62，不修改真实 node_modules。此前市场任务中 whole-suite 包含两个旧 MCP/Goal no-op 调用的边界偏差仍保留在 marketplace-patch.md，本次不能重演或删除该历史。

本项证明源安装/哈希/临时包算法，不证明运行中 GUI 重建、视觉、真实 IME、浏览器持久化、真实会话或 OS 长时内存压力。共享安装多文件不是全组瞬时事务；只承诺每个文件已验证、原子写及已证明状态的可重入安装。
