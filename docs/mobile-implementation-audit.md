# Android / iOS 双端实现路径审计

> 审计范围：Android WebView/原生外壳、iOS SwiftUI/WKWebView 外壳、`mobile-compat.css`、`mobile-runtime.js`、相关测试与构建入口。本文只给出实施建议，不修改现有源文件。

## 1. 结论摘要

当前实现不是两个同等能力的客户端：

- **Android 是现有移动能力的基准实现**：`MainActivity` 负责配对、回环代理、LAN/P2P/WSS/EasyTier 路由、网络切换、文件选择、IME、返回键和生命周期；`MobileUiAdapter` 再把 `mobile-compat.css`、`mobile-runtime.js` 及 Android 附件桥注入官方 Web UI。
- **iOS 已具备可继续演进的原生外壳**：SwiftUI 状态页、二维码/深链、Keychain、回环代理、LAN 优先与 WSS 后备、WKWebView 安全导航和系统文件面板均已存在；但 `WorkbenchView` 只注入附件入口，没有加载 Android 已验证的移动 CSS/runtime，因此布局、抽屉、设置页、IME、历史恢复、主题桥等体验并不对等。
- **最小风险路线不是重写原生界面，也不是立即移动 Android 资产**。应先保持 Android 运行路径不变，为 iOS 增加受控的 CSS 适配；之后再把 runtime 按平台能力门控后接入 iOS。等双端行为与测试稳定后，才把兼容资产整理为单一来源。
- **发布边界必须保持不变**：Android 继续使用云端签名 APK 流程；iOS 在没有 Apple Developer membership 时仅做 iPhone/iPad Simulator 验证，用户入口仍是 Safari / 添加到主屏幕，不生成或发布未签名 IPA。

## 2. 现状与职责边界

### 2.1 Android

主要入口：

- `mobile/android/app/src/main/java/io/harnessdesktop/mobile/MainActivity.java`
  - API 26+，Java 17 编译；配置 WebView、Cookie、Safe Browsing、URL 外跳、文件选择、IME Insets、网络监听与页面重试。
  - 通过 `HarnessWebProxy` 固定访问稳定回环 origin，按 LAN → native P2P → WSS → EasyTier 排序可用线路。
  - Android 14+ 截图回调只发出提示事件，不读取媒体库。
  - 销毁时显式关闭 WebView、代理、隧道、回调和适配器。
- `mobile/android/app/src/main/java/io/harnessdesktop/mobile/MobileUiAdapter.java`
  - 从 APK assets 读取 CSS/runtime，多时点幂等注入。
  - Android 专属附件桥将系统 Picker 返回的 `File` 重新送入官方 `paste/drop -> intakeImages` 管线。
- `mobile/android/app/src/main/assets/mobile-compat.css`
  - 将桌面多列壳改造成手机单列、底栏/抽屉、移动设置页、固定 composer、IME 抬升和主题不透明表面。
- `mobile/android/app/src/main/assets/mobile-runtime.js`
  - 以 DOM decoration 而非复制业务状态的方式适配官方 UI；包含抽屉、设置页、模型只读视图、IME 发送桥、composer lift、历史请求恢复、时区修正、主题桥和截图提示。

构建边界：`compileSdk/targetSdk 35`、`minSdk 26`；release 必须配置四项签名环境变量。Manifest 当前允许明文流量以连接私网 HTTP Desktop，安全性依赖配对 URL/路由严格校验而不是 TLS。

### 2.2 iOS / iPadOS

主要入口：

