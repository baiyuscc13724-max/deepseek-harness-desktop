# 官方 PR 快速预览：云端构建、签名与 CNB 镜像契约

> 状态：客户端、可信 workflow 与 CNB pipeline 已实现，但生产通道默认不启用。本变更没有运行或派发 workflow，没有发布、推送 Tag、上传资产，也没有读取任何真实密钥。

## 目标与边界

该通道让维护者批准官方仓库中的某个精确 PR head 后，向已主动加入预览通道的客户端提供 `desktop-shell` 组件。它不接受用户输入的仓库、PR、URL 或 Token，也不替代稳定发布器。

安全边界分成四段，候选签名与对外提升严格分离：

1. **无密钥构建**：`.github/workflows/pr-preview-build.yml` 仅响应 `pull_request`，且 job 只在 `head.repo.full_name == github.repository`、`fork == false` 时运行。在 checkout PR 之前，它先以 GitHub API 只读取得最新 published、non-prerelease 的官方稳定 `vX.Y.Z`；之后才以只读权限、无持久化 checkout 凭据检出事件中的 40 位 head SHA。`npm ci` 禁用 lifecycle scripts。组件版本固定为稳定基线的 next patch 加 workflow sequence/attempt，例如 PR 的 `package.json=1.0.40`、官方稳定版 `v1.0.44` 时仍生成 `1.0.45-pr.<sequence>.<attempt>`。PR 自报 package 版本不参与版本基线。输出只是 ZIP 和 `pr-preview-build.json`，不签名、不发布。
2. **受保护候选签名**：`.github/workflows/pr-preview-sign.yml` 只能人工 `workflow_dispatch`，必须从仓库 default branch 发起，并进入受保护的 `pr-preview-signing` Environment。签名 job 检出的始终是 dispatch 的可信默认分支提交，而不是 PR 提交；它独立再次查询同一个 GitHub latest stable 基线。下载物只作为有大小上限的字节和 ZIP 元数据读取，绝不执行其中的脚本、二进制或 lifecycle hook。该阶段只发布四项不可变 GitHub prerelease 候选并保存恢复 artifact，绝不推 CNB handoff、绝不写 `latest`，也不持有 `CNB_PR_PREVIEW_PUSH_TOKEN`。
3. **本机真实 gate**：维护者在隔离 profile 上使用上述精确 immutable Tag、head、sequence 和组件 SHA-256 完成真实暂存、helper 切换、`--component-health-check`、正常重启、退出预览、恢复稳定 pointer 和再次健康检查，并验证失败候选回滚。证据 JSON 必须绑定 `schemaVersion: 1`、`result: passed`、候选 tag/head/sequence/component SHA、baseline/activated/restored release、`healthy`/`rollback` 两项 passed、`createdAt`；dispatch 另传该文件精确 SHA-256，任一字段或字节变化都失败关闭。
4. **受保护证据提升与云到云镜像**：`.github/workflows/pr-preview-promote.yml` 使用完全独立的 `pr-preview-promotion` Environment。它重新下载精确签名 run 的恢复 artifact 和 immutable GitHub release 全部四项资产，重新验证生产公钥签名、expiry、PR 仍 open/non-draft/head 未变、全部 digest、本机证据 SHA-256 和双源单调 sequence；全部通过后才生成 evidence-bound `cnb-mirror-request.json`，并通过专用 `CNB_PR_PREVIEW_PUSH_TOKEN` 向 CNB 固定 `pr-preview` 分支交接白名单元数据。CNB 随后直接从 GitHub 下载二进制；只有全部 size/SHA-256 与回读一致后才可原子提升签名 `latest`。

预览私钥必须是独立 Ed25519 密钥 `HARNESS_PR_PREVIEW_SIGNING_PRIVATE_KEY_BASE64`，其 `keyId` 为 `harness-preview-v1`。它与稳定组件私钥 `HARNESS_COMPONENT_SIGNING_PRIVATE_KEY_BASE64` 完全隔离；预览公钥也应由客户端独立、固定地信任。任何一把密钥都不能进入仓库、artifact、日志或 CNB 请求。

## 精确身份绑定

构建信封固定包含：

- 官方 `repository` 与相同的 `headRepository`；
- `fork: false`；
- PR 编号与完整 40 位 `headSha`；
- 固定 workflow 路径 `.github/workflows/pr-preview-build.yml`；
- 精确 artifact 名 `pr-preview-unsigned-<pr>-<40位sha>`；
- 官方稳定基线、workflow sequence/attempt、预览版本；
- 组件名称、size、unpackedSize、SHA-256 和 ZIP component index version。

