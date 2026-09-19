# 手机外网同步：盲中继延迟与重连专项

## 结论与范围

**本地基准未发现 relay 主动引入约2秒的路由等待；真正修复的是半开占槽、慢手机牵连整个 Desktop、迟到旧连接及写失败的恢复边界。不是“真实外网指令延迟已经解决”。**

本任务只改 `services/wss-relay/server.cjs`、该服务的中文说明，新增专属 `tests/deep-audit-mobile-relay-latency.test.cjs` 和本报告。原会话/文件任务已验收，本任务没有重新修改其 scope。没有修改手机、Desktop mobile bridge、main/preload、实际配置、node_modules 或既有测试；没有连接真实手机、配对、云中继或账号，没有部署/发布。

由总审转交的移动端发现（本成员未独立复测）：Android `connectRoute` 在全局 synchronized 内进行网络 I/O；6并发/80ms受控连接的30样本 p50=242ms、p95=491ms。移动成员另修短状态锁和 route revision，本任务不重复该修复。

### 实际链路与测量位置

真实 composer 链路为 WebView → HarnessWebProxy（LAN/native P2P/WSS 选路）→ Desktop mobile-sync HTTP/Upgrade 反代 → core；不是另一条 `control/poll` 的850ms轮询路径。

本测试采用独立 `127.0.0.1:随机端口` HTTP+真实 ws relay、合成 Desktop/mobile，记录：

`合成提交 → clientAdapter调度 → mobile.send → relay message → relay send入队 → 合成desktop message → 合成desktop ack → relay ack入队 → mobile message`

relayForward 和 relayAck 是同步服务端函数段；syntheticRoundTrip 包含人工调度与本机 TCP、不是实际 WebView/core 或 WAN 端到端耗时。没有TLS、NAT、移动系统调度和云反代。Windows `setTimeout(0)` 也会有调度粒度，因此 no-delay 并不表示整条合成链路零开销。

## 基线红证据与修复

修改前 server SHA-256：`C025179265630CFC1123B41B3C3D3D38111EA380EC30BA020654724D2672C5B7`。

初始专属8项：3个转发基准通过、5个生命周期测试失败；随后慢手机隔离的独立红用例失败1次。没有把失败改为 skip。

| 问题 | 基线行为 | 最小修复 | 证据层 |
|---|---|---|---|
| 半开旧 Desktop 占房间 | server无ping/pong；旧Desktop不关闭时永占slot，重连4409。真实ws禁autoPong也未在400ms测试预算内被回收 | 每20s标准WS ping、等10s pong，失联terminate释放；没有允许第二Desktop抢占活跃连接 | 默认时钟20s+10s fake-clock；真实ws用40ms+60ms测试配置并在400ms内回收；正常autoPong手机保留 |
| 背压 close 不收敛 | `.close(4429)` 后只等对端/底层完成握手；非配合fake传输在1s检查仍占房间 | 所有服务端主动拒绝/失败close最多1s后terminate；close完成清除期限timer | fake-clock验证双方释放、rooms清空；真实既有控制/二进制背压用例仍通过 |
| 一个慢手机关闭共享Desktop | Desktop→慢mobile背压同时关闭source Desktop，健康同伴被迫进入offline | 已接受的Desktop socket记录在WeakSet；该复用source不因单手机失败被关闭，慢mobile独立回收 | 先红：desktop.closes=1而期望0；后验证健康手机继续转发、房间只移除慢手机 |
| 错误后旧socket可复活 | error触发remove后client.room=null；旧socket再送hello能够加入并继续转发 | 顶部检查removed/非OPEN，error终止连接并清理定时器 | fake socket注入error→旧hello→旧frame，转发不增加；旧close不能清新Desktop |
| write异常逃逸/异步失败含混 | send同步throw逃出message handler；没有明确异步send失败处理 | 同步catch、异步callback错误以1011有界关闭失败通道及非共享source；true只表示queued | 同步/异步假写错误分别验证；不生成业务成功回执 |

Admission拒绝的socket也安装错误收敛监听，防止拒绝后的错误事件无人处理。服务关闭时终止当前ws客户端，避免调用方一直等待活跃连接。原来的总连接、来源、房间、hello、速率、字节、信令能力白名单和同房间路由约束不变。

## 分段基准（毫秒）

每个配置24个合成指令同时提交，p50/p95使用排序后nearest-rank，max为最大值；数据仅来自指定单次运行，**不做显著性或优化倍数推断**。profile代码与采样点前后相同，机器负载/Windows调度不固定。

