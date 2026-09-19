# HTML 预览关闭生命周期修复

## 结论

**候选源码的局部修复已验证；不代表安装版、全部 USER 或完整产品验收。**

| 同一真实组件矩阵 | 原 35 项 | 新增 13 项 | 合计 |
|---|---:|---:|---:|
| `before-final`（原源码快照） | 34 pass / 1 fail | 8 pass / 5 fail | **42 pass / 6 fail** |
| `after-final`（修复源码快照） | 35 pass / 0 fail | 13 pass / 0 fail | **48 pass / 0 fail** |

两个 run 均使用 Electron 43.2.0 / Chromium 150.0.7871.129、真实 renderer DOM、实际服务文件读取/CSP。原 35 项检查代码保留逐字节相同；新增断言同一版本用于 before/after，未修改旧作者 test、fixture、pins、报告或原红 freeze。6 个红断言是关闭/重开问题的不同观察面，不等于6个独立漏洞。

外层 Node 每个 run 均 **1 test / 1 pass / 0 fail / 0 skip / 0 cancelled**。before 的外层测试只在确实复现指定产品红项时通过，绝非声称原产品全绿；after 外层要求48项全部通过。before 总耗时8760.8276ms，after 8818.7244ms。旧 `final-v4` 的34/35和外层红结果原样保留。

## 最小生产变更及绑定

唯一生产文件：`renderer/right-workspace-integration.js`，**仅增加37行**，完整差异在 `.artifacts/deep-audit-round2-preview-lifecycle-fix/production.diff`。

1. 成功渲染HTML时仅保留浅复制的文件与来源元数据，不保留运行中的窗口或待决请求。
2. 统一 `controller.on('close')` 保持既有generation失效，并真实清空HTML document节点、移除interactive状态。浏览上下文因此销毁，不以过滤postMessage伪装停止。
3. 重新进入document时，从成功元数据调用原 `renderDocument`，重新应用原安全URL、sandbox、referrer和load/reload路径，创建全新iframe。没有沿用旧JS状态。
4. 新请求开始或来源context改变时清除恢复记录；关闭期间的迟到成功不能复活。模型nonce记录和回执实现未改。
5. 文档快捷键直接打开也恢复host可见性和关闭按钮焦点；Home/Files/Browser入口继续使用既有打开逻辑。

| 输入 | SHA-256 |
|---|---|
| 完整原integration源码快照 | `e0f8c6cf400335cf29a0a99e8172a0abf9a05e566afa1435c18d1195cc7c6919` |
| 完整修复integration源码快照/当前生产 | `bf81102462e8802fbc9520826271886a6822077bd23e4a5bb67665a66a1e2eb8` |
| 原35检查区块 | `0751ecc6c2cba315ae50057818608dd8aa1e98df6ac35c21d9593e24a7b221bd` |
| 最终新增13检查区块 | `07ef9b6d3f2304e7f34440ac919b4dbe3fffa4fd156ce7d107655d7d966935cb` |
| before-final receipt | `0cf42b8daf5b27dfcb1fc5462867e6098d10647f4e23db59482e63f4e71cfcd0` |
| after-final receipt | `0932652b1a3b34651f33e4e3ec9099000063bb05f8917799e1378f7150baa272` |

完整快照在新artifact的 `snapshot/before/renderer/` 和 `snapshot/after/renderer/`。本次实际加载的其它renderer、CSS、index/sidebar/CSP、服务、package与缓存Electron精确hash均在两个run的 `input-manifest.json`/`binding.json`；before/after共享输入逐项相同。没有读取或加载并行成员正在修改的main/app，未把其变更算成本任务回归。没有复制理想渲染器、VM替代或export seam。

`verification.json` 逐字节证明6个区域未变：安全预览URL、系统打开来源动作、当前请求守卫、workspace打开、local/workspace-link来源读取、完整模型nonce/observe/cancel回执区域。真实HTML CSP/sandbox的原断言仍实跑，不只做源码regex。

## 停止执行的直接证据

新增探针保存**实际旧iframe的WindowProxy**，监听器始终保持开放、不丢弃其消息。先明确收齐至少2个该上下文的活跃心跳，再点实际关闭按钮，100ms排队宽限后再观察约241ms。不是仅看`hidden`、仅移除listener或统计全部页面的混合消息。

| run / 同一renderer时钟ms | 阶段 | 旧上下文心跳累计 | 旧iframe连接 |
|---|---|---:|---|
| before 2430.70 | 活跃 | 2 | true |
| before 2532.40 | 关闭后约102ms | 3 | true |
| before 2773.70 | 再过约241ms | 5 | true |
| after 2430.50 | 活跃 | 2 | true |
| after 2532.50 | 关闭后约102ms | 2 | **false** |
| after 2773.50 | 再过241ms | 2 | **false** |

