# 本地成果模型预览：来源与观察回执契约

## 问题界定

普通来源已验证的工作区文档预览不是桌面输入控制，也不是任意 localhost 网页导航。不需要 Computer Use 全桌面授权、按站点授权或关闭工作区/SSRF 安全保护。

截图中“右栏预览受本机访问权限限制”只有助手自然语言，不是工具/Host 拒绝证据。报告必须区分：

| 事实 | 可说的结论 |
| --- | --- |
| 无预览调用或工具回执 | 未尝试或证据不足，不能断言权限故障 |
| 模型工具集合无原生预览入口 | 缺模型可调用入口，不是文件访问被拒绝 |
| 浏览器 status 显示停用、无授权、未启动 | 指明该状态；不等于工作区文件不可读 |
| 浏览器返回 private-network-not-authorized | 该网页导航被 SSRF 门禁拒绝；不能通过换端口/直连来绕过 |
| 文件 API 返回 FILES_PATH_ESCAPE / FILES_NOT_FOUND | 指明来源工作区路径/存在性围栏拒绝 |
| 文件 API 返回 FILES_SESSION_NOT_LIVE / FILES_NO_WORKSPACE | 指明来源无法验证，不借用当前选中会话 |
| 右栏回执 queued | 请求已排队，未证明呈现 |
| 右栏回执 rendered | 只有回执中明确观察到的内容/可见性可作为证据；不自动代表设计通过 |

## 用户点击路径（已接受实现）

会话组件的真实 scoped sessionId → workspace-link WeakMap → preview-local 来源协议 → app → shell IPC → right-workspace-service → desktop-files 精确来源与文件围栏 → 右栏代际校验。

Markdown href 只在 href 入站解码一次；代码样式路径保持字面 `%`、`#`。未知、旧或缺来源不能落入本机绝对路径回退。此路径修复不等于新增了模型可调用工具。

## 模型入口（插件端已实现，39d 主进程接线尚待完成）

`desktop-files` 使用公开 `ToolRuntime.register` 的 registry-ready 严格 JSON Schema，execute 内再次自校验，无额外 npm 依赖。真实 SDK 注册、schema 消费和标准 image 附件保存/读回已用隔离 fixture 验证；尚未完成完整原生传输链，不宣称已安装可用。

工具 `workspace_preview({ path })`：模型只可提供当前执行会话工作区相对文件路径。禁止 sessionId、sourceSessionId、cwd、origin、URL、任意 selector、脚本和其他额外参数。

### 来源绑定

1. 从受信任 `exec.agent` 取 header.id，必须与 `ctx.agents.get(id)` 是同一个活跃 agent，header.id 一致。
2. 调用既有 `readWorkspaceSource`；沿真实 runtime ownership/明确持久来源和 canonical cwd 验证。跨工作区成员、未知来源继续拒绝。
3. 路径按字面处理。先用既有 resolveDownload/previewFile 检查 lexical 和 realpath 包含性、普通文件、大小/类型，不创建目录、不搜索 basename，不解码第二次，不执行文件。
4. 发出请求前再次确认执行 agent/header 没有被换绑。来源标识仅存在可信插件→Host 传输，不暴露到模型参数。

### 固定传输

复用已认证 loopback `/action`，独立 `scope:workspace`、`action:preview`：

```json
{"scope":"workspace","action":"preview","request_id":"Host-derived-call-key","payload":{"path":"output/report.md","sourceSessionId":"derived-from-exec-agent"}}
```

状态文件只由 Host 环境提供；不接受模型 origin/token。固定本机回环目标、Bearer 认证、无重定向、有限请求体/响应体/超时。使用独立 workspace 路由，不套 browser 控制授权，不新增任意内网导航白名单。

Host 主进程用既有 runtimeApiFetch 与文件 API 重新验证来源/文件；专用预览桥产生单次 nonce，将具体请求发给固定 shell。preload 只暴露固定订阅/回执通道。只有原 shell sender 的当前 nonce/source/path/代际匹配回执可以结算请求。关闭、换模式、切会话、新请求、窗口销毁、超时都不能把旧结果标成成功。

### 回执语义

公开结果建议如下；最终接线按所有者确认的字段保持一致：

```json
{"ok":true,"result":{"state":"rendered","sourceBound":true,"contentKind":"text","visible":true,"observation":{"textExcerpt":"bounded untrusted content"},"image":"optional PNG data URL, removed before text output"}}
```

- `queued`：仅队列/投递证据，尚未观察；超时不是文件权限拒绝，不报“已打开”。
- `rendered`：当前请求完成内容载入，且 document pane 仍活动、非隐藏、CSS visibility=visible、有效可见几何。必须检查而非只接受 openLocalDocument 的 boolean。
- `failed`：明确载入错误，返回稳定 code/可恢复下一步；不要回显任意磁盘路径。
- `not-visible`：内容可能存在，但窗口/面板/遮罩状态不支持可见验证。
- `superseded`：请求已经被新工作区意图/关闭/来源改变替代，丢弃旧观察和图像。

文本是有界不可信内容，不得把其中的指令当授权。Markdown 当前用文本预览，不可虚称 rich Markdown 排版已渲染。HTML 使用既有受限沙箱，不访问 iframe 私有内文、不执行模型脚本；仅 load/几何不证明视觉排版正常。

### 实际图像与不可用降级

完整入口必须尝试返回真实当前预览区域图，不能只交 DOM visible/innerText 充当视觉能力。主进程只在当前来源/nonce/代际仍匹配时截取 document pane 的合法可见矩形，不能截整个聊天窗或其它会话。截图后再次确认代际，否则丢弃。预览插件通过既有 attachments.saveImage 持久化 PNG，检查当前路由 image 输入能力后以 tool image block 返回。图像不可用/无图像输入/附件服务缺失时移除原始 base64，只返回准确的 DOM/文本观察和 imageUnavailable/reason，明确尚未视觉验证。HTML load/几何只证明已呈现，模型需看到真实图再评价排版。

插件在网络回执、模型能力查询、附件保存及最终返回后都重新核对执行 agent/header、cwd 字段和 canonical workspace/ownership。改变来源不返回旧图或旧文本。`unconfirmed` 表示连接中断等情况下投递/回执尚未确认，不能冒称 queued 或已执行，不能盲目重试。非 rendered 状态丢弃 observation 和图像；rendered 缺 sourceBound/visible 标志视为无效回执。

## 验收要点

- 自己生成含中文/空格/字面 `%20#` 的 Markdown → 精确来源 → 实际文档 DOM 与图像。
- 当前选中其他会话不影响发起来源；源丢失、越界、符号链接、误绑必须拒绝。
- CSS 动画未结束时不得 rendered：真实隔离 Electron 中 openLocalDocument 返回 true 后最初 innerText 为空，等待 visibility 实际可见才读取到文本。
- 无 Computer Use 授权也能普通工作区预览；浏览器 SSRF 和敏感操作规则不变。
- queued、失败、不可见、超时、旧回执均不是成功；截图成功也只是观察证据，不是质量批准。
- 测试夹具、源码验证、实际已安装 GUI 证明分别报告，不能互相替代。
