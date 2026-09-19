# 核心会话与输入区：可隔离缺口补审

## 结论与边界

本项补原会话/文件报告留下的 core/UI 缺口，不重做已提交的上传、归档和 relay 修复。**真实官方客户端逻辑可以隔离执行，不应把全部未知项归为“GUI 不可用”。**

- 同一套 28 项测试：未改官方源码基线 **25 通过、3 失败**；内存应用候选 transform 后 **28/28 通过**，无跳过、取消。
- 三个红断言是**一个资源生命周期缺陷**的三种证据，不是三个独立缺陷：销毁编辑器未解除会话队列订阅。
- 已执行真实 Session/Manager、Gateway journal、SubmitMachine、Lexical 编辑器、InputHub、ConversationController 及 WorkspaceBrowser 标题/搜索 handler；没有复制理想状态机来冒充生产实现。
- 修复仅作为 `scripts/deep-audit-session-core-patch.mjs` 中的维护 transform 候选交付。**未写 node_modules、未安装到当前 GUI，不能宣称运行中产品已修复。**正式安装胶合交基础维护者。
- 未访问真实会话、用户文件、配对、模型 API 或外网；未操作当前 GUI、启动替代服务器、发布或提交 Git。未做视觉排版、真实 IME、OS 剪贴板、媒体解码或真实浏览器持久化验收。

## 交付与复跑

| 产物 | 内容 |
|---|---|
| `tests/deep-audit-session-core.test.cjs` | 完整官方 bundle 的内存执行与 28 个行为断言 |
| `scripts/deep-audit-session-core-patch.mjs` | 纯函数、无 I/O、拒绝未知形状的候选 transform |
| `docs/deep-audit/coverage-session-core.json` | 原 26 个未知项逐项三分类、12 类优先流程与分层证据 |
| 本文 | 缺陷、测试结果、证据边界和安装交接 |

在维护仓库根执行：

```powershell
# 默认：仅在测试 VM 内应用候选，不改磁盘上的官方包
node --test --test-timeout=8000 tests/deep-audit-session-core.test.cjs

# 原始基线：预期同一缺陷导致三个失败
$env:DSH_AUDIT_SESSION_CORE_BASELINE = '1'
node --test --test-timeout=8000 tests/deep-audit-session-core.test.cjs
Remove-Item Env:DSH_AUDIT_SESSION_CORE_BASELINE
```

最终记录使用 Node.js v24.16.0，采用下列隔离子进程方式，而不是用户真实 HOME。添加 `env.DSH_AUDIT_SESSION_CORE_BASELINE='1'` 即为基线。临时目录在 finally 删除；超时 18 秒；没有后台守护进程。

```javascript
const fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process');
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'session-core-audit-')), env = {};
for (const k of ['SystemRoot', 'WINDIR', 'COMSPEC']) if (process.env[k]) env[k] = process.env[k];
for (const k of ['HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'DSH_HOME', 'TEMP', 'TMP']) {
  env[k] = path.join(base, k); fs.mkdirSync(env[k]);
}
env.PATH = path.dirname(process.execPath);
try {
  const r = cp.spawnSync(process.execPath,
    ['--test', '--test-timeout=8000', 'tests/deep-audit-session-core.test.cjs'],
    { env, encoding: 'utf8', timeout: 18000, maxBuffer: 2000000 });
  console.log(r.stdout + r.stderr); process.exitCode = r.status ?? 1;
} finally { fs.rmSync(base, { recursive: true, force: true }); }
```

| 记录 | 通过/总数 | 失败 | 跳过/取消 | 时长 |
|---|---:|---:|---:|---:|
| 未改官方源码，隔离环境 | 25/28 | 3（同一根因） | 0/0 | 191.3485ms |
| 内存候选，隔离环境 | 28/28 | 0 | 0/0 | 205.7225ms |

这两个运行高度重叠，**不得相加**，也不能与 relay 38 项或旧 session-files 运行相加为独立功能总数。时长不是性能优化结论。

## 实际执行层与替身边界

测试读取安装包 `lib/client.js` 全文，唯一的测试导出接缝是向 bundle 自身 `return module.exports` 前暴露内部类；原生产类、辅助函数和 bundled Lexical 均按原代码执行。所有外部 require 必须命中显式白名单；未调用任何包的 apply/宿主启动入口。

