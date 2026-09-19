# 服务商凭据隔离修复：独立回归与安全证据

## 结论

本报告只覆盖认证隔离与请求一致性，不覆盖 `core-alpha15-upgrade-20260909`。验证使用合成 JWT、合成 API Key、临时凭据文件及本地 fake transport；没有读取真实 `.credentials.yaml` / `.codex/auth.json` 原文，没有调用真实账号或付费模型。

独立源码证据确认了一个可执行风险链，但**不能据此断言用户现场的历史写入者**：原生 Models UI 的 `refFor` 直接采纳 profile 的 `apiKeyEnv`，保存时先写 settings、再把输入值写进该全局 ref；`llm-pi-ai` 又按当前 profile 的同一 ref 解析请求凭据。因此，另一 provider 若共享 `OPENAI_CODEX_ACCESS_TOKEN`，普通 key 可进入 Codex 读取路径。合成无点 token 在未修原版稳定得到 `PI_AI_ERROR / Failed to extract accountId from token`。这证明代码路径可复现，不是对既往机器写入事件的取证。

## 工作区与基线

- 维护树：`D:\DeepSeek-Harness-Desktop\release-v1.0.28-worktree`
- 基线提交：`c13249132532d73f26fdd5830fe6a225b5f51feb`
- 开始时工作区已有大量其他任务 dirty 文件；未丢弃、覆盖、暂存或提交它们。
- 本任务新建文件在开始时不存在：
  - `tests/provider-credential-isolation-runtime.test.cjs`
  - `tests/fixtures/provider-credential-isolation-runtime.cjs`
  - `docs/PROVIDER-CREDENTIAL-ISOLATION-REPAIR.zh-CN.md`
- 本任务还按 v4 契约更新既有认证测试与 fixture；开始时它们不是 dirty：
  - `tests/model-settings-key-override.test.cjs`
  - `tests/model-settings-key-override-runtime.test.cjs`
  - `tests/fixtures/model-settings-key-override-runtime.cjs`
- 现场/维护树核对时，官方 alpha.5 runtime SHA-256：
  - settings UI：`7ACF9736EDEEA519C63791E946A135F5CC854C95C299FD9864E82074FCE587E5`
  - llm-pi-ai：`69C387A2F1DE52D7798748737E3CF1B669E2B6A3D4820CDA384F1CF9BE9C23B0`

## 独立证据：写入、读取与请求边界

### 原版可复现链

1. `dsh-client-ui-settings-models/lib/client.js` 的原版 `refFor` 返回 profile 已配置的 `apiKeyEnv`，没有 provider/namespace 所有权检查。
2. 同一组件的原版 `applyOnce` 先提交 settings，再调用 `storeCredential(keyRef, keyValue)`；因此 credential 阶段失败时存在“settings 已指向新 ref、ref 尚未写入”的可恢复中间态。
3. `dsh-llm-pi-ai/lib/index.js` 的原版 `resolveApiKey` 每次请求按 `profile.apiKeyEnv` 调用 credential service；provider route、protocol、baseURL、model 与 auth kind 必须作为同一请求快照验证。
4. 使用合成无点 token、真实生产 adapter 和 fake transport，原版在发网前/协议认证阶段稳定产生 `PI_AI_ERROR / Failed to extract accountId from token`。

这条链只说明“哪些代码可以产生同类症状”。没有文件审计日志、进程审计或写入时间线，无法识别现场曾是哪一个 UI、插件、手工编辑或其他 credentials writer 写入；报告不把复现根因冒充历史归因。

### 修复契约验证

- 页面写入目标由 `settings namespace + provider id` 完整编码，不使用易碰撞 slug；`a-b`、`a_b` 以及不同 namespace 的同名 provider 得到不同 ref。
- 已配置的外来/环境 ref 只作为读取来源；普通编辑改绑到页面自有 ref，删除只允许删除精确的 namespace/provider 自有 ref。
- `OPENAI_CODEX_ACCESS_TOKEN` 是保留 OAuth access-token ref：
  - 原生 Codex/effective `openai-codex-responses` 可继续使用合法合成 JWT；
  - generic `openai-completions`/自定义 endpoint 引用该保留 ref 时以 `AUTH_KIND_MISMATCH` 拒绝，fake transport 调用数为 0；
  - Codex OAuth protocol 指向普通 API-key ref 也以 `AUTH_KIND_MISMATCH` 拒绝。
- auth kind 由 effective protocol/profile 决定，不由 display name 决定。
- Codex access token 的格式、account binding、expiry 分别得到 `CODEX_AUTH_TOKEN_FORMAT`、`CODEX_AUTH_ACCOUNT_MISSING`、`CODEX_AUTH_TOKEN_EXPIRED`；缺失/拒绝分别归一为 `CODEX_AUTH_REQUIRED` / `CODEX_AUTH_REJECTED`，消息不含 token。
- `prepareCall` 冻结 provider/ref/value 与原 model snapshot；错误地用另一 provider 消费 prepared call 时得到 `REQUEST_AUTH_SNAPSHOT_MISMATCH`，且 fake transport 未调用。

## 可执行回归覆盖

`tests/provider-credential-isolation-runtime.test.cjs` 不是静态 regex 自证：

