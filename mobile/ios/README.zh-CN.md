# Harness Mobile for iOS / iPadOS

原生 SwiftUI 客户端，Bundle ID 为 `io.harnessdesktop.mobile`，支持 iPhone 和 iPad（iOS/iPadOS 16+）。

## 已实现的源代码边界

- 扫描 Desktop 一次性二维码，或处理 `harnessmobile://pair` 深链。
- 严格校验配对目标：只接受私网/覆盖网 IPv4 上的 HTTP Desktop 网关，以及无凭据的 `wss://` 中继 URL。
- 配对资料和 WSS 隧道密钥存入仅限本设备的 Keychain，不写入 UserDefaults。
- `WKWebView` 始终访问 `harness.localhost` 上的应用内回环代理，Cookie 在局域网/WSS 切换时保持稳定。
- 局域网优先；连接失败时通过 443/WSS 盲中继和 AES-256-GCM 端到端隧道访问 Desktop。
- 监听网络变化，网络切换后重建中继并重新载入工作台。
- 声明相机、本地网络和 ATS 本地网络用途；隐私清单声明不跟踪、不采集 SDK 数据。

## 平台限制

本 App 只控制 Harness 工作台本身。iOS/iPadOS 不允许普通 App 使用 Android 无障碍服务式能力读取或操纵其他 App，因此没有、也不会伪装提供跨 App 控制。

远程连接只在 App 前台维持。项目没有申请 VPN/Network Extension 或无限后台执行权限，避免依赖特殊 entitlement 和审核例外。

## 在 macOS 上生成和验证工程

仓库提交 XcodeGen 的 `project.yml`，避免在 Windows 开发阶段手工维护易冲突的 `.pbxproj`。在装有 Xcode 16+ 和 XcodeGen 的 Mac 上执行：

```text
cd mobile/ios
xcodegen generate
xcodebuild -project HarnessMobile.xcodeproj -scheme HarnessMobile \
  -destination 'platform=iOS Simulator,name=iPhone 15' test
```

真机归档前必须在 Xcode 中选择发行团队，补齐 App Icon，并用实际 iPhone/iPad 完成以下测试：相机授权、本地网络授权、深链、局域网配对、Wi-Fi/蜂窝切换、WSS/443、Cookie 保持、前后台切换和忘记配对。

当前 Windows 工作区不能运行 Xcode、Simulator、签名、TestFlight 或 App Store 公证；这些不是可由 Windows 单元测试替代的步骤。

## 未加入 Apple Developer Program 时的用户入口

普通 iPhone/iPad 无法公开安装未签名 IPA。当前发布不使用企业共享证书、临时侧载或其他容易失效的绕过方式。用户用系统相机扫描 Desktop 二维码后，会进入本地安装/配对页并选择“直接在 Safari 使用”；配对成功后可通过 Safari 分享菜单“添加到主屏幕”。

Safari 版在同一局域网、Desktop 正在运行且页面位于前台时使用 WebSocket 实时同步。iOS 将网页置于后台或锁屏时可能暂停连接，回到前台后恢复；Safari 版不声明原生客户端的加密 WSS/443 远程后备能力。未来加入 Apple Developer Program 后，才可把同一页面的合规入口切换到 App Store/TestFlight。
