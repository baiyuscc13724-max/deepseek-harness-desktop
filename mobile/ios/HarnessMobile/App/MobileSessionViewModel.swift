import Foundation
import WebKit

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

    func connect(_ value: String) {
        guard let next = PairingProfile.parse(value) else {
            state = .failed("二维码或连接地址无效，请在 Desktop 重新生成配对二维码。")
            return
        }
        do { try store.save(next) }
        catch { state = .failed(error.localizedDescription); return }
        profile = next
        scannerPresented = false
        Task { await activate(next, pairing: true) }
    }

    func handleDeepLink(_ url: URL) { connect(url.absoluteString) }

    func networkChanged() {
        guard networkMonitor.generation != lastNetworkGeneration, let profile else { return }
        lastNetworkGeneration = networkMonitor.generation
        proxy?.networkChanged()
        state = networkMonitor.available ? .connecting("网络已切换，正在重新连接…") : .connecting("网络已断开，恢复后会自动连接…")
        guard networkMonitor.available else { return }
        Task { await activate(profile, pairing: false) }
    }

    func retry() {
        guard let profile else { return }
        Task { await activate(profile, pairing: false) }
    }

    func forgetDesktop() {
        store.forget()
        profile = nil
        workbenchURL = nil
        proxy?.stop()
        proxy = nil
        WKWebsiteDataStore.default().removeData(ofTypes: WKWebsiteDataStore.allWebsiteDataTypes(), modifiedSince: .distantPast) {}
        state = .unpaired
    }

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
