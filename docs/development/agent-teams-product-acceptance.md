# Agent Teams 产品行为验收计划

## 范围与证据等级

维护仓版本为 1.0.59；本计划对应 `agent-teams-professional-contract.md` v1。角色是职责，不是专业认证；通过状态机测试不证明模型业务质量优于通用代理。

基线任务只新增两个 test 文件及本计划。最终验收另在核心、界面、基线均获根接受之后执行，不用消息送达或成员自报代替依赖满足。

## 已执行基线（2026-09-05）

维护目录运行：

```powershell
node --test tests/agent-teams-task-submission-protocol.test.cjs tests/agent-teams-task-occ.test.cjs tests/agent-teams-ui.test.cjs tests/agent-teams-workbench-ui.test.cjs tests/agent-teams-stop.test.cjs tests/agent-teams-authorization-service.test.cjs tests/agent-teams-autopilot.test.cjs tests/mobile-agent-team-slots.test.cjs
```

结果：180 tests / 180 pass / 0 fail / 0 cancelled / 0 skipped，exit 0，约 3.64 秒。`pwsh-2` 已收取。包含源码契约断言、隔离存储/授权 fixture、VM 组件与事件行为，不等同 180 项真实 GUI 或模型测试。

## 契约与覆盖矩阵

| 场景 | 必须观察的行为 | 验证位置 |
|---|---|---|
| 通用任务 | 无 required_skills 可正常领取；角色字符串不得被当作已加载技能 | 公共注册工具 + 临时真实存储 |
| 专业绑定 | required_skills 精确名称；目录存在仅 bound；不存在 missing；模型伪造 loaded 不采信 | 公共工具 + 临时技能目录 |
| 实际加载 | 真实成功 skill 运行证据绑定当前 claimant、claim 时刻、项目；旧 claim / 错 scope / 失败调用不能 loaded | 受信运行事件 fixture |
| 交付 | submit 与 complete 都只 submitted；空/缺文件/绝对路径/穿越/链接逃逸拒绝；摘要来自真实文件 | 公共工具 + 临时文件 |
| 审阅 | submission_id 精确、条款依据有内容；变更产物须拒绝；quality 仅 lead_reviewed 非 host_verified | 公共工具 + 文件变更 |
| 围栏 | 旧 claim、Stop、旧 revision、重复请求换正文拒绝且不改变状态/账本；精确重放不重复事件 | 公共工具 + 存储快照 |
| 依赖 | 自报、checkpoint、submitted 都不解锁下游，根审阅接受后才解锁 | 公共工具 |
| 兼容 | 旧任务明确 legacy_unverified，不凭迁移变成有证据；旧 complete 别名仍受领取围栏 | 旧数据真实读写 round-trip |
| 控制建议 | nextAction 是建议不是授权；危险/暂停显式 attention；未实现 action refs 不能宣称已简化 fence | 公共投影 + 门禁反例 |
| UI 状态 | submitted 不等 ready；completed/cancelled 不冒充成员当前任务；任务权威状态不写回 | 完整 client VM 组件执行、混合 fixture |
| 默认披露 | 正常诊断/历史默认收起；成果可找到；Stop、未知结果、权限异常可见 | 初始组件树与隔离 Electron DOM |
| 负责人 | 一个明确入口到已验证 root，会话不存在时解释；不自动发送、不误跳成员 | 控件回调 + DOM 点击 |
| 可访问性 | 语义 button、键盘开关、焦点返回、手机 slot 保持 | DOM + 现有移动/键盘契约测试 |

## 新测试实现策略

