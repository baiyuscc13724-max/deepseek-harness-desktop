# Harness Desktop v1.0.46 安全、权限与隐私审查

范围：受保护的同仓库 PR Preview 更新、独立签名与 CNB/GitHub 双源 promotion、组件更新/健康/回滚、本轮桌面与 Agent Teams 合并，以及 v1.0.45 候选中的 Android/个人中继改动。

## 当前结论

v1.0.46 没有给 PR 代码、客户端或 CNB 普通仓库增加任意生产私钥读取能力。PR 仅能进入无密钥构建；默认分支上的签名与 promotion 分属两个 Required Reviewer Environment。Preview 私钥独立于 stable 组件签名密钥，只存在于 GitHub `pr-preview-signing` Environment；客户端只携带 `harness-preview-v1` 公钥。

已发布 `v1.0.44` 及现有 `v1.0.45` Tag/草稿保持不可变。v1.0.45 不移动、不重建、不覆盖，完整功能使用新的 v1.0.46/10046 候选并重新通过所有本机、云端和双云门禁。

## PR Preview 信任边界

- 构建 workflow 只响应官方同仓库、非 fork PR，并在检出 PR head 前通过只读 API 取得最新 published、non-prerelease 稳定基线；checkout 不持久化凭据，`npm ci` 禁用 lifecycle scripts。
- 构建任务没有 contents write、Environment 或 Secret；输出仅为一个组件 ZIP 和有界无签名报告。PR 自报版本不决定候选版本。
- 签名 workflow 只从默认分支 dispatch，并由 `pr-preview-signing` Required Reviewer Environment 保护；它重新查询 build run、artifact、PR、head SHA 与稳定 Release，拒绝 draft、fork、已关闭/合并或 head 漂移。
- 独立 Ed25519 私钥通过 `HARNESS_PR_PREVIEW_SIGNING_PRIVATE_KEY_BASE64` 注入临时 0600 文件并在步骤结束删除。签名脚本同时验证已提交公钥配置与私钥派生公钥完全一致。
- 签名只发布四项不可变候选资产及恢复 artifact，不修改 `latest`，不接触 CNB Token，也不执行 CNB handoff。
- Preview index/wrapper/组件清单严格绑定固定仓库、`main`、PR、head SHA、sequence、发布时间、最长七天有效期、key ID、资产大小、完整 SHA-256 和 CNB→GitHub URL 顺序；未知/额外字段、非 HTTPS、签名错误、重放和降序全部拒绝。

## 本机更新与 promotion 门禁

- 本机 gate 只接受候选 bundle、公开 config、打包应用和证据输出四个本机路径；拒绝 URL、Token、私钥及未知参数，不联网、不发布。
- gate 要求精确四资产、生产公开 config 已启用、签名有效、ZIP 内 config 与生产 config 字节一致，并在隔离 profile 中复用生产 ComponentUpdateService/Store、activation store、helper 和 health path。
- 必须完成 stage→apply→restart health→active，再以受控坏健康探针验证 last-known-good 自动回滚，最后退出 Preview 恢复 bundled stable/null pointer 并复检。
- evidence 使用精确字段集，不含路径、URL、日志、环境或敏感值；原始 UTF-8 bytes 的 SHA-256 作为外部输入，由 `pr-preview-promotion` workflow 重新校验。
- promotion 重新验证签名 run、PR/head/tag/sequence、四项摘要、签名/expiry、当前 CNB/GitHub feed sequence 与本机 evidence；任一不一致均停止。

## CNB 与 GitHub 边界

- CNB handoff 不使用 `--force` 或 `--force-with-lease`。远端 `pr-preview` 存在时读取精确 OID、fetch 同一 ref 并验证 `FETCH_HEAD`，只在允许树结构上创建唯一父提交；push 前再次核对 OID并普通 non-force push，并发变化明确失败。
- 首次分支不存在时只允许创建精确 allowlist 根提交。CNB `main`/`pr-preview` 均禁止删除和强制推送，并要求线性历史。
- GitHub `main` Ruleset 启用禁止删除、线性历史和禁止非快进；高风险签名与 promotion 另由禁止管理员绕过的 Required Reviewer Environment 保护。
- GitHub feed Token 只存在于 CNB 受限密钥仓库；导入文件限定 `allow_slugs=baiyuscc13724-max/deepseek-harness-desktop`、`allow_events=push`、`allow_branches=pr-preview`。
- CNB 必须从 GitHub 不可变 Release 云到云完整下载、核对大小/SHA 并回读后，才先提升 CNB、再提升 GitHub；客户端首选 CNB、GitHub 仅后备。

## 既有权限与移动端边界

- Computer Use 的 session/forever/拒绝仍只能由 Harness Desktop 宿主授权卡决定；插件卡不能选择 scope。授权后 unlimited 语义保持明确，工具仍不暴露 Shell 或脚本。
- 浏览器控制继续禁止输入密码、支付、银行、账户与验证码；右侧工作区文件按钮只接受经过 containment/类型/大小边界验证的本机目标。
- Android `minSdk=26` 路径不调用高版本 `String.isBlank()`；WSS/SOCKS 使用固定线程池、有界队列并只监听 loopback。
- 个人 `wss://` 中继不持有 tunnel key、不解密内容、不保存离线帧；连接、握手、房间、来源、帧大小和速率均有上限。手机固定动作、敏感输入和二次确认边界不变。

## 版本与正式发布门禁

- 根 package/lock、13 个随包插件、Android、iOS/iPadOS、桌面移动路由和移动更新示例全部绑定 1.0.46/10046。
- 正式 Tag 只在干净候选快进 `main`、本机源码/安全/PR Preview 更新与回滚门禁、锁定 SHA 的 Windows/macOS/Linux/iOS candidate workflow 和 previous-stable→candidate Windows 安装升级自检全部成功后创建。
- 本地发布器删除并拒绝 `dist`，不上传正式二进制；GitHub Actions 生成桌面、签名 Android 与签名 stable 组件，CNB Runner 只从 GitHub 云端镜像。
- 两云必须各自拥有精确 18 项不可变资产；三个 Ed25519 stable feed 始终最后提升。同版本不同摘要、Tag 漂移、资产替换或历史覆盖全部失败关闭。