签名前，可信脚本通过 GitHub API 重新验证 run、当前 PR 与 latest stable release：仓库、head 仓库、事件类型、workflow 路径、完成状态、成功结论、PR 关联、run id、head SHA、`baseRef=main`、仍开放且非 draft/未合并状态、标题、作者、稳定基线、run/sequence/attempt 必须全部精确匹配。`title` 必须为 1–200 个 Unicode 字符、最多 512 UTF-8 字节且无控制符；`author` 必须是有效 GitHub login。artifact 名必须唯一且未过期。下载后再次计算 ZIP 的完整 size/SHA-256，并通过安全 ZIP 元数据读取唯一 `component.json`（最多 256 KiB）和唯一根级 `pr-preview-update-sources.json`（最多 128 KiB；整个 ZIP 最多 256 MiB、最多 20,002 个条目），校验前者的 id/target/version 与稳定 next-patch 版本、构建报告和即将签名的 descriptor 完全一致，后者则必须与受信任默认分支逐字节相同、已启用且其当前 keyId 公钥必须精确对应正在使用的签名私钥；不解压或执行负载。任一字段不一致即失败关闭，PR 代码不能替换自己的后续信任根。

当前初始合同只构建 `win32-x64` 的无原生 `desktop-shell` 预览组件。增加 macOS 目标时必须为每个目标保持相同的 run/head/artifact/hash 绑定，不得把 Windows 描述符复用为 macOS 描述符。

## 签名输出

可信签名脚本生成候选材料；签名 workflow 删除尚未经过本机 gate 的临时镜像请求，只发布并保留以下不可变候选：

- 不可变组件 ZIP，以及使用现有组件协议、`channel: prerelease`、同一预览 `keyId` 签名的 `componentManifest`；
- `pr-preview-manifest-<40位headSha>.json`：`kind: pr-preview-manifest` 的签名 wrapper，绑定 `prNumber`、`title`、`author`、`baseRef=main`、完整 head SHA、sequence、统一过期时间和 `componentManifest`；
- `pr-preview-index-<40位headSha>.json`：`kind: pr-preview-index` 的签名索引，与 wrapper 的身份字段严格一致，并按 CNB→GitHub 顺序绑定未来提升后的固定 raw-main manifest 路径；
- `pr-preview-signing-audit.json`：独立审计产物，保存 build run id、run attempt、artifact 和 immutable Tag；这些字段不进入严格 index/wrapper。

只有 promotion workflow 重新验证这四项不可变字节和本机证据后，才重新生成 `cnb-mirror-request.json`。该请求额外携带 `localGateEvidence` 的候选身份、baseline/activated/restored release、healthy/rollback 结果、createdAt 和精确 evidence SHA-256；它只描述云到云复制、逐资产验证、CNB 回读和提升前置条件，不包含执行网络请求或提升指针的代码。

不可变 Tag 为 `pr-preview-<pr>-<sha12>-run-<runId>-<attempt>`；签名 job 还会从 GitHub 解析该 Tag 并确认它仍精确指向完整 head SHA。把 run id/attempt 纳入 Tag 可防止同一 head 的独立重建互相覆盖。签名 feed 的单调 `sequence` 使用 `workflow run number × 1,000,000 + run attempt`，因此同一 run 的重新执行也是严格更新的候选，不会与前一次 attempt 共享 sequence；下一个 run 又始终大于前一个 run 的任一受支持 attempt。GitHub 资产上传禁止 `--clobber`：重试时已存在资产必须同时匹配 size 和 GitHub `sha256:` digest，否则整个操作失败。签名 job 只建立不可变版本，不生成或替换 latest 指针。

每个组件必须恰好有两个 URL，顺序与身份固定为：

1. `https://cnb.cool/baiyuscc13724-max/deepseek-harness-desktop/-/releases/download/<immutableTag>/<assetName>`
2. `https://github.com/baiyuscc13724-max/deepseek-harness-desktop/releases/download/<immutableTag>/<assetName>`

两项解码后的 `<immutableTag>/<assetName>` 必须完全一致；Tag 必须匹配 `pr-preview-<prNumber>-<sha12>-run-<runId>-<attempt>`。索引中的 manifest URL 同样固定为 CNB raw main 首位、GitHub raw main 次位。因此客户端优先 CNB，连接或下载失败后才尝试同一签名对象中已绑定哈希的 GitHub 后备 URL。HTTPS 只负责传输，身份仍由固定预览公钥、签名、官方仓库约束和 SHA-256 共同确认。

## GitHub Actions 到 CNB 的元数据交接

