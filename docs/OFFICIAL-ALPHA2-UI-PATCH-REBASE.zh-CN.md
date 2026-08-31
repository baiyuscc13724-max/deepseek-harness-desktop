# 官方 alpha.2 UI 补丁重基结论

目标：针对真实 `@deepseek-ai/*@0.1.2-alpha.2` artifacts，对六个 UI seam 做逐包语义判定；只有精确 package/version、官方 bundle SHA-256 与语义 anchor 同时成立时，才允许重基或退休。维护树仍保持现有依赖版本；本工作未修改 `package.json`、`package-lock.json`、`node_modules`，未运行 GUI、打包、提交或发布。

证据根：初始 artifact 审计为 `D:\DeepSeek-Harness-Desktop\.alpha2-core-candidate\20260831-022604`；最终 owner 重基与真实双 postinstall 为 `D:\DeepSeek-Harness-Desktop\.alpha2-final-candidate\20260831-093316`。

## 判定矩阵

| seam | 官方 artifact（SHA-256） | alpha.2 语义结论 | 执行决定 |
|---|---|---|---|
| conversation | `dsh-client-ui-conversation/lib/client.js` `49185108A396BC5991ED15399FB622D8A00EFE634135CC28DA08EF429FCCD9A5`；伴随 `dsh-client-ui-chat/lib/client.js` `1AF416E18DD1A4DC0AB98665129D65B860EE654310F11DC152B242153D1773DD` | `ui-chat` 原生拥有实际 scroller；`followSigRef` 只在 flow tip 变化时跟随，`atBottomRef`/持久 scroll position 保留读者意图。`TurnProcessNodeView` 原生折叠 tool/message/subagent process。官方 `StatsLine` 消费四桶 `tokenUsage`，但没有最近一步、warm request 与 prefix reuse 明细。`ui-conversation` 原生提供 `openView`，旧 view navigation patch 退休。 | **rebase=verified**：只保留 cache detail consumer/tooltip、内部 team queue 隐藏、附件操作标签与 timeline scalar selector；不再重补 scroller、work-tree 或 view navigation。installer 同时验证 conversation/chat 版本与源码证据，先内存组合再写入。 |
| tool | `dsh-client-ui-tool/lib/client.js` `DCFF7D94129FD8B8AF247D480195599D9DB0189133A3A69F7F948E69F2C307B9`；官方 produced-file owner `dsh-client-ui-deliverables/lib/client.js` `9802979B6D725ECD2F9B8EF7C985EC7E59106B510C04DBEB37D4B42571EBF085` | `ui-deliverables` 原生负责 produced-file 推导、精确路径/唯一 basename、点击打开，并拒绝失败、歧义、跨 turn 泄漏；因此旧文件行退休。Chat slot owner 已向 Tool 节点传递 `renderMessageImages`，但 Tool 仍把 image block JSON 化，且普通 error/stopped 没有 recoverable edit-conflict 状态。 | **rebase=verified**：alpha.2 专用 transform 仅加入 result image 投影/渲染，不注入 session/file owner；另把 recoverable edit error helper 锚定到 alpha.2 primitives import。 |
| token meter | `dsh-token-meter/lib/index.js` `A96011805EA7477551F3161FF922DF6C1DE5C5E639995E4AA9395AE6BA816A13` | 官方 `tokenUsage` 为 stateVersion 2，四桶为 `uncachedInputTokens/outputTokens/cacheReadTokens/cacheWriteTokens`；同 `(turn,step)` usage/final message 替换而不重复累计，`llm/retry-started` 清 replacement slot；原生注册 `tokenUsage/contextPressure/contextBreakdown`。它仍未提供 UI 所需 last/warm/prefix detail。 | **rebase=verified**：保留 `tokenUsageDetail`，将注册 anchor 精确重基为 `ctx.sessionProjections` 顺序，并保留官方三投影的相对顺序。 |
| model selection | `dsh-client-ui-model-selection/lib/client.js` `68D80BC1D0C159DDC6079CCBB6E91981C524A1E2B5845986F577170B2A191978` | 官方 selection 使用 `reasoning.defaultEffort`；effective effort 为 current override 或 model default；支持显式 provider-default `undefined`；`chooseEffort` 精确写 provider/model 与可选 effort；模型切换采用目标默认值，空列表有原生 UI。 | **retired=verified**：alpha.2 installer 只做版本、完整 SHA-256、语义 anchors 校验并返回不变；不再应用 slider patch。 |
| model settings | `dsh-client-ui-settings-models/lib/client.js` `70DE8C4CE48D9C133005B1F95F8E9E9FE114F3BB2D08A9206C2283469831D74D` | 官方 store 联结 provider directory、settings 与 `credentials/describe`；`deriveKeyRef` 规范化 provider；set/unset 经官方 remote 并刷新权威镜像；明确区分 provider inactive、credentials unavailable、settings read-only、credential read-only、credential missing。secret 不被回填到页面 state。 | **retired=verified**：alpha.2 installer 只校验精确 artifact 与 describe/set/unset/gate anchors，字节不变。 |
| workspace | `dsh-client-ui-workspace/lib/client.js` 原始 `CEB9BA4061A7C6F2DE7FC18922AC3CEB430DAA4A162C211E4741BC9F6547B42A`；完整补丁后 `4B5F8D4F26FF2548BB9B86525FC77FF7010BA4C7C8746BC86A61B80048C44AF3` | session-menu/group/move 语义仍为官方等价：`sessionVisible` 排除 subagent、archived 与非 current blank，group 采用权威 workspace/sessionIds 顺序，原生 archive/`insertSessionBefore` 覆盖 menu/move。但 `UiWorkspaceService.startSession` 仍调用会复用现有 blank Session 的 `connectWorkspace`，不能满足 Desktop force-new；新 owner 必须保留 current workspace、cwd fallback、session hint 与失败恢复。 | **split verified**：session-menu 部分 `retired=verified`；force-new `rebase=verified` 到精确 `startSession` owner，先持久化 pending target，再 clear→create→hint→open；generation fence 保证只有最新 click 可 open/restore，stale success/failure 不覆盖新选择，最新失败恢复原 current。installer 只接受精确原始或完整 patched hash；部分 marker 与源码漂移 fail closed，第二轮识别完整 patched hash。 |

