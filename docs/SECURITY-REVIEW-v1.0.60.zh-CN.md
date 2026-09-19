# Harness Desktop v1.0.60 安全审查

审查日期：2026-09-05。

审查对象：维护 checkout 中的 `1.0.60` 候选改动，包括 Agent Teams 专业技能/交付/通信与界面、浏览器/桌面控制、来源绑定预览、图片缓存/取消及消息准备队列、版本元数据与发布边界。

## 审查结论与证据状态

**当前为未完成的审查稿，结论：不可据此发布。** 源码仍有并行修改，独立浏览器/桌面及总体验收报告尚未交付，以下待验项未被标为通过。本文件存在不等于安全门已通过，也不能替代负责人接受、精确候选源码复核、最终动态回归或唯一 resumable publisher 的远端证据。

控制原成员因内部不可重试错误被正式替换。新成员按新 claim/lease 重新复核、测试和提交，旧恢复说明只是未经验证的历史上下文。原 main 与总控制已被负责人依序接受；预览 main 已显式提交等待审阅。接受实现交付不等于最终发布许可。

审查独立性：浏览器/桌面原实现来自前任控制成员，替换成员核对并补实际函数/DOM 验证；预览 main 接线由本审查者编写。这两部分均标为**作者/接续作者自审**，不能冒充独立安全认证。Team、预览服务/来源注册、图片与队列等其他成员实现为本审查者独立静态阅读；最终独立动态证据由测试成员提供。

## 1. 威胁模型与不变信任边界

本次防范重点：

- 将职责名、技能名称绑定、历史加载文本或模型伪造工具结果当作真实技能加载；把产物摘要或 checkpoint 当作完成/质量通过。
- 对提交/复核的异步文件读取期间发生 Stop、工作区/存活 agent 身份漂移，仍提交旧来源证据；旧 submission/claim/lease/OCC 重放。
- 饱和通信重复 dispatch，或者跨团队/停止成员通信通过普通聊天恢复运行。
- 浏览器合法 desktop scope 被枚举遗漏误拒；为了消除错误而放宽任意 scope、共享授权、Stop 或固定动作边界。
- DOM ref 被复制属性的替身劫持；文件选择期间发生导航/Stop/替换后把用户文件交给未确认控件。
- 文件链接缺来源或来源过期时回退当前会话、默认工作区或任意本机绝对路径；预览与系统打开读取不同来源。
- 图片并发/超时留下无限载入，缓存跨会话串用、过早销毁仍被使用的 object URL；附件准备失败/取消后丢草稿或重复发送。
- 把本地隔离 fixture、作者报告、已生成文件、版本号替换误当作正式云构建/签名/镜像/stable feed 成功。

信任根仍是 Host 的精确身份/工作区与授权代际、正式注册工具结果、durable claim-bound 生命周期、固定 loopback/URL 与文件 containment 政策、官方依赖与精确补丁输入、唯一发布器的签名和远端状态。网页、DOM 内容、模型声明、缓存、UI 标签或报告文字不能提升权限。

## 2. Agent Teams 专业技能、真实交付与通信

已阅读新增 `professional-capabilities.js`、`team-deliverables.js`，并定向阅读 `index.js` 的技能 observer、claim/submit/accept 与 relay 接线；客户端投影改动和其他域仍需在最终候选冻结后复核完整 diff。

- required skills 使用有限 exact kebab-case 名称，绑定/可用/真实加载分开。成功证据要求正式 Host skill 工具对象一致、真实 registry 定义内容/provider/resourceBase 一致、当前成员任务 in_progress、未取消；持久数据只存加载时间、来源标签、正文哈希及 claim/lease，不存技能正文或 resourceBase。
- 技能加载不等于专业资质或质量通过。缺技能可见，旧 claim 的加载记录不显示为当前 loaded。
- 交付有正文或实际文件字节快照；文件路径必须 workspace-relative，拒 traversal、绝对路径、保留/内部目录。文件大小、总量、symlink/junction、realpath/handle 元数据与接受时哈希重验构成有限证据；不是对任意敌对文件系统的原子完整性证明。
- submitted 仍不解锁依赖；accept 要求独立负责人、精确 submission_id、验收标准覆盖与文件未变。纯模型验收说明仍为 `lead_reviewed`，不是可信 runner 的质量证明。
- 新通信路径只对已运行、同 root 精确 parent、拥有活动 activation/run 的成员 steer；队列回执只报 queued，不伪造 deliveredAt。Stop、跨域和旧生命周期门不可因 capacity 饱和而绕过。

### 2.1 R1：交付异步期间的工作区/存活身份漂移（限定风险已独立复验关闭）

