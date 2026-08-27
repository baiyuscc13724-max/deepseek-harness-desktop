import SwiftUI
import UIKit
import WebKit

/// Harness 工作台的 WKWebView 容器。
///
/// 附件入口由本 App 注入到移动端会话输入栏，再复用官方会话 UI 已有的
/// `paste -> intakeImages` 管线完成限额校验、预览、移除和发送。文件仍由用户
/// 通过 WebKit 的系统选择面板主动选择；App 不申请相册整库或文件系统权限。
///
/// Apple 将 `WKUIDelegate.runOpenPanel` 标为 iOS/iPadOS 18.4+。项目最低支持
/// iOS 16，因此这里刻意不实现该方法：Apple 文档明确说明 iOS 默认启用文件
/// 上传面板。这样 iOS 16–18.3 可编译可用，18.4+ 也继续使用系统默认面板。
struct WorkbenchView: UIViewRepresentable {
    let url: URL
    var onLoadingChange: (Bool) -> Void = { _ in }
    var onFailure: (String) -> Void

    init(url: URL, onLoadingChange: @escaping (Bool) -> Void = { _ in }, onFailure: @escaping (String) -> Void) {
        self.url = url
        self.onLoadingChange = onLoadingChange
        self.onFailure = onFailure
    }

    func makeCoordinator() -> Coordinator {
        Coordinator(onLoadingChange: onLoadingChange, onFailure: onFailure)
    }

    func makeUIView(context: Context) -> WKWebView {
        let controller = WKUserContentController()
        controller.addUserScript(WKUserScript(source: """
          Object.defineProperty(window, 'HarnessMobilePlatform', { value: 'ios', configurable: false });
          Object.defineProperty(window, 'HarnessMobileControl', { value: Object.freeze({ status: () => 'unsupported-ios' }), configurable: false });
        """, injectionTime: .atDocumentStart, forMainFrameOnly: false))
        if let styleScript = Self.mobileStyleScript() {
            controller.addUserScript(styleScript)
        }
        if let runtimeScript = Self.mobileRuntimeScript() {
            controller.addUserScript(runtimeScript)
        }
        controller.addUserScript(WKUserScript(
            source: Self.mobileAttachmentScript,
            injectionTime: .atDocumentEnd,
            forMainFrameOnly: true
        ))

        let configuration = WKWebViewConfiguration()
        configuration.userContentController = controller
        configuration.websiteDataStore = .default()
        configuration.allowsInlineMediaPlayback = true
        configuration.mediaTypesRequiringUserActionForPlayback = .all
        configuration.applicationNameForUserAgent = "HarnessMobile/1 iOS"

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = context.coordinator
        webView.uiDelegate = context.coordinator
        webView.allowsBackForwardNavigationGestures = true
        webView.scrollView.keyboardDismissMode = .interactive
        webView.load(URLRequest(url: url, cachePolicy: .reloadRevalidatingCacheData, timeoutInterval: 30))
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        if webView.url != url {
            webView.load(URLRequest(url: url, cachePolicy: .reloadRevalidatingCacheData, timeoutInterval: 30))
        }
    }

    /// 把经过 Android 验证的 Orbit 移动样式作为只读 bundle 资源注入。
    /// 使用固定 style id 保证 SPA 重载和重复 makeUIView 时仍然幂等。
    private static func mobileStyleScript() -> WKUserScript? {
        guard let resource = Bundle.main.url(forResource: "mobile-compat", withExtension: "css"),
              let css = try? String(contentsOf: resource, encoding: .utf8),
              let data = try? JSONSerialization.data(withJSONObject: [css]),
              let arrayLiteral = String(data: data, encoding: .utf8),
              arrayLiteral.count >= 2 else {
            return nil
        }
        let cssLiteral = String(arrayLiteral.dropFirst().dropLast())
        let source = """
        (() => {
          const id = 'harness-mobile-compat';
          let style = document.getElementById(id);
          if (!style) {
            style = document.createElement('style');
            style.id = id;
            (document.head || document.documentElement).appendChild(style);
          }
          const css = \(cssLiteral);
          if (style.textContent !== css) style.textContent = css;
          document.documentElement.dataset.harnessMobile = 'true';
          document.documentElement.dataset.harnessMobilePlatform = 'ios';
          return true;
        })();
        """
        return WKUserScript(source: source, injectionTime: .atDocumentEnd, forMainFrameOnly: true)
    }

    /// 注入共享移动 runtime。平台标识已在 document start 固定为 iOS，
    /// runtime 的显式 capability gate 会跳过 Android 原生 IME、截图和控制入口。
    private static func mobileRuntimeScript() -> WKUserScript? {
        guard let resource = Bundle.main.url(forResource: "mobile-runtime", withExtension: "js"),
              let source = try? String(contentsOf: resource, encoding: .utf8) else {
            return nil
        }
        return WKUserScript(source: source, injectionTime: .atDocumentEnd, forMainFrameOnly: true)
    }

