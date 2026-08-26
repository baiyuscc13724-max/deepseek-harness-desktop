import SwiftUI

/// 连接状态横幅：连接中（进度）或出错（可带重试动作）。
/// 用于工作台页与配对页的“状态层级”，随 Dynamic Type 缩放，并为 VoiceOver 提供实时播报。
struct StatusBannerView: View {
    enum Style {
        case connecting
        case error
    }

    let style: Style
    let text: String
    var actionTitle: String?
    var action: (() -> Void)?

    init(style: Style, text: String, actionTitle: String? = nil, action: (() -> Void)? = nil) {
        self.style = style
        self.text = text
        self.actionTitle = actionTitle
        self.action = action
    }

    var body: some View {
        HStack(spacing: 12) {
            leadingIcon
                .accessibilityHidden(true)
            Text(text)
                .font(.subheadline.weight(.medium))
                .foregroundStyle(style == .error ? Color.red : Color.primary)
                .frame(maxWidth: .infinity, alignment: .leading)
                .accessibilityLabel(style == .error ? "连接失败：\(text)" : text)
            if let actionTitle, let action {
                Button(actionTitle) { action() }
                    .font(.subheadline.weight(.semibold))
                    .buttonStyle(.bordered)
                    .controlSize(.small)
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 14))
        .overlay(
            RoundedRectangle(cornerRadius: 14)
                .strokeBorder(style == .error ? Color.red.opacity(0.35) : Color.secondary.opacity(0.25))
        )
        .accessibilityElement(children: .contain)
        .accessibilityAddTraits(.updatesFrequently)
    }

    @ViewBuilder private var leadingIcon: some View {
        switch style {
        case .connecting:
            ProgressView().controlSize(.small)
        case .error:
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundStyle(.yellow)
        }
    }
}