- `mobile/ios/HarnessMobile/App/ContentView.swift`：SwiftUI `NavigationStack`、配对/工作台状态、重连/忘记、更新提示、Reduce Motion。
- `mobile/ios/HarnessMobile/App/MobileSessionViewModel.swift`：配对状态、Keychain 存储、回环代理、网络切换和应用更新检查。
- `mobile/ios/HarnessMobile/App/WorkbenchView.swift`：`WKWebView` 容器、安全导航、JS alert/confirm/prompt、系统默认上传面板以及附件桥。
- `mobile/ios/HarnessMobile/Core/LoopbackProxy.swift`：只监听 `127.0.0.1`，LAN 失败后使用 WSS/AES-GCM 隧道。
- `mobile/ios/project.yml`：XcodeGen 工程源，iOS/iPadOS 16+、Swift 5.10、iPhone/iPad 双设备族。

已具备的正确平台边界：

- 配对资料存入 `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly` 的 Keychain。
- 不申请照片整库权限；依赖 WebKit 系统文件面板。
- 不伪装 Android 式跨 App 控制；`HarnessMobileControl.status()` 明确返回 `unsupported-ios`。
- ATS 仅允许本地网络；更新交给 App Store/TestFlight。

当前明显缺口：

1. `WorkbenchView` 未注入 `mobile-compat.css`，官方桌面壳在 iPhone/iPad 小视口上没有 Android 已验证的结构适配。
2. 未注入 `mobile-runtime.js`，缺少移动抽屉/设置结构、历史请求恢复、时区兼容、主题桥与 composer 行为修正。
3. runtime 不能原样跨端启用：其中“手机控制”设置入口和 Android 截图事件属于 Android 能力，必须先做平台门控。
4. iOS 附件桥与 Android `MobileUiAdapter.FILE_ENTRY_JS` 是两套实现；两者都复用官方 `intakeImages`，但需要共享契约测试避免选择器或事件语义漂移。
5. iOS 前后台恢复没有显式 `scenePhase` 重连路径；WSS 在后台被系统挂起后，即使网络 generation 未变化，也可能需要前台恢复动作。

## 3. 建议的最小风险实施切片

以下切片按风险递增，前一切片可独立发布和回滚。

### 切片 A：先建立双端兼容资产契约（无运行时行为变化）

目标：冻结现有 Android 基准，明确哪些能力可共享、哪些必须平台门控。

建议变更：

- 扩展 `tests/mobile-apple-experience.test.cjs`：断言 iOS loader 的预期资源名、注入时机和平台标识；断言 iOS 不暴露 Android 控制入口。
- 扩展 `tests/mobile-runtime.test.cjs`：让测试上下文分别模拟 `HarnessMobilePlatform=android/ios`，覆盖平台门控、幂等安装和缺失 API 时的安全降级。
- 可新增 `tests/mobile-web-assets-parity.test.cjs`：在资产尚未单一来源前，校验 iOS 拷贝与 Android 基准的允许差异；不要只做脆弱字符串快照。

回滚：只删除/回退测试，不影响二进制。

### 切片 B：iOS 仅接入移动 CSS（首个用户可见切片）

目标：先解决布局、触控尺寸、safe area、设置页和 composer 宽度，不同时引入 fetch/DOM 行为改写。

建议变更：

- 在 `mobile/ios/HarnessMobile/Resources/` 增加经审核的 `mobile-compat.css` 资源副本。
- 在 `WorkbenchView.makeUIView` 中用 `WKUserScript` 创建固定 id 的 `<style>`，建议 `.atDocumentEnd`、`forMainFrameOnly: true`，并保留幂等检查。
- 在 `mobile/ios/project.yml` 明确把 CSS 作为 resource 打包，避免依赖 XcodeGen 对未知扩展名的隐式推断。
- 暂不改变 Android assets 的位置和加载方式。

验收重点：iPhone 小屏、iPad 分屏、横竖屏、Dynamic Type、VoiceOver、键盘弹出、设置页滚动、外链与附件面板。

回滚：删除一个 user script 和一个资源；Android 完全不受影响。

### 切片 C：runtime 平台门控后接入 iOS

目标：复用经过 Android 证明的纯 Web 适配，但禁止把 Android-only 行为带入 iOS。

建议先在 `mobile-runtime.js` 建立显式能力表，例如：

