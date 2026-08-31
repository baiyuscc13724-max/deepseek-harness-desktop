# 官方 alpha.2 运行时集成：维护迁移已落地，等待终审

> 维护树：`D:\DeepSeek-Harness-Desktop\release-v1.0.28-worktree`（产品 `1.0.54`）  
> 官方目标：`@deepseek-ai/dsh@0.1.2-alpha.2` / tag `dsh-v0.1.2-alpha.2` / commit `0a53fb55bea101816fa226bb964ae2bed71c343b`  
> 当前判定：**维护 package/lock 已迁移到经 ACK 的完整 alpha.2 图；等待迁移后第二次 Root fresh-review ACK**  
> 本文不授权 GUI、当前 runtime、安装包、Git 提交/推送或发布。

## 1. 执行时最新版本门

维护迁移前于 `2026-08-31T05:37:43.774Z` 重新查询官方 GitHub API 与 canonical registry `https://registry.npmjs.org`：

- 最新 release 仍为 `dsh-v0.1.2-alpha.2`（published `2026-08-30T13:52:14Z`），tag ref 仍精确解析到 commit `0a53fb55bea101816fa226bb964ae2bed71c343b`；
- 未发现高于 `0.1.2-alpha.2` 的 official release 或 tag；
- 20 个直接 DSH roots 均存在精确 `0.1.2-alpha.2`，`alpha` dist-tag、canonical tarball 与 integrity 全部和已接受 lock 一致；
- newer versions、wrong version、resolved drift、integrity drift 均为 0。

执行时查询 receipt SHA-256 为 `0A2471086E163B5B621048046B0BCBE99666F841B943F357982DDBF2DF06B57D`。该 receipt 是迁移审计证据，不冒充 shipped source；维护树的权威事实由当前 `package.json`、`package-lock.json`、补丁编排器和离线合同共同给出。

## 2. 已落地的维护依赖图

维护源现已原子采用经 Root ACK 的 alpha.2 图：

- `package.json` SHA-256：`8ABF8CB51875CDF8452A6686AAB87B25135E3B1DAECFEE54660D09A23E7BCCFB`；
- `package-lock.json` SHA-256：`E61A561BACAEB2C6CAA52DF8132FD53962CFF407913A1A3C1C850D88AF928821`；
- 20 个直接 `@deepseek-ai/dsh*` roots 全部精确为 `0.1.2-alpha.2`；
- lock 共 861 个 locations，其中 DSH locations 216、唯一 DSH package names 215；
- wrong version、非 canonical resolved、缺失/错误 integrity、removed package 均为 0；
- alpha.2 已移除 `@deepseek-ai/dsh-client-runtime` 与 `@deepseek-ai/dsh-host-apiproxy`，维护 lock 不再选择这两个包；
- `@deepseek-ai/cordis-plugin-group` 保持 `1.0.1`，Electron 保持 `43.2.0`。

这不是把候选目录当成产品：维护 package/lock 本身就是最终 shipped dependency contract。候选 receipts 只用于证明生成过程、独立安装与字节闭包。

## 3. 补丁与权威边界

`patch-official-runtime.mjs` 按已分类图 fail closed：

- alpha.2 使用 `patchInstalledAlpha2SessionController()` 与 `assertInstalledAlpha2NativeSessionList()`；
- rc.2 legacy helper 仍保留用于精确版本分支和漂移拒绝，但不会在 alpha.2 图上执行；
- workspace、conversation、tool、token、model、settings 等未被上游完整等价证明的 intent 继续按 exact version + original anchor + patched hash 重基；
- 首次真实 patch 必须精确改变 25 个文件；第二次必须 0 行差异、0 byte delta；
- workspace 已补丁产物 SHA-256 固定为 `B47D4AD32FF91ACDC7B27BE85AA184E4579B1973DF2DB04FB8E58A30590FDE0D`。

custom Project/Team provider、canonical project isolation、submission/acceptance ledger、routing receipts、recovery/cursor/lock/effect 继续唯一 authoritative。official experimental Team 不接管、不双写。Session metadata、cwd 字符串、projection value 或 forwarded event 均不得提升为 Project authority。

## 4. 第三份 detached 迁移后验证

维护树内没有运行 `npm install` 或 `npm ci`，也没有修改维护 `node_modules`。迁移后验证使用新的 detached `install-third`、新的最初为空的第三 npm cache 和独立进程：

- `npm ci --ignore-scripts` exit 0；
- `npm ls --all --json` exit 0，stderr 为空；
- graph receipt SHA-256 `6D7CD4BE6FE7E15C659D5960C6EAF86715E1ADF1A63121F3BEE5DD179EC3B9AF`，再次证明 861 / 216 / 215 与全部 drift counter 为 0；
- patch receipt SHA-256 `CAFB8825895B5477E24C8C5F0AC92255710CD6190DFE8DF1B9402FF3182014D0`：第一次 exit 0、精确 25 文件；第二次 exit 0、difference rows 0、byte delta 0；
- patch 前树为 42,879 files、369,552,648 bytes、canonical tree `17D85E217EC8FA2B73B5879C618BA4760A8233E6893252E3F88AF3A6C51A44E0`。

## 5. 许可证与发布边界

`THIRD_PARTY_NOTICES.md` 已明确记录 20 个 alpha.2 roots、官方 tag/commit、MIT License 与 source provenance。维护迁移没有运行 GUI、当前 runtime、安装包或发布流程。

只有迁移后 package/lock/notice/docs/tests、第三 detached install/patch、相关 TAP 和维护 `node_modules` 前后零漂移全部经 Root 第二次 fresh-review ACK 后，durable task 才能完成。本报告本身不授权发布；未来发布仍只能走仓库 resumable publisher。
