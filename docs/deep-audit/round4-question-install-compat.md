# 旧安装回归 → 成对入口的兼容迁移：范围与逐条映射

## 1. 实测结果与范围更正

**实测（本轮真实执行 `node --test tests/deep-audit-question-card-install.test.cjs`）：`tests 6 / pass 5 / fail 1`，exit 1。**

唯一失败项是测试 1 内的源码检查断言：

```
AssertionError [ERR_ASSERTION]: normal CLI wiring is source-checked, never executed
```

它对应旧测试 L64–69 依赖的旧 CLI 字串（`const questionCardChanged = targetsAlpha5 ? (await patchQuestionCardRuntime(root)).changed : false`），而现行 CLI 已改为 `questionDeliveryChanged`（`scripts/patch-official-runtime.mjs:3586`）。这与第三轮报告记录的缺口**完全一致**。

**更正我本轮先前的静态推断**：我据一次 grep（模式 `export async function patchQuestionCardRuntime`）判定该函数"已整个不再导出"，并据此声称 6 个用例都会以 `TypeError` 失败——**这是错的**。实测证明 `patchQuestionCardRuntime` 仍然可用（5 个用例通过，包括竞争锁、注入 rename 失败、以及真实 Electron 行为夹具那 3 个重用例）。该 grep 模式未能匹配其真实导出形式，属方法误用；结论以实测为准。

**因此迁移范围回到"窄"**：旧套件今天只剩 1 条断言不兼容（CLI 接线字串），而不是整套失效。若要把它接成对入口，工作量是"更新该断言的接线检查 + 按需增加成对覆盖"，而不是重写 181 行。


## 2. 逐条映射（旧用例 → 现行等价物）

| 旧用例（行） | 断言内容 | 现行等价物 | 判定 |
|---|---|---|---|
| 1 `normal question install hooks … preserve the full known composition on replay`（L53–70） | 跑完整维护链并逐文件比对已知组成；再源码检查 CLI 接线顺序 | 维护链现行最后一步是 `patchQuestionDeliveryRuntime`；期望终态从旧 Q v1 `6f382a53…` 变为成对 `Q 39f1fa00…` + `G 52814635…`（+ conversation companion `30f413cc…`） | **语义保持，期望值必须换成成对终态**；CLI 接线检查改为 `questionDeliveryChanged` / 成对调用 |
| 2 `shared mandatory preflight rejects missing or foreign question package before any maintenance writes`（L72–83） | 共享强制预检在任何写入前拒绝 missing/identity/version/hash 四类故障，且整链零写入 | 同一不变量，改由 `assertInstalledQuestionDeliveryPreflight` 承载；**必须仍然证明"先在整链写入前预检"** | **不变量保持**，仅换入口 |
| 3 `question adapter changes only its exact target and checks every replay byte`（L85–95） | 只改目标文件、逐字节校验重放、幂等 changed:false | 成对 API 的等价不变量：**必须同时覆盖 Question 与 Gateway companion**，且只能改这两个目标 | **不变量加强**（从单目标扩为成对两目标） |
| 4 `question preflight and writer reject wrong identity, version and same-marker drift without overwriting`（L97–119） | 错身份/错版本/同 marker 漂移（含 `original+\n`、CRLF 变体、`patched+注释`）均拒绝且不改字节 | 身份/版本/漂移拒绝语义应保持；成对入口还要新增"未知或混合 pair 拒绝" | **保持 + 新增成对拒绝** |
| 5 `frozen question writer preserves old bytes on competing lock and injected rename failure, then recovers`（L121–145） | 竞争锁返回 `EEXIST` 且锁文件与全量字节不变；注入 `rename` EPERM 后调用次数恰为 1、无残留临时文件、可恢复；并校验冻结 helper 哈希 | 成对 writer 的顺序两文件发布**不是跨文件原子事务**，因此等价不变量要按成对语义重述：锁竞争、首写前失败、第二次 rename 失败导致 first-changed 时**不得声称成功**、离线精确恢复 | **语义需要重述**（旧用例假设单文件原子） |
| 6 `actual installed question bundle passes frozen isolated Chromium behavior …`（L149–181） | 用真实 Electron + 隔离 profile 跑冻结行为夹具，断言 44 项检查与最终产物哈希；真实依赖目录未被触碰 | 等价物应针对**成对产物**：Question + Gateway companion + conversation companion；行为夹具的 44 项属于旧单卡语义，需重新核定适用范围 | **需重新限定范围**，不能直接沿用 44 项作为成对覆盖 |

## 3. 现状与后续

- **本轮未创建新测试文件，也未修改旧测试或任何生产文件**；本节只交付范围判断与逐条映射。
- 剩余工作（写 `tests/deep-audit-round4-question-install-compat.test.cjs`、fixture、跑真实红项）需要：① 隔离 fixture（白名单环境变量 + fresh HOME/DSH_HOME + 预导入写入/网络/native/child fence）；② 在 fresh 临时包上调用现行成对 API；③ 明确"旧套件未迁移前不兼容"这一事实不得被新候选的通过掩盖。
- 旧套件本身**不做删改**：其历史通过记录与红项都保留。

## 4. 诚实边界

- 上述映射基于**静态阅读**（旧测试 181 行全文 + 现行安装器导出与 CLI 调用点）；**未执行**旧套件，因此"会以 TypeError 失败"是源码级推断，本轮未取得真实运行的红项计数。
- 45 项与 44 项等既有分母属于第三轮已验收证据，本节未重新核算。