- 共享开启：时区修正、header/session decoration、移动 app shell、设置页结构、composer containment、history recovery、theme bridge、可见性恢复。
- 平台条件开启：
  - Android：`installImeSendBridge`、原生 IME height、截图建议、`installControlSettingsEntry`。
  - iOS：优先依赖 `visualViewport`；不显示“手机控制”；不注册 Android 截图建议。
- 能力检测优先于 UA 字符串；`HarnessMobilePlatform` 只作为明确平台标识。

随后在 iOS 资源中加入 runtime，经 `WKUserScript(.atDocumentEnd, forMainFrameOnly: true)` 注入。先保留 iOS 自有附件桥，避免一次切片同时替换文件选择与整个 UI runtime。

回滚：停用 iOS runtime user script 即可；CSS 和原生连接层仍可工作。

### 切片 D：前台恢复与附件契约收敛

目标：解决平台生命周期和两套附件桥的长期漂移。

建议变更：

- `HarnessMobileApp.swift` / `MobileSessionViewModel.swift`：监听 `scenePhase == .active`，只做幂等的代理/连接健康恢复，不无条件销毁或 reload WKWebView，避免丢失草稿、附件和流式会话。
- 给 `WorkbenchView.Coordinator` 增加可测试的“页面仍在、链路恢复”回调；失败状态以横幅展示，不用全屏替换工作台。
- 将 Android/iOS 附件桥共同依赖的 DOM 选择器和事件契约写进 Node 测试；在 WebKit/Chromium 差异消除前，不强行共享同一段实现。

回滚：撤销 scenePhase 处理或恢复平台各自附件桥，不影响协议层。

### 切片 E：双端稳定后再单一来源化

目标：消除 CSS/runtime 副本漂移，但不应作为首个切片。

建议最终布局：`mobile/shared/web/mobile-compat.css` 与 `mobile/shared/web/mobile-runtime.js`。Android 通过 Gradle `sourceSets` 将该目录作为 assets，iOS 通过 XcodeGen resources 引用同一目录。迁移时必须验证 APK 与 iOS app bundle 中的文件内容和名称，不要依赖构建工具的默认复制行为。

回滚：恢复平台内资源副本及各自 loader；协议、配对与代理代码无需回滚。

## 4. 文件影响范围

| 切片 | 预计修改/新增文件 | 不应触碰 |
| --- | --- | --- |
| A | `tests/mobile-runtime.test.cjs`、`tests/mobile-apple-experience.test.cjs`，可选新增 `tests/mobile-web-assets-parity.test.cjs` | 配对协议、代理、发布器 |
| B | `mobile/ios/HarnessMobile/App/WorkbenchView.swift`、`mobile/ios/HarnessMobile/Resources/mobile-compat.css`、`mobile/ios/project.yml` | Android assets/Java、iOS Core 网络层 |
| C | `mobile/android/app/src/main/assets/mobile-runtime.js`、iOS runtime resource、`WorkbenchView.swift`、对应 Node 测试 | `PairingProfile`、Relay codec、签名配置 |
| D | `HarnessMobileApp.swift`、`MobileSessionViewModel.swift`、`WorkbenchView.swift`、移动体验测试 | Android 路由优先级、发布工作流 |
| E | 新增 `mobile/shared/web/*`，调整 `mobile/android/app/build.gradle.kts` 与 `mobile/ios/project.yml`，更新测试路径 | runtime 行为本身；迁移与功能修改不要混在同一提交 |

控制范围原则：

- Android `MainActivity.java` 已承担较多职责，但本轮兼容对齐不应顺带重构；先以测试保护，再另开架构重构任务。
- 不复制官方会话业务状态或上传逻辑；移动壳只做容器、权限、生命周期和 DOM 适配。
- 不把凭据/供应商写入移动 runtime；现有模型设置只读边界应继续保留。

## 5. 验证命令与设备矩阵

