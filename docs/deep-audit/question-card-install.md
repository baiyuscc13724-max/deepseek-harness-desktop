# 问答修复：正式安装与103项索引整合

2026-09-12；**FINAL_READY，待总审独立接受。** 只交付已接受问答候选的正常安装、严格前置检查、临时产物行为和索引。本项没有部署/发布，不诊断或宣称解决用户真机全部触摸症状。

## 冻结产物与边界

问答包只接受 `@deepseek-ai/dsh-client-ui-user-questions@0.1.2-alpha.5`：

- 原始完整 client SHA-256：`232A66C60AB295DB19336FBE37AB3B0C326B38A17C9D1D0CF23371B8B4664DF6`
- 唯一接受的修复后完整 client SHA-256：`6F382A535CB182B062365773C57B23579E8195C0096901C1864C0B1AE0079457`
- `e354…`、`d63…` 是过渡/退回候选，不在允许集合。

| 文件 | 最终源 SHA-256 |
|---|---|
| `scripts/patch-official-runtime.mjs` | `CECD16CC8DDD9627BE92170C038A7A0C6AD4B904C30A9B71CC5A86CBBF5034B4` |
| `tests/deep-audit-question-card-install.test.cjs` | `AB76113F37E680AE674156EB3E0C0553B547053823622CF3DCC309C1B4DEC18E` |
| `tests/deep-audit-runtime-storage.test.cjs` | `F960C81914516EAAEE9C5AF2DB366F270C91A4D47DFA0F6EC1BEB0B9720EF6FD` |
| `docs/deep-audit/coverage-runtime-storage.json` | `BB9D87C74A3AAE40D978DFAA4F3C537AD3F290D57051B15A2CB81248EEE64BE1` |

交互作者文件全程只读且 hash 未变：helper `251B67DA1CC2C3846181200A681BB9849927758E0ACE48D6EAC72B0D773F2FE7`；行为测试 `B42AD3D295FCE400A76ED469F5B2B35783B3EEAC1D221EDB5B322D07C83A82B8`。旧正式 installer `034CFD…` 作为历史保留，不假装它仍是当前代码。

## 正常链与完整必经前置检查

- 写入 API 仍是原样冻结的 `patchQuestionCardRuntime(runtimeRoot)`，从正式 installer 重导出并在 alpha.5 CLI 中实际调用。内部原有 `writePatchedRuntimeFile` 原子发布不被替换。
- 新 `assertInstalledQuestionCardNativeCapability(runtimeRoot)` 验证必需问答包的身份、版本及完整 base/final SHA。不剥 marker，不接受缺包或任何同形状异源内容。
- 新 **`assertInstalledAlpha5RuntimePreflight(runtimeRoot)`** 是正常 CLI 和临时组合安装共同调用的完整 gate：必验问答，再验既有13项 native capability。
- 正常 CLI 的 alpha.5 分支在 `sessionChanged` 及所有维护 writer 前，必调用完整 gate。源接线断言验证这一位置；本任务不启动真实 CLI。临时安装流程调用的是同一正式 gate，而不是在测试中临时拼两个独立 checker。
- 为保留已冻结的旧 dispatch 源码契约，CLI 原有单独13项预检仍在完整 gate 之前，代价是多一次只读13项检查。**旧13项 API 单独通过不等于新完整 gate 通过**；问答包绝非可选。

相关完整组合顺序为：完整 gate → visibility → provider v4 → marketplace → image/queue → core → question。其它既有维护分支不改变。核心/市场/提供方产物保持：

- core conversation：`30F413CC27BE08F0B57A472440495B033EA8B708E281D465CD5BBE3E45CD0066`
- provider v4：`28A7850E44BC24CDD0E5E7222EB0FE655877D1433DB59F8FF435934528BA0207`
- marketplace：`BBA2417FC236501BADF532C76A85673410C5579A5E54D420565C02E963836BDE`

真实临时包上重复整条相关组合，各 adapter 的 changed 均为 false，所有产物字节不变。这里只证明列出的完整相关组合及正常 CLI 接线，不将其夸大成执行了整个发布命令或真实安装入口。

## 六项安装测试证明什么

1. 正常组合各完整输出及全链重入；正常 CLI 必经 gate 和问答写入位置的源接线。
2. 缺问答包、错误身份、错误版本、陌生 SHA 从同一完整安装流程入口拒绝：比较全部维护目标及 manifest 的字节，确保任何维护写入都未发生。
3. 单独问答 adapter 只改变自己的完整 client，返回包名/路径/changed/最终 hash；重复仍逐字节验证。
4. 两端均拒绝错身份/版本、原始追加字符、CRLF、修复后相同 marker 的漂移，不覆盖目标。
5. 竞争 lock 的 EEXIST 保留对方锁；真实原子 writer 的 rename 端口被精确注入 EPERM 后，旧文件不变、stage/本次锁清理、正常重试成功。故障端口只拦截该临时目标；通过 `syncBuiltinESMExports` 同步真实内置 I/O，在 finally 恢复。没有编辑 helper 或复制理想 writer。
6. 实际安装后 client 在独立 Chromium 中执行作者冻结的完整行为断言，并禁止二次内存 transform，完成 **44项细分检查**。