初始静态观察：`updateTask` 的 claim 在 `resolveSkillBindings` await 后、complete 在 `bindTaskDelivery` await 后、accept 在 `reviewTaskDelivery` await 后虽重验 active/lease，但未再次验证工作区或固定 live-agent 身份。store mutate 锁能串行化任务状态，不锁住调用者/root header.cwd 或 agent registry 身份。最初作为待核验风险上报，没有提前宣称已利用。

负责人随后反馈作者已在三条实际路径复现并修复，根已接受实现返工；独立测试任务重新解锁。本审查者 fresh 阅读了新增 `captureTaskDeliveryScope` / `assertTaskDeliveryScope` 与三条调用路径：异步前保存 exact caller/root 对象和 ID、工作区与 projectKey；异步后拒 registry 对象替换、root 不再为 root、projectKey 或 cwd 漂移，错误为 `AGENT_TEAMS_TASK_SCOPE_CHANGED`，继续保留 active/lease 门。

已 fresh 阅读独立测试 `output/team-product-validation.md` 第 7 节，并亲自计算五个源码/测试文件 SHA-256 与其证据表逐项一致。公开 claim 的真实 SkillRegistry snapshot、submit/accept 的实际 fs.open 完成后等待点，12 个漂移标签全部拒绝 `AGENT_TEAMS_TASK_SCOPE_CHANGED`，3 个正常对照成功；因 accept 的 caller/root 相同，实际是 10 个不同组合，不虚报 12 种攻击。拒绝后实际 hot document 完整 task、独立 reader task、原 JSON 逐字节、new Store coldTask 均不变。

独立广泛回归为 **574 项 / 572 pass / 0 fail / 2 既有环境 skip**，真实 React/Chromium DOM **6 组通过**。这里引用测试成员执行结果，不冒称本审查者重跑。根已正式接受本轮独立任务；R1 在该输入和所测身份漂移范围内关闭。**不宣称解决 ABA、冻结整个等待期 registry，或证明敌对文件系统不可变；未开启 P1 发布矩阵/artifact 安装 smoke 两项不计通过。**

当前核验绑定：`index.js` = `405467D7C10A391F41D73D20C080CFBE79A5E8A5D9DCCCF19EDCBFC942D84264`；`professional-capabilities.js` = `EEF92EA12273DD8895449A67F08E82E42B42AA60342A9E69F1B122B3436CEA1A`；`team-deliverables.js` = `E2F1CADDC79F36A39F3314B8A6E013E51BE9D6309F94B56D928C3818488CF5A7`；`client.js` = `002F8F37F310981EC08A34935F553F3FB4915F8ADCF376876FA1BF83BA9BD90B`；独立测试文件 = `211CC4ED480199B6359963FCE9FF904B7F54D121A9FB8D2DDC062A70A5479EFE`。后续修改任一绑定文件需要重新复核证据适用性。

## 3. 浏览器/桌面控制（接续作者自审）

- desktop 插件原本发送已实现的 `desktop` scope，main 已有 WindowsDesktopUi 路由；server 漏枚举为根因。修复导入真实固定桌面动作集合，保留类型/未知 scope-action 拒绝、Bearer、loopback、服务器/Stop 代际；不 alias 成 computer。
- WindowsDesktopUi inspect/perform 增加真实 provider 授权，跨 await 重验共享代际；Stop 清 ref，UIA stale 不退回旧坐标。原生调用已发出后不能由 JS 回滚，不宣称 native exactly-once。
- status 只读区分未授权、已停止、未启动、blank、失效、ready；仅明确 navigate/tabOpen 可在 active 授权下 bootstrap，状态读取不偷偷启动，不把 Stop 解释成冷启动。原 URL/私网与关键确认门不变。
- ref 绑定最新 observation、tab/view、导航和控制代际，isolated world 1005 Map 保留原 Element；复制 DOM attribute 不能替代原对象。
- 根审查曾发现上传 metadata 校验原对象后又通过多次 CDP await 重选属性取得 backendNodeId 的竞态。返工已删重选链；经人工确认/文件选择、限额/文件检查和 transfer lock 后，在同一个同步隔离世界闭包校验原 Map Element并赋 FileList。不会通过属性找替身，也不禁用 upload。

亲跑 evidence：实际抽取 main 函数在 Electron 43.2.0 / Chromium 150.0.7871.129 隔离 DOM 的 9 场景通过；picker/stat/read/最终 dispatch await 插入同属性替身均 stale、files 空且无 change；正例字节和原目标事件、Stop/cancel/未确认不开 picker/旧 observation 均通过。Host 授权/确认/picker 是明确替身，DOM/FileList/文件读取是真实行为，不是当前 GUI 验证。