### 5.1 仓库级静态/契约测试（Windows/Linux/macOS）

```text
node --test tests/mobile-runtime.test.cjs tests/mobile-appearance-ui.test.cjs tests/mobile-apple-experience.test.cjs
npm run test:smoke
npm run verify
```

首个切片至少运行三个定向测试；合并前运行 `npm run verify`。

### 5.2 Android

本地/CI 等价验证：

```text
cd mobile/android
./gradlew --no-daemon clean test lintDebug assembleDebug
```

正式 CI 还会在临时 CI-only 签名下执行：

```text
./gradlew --no-daemon clean test lintDebug assembleDebug assembleRelease
```

Windows 使用 `gradlew.bat`。不要把 debug/未签名 APK 当作发布产物。

设备矩阵：API 26、API 34/35；小屏/大屏；浅色/深色；三键/手势导航；中文/英文 IME；TalkBack；系统 Photo Picker 与文档选择器；Wi-Fi/蜂窝/VPN 切换；LAN、P2P、WSS 后备；Home/Recents/返回键；截图提示。

### 5.3 iOS / iPadOS

必须在 macOS + Xcode 16 + XcodeGen 2.46.0 运行：

```text
cd mobile/ios
xcodegen generate
xcodebuild test -project HarnessMobile.xcodeproj -scheme HarnessMobile \
  -destination 'platform=iOS Simulator,name=iPhone 15' CODE_SIGNING_ALLOWED=NO
xcodebuild test -project HarnessMobile.xcodeproj -scheme HarnessMobile \
  -destination 'platform=iOS Simulator,name=iPad (10th generation)' CODE_SIGNING_ALLOWED=NO
```

CI 的权威入口是 `.github/workflows/apple-virtual-tests.yml`，会动态选择可用 iPhone/iPad simulator，并绑定精确 source revision。

设备矩阵：iOS/iPadOS 16 最低版本与当前最新版本；iPhone 小屏、iPad 全屏/分屏；横竖屏；Dynamic Type；VoiceOver；中英文键盘；附件系统面板；深链/扫码；本地网络授权拒绝与恢复；LAN/WSS；前后台切换；忘记配对后 Cookie/Keychain 清除。

### 5.4 资源打包验证

切片 B/C/E 额外验证：

- Android APK 中仅有一份预期名称的 CSS/runtime，内容与源文件一致。
- iOS app bundle 中 CSS/runtime 存在且能被 `Bundle.main.url(...)` 定位。
- 页面只出现一个 `#harness-mobile-compat`，runtime 安装标志只建立一次。
- SPA 重渲染后抽屉、设置和附件入口能恢复，但 MutationObserver 不因流式 token 触发整页扫描。

## 6. 兼容性、风险与缓解

### 6.1 DOM 选择器漂移（高）

CSS/runtime 依赖 `data-slot`、`data-composer-card`、ARIA 和部分 CSS module 类名片段。官方 Web UI 更新可能让移动布局静默失效。

缓解：优先使用稳定 `data-*`/ARIA；把关键选择器写入契约测试；页面结构未就绪时安全 no-op；保留 Android 的多时点幂等注入和 iOS 的 document-end 注入。

### 6.2 共享 runtime 的平台误触发（高）

原样在 iOS 运行会显示不可用的 Android “手机控制”入口；IME/截图逻辑也不完全同构。

缓解：先平台门控再接入；默认关闭平台专属能力；能力检测失败必须 no-op，不得假装支持。

### 6.3 WKWebView 与 Android WebView 事件差异（中高）

`ClipboardEvent`、`DataTransfer`、`visualViewport`、文件 input、构造事件属性在两端并不完全一致。

缓解：附件桥暂时平台实现、共享测试契约；CSS 先行、runtime 后行；至少覆盖 iOS 16 与最新模拟器及 Android API 26/35。

### 6.4 页面状态被重载（高）

