# 服务商凭据与路由隔离审计（2026-09-12）

状态：本成员修复及回归完成，提交独立验收；共享安装器哈希胶合由总审负责。仅维护源码；未修改当前运行实例、真实环境或真实凭据。

## 修改前基线

现有三份回归 `node --test tests/provider-credential-isolation-runtime.test.cjs tests/model-settings-key-override-runtime.test.cjs tests/model-settings-key-override.test.cjs`：29/29 通过。既有未提交代码已包含 namespace/provider 独立引用、Codex 协议/凭据类型校验、显式凭据快照和错误脱敏，不能计作本轮新修复。

修改前 SHA-256（按本轮读取顺序，保留原有脏修改）：

| 文件 | SHA-256 |
|---|---|
| scripts/provider-auth-isolation-patch.mjs | ABEF675B511CCC9850D5379256EC1975C6FE4706A603F59474783CCD0912D144 |
| scripts/model-settings-key-override-patch.mjs | 3EC5FA8780451AA4CBFA5E669F689F6A0085C82E27F8DFB876A902817ADBA794 |
| scripts/model-settings-credential-validation-patch.mjs | B91C01845D51F6B5B61B48EC451114187F55FE5198FAC7731F399600FA83CB1B |
| tests/fixtures/provider-credential-isolation-runtime.cjs | E5F8B1B6FD5E9B6FAB34B6298E6882024E654711E82A82D4825D6B468EF4D06F |
| tests/fixtures/model-settings-key-override-runtime.cjs | 26BA519726DCEE854CD38E9A15DC0234C48633E73E908D6ECD95176F7C28C820 |
| tests/provider-credential-isolation-runtime.test.cjs | 508D085837D6915358FF80D8A127E8A1A16801E68E4E989695DC8DB64088831B |
| tests/model-settings-key-override-runtime.test.cjs | AC82DD0CB98D1A50529DE24D6FC8C08F300A46D904BAC15787170BC93588BDD0 |
| tests/model-settings-key-override.test.cjs | 4A155638837449F63712B868A32F18B64D4EAA5B9BB1EADC52F9697D34467A0D |
| plugins/dsh-model-admission/lib/index.js | CC8BBE836DDBABCC9A60A0AD4A89457954F56F089062AF868A94DFFDF9E3A28D |

## 边界

所有行为测试只使用 synthetic 凭据、临时存储和替换 fetch；不调用付费服务。生产适配器补丁写到测试临时模块，绝不修改 node_modules 或正在承载会话的运行时。共享 patch-official-runtime.mjs 不在本成员写入范围。

## 本轮新发现与最小修复

### 1. 模型目录草稿更换目的地址仍继承原路由凭据（高风险）

原生产 `discoverModels(request, storedProfile)` 的网络分支用 `request.baseURL` 建 URL，却仅凭 `request.provider` 获取已存 `headers` 和 `resolveApiKey`。故在 A 编辑器输入 B 的地址时，A 的 Authorization 与自定义密钥头会发往 B；同域不同租户路径、端口、HTTP 降级和 API 协议变更同样复现。显式草稿 B key 仅替换 Authorization，自定义 A 密钥头仍残留。

修复在 `scripts/provider-auth-isolation-patch.mjs` 增加 v4 精确迁移：

- 已存凭据/headers 仅供完全匹配的目标 URL（含路径、端口、传输协议）及 API 协议使用。允许 URL 标准规范化和末尾斜线等价；拒绝含 userinfo/query/fragment 或解析失败的 URL 继承旧凭据。匹配不依赖对象引用。
- 显式输入 `apiKey` 的目录探测自包含，不继承任何已存自定义头（未知自定义头可能是认证头，不能仅按 Authorization 名称过滤）。这也适用于同一目的地址。
- 改地址不禁用合法探测：无新 key 时可匿名探测，有新 key 时使用本次显式 key；认证端点可正常返回 401/403 清晰错误。不会读取原 key。
- 目录探测使用 `redirect: "error"`，防止自定义密钥头经重定向越过已检查边界。
- 原生内置离线模型目录行为不变，不读取任何额外凭据。

兼容性取舍：若目录服务依赖额外自定义认证/路由头，显式 key 探测不再悄悄携带旧头。已保存完全匹配路由、不提供新 key 时仍可使用全部本路由 headers；需重定向的端点须使用最终规范地址。未扩大到一般消息请求的用户自定义 headers 策略。

### 2. prepareCall 允许替换已准备的模型标识

已有补丁冻结 provider/ref/配置，但未核对 `options.model`；准备 `synthetic-model` 后可在同 provider 下发送另一已声明模型，形成模型预算/能力信息与真实请求不一致。v4 把字符串模型标识存入 `preparedCredential` 并在发送前校验；不比较 profile 或 model 对象引用。继续保留已有 A/B 并发与热更新快照语义。

### 3. 模型目录异常保留含凭据的原始 cause

已有消息流脱敏不覆盖目录探测。模拟 transport error 的 cause 含 synthetic key 可沿异常链读取。v4 的目录 transport、abort、body-read、JSON-parse 错误不再保留原始 cause。错误码仍为 DISCOVERY_FAILED / ABORTED，端点地址和 HTTP 状态诊断保留。transport cause 已有行为回归；body-read / JSON-parse 分支的同类处理未逐分支注入测试。

