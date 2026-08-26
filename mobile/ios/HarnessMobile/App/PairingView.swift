import SwiftUI

/// 配对页：未配对时的引导空状态、配对流程中的进度/错误状态、
/// 已配对电脑的重新连接入口。所有文案以 LocalizedStringKey 字面量给出，
/// 随系统字体（Dynamic Type）、深色模式自适应。
struct PairingView: View {
    @EnvironmentObject private var model: MobileSessionViewModel
    @Binding var manualCode: String
    @Binding var confirmForget: Bool

    @ScaledMetric(relativeTo: .largeTitle) private var heroSize: CGFloat = 56

    private var canSubmitManualCode: Bool {
        !manualCode.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 22) {
                hero
                if model.isPaired, let summary = model.connectionSummary {
                    savedDesktopCard(summary)
                }
                stateMessage
                scanButton
                manualEntry
                securityFootnotes
            }
            .padding(24)
            .frame(maxWidth: 560)
            .frame(maxWidth: .infinity)
        }
        .scrollDismissesKeyboard(.interactively)
    }

    // MARK: - 顶部引导

    private var hero: some View {
        VStack(spacing: 14) {
            Image(systemName: "laptopcomputer.and.iphone")
                .font(.system(size: heroSize, weight: .medium))
                .foregroundStyle(.teal)
                .accessibilityHidden(true)
            Text("连接 Harness Desktop")
                .font(.title2.weight(.semibold))
            Text(heroSubtitle)
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
        .multilineTextAlignment(.center)
    }

    private var heroSubtitle: LocalizedStringKey {
        if model.isPaired {
            return "重新连接或更换电脑。"
        }
        return "在电脑上打开 Harness Desktop，进入「手机同步」，扫描屏幕上的配对二维码。"
    }

    // MARK: - 已配对的电脑

    private func savedDesktopCard(_ summary: String) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Label("已配对的电脑", systemImage: "desktopcomputer")
                .font(.headline)
            Text(summary)
                .font(.subheadline)
                .foregroundStyle(.secondary)
            HStack {
                Button {
                    model.retry()
                } label: {
                    Label("重新连接", systemImage: "arrow.clockwise")
                }
                .buttonStyle(.bordered)
                .disabled(model.state == .connected)
                .accessibilityHint("使用已保存的配对信息重新连接这台电脑")
                Spacer()
                Button("忘记电脑", role: .destructive) { confirmForget = true }
                    .buttonStyle(.borderless)
                    .accessibilityHint("清除本机保存的配对信息和登录数据")
            }
        }
        .padding(16)
        .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 16))
        .accessibilityElement(children: .contain)
    }

    // MARK: - 当前连接状态

    @ViewBuilder private var stateMessage: some View {
        switch model.state {
        case .unpaired, .connected:
            EmptyView()
        case .connecting(let detail):
            HStack(spacing: 12) {
                ProgressView()
                    .controlSize(.small)
                    .accessibilityHidden(true)
                Text(detail)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(14)
            .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 12))
            .accessibilityElement(children: .combine)
            .accessibilityAddTraits(.updatesFrequently)
        case .failed(let message):
            if model.isPaired {
                StatusBannerView(style: .error, text: message, actionTitle: "重试") { model.retry() }
            } else {
                StatusBannerView(style: .error, text: message)
            }
        }
    }

    // MARK: - 扫描与手动配对

    private var scanButton: some View {
        Button {
            model.scannerPresented = true
        } label: {
            Label("扫描电脑上的配对二维码", systemImage: "qrcode.viewfinder")
                .frame(maxWidth: .infinity)
        }
        .buttonStyle(.borderedProminent)
        .controlSize(.large)
        .accessibilityHint("打开相机扫描配对二维码，需要相机权限。")
    }

    private var manualEntry: some View {
        VStack(spacing: 10) {
            Divider()
            TextField("或粘贴 harnessmobile:// 配对地址", text: $manualCode, axis: .vertical)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .keyboardType(.URL)
                .textFieldStyle(.roundedBorder)
                .accessibilityLabel("配对地址")
                .submitLabel(.go)
                .onSubmit { model.connect(manualCode) }
            Button {
                model.connect(manualCode)
            } label: {
                Text("连接")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.bordered)
            .disabled(!canSubmitManualCode)
        }
    }

    // MARK: - 安全说明

    private var securityFootnotes: some View {
        VStack(spacing: 10) {
            Label("优先使用局域网；不可达时自动使用端到端加密的 WSS/443 后备线路。", systemImage: "lock.shield")
                .font(.footnote)
                .foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, alignment: .leading)
            Text("iOS/iPadOS 版可安全访问 Harness 工作台，但不会也不能像 Android 无障碍服务一样控制其他 App。")
                .font(.footnote)
                .foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.top, 4)
    }
}