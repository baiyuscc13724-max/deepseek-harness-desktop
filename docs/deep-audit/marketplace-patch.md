# Marketplace 1.5.5 维护补丁审计

日期：2026-09-12。执行成员：基础。范围为市场维护补丁、正式安装适配器的临时包验证及证据报告，不包含发布、升级包版本、修改已安装市场或执行第三方安装代码。

## 最终候选与信任门

最终状态：**FINAL_READY，待总审独立接受**。只接受 `dsh-plugin-marketplace@1.5.5`：

| 对象 | SHA-256 |
|---|---|
| 上游 `lib/index.js` 输入及仍未修改的 node_modules 文件 | `F9352630E7FBB6D38647FF2FCF988CEF071648F78166A9C09D65BA42E8AE7699` |
| 最终维护后 `lib/index.js` 输出（不是脚本 hash） | `BBA2417FC236501BADF532C76A85673410C5579A5E54D420565C02E963836BDE` |
| `scripts/deep-audit-marketplace-patch.mjs` | `621E28486B854C7CF17D02BB537E495D6917D9BF64D70A6B67F4894709AD8242` |
| 共享 `scripts/patch-official-runtime.mjs` | `710E8BCD47A604F481121EA8D336A815527A3373BD2374CAF8E2E585DDDDAEB8` |
| `tests/deep-audit-marketplace-install.test.cjs` | `134B14F2678E01E73A173834FD14D07386F4C3D2A080E94DBECDC5D45EE95BE8` |

接口：`patchMarketplace155Source(source) -> {source, changed}`。完整输入 hash 必须为上述上游值；完整最终输出再次输入返回 `changed:false`。未知源、最终源追加字符、错包名和错版本均拒绝，不能凭 marker 接受。输出仍进行独立精确 hash 校验。

正式入口：`patchInstalledMarketplace155(file)`，已接入 `patch-official-runtime.mjs` 的正常安装流程，复用 `writePatchedRuntimeFile` 的排他锁、源字节复核、唯一临时文件、fsync 和 rename。测试显式传临时包 `lib/index.js`，没有调用市场默认真实安装位置。旧官方 DSH 包图、provider 凭据隔离输出门及原有补丁保持不变。

## 四组修复

### 1. 队列真正延后执行

上游 `const task = (async () => {...})()` 在加入 Promise 链前就开始读写，不能串行化快照。六处统一改为惰性函数并 `.then(task)`：`saveEnvStore`、`saveFeedback`、`saveInstalled`、`removeInstalled`、`appendPatchEntry`、`removePatchEntry`。前一次失败仍向该调用者传播，后续任务可继续。env/feedback/installed 单文件持久化使用唯一临时文件后 rename，避免失败的部分写入直接覆盖旧文件。

实际并发测试验证 patch append/append/remove 与 installed save/save/remove 最终无丢条目；配置成员的真实 patch 读屏障测试验证第二个任务不会提前读盘。

### 2. WebDAV 错误不披露传输细节

backup/restore 两个生产 handler 的 `error` 和本地化 `log` 仅使用静态 `WebDAV operation failed`，不拼接异常 message、URL、用户名、密码、Authorization 或 cause。配置测试注入合成凭据异常，验证返回体与日志均不含合成秘密；无真实 WebDAV 请求。

### 3. env JSON 与启动 dotenv 协调提交

- 整个 env 编辑进入同一 `envsQueue`，快照读取、合并、两文件提交均在串行任务内。
- `envs.json.lock` 以 `wx` 获取；其他进程/实例持锁时拒绝，不删除他人锁、不覆盖其数据。
- 每次从磁盘读取当前 JSON，保留其他仓库条目；跨仓库已拥有的同名键拒绝修改，避免一个仓库清除另一个仓库凭据。
- 空值清除 JSON 当前键及 `.env` 的所有同名 assignment，包含重复键、`export` 及旧多行值；不把空的 current 对象误当成无需清理。
- 未相关的行和多行值保持原文本；独立注释保留，目标 assignment 的行内注释作为独立注释保留。CRLF 跟随原文件。
- 先准备两份 stage 与旧内容 backup，再写 `.transaction` 标记，按顺序 rename 两文件。第二文件激活失败会恢复先前已改文件及内存视图；原先不存在的文件恢复为不存在。
- 回滚再次失败时保留 marker/backup/stage 证据并返回 `MARKETPLACE_ENV_RECOVERY_REQUIRED`，后续写入被拒绝，不能抹掉未知结果后继续覆盖。
- JSON 解析失败、读取权限异常不被当作首次运行；错误使用固定安全码，不携带原始凭据片段。

原字节恢复实测覆盖既有 **UTF-8 文本** 的空格、缩进、LF/CRLF。未把二进制或非 UTF-8 文件算作已验证支持。

### 4. skill/preset 单目录替换

复制到唯一同级 stage；成功后把旧目录改名 backup，再激活 stage。复制失败时旧树未动；激活失败恢复旧树。rollback 失败留 marker 和备份并拒绝后续覆盖。skill 和 agent-preset 分别实测 copy failure、activate failure 和正常成功三个分支。仅访问 fixture 自有缓存/目标目录，无克隆、npm、脚本或第三方进程。

