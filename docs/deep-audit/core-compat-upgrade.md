# DeepSeek 核心新版本兼容更新：清单、守卫与升级前置条件

## 1. 结论与责任边界

用户新增需求：DeepSeek 官方核心（`@deepseek-ai/dsh*`，不是本仓库的桌面壳）已发布比 `0.1.2-alpha.5` 更新的版本，需要完成兼容更新。

**当前状态：已完成全部离线可做部分，真正的版本提升尚未执行，也不能声称已兼容。**

- 已完成：版本钉/版本门的完整清单、一个可复跑的离线守卫测试、以及升级必须重跑的验证计划。
- 未完成且**不能伪造**：把核心升到新版本。本机不存在比 `alpha.5` 更新的核心字节，而现行安全限制明确禁止下载依赖。
- 本任务未修改任何生产文件、未改 `package.json`、未触碰运行实例、未发布。真正的版本提升必须另行获得直接授权后再单独限定任务。

## 2. 已核实的现场事实

核心版本在两层都是一致的，本机最新核心就是 `alpha.5`：

| 位置 | 核心版本 |
|---|---|
| 检出 `node_modules/@deepseek-ai/dsh` | `0.1.2-alpha.5` |
| 运行目录 `runtime/1.0.59`–`1.0.62` | `0.1.2-alpha.5` |
| 运行目录 `1.0.56`/`1.0.57`、`1.0.58`、`1.0.29`–`1.0.54`、`1.0.20`–`1.0.25` | 依次 `alpha.3`、`alpha.4`、`0.1.1-rc.2`、`0.1.0-rc.7/rc.8` |

维护链涉及的 16 个核心包，在检出与最新本机包（`runtime/1.0.62`）之间逐文件比对：

- 全部 `.js/.mjs/.cjs` **字节相同**；唯一差异是部分 `package.json`。
- 我此前修复针对的 5 个关键文件字节完全相同：Question client `232a66c6…`、conversation client `6f797eb8…`、gateway client `55dbd591…`、gateway server `c69e238a…`、connection client `1b8e76d7…`。
- 包集合差异：检出独有 `dsh-authorization`、`dsh-hook-protocol`、`dsh-sdk-protocol`、`dsh-util-workspace-path`；最新包独有 `dsh-app-boot`；`dsh-llm-pi-ai` 在最新包内少 1241 个嵌套文件；`dsh-plugin-marketplace` 在检出缺失（它是按 URL 固定的外部插件）。

字节证据见 `source-before.json`。

**这解释了升级的真实代价**：文件内容层面的维护补丁大概率可复用，但**版本门与每版本派生的哈希/锚点表必须整体重做**，包集合差异也必须显式确认。

## 3. 版本钉与版本门清单（全部消费点）

| 位置 | 内容 | 性质 |
|---|---|---|
| `package.json` L51–70 | 20 个 `@deepseek-ai/dsh*` 精确依赖 | 必须随核心版本更新 |
| `package.json` L259–264 | 6 个 optional 精确依赖 | 必须随核心版本更新 |
| `scripts/verify-static.mjs` L676 + L677–716 | `OFFICIAL_ALPHA5_VERSION`、20+6 根白名单、`assertOfficialAlpha5ReleaseContract`（每次无条件执行） | 生产发布门，必须更新 |
| `scripts/patch-official-runtime.mjs` L2664–2667 | `OFFICIAL_ALPHA2/3/4/5_VERSION` | 当前版本常量必须更新，历史常量保留 |
| `scripts/patch-official-runtime.mjs` | 每版本派生的 `OFFICIAL_ALPHA5_*` 哈希/锚点表（如 `OFFICIAL_ALPHA5_CHAT_SCROLL_HASHES`，含 official/patched 双哈希与 anchors） | 新版本必须重新派生，**不能从旧版本复制** |
| `scripts/deep-audit-question-card-patch.mjs` L7 | `QUESTION_VERSION` | 必须更新，且需重新派生其冻结源哈希 |
| `scripts/deep-audit-session-core-patch.mjs` L4 | `SESSION_CORE_VERSION` | 同上 |
| `scripts/packaged-selftest-contract.mjs` L11 | `OFFICIAL_ALPHA4_VERSION` | 历史基线，故意冻结，不随升级改动 |
| `scripts/verify-static.mjs` L718 | `if (pkg.version === OFFICIAL_ALPHA4_VERSION) …` | 历史契约守卫，必须保留 |
| `scripts/verify-static.mjs` L643–647 | `REMOVED_DSH_ROOTS` 三个已移除根 | 必须继续拒绝重新进入 |

## 4. 守卫测试（离线、可复跑）

新增 `tests/deep-audit-core-compat.test.cjs`。只读文本文件，不下载、不启动 Electron/CLI、不联网、不改 `node_modules`。

基线模式（当前树自洽）：

```powershell
node --test tests/deep-audit-core-compat.test.cjs
```

实测 **9/9 通过，exit 0**（约 100ms）。它断言：26 个核心根恰好一个版本；`node_modules` 实际安装版本等于声明钉；当前版本有发布门契约且无条件执行；白名单与 `package.json` 根集合完全相等（防止包增删静默通过）；历史契约仍保留在显式版本守卫内；已移除根仍被拒绝；安装器有当前版本常量与派生的哈希/锚点表；两个审计补丁助手版本一致。

