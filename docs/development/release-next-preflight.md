# v1.0.60 正式发布预检

## 结论与边界

- 检查时间：2026-09-05 10:39–10:49 UTC；这是时点性只读观察，不是版本预留，也不是正式发布成功证明。
- 下一候选集成版本确定为 **1.0.60**。`package.json`、`package-lock.json` 顶层及根包版本已同步；仅三个版本值变化，依赖不变。
- 只执行官方 `release:publish` 的 `plan` / `status`。**没有执行 `run`、本地发布打包、stage、commit、push、Tag 创建、附件上传或 stable 提升。**
- 当前工作树有其他成员正在修改的功能与测试文件，未丢弃、覆盖、暂存或提交这些改动。
- 已完整阅读维护仓库 `AGENTS.md` 和 `docs/RELEASING.zh-CN.md`。正式发布必须另有持久任务及全部前置验收；本预检不授予实际发布权限。

## 版本占用与登录检查

| 检查 | 观察结果 | 解释 |
| --- | --- | --- |
| 当前已发布版本 | GitHub `v1.0.59` 公开 Release，18 项资产，发布时间 2026-09-05T08:45:57Z | 1.0.59 不可覆盖或复用 |
| 上版官方原子状态 | 1.0.59 的 12 阶段均记录 completed，最终时间 2026-09-05T09:06:05.385Z | 仅历史记录；不继承为新候选验收 |
| GitHub Tag | 只读 `ls-remote` 及分页 Tag API：1.0.59 已存在，1.0.60 不存在；本地也没有 1.0.60 Tag | 本轮观察未占用 |
| GitHub Release | 已登录分页查询未发现 1.0.60 Release（包括可见 draft） | 不创建或采用既有资产 |
| CNB Release | 官方 CLI 精确 `get-release-by-tag` 查询 1.0.60，返回 404 / not found | 非 SPA 页面推断 |
| CNB 资产 | 按官方发布器规范，以 HEAD / manual redirect / 每项 15 秒上限检查 18 项，全部 404 | 满足本轮候选资产不存在观察；实际 run 必须重新核对 |
| stable 指针 | GitHub 与 CNB 各三个目标全部 HTTP 200，`releaseVersion=1.0.59` | 不提前切换到候选版本；本项只检查版本，不等于签名或全字节验收 |
| GitHub 登录 | `gh auth status` 已登录；只读仓库 API 返回 push/admin permission=true | 认证可用，不代表所有云 Secrets 或 workflow gate 已验证 |
| CNB 登录 | 已缓存官方 `@cnbcool/cnb-cli` 的 `status` 返回“已登录” | 未读取凭据文件；实际远端写权限仍由 publisher 阶段验证 |

首次工具发现命令因 PATH 没有裸 `cnb` 返回退出码 1；后续依据仓库实现，用 `npx.cmd --no-install @cnbcool/cnb-cli` 确认现有工具和登录可用。这不是认证失败，没有安装新工具或修改 PATH。

### CNB 精确 18 项候选检查

下列名称均在 `v1.0.60` 规范下载地址返回 404：

1. `Harness-Desktop-1.0.60-linux-amd64.deb`
2. `Harness-Desktop-1.0.60-linux-x86_64.AppImage`
3. `Harness-Desktop-1.0.60-mac-arm64.dmg`
4. `Harness-Desktop-1.0.60-mac-arm64.zip`
5. `Harness-Desktop-1.0.60-mac-x64.dmg`
6. `Harness-Desktop-1.0.60-mac-x64.zip`
7. `Harness-Desktop-1.0.60-portable-x64.exe`
8. `Harness-Desktop-1.0.60-win-x64.exe`
9. `SHA256SUMS.txt`
10. `Harness-Mobile-1.0.60-android-universal.apk`
11. `Harness-Mobile-1.0.60-android-universal.apk.sha256`
12. `COMPONENT-SHA256SUMS.txt`
13. `components-1.0.60-darwin-arm64.json`
14. `components-1.0.60-darwin-x64.json`
15. `components-1.0.60-win32-x64.json`
16. `desktop-shell-1.0.60-darwin-arm64.zip`
17. `desktop-shell-1.0.60-darwin-x64.zip`
18. `desktop-shell-1.0.60-win32-x64.zip`

