# 第二轮设置保存修复：实际 DOM 前后对照

## 结论与严格范围

本交付修复维护候选 `renderer/app.js` 的主题/custom/range 保存反馈、同步去重与陈旧全量回执覆盖。**不是当前安装版认证、全部设置/主题视觉验收或 native IPC 时序认证。** 不改 CSS、HTML、theme-integration/modal-focus、主进程或真实配置。模式保存 handler、原生壁纸导入和真实 guest 的发布链未扩大范围。

- 完整原 app 已在首次修改前保存为 `tests/fixtures/deep-audit-settings-save-fix/app.before.js`，SHA-256 `3086aae0818e127ee12ac4db989ab9ed0760c68efbcb67eb3943de069e2064fa`。
- 修复候选 app SHA-256：`560354dc1ce1f365473da3068c75f0dec8ff08b46c03fe0a5b9fd1c03d7bdb65`。
- 旧组件检查文件逐字节保留，复制的 `checks-original.js` 仍为 `98d42a87ea2c2c9f22aca81b9f72600cf05c799c74bdc575d911ba14995ae01b`；原47个观察/期望不改。
- 已验证的 `candidate-v4-frame`：原版39符合/8红；候选45符合/2红。新增15个修复检查原版4符合/11红、候选15符合/0红。外层3个 Node 门控测试通过，但**这不把候选剩余两项契约 review 改成产品通过**。
- 最终 `.artifacts/deep-audit-round2-settings-save-fix/author-final-v1/` 再次重现相同39/8、45/2和新增15/0；加入历史冻结后4个Node门控全通过，0 fail/skip/cancel，exit0，约38.25秒。实测缓存Electron43.2.0/Chromium150.0.7871.129；不是当前GUI。
- 最终 before receipt SHA为 `c9415aa33c89db42419acc515885b18d0a2fc50172a9d499953d1dc0fd0e82d3`，after为 `27cb93f1deb8c96d40827672612a15ea352dcdba8df620dc853ad3fa3e523cd3`。两receipt仍标 `product-findings`，保留red记录。所有启动的job（pwsh-1、pwsh-3、pwsh-4）已收齐，无遗留后台作业。

原 `coverage-master.json` 的598域行、115 USER、104有限接受及历史2929/2889 pass/7 fail/33 skip保持不变；本轮测试数不加入历史总计，不为整个 USER 写全功能通过。

## 真实提交与响应契约

先只读核对实际源码，然后在全新临时路径运行真实存储类：

1. `electron/main.cjs` 的 `appearance:setTheme`、`appearance:setUiPreferences`、`appearance:saveCustom` 先调用 `ensureStateStore().updateAppearance(...)`，再返回 `appearancePayload()`。
2. `electron/store/app-state-store.cjs:451–471` 同步合并已有 `customTheme` 与 patch，再正规化；只更新明确给出的其他字段。`#persist` 使用 `writeFileSync` 和 `renameSync`，随后返回克隆状态。
3. `readAppearancePayload` 在进入异步壁纸库处理之前，通过 `get()` 捕获独立 appearance 快照，然后 `await wallpaperLibraryPayload(appearance)` 及相关文件读取。因此**保存提交先后与完整响应生成/交付先后是不同层**；较晚到达的响应不等于较晚提交。
4. 实际 fresh `AppStateStore` 磁盘用例先保存 accent/brightness/uiMode，再保存 blur/reducedMotion；重新实例化读取磁盘，确认 brightness100、blur8、accent `#aabbcc`、mode spatial 和 reducedMotion true 共存，首次快照仍保持 blur2。见 `backend.json`。

存储模块实测输入 SHA为 `1a8bf02a9d801a381fc988eac9ae8a136982a9cdb6e1c0982af25f7f2c587e18`。主进程/IPC异步 payload 层仅源代码检查；**没有运行真实 main 服务、真实 settings 文件或证明 native IPC 可逆序**。磁盘测试只证明上述成功提交的同步合并路径，不认证磁盘损坏/权限错误回滚。

## 最小生产变更

### 保存入口及反馈

- 共用 helper 在调用 bridge 前同步登记 pending 请求。连续同 payload 的当前请求复用；A→B→A 是新意图，不能误当首次A的重复。
- 原生按钮立即 disabled/`aria-busy=true`，结束恢复此前 disabled 状态。主题 article 保留键盘焦点，以 `aria-busy` 和独立状态文本反馈，重复激活由请求层去重；未给非按钮伪造 disabled 属性。
- 在现有 picker header 后由 app 创建独立 `role=status` / `aria-live=polite` 文本，沿用已有 class，不修改样式文件。custom/theme 失败可见且保留弹窗，重试可成功，不再有对应未处理拒绝。
- wallpaper range change、应用和推荐值恢复使用同一保存路径，失败时不输出“已保存”。
- 恢复官方外观改为调用**现有** `setUiPreferences` 接口一次发送 `{themeId,uiMode,reducedMotion,lowPerformance}` patch：该接口原本已把完整 appearance patch 传给同一同步 store。不是新增 backend API，也没有新增模式保存 handler 语义。

### 全量快照与新意图

- 保存成功保留完整 host 返回值，包括额外未知字段；只按请求序号选择可应用的最新成功全量快照，不手工只拼 themeId 丢弃其他设置。
- 新请求 pending 时不让旧响应覆盖新意图；新请求失败时仍允许此前成功提交的快照落地，失败不伪装成功。
- 最新成功响应已应用后，旧成功/失败都不会反写 appearance 或新弹窗反馈。
- range 的 input-only 临时预览有字段序号。旧保存完成时只保留该请求之后的真实 input 预览值，后续 change 仍从完整表单提交。没有把预览值谎称已经保存。
- picker 原有 generation/focus 逻辑不改；close/open 的本地反馈序号仅隔离旧提示，**不取消已提交保存**。

