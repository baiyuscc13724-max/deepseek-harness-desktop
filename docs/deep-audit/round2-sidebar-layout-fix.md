# 原生侧栏响应式与缩放几何：有界修复与证据

状态：恢复续作的同夹具最终 v10 成对运行已收齐：before 43/66（原23为18通过/5失败），after 91/91（原23全部通过）；迟到旧窗口成功/失败回执隔离均通过。来源核验与交付冻结见下文，本文不等同于独立总审验收。

## 结论与边界

本次只修复已稳定复现的浏览器侧栏响应式宽度、CSS px / 原生 DIP 换算，以及必要的 resize/zoom 自动触发。**用户原截图的首页持久白栏仍未复现或根因确认，不能标为已修复。**

生产修改只在 `electron/main.cjs`：
- `effectiveBrowserPanelWidth` 保持返回 CSS 用户偏好，而非响应式 cap 或 DIP，避免 `browserStatePayload.panelWidth` 回流后把窄窗口宽度永久存成偏好。
- `layoutBrowserView` 按只读 `renderer/right-workspace.css` 的 620/900 分界、桌面保留 560CSSpx、覆盖模式保留 48CSSpx 计算；横纵均转换到 shell zoom 对应 DIP。
- `browserStatePayload` 给偏好计算传入 CSS viewport；原窗口 resize 改为有所属窗口栅栏的绑定。
- 必要监听、可信来源和生命周期辅助代码均在上述 main 几何段；没有新 IPC、preload 接口、renderer/CSS 写入、通用 eval 接口或 guest 注入。

`scope-verify.cjs` 将两段授权函数/辅助段、一个偏好字段和一个事件绑定点规范化后，与**完整原 main**逐字比较；已验证剩余字节相同、15项旧接受证据不变、CSS 不变。原 main SHA-256：`4e547cd4fa5a0cff7b58c84b9d3747129eec574ce09014c48ca6e0a2bf8b42fc`；候选：`74ea22e9b158dd34fb244d8dac6f0b91dd5a9e873e1017c8d26e597cbb8d24f9`。仓库相对 Git 基线还存在他人先前改动，不能用整个 git diff 归因本任务。

## 坐标契约

| 实际 content 宽度 / zoom | CSS viewport | 原生左侧 / 宽度 DIP |
|---|---:|---:|
| 1000 / 100% | 1000 | 560 / 440 |
| 901 / 100% | 901 | 560 / 341 |
| 900 / 100% | 900 | 48 / 852 |
| 760 / 100% | 760 | 48 / 712 |
| 620 / 100% | 620 | 0 / 620 |
| 480 / 100% | 480 | 0 / 480 |
| 1460 / 125% | 1168 | 700 / 760 |

纵向使用实际 toolbar bottom / footer top 对照，而非只看外栏宽度。158CSSpx 顶部、34CSSpx 底部换算并向窗口内收敛；930DIP 高、125%时原生 y=198、height=690。允许边框与像素取整带来的 1DIP 差值。零/极小/短窗口不产生窗口外、负值或非有限 bounds，零面积不显示。active tab、sidebarVisible、contentVisible、window/tab destroyed 守卫保留。

## 自动缩放触发与生命周期

实际 Electron 的 `webContents.setZoomFactor()` 没有产生 `zoom-changed`；单改公式或仅添加该原生事件不足。`event-gap-v5` 的原23已全绿，但扩展64项中只有62通过，剩余两红正是**不手工 layout 的程序缩放横/纵定位**。这个红结果保留。

经总审明确授权，main 对所属主窗口 renderer 使用固定一次性 resize Promise：
- 每次用现有 `isOwnedPageSender` 校验真实 owner、webContents、mainFrame 和可信本地 `renderer/index.html`；query/hash 处理沿用既有安全函数。
- 返回仅含 viewport width/height/DPR 的有限数值三元组。重挂时先与上次三元组比较，跨进程间隙发生变化就一次读取最新快照，最终布局仍读取当前完整 native size / zoom；没有定时器或轮询。
- 每个 owner 一份 WeakMap 绑定；窗口、contents、文档 generation、frame 和递增 binding token 共同栅栏。旧 resolve/reject 不得进入新 owner/文档。
- resize/pagehide 监听随单次完成删除；重复 bind 复用 disposer。dispose/closed/destroyed 移除 main 监听；停止脚本只取消自身 binding。拒绝终止该轮监听，不形成重试忙循环；真实后续文档加载可重新建立监听。
- 原生 resize / zoom-changed 仍是有 owner/source 检查的补充触发；wide-mode 更新沿用现有 CSS 偏好状态字段。