签名 job 与 CNB 完全隔离：`pr-preview-signing` Environment 只提供独立预览签名私钥，不配置、不引用也不继承任何 CNB Token。只有独立的 `pr-preview-promotion` Environment 在 required reviewer 核对本机 gate 证据摘要后，才向 promotion job 暴露专用 Secret `CNB_PR_PREVIEW_PUSH_TOKEN`；缺失、空值或包含换行时立即失败关闭。CNB 官方 HTTPS Git 认证约定为固定用户名 `cnb`、访问令牌作为密码（参见 [Git 地址与认证说明](https://docs.cnb.cool/zh/guide/git-access.html) 与 [访问令牌](https://docs.cnb.cool/zh/guide/access-token.html)）；workflow 因此通过临时 `GIT_CONFIG_*` 注入内存 credential helper，先清空继承的 helper，再只在 Git 的 `get` 凭据调用中返回 `username=cnb` 和环境中的 Token。固定远端 URL 本身不含凭据；workflow 不把 Token 写入 remote URL、Git config 文件、提交、普通文件或日志，并禁用 Git trace、curl verbose 与交互式凭据提示。

promotion dispatch 必须精确输入 sign run id、PR、40 位 head、immutable Tag、sequence、四项候选 digest JSON、Base64 evidence bytes 及其 SHA-256。受信任默认分支脚本重新下载成功签名 run 的唯一未过期恢复 artifact 和 Tag 下四项公开资产，要求两组字节集合完全相同；同时重新查询 PR 与当前 CNB/GitHub index。PR 已关闭、变为 draft、已合并、head 改变、签名 run 非默认分支成功 run、签名/expiry 无效、sequence 回退或同序列不同候选时均不得交接。

promotion GitHub Runner 在 `$RUNNER_TEMP` 建立孤儿元数据提交，用实际文件列表和 staged 文件列表两次逐字比对白名单。提交只能包含：

- `.cnb.yml` 与触发标记 `.cnb-pr-preview-request`；
- `cnb-mirror-request.json`；
- 签名 `component-feeds/pr-preview/latest.json` 与当前完整 head SHA 的 manifest wrapper；
- `scripts/pr-preview-verify-feed.mjs`；
- `electron/bridge/pr-preview-update-contract.cjs`、`pr-preview-update-config.cjs`、`component-update-contract.cjs`；
- `pr-preview-update-sources.json`。

ZIP、PEM、私钥、签名私钥路径、组件二进制和其他工作树文件均禁止进入提交。推送目标固定为 CNB 官方仓库 `refs/heads/pr-preview`，该分支配置为禁止 force push。promotion job 先读取远端精确最新 OID；若分支已存在，就 fetch 同一 OID、验证父树仍是精确 allowlist，以该 OID 为唯一父提交只替换 allowlist 文件，再次确认远端 OID 未变后执行普通 non-force push。若分支尚不存在，则创建无父提交的精确 allowlist 根提交并普通首次推送。任何 fetch 前后或 push 前后的并发变化都会因显式 OID 比对或 non-fast-forward 被拒绝，绝不使用 `--force`、`--force-with-lease`。CNB 侧必须把该分支保护为仅允许这一个受保护 Environment 的部署身份普通更新；普通协作者不能通过另一个分支替换带 Secret 的 CI 代码。该推送只中转少量元数据；组件 ZIP 始终由 CNB 从签名请求绑定的 GitHub release URL 云到云完整下载。

CNB pipeline 提升前必须运行随提交携带的 `pr-preview-verify-feed.mjs`，用 `pr-preview-update-sources.json` 中的生产预览公钥重验 index/wrapper/component manifest。配置仍为 `enabled:false`、`trustedKeys` 为空或 keyId 不匹配时必须正确失败关闭，不能把“尚未配置”当作验证通过。正式启用时只能通过受信任的稳定 `desktop-shell` 交付把该文件改为 `enabled:true` 并写入公开 Ed25519 公钥；不得生成、复制或落盘生产私钥。

## CNB 完整验证与提升规则

`cnb-mirror-request.json` 的关键不变量为：

```json
{
  "source": { "provider": "github-release", "cloudToCloudOnly": true },
  "verification": {
    "downloadEveryAssetCompletely": true,
    "requireExactSize": true,
    "requireSha256": true,
    "rejectPartialOrExtraAssets": true,
    "readBackFromCnbBeforePromotion": true
  },
  "promotion": {
    "manifestPath": "component-feeds/pr-preview/manifests/<40位headSha>.json",
    "latestPath": "component-feeds/pr-preview/latest.json",
    "allowedOnlyAfterEveryAssetVerified": true,
    "atomic": true,
    "sourcePriority": ["cnb", "github"]
  }
}
```

CNB pipeline 的实现必须遵守以下顺序：

1. 从不可变 GitHub release URL 下载请求列出的**全部**资产；不能读取开发者机器上的文件。
2. 等待响应体完整结束，对实际字节数和 SHA-256 逐项复核；部分下载、超时、非 HTTPS 重定向或任一不匹配均失败。
3. 把相同不可变资产写入 CNB release，确认 release 不多不少只有请求列出的资产，再从 CNB 完整回读一次并复核 size/SHA-256。
4. 验证 `pr-preview-manifest` wrapper 和 `pr-preview-index` 的独立 canonicalJson/Ed25519 签名、最长 7 天且一致的过期时间、官方仓库、PR 元数据、head 绑定和单调 `sequence`；wrapper 发布时间不得早于 index。
5. 仅当上述所有检查成功，用一个 CNB Git commit 同时写入固定 SHA manifest 与签名 `component-feeds/pr-preview/latest.json`，再回读 CNB raw-main 并逐字节确认；不得先提升再补资产。
6. CNB 提升并回读成功后，再用 GitHub Git Data API 的一个非 force commit 同时提升同一份 manifest/latest，作为境外后备；任何已有 CNB 或 GitHub sequence 更高、同 sequence 不同 head 的情况都拒绝回退。
7. 失败时保持尚未提升的一侧旧 latest 不动；不可变 GitHub assets 可供重试恢复，不允许复用同版本不同哈希或回退到未签名索引。

`.cnb.yml` 已增加完全独立的固定 `pr-preview` 分支 pipeline，现有 `main` 稳定同步与 release asset 路径由 `.cnb-stable-only` / `.cnb-preview-feed-only` 标记隔离。CNB 生产凭据由固定受保护密钥仓库通过 pipeline `imports` 注入，主仓库不得提交密钥值；其中专用 `GITHUB_PR_PREVIEW_FEED_TOKEN` 只授予最小 Contents-write 的固定 GitHub App/机器人身份，GitHub main 分支也只授权该身份，pipeline 本身只构造两个精确 feed 路径的 non-force 原子 commit。该 Secret 与短期 `CNB_TOKEN` 在任何资产下载前缺失即失败。两种 Token 都不会进入客户端、URL、Git 提交或产物。未来稳定 CNB 同步会保留已经提升的两个 PR preview feed 文件，不能把预览指针从 CNB main 清掉。

## 既有安装迁移、确认与中断恢复

- 更新器全部位于既有 `desktop-shell` 组件边界（`electron/`、`renderer/`、`plugins/` 和公开 sources 配置），不修改安装器、bootstrap 或原生运行时。已经安装 v1.0.26+ 组件更新框架的用户，可在后续一次合法的签名稳定 `desktop-shell` 更新中获得本更新器，无需重装；旧界面仍可能要求完成那一次既有稳定更新确认，不能把它误称为追溯式静默升级。预览 ZIP 也必须携带与可信默认分支逐字节相同的公开 sources 配置，因此切换到预览 shell 后不会丢失退出入口或信任根。
- 客户端不提供 PR 编号、仓库、URL 或 Token 输入。用户只选择是否加入预览；自动发现到签名候选后，展示 PR/作者/完整 head/source，再由用户点击“立即更新”。
- staging 成功后才持久化 accepted sequence。应用前单独保存稳定组件 pointer、签名候选身份与目标版本；若下载完成后进程重启或 helper 启动中断，下次启动会恢复同一候选并允许一键继续，不会重复 staging 或丢失退出入口。
- “退出预览”会先停止发现；若预览尚未激活则取消 pending，若已激活则恢复保存的稳定 pointer 并重启。原有 helper 健康确认、last-known-good 与失败回滚继续生效。

## 审批与回滚

- 每个新 head SHA 都需要新的成功构建 run 和人工受保护 dispatch；审批旧 SHA 不能覆盖新提交。
- Environment 审批者只审查 PR、完整 SHA、run id 和检查结果，不接触私钥。
- 预览索引与 wrapper 使用完全一致、最长 7 天的 `expiresAt`；客户端拒绝过期、未知 keyId、签名错误、非官方仓库、身份字段不一致、sequence 回退或同版本不同哈希。
- 退出预览不仅停止发现；客户端必须通过既有签名稳定组件基线执行可恢复切换，在下次正常重启和健康检查后恢复 stable，失败则回滚 last-known-good。不得把仍活动的预览组件误报为已退出。
- 预览失败不得自动进入 stable。稳定组件仍只能走仓库规定的 `release:publish` 原子发布路径。

## 本地合同测试

以下命令只读取 workflow 并在系统临时目录中用一次性测试密钥验证脚本，不访问 GitHub/CNB、不发布、不推送：

```text
node --test tests/pr-preview-workflow.test.cjs tests/pr-preview-cnb-pipeline.test.cjs tests/pr-preview-migration.test.cjs
```

测试覆盖同仓库/非 fork、精确 head SHA、默认分支受保护签名、独立密钥、run/artifact/hash 校验、CNB 优先/GitHub 后备、既有安装迁移/中断恢复，以及“全部 size/SHA 验证并回读后才能提升 latest”的失败关闭条件。