    /// 为官方移动工作台补上触屏设备需要的显式附件入口。
    /// 官方输入栏已经处理粘贴图片、附件预览、限额和失败提示；这里不复制业务逻辑。
    private static let mobileAttachmentScript = #"""
    (() => {
      if (window.__harnessMobileAttachmentInstaller) {
        window.__harnessMobileAttachmentInstaller();
        return;
      }

      const buttonAttribute = 'data-harness-mobile-add-photo';
      const inputAttribute = 'data-harness-mobile-photo-input';

      const deliverFiles = (textarea, input) => {
        const files = Array.from(input.files || []);
        if (!files.length) return;
        const clipboardData = {
          items: files.map(file => ({ kind: 'file', type: file.type, getAsFile: () => file })),
          files,
          types: ['Files'],
          getData: () => ''
        };
        const event = new Event('paste', { bubbles: true, cancelable: true });
        Object.defineProperty(event, 'clipboardData', { configurable: true, value: clipboardData });
        textarea.dispatchEvent(event);
        input.value = '';
        textarea.focus({ preventScroll: true });
      };

      const install = () => {
        document.querySelectorAll('[data-composer-card]').forEach(card => {
          const textarea = card.querySelector('textarea[data-phase]');
          const commandButton = card.querySelector('button[aria-haspopup="listbox"]');
          const tools = commandButton && commandButton.parentElement;
          if (!textarea || !tools || card.querySelector(`[${buttonAttribute}]`)) return;

          const input = document.createElement('input');
          input.type = 'file';
          input.accept = 'image/*';
          input.multiple = true;
          input.setAttribute(inputAttribute, 'true');
          input.setAttribute('aria-hidden', 'true');
          input.tabIndex = -1;
          input.style.display = 'none';
          input.addEventListener('change', () => deliverFiles(textarea, input));

          const button = document.createElement('button');
          button.type = 'button';
          button.setAttribute(buttonAttribute, 'true');
          button.setAttribute('aria-label', '添加照片或截图');
          button.setAttribute('title', '添加照片或截图');
          button.textContent = '照片';
          button.style.cssText = [
            'box-sizing:border-box',
            'min-width:52px',
            'min-height:44px',
            'padding:0 10px',
            'border:0',
            'border-radius:12px',
            'background:transparent',
            'color:inherit',
            'font:inherit',
            'font-size:13px',
            'font-weight:600',
            'touch-action:manipulation'
          ].join(';');
          const syncDisabled = () => {
            button.disabled = textarea.disabled || textarea.readOnly;
            button.style.opacity = button.disabled ? '0.45' : '1';
          };
          button.addEventListener('click', event => {
            event.preventDefault();
            if (!button.disabled) input.click();
          });
          new MutationObserver(syncDisabled).observe(textarea, {
            attributes: true,
            attributeFilter: ['disabled', 'readonly', 'data-phase']
          });
          syncDisabled();
          card.appendChild(input);
          tools.insertBefore(button, commandButton);
        });
      };

      window.__harnessMobileAttachmentInstaller = install;
      install();
      new MutationObserver(install).observe(document.documentElement, { childList: true, subtree: true });
    })();
    """#

    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate {
        let onLoadingChange: (Bool) -> Void
        let onFailure: (String) -> Void

        init(onLoadingChange: @escaping (Bool) -> Void, onFailure: @escaping (String) -> Void) {
            self.onLoadingChange = onLoadingChange
            self.onFailure = onFailure
        }

        func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            guard let target = navigationAction.request.url else {
                decisionHandler(.cancel)
                return
            }
            if target.scheme == "http", target.host == PairingProfile.stableHost {
                decisionHandler(.allow)
                return
            }
            if target.scheme == "about" {
                decisionHandler(.allow)
                return
            }
            if ["https", "http"].contains(target.scheme?.lowercased() ?? ""), navigationAction.navigationType == .linkActivated {
                UIApplication.shared.open(target)
            }
            decisionHandler(.cancel)
        }

        func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
            onLoadingChange(true)
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            onLoadingChange(false)
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            onLoadingChange(false)
            onFailure(error.localizedDescription)
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            onLoadingChange(false)
            onFailure(error.localizedDescription)
        }

        func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
            guard let presenter = topViewController() else {
                completionHandler()
                return
            }
            let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
            alert.addAction(UIAlertAction(title: "好", style: .default) { _ in completionHandler() })
            presenter.present(alert, animated: true)
        }

        func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
            guard let presenter = topViewController() else {
                completionHandler(false)
                return
            }
            let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
            alert.addAction(UIAlertAction(title: "取消", style: .cancel) { _ in completionHandler(false) })
            alert.addAction(UIAlertAction(title: "确定", style: .default) { _ in completionHandler(true) })
            presenter.present(alert, animated: true)
        }

        func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (String?) -> Void) {
            guard let presenter = topViewController() else {
                completionHandler(nil)
                return
            }
            let alert = UIAlertController(title: nil, message: prompt, preferredStyle: .alert)
            alert.addTextField { field in
                field.text = defaultText ?? ""
                field.clearButtonMode = .whileEditing
            }
            alert.addAction(UIAlertAction(title: "取消", style: .cancel) { _ in completionHandler(nil) })
            alert.addAction(UIAlertAction(title: "确定", style: .default) { _ in
                completionHandler(alert.textFields?.first?.text ?? "")
            })
            presenter.present(alert, animated: true)
        }

        private func topViewController() -> UIViewController? {
            guard let scene = UIApplication.shared.connectedScenes
                .compactMap({ $0 as? UIWindowScene })
                .first(where: { $0.activationState == .foregroundActive }),
                  let root = scene.windows.first(where: { $0.isKeyWindow })?.rootViewController else {
                return nil
            }
            var top = root
            while let presented = top.presentedViewController {
                top = presented
            }
            return top
        }
    }
}