## 官方计划与新候选状态

已成功运行：

```powershell
npm run release:publish -- plan --version 1.0.60
npm run release:publish -- status --version 1.0.60
```

`plan` 返回 `github-actions-only`，固定 12 阶段：本地源码门禁 → 云端桌面构建 → 不可变 Tag → 桌面公开 → 正式 Windows 隔离验收 → 签名 Android → 签名组件 → 发布清单 → CNB 资产 → stable 组件 → CNB stable → 完成。

`status` 返回空 `sourceRevision` / `productRevision`、空 `candidateAttempts` 和空 `phases`。**plan/status 不运行源码测试或验证远端发布就绪；空状态不是门禁通过。**

## 尚需完成的前置

1. 用户要求的内容预览错误与其他本轮功能修复全部完成，且独立回归验收通过。预检者没有执行或宣称这些功能验收。
2. 版本关联元数据必须由获分配 scope 的成员同步。`scripts/release-orchestrator.mjs` 的 `sourceContracts` 明确要求：
   - `mobile/android/app/version.properties`：`integrationVersion=1.0.60`、`versionName=1.0.60`、`versionCode=1006000`。
   - `mobile/ios/project.yml`：`CURRENT_PROJECT_VERSION: 10060`、`MARKETING_VERSION: 1.0.60`。
   - `electron/bridge/mobile-sync-service.cjs`：`CURRENT_MOBILE_VERSION = '1.0.63'`。
   - 检查时三处仍为 1.0.59。`tests/release-version-sync.test.cjs` 有旧版本硬编码，也需随合同更新而不是删除断言。
3. `README.md`、`CHANGELOG.md`、`release-notes.md` 需准确描述 1.0.60；官方源码门禁要求三者提及候选版本。不要提前宣称新下载资产可用。
4. `docs/SECURITY-REVIEW-v1.0.60.zh-CN.md` 是 `scripts/release-audit.mjs` 明确要求的本版文件，必须基于实际审查证据，不得从上版复制“通过”结论。
5. 根协调方接受交付、完成精确提交并确认干净工作树。预检时 HEAD 为 `c13249132532d73f26fdd5830fe6a225b5f51feb`，不是新候选产品提交。
6. 由正式 publisher 执行 `npm run verify` / `npm run verify:release` 对应源码门禁，并绑定最终精确提交的云端 Windows/macOS/Linux 构建与 iPhone/iPad 模拟器证据。

第 2–4 项均不在本预检文件写入 scope，已向协调方报告。生成的 `release-manifest.json`、校验文件和三个 stable feed 必须保留上一健康版本，待 publisher 按云端签名、双云校验及 stable-last 合同推进，不手工改写。

## 后续唯一发布入口

只有另一个获授权的持久正式发布任务且上述前置通过后，才运行：

```powershell
npm run release:publish -- run --version 1.0.60
```

跨会话恢复仍用同一命令；观察仍用 `status`。不得拼内部发布命令、移动/重建不可变 Tag、替换已公开附件、从本机上传构建资产到 CNB，或绕过 digest、签名、正式 Windows 隔离自检、双云 18 项及 stable-last 门禁。若后续认证失效，只请用户本人登录，不索取或记录任何凭据。

## 本预检验证与交付

- JSON 解析断言：package / lock / 根包均为 1.0.60，成功。
- `git diff --check -- package.json package-lock.json`：成功。
- 两元数据文件 diff：仅 3 个版本值由 1.0.59 改为 1.0.60。
- 此 Markdown 已通过全文结构复读；未启动 GUI/服务器或生成 DOCX，也未声称完成视觉预览。
- 本任务没有后台作业或隐藏委派。