- `tests/agent-teams-professional-capabilities.test.cjs`：使用插件 `apply` 注册的真实公共工具，临时 DSH_HOME、临时存储和临时交付文件。只替换模型启动/授权等外部运行依赖，不调用真实模型，不读真实用户会话。
- `tests/agent-teams-product-experience.test.cjs`：加载完整 `client.js`，仅在测试内注入内部组件出口，不改生产源码；先覆盖基线安全交互，再按稳定 v1 投影增加状态/披露测试。VM 元素树不是浏览器布局或 React DOM，必须明确标注。
- 环境探测：有 React，无 react-dom/server、react-dom/client、jsdom、linkedom、playwright、@playwright/test。真实 DOM 使用现有 Electron 的隐藏隔离窗口作为后续验证方案，不安装依赖、不另起服务器。
- 不以 skip/todo/删除安全断言制造通过；旧 UI 断言若与新规范冲突，综合回归阶段按新语义更新并保留安全覆盖。

## 运行安装路径检查

已确认当前 `http://127.0.0.1:11353` 由现有 Harness Desktop 进程监听。DSH_HOME 指向 `D:\Harness Desktop\HarnessData\dsh-home`。只读筛选实际 node/npm/pnpm/Harness 进程，未发现 `dev:web` watcher；查询命令自身的字符串匹配不算 watcher。

维护插件 package 指向 `lib/index.js` 和 Web `lib/client.js`，没有插件构建 script。桥接安装代码会把正式/开发来源拷入 profile 的 node_modules，不会因为编辑维护源码就自动更新安装件。初查 `profiles/web/node_modules/dsh-agent-teams` 无该目录；不能推断未安装，因为其他 profile/module 解析布局仍需精确发现。一次广范围目录发现超时，未重试或把超时说成不存在。

当前 GUI 根据本轮负责人既有控制回执无可用标签，因此未绕过继续浏览器、不使用桌面截图替代。未改安装文件、授权、个人配置；未构建部署。最终报告需区分源码测试通过和当前 GUI 未验证，不承诺热更新。

## 新增基线结果

```powershell
node --test tests/agent-teams-professional-capabilities.test.cjs tests/agent-teams-product-experience.test.cjs
```

最后实跑 8 tests / 8 pass / 0 fail / 0 skipped，exit 0，约 0.82 秒。两个公共工具行为测试从真实 apply 注册、team_start、create、commit、spawn、claim 到 checkpoint/提交/接受/依赖；六个完整客户端 VM 组件行为测试覆盖取消历史、命名按钮与惰性点击、未知结果 Attention、双语 submitted、当前任务过滤、诊断默认关闭。测试内仅 stub 模型生命周期，未伪造生产领取/接受账本。

调试中实际有过失败：初始夹具在建队前错误调用 status、缺少启动/结束生命周期和成员 open-turn 事件；均补齐夹具而非放松生产门禁。UI 新版已把工作明细默认收起，故当前标题断言从默认可见改为可找到；原英文负向表达误把 Awaiting lead acceptance 后的 no new claim 匹配成等待认领，已收窄为真正 waiting for claim。所有相关背景 jobs（pwsh-4/5/6/7）已收取；没有跳过失败测试。

## 后续综合验收

根接受三个前置任务后，重新领取综合回归；重跑专业/交付、OCC、提交、生命周期、授权、自动继续、客户端、工作台、移动及适当全套测试。对生产缺陷仅向唯一文件成员报告，测试成员不改 index/client。报告完整命令、失败类别、退出状态、未验项，交付中文使用文档与 `output/team-product-validation.md`。

负责人补充的 inline 验收要求：`delivery.content` 可承载有界真实短文本，Host 派生 contentHash；inline-only 为 inline_bound，文件或混合为 artifact_bound，均绑定精确 submission review。不得用最少 32 字、内容不得等于摘要、files 写范围非空就强制文件等形式限制拒绝有效短结论。最终加测短结论、空文本、伪 hash、同请求变更正文、文件变更与错提交审阅；本次基线尚未声称这些新功能已通过。

另外已获派后续浏览器/desktop回归，须等待其独立依赖被接受再领取：错误 scope 拒绝、正确 status 成功、已 Stop 不隐式启动。此处只记录验收衔接，不提前执行或改对应源码。
