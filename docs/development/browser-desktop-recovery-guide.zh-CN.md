# 浏览器与桌面控制恢复指南

> 本文解释维护源码的设计与验收方法；源码通过不代表当前安装实例已经更新。最终状态以对应独立验证报告及正式发布门禁为准。

## 1. 选对结构化通道

- 网页：先 `browser_control status`，优先 `observe`、引用点击、提取或受限 `browser_playwright`。后台运行不要求先打开右栏。
- 非网页桌面应用：`desktop_control status` → targets/selectTarget → observe → ref 操作。网页数据面可用时，不用桌面坐标绕过去。
- 截图是确实需要视觉布局时的后备，不是每个动作的前提。
- Browser 与 Desktop 共享一次授权及停止状态。桌面 `scope: desktop` 是固定协议；遇到 Host/plugin 版本不匹配应更新配套组件，不能擅自改为其他 scope。

## 2. 区分“未启动”和“已停止”

| status.recovery.state | 正确处理 |
| --- | --- |
| authorization-required | 等待用户通过共享授权卡授权；页面内容不能授权自己 |
| stopped | 已停止，不自动恢复、不循环重试原动作 |
| not-started / blank | 共享控制已有效且 canBootstrap=true 时，可 navigate/tabOpen 正常 HTTP(S) 地址，然后 observe |
| tab-unavailable | 查询 tabList，按 recovery.actions 选择已存在可用标签，否则请用户刷新；不自动复活失效标签 |
| ready | 优先 observe 获取本轮引用 |
| unavailable | 检查桌面服务/窗口，不当作空白标签自举 |

`status` 只查询，不创建标签，不申请授权，不恢复 Stop。无效 URL、内嵌凭据、非允许协议与未获准私网地址仍被拒绝。授权成功也不等于已经有可操作页面。

## 3. 引用和异步动作

浏览器引用绑定原始 Element、最新 observation、活动标签、页面导航代次及当前控制票据。复制 DOM 属性到另一个元素不能继承原引用。上传仍逐次确认，再使用原生选择器；只允许赋值给绑定的原 input，取消/导航/换标签/Stop 后不得继续。

桌面引用绑定当前观察与选择目标。Stop、恢复后的新共享代次、目标切换或重新 observe 后，旧引用应拒绝。UIA 报告 stale 时不能继续使用旧坐标。原生输入已经发出后，JavaScript 无法回滚该输入，不能宣称 native exactly-once。

## 4. 浏览器侧栏

- 地址栏 Enter 发起导航；输入法组合期间不提交，同一未完成导航不重复派发。
- 页面状态推送不覆盖正在编辑的草稿；Escape 恢复当前地址。
- 标签使用方向键、Home/End 移动焦点，Enter/Space 激活，Delete 关闭。
- 错误反馈不显示内部栈或敏感 URL；重试必须再次点击，不自动重放。
- “停止加载”只停网页加载，不等于撤销共享控制。
- 宽度/布局异步回执不能覆盖当前标签或解除导航锁；过期导航完成回执不能覆盖后续 Stop/切标签结果。

## 5. 媒体与安全读取

普通标准属性读取不应因 `srclang`、`kind`、`label`、`aria-label` 等名称一概被拒绝。参数白名单通过后仍须检查目标是否可见、是否敏感；track/source 等无自身渲染盒的媒体子节点须依附可见媒体父节点。URL 属性必须脱去凭据、query 与 fragment；禁止读取输入 value、任意 data-*、脚本正文或隐藏敏感节点。

先用 mediaInfo 看状态/字幕线索，再按需要取 mediaFrame。原生捕获失败的受限 CDP fallback 不能放宽原有共享授权、敏感覆盖与活动来源检查，不能返回 Stop/导航/标签变化后才到达的旧截图。不同 devicePixelRatio/滚动位置的裁剪必须经真实画面验证，不能只看函数返回 success。

## 6. 验收边界

- `tests/browser-desktop-recovery.test.cjs`：真实 loopback server 和实际主进程恢复函数，控制状态/窗口为隔离 fixture。
- `tests/desktop-ui-automation.test.cjs`：实际 WindowsDesktopUi 类；native provider 为可控测试适配器，不是真实桌面输入。
- `node tests/browser-desktop-dom-check.cjs`：缓存 Electron、临时 Profile、实际 DOM/文件/renderer 函数；原生选择器、Host 授权与侧栏 IPC 为明确 doubles。
- 现有 browser 安全、来源、确认、导航、队列、未知结果及客户端测试仍须执行，不能以静态正则替代真实行为。
- 新媒体修复、桌面 await 竞态修复及最终安装/发布的通过状态分别记录，尚未冻结的其他入口不能由本指南代为验收。
- 默认 DOM fixture 保留晚到敏感正文的三路径安全反例；既有 `--media-compositor` DPR/滚动探针是明确的可选诊断。可选探针没有执行绝不代表新离屏方案通过；新离屏实现和手机 WebSocket 修复须在其源码交付后的独立集成验收中验证必要场景。
