# 国内更新镜像接入

## 已确定的下载顺序

桌面壳按以下顺序读取更新清单和下载发布文件：

1. CNB 公开仓库的 Release 附件与 Raw 更新清单；
2. GitHub 原始发布地址。

CODING、GitCode、七牛云、微云和云联盟全部取消。CNB 国内源失败后才使用 GitHub。以后替换 CNB 仓库只修改仓库路径配置，不需要修改桌面壳下载代码。

## 注册入口

- [创建 CNB 仓库](https://cnb.cool/new/repos)，仓库必须设置为公开；公开仓库的 Release 附件允许未登录用户下载。
- CNB 仓库地址格式为 `https://cnb.cool/<组织或用户名>/<仓库名>`，Release 附件格式为 `https://cnb.cool/<仓库路径>/-/releases/download/<tag>/<文件名>`。
- 仓库根目录保留最新 `release-manifest.json`，桌面壳通过 `https://cnb.cool/<仓库路径>/-/git/raw/main/release-manifest.json` 读取。
- 上传自动化可使用 CNB 官方 `cnbcool/attachments:latest` 附件插件；流水线内置的临时令牌会在构建结束后自动销毁。

## 注册后需要提供的信息

只提供公开标识和公开下载地址，不要把密码或密钥发到聊天或提交进仓库。

| 服务 | 需要提供的公开信息 | 私密信息的存放位置 |
| --- | --- | --- |
| CNB | 公开仓库完整地址、一条无需登录即可下载的 Release 附件样例 | CNB 访问令牌或流水线临时令牌 |

如果某条样例地址在无痕浏览器中会跳转登录页，它就不能作为更新源。

本机发布凭据统一放在项目根目录的 `.env.cnb.local`。该文件被 `.gitignore` 的 `.env.*` 规则排除，只供本机 AI 或发布脚本读取；不得复制到 `.env.example`、CNB 仓库、GitHub、日志或发布附件。`CNB_TOKEN` 只用于上传，桌面客户端的公开下载地址绝不携带令牌。

## 配置文件

复制 `release-mirrors.example.json` 为被 Git 忽略的 `release-mirrors.local.json`，把 `YOUR_REPO_SLUG` 换成 CNB 仓库路径。支持四个占位符：

- `{version}`：例如 `1.0.20`；
- `{tag}`：例如 `v1.0.20`；
- `{file}`：原始文件名；
- `{fileEncoded}`：经过 URL 编码的文件名。

再复制 `release-update-sources.example.json` 为被 Git 忽略的 `release-update-sources.local.json`，填入 CNB Raw 清单地址。该文件会随安装包进入桌面壳，应用运行时先尝试 CNB、再尝试 GitHub。也可以在构建环境通过 `HARNESS_DESKTOP_UPDATE_FEEDS` 临时覆盖。

## 交给打包 AI 的发布步骤

打包 AI 生成并审计安装包后：

1. 生成包含国内资产直链的清单：

   ```powershell
   npm run release:mirror-manifest -- --config=release-mirrors.local.json --input=release-manifest.json --output=dist/release-manifest.mirror.json
   ```

2. 在 CNB 为同一个 tag 创建 Release，把 Windows 安装版、便携版、其他平台资产和 `SHA256SUMS.txt` 原样上传为 Release 附件；
3. 将 `release-manifest.mirror.json` 以 `release-manifest.json` 提交到 CNB 仓库的 `main` 分支根目录；
4. 用未登录的新浏览器分别验证清单、校验文件和安装包直链；
5. 不得在各镜像重新生成不同的哈希，所有源必须对应同一批已经审计的发布文件。

## 桌面壳的失败切换规则

- 更新清单连接失败或 6 秒内无响应：切换下一个清单源；
- 校验文件请求失败、返回网页或 10 秒超时：切换下一个校验源；
- 安装包返回 HTML/JSON/XML、连续 20 秒无数据、超过安全大小、实际大小不符或 SHA-256 不符：删除残片并切换下一个文件源；
- 所有下载地址必须是 HTTPS，URL 中不得包含用户名、密码或 Token；
- 只有文件大小和公开 SHA-256 都通过后，桌面壳才允许启动安装程序。
