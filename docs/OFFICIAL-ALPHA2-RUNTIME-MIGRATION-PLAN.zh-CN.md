# 官方 alpha.2 运行时制品审计与迁移计划

> 审计对象：Harness Desktop 维护树 `release-v1.0.28-worktree`，产品版本 `1.0.54`。  
> 执行时点：2026-08-30T15:47:54Z–2026-08-30T16:00:02Z。  
> 目标：`deepseek-ai/deepseek-harness` `dsh-v0.1.2-alpha.2`。  
> 性质：只读 GitHub/npm 供应链审计 + 本地离线合同；未安装依赖、未改 package/lock/scripts/node_modules、未运行 GUI、未打包或发布。

## 1. 最终判定

**上游 npm alpha.2 包闭包存在，但当前产品不能直接 bump。**

- GitHub release、tag、commit、MIT 许可证和 npm 包不是从名称推断：本审计逐项查询 GitHub API、npm packument，并重新下载 20 个本项目直接 `@deepseek-ai/dsh*` tarball 校验 SHA-512。
- 20 个直接 DSH 包都存在精确 `0.1.2-alpha.2` 制品；从它们的精确 manifest 递归遍历出的 215 个 `@deepseek-ai/dsh*` 包均存在同版本 packument，缺失 0 个。
- 但是当前 postinstall 补丁编排器仍硬编码 `@deepseek-ai/dsh-client-runtime` 和 `@deepseek-ai/dsh-host-apiproxy`；这两个包在 npm **没有** `0.1.2-alpha.2`，且不在新递归闭包中。它们分别处于 Client runtime 拆分、ApiProxy → Remote/Session Controller 架构替换边界。因此，单改 package/lock 会在 postinstall 读取不存在文件时失败；产品制品闭环仍缺一项“补丁迁移/退役”的实现工作，必须 fail closed。
- 官方 experimental Agent Team 仍不是正式发布闭包的一部分，且不提供本地 durable plan/lease/effect/recovery/project 权威语义。**不得替换自研 Agent Teams**。

安全结论是：下一实施任务可以把下表 20 个直接 DSH 包作为**一个不可拆分的精确版本集合**迁到 `0.1.2-alpha.2`，但同一变更必须重写/退役两个消失包的补丁入口、逐个复核其余补丁、重生成 lock 并通过迁移门禁；不能只执行版本替换。

## 2. GitHub 固定证据

GitHub API 观测时间：`2026-08-30T15:47:54.6073859Z`。

