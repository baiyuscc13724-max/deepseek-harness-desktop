# v1.0.60 团队机制变更安全审查

## 范围与来源

候选从已发布 1.0.59 的 c13249132532d73f26fdd5830fe6a225b5f51feb 隔离创建，仅包含范围提醒、当前回合被动等待、停止后清理和必要发布元数据。未复制其他工作树中浏览器、离屏、原生预览等取消或未完成的改动。官方依赖锁定不变。

## 身份、Stop 与副作用

- 暂停清理权限由公开工具入口依据当前直接用户回合及精确存活根对象同步派生，没有模型可传入的 bypass 参数。执行、成员重分配、接受结果等操作仍不能穿过暂停边界。
- 取消保留 revision/pause epoch/请求幂等键及追加审计历史。关闭前后核验根身份与 Stop epoch；异步排空时发生新 Stop，不允许旧结果关闭团队。失败保持 paused，未知成员排空保留 shutdownUnconfirmed。
- 暂停团队的 graceful 与 force 清理都只排空已有成员，不通过提示或 Resume 启动模型。
- 被动等待仅占用当前可取消的 tool call。它没有 Goal、授权服务或成员启动 API 调用，不发定时轮询，不创建自动回合；既有 autopilot grant 和 budget 校验保持不变。每根最多一个订阅，Stop/Abort/退出释放，身份或项目变化失败关闭，返回数据后再次核验异步边界。
- 范围摘要是内部任务历史的派生值，不更改持久 schema，不将建队目标或任务数量标成用户批准。UI 为纯文本静态 note，无 HTML 注入、弹窗或自动提交。

## 候选源码冻结（canonical LF SHA-256）

这些值用于后续门禁防止候选漂移，不是发布成功或 Host 批准回执。1.0.59 的历史 ACCEPTED 映射和安全审查保持原值；当前测试仅允许下面明确列出的 1.0.60 后继差异，其他历史绑定源码仍逐字节校验。

| 文件 | SHA-256 |
| --- | --- |
| README.md | 59f251c15078b8e3f92dd8e0d652968505d507cea4e77a950e58cf3a2cceacdd |
| CHANGELOG.md | 2e5c87a7d8a3539543666103b1809aa380a3600b79cf8a5542fd03b06f1d102a |
| release-notes.md | 5d931061a0965bafb90d93d176034da309abcf0cc3ca997b2e23d3fad21dceb0 |
| plugins/dsh-agent-teams/lib/index.js | 9698de8919a116da4ea2b0872746f48b9016cb976cb4e842199910f379e1a5f4 |
| plugins/dsh-agent-teams/lib/client.js | ad7b41e84cdead0988d005e67a5906b862075648a174a2b4526566e1ead2810e |
| tests/agent-teams-runtime.test.cjs | cbb737b7b5a597f35ede0ee693ed8be2e1956ba9d6ca7cf24b18e1880a82de80 |
| tests/agent-teams-domain.test.cjs | 9d73575a69be0b1fba2fdd8335f708fa50f5c70395cdcdd0c6d625519b26f323 |
| tests/agent-teams-passive-wait.test.cjs | 66f44e567dd83e32625f270417176ae27451a5afa24c954c7257023fdb62f942 |
| tests/agent-teams-scope-reminder.test.cjs | de35cc8f72269eaaac381fa66947d893f91d83679fc936efc0eced82c79f73f0 |

## 实测证据与限制

串行 `node --test --test-concurrency=1 tests/agent-teams-*.test.cjs`：535 通过、0 失败、2 个既有条件跳过。65 根冷投影中位31.250ms，低于未改动的60ms门禁。并行全套的单次性能争用失败保留记录，未抬高阈值；隔离及串行复验通过。

补充暂停成员 graceful/force 排空、失败、更新 Stop 竞态回归通过。新范围/等待测试和真实工具参数回归通过。条件跳过的打包运行时测试不视为通过，正式产物门禁仍由发布器执行。

冻结候选的 `npm run verify` 已通过：303 个测试文件经仓库 runner 恰好执行一次，普通阶段 2368 通过/29 条件跳过，隔离性能阶段 152 通过/3 条件跳过，均为零失败。`npm run verify:release` 通过。新增订阅初始化失败清理已实测；历史源码审查摘要保持不变，当前后继摘要独立校验。上述计数有重叠，不与早期局部回归累加。

本文是源码审查记录，不冒充独立 Host 验收、签名证明或发布完成回执。正式 source revision、云 run、资产摘要与安装自检以唯一发布器生成的证据为准。无明文凭据、签名私钥、令牌或用户原始会话内容进入本变更。
