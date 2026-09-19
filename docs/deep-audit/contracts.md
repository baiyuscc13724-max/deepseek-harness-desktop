# 过期版本与真实动作契约修正验收

本报告只针对9个授权测试文件；没有修改生产、manifest、README、稳定发布历史、历史审查hash或运行中的1.0.62。

## 原始证据

- `.artifacts/deep-audit-20260912/contracts-before/` 保留9个原始测试字节及SHA256。
- `baseline-v4/ordinary.log` 完整阶段基线：对应9文件有10个失败（发行身份文件2项）。不能把所有17失败都归为旧契约。
- `contracts-v2/contracts-v2-manifest.json` 绑定本轮测试SHA256；`contracts-v2-source-manifest.json` 绑定入口台账与安装依赖源码观察。运行前后测试与源码均无漂移。扫描不是穷尽动态import图。

## 更新依据与行为证据

| 文件 | 原失败 | 修正后的真正契约 |
|---|---|---|
| `tests/desktop-compaction.test.cjs` | installer返回1.0.60，却固定期待1.0.59 | 实际临时安装：返回版本和安装manifest名称/版本等于源bundle；保留破坏已安装core后重装恢复、profile局部及无错误patch文件 |
| `tests/desktop-directory-picker-plugin-service.test.cjs` | 固定版本号 | 实际临时安装比对源/目标manifest；保留正式client内容、patch与二次幂等 |
| `tests/desktop-web-search.test.cjs` | 固定版本号 | 实际临时安装比对源/目标manifest；保留provider安装、patch单例与幂等 |
| `tests/mobile-control-plugin-service.test.cjs` | 固定版本号 | 实际临时安装比对源/目标manifest；保留android_control及patch单例，增加临时目录回收 |
| `tests/model-admission-plugin-service.test.cjs` | 固定版本号 | 真实原子安装返回及目标manifest版本等于源bundle；保留Host-only身份/补丁幂等/core与临时backup清理 |
| `tests/mobile-release-version.test.cjs` | 整个默认版本对象固定1.0.59 | 独立读取properties字面值，比对package集成身份、移动revision、编码公式与实际reader输出/衍生tag资产名；保留历史单调性、重复/非法输入负面 |
| `tests/release-version-sync.test.cjs` | 固定统一1.0.59并混合当前候选与稳定历史 | 候选root semver与lock/15自有插件一致，第三方Android保持独立版本；移动/iOS/UA/签名验证workflow/示例身份关系；示例checksum明确全零非发行证明；README候选标签与stable下载身份分别断言，不改历史 |
| `tests/browser-codex-api.test.cjs` | 故障fixture未回传focused、没有精确webContents.selectAll，提前在安全检查失败 | 执行真实runBrowserPlaywrightOperation；焦点→同一WebContents.selectAll→insertText顺序；双击第二press、partial-fill insert、select箭头错误仍统一unknown outcome；新增focused:false必须拒绝selectAll/insertText并cleanup |
| `tests/desktop-ui-automation.test.cjs` | 旧fixture未实现native focus回执 | 执行真实WindowsDesktopUi；证明observe的Title控件focus回执发生在provider.keyboard前；新增回执缺失时typed focus-unverified、零keyboard、零坐标fallback；保留敏感/跨浏览器/stale/Stop负面 |

## 运行结果与限定

`node .artifacts/deep-audit-20260912/run-isolated.cjs contracts-v2 [上述9文件] tests/deep-audit-integration.test.cjs`

- 2026-09-12T12:28:02.731Z—12:28:04.469Z；71 tests，71 pass，0 fail/skip/cancelled；exit 0。
- 日志SHA256：`cb43072b6ad22a7c0a12f5a1208d533056e9985ee7703ad35eb66a9c7eb908a4`。
- 全程合成HOME/能力凭据allowlist清空；HTTP/命名管道只能连接当前Node进程实际登记的fixture端点，60131始终拒绝。
- 证据级别：installer为真实临时filesystem-adapter；浏览/UIA为真实生产类+fake平台接口unit，不是真实Electron或Windows UIA执行。未触碰系统剪贴板、真实窗口或用户配置。
- `official-followup-hermetic-acceptance`历史固定hash仍然独立保留；Git长行政目录、native PTY与2移动结构测试不在此任务成功声明中。

本任务实现与回归由验收成员完成，仍须总审独立审查本次测试改动，不能把作者自测当作总审已接受。
