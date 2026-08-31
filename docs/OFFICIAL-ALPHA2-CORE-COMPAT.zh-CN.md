# 官方核心兼容升级：alpha.2 维护迁移检查点

> Durable task：`ad8619a9-5899-4454-8d2b-71aac489708b`  
> 官方目标：`0.1.2-alpha.2` / `dsh-v0.1.2-alpha.2` / `0a53fb55bea101816fa226bb964ae2bed71c343b`  
> 状态：**候选已获 ACK，维护 package/lock 已迁移；迁移后 closure 等待第二次 Root ACK，任务保持 in_progress**。

## 1. 维护迁移的授权来源

本次维护迁移只采用 Root 已 fresh-review 的候选事实：

- 两个独立 exact-lock installs 均为 42,879 files、369,552,648 bytes、tree `17D85E217EC8FA2B73B5879C618BA4760A8233E6893252E3F88AF3A6C51A44E0`；
- canonical manifest 按 whole-path unsigned UTF-8 `Buffer.compare` 排序，42,879 行、重复/坏行/顺序反转均为 0；
- patch 首次精确 25 files，第二次 byte-for-byte 0；
- core/UI/Remote、Project-Team、安全/隔离与 legacy composition 矩阵均通过；
- 维护 `node_modules` 在候选阶段保持零漂移。

候选 ACK 只授权维护迁移，不等于 durable task 完成。迁移后的 package/lock/docs/tests 与新第三安装仍必须第二次 Root fresh-review。

## 2. 执行时官方重查

在任何维护依赖编辑之前重新查询 GitHub release/tag/ref 与 20 个 npm packuments。结果：

- 最新 release/tag 仍是 `dsh-v0.1.2-alpha.2`；
- tag commit 仍是 `0a53fb55bea101816fa226bb964ae2bed71c343b`；
- newer release/tag/version 均为 0；
- 20 个 root 的目标 tarball、integrity 与 `alpha` dist-tag 均未漂移；
- requery receipt SHA-256：`0A2471086E163B5B621048046B0BCBE99666F841B943F357982DDBF2DF06B57D`。

若上述任一事实变化，迁移必须停止，不能复用本检查点。

## 3. 维护源最终图

当前维护源的权威依赖事实：

| 项目 | 接受值 |
|---|---|
| `package.json` SHA-256 | `8ABF8CB51875CDF8452A6686AAB87B25135E3B1DAECFEE54660D09A23E7BCCFB` |
| `package-lock.json` SHA-256 | `E61A561BACAEB2C6CAA52DF8132FD53962CFF407913A1A3C1C850D88AF928821` |
| direct DSH roots | 20，全部精确 `0.1.2-alpha.2` |
| lock locations | 861 |
| DSH locations / unique names | 216 / 215 |
| wrong / resolved / integrity / removed | 0 / 0 / 0 / 0 |
| Electron | `43.2.0` |
| `cordis-plugin-group` | `1.0.1` |

维护 migration contract 不再断言 rc.2/NO-GO package-lock 状态；它正向验证上述 exact package/lock/hash/graph，并对单根回退、lock-root 回退、selected version、resolved、integrity、removed package 与 seam evidence 漂移执行负向 fail closed。

## 4. Alpha.2 runtime 现实

alpha.2 移除了 `dsh-client-runtime` 与 `dsh-host-apiproxy`：

- Session Controller 和 native session-list owner 已由公开 alpha.2 artifact 证明；
- patch 编排器只在 alpha.2 分支执行新 owner patch/assertion；
- 仍需重基的 UI/runtime intents 保留精确 official-source hash、semantic anchors 和 patched-output hash；
- New Session 的 project/workspace authority、stale completion fencing、bounded hints、list baseline/journal/reconnect、descriptor/event allowlist 与 metadata non-authority 均由正负合同固定；
- custom Project/Team provider 继续 sole authoritative，official experimental Team 不接管或双写。

## 5. 新第三安装与 patch 证据

迁移后从维护 package/lock 创建全新 detached `install-third`。第三 cache 在 npm 启动前精确为空；维护 checkout 内未运行 npm install/ci：

- `npm ci --ignore-scripts` exit 0；
- `npm ls --all --json` exit 0、stderr 0 bytes；
- graph receipt `6D7CD4BE6FE7E15C659D5960C6EAF86715E1ADF1A63121F3BEE5DD179EC3B9AF`；
- raw tree 42,879 files / 369,552,648 bytes / `17D85E217EC8FA2B73B5879C618BA4760A8233E6893252E3F88AF3A6C51A44E0`；
- patch receipt `CAFB8825895B5477E24C8C5F0AC92255710CD6190DFE8DF1B9402FF3182014D0`：first exit 0 / 25 files / byte delta 24,816；second exit 0 / difference rows 0 / byte delta 0；
- patched workspace hash `B47D4AD32FF91ACDC7B27BE85AA184E4579B1973DF2DB04FB8E58A30590FDE0D`。

## 6. 完成条件

仍需同时满足：

1. 相关维护 source tests 使用显式分离的 `DSH_ALPHA2_AUDIT_ROOT` 与 `DSH_ALPHA2_CANDIDATE_ROOT` 全部通过；
2. 维护 `node_modules` 迁移前后按同一 canonical tree 算法精确零漂移；
3. maintained-migration closure 绑定 execution requery、package/lock/notice/docs/tests、第三 install/graph/patch 与 TAP hashes；
4. Root 对该 closure 第二次 fresh-review 并明确 ACK。

在第二次 ACK 前不得 durable complete；本任务没有操作 GUI、当前 runtime、安装包、构建、提交、推送或发布。
