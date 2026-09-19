# alpha.5 图片/输入队列补丁的真实入口整合

## 范围

本次只改 `scripts/patch-official-runtime.mjs` 和本文。已提交的 `scripts/image-preview-performance-patch.mjs`、`scripts/composer-queue-performance-patch.mjs` 及原性能报告未修改。

原五个 Source transform 单独幂等，并不等于真实 CLI 可重放：CLI 最先执行 `assertInstalledAlpha5NativeCapabilities()`，原来会把已应用新补丁的 Session/Conversation client 当成未知 SHA 拒绝。此次整合处理这个真实组合问题，而不绕过官方来源校验。

## 来源与完整组合证明

使用当前 `package-lock.json` 对应的三个 alpha.5 registry archive URL。以 Node fetch 下载到验证进程内存，对**完整tgz**计算 `sha512-<base64>` 并逐项等于 lock integrity；用内置 zlib 解包后读取 `package/lib/client.js`。没有执行包代码或修改安装件。

三份解出的官方字节经 SHA-256 验证，再执行 image→queue 的完整变换，得下表。Conversation的“canonical”仅去除既有modern composer visibility变化；没有用图片marker恢复/放行。

| 包（@deepseek-ai/ 前缀） | 官方 SHA-256 | 完整图片/队列组合 SHA-256 |
|---|---|---|
| dsh-api-session-controller | `F2EC317D1C1F020662B2BD004E6770C721A7BF7BFD90020B3F06BFB2557C70D6` | `AA6B518813EBA20A061C044EA7C63A3DDB5F71D085BB34840D144ED8202906D9` |
| dsh-client-ui-conversation | `7EE5792B3F15AC1B691EEE7D373869101F8C7D336FC22B3F66D082612E4B1BAE` | `F74FE0B737247960AFD92416768A6EADC030259700AE91C0E83966C45BC27DC1` |
| dsh-client-ui-attachment | `4E166AB570F88D2A76E1E60737D2AA83EEE088198D4AF0C153E5EBE668A9A9AA` | `DD68F6C0BC0DA69E17B7CA555E88FC1C55B0B9523C72D36D01CF55AC4665E26D` |

Conversation另叠现有modern composer的实际落盘SHA：
`C1D6C06786CB52B51892A162E72D2F9C011FEB7F751E849306F36E63CE5DBE04`。

原modern composer独立应用的当前维护文件SHA：
`6F797EB8E87C07E33B9EF35EAACC0ECA9BC122E04E14D176EA81354FD53358A2`。

`ALPHA5_IMAGE_QUEUE_SOURCE_PROOFS`记录官方和完整输出的精确摘要。原Session/Conversation官方SHA不变；新增Attachment的完整官方SHA capability项（不是仅锚点校验）。

### 为什么不是marker豁免

`assertInstalledNativeCapabilities`仍然校验每个capability包名、版本、原官方SHA和原capability锚点，仍拒绝退休包重新出现。既有：

- Conversation `restoreModernConversationComposerVisibilitySource`；
- Chat `restoreAlpha5ChatSentTimeSnapshotSource(restoreAlpha5ChatScrollSource(...))`；

都原样保留。只有当前version精确alpha.5、proof.official精确等于该artifact原expectedHash、source SHA精确等于对应proof.patched三个条件同时满足时，允许完整新组合输出。仅有图片/队列marker、单个helper输出、未知空白变化均不通过。

## 真实生产调用路径

CLI原入口不更换，不新增服务：

1. `cliOfficialRuntimeGraph()`验证原根图和锁图；
2. alpha.5执行扩展后的 `assertInstalledAlpha5NativeCapabilities()`；
3. 执行原来已有的各patch（含modern composer）；
4. `targetsAlpha5 ? await patchInstalledAlpha5ImageQueuePerformance() : false`；
5. 输出图片/队列组合已应用或已校验的准确日志。

新公开函数：

```js
patchInstalledAlpha5ImageQueuePerformance(files = {})
// files可为隔离测试提供 { session, conversation, attachment } 三个client.js路径。
// 生产默认路径都从当前dispatcher所属root派生。
// 返回 boolean：至少一个目标文件替换为true；全部已应用/旧版明确不适用为false。
```

| 顺序 | 目标文件 | 变换 |
|---|---|---|
| 1 | node_modules/@deepseek-ai/dsh-api-session-controller/lib/client.js | patchImagePreviewSessionSource → patchComposerQueueSessionSource |
| 2 | node_modules/@deepseek-ai/dsh-client-ui-conversation/lib/client.js | 已有modern composer → patchImagePreviewConversationSource → patchComposerQueueConversationSource |
| 3 | node_modules/@deepseek-ai/dsh-client-ui-attachment/lib/client.js | patchImagePreviewAttachmentSource |