- no-delay：未额外加入网络抖动；仍通过定时器发包与模拟ack。
- ordered-jitter：客户端加入12–18ms、合成Desktop加入4–6ms的有序调度，不通过乱序重发“提速”。
- snapshot-burst：Desktop发送64个8KiB合成快照负载，再发送ack，约512KiB；真实loopback不是带宽受限公网。

下表各延迟单元为 **p50 / p95 / max**；丢/重/乱序均针对24个独立ID的命令回执，不将快照片段算作命令。

| 阶段 | profile | relayForward | relayAck | syntheticRoundTrip | 丢/重/乱序 |
|---|---|---|---|---|---|
| 修改前 | no-delay | 0.007 / 0.020 / 0.117 | 0.003 / 0.023 / 0.056 | 18.213 / 18.248 / 18.258 | 0 / 0 / 0 |
| 修改前 | ordered-jitter | 0.002 / 0.011 / 0.029 | 0.003 / 0.035 / 0.041 | 39.543 / 39.561 / 39.593 | 0 / 0 / 0 |
| 修改前 | snapshot-burst | 0.002 / 0.016 / 0.018 | 0.002 / 0.014 / 0.015 | 19.079 / 19.082 / 19.089 | 0 / 0 / 0 |
| 最终专属复跑 | no-delay | 0.008 / 0.022 / 0.133 | 0.004 / 0.025 / 0.048 | 22.905 / 22.936 / 22.945 | 0 / 0 / 0 |
| 最终专属复跑 | ordered-jitter | 0.004 / 0.022 / 0.040 | 0.004 / 0.014 / 0.024 | 37.468 / 37.483 / 37.526 | 0 / 0 / 0 |
| 最终专属复跑 | snapshot-burst | 0.003 / 0.013 / 0.015 | 0.002 / 0.009 / 0.011 | 19.232 / 19.236 / 19.237 | 0 / 0 / 0 |

最终专属运行另有完整分段输出：

| profile | clientAdapter p50/p95/max | mobile→relay loopback | relay→desktop loopback | 合成desktop处理 |
|---|---|---|---|---|
| no-delay | 6.689 / 6.894 / 6.897 | 1.105 / 1.206 / 1.218 | 0.464 / 0.962 / 1.043 | 13.653 / 13.758 / 13.767 |
| ordered-jitter | 21.169 / 21.359 / 21.380 | 0.766 / 0.859 / 0.864 | 0.595 / 0.811 / 0.876 | 13.815 / 13.899 / 13.906 |
| snapshot-burst | 9.652 / 9.834 / 9.848 | 0.548 / 0.635 / 0.641 | 2.952 / 3.141 / 3.162 | 4.869 / 4.947 / 7.220 |

分段统计量不能直接相加为总分位数；完整原始时间点在专属用例每条trace内计算。没有持久化内容、配对ID或密钥日志。

### 仍存在的大快照队头阻塞

独立 fake-clock FIFO adapter：出站64KiB/s，先320KiB快照，后24个64字节命令帧。量化结果：**p50=5011.719ms、p95=5022.461ms、max=5023.438ms，丢/重/乱序=0**。这是带宽模型，不是实测WAN，也不是本次修复后降低到的延迟。

4MiB字节上限在64KiB/s下理论上可对应64秒排队；字节上限不能承诺命令时延。relay不持有解密密钥，不能辨认composer命令、快照和Stop，更不能乱序/复制密文。需要由拥有端到端流语义的客户端/desktop桥评估快照分片预算、增量更新或独立通道；本次没有扩展为跨域改动。

## 恢复预算与兼容性

| 边界 | 本次界限 | 不能推导的结论 |
|---|---|---|
| 未hello | 8s后发关闭，非配合连接再最多1s强收敛 | 不是路由连接总超时 |
| 半开已hello | 默认20s ping + 10s pong，通常断线后约≤30s发现 | 事件循环阻塞、主机挂起会延后，不是硬实时SLA |
| 背压/错误close | 1s后terminate，及时释放房间、来源计数 | 已入TCP的业务指令是否执行仍未知 |
| 单帧同步转发 | 本机观察p95<0.05ms；CI宽松警戒250ms用于捕获路由级阻塞 | 没有512连接饱和、跨国RTT或云CPU容量保证 |
| 重连 | 只在旧Desktop确已释放后允许新Desktop；仍活跃者4409拒绝 | 不保证某次客户端重试恰好命中回收时刻 |

总审转交的代码核对：Android OkHttp的native/WSS均配置pingInterval20s，标准pong由库处理；Desktop ws默认autoPong=true，本次真实Node ws已验证。Android现有native退避5s递增到30s、legacy3s递增到15s。因此半开检测后仍可能多等当前退避周期；**30s检测不是30s内恢复业务**。没有提高重试次数或缩短这些客户端预算。

