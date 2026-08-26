import SwiftUI

/// 根视图。导航层级：工作台（已配对）↔ 配对页（未配对）；
/// 连接状态作为“状态层级”以横幅形式浮在工作台上，连接中断时保留页面便于重试。
struct ContentView: View {
    @EnvironmentObject private var model: MobileSessionViewModel
    @Environment(\.openURL) private var openURL
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    @State private var manualCode = ""
    @State private var confirmForget = false
    @State private var workbenchLoading = false

    var body: some View {
        NavigationStack {
            Group {
                if let url = model.workbenchURL {
                    workbench(url)
                } else {
                    PairingView(manualCode: $manualCode, confirmForget: $confirmForget)
                }
            }
            .navigationTitle("DeepSeek Harness")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItemGroup(placement: .navigationBarTrailing) {
                    if model.isPaired {
                        Button {
                            model.retry()
                        } label: {
                            Image(systemName: "arrow.clockwise")
                        }
                        .disabled(model.state == .connected)
                        .accessibilityLabel("重新连接")
                        .accessibilityHint("使用已保存的电脑重新建立连接")
                        Button("忘记电脑") { confirmForget = true }
                            .accessibilityHint("清除本机保存的配对信息和登录数据")
                    }
                }
            }
        }
        .fullScreenCover(isPresented: $model.scannerPresented) {
            QRScannerView(
                onCode: { model.connect($0) },
                onCancel: { model.scannerPresented = false }
            )
            .ignoresSafeArea()
        }
        .confirmationDialog("忘记已配对的 Desktop？", isPresented: $confirmForget, titleVisibility: .visible) {
            Button("忘记并清除本机登录数据", role: .destructive) { model.forgetDesktop() }
            Button("取消", role: .cancel) {}
        }
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
        .onChange(of: model.networkMonitor.generation) { _ in model.networkChanged() }
        .animation(reduceMotion ? nil : .easeInOut(duration: 0.25), value: model.state)
    }

    // MARK: - 工作台（保留页面，状态作为横幅叠加）

    private func workbench(_ url: URL) -> some View {
        ZStack(alignment: .top) {
            WorkbenchView(
                url: url,
                onLoadingChange: { workbenchLoading = $0 },
                onFailure: { model.workbenchFailed($0) }
            )
            .ignoresSafeArea()

            if workbenchLoading {
                ProgressView("正在加载工作台…")
                    .padding(16)
                    .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 14))
                    .frame(maxHeight: .infinity, alignment: .center)
            }

            bannerOverlay
        }
    }

    @ViewBuilder private var bannerOverlay: some View {
        switch model.state {
        case .connecting(let detail):
            StatusBannerView(style: .connecting, text: detail)
                .padding(.top, 8)
                .transition(.move(edge: .top).combined(with: .opacity))
        case .failed(let message):
            StatusBannerView(style: .error, text: message, actionTitle: "重试") { model.retry() }
                .padding(.top, 8)
                .transition(.move(edge: .top).combined(with: .opacity))
        default:
            EmptyView()
        }
    }
}