全部三个manifest/版本、全部输入SHA、全部完整输出SHA在**任何新图片/队列文件写入之前**检查。混版本和未知版本拒绝。三个伴随包均为明确旧rc.2/alpha.2/alpha.3/alpha.4时，函数返回false，不读取client源码、不调用任何新helper；CLI中更先由`targetsAlpha5`隔离旧版本。

`Function#toString()`会保留Windows checkout CRLF。已证明官方输入为LF后，中心仅把**生成输出**规范化为LF，再验证固定输出SHA；不规范化/宽容接纳未知输入。原helpers保持不变。

## 中断与文件写入

每个目标的image+queue变换在内存中全部完成，不依次把单个helper状态写盘。每个文件使用同目录唯一 `.image-queue-<uuid>.tmp`：

1. `writeFile(..., flag: 'wx')`完整临时输出；
2. 重新读取原文件，必须仍等于此次已验证source；
3. `rename(temporary, file)`替换完整文件；
4. finally清理本次临时文件（忽略已rename后的ENOENT）。

因此跨文件中断可能留下“Session已完整patched，Conversation/Attachment仍官方”的状态。下一次CLI全局前置校验接受每个**官方或精确完整输出**，跳过已完成文件，补剩余文件。

仅应用image一个helper的单文件状态不在白名单；拒绝修补。这不是静默兼容缺失，而是禁止来源不明的半文件。真实kill如果发生在临时文件写入过程中，不会把临时部分内容作为目标；可能留下未引用临时文件。未声称该实现提供跨三个文件的单事务、跨进程锁、目录fsync或断电持久性保证。

## 实际dispatcher验证

自建临时复制树，复制维护scripts、package.json/package-lock及只读依赖来源；三个目标client使用上面SHA512验证过的官方archive字节复位。运行的是复制树**未替换业务入口**的：

```text
node <fixture>/scripts/patch-official-runtime.mjs
```

未在维护树或产品安装树运行该写入CLI。维护三目标文件验证前后SHA一致。

### 结果

| 场景 | 结果 |
|---|---|
| 三目标官方输入，完整CLI首次 | exit 0；三文件达到精确完整输出 |
| 同树完整CLI第二次 | exit 0；对复制树整个node_modules递归文件SHA清单，前后完全相同 |
| preload仅对第二目标的image-queue临时文件rename抛错误 | exit 1，确为`INJECTED_IMAGE_QUEUE_RENAME_FAILURE`；第一文件已完整patched、第三文件仍官方 |
| 上述故障状态重跑完整CLI | exit 0；三目标等于首次完整输出 |
| 故障恢复后再次完整CLI | exit 0；整个node_modules内容清单不变 |
| 三个目标分别各追加一个空格 | 三次均exit 1，在capability `source hash changed`处拒绝；拒绝前后全树清单不变（除测试预先故意注入的空格） |
| Session只应用image helper而没有queue helper | exit 1，前置SHA拒绝 |
| 实际export dispatcher，三包manifest为alpha.2、源码为无alpha.5锚点sentinel | 返回false；源码不变，未调用新变换 |
| 临时复制的两个helpers改为CRLF，目标恢复已验证输入，再跑完整CLI两次 | 两次exit 0；三输出仍精确等于上表LF摘要 |

故障测试最初把Windows原生绝对路径用于Node `--import`，Node以`ERR_UNSUPPORTED_ESM_URL_SCHEME`在执行任何dispatcher前拒绝。该次不算有效故障验证；改成 `pathToFileURL(...).href` 后才得到上表的真实rename故障与成功重放。这是测试预载URL修正，不是绕过产品SHA门。

### 既有回归

```text
node --test tests/official-runtime-patch.test.cjs \
  tests/official-runtime-patch-composition.test.cjs \
  tests/official-alpha3-compatibility-regression.test.cjs \
  tests/official-alpha2-runtime-contract.test.cjs
```

67项：60pass、0fail、7项按版本/需要独立alpha.2候选的条件skip。alpha.2完整产品CLI没有在当前alpha.5锁图上冒充执行；本次实际验证旧版兼容的是新export的版本隔离+既有官方classifier/兼容分支回归。新正式测试仍归测试成员持有。

## 后续验收与限制

- 图片/队列机制与性能数字见工作区原 `output/image-composer-performance.md`。12图约71ms是Node隔离链数据；本整合不把它升级为线上网络或浏览器可见首帧“十倍加速”。
- 本任务验证正式脚本生产入口及安全重放，不验证真实浏览器GPU解码和用户问题会话请求；这些仍需总QA。
- 未增加attachment Remote取消参数；未改草稿/queue/steer业务语义或提交的两个helpers。
- 本成员没有改测试文件、node_modules安装件、发布配置、包版本；没有Git提交、发布、重启正在使用的产品、后台job。