隐藏测试窗口中，有些 renderer resize 晚于100ms；`resize-observer-v6`、`observer-trace-v7` 保留了这个瞬时红。trace 已观察到真实 `[1168,744,1.25]` 回执。最终自动事件断言使用 **100ms+1200ms 的有界稳定观察，不调用 layout、不强制 repaint**。因此本证据证明有界稳定收敛，不证明前台 GUI 的100ms无闪烁 SLA。

## 真实 Electron 夹具与结果层级

运行使用缓存 Electron 43.2.0 / Chromium 150.0.7871.129 / Node 24.18.0；没有下载或安装。

- 完整原13输入（含 Electron executable）保存在 `.artifacts/deep-audit-round2-sidebar-layout-fix/before-inputs/`。before 使用这些原字节；after 将当时维护树的13输入复制成每 run 不可变 source，并逐个校验实际载入的 renderer 字节。并行获准的 app.js/integration.js 改动不被冒充测试回归。
- 真实原壳 DOM/CSS/controller/integration、真实 webview、真实 WebContentsView。guest 只有合成 `LAYOUT FIXTURE ONLY`，未加载正式对话 AppFrame；官方 column solver 仅原函数切片运行。
- main 函数是完整源文件中的原样切片，状态依赖绑定隔离窗口/原生 view；**不是完整 main 启动**。可信来源函数也是原切片；仅 `__dirname` 映射到隔离壳目录，测试页保持 `renderer/index.html` 结构。
- 迟到回执测试先让固定脚本在真实 Electron 完成，再在明确记录的测试传输层扣留 resolve 或注入 reject；不是伪造 DOM/zoom/bounds。新 owner 使用另一个真实窗口和原生 view，并统计实际 setBounds 转发调用。
- 原23断言在同一派生夹具的 before/after 中都保留。无新监听的原源码将新增 lifecycle 特性标记为不可用；因此扩展总项数不相同，不得把未执行的 before 新特性伪称实测全矩阵。

已收齐的中间证据：
| run | 结果 | 用途 |
|---|---:|---|
| bound-before-v4 | 41/59；原23有原5红 | 严格源绑定的原几何红 |
| bound-after-v4 | 59/59 | 仅计算正确，不代表自动触发 |
| event-gap-v5 | 62/64 | 自动程序缩放缺口 |
| resize-observer-v6 / observer-trace-v7 | 62/64 | 100ms瞬时观察与真实订阅 trace |
| lifecycle-v8 | 87/87 | 自动缩放、重挂末次变化、连续 resize/zoom、tab、实际 reload、旧文档回执、来源拒绝、reject收敛、关闭/解绑/重绑/销毁 |

### 最终 v10 与迟到回执

v9 保留不改：`final-before-v9` 为43/66，`final-after-v9/failure.json` 是夹具在关闭 peer webContents 后再次访问已清空属性的 TypeError，未形成可验收 after receipt；不是产品布局失败。恢复时无 Electron 遗留，未重放旧 run。v10 仅修夹具保留真实 contents 句柄并新增回执/bounds 写入轨迹，生产 main 保持 v8 的同一摘要。

| 最终 run | 执行结果 | 原23 | receipt SHA-256 |
|---|---|---|---|
| recovery-before-v10 | 1个 Node test，exit1；43/66符合，23红 | 18/23，原5红保留 | `953143fc1e7c1f32948454da6f53ebc7f38ba67eb218a9f6f54e9d575ae662d6` |
| recovery-after-v10 | 1个 Node test，exit0；91/91符合 | 23/23 | `a8e2ed2580d4fc6c5eea56e9e8b2e1e056e52fbadd401e0e3ac08241a25a6349` |