## 本成员文件变更

- `scripts/provider-auth-isolation-patch.mjs`：保留此前 v1-v3 迁移逻辑；增加 v4 目的地绑定、模型标识冻结、目录错误边界、幂等/不完整产物检查。
- `tests/fixtures/provider-credential-isolation-runtime.cjs`：捕获实际注册的目录/发现回调、实际 resolve 引用和请求头指纹；增加单一 mock fetch 生命周期内的并发执行。仅使用假请求，不记录原始认证头。
- `tests/audit-provider-isolation.test.cjs`：本轮新增回归，运行完整生产适配器的临时 v4 模块（不是只测纯 helper）。
- 本报告。其余分配文件没有本成员新修改；未改 model-admission、设置 UI、原有29项测试内容、共享安装入口或 package 版本。

## 确切测试与结果

工作目录：维护检出 `release-v1.0.28-worktree`。

1. 基线：`node --test tests/provider-credential-isolation-runtime.test.cjs tests/model-settings-key-override-runtime.test.cjs tests/model-settings-key-override.test.cjs` → **29/29通过**。
2. 修复前新增第一版：`node --test tests/audit-provider-isolation.test.cjs` → **12项中1通过、11失败**（含父级嵌套测试计数）。并发快照正向项通过；五种地址/协议差异、显式 key 的旧自定义头、缺失 redirect guard、模型替换、原始 cause 与新版本断言失败。
3. 修复后并补目录热更新、离线目录、结构匹配：
   `node --test tests/audit-provider-isolation.test.cjs tests/provider-credential-isolation-runtime.test.cjs tests/model-settings-key-override-runtime.test.cjs tests/model-settings-key-override.test.cjs` → **44/44通过，0失败/取消/跳过**（新增15项计数 + 原29项）。
4. `git diff --check -- scripts/provider-auth-isolation-patch.mjs tests/fixtures/provider-credential-isolation-runtime.cjs tests/audit-provider-isolation.test.cjs docs/AUDIT-20260912-PROVIDERS.md` → 退出0；注意前三个源码/测试原本部分未跟踪，此检查不能代替测试。

覆盖矩阵：

| 能力 | 证据归属 | 本轮结果 |
|---|---|---|
| A/B 设置保存、清除、还原、写失败重试 | 已有29项 | 通过，未冒充新修复 |
| Codex 环境引用、OAuth账号/过期/错误脱敏 | 已有29项及完整新补丁接入项 | 通过 |
| OAuth record 与另一 provider 写入串行不丢失 | 已有29项 | 通过，临时本地 credential provider |
| 草稿地址/协议变化不携带旧key/headers | 新增生产适配器项 | 通过 |
| 同一端点正常复用；显式key独立 | 新增生产适配器项 | 通过 |
| 并发 A/B prepare + key轮换；模型身份冻结 | 新增生产适配器项 | 通过 |
| 目录热重载/内置目录不读额外key | 新增生产适配器项 | 通过 |
| 目录transport cause不泄漏 | 新增生产适配器项 | 通过 |
| v3→v4升级、幂等、不完整v4拒绝 | 新增生产适配器项 | 通过 |

## 安装器最小胶合（总审负责）

已将以下精确结果交给总审；仅内存调用 `patchProviderAuthIsolationSource` 计算，未原地修改 node_modules：

- 精确已安装 v3 输入 SHA-256：`2171F31250C0970D1CC9A9733A241364306D99146E5BAEC8D0775066D7AE3388`。
- 冻结 v4 输出 SHA-256：`28A7850E44BC24CDD0E5E7222EB0FE655877D1433DB59F8FF435934528BA0207`。
- 首次 changed=true；第二次 changed=false 且字节完全相同。
- `OFFICIAL_ALPHA5_MODEL_AUTH_HASHES.piAi` 应保留旧hash为 `legacyV3Patched`，将新hash置为 `patched`；安装函数输入白名单应增加 legacyV3Patched。不得删掉旧v1/v2/official合法来源或放宽未知输入检查。

## 未覆盖与诚实边界

- 没有真实服务商登录/付费请求、用户密钥读取、用户环境修改、真实浏览器自动化或运行实例热补丁；本报告不是“用户现在的1.0.62实例已经修好”的证明。
- 旧UI的保存/清除回归主要依赖已有计划helper+credential fixture；本轮未新增真实React DOM交互验收，未修改UI。
- OAuth原生刷新依旧由pi-ai负责；并未声称本轮把原生OAuth账号切换完全冻结为API key快照。
- 重定向边界验证了生产fetch实际传递 redirect:error；未搭建真实多跳HTTP服务器。网络失败测试mock了transport，不代表所有真实SDK/代理异常均覆盖。
- 本轮验证v3输入的完整生产迁移；official/v1/v2兼容分支保持原代码，仍需独立安装胶合验收，不通过取消精确hash门槛来宣称兼容。
- 全项目静态/完整冒烟与独立复算由团队验证成员执行。本成员44项结果不能替代全项目验收。