升级清单模式（新核心到手后直接当 checklist 用）：

```powershell
$env:CORE_COMPAT_TARGET_VERSION='0.1.2-alpha.6'; node --test tests/deep-audit-core-compat.test.cjs
```

对假设目标 `0.1.2-alpha.6` 实测输出 **32 处待改并失败（exit 1）**，逐条指名文件与动作：26 条依赖钉、发布门契约、安装器常量、安装器每版本哈希/锚点表重派生、两个审计助手常量。这正是"半更新"探测器——只改钉不改门、或只改门不重派生哈希都会被拦住；并且明确声明任何一处都**不允许通过修改测试来满足**。

## 5. 升级必须重跑的验证（获得新核心字节后）

| 面 | 必须重跑 | 是否必须独立成员复核 |
|---|---|---|
| 安装器原生门 | 13 项身份/版本/锚点门在新核心上全部重派生并复核 | 是 |
| 成对 Q/G 安装 | Q/G 成对契约、CAS、写失败/锁竞争/未知混对拒绝 | 是 |
| 维护链 | 完整维护链在 fresh 临时包上跑通、幂等重放 | 是 |
| 手机/WSS 链 | 分页、断线恢复、缓存守恒在受控合成 loopback 上复跑 | 是 |
| 桌面启动 | 启动路径静态核对 + 打包自检契约 | 部分 |
| 版本一致性 | 本套守卫测试基线模式通过且清单模式对目标版本返回"已兼容" | 否（可自动） |

## 6. 目标版本与已获取的新核心（2026-09-19 更新）

用户授权获取官方新核心包后，读取官方 dist-tags：

| 通道 | 版本 |
|---|---|
| `latest` / `next` | `0.1.5-rc.2` |
| `alpha` | `0.1.6-alpha.2` |
| 当前钉（落后 4 个次版本线） | `0.1.2-alpha.5` |

**目标版本取 `0.1.6-alpha.2`**：它是官方最新发布线，且与现有 alpha 钉同通道；壳的 26 个根在该版本全部仍有发布（抽查含 `dsh-app-boot`、`dsh-authorization`、`dsh-hook-protocol`、`dsh-sdk-protocol`、`dsh-util-workspace-path`、`dsh-shell`、`dsh-api-gateway` 全部存在）。若改走 RC 通道，`0.1.5-rc.2` 是等价替代。

已获取到**仓库外**隔离目录 `D:\DeepSeek-Harness-Desktop\core-compat-upstream\0.1.6-alpha.2`（`npm install --ignore-scripts`，488 个包、exit 0）。未写入检出的 `node_modules`、未执行安装脚本、未触碰运行实例、未发布。

### 实测结论：兼容确实是断的

| 补丁目标 | alpha.5 | 0.1.6-alpha.2 | 结论 |
|---|---|---|---|
| `dsh-client-ui-user-questions/lib/client.js` | `232a66c6…` | `5f519da4…` | **DIFF** |
| `dsh-client-ui-conversation/lib/client.js` | `6f797eb8…` | `c02a68eb…` | **DIFF** |
| `dsh-api-gateway/lib/client.js` | `55dbd591…` | `eb86260c…` | **DIFF** |
| `dsh-api-gateway/lib/index.js` | `c69e238a…` | `4410b2a9…` | **DIFF** |
| `dsh-client-connection/lib/client.js` | `1b8e76d7…` | `2ae9bba7…` | **DIFF** |

核心包数从 222 增至 260。更关键的是**锚点也变了**：`dsh-client-ui-conversation` 里只有 2 个旧锚点仍在，`SCROLL_SAMPLE_INTERVAL_MS`、`followRef`、旧 `ChatView({…})` 签名都已消失。这意味着旧补丁**不能靠改哈希重新钉住**，必须针对重构后的上游源码重新派生。

字节证据见 `fetched-0.1.6-alpha.2.json`。

## 6b. 下一步（拿到字节之后）

1. 逐补丁重派生：对每个维护补丁核对其锚点/不变量在新源码中是否仍成立，不成立则按新源码重构补丁语义，而不是放宽门。
2. 重派生每版本哈希/锚点表，并把发布门契约换成新版本契约（守卫测试的清单模式现在会直接列出所需改动）。
3. 执行第 5 节的完整重验矩阵，其中安装器、成对 Q/G、维护链、手机/WSS 链必须由独立成员复核。

## 7. 未验与诚实边界

- 本节所述"字节相同"只针对已比对的 16 个包中 `.js/.mjs/.cjs` 文件，不等于整棵核心依赖树逐文件相等；`dsh-llm-pi-ai` 等嵌套依赖树的缺口已如实列出。
- 未验证新版核心的实际运行行为：安装器在新核心上的真实结果、打包自检、桌面启动、手机链全部未在新核心上跑过。
- 未执行真实 CLI、未访问真实 GUI/Host/账户/设备/剪贴板/公网、未发布、未替换运行实例。
- 第四轮两个证据流任务（旧安装套件迁移、大快照尾延迟）仍为 pending：本轮 4 个成员（含两次定点替补）全部在启动后约 40 秒同一内部错误中止、零输出，属平台侧委派失败；已保留证据、未继续盲生成，改在主路线推进。这两项的真实交付仍未完成，不能当已做。
- 本记录未在被禁止的当前 GUI 中预览，仅本地文本读回校核。全项目审计仍未完成。
