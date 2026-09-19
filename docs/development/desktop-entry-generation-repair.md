# Desktop UI 旧引用等待竞态修复

日期：2026-09-05；候选版本：1.0.60。此记录为修复作者自检，独立测试仍归浏览器/桌面验证任务；不构成安全审查或发布许可。

## 根因与修复前证据

独立测试成员在实际 `WindowsDesktopUi` 类、受控 native adapter 中提供确定性反例：`#entry` 的 `assertCurrent` 只核共享 controlGeneration / 授权 / signal，未核本地 observation generation、selectedTargetId 与 ref Map 中的原 entry。`perform` 或 `captureFrame` await 期间完成一次新 `observe` 或 `selectTarget` 后，旧 click 仍可把旧坐标交给 `provider.pointer`。

本修复成员亲自重跑未改动的 `tests/desktop-ui-automation.test.cjs`：**23 tests / 18 pass / 5 fail / 0 skip，exit 1**。失败为 4 个 target/observation 组合加父测试，均见 pointer 次数 1、预期 0；同测试的 Stop / controlGeneration 变化原本已拒绝。不是 5 种独立攻击，也不是真实系统输入。

## 最小生产变更

唯一生产文件：`electron/bridge/windows-desktop-ui.cjs`。

1. `#entry` 在任何 await 前保存共享 controlGeneration、本地 generation、selectedTargetId、规范 ref key 和原 Map entry 对象。`assertCurrent` 要求授权/共享代际/signal仍有效、本地代际与目标不变、Map 当前仍为同一 entry。
2. `perform` await 后、`#entry` 返回到 click/type/scroll 后，以及 click/scroll 的 captureFrame await 后统一使用此闭包重验。变化时 `desktop-ui-ref-stale`，不再调用旧 pointer/keyboard，不获取新 ref 自动重试。
3. ref 的 targetId 不属于当前选定目标时立即 stale；不再自动 selectTarget 后携旧 ref继续。调用方可显式选择目标并重新 observe；这不是新增用户授权/确认。
4. selectTarget 开始即清 refs，结束仍清；observe 开始即增本地代际并清 refs，目标枚举 await 后和 UIA observe await 后核代际/目标。旧输入不能趁新观察/选择仍等待原生返回时继续。
5. 根追加重叠请求核验后，作者真实复现 select A慢/B快时迟到 A仍把已观察的 B 目标覆盖。新增 selectionGeneration：每次选择拥有自己的 request epoch，await 后还要观察代际未变才发布 selectedTargetId；observe 的两个 await也核 selection epoch，拒同目标重选期间的旧树。迟到/共享控制变化/原生异常可能已有选目标副作用，因此保守清 refs、推进观察代际（连仍挂起的新观察一起失效），不回写旧 target、不借 B 代际生成 ref、不自动恢复 native选择。
6. 共享 Stop/授权、敏感结构化输入、browser_control 优先、UIA stale 禁止坐标 fallback、bounds、固定动作表和原生 provider 门保持。没有触碰测试、browser/main/媒体、新预览入口或发布器。

本次没有建立窗口管理器原子事务：原生 perform/pointer/keyboard 一旦已经发出，事后检查不能撤回它，也不能据 stale 回执宣称动作从未发生。调用方不得对已发出而结果未知的原生动作盲重发。测试证明的是围栏发现变化后**不再发出后续 fallback**。

## 修复后作者执行

| 执行 | 结果 | 真实性与限制 |
| --- | --- | --- |
| `node --check electron/bridge/windows-desktop-ui.cjs` | exit 0 | 语法检查 |
| `node --test tests/desktop-ui-automation.test.cjs tests/browser-control-server.test.cjs tests/browser-security-policy.test.cjs tests/browser-url-policy.test.cjs tests/browser-action-gate.test.cjs tests/browser-codex-parity.test.cjs tests/browser-operation-coordinator.test.cjs` | **92/92 pass，0 fail/skip，exit 0** | 原 4 反例全部变绿，含既有 click/type/scroll 正例与 Stop/敏感/浏览器优先门；测试源码由独立验证成员持有，此作者未改 |
| `node --test tests/windows-computer-use.test.cjs tests/desktop-computer-use.test.cjs tests/computer-use-coordinate-space.test.cjs` | **17/17 pass，0 fail/skip，exit 0** | provider/全桌面坐标/共享授权兼容性；native 能力探测不触碰窗口 |
| 首次修复的实际类 inline fixture | **35/35 pass，exit 0** | 作者受控 adapter，五路径（click perform/capture、scroll perform/capture、type perform）×七种变化：已完成 observe/select、仍挂起的 observe/select、本地 generation 单独变化、target 单独变化、同 key 替换 Map entry；全部 stale、pointer/keyboard 0。此轮先于根追加迟到选择细化，不冒充最终候选独立重跑 |
| 重叠请求实际类 inline fixture | **6/6 pass，exit 0** | observe 的 targets/UIA 两个等待点分别遇新 observe 或同目标 select：旧树不发布/不改变 B Map；select 晚于 B选择+观察或新观察：不回写目标且 B refs保守失效 |
| 最后细化的实际类 inline fixture | **3/3 pass，exit 0** | select late / native error / control-generation 变化后，新 observe 还在 UIA await：代际被推进，随后旧树拒绝，refs为空 |
| 最终候选合并上述十个正式 suite | **109/109 pass，0 fail/skip，exit 0** | 在最后 native失败/观察代际细化后重新执行，语法检查同轮通过；不是将此前计数简单相加冒充重跑 |
| scoped `git diff --check` | exit 0 | tracked 生产改动无 whitespace 错误；新文档另以 `git diff --no-index --check -- /dev/null` 检查，exit 1 为与空文件存在差异，仅输出 LF→CRLF 提醒，无 whitespace 错误。未将 no-index 的 exit 1 记成 exit 0 |

所有 inline 场景均运行生产类，用 entered/release latch 明确进入等待点，不靠 sleep；原生 adapter 是替身，不向仓库测试写文件。最终独立成员须持久化并自行重跑补充边界。

所列后台运行作业均已收取输出，未留后台工作。没有启动替代 GUI 服务器、操作真实桌面、修改安装件或发布。

## 候选绑定与独立复验要求

修复后 SHA-256：

- `electron/bridge/windows-desktop-ui.cjs`：`09F5BF8B15E3C3C6E821F01698541EA1B5FF1FB78D34DB77A75E0EF373C4C564`
- 原独立反例文件 `tests/desktop-ui-automation.test.cjs`：`1FB490BB204055CCB91881CBC6B2E75694B03F495AC8023FCF2589C2CA74A6B0`

请独立验证成员在此源码上重新跑公开类反例与回归，并将 type/scroll、Map entry 替换及新观察/选目标尚未完成的边界纳入正式持久测试。作者 inline fixture 是补充，不替代正式独立证据。

安全审查任务仍未定稿：此缺陷须列作者修复/待独立关闭，不能拿本记录或作者绿测试提前通过发布门。
