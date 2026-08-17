# Harness Mobile（Android）

这是 Harness Desktop 的 Android 伴侣应用，不复制 DeepSeek Harness 的会话协议或会话数据库。

- 手机通过一次性二维码与电脑配对。
- 配对后，Android WebView 加载电脑当前运行的官方 Harness Web 工作台。
- HTTP、流式响应和 WebSocket 均由桌面端按字节转发；手机端不理解官方内部 API。
- 同一网络时优先局域网直连，离开局域网后可由内置 EasyTier 线路接管；线路恢复后会自动重连。
- 官方发生破坏性更新时，优先只调整桌面端 `mobile-sync-service.cjs` 的运行目标适配，不重写手机界面。

## 使用

1. 首次配对时让电脑与 Android 手机处于同一个本人信任的网络。
2. 在 Harness Desktop 设置中打开“手机同步”，生成二维码。
3. 安装并打开 Harness Mobile，扫描二维码；也可以粘贴电脑端显示的配对地址。
4. 配对完成后，手机会打开电脑上的同一个工作台。之后重启应用无需重复扫码，连接开关会控制自动连接和断开。

局域网通道有设备鉴权但不加密，不要在公共 Wi-Fi 使用。异地通道依赖第三方协调或中继基础设施，电脑端始终需要保持运行。完整边界见 `docs/MOBILE_SYNC_ARCHITECTURE.zh-CN.md`。

## 本地构建

要求：JDK 21、Android SDK 35。

```powershell
$env:JAVA_HOME='C:\Program Files\Eclipse Adoptium\jdk-21.0.12.8-hotspot'
$env:ANDROID_SDK_ROOT='D:\Android\Sdk'
.\gradlew.bat testDebugUnitTest assembleDebug
```

APK 输出：`app/build/outputs/apk/debug/app-debug.apk`。
