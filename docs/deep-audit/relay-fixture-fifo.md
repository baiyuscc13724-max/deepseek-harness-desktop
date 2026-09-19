# Relay 抖动夹具：严格 FIFO 修正

## 结论

这是**测试注入器修正，不是生产 relay 乱序修复**。任务提供的全量验收定位为：ordered-jitter 出现 reorder=22；逐次 schedule 注入 0.2ms CPU 停顿后，发送端自身先乱序，后续 relay 链路保留收到的顺序。旧夹具的 sendTail/ackTail 只保证绝对 due 单调，不能让多个独立相对 setTimeout 成为 TCP 式 FIFO。

本次只修改 `tests/deep-audit-mobile-relay-latency.test.cjs`，新增本文。生产 server、README、旧 `mobile-relay-latency.md` 及旧全量日志均未修改；也没有重跑整个项目。

- 三个原 timeline profile 继续保留 24 个并发提交及所有既有丢失/重复/乱序/转发尾延迟断言。
- 正常场景与双向逐次 0.2ms CPU 扰动：八个观测点全部为 `0..23`，drop/duplicate/reordered 均为 0。
- 故意交换真实 relay 转发出口前两帧：发送及 relay 入站仍为 `0..23`，其后六段真实观测均为 `1,0,2..23`；reordered=2，原健康顺序断言确实失败，负面测试因此通过。
- 最终仅运行 relay 两个相关测试文件：**41/41 通过，0 失败、0 跳过、0 取消，729.6357ms**。
- 此结果不代表真实手机、核心业务处理或 WAN 延迟已解决；不修改旧全量失败记录的历史事实。

## 修改机制

新增的 fixture-only `fifoScheduler` 每个方向持有自己的队列、tailDue 和**唯一 head timer**。

1. 入队仍计算 `due = max(tailDue, now + requestedDelay)`，保持原请求延迟目标。
2. 只有队首可以创建 timer；后续帧只入队，不能各自启动独立 timer。
3. timer 回调检查当前绝对时间；提前唤醒时不发帧，重新等待同一队首。
4. 到期后按入队顺序 drain 所有已到期项，不按帧号排序，也不按 ACK 驱动生产者。
5. dispose 取消唯一 timer 并清队列，重复 dispose 安全。

上行和回执分别使用独立实例。新的 `relayTimeline` 只提取原测试公共流程，`assertHealthyTimeline` 中的原约束保持为：

```javascript
assert.equal(drop, 0)
assert.equal(duplicate, 0)
assert.equal(reordered, 0)
assert.ok(segments.relayForward.p95 < 250)
```

此外增加每段实际帧序列的断言，不再仅凭收尾顺序推断何处开始乱序。

## 保持不变的负载与检查

| 项目 | 保持值/行为 |
|---|---|
| 提交数与并发方式 | 24 次同步入队，然后统一 await done；新增断言确认首个 receipt 前已全部入队，不是逐个等待 ACK |
| ordered-jitter 上行请求延迟 | `12 + (id % 7)` ms，原 tail 最大值约束 |
| ordered-jitter 回执请求延迟 | `4 + (id % 3)` ms，按实际收取顺序入回执 FIFO |
| no-delay | 请求延迟仍为 0，不增加业务级等待 |
| snapshot-burst | 首个命令触发 64 个 8192-byte synthetic payload，协议路由前缀不变 |
| 分段统计 | clientAdapter、upstreamLoopback、relayForward、downstreamLoopback、syntheticDesktop、relayAck、syntheticRoundTrip；全部继续输出 n/p50/p95/max |
| 原门槛 | drop=0、duplicate=0、reordered=0；relayForward.p95<250ms；原 timeline 6s 超时未放宽 |
| 低速带宽模型 | 未改：64KiB/s、320KiB 快照先于 24 指令；最终相关回归 p50=5011.719ms、p95=5022.461ms、max=5023.438ms，drop/dup/reorder=0 |
| 其他原用例 | 心跳、背压、共享 Desktop 隔离、所有权、陈旧帧、重连清理、离线不重放等用例保持原内容 |

严格 FIFO 是约束最早允许发出的时间与顺序，不是硬实时承诺。事件循环被占用或 OS timer 粒度较粗时，实际发送仍可晚于 due；不能因此压低延迟统计。

## 新增回归与负面证明

### 逐次 0.2ms CPU 扰动

上行及回执每次 enqueue 都在计算绝对 due 后、尝试 arm 前执行不少于 0.2ms 的同步 CPU 停顿。保留全部 24 个提交，不按回执串行化。

真实 loopback 的八个观测点：