## 实装 Chromium 最小 harness 差异

新测试读取作者测试并首先验证完整冻结 SHA，只提取它原有的 `electronMain` 及辅助代码到临时文件，不改原测试。临时副本仅作以下改动：

- repo 变成明确的原 checkout 绝对路径；问答输入改为实际临时安装后的 client；相关 conversation CSS 读取临时安装后的 core client。
- repaired 预期分支固定为 true，不由此改变输入产物。
- 原 `patchModule` 改为一旦调用就抛错；删去四行“读取 baseline→加载 helper→断言 base→内存 transform”准备段，改为读取实装文件并断言完整最终 `6F382…` SHA。
- 原生产 bundle 的 test-only 私有 export seam 保持作者方式；不改行为实现。
- 原44项行为断言、真实发行版 React/renderer、Android adapter 注入、真实本地 tool/service/carrier→结果行解析均保留。完成后附加回执 `{checkCount:44,bundleSha256:FINAL}` 及隔离进程退出处理。

因此不是以“原作者内存 candidate 测试仍绿”冒充实装。实装读取有完整 SHA 证明，helper 调用在子进程明确禁止，且子进程正常返回44项回执。继承的检查含同批多选/提交/分页、busy 锁、旧闭包、重挂载、失败重试、取消/abort/skip、selected 回显及本地 trusted touch/pan。44是子进程细分检查数，不作为额外44个 Node 测试重复计数。

Chromium 使用缓存 Electron、独立临时 profile/环境和本地 file origin；http/https/ws/wss 在 webRequest 被拒绝，fetch/WebSocket 被禁止；不连接真实 API、不取用户会话。native bridge 是显式本地替身，不能等同 Android Java/View/真实 WebProxy 端到端，也不能据此认定真机点击失效已归因。

## 历史100、历史102与当前103

- 原 `scriptInventory` 的100项与 baseline 不动。
- 原102项 `currentScriptInventory` 整个对象移到 `scriptInventory102`，其 canonical JSON SHA 保持 `81B601B4983DB7975C534F56A6F41E34487DEC2C590197ACAFC2E34932074347`，原 source hash、运行证据和当时状态完整保留。
- 新 `currentScriptInventory` 为103：100项原 groups + 历史102的两项增量 + `deep-audit-question-card-patch.mjs`。
- 查漏测试严格核对全部当前文件、唯一性、103计数及当前 installer hash，同时固定历史100、baseline和102 canonical SHA；不是放宽枚举断言或重写历史记录。

## 验证及保留的失败记录

`acceptance-question-install-v1`：6个 Node 测试中5 pass、1 fail。失败仅为我新 wrapper 将细分回执数量写成42，实装子进程已成功完成44项且最终 SHA 正确。原日志逐项有44个检查名称。将回执断言校准为精确44，而非放宽为范围；不改变作者断言或生产源码。旧失败目录保留。

`acceptance-question-install-v2`：**122 tests = 119 pass + 3原alpha.2 skip，0 fail/cancel**，约45.4s；8文件精确事件：market install17、question install6、runtime16、core install5、core行为28、alpha兼容8、composition13、official26+3skip。事件解析错误/source drift/test drift/audit drift 全部0。此后源码与测试冻结，只补当前索引验证元数据和本报告。

- 记录：`.artifacts/deep-audit-20260912/acceptance-question-install-v2/result.json`
- 事件 SHA：`AE8587F1CA77AD6DF52CBDBFA40AA2DE1CCCAFE13250199AC7AAE458C727AC1E`
- TAP SHA：`43E45D59BF5FA9D877A8D0B9BADE6F5E7A2284EDA006E87764E90E6E4BFDCEE7`
- syntax 与 diff-check：通过。

## 安全复跑

```powershell
node .artifacts/deep-audit-20260912/run-isolated.cjs acceptance-question-install-review-v1 tests/deep-audit-question-card-install.test.cjs tests/deep-audit-session-core-install.test.cjs tests/deep-audit-session-core.test.cjs tests/deep-audit-marketplace-install.test.cjs tests/deep-audit-runtime-storage.test.cjs tests/official-runtime-patch.test.cjs tests/official-runtime-patch-composition.test.cjs tests/official-alpha3-compatibility-regression.test.cjs
```

mode 必须用新名，保留旧记录；无需额外 candidate 开关。隔离 runner 的四个固定危险入口排除始终保留且不可覆盖：installed alpha.5 MCP/Goal 完整产物默认目标测试，以及三个 publisher 命令/签名/真实 release audit 入口。未执行任何真实 node_modules writer、发布 CLI、运行实例更新或 Android 真机操作。
