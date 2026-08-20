# Harness Mobile Android 正式签名发布

Android APK 必须签名。调试构建会使用 Android SDK 的公共调试证书，只适合开发机测试；用户发布必须使用项目长期独占的 release keystore。后续覆盖更新必须继续使用同一证书。

## 1. 在自己的电脑上创建长期密钥

在已安装 JDK 17+ 的 Windows 终端运行：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/create-android-release-keystore.ps1
```

脚本会隐藏输入密码，默认把密钥写入用户目录：

```text
%USERPROFILE%\.harness-desktop\signing\harness-mobile-release.jks
```

请把 keystore、alias、store password、key password 和脚本显示的 SHA-256 证书指纹保存在密码管理器与离线备份中。不要发送到聊天、Issue、提交记录或构建日志。

## 2. 由仓库管理员亲自配置 GitHub Actions Secrets

进入仓库 **Settings → Secrets and variables → Actions**，创建：

- `ANDROID_RELEASE_KEYSTORE_BASE64`：keystore 文件的 Base64 内容。
- `ANDROID_RELEASE_KEY_ALIAS`：默认是 `harness-mobile-release`。
- `ANDROID_RELEASE_STORE_PASSWORD`：keystore 密码。
- `ANDROID_RELEASE_KEY_PASSWORD`：密钥密码。
- `ANDROID_RELEASE_CERT_SHA256`：证书 SHA-256 指纹；可带或不带冒号。

PowerShell 可将 keystore 直接通过标准输入写入 GitHub Secret，而不在命令行参数中暴露内容：

```powershell
$path = "$env:USERPROFILE\.harness-desktop\signing\harness-mobile-release.jks"
[Convert]::ToBase64String([IO.File]::ReadAllBytes($path)) | gh secret set ANDROID_RELEASE_KEYSTORE_BASE64
```

其余密码使用 `gh secret set SECRET_NAME` 的隐藏提示逐项输入，或在 GitHub 网页中粘贴。不要把 Secret 值写入仓库文件。

## 3. 发布顺序

1. 先完成同版本桌面 `v1.0.27` GitHub Release。
2. 推送 `v1.0.27` Tag 时 **Publish Signed Android Mobile** 会自动启动并等待桌面 Release；需要重跑时才在 Actions 中手动输入同一 Tag。
3. 工作流会运行 Android 单元测试，构建 release APK，使用 `apksigner` 验证签名，并强制证书指纹、包名 `io.harnessdesktop.mobile`、versionCode `10027`、versionName `1.0.27` 全部匹配。
4. 验证通过后才把 `Harness-Mobile-1.0.27-android-universal.apk` 上传到现有 Release，并更新 `SHA256SUMS.txt`。

缺少任一 Secret、证书指纹不符、APK 未签名、包名或版本不符时，工作流都会失败，不会发布 debug 或未签名 APK。

## iPhone / iPad

用户当前选择不加入 Apple Developer Program，因此不分发不可公开安装的 IPA。iPhone/iPad 扫桌面二维码后使用 Safari 手机版工作台，并可通过分享菜单“添加到主屏幕”。未来加入 Apple Developer Program 后，才能配置 App Store/TestFlight 正式下载入口。
