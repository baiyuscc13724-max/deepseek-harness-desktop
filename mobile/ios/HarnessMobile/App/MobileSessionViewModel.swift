import Foundation
import WebKit

/// 会话状态模型。仅依赖 Core（PairingProfile / PairingStore / LoopbackProxy /
/// NetworkMonitor / MobileAppUpdateChecker），不改变 Core 协议层。
@MainActor
final class MobileSessionViewModel: ObservableObject {
    enum State: Equatable {
        case unpaired
        case connecting(String)
        case connected
        case failed(String)
    }

    @Published private(set) var state: State = .unpaired
    @Published private(set) var workbenchURL: URL?
    @Published var scannerPresented = false
    @Published var availableAppUpdate: MobileAppUpdate?

    let networkMonitor = NetworkMonitor()

    private let store = PairingStore()
    private var profile: PairingProfile?
    private var proxy: LoopbackProxy?
    private var lastNetworkGeneration: UInt64 = 0

    init() {
        if let stored = store.load() {
            profile = stored
            Task { await activate(stored, pairing: false) }
        }
        checkForMobileAppUpdate()
    }

    // MARK: - 供界面使用的派生状态（状态层级：配对 → 连接中 → 工作台 / 失败重连）

    /// 是否已保存过一台 Desktop（无论当前是否可用）。
    var isPaired: Bool { profile != nil }

    /// 已配对 Desktop 的主机名。
    var pairedDesktopHost: String? { profile?.pairURL.host }

    /// 是否存在 WSS/443 加密后备线路。
    var usesRelayFallback: Bool { profile?.relay != nil }

    /// 已配对连接的一句话摘要，用于“最近使用的电脑”卡片。
    var connectionSummary: String? {
        guard let profile else { return nil }
        let host = profile.pairURL.host ?? "Desktop"
        return profile.relay == nil
            ? "\(host) · 局域网直连"
            : "\(host) · 局域网优先，必要时经加密中继"
    }

    /// 正在连接时的进度文案。
    var connectingDetail: String? {
        if case .connecting(let detail) = state { return detail }
        return nil
    }

    /// 失败原因。
    var failureMessage: String? {
        if case .failed(let message) = state { return message }
        return nil
    }

    // MARK: - 应用更新检查（前台可选检查，失败不阻塞配对）

    func checkForMobileAppUpdate() {
        guard let value = Bundle.main.object(forInfoDictionaryKey: "HarnessMobileUpdateManifestURL") as? String,
              !value.isEmpty, let manifestURL = URL(string: value) else { return }
        let currentVersion = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0.0.0"
        Task {
            do { availableAppUpdate = try await MobileAppUpdateChecker.check(manifestURL: manifestURL, currentVersion: currentVersion) }
            catch { /* A failed optional foreground update check must not block pairing. */ }
        }
    }

    func dismissOptionalAppUpdate() {
        guard availableAppUpdate?.required != true else { return }
        availableAppUpdate = nil
    }

    // MARK: - 配对

    func connect(_ value: String) {
        guard let next = PairingProfile.parse(value) else {
            scannerPresented = false
            state = .failed("二维码或连接地址无效，请在 Desktop 重新生成配对二维码。")
            return
        }
        do { try store.save(next) }
        catch {
            scannerPresented = false
            state = .failed(error.localizedDescription)
            return
        }
        profile = next
        scannerPresented = false
        Task { await activate(next, pairing: true) }
    }

    func handleDeepLink(_ url: URL) { connect(url.absoluteString) }

    // MARK: - 连接 / 重连

    /// 用已保存的配对信息重新连接。
    func retry() {
        guard let profile else { return }
        Task { await activate(profile, pairing: false) }
    }

    /// 工作台页加载失败时上报（保持工作台页面，便于用户重试）。
    func workbenchFailed(_ detail: String) {
        guard workbenchURL != nil else { return }
        state = .failed(detail.isEmpty ? "工作台加载失败，请重试。" : detail)
    }

    func networkChanged() {
        guard networkMonitor.generation != lastNetworkGeneration, let profile else { return }
        lastNetworkGeneration = networkMonitor.generation
        proxy?.networkChanged()
        state = networkMonitor.available ? .connecting("网络已切换，正在重新连接…") : .connecting("网络已断开，恢复后会自动连接…")
        guard networkMonitor.available else { return }
        Task { await activate(profile, pairing: false) }
    }

    // MARK: - 忘记配对

    func forgetDesktop() {
        store.forget()
        profile = nil
        workbenchURL = nil
        proxy?.stop()
        proxy = nil
        WKWebsiteDataStore.default().removeData(ofTypes: WKWebsiteDataStore.allWebsiteDataTypes(), modifiedSince: .distantPast) {}
        state = .unpaired
    }

    // MARK: - 内部

    private func activate(_ profile: PairingProfile, pairing: Bool) async {
        state = .connecting(profile.relay == nil ? "正在连接 Desktop…" : "正在尝试局域网，必要时切换 WSS/443 加密线路…")
        do {
            let activeProxy: LoopbackProxy
            if let proxy {
                activeProxy = proxy
                proxy.update(profile: profile)
            } else {
                activeProxy = LoopbackProxy(profile: profile)
                proxy = activeProxy
            }
            let port = try await activeProxy.start()
            workbenchURL = pairing ? profile.stablePairURL(localPort: port) : profile.stableOrigin(localPort: port)
            state = .connected
        } catch {
            state = .failed(error.localizedDescription)
        }
    }
}