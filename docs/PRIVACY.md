# Harness Desktop Privacy Policy / 隐私政策

Effective date / 生效日期: 2026-08-15

Harness Desktop is an independent, open-source desktop client. It runs the DeepSeek Harness runtime locally and is not an official DeepSeek product.

Harness Desktop 是一个独立的开源桌面客户端，在本机运行 DeepSeek Harness 运行时，并非 DeepSeek 官方产品。

## Data processed / 处理的数据

- Application settings, conversation/session records, workspace references, and logs are stored on your device under the application data directory and the dedicated Harness data directory.
- When you use a configured third-party AI provider, the prompt, attachments, selected local file excerpts, tool results, and conversation context needed to answer the request may be transmitted directly to that provider. The provider's own terms and privacy policy apply.
- API credentials and provider configuration are kept in the local Harness configuration. Harness Desktop does not operate a separate cloud account service that receives those credentials.
- Direct-download builds may contact GitHub to check for Harness Desktop updates. Microsoft Store builds receive desktop-app updates through Microsoft Store. The app can also check public package information for the bundled Harness runtime.
- The bundled upstream Harness configuration contains an optional session-telemetry component that is disabled by default. Advanced users can enforce opt-out by setting `DSH_TELEMETRY_DISABLED=1` before launch.
- Installed plugins may process local files or contact their own services according to the permissions and code of each plugin. Review a plugin before installing it.
- When phone sync is enabled, Harness Desktop exposes the currently running local Harness Web UI to paired devices on the same private network. The gateway authenticates each paired device but the local HTTP/WebSocket transport is not encrypted. No developer-operated relay or cloud copy is used; enable it only on a trusted Wi-Fi network.

- 应用设置、会话记录、工作区引用和日志保存在你的设备上的应用数据目录及独立 Harness 数据目录中。
- 使用已配置的第三方 AI 服务时，为完成请求所需的提示词、附件、所选本地文件片段、工具结果和对话上下文可能直接发送给该服务商，并受服务商自己的条款和隐私政策约束。
- API 凭据和服务商配置保存在本机 Harness 配置中；Harness Desktop 不运营用于收取这些凭据的独立云账户服务。
- 普通下载版可能访问 GitHub 检查桌面应用更新；Microsoft Store 版由商店提供桌面应用更新。应用也可能查询所捆绑 Harness 运行时的公开软件包信息。
- 上游 Harness 配置包含一个默认关闭的可选会话遥测组件。高级用户可在启动前设置 `DSH_TELEMETRY_DISABLED=1` 强制退出。
- 用户安装的插件可能按各自代码和权限处理本地文件或访问外部服务，安装前应自行审查。
- 开启手机同步后，Harness Desktop 会把当前本机 Harness Web 工作台开放给已配对设备。局域网直连会验证每台设备，但当前局域网 HTTP/WebSocket 通道不加密，只应在本人控制的可信 Wi-Fi 中使用。用户开启异地连接时，EasyTier 或可选的 Tailscale 兼容通道可能使用其公共协调或中继基础设施；Harness Desktop 项目方不运营这些服务，也不会在项目方服务器创建会话、工作区或密钥副本。

## Generative AI / 生成式 AI

The application provides access to generative AI models chosen and configured by the user. AI output can be inaccurate, unsafe, or inappropriate and should be reviewed before use. Report potentially unlawful or harmful generated content through the reporting link below.

本应用连接由用户选择和配置的生成式 AI 模型。AI 输出可能不准确、不安全或不适当，使用前应人工核验。可能违法或有害的生成内容可通过下方入口举报。

## Retention and deletion / 保存与删除

Harness Desktop does not maintain a separate developer-operated cloud copy of your local workspaces or conversations. To delete local data, first export anything you want to keep, uninstall the app, and then remove its application-data and Harness-data folders. Removing those folders is permanent. Data already sent to an AI provider or plugin service must be managed under that provider's controls.

Harness Desktop 不在开发者自营云端保存你的本地工作区或会话副本。如需删除本地数据，请先导出要保留的内容，再卸载应用并删除应用数据目录和 Harness 数据目录；删除后不可恢复。已发送给 AI 服务商或插件服务的数据，应通过对应服务商提供的方式管理。

## Contact and reports / 联系与举报

- Privacy or security issue: https://github.com/baiyuscc13724-max/deepseek-harness-desktop/issues
- Generated-AI content report: https://github.com/baiyuscc13724-max/deepseek-harness-desktop/issues/new?template=ai-content-report.yml

This policy may be updated when application behavior or legal requirements change. Material changes will be reflected in this document and its effective date.

当应用行为或法律要求发生变化时，本政策可能更新；重大变更会反映在本文档和生效日期中。