| 事实 | 固定值 / URL |
|---|---|
| release | [`dsh-v0.1.2-alpha.2`](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.2-alpha.2)，prerelease，发布时间 `2026-08-30T13:52:14Z` |
| release assets | `0`；release 页面本身不提供可执行二进制，不能用 tag 代替 npm runtime 证明 |
| tag | lightweight tag，object type `commit` |
| commit | [`0a53fb55bea101816fa226bb964ae2bed71c343b`](https://github.com/deepseek-ai/deepseek-harness/commit/0a53fb55bea101816fa226bb964ae2bed71c343b) |
| tree | `64ccbfa8e0caa4711cd4a75717ef9e022657961b` |
| commit time | `2026-08-30T13:37:53Z` |
| source tarball | [`codeload`](https://codeload.github.com/deepseek-ai/deepseek-harness/tar.gz/0a53fb55bea101816fa226bb964ae2bed71c343b)，下载 SHA-256 `935574f69c8bb10b697cf8abe8c0449dab783e9f73dc3f224629458b6f65b980` |
| license | [`LICENSE@commit`](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/0a53fb55bea101816fa226bb964ae2bed71c343b/LICENSE)，MIT，Copyright (c) 2026 DeepSeek |
| upstream workspace | `pnpm@11.7.0`；workspaces 为 `vendor/*`、`packages/*/*`、`native/landlock-run`、`native/landlock-run/packages/*`、`apps/*`、`website` |
| Node | 根 `package.json` 声明 `^22.19.0 || >=24.0.0` |

审计进程为 Node `v24.16.0` / win32-x64 / ABI 137，满足官方根 Node 范围。维护树固定 Electron `43.2.0`，但官方仓库和 npm DSH manifest没有声明 Electron contract；不能从“Node 范围满足”推导 packaged Electron 等价。Electron 主进程、原生模块 ABI、BrowserWindow carrier 与正式包自检必须在后续集成门单独证明。

## 3. npm registry、workspace 与 tarball integrity

Packument 基址：`https://registry.npmjs.org`。直接包观测时间 `2026-08-30T15:49:13.9146109Z`；20 个 tarball 重新下载并完成字节级 SHA-512 复核时间 `2026-08-30T15:53:41.3996192Z`，20/20 与 `dist.integrity` 精确相等。初次递归存在性观测时间 `2026-08-30T16:00:02.303Z`；确定性范围解析复核时间 `2026-08-30T16:09:56.020Z`。

确定性闭包不是“只数包名”：从 20 个根精确 pin 出发，读取每个 `0.1.2-alpha.2` packument manifest 的 `dependencies`、`optionalDependencies`、`peerDependencies`，只沿 `@deepseek-ai/dsh*` 边递归；每条父 range 都用 prerelease-aware semver 验证选择 `0.1.2-alpha.2`。结果为 215 个精确包、1,115 条父依赖边、加 20 条 ROOT 记录，共 1,135 条记录；不可解析父 range 0、残留 `workspace:` range 0、指向 `0.1.1-rc.2` 的 range 0，20 个直接 alpha.2 manifest 的上述问题也为 0。

确定性记录格式为 `name@selectedVersion|integrity|parent@selectedVersion:dependencyKind:parentRange`；ROOT 格式为 `name@selectedVersion|integrity|ROOT:dependencies:exactVersion`。所有记录按 Unicode code point 升序，用 UTF-8、LF 连接且末尾无 LF，SHA-256 为 `0ed92cc8ae3fafec77ca54559a7719adf09c5c657200dc2791dc1d06cb2b0b3a`。另将 215 条 `name@version|integrity|packumentUrl|tarballUrl` 以同样规则序列化，SHA-256 为 `dd62b0f8e9f5d068cb6a6246d9dbb7f920b8e159a2d14b9d3a5e3435a69f48bd`。这些摘要证明本次选择的 **DSH scope 精确依赖范围可解**；它仍不证明 npm 的所有非 DSH 外部依赖、peer placement、平台 optional/native 二进制、Electron ABI 或产品安装脚本已经形成可安装产品闭包，也不宣称下载校验了全部 215 个 tarball。

每个包可复核 packument 路径为 `https://registry.npmjs.org/<URL-encoded-package>`，tarball URL 为 packument 中 `versions["0.1.2-alpha.2"].dist.tarball`。所有下列包的 `alpha` dist-tag 均指向 `0.1.2-alpha.2`；很多包的 `latest` 仍是更早 rc，迁移必须使用精确版本，不能使用 `latest`。发布 tarball、DSH scope 范围可解、产品可安装闭包与 `runtimeEquivalent` 是四个不同判定；本次 `runtimeEquivalent=false`。

| 本项目直接包 | 官方唯一 workspace | `dist.integrity` | 判定 |
|---|---|---|---|
| `@deepseek-ai/dsh` | `apps/cli/package.json` | `sha512-4TvTC5kRKlgtSU2UTBv+cID9a2Z+6+m6mpvjXWJfVzuTkflCff6s4MsQpFJTCmwFh/k7zNWe7qFXcLYMV/5VvA==` | 可精确升级，必须随闭包原子迁移 |
| `@deepseek-ai/dsh-anonymous-user-id` | `packages/identity/anonymous-user-id/package.json` | `sha512-mwuJvUuj6CHewyGm0m6WIuADglJkAKNzJ8G4W2zQ+uC01C4zp5M4t0jnJ1FmHa4ctRTj0jo4VCV6TmhPFSSE1g==` | 同上 |
| `@deepseek-ai/dsh-atomic-write` | `packages/util/atomic-write/package.json` | `sha512-9ZWA2sDIKYN5ewKBcGDKLi4YndRAS9OAa6a/9QWpNqxUqU/VK4W69JF3F4AwfzWnRjmymW+Ntbma6IB1B3e3QQ==` | 同上 |
| `@deepseek-ai/dsh-bash-local` | `packages/shell/bash-local/package.json` | `sha512-fl7gu1vDuYCLjPOPas+71kTSSiTpvldJ8+A5fdc/rkGyRdCOEOpXP+kjb1uF8u4ZRIiFjdoMKoR060ZFmpWOgA==` | 同上 |
| `@deepseek-ai/dsh-code-runtime` | `packages/code-runtime/code-runtime/package.json` | `sha512-KGUwcm4sSHjspQYr2Kj1DycaxnPzxg25sk3ychqbFG4cLcUA8W6eqQJEpEUgmnCOkDBx/j9oXvzNxp7XGMsRoQ==` | 同上；PTC 还需 tools/renderer 门 |
| `@deepseek-ai/dsh-compaction` | `packages/compaction/compaction/package.json` | `sha512-decsWxdQgJjsFRlJxiDJ30Tq/YkBV3B0fy8P6hThBefJAeDN47l2lvMSOsCa3IgrmiNaBawWxuOlTMDp6YyREQ==` | 同上；保留 Desktop 适配 |
| `@deepseek-ai/dsh-compaction-basic` | `packages/compaction/compaction-basic/package.json` | `sha512-8KcP5LUOScJPu7EyGSBkqmQzJew0Z0JKA7qrYpskRqqOPAElwlErXMjx3MBOrsPyuBzE+LtBixnhKkrXnKvZ6w==` | 同上 |
| `@deepseek-ai/dsh-fs` | `packages/fs/fs/package.json` | `sha512-wx5n0QS5rfZ2LPVocMNfuOUh0RYH/QuLoCEy+qI8U3nKmSZ8GSTASURLg+0pVxckHpLElo38U+S/lkLxRK1rpQ==` | 同上 |
| `@deepseek-ai/dsh-invariants` | `packages/runtime-diagnostics/invariants/package.json` | `sha512-1ewUeCzUHbaqhtW5rG1/eujIXXzy2VhwvMa16RpcTuJp5qcU1NtAf/+COkmvI7qtkyNY61vWg1Ez5qL9hKIUpQ==` | 同上 |
| `@deepseek-ai/dsh-output-retention` | `packages/util/output-retention/package.json` | `sha512-mKLCLsZKPJxwfma4AKl7KyfNUFVCmVovcbbdm3alxJqgU16PpkeK0rmJog6M34XJozQ8GAhdFf0TsDs3O6MoTA==` | 同上 |
| `@deepseek-ai/dsh-sandbox` | `packages/sandbox/sandbox/package.json` | `sha512-InfHYn5B0MxF5QLz0AjbwPS5W0G9VtIvjEFl5o/049KzH6khGKhjqOAVZtu1Z46f1+K/dbjF50VkTdnX3pgIJA==` | 同上；安全补丁需逐项重证 |
| `@deepseek-ai/dsh-scope` | `packages/core/scope/package.json` | `sha512-jeWfQnftQeZOWujxndgU6kjoFuXGWqmFrkWAxlWmyeojK/iyZqAxayWPuhVUEgweh4EWJmn6rW5HV3E4DXWuWw==` | 同上 |
| `@deepseek-ai/dsh-session-telemetry` | `packages/session/session-telemetry/package.json` | `sha512-Sfa2LeZDnXXIY4WytEcgAafbFIms3gBWVCPRXfDCeHL77baJhf7a5R0j64YDjrHqoMKqk6jkI7GwRvMpipUcBA==` | 同上；投影 schema 需迁移 |
| `@deepseek-ai/dsh-session-title-llm` | `packages/session/session-title-llm/package.json` | `sha512-g1AKWm1XSJjVRZCzUJq9ROGSbudEipf2XPtK7N4LcdntWTWLDxHg4ZKe8/B28bISPIvxbG7Fd3B/2aKczIz6Bg==` | 同上 |
| `@deepseek-ai/dsh-shell` | `packages/shell/shell/package.json` | `sha512-i16e+OrCJ7GZ1XDnPds081NgVs/xzIVMLECzmLnXgVDKeePgWpdEgR//PgMqKPwoBoJ8z7DTzwKiOISAtOpNzA==` | 同上 |
| `@deepseek-ai/dsh-spill` | `packages/spill/spill/package.json` | `sha512-BemtJNMbbaOENMa8oKVhp55AU+6QJUHqfHdIhNPGAhZe3DFe15cXnyEg97q4fzWZk7dxUyFuJiO1ERoCHGj11g==` | 同上 |
| `@deepseek-ai/dsh-subagent-in-process-driver` | `packages/subagent/subagent-in-process-driver/package.json` | `sha512-zCNMh2KLkS9FlFLontj0VKk9KUvIZDSkRQIwV2mXWka5K123vE2K1Z70dfLfK4bVQoCTCg+TjWOERaJJZSfYQw==` | 同上；保留 Desktop route policy |
| `@deepseek-ai/dsh-subprocess` | `packages/subprocess/subprocess/package.json` | `sha512-MOktcCP6IeTLTGKvF6+0ooE+4++ODhgqawizXsq7w6SNcPb5SbdB2+k6+3FZypjnIMWw+FESaH19/2PmGi6XSQ==` | 同上 |
| `@deepseek-ai/dsh-timeout` | `packages/util/timeout/package.json` | `sha512-8q5cd55aMoOvrPaqSws/3xiyzHhs1bfjdtAs4YHWimQgMd+yMrDnlu8i+zFOkWoSc0A2wPkXcCYR8xogl4gerA==` | 同上 |
| `@deepseek-ai/dsh-workflow` | `packages/workflow/workflow/package.json` | `sha512-U2nGVCOZ3hGoPP6XtPWUFL++l6K8S7XRQV2hvFrSQ4WBGbwdkY6h1cyzGvJXzae1s3AbAu5tdt//AIBNHOtYaA==` | 同上 |

非 DSH 直接依赖 `@deepseek-ai/cordis-plugin-group` 当前固定 `1.0.1`；其 registry 没有 `0.1.2-alpha.2`，因为它不属于 DSH 同版本工作区。不要把名称前缀相同误当成 alpha.2 候选，也不要顺手升级到 registry `latest=1.0.2`。

## 4. 当前本地现实与制品缺口

Fresh-read 的 `package.json` 与根 lock entry 都精确固定上述 20 个包为 `0.1.1-rc.2`。lock 中的官方包主要从 `registry.npmmirror.com` 解析；新审计证据来自 canonical `registry.npmjs.org`，后续重锁必须记录最终 registry 与 integrity，不能混用旧 resolved URL 作为 alpha.2 证明。

`postinstall` 为：

```text
node scripts/patch-official-runtime.mjs && electron-builder install-app-deps
```

补丁编排器 fresh-read 到 26 个官方目标，随后还对整个 `node_modules` 执行 Codex parity 补丁。npm 结果如下：

### 4.1 未发布/不对应，必须先改编排器

旧包状态复核时间：`2026-08-30T16:10:13.1889507Z`。这里的 alpha.2 选择值明确为 `null`，不是有意回退选择 rc.2；`0.1.1-rc.2` 仅描述当前本地 lock 与 registry 上仍可下载的历史制品。

| rc.2 补丁目标 | alpha.2 选择 | 当前 lock / 历史 tarball | 新架构对应与判定 |
|---|---|---|---|
| `@deepseek-ai/dsh-client-runtime` | `selectedVersion=null`；无 alpha.2 manifest/`alpha` tag，且 1,135 条闭包记录中无父 range 指向它；[packument](https://registry.npmjs.org/%40deepseek-ai%2Fdsh-client-runtime) | `0.1.1-rc.2`；integrity `sha512-o1FH7Rlns0Xaxh4SBOWZ1wpa0ViGw6DXWNm5NFpsBTGYD94RGdIrud3QxgrfzmQKLzu33gvS8JL/IjqbzWyYsg==`；[tarball](https://registry.npmjs.org/@deepseek-ai/dsh-client-runtime/-/dsh-client-runtime-0.1.1-rc.2.tgz) | client connection/modules/UI + Remote/Session Controller/Projection 拆分；删除旧文件读取入口，把必要 Desktop 行为迁公开 seam，禁止猜测新文件名 |
| `@deepseek-ai/dsh-host-apiproxy` | `selectedVersion=null`；无 alpha.2 manifest/`alpha` tag，且 1,135 条闭包记录中无父 range 指向它；[packument](https://registry.npmjs.org/%40deepseek-ai%2Fdsh-host-apiproxy) | `0.1.1-rc.2`；integrity `sha512-dplRnGGXXsQYFQ1KMHymAM0iaxuE9Z153JHYcGEgOwXNkS3HA20gSi3yMt6fz+zi/cMHYXvY1JQhS54BTc761A==`；[tarball](https://registry.npmjs.org/@deepseek-ai/dsh-host-apiproxy/-/dsh-host-apiproxy-0.1.1-rc.2.tgz) | `dsh-api-gateway`、`dsh-api-remotes`、`dsh-api-session-controller` 等替代；退役 ApiProxy 私有 bundle 补丁并按 descriptor/event/baseline 建 adapter |

这两个缺失项使当前产品 postinstall 对 alpha.2 **必然不闭环**。直接 alpha.2 tarball 没有 workspace 未重写、rc.2 fallback 或其他不可解 DSH range；旧包消失是架构性移除，不是 npm resolver 选择了历史版本。官方新闭包包含 Remote/Session 包并不自动证明旧补丁语义已覆盖。

### 4.2 有 alpha.2 tarball，但补丁仍需逐个 rebase/retire 证明

以下 24 个当前目标均有 `0.1.2-alpha.2` npm tarball：

`dsh-host-directory-picker-native`、`dsh-client-ui-conversation`、`dsh-client-ui-attachment`、`dsh-client-ui-tool`、`dsh-token-meter`、`dsh-client-ui-subagent`、`dsh-sandbox`、`dsh-pwsh-local`、`dsh-tool-pwsh`、`dsh-pwsh-sandbox`、`dsh-bash-sandbox`、`dsh-sandbox-windows-acl`、`dsh-client-ui-model-selection`、`dsh-client-ui-settings-models`、`dsh-llm-deepseek`、`dsh-client-ui-workspace`、`dsh-session-persistence-jsonl`、`dsh-agent-loop`、`dsh-subagent`、`dsh-tool-fs-search`、`dsh-tool-fs`、`dsh-subprocess-local`、`dsh-web-app`、`dsh-base`。

“有 tarball”只授权读取/差分，不授权把 rc.2 字符串锚点直接应用到 alpha.2 bundle。分类边界：

- **优先迁到官方 seam 后评估退役**：conversation/work-tree、attachment/tool-result image、token projection、subagent lifecycle/history、session persistence/list metadata。alpha.2 已改变 history/control/projection、attachment 与 subagent contract，旧私有锚点不能继续作为产品 API。
- **Desktop/Windows 特有，原则上保留行为但重写锚点/适配**：原生目录选择器、PowerShell/bash sandbox 错误分类、Windows ACL、隐藏子进程/browser launcher、模型凭据验证、workspace menu。
- **安全补丁不得因上游版本变新而静默删除**：never-policy escalation guard、ACL token/default DACL intersection、confined nested-pipe classification、credential secret handling。只有 alpha.2 源码与负向测试逐项证明上游已等价时才能退役。
- **Codex parity** 是跨包修改，必须列出实际触达文件并在新闭包重新审计；不能继续把 `node_modules` 目录级调用视为稳定契约。

## 5. 关键 breaking changes 与能力判定

这些结论沿用已验收的 `OFFICIAL-CORE-COMPATIBILITY-AUDIT.zh-CN.md`、依赖图、adapter integration 与 final acceptance，并在本次制品事实上重新收口：

| 能力 | alpha.2 制品/源码事实 | 迁移判定 |
|---|---|---|
| Remote | `dsh-api-remotes`/Gateway/Session Controller 在 215 包闭包中；旧 `host-apiproxy` 不在 | breaking；按 namespace/method/failure/event/recovery 适配，普通 event 不 replay |
| Session Projection | history、process-local control baseline、log-derived projection 分层 | breaking；work-tree/jobs/token 分别绑定正确 seam |
| browser auth | process launch token 一次交换为 authority-bound 签名 cookie | 可采用，但 Electron 只安全传 URL；不得记录/持久 query token |
| PTC / `run_code` | code runtime、tool/SDK 相关包在闭包中 | 适配；先 `both`，pure 模式拒绝原生直呼，所有 binding 仍过 guard/pipeline |
| subagent route | provider/model/reasoning opt-in、capability/allowlist | 适配；保留 Desktop main/subagent tier 策略，ACP/Codex/Claude Code 不得静默接受不支持的 agentOptions |
| ACP / SDK | `dsh-acp*`、`dsh-sdk*` 在正式 npm 闭包 | 附加 automation 入口；不等价于 Desktop UI、Windows Host bridge 或 Project/Team authority |
| compaction | overflow retry、pruner、surface generation 与窗口策略 | schema/event/UI 适配；不能只 bump 包 |
| token | replay-aware session fold、context pressure/breakdown；图片取决于 adapter pricing | 投影与展示迁移；heuristic 不得标成计费值 |
| image attachment | 批量规范化/持久化后发布不可变 ref，读取校验与 route variant | 适配；保留 Codex bridge，但禁止持久化 browser/provider/host path 或 base64 |
| experimental Team | 源码实验、单进程共享 cwd、不进正式发布 | **保留自研 authoritative stores**；只可消费官方底层 Session/Subagent/Projection |

## 6. 精确迁移集合与禁止项

### 6.1 下一依赖迁移任务可修改的精确集合

只允许把第 3 节 20 个直接 `@deepseek-ai/dsh*` 依赖从 `0.1.1-rc.2` **一起**改为精确 `0.1.2-alpha.2`，并由同一次受控重锁解析官方闭包。不得使用 `^0.1.2-alpha.2`、`alpha`、`next` 或 `latest` 作为根 pin。

同一任务还必须：

1. 在安装/重锁前重写 `patch-official-runtime.mjs`，使两个消失包不再被读取；迁移行为必须指向已验证的公开 seam。
2. 对其余 24 个补丁目标逐项产出 `keep/rebased/upstream-equivalent-retired` receipt；未知一律 keep-blocked，不得跳过。
3. 保持 `@deepseek-ai/cordis-plugin-group@1.0.1`、Electron `43.2.0` 和所有非审计依赖不变，除非另有独立证据任务。
4. 对新 lock 验证每个 `@deepseek-ai/dsh*` 解析版本、registry URL、integrity、重复版本、peer/optional/native 闭包；不接受仅 `npm install` 成功。
5. 保持 custom official-core provider 为唯一 primary；alpha.2 包存在不把 `runtimeEquivalent` 自动变为 true。

### 6.2 明确禁止

- 禁止单独升级 `@deepseek-ai/dsh` 而保留其余 19 个根 pin 为 rc.2。
- 禁止从 Git tag、workspace package 名或 `alpha` dist-tag推断本机 runtime 等价。
- 禁止因 `dsh-api-remotes` 已发布就机械重命名 ApiProxy 调用。
- 禁止官方 experimental Team 替换自研 Agent Teams，禁止 task/team schema 双写。
- 禁止在无 alpha.2 tarball 的 `dsh-client-runtime`/`dsh-host-apiproxy` 上保留“文件可能仍存在”的容错猜测。
- 禁止把未来网络 dist-tag 漂移当作产品测试失败；网络事实只由本报告和离线合同常量冻结。

## 7. MIT 与通知条件

维护树 `THIRD_PARTY_NOTICES.md` 已保留：DeepSeek Harness 来源、MIT、`Copyright (c) 2026 DeepSeek` 以及再分发 pinned runtime 时保留通知的条件。本次没有复制或 vendoring alpha.2 源码，只记录 URL、hash、package metadata，因此无需新增 vendored-source notice。

后续如果复制或实质移植 alpha.2 源码/README/测试片段，必须在相应源码或第三方通知中保留完整 MIT copyright/license；如果仅升级 npm tarball，仍必须保留现有 DeepSeek notice，并保证发布包中的第三方通知不被 electron-builder files 过滤掉。

## 8. 离线 availability contract

机器可执行合同：

```text
node --test tests/official-alpha2-runtime-contract.test.cjs
```

该测试不联网、不安装、不读取未来 dist-tag。它冻结：

- GitHub tag/commit/tree/source hash/release asset count/观测时间；
- 20 个直接包的精确 workspace 与 `dist.integrity`；
- 215/215 registry 闭包的观测结果；
- 两个未发布旧 patch target；
- Node/pnpm 与“无 Electron contract”的边界；
- 本地 package/lock 仍为 rc.2、postinstall 仍存在、26 个 patch target 与 Codex parity 调用；
- DeepSeek MIT notice。

因此未来 registry 漂移不会让产品 CI 随机失败；需要更新网络事实时必须重新执行独立审计并显式更新报告与常量。合同只证明“审计事实和本地迁移前提未被悄悄改写”，不证明 alpha.2 已集成或运行兼容。

## 9. 后续实施门

1. **依赖/补丁门**：20 根包原子重锁；两个消失 target 已迁 seam；24 个补丁逐项 receipt；新 lock 闭包无 rc.2 混入。
2. **协议门**：Remote descriptor/event/baseline、history/control/projection gap/reconnect、browser token/cookie。
3. **能力门**：PTC native/ptc/both、subagent route、ACP/SDK isolation、compaction/token/image联合管线。
4. **安全门**：sandbox/ACL/PowerShell/credential/attachment corruption 全部负向测试；unknown effect 不自动 retry。
5. **自研不降级门**：custom Agent Teams、Project Task schema v12、lane/lease/effect/recovery/cursor/claim_next 继续 authoritative。
6. **平台门**：Node 范围、Electron 43.2.0、原生 ABI、Windows/macOS packaged self-test 分开证明。
7. **发布门**：本审计不授权打包/发布；正式发布仍走仓库唯一 resumable publisher。

任一门缺失时，`official` provider 仍不得成为 primary，迁移任务必须 fail closed。