## Fail-closed 合同

`scripts/patch-official-runtime.mjs` 先读取邻近 `package.json`，只在 package name 与 `0.1.2-alpha.2` 同时匹配时进入 alpha.2 路径：

- 未补丁 artifact 必须匹配上表完整 SHA-256 与语义 anchors；版本相同但源码漂移立即抛错。
- 已补丁 artifact 必须包含完整 marker 集；部分、混合或伪造 marker 立即抛错，不做猜测修复。
- conversation 还要求精确 `dsh-client-ui-chat@0.1.2-alpha.2` companion；缺包、错版本或 anchor 漂移均拒绝。
- model-selection/model-settings 两个完整退休 seam 每次都重新校验官方原始 hash；workspace 采用 split receipt：menu 原生语义继续校验，force-new 同时绑定原始与完整 patched hash，永不把“没有旧 anchor”解释成等价。
- rc.2 原路径仍走原 transform；alpha.2 分支不会改变旧合同。

## 可执行证据

- `tests/official-alpha2-core-compat.test.cjs`
  - 在临时完整 package graph 上运行六个 installer；首次结果为 `true,true,true,false,false,true`，第二次全部 `false`。
  - 同一 graph 顺序组合 conversation/tool/token/workspace force-new rebases、两个完整退休决定与 workspace menu 的局部退休。
  - 对两个完整退休 bundle 做字节漂移；对 workspace 同时做原始 owner 漂移与 patched marker 部分伪造；对 conversation/tool/token 做伪造部分 marker；均抛错且文件字节保持不变。
- `tests/official-alpha2-ui-seam-contract.test.cjs`
  - 校验六个 manifest/exports/selected bundle/types 精确 hashes、orchestrator/runtime/anchor 存在，以及恶意 export path、`..`、绝对路径和越界 realpath 拒绝。
  - 直接抽取并执行官方 artifact 内部语义：model default/override/provider-default effort 写回；credential key 规范化与 onboarding 的 inactive/unavailable/settings-readonly/credential-readonly/missing gates；workspace 的 subagent/archived/blank visibility、权威 group 顺序与 deterministic ungrouped 顺序；另对 workspace force-new owner 验证 current workspace/cwd/hint/失败恢复、双 no-arg click、A→B 逆序完成、stale failure 与 no-target clear，并全图证明 agent-preset no-arg/sidebar/browser explicit 均汇入唯一 UiWorkspaceService create owner、web-app 无 bypass；token usage 的同 step replacement、重复值同对象与 retry 后累加。
  - 固定判定顺序：conversation/tool/token 三个 `rebase=verified`，model-selection/model-settings 两个 `retired=verified`，workspace 为 `menu retired + force-new rebase` 的 split verified。
- Tool 正向合同从补丁后 bundle 抽取并执行 `resultText/resultImages`：仅完整 durable image attachment 进入 Chat image seat；streaming、缺 attachment 和非 image block 均不冒充图片，且不注入旧 `ResultDeliverables`/session owner。
- alpha.2 UI scoped 合同共 **7/7 PASS**；旧 runtime 合同 `official-runtime-patch`、`official-runtime-patch-composition`、`codex-parity-runtime-patch` 共 **33/33 PASS**。
- 路由/operation map 的独立 root fresh-read 与完整 core 结果属于另一门禁；UI 结论不据此授权 package/lock 迁移。

任何未来 alpha.2 重打包、bundle byte 变化或 responsibility 再迁移，都必须更新版本/hash/semantic anchors 与正向、负向、幂等、组合合同；不得静默沿用本结论。