## dotenv 编码的实际行为证明

实际安装的 `@deepseek-ai/dsh` 通过 `@deepseek-ai/dsh-app-boot` 读取 `.env`；本机解析路径为 `node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-app-boot/lib/index.js`，其第 4 行导入 `node:util.parseEnv`，约第 1019 行调用该函数。本补丁与测试均使用这一真实 Node parser，而非自造 decoder。

- 保留上游输入契约：字符串化、trim、4000 字符上限、连续 CR/LF 折为空格；JSON 与 dotenv 保存同一规范值。
- 编码器不再使用 JSON.stringify 冒充 dotenv quoting（这会把 Windows `\` 翻倍或截断含双引号的值）。只选内容不含相同定界符的 quoted 形式，或不以引号/backtick 开头的 raw 形式，且要求真实 `parseEnv` 精确往返。
- 原样字符串不可安全表达或包含 NUL 时，在任何文件激活前返回固定 `MARKETPLACE_ENV_VALUE_UNREPRESENTABLE`，保持两文件原内容，后续普通 edit/clear 仍可用。
- scanner 与 Node 的引号终止规则一致：反斜杠不把随后引号变成转义定界符；必须跨过完整的未相关多行值，不能把值内的 `FAKE_KEY=...` 当作真实键删掉。
- 实测：Windows 路径（含尾反斜杠）、literal `\n`、单双引号、backtick、`#`、空值、注释、未相关多行内容；配置的 mixed quote → 普通值 → clear 全序列通过。

## 验证结果与可重跑命令

独立文件 `deep-audit-marketplace-install.test.cjs` 共 **17/17**，包括真实临时 installer 的输出、幂等、异源/身份/版本拒绝；两文件失败回滚和失败回滚后的证据保留；同进程并发及其他实例锁；编码往返/拒绝；两个类型的三条替换路径。

最终候选联合四文件结果：**100 tests，97 pass，3 个原 alpha.2 历史 skip，0 fail**，job `pwsh-91`。同时两个生产脚本 `node --check` 和共享脚本 `git diff --check` 通过。

执行边界说明：这次 whole official-runtime 兼容组包含原测试 `installed alpha.5 MCP client and Goal tool are exact complete patched artifacts`，对已安装 MCP/Goal adapter 作了两次 no-op 调用；均返回 false 且固定 hash 通过，没有实际写入。不能把这次运行描述成“从未调用任何已安装 adapter”。市场 adapter 始终只在临时包运行。正式有界重跑已将该旧 no-op 测试排除，job `pwsh-93` 为 **99 tests，96 pass，3 个原 alpha.2 历史 skip，0 fail**，输出 hash 仍为同一最终 BBA241 候选：

```powershell
$env:DEEP_AUDIT_MARKETPLACE_CANDIDATE='pinned-maintenance'
node --test --test-skip-pattern='installed alpha.5 MCP client and Goal tool' tests/deep-audit-marketplace-install.test.cjs tests/deep-audit-models-plugins.test.cjs tests/official-runtime-patch.test.cjs tests/official-runtime-patch-composition.test.cjs
```

配置 fixture 的 candidate flag 只在该进程替换 VM 内的源；默认测试仍读取未修改上游并保留历史红证据，不把默认读取改成伪造绿结果。

## 中间证据不覆盖

- `4529EE...8637A`：初次临时 installer/事务 13/13 及配置旧四红转绿；随后发现 JSON quoting 不兼容 Node dotenv。
- `FE431A...850D8`：新增编码往返修复；尾反斜杠后 quote 的 scanner 仍错误，独立用例真实出现误删相邻行红结果。
- `1435B7...4361B`：修复该终止规则，独立 15/15、配置旧四红通过；配置随后发现 quote-leading raw 一次可 parse 但后续 scanner 失效。
- `AE536A...18BEC`：修复 scanner/encoder 自洽并保留多行与注释；临时改为拒绝 newline，导致既有注入预检契约测试 500≠200，联合 100=96pass/1fail/3skip。最终恢复原规范化契约，不改旧测试断言。
- `BBA241...836BDE`：本报告唯一最终候选，全部上述回归通过。不能将中间候选的通过数当作最终证据。

## 明确边界

- 两文件是有恢复记录的协调提交，不是 OS 提供的多文件瞬时原子事务；没有声称掉电恢复已实机演练。marker/锁残留不自动抢占或擅自删除，需要后续显式恢复处理。
- 单目录 stage/backup/activate 不承诺一个仓库多 roots 或多个插件的跨目录全有或全无事务。
- 同进程队列串行；其他实例通过排他锁失败关闭，不承诺跨进程自动排队重试。未验证不遵守该锁的外部手工编辑器。
- 未修改真实市场 node_modules、未升级 1.5.5、未运行真实市场安装、未使用真实密钥或网络端点、未发布或构建安装包。GUI/原生故障和非 UTF-8 数据不在本次通过范围。
- 新增脚本使当前脚本清单从历史 100 项变为 101；已通知总审在最终集成时保留历史快照并增补当前索引，本成员没有改写已接受的历史 coverage 记录。