- 实际 import 并执行生产 `@deepseek-ai/dsh-llm-pi-ai` 的 `apply`、`resolveModel`、`prepareCall`、`stream`；通过 fake `ctx` 捕获真实 adapter，只把最终 transport 换成本地 `globalThis.fetch` stub。
- Codex → other → Codex 三次请求核对 endpoint、模型解析、Authorization 哈希、Codex account header 的存在性；测试状态不保留完整 header/token。
- 热重载后，已 prepared 请求继续使用旧 provider/baseURL/ref/key，新直接请求使用新快照。
- 实际执行生产 `LocalCredentialProvider`，验证 OAuth `modifyRecord` 与另一 provider `set(ref)` 的排他串行；反向完成的 A/B deferred save 仍进入不同自有 ref。
- 比较 Codex OAuth record 前后 SHA-256，证明编辑另一 provider ref 不改变 record；断言失败 diff 不包含完整合成秘密。
- settings 先写成功、首次 credential set 失败后，重试只补凭据阶段，不重复 settings mutate，也不改变另一 provider ref。
- 将 `patchProviderAuthIsolationSource` 应用于完整官方 runtime 后动态 import 结果，执行 malformed token、双向 reserved-ref 泄漏防护和 prepared snapshot mismatch；三者均在 fake transport 前拒绝。
- 直接对已安装维护 runtime 执行真实 adapter 负路径：显式 Codex reserved ref 缺失为 `CODEX_AUTH_REQUIRED` 且 0 fetch；malformed token 为 `CODEX_AUTH_TOKEN_FORMAT` 且 finish/error/log 均无 token；native OAuth 无显式 ref/无 record 为 `CODEX_AUTH_REQUIRED`；route key 保持 `openai-codex` 而 `displayName` 改名时，401 仍为 `CODEX_AUTH_REJECTED`；未知 500 上游消息即使回显本次合成 access token，也固定归一为 `CODEX_AUTH_FAILED` 并从 failure/cause/log 剥离 token。
- `openai-codex-responses` 不是当前自定义 route 的可配置协议；真实 `buildProvider` 会在 credential resolve/fetch 前 fail-closed。测试把它作为“不可达且不降级”的边界证据，不把 helper 可表达的理论组合误报为可达生产缺陷。

`tests/model-settings-key-override*.test.cjs` 继续验证完整 patch/migration/idempotence/fail-closed、只写 UI 行为、恢复补偿及可访问性，并已迁移到 namespace/provider v4 ref 契约。

## 敏感信息边界

- 测试只记录请求 URL、method、model、Authorization SHA-256、account header 是否存在/长度；不记录 header 原文。
- API Key/JWT 仅为合成值，仍避免进入审计数组和断言的 expected/actual 大对象。
- 错误回归断言 provider 语义和 code，并明确检查消息/日志不含合成 token。
- 未读取、复制、打印或修改任何真实凭据文件。

## 验证命令与结果

生产补丁应用后的维护 runtime SHA-256：

- settings UI：`766CFC372B94665000B60836D845767AEF3417852D6F97ED1CD035AFC039EA52`
- llm-pi-ai：`2171F31250C0970D1CC9A9733A241364306D99146E5BAEC8D0775066D7AE3388`

认证隔离主套件：

```text
node --test tests/model-settings-key-override.test.cjs tests/model-settings-key-override-runtime.test.cjs tests/provider-credential-isolation-runtime.test.cjs
tests 29; pass 29; fail 0; skipped 0
```

相关官方 runtime/组合/credential smoke：

```text
node --test tests/official-runtime-patch.test.cjs tests/official-runtime-patch-composition.test.cjs tests/model-settings-credential-validation-runtime.test.cjs
tests 46; pass 43; fail 0; skipped 3
```

三项 skip 均为该套件已有的 alpha.2 installed-workspace 条件跳过，不是本修复失败。输出只含测试名、耗时、计数、固定源码哈希与错误 code；没有打印完整合成或真实 credential。

## 明确未验证

- 未执行真实 OpenAI/Codex 登录、OAuth refresh 服务器交互或真实账号请求。
- 未执行任何付费模型请求。
- 未对用户现场历史写入进程做取证；当前信息不足以确定具体写入者。
- UI helper 只能约束该页面自身的写入/删除。credential service 的全局 `set(ref, value)` 仍是通用 seam；其他有权限的 writer 若直接写保留 ref，不会被 UI helper 自动拦截，必须依靠调用方所有权、审计与请求侧 auth-kind/格式防线。
- native OAuth record 的获取与刷新继续由 pi-ai 的 credential store/auth context 负责；本测试验证其与页面自有 ref 编辑的并发隔离及输出脱敏，但不复制 OAuth 实现，也不宣称验证了真实服务端刷新。
- 对没有显式 request credential、且其 native provider 内部也不向 adapter 暴露 credential 的其他协议，adapter 无法对任意未知字符串做“与秘密精确匹配”的证明。本修复对可识别 bearer/JWT/token 渲染及 Codex 未知错误实施安全归一化；报告不把它扩大为整个平台、所有未来 native provider 的普遍秘密捕获保证。
