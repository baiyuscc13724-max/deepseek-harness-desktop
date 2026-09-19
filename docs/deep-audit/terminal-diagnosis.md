# 隔离终端 exit=-1 有界归因

2026-09-12，限定只读诊断。结论：本次复现已直接证实 **offline-guard 拒绝 ConPTY worker 的原生 IPC 连接**，node-pty 把该错误映射为 exit=-1。不是测试超时；没有证据要求修改 TerminalManager 退出断言或放宽生产行为。

## 输入证据

- `.artifacts/deep-audit-20260912/baseline-v4/ordinary.log:15985–16006`：真实PTY项54.7ms失败，-1≠0。
- `.artifacts/deep-audit-20260912/acceptance-files-runtime-v1/acceptance-files-runtime-v1.log:1172–1193`：单文件序列同项49.7ms失败。
- `tests/terminal-service.test.cjs:113–135`：临时cwd，启动cmd `/Q`，仅echo synthetic标记并exit；exit=0和标记输出是有效行为要求。
- runner使用新HOME/APPDATA/LOCALAPPDATA/TMP/DSH_HOME；仅保留SystemRoot/WINDIR/COMSPEC/PATHEXT/PROCESSOR_ARCHITECTURE/NUMBER_OF_PROCESSORS，加Node+mingit+System32 PATH。未继承真实能力端点或密钥。

## 本次复现

不执行会写验收成员目录的runner本身；复制其**环境构造语义**到一次性命令，只运行现有 `tests/terminal-service.test.cjs`，test-concurrency=1/test-timeout=10000/外层timeout=20000。原 `NODE_OPTIONS --require offline-guard.cjs` 保持不变，没有去掉守卫、允许未知pipe或恢复真实用户环境。

额外使用临时preload `TEMP/pty-audit-observe-20260912-1234.cjs`，仅在主线程给已加载的 `WindowsPtyAgent.prototype._failPtyConnection` 包一层只读观察：输出error.code、截断message和是否仍存在pendingPtyInfo，然后立即调用原方法。未改依赖磁盘文件、不改变返回值、清理或授权逻辑。

工具回执中的直接证据：

```text
PTY_DIAG_CONNECTION_FAILURE {"code":"AUDIT_NETWORK_BLOCKED","message":"AUDIT_NETWORK_BLOCKED: unregistered IPC path","phase":"before-native-connect"}
not ok 4 - real Windows node-pty runs an interactive shell in the requested workspace
actual: -1
expected: 0
# tests 4
# pass 3
# fail 1
# skipped 0
# duration_ms 1150.0327
PTY_DIAG_RESULT {"status":1,"signal":null,"error":null}
```

诊断命令外层将“预期取得原测试exit1”映射为命令exit0，**并非原测试通过**。新临时HOME/TMP在finally中清理，仅清此次mkdtemp生成根。未终止真实终端、访问真实会话或联网。

## 精确调用链

1. `offline-guard.cjs:4,9,11–16`：pipe Set只登记本Node线程的 `net.Server` listening；未登记路径的Socket.connect立即抛AUDIT_NETWORK_BLOCKED。
2. `node-pty/lib/windowsPtyAgent.js:50`：原生startProcess创建ConPTY pipe，不经过Node Server.listening。
3. `windowsConoutConnection.js:66` 创建worker；worker继承preload，拥有独立的JS登记Set。
4. `worker/conoutSocketWorker.js:12` 首先connect原生conoutPipeName，发生上述拒绝；后续worker本地server.listen尚未执行。
5. `windowsConoutConnection.js:77–80` 转发worker error；`windowsPtyAgent.js:153–167` 设置exitCode=-1、清理并fire(error)。
6. `windowsTerminal.js:57–60` 的onError回调不转发error内容，只发exit。因此历史TAP中没有AUDIT_NETWORK_BLOCKED文本，**不能据此排除守卫**。
7. TerminalManager接收到-1，现有测试正确失败。

这条路径发生在 `_completePtyConnection` 启动实际cmd之前，所以环境变量缺失不是本次失败的直接原因。并发=1仍复现，也不应将两份历史失败简单称为并发偶发。其他尚未进入的原生启动问题不能由本次证据排除。

## 最小后续方案（交验收/文件owner）

本任务不改source/tests/guard，不skip。若验收要覆盖原生PTY，应设计单独的受限fixture能力登记：仅授权本次原生startProcess返回的随机conin/conout，以及其确切worker代理pipe，将精确登记传至对应worker并在结束时撤销。不能按conpty前缀无限放行，不能允许任意IPC路径，不能复用真实Host能力。另一选择是由独立OS层隔离执行原生测试并将覆盖边界单列。所有方案需guard owner审查和正负证明，不在本诊断里实现。

当前正式状态应为：**原测试仍fail；归因=隔离守卫与原生ConPTY登记模型不兼容；生产终端此场景未在该守卫下被验证**。会话成员所述其他隔离运行通过可作对照线索，但不是本任务新取得的通过证据。

## 输入SHA256

| 文件 | SHA256 |
|---|---|
| run-isolated.cjs | F907BCF1D3329FBA3D2A3904618873307334ACA0BF4573838AFB103639FD0617 |
| offline-guard.cjs | 79DF257FEFC0CD375D2C074AE0A0BB72ABB8D246319A2AB2FBAB105F4D805BCA |
| electron/bridge/terminal-service.cjs | 6EFBCCA75B21F8C1CE2D9554A8B1C77007E46D0F3EDD04C6CC2A8E1A00DE84C6 |
| tests/terminal-service.test.cjs | D023ED3611076F72E659F0E9CC5B10F505EBC79C158B12B03CD6E4DC6A3B0F3F |
| node-pty/lib/windowsPtyAgent.js | 4F503C377B11CBD113E1F32B3932FDC35E8132B0E647F4C6B70DC84224127C53 |
| node-pty/lib/windowsTerminal.js | B05D53D49CF9F422C2836029676AC2829F59CC14F5BBBBFAAFA08382FF044267 |
| node-pty/lib/worker/conoutSocketWorker.js | 241FF80C89AB6AAF01A7F98B9AE5D865CD3F76850B1EB5BA8A0AA30FBBE5AB2D |