| 真实执行 | 仅作替身的边界 |
|---|---|
| Session、SessionManager、QueueMirror、ProjectionValueStore、Notifier | 远端 create/prompt/cancel/updateQueue/rename/list/page 的响应 |
| SessionEventStream 与真正的 Gateway RemoteJournalStream | Gateway 物理连接代际 carrier，不是 journal 算法 |
| SubmitMachine、SessionInputShell 与完整 bundled Lexical | 无 contenteditable DOM；外部 snapshot-store 是最小端口 |
| InputHub、ConversationController.sendSession → Session.prompt | Cordis 服务注册/作用域标签；未运行完整 Host agent |
| WorkspaceBrowser 实际函数与事件处理器 | React hook/JSX 端口、搜索计时器和 document 事件端口 |

因此，分页连续性、重叠去重、缺口补齐、投影序号、旧代际隔离、草稿编辑/还原、提交归属等是**真实生产算法证据**。但物理 WS 的重连退避、远端 schema 校验、服务器排队调度、LLM 中断、浏览器存储和 DOM 绘制不是本套证据。

队列移除请求使用真实 `QueueAction` 的 `kind:'remove'`，不是臆造的 cancel 动作；Stop 调用 `session.cancel` 并保留待处理 inbox。测试并不把 client RPC 成功解释成所有外部副作用都已取消。

## 十二类优先流程

测试编号按当前文件中的 test 声明顺序，完整标题可直接在 TAP 输出核对。

| 流程 | 证据 | 隔离结论 |
|---|---|---|
| 创建会话 | 02、04、24：成功立即可选、拒绝不造假会话、added/create 回声去重、刷新期间新增不丢失 | 通过；远端实体持久化为替身 |
| 切换会话 | 02、03、06、27：未知目标拒绝、不改变当前选择、A/B 独立状态、绑定 A 的发送不会写入 B | 通过；未跑整页导航 |
| 搜索 | 23：实际 debounce effect，旧请求 Abort，忽略迟到成功，失败状态，Escape 清理 | 通过；搜索服务返回替身 |
| 标题编辑/取消/恢复 | 05、21、22：低 seq 回复不能覆盖新标题，失败不替换；取消无 RPC，空白禁用，组合输入 Enter 不提交，错误后保留文本重试 | 通过；未证明真实 IME/视觉焦点 |
| 发送 | 06、09、10、11、12、27：身份/mode/signal/requestId，乐观清空、回声只退休一次、失败还原与并发结算顺序 | 通过；仅客户端 admission 路径 |
| 排队移除/steer | 08、09：准确 occurrence id、mode 传递，durable steering 退休幂等 | 通过；Host scheduler 未运行 |
| Stop | 07、13：精确会话 cancel 请求、失败区分 stop，保留队列；编辑器销毁中止未完成提交，拒绝迟到回写 | 通过；不代表可撤回已发生效果 |
| 草稿隔离 | 03、10–14、27：真实 Lexical A/B 文本，迟到失败不覆盖新输入，两次失败按提交顺序恢复 | 通过 |
| 附件隔离 | 10、13：各 shell imageIds 分离、失败还原原会话、销毁只返回本会话 retained ids 一次 | **仅 ID/rail 层通过**；选择器、字节上传、解码未覆盖 |
| 历史加载/分页 | 17、18、20：单飞、重叠去重、非连续页拒绝且保留原窗口、旧页迟到不污染新代际 | 通过 |
| 乱序与恢复 | 19、25、26：重复 live 帧忽略、gap 通过 authoritative page 修复、重连 cursor 倒退被拒绝 | 通过；物理 carrier 为替身 |
| 重开恢复 | 14、24：persisted draft 的 adopt/mirror、旧 unbind 不移除新 mirror、缺失列表时保存选择并在重现后恢复 | **恢复输入层通过**；未证明浏览器实际落盘/重启 |

## 唯一新增缺陷：输入区队列订阅未释放

**位置：**官方 `dsh-client-ui-conversation/lib/client.js:11557–11559`，`SessionInputShell` 构造器。

构造器调用 `deps.queue?.subscribe(() => this.publish())`，却丢弃返回的取消订阅函数。`dispose()` 只调用原有 `unregister`，无法移除该队列监听。InputHub 的真实 `queueReadFaceOf(session)` 最终持有 Session 的订阅，因此会话仍可达时，旧编辑器及其闭包也仍被持有。此问题不意味着普通切换必然泄漏；它发生在 shell 被销毁而对应订阅源仍存活的生命周期边界。

