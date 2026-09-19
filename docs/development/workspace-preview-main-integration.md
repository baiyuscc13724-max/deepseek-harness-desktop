# 原生工作区预览模型入口：主进程接线

## 范围与边界

本实现只补正常工作区成果的模型可用只读观察入口。没有改浏览器媒体 capture、离屏渲染、浏览器 SSRF 白名单、桌面输入授权或用户设置。没有新截图库、窗口重挂接、依赖安装或发布。调用入口不等于视觉质量批准。

模型只传 `workspace_preview({path})`。desktop-files 从真实 exec.agent/registry 派生来源，参数中的任意 session/cwd/URL/selector/rect 都会被拒绝。Host 文件 API 重用既有来源、ownership、canonical cwd、realpath 包含性和类型/大小验证。没有绝对文件或未知来源回退。

## 通道

- 独立已认证 loopback `POST /action`，`scope:workspace, action:preview`。
- payload 仅 `{path, sourceSessionId}`；sourceSessionId 来自工具执行上下文，不是模型参数。
- 保留原 Bearer、固定回环 origin、body 上限、disconnect signal、未知 scope/action 拒绝。
- workspace 独立串行 lane；包括排队在内最多30秒。主进程桥内部最多25秒，工具传输35秒/工具50秒。有取消和迟到回执清理；只读图像不进入变更 replay cache，不重放旧图。
- 主进程从 `desktopModelToolAction` 的 workspace 分支直接进入 WorkspacePreviewBridge，在 `syncComputerUseIndicator`/任何浏览器输入授权前分流。
- 主进程重复 `previewRightWorkspaceTarget` 的来源文件读取，并把经验证 file 描述送到固定 shell，不接受 renderer 自报 sourceBound 作为授权。

固定 IPC：

1. `rightWorkspace:modelPreview`：Host nonce + 来源/path + 已验证 file。
2. renderer 使用现有 beginDocumentRequest/renderDocument，等待实际可见状态/内容加载，再提交 `rightWorkspace:modelPreviewReceipt`。
3. main 的原 shell sender 检查，以及 bridge 的 mainFrame/sender/nonce/source/path 检查。
4. capture 前后以固定只读 `observeModelPreview(HostNonce)` 再取当前 request revision、DOM 状态、有限文本和几何；不是执行模型脚本。
5. `rightWorkspace:modelPreviewCancel` 清理当前nonce；错nonce不能清掉新请求。窗口销毁、请求断开、超时清掉待处理状态和事件监听。

## 可见性、图片与裁剪

只有当前文档 request revision、来源、path、nonce 匹配，document pane 活动且在 viewport 中实际可见，内容加载完成才 rendered。不是 `openLocalDocument()` 返回 true 就成功。关闭、模式切换、来源/context 意图改变会使旧请求 superseded。

图片使用 **shell webContents.capturePage 的 document pane crop**，不是全聊天窗或桌面。矩形由固定文档 DOM 派生，裁到 document/host/viewport 交集；CSS像素乘 Electron webContents zoom 得到 DIP，起点 ceil/终点 floor 向文档内部取整，不把 DPR 当 zoom。visualViewport pinch/offset、不一致尺寸、零面积/越界矩形均拒绝。Native browser overlay 状态须不覆盖文档；DOM命中、可见祖先、完全不透明文档底色也检查，不能透出下方聊天。透明/渐隐等不可证明的组合直接降级，不修改主题或要求额外权限。

截图前后比较 fresh nonce/source/path/revision、文档rect、viewport/dpr、zoom、window content bounds/size和窗口移动/resize/zoom事件代际。之后重读来源文件、比对载入描述摘要并最终重验geometry；任一变化丢弃旧观察/图像。实际像素 PNG 最大4MiB，宽度不超过1600；后端标准附件仍执行自身限制。

工具侧检测当前模型 image 输入能力，经实际 attachments.saveImage 持久化并输出 `{type:'image',attachment}`。文本输出剥除 base64。图像能力/截图/附件不可用时必须带 imageUnavailable/reason，不能说视觉验证已通过。纯 DOM/iframe load 或可见几何不能证明 HTML 内部排版正常；当前 Markdown 仍是文本源码预览，不宣称 rich Markdown。

状态：rendered（真实可见观察）、failed（明确拒绝/失败）、not-visible（不可安全观察）、superseded（旧意图失效）、unconfirmed（超时/断连未确认）。queued 不表示已观察；桥忙时并没有入队，故返回 failed/BUSY 而不伪称 queued。非 rendered 不返回旧文本或图。

## 隔离真实 Electron 证据

使用自建 fixture-workspace 中文、空格、字面 `%20#` Markdown，无用户作品/其它会话。真实执行链：

`真实 ToolRuntime.register/严格schema → tool execute → 实际Bearer loopback Server → 从当前main.cjs抽取的生产分流/来源/IPC函数 → 生产preload → 生产right-workspace renderer/CSS → capturePage → 实际attachment-local saveImageFile/readImageFile → 标准tool image消费`。

显式测试替身只有：自有 source registry/模型image路由、绑定自有文件路由的 runtimeApiFetch 适配器、无浏览器view的控制stub。没有启动第二个产品服务器或安装运行时。测试用独立短生命周期 Electron 窗口和profile；不是运行中的已安装 GUI 验证。

两侧红/绿测试分别代表禁止截入的聊天区域和预览区。默认设备比例及强制 device scale 2，zoom=1、1.25、0.8 共六组实际PNG均为**0个红色像素**；绿色预览区均超过1000像素。device scale 2 实测：

|zoom|DOM viewport|devicePixelRatio|native content DIP|返回PNG|
|---|---|---|---|---|
|1|1100×678|2|1100×678|1078×1142|
|1.25|880×542|2.5|1100×678|1600×836|
|0.8|1375×847|1.60000002|1100×678|1022×1182|

已真正 read_image 检视放大组：只有自建文档及其系统打开按钮，文字完整，未包含聊天/其它会话。绿色仅fixture用于像素判定，未修改产品样式。

实际 capture await 期间注入 zoom变化、resize、模式切换：三组均不返回 rendered/attachment。隐藏窗口返回not-visible；capture抛错时保留有界结构观察和imageUnavailable，无图；未知来源返回FILES_SESSION_NOT_LIVE，无图；错nonce回执不接受；未认证HTTP401，未知workspace动作HTTP400。

源码syntax检查及原browser-control-server/preload回归通过。旧right-workspace-ui的两项静态断言仍期待此前已移除的 `loadDocumentPreview(target` 和 `openLocalTarget(file.destination`，已交测试所有者更新，未恢复不安全写法。最终独立全量QA另行结算。

## 未验证/不宣称

- 未部署到已安装GUI，不等于用户现在已能调用新工具；不宣称热更新。
- 没有新建离屏能力；隐藏/不可观察情况准确报告。
- HTML/video/PDF专用内部呈现质量不在上述Markdown实测的证明范围；沿用现有预览类型和受限HTML沙箱，不把load事件当质量批准。
- 本文和fixture结果是实现证据，仍须根接受39d、72bf及独立QA，不自授验收。
