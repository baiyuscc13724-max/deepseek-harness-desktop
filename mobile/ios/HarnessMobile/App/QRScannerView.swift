import AVFoundation
import SwiftUI
import UIKit

/// 二维码扫描页。适配权限被拒/相机不可用等状态：不再直接关闭页面，
/// 而是给出解释与“打开设置”入口；支持 Dynamic Type 与 VoiceOver。
struct QRScannerView: UIViewControllerRepresentable {
    let onCode: (String) -> Void
    let onCancel: () -> Void

    func makeUIViewController(context: Context) -> QRScannerViewController {
        let controller = QRScannerViewController()
        controller.onCode = onCode
        controller.onCancel = onCancel
        return controller
    }

    func updateUIViewController(_ uiViewController: QRScannerViewController, context: Context) {}
}

final class QRScannerViewController: UIViewController, AVCaptureMetadataOutputObjectsDelegate {
    var onCode: ((String) -> Void)?
    var onCancel: (() -> Void)?

    private enum ScannerIssue {
        case denied
        case cameraUnavailable
    }

    private let session = AVCaptureSession()
    private var preview: AVCaptureVideoPreviewLayer?
    private var completed = false
    private var issueView: UIStackView?

    private let titleLabel = UILabel()
    private let cancelButton = UIButton(type: .system)
    private let finderFrame = UIView()
    private let instructionLabel = UILabel()

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        buildChrome()
        requestCameraAndStart()
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        preview?.frame = view.bounds
    }

    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        session.stopRunning()
    }

    // MARK: - 界面骨架（Dynamic Type + VoiceOver）

    private func buildChrome() {
        titleLabel.text = "扫描配对二维码"
        titleLabel.font = .preferredFont(forTextStyle: .headline)
        titleLabel.adjustsFontForContentSizeCategory = true
        titleLabel.textColor = .white
        titleLabel.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(titleLabel)

        cancelButton.setImage(UIImage(systemName: "xmark"), for: .normal)
        cancelButton.tintColor = .white
        cancelButton.accessibilityLabel = "取消扫描"
        cancelButton.accessibilityHint = "关闭二维码扫描"
        cancelButton.addTarget(self, action: #selector(cancelScan), for: .touchUpInside)
        cancelButton.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(cancelButton)

        finderFrame.layer.borderColor = UIColor.white.withAlphaComponent(0.9).cgColor
        finderFrame.layer.borderWidth = 3
        finderFrame.layer.cornerRadius = 24
        finderFrame.isAccessibilityElement = false
        finderFrame.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(finderFrame)

        instructionLabel.text = "将二维码对齐到框内"
        instructionLabel.font = .preferredFont(forTextStyle: .subheadline)
        instructionLabel.adjustsFontForContentSizeCategory = true
        instructionLabel.textColor = .white.withAlphaComponent(0.92)
        instructionLabel.textAlignment = .center
        instructionLabel.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(instructionLabel)

        NSLayoutConstraint.activate([
            titleLabel.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 16),
            titleLabel.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 20),
            cancelButton.centerYAnchor.constraint(equalTo: titleLabel.centerYAnchor),
            cancelButton.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -20),
            cancelButton.widthAnchor.constraint(equalToConstant: 44),
            cancelButton.heightAnchor.constraint(equalToConstant: 44),
            finderFrame.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            finderFrame.centerYAnchor.constraint(equalTo: view.centerYAnchor),
            finderFrame.widthAnchor.constraint(equalToConstant: 264),
            finderFrame.heightAnchor.constraint(equalToConstant: 264),
            instructionLabel.topAnchor.constraint(equalTo: finderFrame.bottomAnchor, constant: 20),
            instructionLabel.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 32),
            instructionLabel.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -32)
        ])
    }

    // MARK: - 相机授权

    private func requestCameraAndStart() {
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized:
            configure()
        case .notDetermined:
            AVCaptureDevice.requestAccess(for: .video) { [weak self] allowed in
                DispatchQueue.main.async {
                    guard let self else { return }
                    if allowed {
                        self.configure()
                    } else {
                        self.showIssue(.denied)
                    }
                }
            }
        default:
            showIssue(.denied)
        }
    }

    private func configure() {
        guard let camera = AVCaptureDevice.default(for: .video),
              let input = try? AVCaptureDeviceInput(device: camera),
              session.canAddInput(input) else {
            showIssue(.cameraUnavailable)
            return
        }
        session.addInput(input)
        let output = AVCaptureMetadataOutput()
        guard session.canAddOutput(output) else { showIssue(.cameraUnavailable); return }
        session.addOutput(output)
        output.setMetadataObjectsDelegate(self, queue: .main)
        output.metadataObjectTypes = [.qr]
        let layer = AVCaptureVideoPreviewLayer(session: session)
        layer.videoGravity = .resizeAspectFill
        view.layer.insertSublayer(layer, at: 0)
        preview = layer
        view.layoutIfNeeded()
        DispatchQueue.global(qos: .userInitiated).async { [session] in session.startRunning() }
    }

    // MARK: - 权限/硬件异常状态

    private func showIssue(_ issue: ScannerIssue) {
        session.stopRunning()
        issueView?.removeFromSuperview()
        finderFrame.isHidden = true
        instructionLabel.isHidden = true

        let stack = UIStackView()
        stack.axis = .vertical
        stack.spacing = 14
        stack.alignment = .center
        stack.translatesAutoresizingMaskIntoConstraints = false

        let icon = UIImageView(image: UIImage(systemName: "camera.fill")?
            .withConfiguration(UIImage.SymbolConfiguration(pointSize: 40, weight: .regular)))
        icon.tintColor = .white
        icon.accessibilityElementsHidden = true

        let title = UILabel()
        title.text = issue == .denied ? "需要相机权限" : "相机不可用"
        title.font = UIFont.preferredFont(forTextStyle: .title3, weight: .semibold)
        title.adjustsFontForContentSizeCategory = true
        title.textColor = .white
        title.textAlignment = .center

        let body = UILabel()
        body.text = issue == .denied
            ? "请在系统设置中允许 DeepSeek Harness 使用相机，才能扫描配对二维码。"
            : "当前设备没有可用的摄像头。请在 Desktop 端选择“直接粘贴配对地址”，然后把链接粘贴到 App 中。"
        body.font = .preferredFont(forTextStyle: .body)
        body.adjustsFontForContentSizeCategory = true
        body.numberOfLines = 0
        body.textColor = UIColor(white: 1, alpha: 0.85)
        body.textAlignment = .center

        let actions = UIStackView()
        actions.axis = .horizontal
        actions.spacing = 12
        actions.distribution = .fillEqually
        actions.translatesAutoresizingMaskIntoConstraints = false

        let cancel = UIButton(type: .system)
        cancel.setTitle("取消", for: .normal)
        cancel.setTitleColor(.white, for: .normal)
        cancel.titleLabel?.font = UIFont.preferredFont(forTextStyle: .body, weight: .semibold)
        cancel.titleLabel?.adjustsFontForContentSizeCategory = true
        cancel.addTarget(self, action: #selector(cancelScan), for: .touchUpInside)
        cancel.accessibilityLabel = "取消扫描"

        if issue == .denied {
            let settings = UIButton(type: .system)
            settings.setTitle("打开设置", for: .normal)
            settings.setTitleColor(.systemTeal, for: .normal)
            settings.titleLabel?.font = UIFont.preferredFont(forTextStyle: .body, weight: .semibold)
            settings.titleLabel?.adjustsFontForContentSizeCategory = true
            settings.addTarget(self, action: #selector(openSettings), for: .touchUpInside)
            settings.accessibilityHint = "跳转到系统设置中的相机权限页面"
            actions.addArrangedSubview(cancel)
            actions.addArrangedSubview(settings)
        } else {
            actions.addArrangedSubview(cancel)
        }

        stack.addArrangedSubview(icon)
        stack.addArrangedSubview(title)
        stack.addArrangedSubview(body)
        stack.setCustomSpacing(26, after: body)
        stack.addArrangedSubview(actions)
        view.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            stack.centerYAnchor.constraint(equalTo: view.centerYAnchor),
            stack.leadingAnchor.constraint(greaterThanOrEqualTo: view.leadingAnchor, constant: 40),
            stack.trailingAnchor.constraint(lessThanOrEqualTo: view.trailingAnchor, constant: -40)
        ])
        issueView = stack
    }

    @objc private func openSettings() {
        guard let url = URL(string: UIApplication.openSettingsURLString) else { return }
        UIApplication.shared.open(url)
    }

    // MARK: - 识别

    func metadataOutput(_ output: AVCaptureMetadataOutput, didOutput metadataObjects: [AVMetadataObject], from connection: AVCaptureConnection) {
        guard !completed, let code = (metadataObjects.first as? AVMetadataMachineReadableCodeObject)?.stringValue else { return }
        completed = true
        session.stopRunning()
        UINotificationFeedbackGenerator().notificationOccurred(.success)
        UIAccessibility.post(notification: .announcement, argument: "已识别配对二维码")
        onCode?(code)
    }

    @objc private func cancelScan() { onCancel?() }
}

private extension UIFont {
    static func preferredFont(forTextStyle style: UIFont.TextStyle, weight: UIFont.Weight) -> UIFont {
        let descriptor = UIFontDescriptor.preferredFontDescriptor(withTextStyle: style)
        return UIFont.systemFont(ofSize: descriptor.pointSize, weight: weight)
    }
}