# 官方 alpha.2 最终发布树隔离终验：Phase A 合约

> Durable task：`f1d7d865-9e41-429c-b6bf-82ccb971e370`  
> 维护树：`D:\DeepSeek-Harness-Desktop\release-v1.0.28-worktree`  
> 当前阶段：**Phase A / CONTRACT ONLY**  
> 当前判定：**v1.0.55 已将本合同及其 hash-bound 输入绑定到当前源码；仍等待 Root 对一个全新、未使用 run root 的精确 ACK。尚未执行 helper、npm 安装或终验矩阵，因此本文不声明动态门禁通过。**

## 1. 两阶段控制与禁区

本任务只拥有并只允许修改：

- `tests/helpers/official-followup-hermetic.cjs`
- `tests/official-followup-hermetic-acceptance.test.cjs`
- `docs/OFFICIAL-FOLLOWUP-HERMETIC-ACCEPTANCE.zh-CN.md`

Phase A 只审查并冻结合同。此阶段不得执行 helper、不得运行 `npm ci`、不得创建新 run/cache root，也不得读取任何已拒绝 root 的 cache 或 dependencies。只有 Root 发出 `ACK <exact root>` 后，Phase B 才可在该精确 root 执行一次；主 cache 与第二安装 cache 必须最初为空、路径不同，运行必须持续监控且不得重启。

永久拒绝 `160456`、`162000`、`164000`、`165000`、`170000` 以及所有更早/既有 run roots。helper 对上述 token 和任何已经存在的 run root fail closed。旧 `T1708Z`、`T1712Z`、`T1730Z` 及既有 candidate/snapshot/cache 仅是失败或历史记录，绝不进入最终证据。

本任务不会修改产品文件、维护 `node_modules`、GUI、安装器、Git、package/lock、提交、推送、发布或任何外部状态。

## 2. 两套 npm 证据必须严格分离

### 2.1 当前 plain-Windows fresh-install 假设

当前候选值只是待复验假设：

| tree SHA-256 | files | bytes | npm ls 合同 |
|---|---:|---:|---|
| `B3D892DCB6CD2CC8D5BA062F544C66EBE1336BFD9AD9961408D80D6DA6104991` | 42,855 | 359,947,652 | exit 0 且 `problems` 精确为 0 |

该值在两次全新安装完成前不得称为 accepted baseline。Phase B 的第一次安装是 detached snapshot 自身使用主空 cache 的真实 `npm ci --ignore-scripts --no-audit --no-fund`；第二次安装在独立 `install-second` 和另一空 cache 再次运行同一命令。不得把复制第一份 `node_modules` 冒充第二次 fresh install。两棵树必须同时精确匹配新生成的 frozen path/hash manifest，且 tree digest、file count、total bytes 逐项相等。

### 2.2 已接受、hash-bound 的历史 audit oracle

历史 oracle 只读根固定为：

`D:\DeepSeek-Harness-Desktop\.alpha2-core-candidate\20260831-043306`

其接受值为：

| tree SHA-256 | files | bytes | npm ls 合同 |
|---|---:|---:|---|
| `17D85E217EC8FA2B73B5879C618BA4760A8233E6893252E3F88AF3A6C51A44E0` | 42,879 | 369,552,648 | exit 0，且恰好两条、顺序固定 |

唯一允许的有序 `problems` 是：

1. `extraneous: @emnapi/runtime@1.11.3 ...`
2. `extraneous: @img/sharp-wasm32@0.35.4 ...`

0 条、倒序、额外条目、错误版本、DSH drift、`invalid:` 或 peer drift 均拒绝。历史 oracle 的 `candidate-summary.json`、两份 hardened receipts、42,879 行 canonical manifest 以及两份 npm-ls JSON 均绑定精确 SHA-256；两份历史 install 必须逐路径/文件哈希匹配 frozen manifest。

两套 npm 合同使用不同 validator；不存在“接受 0 条或两条任一结果”的非确定性 validator。历史 audit 只作为 `read-only-accepted-historical-migration-overlay`，不得复制进 run、不得改变 digest-claimed snapshot。矩阵环境继续精确绑定：

- `DSH_ALPHA2_AUDIT_ROOT = acceptedMigration.auditRoot`
- `DSH_ALPHA2_CANDIDATE_ROOT = snapshotRoot`

## 3. 仍保持的 fail-closed 门禁

- accepted package/lock/patch/static gate/migration test 与三份发布文案全部精确 hash-bound；
- lock 为 20 roots、861 locations、216 DSH locations、215 unique names，wrong/resolved/integrity/removed/mixed drift 全为 0；
- source snapshot 无 `.git`、继承依赖、junction/symlink/reparse escape，canonical digest 使用 unsigned UTF-8 path bytes 排序和 `path\0decimal-size\0lowercase-file-sha256\n`；
- frozen manifest 对 UTF-8、unsafe path、重复、Unicode collision、乱序、增删改全部 fail closed；
- 维护 `node_modules` 固定为 `4DCDD25127B2024AEB9074826FF2D9EF0F53E5AFE350F337C462C58BA8E0FCB3` / 37,064 / 713,655,865，Phase B 前后完整逐行零漂移；
- patch 第一轮必须精确 25 files，第二轮必须 0 difference；
- accepted-audit root 必须在 source 与 run 之外，run 内 snapshot/evidence/cache/install/cache-second 两两不嵌套；
- README、CHANGELOG、release-notes 必须绑定 accepted hash，任何 rc.2、NO-GO 或旧计数命中只能是明确 `superseded-history`，未分类命中为 0。

## 4. Phase B 的八个独立零跳过组

最终矩阵固定为八个彼此独立的 Node 进程：

1. `submission`
2. `routing`
3. `canonical`
4. `official`
5. `surfaces`
6. `ui`
7. `resilience`
8. `performance`

矩阵覆盖 submission/acceptance、routing、multi-team/project/canonical、recovery/cursors/locks、official core/RPC/migration、mobile/pet、新 owner New Session、Settings/右侧工作区、UI/a11y/security/resilience/continuous、SessionManager 与 session-list 性能。每组必须 `exit 0`、`tests > 0`、`tests == pass` 且 fail/skip/todo/cancel 全为 0；receipt 必须记录 cwd、完整命令、duration、stdout/stderr SHA-256 与 `resourceUsage.maxRSS`。

## 5. Phase A 交付边界

本轮唯一允许执行的命令是：

```text
node --test tests/official-followup-hermetic-acceptance.test.cjs
```

精确 pass/fail/skip/todo/cancel 计数及 helper/test/doc SHA-256 由 durable checkpoint 记录。checkpoint 同时只提出一个全新、未使用 timestamp root；在 Root 返回精确 `ACK <root>` 前，任务保持 `in_progress`，不得开始 Phase B，也不得 durable complete。