Chromium标准WebSocket实际环境、iOS URLSessionWebSocketTask control-frame pong、Android前后台/Doze均未由本任务实测；不能把codec业务`.ping/.pong`当WS控制帧证据。移动挂起应走断开/恢复，不能承诺靠20s心跳后台永久保活。真实composer TTL未确定，不能拿control850ms、路由cold2450ms或SOCKS连接预算冒充它。

## 顺序、去重、Stop与隔离证据

- 活跃Desktop仍拒绝同房间第二个Desktop（4409）；旧close、旧hello不能清除/替换后来合法连接。
- 慢mobile只影响该peer。mobile→慢Desktop仍保持既有失败通道关闭；其他mobile得到Desktop离线通知，而不是被放宽为另一个身份/房间。
- 50轮 Desktop/mobile 成对连接及释放：剩余rooms=0、clients=0、60s fake-clock推进后latePings=0、pong listeners=0。重复次数超过单来源32上限，后续仍能正常加入，反证来源计数泄漏；未新增公开metrics/身份日志。
- 专门验证离线期间1帧不存储/不重放，恢复后的新帧可到达。离线帧属于明确未转发，不伪称0丢失全链可靠投递。
- 发送相同合成密文2次，relay透明转发2次；端点RelayTunnelCodec拒绝第二次replayed。本服务不假装具有命令幂等去重或exactly-once能力。
- 关闭中的socket拒绝后来入站帧；这是**传输Stop边界**，不证明真实应用Stop能够撤回已转发或已执行命令。应用层取消/revision/幂等要求继续由端到端协议维护。

## 验证命令与安全环境

测试必须运行在清洗后的子进程环境，不继承真实能力endpoint/token。所有端口由fixture监听127.0.0.1随机端口；没有外网请求。依赖现有本地ws，不安装库。

```js
const fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process');
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-audit-env-')), env = {};
for (const k of ['SystemRoot','WINDIR','COMSPEC']) if (process.env[k]) env[k] = process.env[k];
for (const k of ['HOME','USERPROFILE','APPDATA','LOCALAPPDATA','DSH_HOME','TEMP','TMP']) {
  env[k] = path.join(base,k); fs.mkdirSync(env[k]);
}
env.PATH = path.dirname(process.execPath);
try {
  const r = cp.spawnSync(process.execPath, ['--test','--test-timeout=8000',
    'tests/deep-audit-mobile-relay-latency.test.cjs','tests/wss-relay.test.cjs'],
    {env,encoding:'utf8',timeout:18000,maxBuffer:2000000});
  console.log(r.stdout+r.stderr); process.exitCode = r.status ?? 1;
} finally { fs.rmSync(base,{recursive:true,force:true}); }
```

- 最终专属：**15 tests / 15 pass / 0 fail / 0 skip / 0 cancel，633.7035ms**。
- 最终兼容合并复跑：**38 tests / 38 pass / 0 fail / 0 skip / 0 cancel，658.2417ms**。既有23项测试包含真实路由、容量、信令与Desktop adapter生命周期，保持全绿；与专属15项是包含关系，不重复相加成独立覆盖率。此合并run额外CPU并发下relayForward p95为0.028/0.019/0.013ms，全部profile丢/重/乱序仍0；上文前后对照表固定引用单独专属run。
- `node --check` 服务和专属测试通过；scope内 `git diff --check` 通过。

### 候选字节快照

| 文件 | 修改前SHA-256 | 当前SHA-256 |
|---|---|---|
| services/wss-relay/server.cjs | C025179265630CFC1123B41B3C3D3D38111EA380EC30BA020654724D2672C5B7 | 60B239FDE28D0053DD65C0C6424ECCB1DD67839AD89A11FB5BF5B544F6E08007 |
| services/wss-relay/README.zh-CN.md | C2E6917529FFE83FA6027F0104B9CCF01917F1B7FD8731D7C98BA7746E1CCF08 | 22F983780C9F53ED221F52A4234695AB14D6309F5F705CF023CDFD1BDA864FEE |
| tests/deep-audit-mobile-relay-latency.test.cjs | 新文件 | 53576725EDDC25C97D455E5C50ECA09C05251089389F58F31C258003BB666686 |

没有运行实例或云服务更新；本报告仅做结构/证据复查，不打开真实GUI右栏。真实WAN/TLS/NAT、移动后台、多设备长期容量和完整composer动作回执均保持未验证，须由独立验收/设备环境补齐。