另实际 server HTTP + WindowsDesktopUi 类临时 fixture 10 场景通过；真实 loopback，原生 provider 是替身。现有 6 套测试亲跑为 68/69，唯一失败是旧 parity 要求 `DOM.resolveNode` 的源码断言；已交独立测试更新，未恢复危险链或掩盖失败。详见 `docs/development/browser-main-integration.md` 与工作区 `output/browser-control-implementation.md`。

## 4. 文件预览与系统打开（main 作者自审；服务独立静态阅读）

- main workspace-link 对象固定 `{target, sessionId, sourceKind:'workspace-link'}`，未知/缺失来源、控制字符与冲突 target/path 拒绝。异步前复制并 freeze 原始字段；不 URL-decode 字面文件名、不借用当前会话。
- preview/open 都走同一 right-workspace service 固定端点与 session/path；服务复制来源参数，拒返回会话不匹配，媒体 URL 绑定原来源。runtime desktop-files 按精确 live/cold 只读来源、父子 lineage、canonical workspace 与 containment 读取，不借其他项目。冷来源只读 observation 不启动 agent。
- renderer 来源 WeakMap 由有 session 绑定的产品代码注册，非从 authored data 属性或当前 selection 猜来源；guest contextmenu recent 必须与当前 point 的目标相符，非未来且未过期。main 菜单只保存该事件快照，绝对 href/src 也不能绕过 provenance。
- legacy file-list 保留 snapshot 的 sessionId/path/name；无来源字段的明确本机 preview 保留独立入口，不让失败 workspace-link 降级进去。
- 系统打开仍 materialize 私有安全副本并应用原可执行文件 reveal 门。亲测发现 `%20` 被本机打开器再解码，main 已以 file URL 传 literal destination，并验证再解析后必须等于原目标。类似行号后缀被旧 normalizer 重解释的名称明确 fail closed，不打开相邻文件。

亲跑 11 场景 main+真实 service+真实注册 desktop-files HTTP handlers+双临时工作区/文件全部通过；预览/系统应用 handoff 内容均源 A，源 B 同名内容不泄漏，await 修改参数不换源，缺来源/未知 session/跨工作区及旧/未来/point 不匹配 snapshot 拒绝，中文/空格/#/%20/+ 名字保持，legacy 兼容。shell 启动/Host registry/menu/context DOM 是替身；不冒称当前原生应用 UI 已验证。

现有 service/desktop-files/context 三套亲跑 22/24；两项失败要求旧菜单本机旁路/旧绝对路径无来源行为，已交独立测试升级。详见 `docs/development/content-preview-main-integration.md`。

## 5. 图片与消息队列

已静态阅读两个新增 performance patch 及 official patch 接线：

- 图片读取排队有并发/队列/时间上限。底层 Remote 无取消参数时，消费者超时不能释放仍在读取的 carrier 槽，否则重试将产生无界 orphan；补丁保留槽直到 carrier 真正 settle。
- object URL 解码支持取消，一次 entry 解码共享；可视区按需读取、错误可见重试，消费者代际与释放应防止 stale URL 展示或过早 revoke。最终仍需真实正反例验证 reference count/逐出/切会话/取消。
- FileReader 30 秒有界并接 signal；附件最多两条并行 lane 保序，失败 abort 同批其他 lane。隐藏窗口的 submission settlement 使用 rAF/时间回退且一次性 latch，不能靠后台 rAF 永久等待。
- 阶段 UI 显示读取/上传验证/accepted 同步/queued，不把 preparing 当成服务端 admitted。没有凭进度标签自动重发 prompt。
- 编码字节/并发限制不等于解码后像素内存的全局硬上限；压力、巨大图片和不响应底层 carrier 情况需最终测试给出实测限制，不推导无界安全保证。
- 补丁匹配 exact anchor、拒 partial/repeated/漂移；最终必须以固定官方输入执行两次幂等验证。未以阅读 patch 文本代替实际部署或完整消息不丢不重发证明。

## 6. 版本元数据与发布边界

已核 package/lock 从 1.0.59 同步到 1.0.60；Android code 1006000、iOS build 10060，移动服务/示例 URL 和插件版本按相同产品版推进。此项是身份一致化，不是正式资产已存在。签名 secret workflow 只改目标验证分支，未扩大 workflow 权限。

本审查者不执行 commit/push、发布器、签名、上传或部署。唯一正式路径仍为仓库 `npm run release:publish -- run --version <package.json version>`，先 clean committed source/本地门禁，再精确不可变 tag 云构建、签名组件、18 资产、GitHub→CNB 云到云镜像与 stable feeds 最后提升。不得修改 publisher 风险门来消除待验项，也不得让本文件的建立制造“安全通过”。

## 7. 独立证据清单与发布阻断