## 前后检查

### 旧47检查中的六项确认修复

| 观察 | 原版 | 候选 |
|---|---|---|
| custom pending busy/disabled | 缺失 | 立即可见且禁用 |
| custom reject | 无内联反馈、未处理拒绝 | 可见错误、可重试 |
| 同一轮双击 custom | 两次请求 | 一次请求 |
| theme reject | catch吞错，无反馈 | 可见错误、可重试 |
| A/B theme旧快照迟到 | UI回退A | 保持B |
| brightness/blur旧快照迟到 | blur回退2 | 保持blur8 |

### 明确保留的两项契约 review

1. 只触发 range input、不触发 change 后关闭重开仍保留预览110，而存储82：现有界面是关闭，不等于明确事务取消。没有授权定义“关闭隐含回滚”。
2. 已提交 theme 保存后关闭重开，旧成功回执仍可更新外观，但不关闭新弹窗或夺焦点：没有授权定义“关闭取消已提交保存”。

两项在 before/after receipt 中仍保留原 expected 与 red，不改名、不删行、不追求47全绿。

### 新增15个条件检查

新增检查覆盖：同轮custom去重/同步busy；错误恢复和无未处理拒绝；成功重试；五次主题激活去重；主题错误状态；**固定persisted最新B仅倒序交付旧A响应**；固定persisted的两字段逆序；custom→theme全量字段保留；最新失败但此前提交成功的回退；旧失败不改新成功/新弹窗提示；保存期间后续input预览保留；后续change提交；恢复官方单patch/恢复按钮；20次range burst最终与存储收敛和无busy泄漏。

补充模型 `commitSnapshots` 按请求次序先提交/捕获完整快照，`deliverSnapshot` 仅交付响应，**绝不更新 persisted**。因此主题A迟到造成UI回退的旧版观察，不依赖“测试存储也倒退”的模型。extraSyntheticField 同时证明新响应未知字段没被丢弃。原47仍保留原作者 reply 模型，与补充模型分开标明。

## rAF 对照与夹具边界

- `candidate-v1`（隐藏窗口、固定60ms）与 `candidate-v2`（offscreen、固定60ms）保留原版9红/候选3红：多出同一个range preview shell-theme观察尚未反映。不得把它算作新生产回归，也没有删改该断言。
- `candidate-v3-probe` 在原生 `requestAnimationFrame` 与2500ms deadline之间竞速，两版都真实收到rAF（visibility=visible）；固定60ms下原版恢复8红而候选仍3红。它显示固定等待与真正帧回调不是相同完成条件，单次早期probe不足以约束后续帧。
- `candidate-v4-frame` 只在**新派生夹具**中将 `tick` 改成同时等待实际rAF与原60ms事件/错误交付；rAF 2秒不到直接拒绝并使证据失败。没有替换产品 requestAnimationFrame、保存/预览算法或人工写 dataset。旧 checks 文件hash不变。
- 真实Chromium offscreen DOM/CSS继续使用同一隐藏 BrowserWindow，不展示当前GUI，不发native输入。before/after在两个独立 fresh Electron进程；旧固定60ms失败产物全部保留。
- HTML14个自动script禁用、收紧CSP、webview替inert div、启动尾部换private seed/open/close/snapshot皆有逐项可逆 seam；真实markup/样式/组件函数/事件监听仍执行。回滚seam与各自app输入字节相等。

## 安全与未验范围

PowerShell 清空环境并仅注入固定系统目录/运行时PATH与全新 HOME/USERPROFILE/APPDATA/LOCALAPPDATA/TEMP/TMP/DSH_HOME，Electron再次白名单。Node网络、子进程、Electron clipboard/shell/dialog/net/window操作/下载以及renderer网络/剪贴板/外开端口在产品代码装载前拒绝。session只允许已复制的精确本地fileURL，CSP connect/frame均none。原生请求、网络拒绝尝试及其他禁止端口实际调用数组均应为空，由门控断言。

这是能力端口和调用轨迹，不是全机抓包/OS系统调用sandbox认证。没有读取账户/代理/token、真实设置、设备、当前GUI、60131或公网，没有安装依赖、构建安装包、发布、推送或保存真实主题。

原47包括真实modal焦点/IME guard/Escape、反复开关与200% bounds观察，但不认证physical输入、屏幕阅读器、完整IME、所有字体/布局/颜色、所有controls滚动可达。guest URL固定为空，因此实际主题publish早退，正式guest注入/应用链未验。模式保存handler与壁纸导入backend竞态未纳入本修复；没有据此新增任务或冒充完成。

## 重跑与冻结

在维护树执行，必须用全新Run名，已有目录会拒绝覆盖：

```powershell
& ./tests/fixtures/deep-audit-settings-save-fix/run.ps1 -Run independent-new-name
```

入口为 `tests/deep-audit-settings-save-fix.test.cjs`；它固定候选hash、原版3086副本、真实styles/HTML/theme/modal、原checks hash，before/after前后重新核验。原fixture、原报告与原final receipt按历史hash验证；三个历史 acceptance final-freeze中每个files记录逐条核sha，不覆写旧freeze。源码变更将安全失败，应由后续授权任务重新绑定，不能将本脚本当自动批准器。

`delivery-freeze.json` 将绑定本轮主要源码、夹具、报告、最终TAP/backend/两个receipt及旧历史冻结验证产物。作者提交不等于root独立接受；此交付等待单独复核。