### 红→绿证据

- 15：单个 shell，销毁两次后队列监听数基线 **1**，应为 **0**；候选取消订阅恰好一次。
- 27：实际 InputHub → ConversationController → Session 路由正确，但作用域清理后 Session notifier 的监听数基线 **1**；候选 **0**。该失败并非跨会话误发送。
- 28：100 个真实 headless editor 生命周期后，基线残留 **100** 个队列监听；候选 **0**，此后队列更新对已销毁 shell 的 publication **0**。销毁期间的最终 release publication 是允许的，不算“迟到回写”。

修复把队列 unsubscribe 合并进现有 `Eu` 清理链，不改编辑、提交、队列或身份语义：

```javascript
this.unregister = Eu(this.unregister, deps.queue?.subscribe(() => {
  this.publish();
}) ?? (() => {}));
```

候选通过有/无 queue 两条路径及重复 dispose。没有垃圾回收堆大小或真实 UI 长时压测数据，不能把监听计数夸大为已测内存 MB。

### 安装交接

`transformSessionCoreClientSource(source)` 返回 `{ source, changed, fixes }`：

1. 仅接受带准确 conversation package id 的文本。
2. 仅接受一个原始三行 anchor，未知或重复形状直接抛错，不模糊替换。
3. 已有准确候选块时返回 changed:false，重复执行字节不变。
4. 无文件、环境、网络操作；调用方负责安全的正式安装、包版本/适用性验证和重建。

本 worker 未改 installer、main/app 或任何已经接受的旧文件。基础集成者应把这一个纯 transform 接入正式安装链，再在安装产物及现有 GUI 验证，而非让本测试的 VM 修改冒充安装成功。

## 原 26 个未知项重新分类

`coverage-session-core.json` 与旧 `coverage-session-files.json` 中所有 `status:unverified` 的 ID 做了集合一致性检查：**26/26 无遗漏、无替换**。

| 分类 | 数量 | 处理原则 |
|---|---:|---|
| 可隔离执行生产逻辑 | 16 | 本次为 7 个原核心条目补分层通过；附件切换仅补 ID 子层。归档、文件区异步 DOM、下载内容等可单独隔离，明确延期而非称 GUI 不可用；project 三项归对应成员，relay 引用独立报告 |
| 本次只能读源/能力尚未定位 | 2 | `session-retry-turn` 未定位专用 retry verb；失败发送重试不等于历史 turn retry。`files-tree` 原证据是 capped upload list，不能虚构递归树能力 |
| 完整结论依赖真实平台 | 8 | session/path 剪贴板、原生附件选择、系统默认应用打开、图片/音视频/PDF 解码、HTML sandbox 实际执行隔离 |

这不是把 26 项全改成通过。分类中的可隔离但未执行条目仍有明确剩余工作；其他成员的报告不是本套测试的独立证据。原有文件/媒体类和 project 层需由总审合并各域验收。

## 来源版本与指纹

四个官方包均为 `0.1.2-alpha.5`；以下为**磁盘上未修改的 lib/client.js** SHA-256，最终隔离运行重新输出同一值。

| 包 | SHA-256 |
|---|---|
| dsh-api-gateway | `55dbd591222b28e557e7d47368f7770114a88d97206e910fae940768c83950cd` |
| dsh-api-session-controller | `f2ec317d1c1f020662b2bd004e6770c721a7bf7bfd90020b3f06bfb2557c70d6` |
| dsh-client-ui-conversation | `6f797eb8e87c07e33b9ef35eaacc0eca9bc122e04e14d176ea81354fd53358a2` |
| dsh-client-ui-workspace | `53c40660195c42cde709b802e239f473dd721f45bc329684af31c01fdb73282a` |

新代码 SHA-256：

- test：`A23E5B09B233B67F8850A178F503C3ACFE0F7535907059090F6C1E0D0CCEF759`
- transform：`27133028141D0015C18BA1512F4F14CE17722074BCE664BFAE3954770C419426`

语法检查、JSON 解析、26 项分类集合检查通过。文档按源码/测试结果核对，不操作运行中的右栏预览；实际视觉预览和安装后验证仍未完成。无本 worker 遗留后台 job。