| 项目 | 当前实际证据 | 状态/限制 |
| --- | --- | --- |
| Team 新专业契约与 UI | 已读 `output/team-product-validation.md` 第 7 节：最新 574 项 / 572 pass / 0 fail / 2 既有环境 skip，真实 DOM 6 组；五个 source/test hash 亲核一致 | 独立返工已正式接受，仅限该证据输入；历史失败调查保留，两项未开启发布检查不算通过 |
| Browser/desktop 独立最终验证 | `output/browser-desktop-validation.md` 尚未生成（本次 glob 只返回 Team 报告） | 待交付；作者 9/10 fixtures 不替代 |
| 图片/队列/来源/总体验收 | `output/final-product-validation.md` 尚未生成 | 待交付；24 测试中旧断言失败待独立收敛 |
| R1 异步交付来源漂移 | 独立公开工具 12 标签（实际 10 组合）拒绝、3 正常对照；hotTask/reader/原 JSON 字节/coldTask 不变，绑定哈希一致 | 限定风险关闭；不扩张为 ABA 或文件系统不可变保证 |
| R2 Desktop UI 本地目标/ref等待漂移 | 独立类反例原4失败+父，作者亲复现后修本地代际/选目标/原Map entry围栏；追加select A慢B快也已作者复现并修复request epoch，迟到/异常原生选目标使仍在等待的观察失效。最终候选十套109/109；详见 `docs/development/desktop-entry-generation-repair.md` | **作者修复，待独立重跑关闭**；不新增确认/借新ref重试，不宣称撤回已发出的native动作；557仍未提交 |
| 普通媒体误拦/UnknownViz | 根已接受作者返工；已读 `browser-readable-data-contract.md` 和 main 当前 capture helper，親核 main `34CCDE937FD1F6C54DAF88BB0A7B6FDF5461C2C904021CE211058A3003FDA00E`。native成功/失败及CDP成功后均重验可见crop敏感字段/正文与视口，检查不完整拒图，固定capture一次回退 | 作者修复待382独立；不修改output.render、不因capture失败新增授权。原站UnknownViz非作者亲复現，隐藏surface仍可能不可用，不能拿本接线接受代替离屏任务或前台显示证据 |
| 新离屏图片处理 | 用户已允许，图片成员承接新任务；尚无本审查者读取的最终源码/实测证据 | 待离屏处理资源/大小/并发上限、取消/晚到、缓存与会话来源隔离验证；允许离屏不是授权读取其它窗口/会话 |
| 手机同步基线 CONNECTING 期间取消 | 根已接受作者修复；已独立读mobile-sync完整diff与 `mobile-sync-websocket-lifecycle.md`、親核 `C16554C91543C50D547B57315E14A1A389D985599104D80AB146D35E3A750C72`。这是desktop客户端runtime remote.mux基线socket，不是更改手机配对transport；socket-local终结error guard、仅清owned监听、有界close/terminate、refresh finally取消兄弟请求，settle-once | 作者真实ws修前exit1、修后14场景及56/56报告已读，仍待e139独立；非全局吞异常，不启新reconnect/retry，不改变配对/鉴权，失败不覆盖durable manifest |
| 正常工作区预览权限误拦 | 已分配预览成员；尚无本审查者读到的确切错误回执 | 待入口/localhost/来源与真实错误链核对，不猜权限不足、不退回 ambient 或任意本机读取 |
| 最终全 diff 冻结复核 | 当前多成员仍在改源码、测试、版本与文档 | 待最终 revision 和完整改动清单复核；本稿不绑定假定最终哈希 |
| 官方补丁二次幂等/安全与 release gates | 尚未由本阶段得到最终候选门禁证据 | 待验，已有 skip 不等于通过 |
| 现有 GUI/原生安装验证 | 本成员未部署/刷新原安装；隔离窗口不是现有 GUI | 待授权既有验证流程，不能宣称线上故障已消失 |
| Publisher 正式云证据 | 未在本任务执行 | 待唯一发布器获取，不提前标成功 |

## 8. 定版条件

本文件只有在以下条件全部落实后才能从审查稿定版并提交负责人验收：

1. R1 得到可复现的否定证据或作者修复加独立竞态测试；其他新发现如实登记处理。
2. 独立 browser/desktop、final-product 报告真实生成，失败逐项解释并修正；环境 skip/未测原生边界完整保留。
3. 所有源改动冻结，复核当前完整 diff 与测试变更没有删除/放宽安全断言；补齐最终精确候选与执行命令/结果。
4. 明确独立 reviewer 与作者自审边界，报告不写超出观察的认证、安装或发布成功。
5. 根正式接受此安全任务与总 QA，再允许唯一 publisher 进入它自身的不可变远端证据流程。
