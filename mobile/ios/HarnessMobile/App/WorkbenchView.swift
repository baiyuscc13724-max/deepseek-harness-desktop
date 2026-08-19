import SwiftUI
import WebKit

struct WorkbenchView: UIViewRepresentable {
    let url: URL
    let onFailure: (String) -> Void

    func makeCoordinator() -> Coordinator { Coordinator(onFailure: onFailure) }

    func makeUIView(context: Context) -> WKWebView {
        let controller = WKUserContentController()
        controller.addUserScript(WKUserScript(source: """
          Object.defineProperty(window, 'HarnessMobilePlatform', { value: 'ios', configurable: false });
          Object.defineProperty(window, 'HarnessMobileControl', { value: Object.freeze({ status: () => 'unsupported-ios' }), configurable: false });
        """, injectionTime: .atDocumentStart, forMainFrameOnly: false))
        let configuration = WKWebViewConfiguration()
        configuration.userContentController = controller
        configuration.websiteDataStore = .default()
        configuration.allowsInlineMediaPlayback = true
        configuration.mediaTypesRequiringUserActionForPlayback = .all
        configuration.applicationNameForUserAgent = "HarnessMobile/1 iOS"
        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = context.coordinator
        webView.allowsBackForwardNavigationGestures = true
        webView.scrollView.keyboardDismissMode = .interactive
        webView.load(URLRequest(url: url, cachePolicy: .reloadRevalidatingCacheData, timeoutInterval: 30))
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        if webView.url != url { webView.load(URLRequest(url: url, cachePolicy: .reloadRevalidatingCacheData, timeoutInterval: 30)) }
    }

    final class Coordinator: NSObject, WKNavigationDelegate {
        let onFailure: (String) -> Void
        init(onFailure: @escaping (String) -> Void) { self.onFailure = onFailure }

        func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            guard let target = navigationAction.request.url else { decisionHandler(.cancel); return }
            if target.scheme == "http", target.host == PairingProfile.stableHost { decisionHandler(.allow); return }
            if target.scheme == "about" { decisionHandler(.allow); return }
            if ["https", "http"].contains(target.scheme?.lowercased() ?? ""), navigationAction.navigationType == .linkActivated {
                UIApplication.shared.open(target)
            }
            decisionHandler(.cancel)
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { onFailure(error.localizedDescription) }
        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { onFailure(error.localizedDescription) }
    }
}