网络切换、前台恢复或 SwiftUI view identity 改变时无条件 reload 会丢失草稿、附件和流式状态。

缓解：保持稳定回环 origin 和 WKWebView 实例；优先恢复代理/隧道并派发 online/focus；只有明确主文档失败时才导航重试。

### 6.5 明文局域网边界（中高）

Android 允许全局 cleartext，iOS 允许 local networking；设计目的是连接私网 HTTP Desktop，但一旦 URL 校验回归可能扩大攻击面。

缓解：持续测试仅接受私网/覆盖网目标、禁止凭据 URL、外链交给系统浏览器；不在兼容切片中放宽 `PairingProfile`/`PairingLinkValidator`。

### 6.6 资源双份与发布漂移（中）

B/C 阶段短期复制资源降低运行时风险，但会产生版本漂移。

缓解：加入 byte/hash 或允许差异清单测试；E 阶段再迁移到单一来源。不要在同一提交中同时移动资源和改变行为。

### 6.7 性能与无障碍（中）

大范围 `MutationObserver`、强制布局读取和 `!important` CSS 可能影响长会话；固定 composer/抽屉可能破坏大字体与屏幕阅读器焦点。

缓解：延续“流式消息不触发整页 mount”的过滤；增加 Reduce Motion、Dynamic Type、TalkBack/VoiceOver、焦点返回和 iPad 分屏验证；避免纯文本/类名定位作为唯一语义来源。

### 6.8 发布与签名（高）

Android release 必须云端签名；iOS simulator 通过不代表可上架，未签名 IPA 不能公开安装。

缓解：保持仓库发布器和现有 Actions 为唯一正式入口；没有 Apple Developer membership 时不扩大发布承诺。

## 7. 本次审计的实际基线结果

- 定向 Node 契约：`13/13` 通过（`mobile-runtime`、`mobile-appearance-ui`、`mobile-apple-experience`）。
- Android Gradle 命令已启动，但当前 Windows 环境没有配置 `ANDROID_HOME`，且 `mobile/android/local.properties` 没有有效 `sdk.dir`，因此在解析 `:app:testDebugUnitTest` 依赖前失败；这不是源码编译失败，需在具备 Android SDK 的开发机或现有 Ubuntu CI 重跑。
- iOS/Xcode 测试未在 Windows 执行；应以 `apple-virtual-tests.yml` 的 macOS iPhone/iPad simulator 结果作为权威证据。

## 8. 回滚策略

1. 每个切片单独提交，按 **测试契约 → iOS CSS → runtime 门控/接入 → 生命周期 → 单一来源** 排序。
2. 使用平台 feature flag 或是否注册 iOS `WKUserScript` 作为快速关闭点；出现严重回归时先停用 iOS runtime，保留 SwiftUI/代理核心。
3. Android 基准在切片 B 前不改；切片 C 对 runtime 的改动必须保证 Android 默认分支行为不变。
4. 资源迁移切片必须可通过恢复旧 assets/resources 路径单独回滚，不与协议或发布脚本绑定。
5. 配对存储格式、稳定 origin、Relay codec 与签名流程不属于本轮兼容对齐范围；若它们发生变化，应独立评审和回滚。

## 9. 合并/发布阻断条件

出现以下任一情况应阻断合并或发布：

- Android 定向 Node 测试、Gradle unit/lint/debug build 失败。
- iPhone 或 iPad simulator 任一目标无法生成工程、编译或测试。
- iOS 显示 Android 跨 App 控制入口，或移动端开始写入模型凭据。
- 断网/前后台恢复导致 WKWebView 被无条件重建、草稿或附件丢失。
- 外部 URL 在内嵌 WebView 中打开，或配对校验接受公网/带凭据目标。
- CSS/runtime 未打包、重复注入、SPA 重渲染后失效，或流式输出出现明显卡顿。
- Android 产物未签名/签名来源不符，或尝试分发未签名 iOS IPA。