before 没有新订阅函数，事件生命周期段执行一项“订阅不可用”红断言后返回；after 才执行该段。因此66与91不是同分母测试全通过率。原23断言块仅 `sourceRoot` 装载路径 seam 不同，其余字节核验相同，原23名称与期望也逐项相同。

迟到旧窗口证据来自 after receipt 中两项 `late old-window ...`：
- resolve：A实际返回 `[1168,744,1.25]` 后被夹具扣留，B已产生可见 native bounds `{x:0,y:198,width:760,height:160}`；约31169.79ms释放，到31279.80ms观察，bounds不变、setBounds计数1→1。
- reject：A实际返回 `[973,620,1.5]` 后夹具将交付改为拒绝；B可见 bounds `{x:0,y:237,width:760,height:112}`；约34172.41ms释放，到34281.54ms观察，bounds不变、写入计数1→1。
- 两分支随后关闭B真实contents，再调用实际布局函数，均安全忽略销毁native tab。拒绝仅在测试传输层注入，不声称真实Electron自然生成该拒绝。

`verification-recovery-v10.json` 核验两run全部13 source和10份harness逐项摘要、同fixture、当前源/夹具零漂移、原23断言块、真实图片SHA、native/Node网络/renderer端口错误与越界请求均为0、15项旧接受证据不变。前后仅三个输入不同：本任务 main，以及已由其他成员修复的 app.js/integration.js；app.js仅冻结为输入，本夹具不执行其主题逻辑，不把其效果归因几何修复。

完整run源码与夹具分别保存在各自 `source/` 和 `harness/`；最终交付清单 `delivery-freeze-recovery-v10.json` 绑定本报告、测试/夹具、两个run结果及来源、核验脚本和JSON。冻结不包含活跃profile缓存、不修改旧freeze，也不包含自身摘要。恢复续作只写既定fixture/report/artifact scope；两个后台作业pwsh-10（after）、pwsh-11（before）均已收齐。

## 夹具纠错与范围事故（不抹除历史）

1. 最初派生替换漏掉 `round2`，在旧 artifact 根下**新建**了 `deep-audit-round2-sidebar-layout/before-v1/`。没有覆写接受证据。已报告总审，按明确指示保留原状、不删除。新 capture 在写入前校验精确新根。
2. Home 卸载 browser pane，最初额外 rect 探针未判空导致 fixture 失败；已改为可空。该失败不是产品红。
3. 初期 derived renderer 仍从 repo 读取而不是 sourceRoot；已修复后用 bound-v4 重跑。before-v2 / geometry-after-v3 不作为完整源码绑定验收。
4. 原派生 receipt 继承了一个固定 screenshotSha256 字面量。v9 已改为读取实际 PNG 计算；早期该字段不作为图片摘要证据，旧 receipt/PNG 不改。数值几何结果独立保存，不以该字面量判定。
5. derive.cjs 是一次性派生记录，不是后续人工补丁的完整再生成器；会拒绝已有目标，不要重跑它覆盖当前夹具。

## 安全、重跑与未验证项

每 run 清空环境，使用独立 profile / userData / DSH_HOME。文件 URL 精确 allowlist、严格 CSP，Node/Electron/renderer 网络与 native 能力守卫保持；没有 sockets、当前 GUI、真实账户/设置/设备/剪贴板、发布或打包动作。导航负例仅本测试的 `about:blank`。

```powershell
# 在维护树运行；每次使用未存在的新 Run 名
pwsh -NoProfile -File tests/fixtures/deep-audit-sidebar-layout-fix/run.ps1 -Run review-before-NEW -Phase before
pwsh -NoProfile -File tests/fixtures/deep-audit-sidebar-layout-fix/run.ps1 -Run review-after-NEW -Phase after
node tests/fixtures/deep-audit-sidebar-layout-fix/scope-verify.cjs
```

before 的 Node exit 1 是保留期望几何红；需要读取失败名称，不能当成环境执行错误。after 应 exit 0。报告没有打开当前 GUI / 右栏文档预览，以遵守本任务不操作真实 GUI 的边界；仅文本与哈希验证。旧原始诊断报告 `round2-sidebar-layout.md` 和冻结链不变。最终仍需总审独立验收；**不宣称截图持久白栏已解决**。
