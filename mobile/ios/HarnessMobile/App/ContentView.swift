import SwiftUI

struct ContentView: View {
    @EnvironmentObject private var model: MobileSessionViewModel
    @Environment(\.openURL) private var openURL
    @State private var manualCode = ""
    @State private var confirmForget = false

    var body: some View {
        NavigationStack {
            Group {
                if let url = model.workbenchURL, model.state == .connected {
                    WorkbenchView(url: url) { message in model.retry() }
                } else {
                    setup
                }
            }
            .navigationTitle("DeepSeek Harness")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                if model.workbenchURL != nil {
                    ToolbarItem(placement: .topBarTrailing) { Button("忘记电脑") { confirmForget = true } }
                }
            }
        }
        .sheet(isPresented: $model.scannerPresented) {
            QRScannerView(onCode: model.connect, onCancel: { model.scannerPresented = false }).ignoresSafeArea()
        }
        .confirmationDialog("忘记已配对的 Desktop？", isPresented: $confirmForget, titleVisibility: .visible) {
            Button("忘记并清除本机登录数据", role: .destructive) { model.forgetDesktop() }
            Button("取消", role: .cancel) {}
        }
        .onChange(of: model.networkMonitor.generation) { _ in model.networkChanged() }
        .alert("手机 App 有新版本", isPresented: Binding(
            get: { model.availableAppUpdate != nil },
            set: { if !$0 { model.dismissOptionalAppUpdate() } }
        )) {
            if let update = model.availableAppUpdate {
                Button("前往 App Store / TestFlight") { openURL(update.storeURL) }
                if !update.required { Button("稍后", role: .cancel) { model.dismissOptionalAppUpdate() } }
            }
        } message: {
            if let update = model.availableAppUpdate {
                Text("iOS/iPadOS 版 \(update.version) 已可用。按照 Apple 平台规则，更新只由 App Store 或 TestFlight 完成，App 不会自行安装 IPA。")
            }
        }
    }

    private var setup: some View {
        ScrollView {
            VStack(spacing: 18) {
                Image(systemName: "laptopcomputer.and.iphone")
                    .font(.system(size: 58, weight: .medium)).foregroundStyle(.teal)
                Text("连接 Harness Desktop").font(.title2.bold())
                Text(statusText).foregroundStyle(.secondary).multilineTextAlignment(.center)
                Button { model.scannerPresented = true } label: {
                    Label("扫描电脑上的配对二维码", systemImage: "qrcode.viewfinder").frame(maxWidth: .infinity)
                }.buttonStyle(.borderedProminent).controlSize(.large)
                TextField("或粘贴 harnessmobile:// 配对地址", text: $manualCode, axis: .vertical)
                    .textInputAutocapitalization(.never).autocorrectionDisabled().textFieldStyle(.roundedBorder)
                Button("连接") { model.connect(manualCode) }.buttonStyle(.bordered).disabled(manualCode.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                if case .failed = model.state { Button("重试已保存的电脑") { model.retry() } }
                Divider().padding(.vertical, 4)
                Label("优先使用局域网；不可达时自动使用端到端加密的 WSS/443 后备线路。", systemImage: "lock.shield")
                    .font(.footnote).foregroundStyle(.secondary)
                Text("iOS/iPadOS 版可安全访问 Harness 工作台，但不会也不能像 Android 无障碍服务一样控制其他 App。")
                    .font(.footnote).foregroundStyle(.secondary)
            }
            .padding(28).frame(maxWidth: 540)
        }
    }

    private var statusText: String {
        switch model.state {
        case .unpaired: return "在电脑端打开“手机同步”，然后扫描一次性二维码。"
        case .connecting(let detail): return detail
        case .connected: return "已连接"
        case .failed(let message): return message
        }
    }
}