明细 `before-final/lifecycle-trace.json`、`after-final/lifecycle-trace.json`。原35项的独立心跳检查同样从红转绿。换文本、切Home后卸载、controller.destroy停止执行的检查继续通过。

## 新增覆盖与边界

- **FIX-01–03：**关闭移除确切旧节点；document中无iframe/interactive残留；宽限后旧WindowProxy心跳停止；重复close保持清空。
- **FIX-04：**合成Ctrl+Shift+]重开创建新iframe、产生新boot、保持同一安全资源URL，host可见且焦点在带标签关闭按钮。
- **FIX-ENTRY home/files/browser：**每条路径先关闭，再通过对应入口重开同一HTML，确认新boot与焦点。Files使用实际列表行点击，其service回执为fixture合成。
- **FIX-05–06：**加载中close→reopen→迟到HTML成功不复活；context改变后快捷重开不重放旧HTML。
- **FIX-07：**close/cancel后nonce仍superseded；允许合法的迟到superseded终态回执，禁止新rendered/其它成功回执。未调用截图、模型或真实native。
- **FIX-08–10：**关闭后文本精确保留、失败role=alert、切换Home后旧app停止；原nonce、source snapshot、A→B旧成功/失败、错误恢复、边界及CSP检查未删改。

这里只修HTML app iframe生命周期，未扩到音视频暂停、PDF解码或它们的完整关闭契约。重开是新运行上下文，不保留JS游戏进度；使用既有安全资源URL，不声称重新调用文件预览IPC刷新磁盘元数据。

## 安全与运行方式

新入口 `tests/deep-audit-preview-lifecycle-fix.test.cjs` 从冻结旧test做明确、唯一锚点的有界派生；只有repo/fixture/artifact/被测integration快照绑定、receipt标签和新增区块插入。原检查区块可以精确逆向还原，转换列表及派生脚本hash在各run的 `derivation.json`；执行源码本身为 `derived-runner.cjs`。

沿用逐字节相同的旧 `renderer.js`、`interactive.html`、`deny-network.cjs`，只复制到新fixture scope。PowerShell `ProcessStartInfo.Environment.Clear()`，每run全新profile；Electron子进程再次环境白名单。Node网络、Electron native clipboard/open/download/capture、子进程能力、renderer敏感端口均先封禁。

仅允许原精确本地资源与单一 `http://127.0.0.1:9/preview-fixture` 合成标识，后者通过Electron专属session协议在连接前从明确本地字节返回；没有socket/server。before为11次、after为13次进程内协议调用（合法恢复额外创建上下文）。两个最终run的native、Node网络、fallback请求、导航guard均0；`.invalid`负例由产品CSP/sandbox先拒绝。不是OS syscall或抓包层证明。

从维护树运行，Run必须为不存在的新目录：

```powershell
& ./tests/fixtures/deep-audit-preview-lifecycle-fix/run.ps1 -Run independent-before -Mode before
& ./tests/fixtures/deep-audit-preview-lifecycle-fix/run.ps1 -Run independent-after -Mode after
```

before始终执行原源码快照，after必须与当前生产hash一致。不会覆盖旧run。`verify.cjs`生成一次性`verification.json`并拒绝覆写；可传`--check`只读重核该证据。五个新/修改脚本已做syntax检查。

## 过程与保留的失败观察

- `before-v1` / pwsh-161：48项41过；新增nonce检查误把合法superseded终态回执也禁止。只修本次新增断言，原35未改。
- `before-v2` / pwsh-162：48项43过；额外旧WindowProxy探针未先确认启动，短窗口没抓到消息，不能作为停止证明。原35心跳红仍正常。
- `after-v1` / pwsh-164：48项通过；仍补强上述额外启动同步，未改变生产修复。
- `before-final` / pwsh-165与`after-final` / pwsh-166：同一同步版新增区块，最终42/48→48/48，所有job已收齐。
- Host重启后按恢复指示重新核对同一claim/lease与持久任务状态；不重复执行已收齐的测试或覆写冻结输出，仅收尾报告与交付hash。

旧作者 `round2-preview.md`、旧test/fixture与旧 `final-v4` receipt/log/binding/manifest/sidecars均逐项校验无漂移，旧master未回填。原红和新绿并存，不能把旧源证据改写为新源通过。

## 总审集成提示

本次是既有 `USER-01a3c4e3ad85`、`USER-394498c58518`、`USER-815f7e7b046f` 关联 `preview-load-switch-close` / `preview-html-sandbox` 的局部修复增量，**不将任何整个USER标绿**。无需修改其它生产文件；未commit、打包、发布、安装或刷新运行中GUI。

未验边界保持：真实Host/session鉴权与完整IPC wire、真实键盘/IME/读屏、安装版运行、图片音视频/PDF、长时后台节流/音频功耗、多OS、完整HTML worker/wasm矩阵、截图中的持久白栏根因。遵守禁止当前GUI的范围，报告未在真实右栏打开；本轮只提供fresh隐藏Electron中的实际组件证据。
