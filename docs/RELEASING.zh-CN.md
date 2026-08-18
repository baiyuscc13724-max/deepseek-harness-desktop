# Harness Desktop 发布流程

## 强制发布顺序

1. 更新桌面版本、`CHANGELOG.md`、`README.md`、`release-notes.md` 和 `release-manifest.json`。
2. 运行 `npm run verify` 与 `npm run verify:release`。
3. 运行 `npm run dist`、`npm run verify:artifact`、打包后自检和安装/卸载冒烟测试。
4. 将源码提交推送至 GitHub `main`，创建同版本 GitHub Release 并上传经过审计的制品。
5. GitHub Release 的三个公开下载地址全部可用后，运行：

   ```powershell
   npm run release:cnb-cloud
   ```

6. 命令会等待 CNB 云端流水线结束，并核对 CNB 三个附件的文件大小和 `SHA256SUMS.txt` 内容。

## CNB 云端镜像原则

- **禁止从本机向 CNB 上传 EXE/APK 等大文件。**
- 本机只向 CNB 推送由 `.cnb.yml`、发布说明、更新清单和校验文件组成的轻量提交。
- CNB Runner 直接从 GitHub Release 下载制品，下载后先核对清单文件大小和 SHA-256。
- 上传由官方 `cnbcool/attachments:latest` 插件完成，不在项目里维护预签名 PUT/确认逻辑。
- CNB API 操作使用流水线自动注入并在任务结束后销毁的 `CNB_TOKEN`，不得把长期 CNB Token 写入 `.cnb.yml` 或 Git 仓库。
- `release:cnb-cloud` 使用已登录的官方 `@cnbcool/cnb-cli` 作为 Git 凭据和流水线状态查询工具，不读取本机发布密钥文件，不传输制品字节。

## 固定附件集合

桌面补丁版本默认只镜像：

- `Harness-Desktop-<version>-win-x64.exe`
- `Harness-Desktop-<version>-portable-x64.exe`
- `SHA256SUMS.txt`

Android APP 只有在 Android 源码确实修改、完成单独验证并明确决定发布时才加入；桌面版本升级不得自动生成不存在的同版本 APK。

## 故障处理

- CNB 云端流水线失败时，打开命令输出的构建日志链接修复 `.cnb.yml`，不要回退为本机大文件上传。
- 流水线可安全重跑：已存在的 Release 附件会跳过，只下载并上传缺失文件。
- GitHub 下载文件与 `release-manifest.json` 的大小或 `SHA256SUMS.txt` 不一致时，流水线必须失败，不得绕过校验。