`mobileSend → relayIngress → relayForward → desktopReceive → desktopAck → relayAckIngress → relayAckForward → mobileReceipt`

每一段都必须严格等于 `0..23`；原 drop/dup/reorder 与转发 p95 门槛同时执行。

### 可控量化/提前唤醒计时器

一个独立、确定性的 timer adversary 将相对延迟整数化，每次 enqueue 推进 0.2ms。它不是对 Node 内部 timer 实现的逐行复刻，而是允许提前回调的受控压力条件。

测试实际验证：

- 24 个任务全部入队后才推进 timers；
- scheduler 返回的绝对 due 与原 delay/jitter 最大值目标完全一致；
- 确实发生过可能早于请求时刻的 timer 唤醒；
- 队首没有提前发出，最终输出严格 FIFO；
- 同时活跃 timer 上限为 1，drain 有界收敛；
- dispose 后任务和 timer 均归零。

### 实际出口交换负面

仅在受控连接的 server-side `socket.send` 包装器中，暂存 id=0，先真实发送 id=1，再真实发送 id=0。没有修改生产源码，没有事后改写 `received`、指标或排序。

观测结果：

| 位置 | 实际序列 |
|---|---|
| mobileSend、relayIngress | `0,1,2,...,23` |
| relayForward、desktopReceive、desktopAck、relayAckIngress、relayAckForward、mobileReceipt | `1,0,2,...,23` |

断言 drop=0、duplicate=0、reordered=2；并用 `assert.throws` 确认**同一个原健康顺序断言**抛出 AssertionError。转发 p95 仍须小于 250ms，避免用延迟错误冒充乱序检测。FIFO 夹具没有把真正的出口乱序“排回正确”从而遮蔽错误。

## 验证记录与复跑

### 执行记录

| 范围 | 结果 | 说明 |
|---|---|---|
| 初次定向六例 | 6/6，325.8745ms | 原三 profile、CPU 扰动、出口交换、timer adversary；随后为 adversary 补显式原 due 目标等值断言 |
| 最终 relay 两文件 | 41/41，729.6357ms | 包含新增三例；无全项目重跑，无跳过/取消；临时 HOME/DSH_HOME，退出后清理 |

两次记录重叠，不相加为独立测试数。最终运行仍实际计算所有 timeline 分段；命令输出仅为易读过滤包含 `orders` 的长诊断行，没有过滤断言或失败状态。

```powershell
# 定向检查（输出完整八段顺序和所有时延分位数）
node --test --test-timeout=8000 --test-name-pattern="timeline|strict FIFO|negative control|absolute due drain" tests/deep-audit-mobile-relay-latency.test.cjs

# 仅 relay 域，不是全项目
node --test --test-timeout=8000 tests/deep-audit-mobile-relay-latency.test.cjs tests/wss-relay.test.cjs
```

最终隔离 runner：白名单继承 SystemRoot/WINDIR/COMSPEC；HOME、USERPROFILE、APPDATA、LOCALAPPDATA、DSH_HOME、TEMP、TMP 全指向一次性临时目录；PATH 仅 Node 目录；spawnSync 超时 18s，maxBuffer 2MB；退出 finally 删除临时目录。子进程非零状态原样上抛。未持有真实配对信息或真实云端连接，所有实际网络仅 `127.0.0.1:随机端口`。

## 指纹与冻结证明

| 文件 | 本次前 SHA-256 | 本次后 SHA-256 |
|---|---|---|
| latency test | `53576725EDDC25C97D455E5C50ECA09C05251089389F58F31C258003BB666686` | `C98C30DC97621E1C48AF781EE0C99766272501CB749B08D028DBD195D4E3D11C` |
| `services/wss-relay/server.cjs` | `60B239FDE28D0053DD65C0C6424ECCB1DD67839AD89A11FB5BF5B544F6E08007` | 同左 |
| `services/wss-relay/README.zh-CN.md` | `22F983780C9F53ED221F52A4234695AB14D6309F5F705CF023CDFD1BDA864FEE` | 同左 |
| 旧 `docs/deep-audit/mobile-relay-latency.md` | `82F7C3FE3C70C8CFE6B512EFB76BA135592C2AD210CF84E97A0A74C6BA1C40AF` | 同左 |

语法检查与 scoped diff-check 通过。旧报告只被读与哈希核对，本轮没有写旧全量日志。本文独立记录夹具修正，不重写旧统计、不将旧失败伪装为产品已通过。不操作运行中右栏预览；本文已做结构核对，未做真实 GUI 视觉预览。无遗留后台 job。
