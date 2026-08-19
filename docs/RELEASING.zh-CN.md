# Harness Desktop 发布流程

## 强制发布顺序

1. 更新桌面与移动源码版本、`CHANGELOG.md`、`README.md` 和 `release-notes.md`；公开 `release-manifest.json` 在新资产生成前继续指向上一健康版本，避免暴露尚不存在的下载。
2. 运行 `npm run verify` 与 `npm run verify:release`。
3. 运行 `npm run dist`、`npm run verify:artifact`、打包后自检和安装/卸载冒烟测试。
4. 从已验证提交创建同版本不可变 Tag，通过 GitHub Actions 创建桌面 Release；Release 成功前不更新 `main` 的公开下载入口。
5. 由仓库管理员配置长期 Android release 密钥后，运行 **Publish Signed Android Mobile**；工作流校验证书指纹、包名和版本后将签名 APK 加入同一 Release，并重写 `SHA256SUMS.txt`。
6. 从最终 GitHub Release 生成含实际大小的 `release-manifest.json`，提交并快进 `main`。
7. GitHub Release 的八个 CNB 镜像源地址全部可用后，运行：

   ```powershell
   npm run release:cnb-cloud
   ```

8. 命令会等待 CNB 云端流水线结束，并核对 CNB 八个附件的文件大小和 `SHA256SUMS.txt` 内容。

## CNB 云端镜像原则

- **禁止从本机向 CNB 上传 EXE/APK 等大文件。**
- 本机只向 CNB 推送由 `.cnb.yml`、发布说明、更新清单和校验文件组成的轻量提交。
- CNB Runner 直接从 GitHub Release 下载制品，下载后先核对清单文件大小和 SHA-256。
- 上传由官方 `cnbcool/attachments:latest` 插件完成，不在项目里维护预签名 PUT/确认逻辑。
- CNB API 操作使用流水线自动注入并在任务结束后销毁的 `CNB_TOKEN`，不得把长期 CNB Token 写入 `.cnb.yml` 或 Git 仓库。
- `release:cnb-cloud` 使用已登录的官方 `@cnbcool/cnb-cli` 作为 Git 凭据和流水线状态查询工具，不读取本机发布密钥文件，不传输制品字节。

## 固定附件集合

v1.0.25 镜像经过云端构建和校验的 Windows、macOS 与正式签名 Android 用户制品：

- `Harness-Desktop-<version>-win-x64.exe`
- `Harness-Desktop-<version>-portable-x64.exe`
- `Harness-Desktop-<version>-mac-arm64.dmg`
- `Harness-Desktop-<version>-mac-arm64.zip`
- `Harness-Desktop-<version>-mac-x64.dmg`
- `Harness-Desktop-<version>-mac-x64.zip`
- `Harness-Mobile-<version>-android-universal.apk`
- `SHA256SUMS.txt`

Android APK 必须由独立工作流使用长期 release 密钥签名，并强制匹配预登记证书指纹；debug、未签名或证书漂移的 APK 不得加入 Release 或 CNB。iOS/iPadOS 在没有 Apple Developer Program 时只提供 Safari 工作台入口，不分发 IPA。

## 故障处理

- CNB 云端流水线失败时，打开命令输出的构建日志链接修复 `.cnb.yml`，不要回退为本机大文件上传。
- 流水线可安全重跑：已存在的 Release 附件会跳过，只下载并上传缺失文件。
- GitHub 下载文件与 `release-manifest.json` 的大小或 `SHA256SUMS.txt` 不一致时，流水线必须失败，不得绕过校验。
