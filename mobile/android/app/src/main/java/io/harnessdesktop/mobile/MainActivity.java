package io.harnessdesktop.mobile;

import android.annotation.SuppressLint;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.graphics.Bitmap;
import android.net.Uri;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.View;
import android.webkit.CookieManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceResponse;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.ImageButton;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

import androidx.activity.OnBackPressedCallback;
import androidx.activity.result.ActivityResultLauncher;
import androidx.appcompat.app.AlertDialog;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout;

import com.journeyapps.barcodescanner.ScanContract;
import com.journeyapps.barcodescanner.ScanIntentResult;
import com.journeyapps.barcodescanner.ScanOptions;

import java.util.Locale;

public final class MainActivity extends AppCompatActivity {
    private static final String PREFS = "harness_mobile";
    private static final String SAVED_ORIGIN = "saved_origin";
    private static final String SAVED_PROFILE = "saved_profile";
    private static final long[] WORKBENCH_RETRY_DELAYS_MS = { 800L, 1500L, 2500L, 4000L, 5000L };

    private LinearLayout pairingPanel;
    private EditText pairingUrl;
    private TextView pairingError;
    private SwipeRefreshLayout swipeRefresh;
    private WebView webView;
    private ProgressBar loading;
    private ImageButton reconnectButton;
    private LinearLayout connectionOverlay;
    private TextView connectionStatus;
    private HarnessWebProxy localProxy;
    private EasyTierClient easyTierClient;
    private MobileUiAdapter mobileUiAdapter;
    private MobileAssetCache mobileAssetCache;
    private PairingProfile pairingProfile;
    private PairingProfile remoteReconnectProfile;
    private String pendingWorkbenchUrl;
    private int localGatewayPort;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private String retryableMainFrameUrl;
    private boolean workbenchRetryScheduled;
    private int workbenchRetryAttempt;
    private int workbenchReadyGeneration;
    private int remoteReconnectAttempt;
    private boolean backDispatchPending;
    private final Runnable workbenchRetry = () -> {
        workbenchRetryScheduled = false;
        if (webView == null || swipeRefresh == null || swipeRefresh.getVisibility() != View.VISIBLE) return;
        String currentUrl = webView.getUrl();
        if (currentUrl == null || "about:blank".equals(currentUrl)) return;
        // reload() may be ignored while a subresource from the previous 503
        // response is still timing out. Stop that load and start a fresh main
        // frame navigation so the newly-ready fallback route is actually used.
        retryableMainFrameUrl = null;
        webView.stopLoading();
        webView.loadUrl(currentUrl);
    };
    private final Runnable remoteReconnect = () -> {
        PairingProfile profile = remoteReconnectProfile;
        if (profile != null && profile == pairingProfile && easyTierClient != null) startEasyTier(profile);
    };

    private final ActivityResultLauncher<ScanOptions> scanner = registerForActivityResult(
        new ScanContract(),
        this::onScanResult
    );

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        setTheme(R.style.Theme_HarnessMobile);
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);
        applySystemBarInsets();
        bindViews();
        configureWebView();
        configureActions();

        String incomingPairing = getIntent().getDataString();
        pairingProfile = PairingProfile.fromStoredJson(getSharedPreferences(PREFS, MODE_PRIVATE).getString(SAVED_PROFILE, ""));
        String savedOrigin = getSharedPreferences(PREFS, MODE_PRIVATE).getString(SAVED_ORIGIN, "");
        if (incomingPairing != null) connect(incomingPairing);
        else if (pairingProfile != null) {
            String stableOrigin = activateProfile(pairingProfile, false);
            openWorkbench(stableOrigin == null ? pairingProfile.pairUrl : stableOrigin);
        } else if (PairingLinkValidator.isSafeHarnessUrl(savedOrigin, false)) openWorkbench(savedOrigin);
        else showPairing();

        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override public void handleOnBackPressed() {
                handleWorkbenchBack();
            }
        });
    }

    private void applySystemBarInsets() {
        View root = findViewById(R.id.root);
        int left = root.getPaddingLeft();
        int top = root.getPaddingTop();
        int right = root.getPaddingRight();
        int bottom = root.getPaddingBottom();
        ViewCompat.setOnApplyWindowInsetsListener(root, (view, windowInsets) -> {
            Insets systemBars = windowInsets.getInsets(
                WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout()
            );
            view.setPadding(
                left + systemBars.left,
                top + systemBars.top,
                right + systemBars.right,
                bottom + systemBars.bottom
            );
            return windowInsets;
        });
        ViewCompat.requestApplyInsets(root);
    }

    private void bindViews() {
        pairingPanel = findViewById(R.id.pairing_panel);
        pairingUrl = findViewById(R.id.pairing_url);
        pairingError = findViewById(R.id.pairing_error);
        swipeRefresh = findViewById(R.id.swipe_refresh);
        webView = findViewById(R.id.webview);
        loading = findViewById(R.id.loading);
        reconnectButton = findViewById(R.id.reconnect_button);
        connectionOverlay = findViewById(R.id.connection_overlay);
        connectionStatus = findViewById(R.id.connection_status);
        Button scanButton = findViewById(R.id.scan_button);
        Button connectButton = findViewById(R.id.connect_button);

        scanButton.setOnClickListener(view -> startScanner());
        connectButton.setOnClickListener(view -> connect(pairingUrl.getText().toString()));
        reconnectButton.setOnClickListener(view -> confirmDisconnect());
        swipeRefresh.setColorSchemeResources(R.color.harness_primary);
        // WebView pages contain long, independently scrollable conversations.
        // Pull-to-refresh steals ordinary vertical gestures and can reset the
        // SPA to its home route, so recovery stays with the automatic retry
        // path and the temporary reconnect control instead.
        swipeRefresh.setRefreshing(false);
        swipeRefresh.setEnabled(false);
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void configureWebView() {
        localProxy = new HarnessWebProxy(this);
        easyTierClient = new EasyTierClient();
        mobileUiAdapter = new MobileUiAdapter(this);
        mobileAssetCache = new MobileAssetCache(this);

        CookieManager cookieManager = CookieManager.getInstance();
        cookieManager.setAcceptCookie(true);
        cookieManager.setAcceptThirdPartyCookies(webView, true);

        webView.getSettings().setJavaScriptEnabled(true);
        webView.getSettings().setDomStorageEnabled(true);
        webView.getSettings().setDatabaseEnabled(true);
        webView.getSettings().setAllowFileAccess(false);
        webView.getSettings().setAllowContentAccess(false);
        webView.getSettings().setMediaPlaybackRequiresUserGesture(true);
        webView.getSettings().setUserAgentString(webView.getSettings().getUserAgentString() + " HarnessMobile/0.1 Android");
        if (android.os.Build.VERSION.SDK_INT >= 26) webView.getSettings().setSafeBrowsingEnabled(true);

        webView.setWebChromeClient(new WebChromeClient() {
            @Override public void onProgressChanged(WebView view, int newProgress) {
                loading.setProgress(newProgress);
                loading.setVisibility(newProgress >= 100 ? View.GONE : View.VISIBLE);
            }

        });
        webView.setWebViewClient(new WebViewClient() {
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                WebResourceResponse cached = mobileAssetCache.intercept(request);
                return cached == null ? super.shouldInterceptRequest(view, request) : cached;
            }

            @Override public void onPageStarted(WebView view, String url, Bitmap favicon) {
                workbenchReadyGeneration++;
                mobileUiAdapter.inject(view);
                loading.setVisibility(View.VISIBLE);
            }

            @Override public void onPageCommitVisible(WebView view, String url) {
                mobileUiAdapter.inject(view);
                beginWorkbenchReadyCheck();
            }

            @Override public void onPageFinished(WebView view, String url) {
                boolean retryableFailure = url != null && url.equals(retryableMainFrameUrl);
                loading.setVisibility(View.GONE);
                swipeRefresh.setRefreshing(false);
                if (retryableFailure) scheduleWorkbenchRetry();
                else {
                    cancelWorkbenchRetry(true);
                    rememberOrigin(url);
                    mobileUiAdapter.inject(view);
                    beginWorkbenchReadyCheck();
                }
            }

            @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame() && isRetryableWebError(error.getErrorCode())) {
                    retryableMainFrameUrl = request.getUrl().toString();
                    scheduleWorkbenchRetry();
                }
                super.onReceivedError(view, request, error);
            }

            @Override public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse errorResponse) {
                if (request.isForMainFrame() && isRetryableHttpStatus(errorResponse.getStatusCode())) {
                    retryableMainFrameUrl = request.getUrl().toString();
                    setConnectionStatus("电脑端正在准备工作台，连接成功后会自动打开…");
                    scheduleWorkbenchRetry();
                } else if (request.isForMainFrame() && (errorResponse.getStatusCode() == 401 || errorResponse.getStatusCode() == 403)) {
                    setConnectionStatus("配对信息已失效。请点右上角连接按钮，忘记此电脑后重新扫码。");
                }
                super.onReceivedHttpError(view, request, errorResponse);
            }

            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri current = Uri.parse(view.getUrl() == null ? "" : view.getUrl());
                Uri target = request.getUrl();
                if (sameOrigin(current, target)) return false;
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, target));
                } catch (ActivityNotFoundException error) {
                    Toast.makeText(MainActivity.this, "没有可打开此链接的应用", Toast.LENGTH_SHORT).show();
                }
                return true;
            }
        });
    }

    private void configureActions() {
        pairingUrl.setOnEditorActionListener((view, actionId, event) -> {
            connect(pairingUrl.getText().toString());
            return true;
        });
    }

    private void startScanner() {
        ScanOptions options = new ScanOptions()
            .setDesiredBarcodeFormats(ScanOptions.QR_CODE)
            .setPrompt("扫描电脑端 Harness Desktop 的配对二维码")
            .setBeepEnabled(false)
            .setCaptureActivity(HarnessCaptureActivity.class)
            .setOrientationLocked(false);
        scanner.launch(options);
    }

    private void onScanResult(ScanIntentResult result) {
        if (result.getContents() != null) connect(result.getContents());
    }

    private void connect(String value) {
        PairingProfile nextProfile = PairingProfile.parse(value);
        if (nextProfile == null) {
            pairingError.setText("配对地址无效。请扫描电脑端新生成的二维码，并确认手机与电脑在同一 Wi-Fi。 ");
            return;
        }
        pairingError.setText("");
        pairingProfile = nextProfile;
        getSharedPreferences(PREFS, MODE_PRIVATE).edit().putString(SAVED_PROFILE, nextProfile.toJson()).apply();
        if (hasActiveSystemVpn()) {
            Toast.makeText(this, "已检测到系统 VPN。Harness 仅代理本应用流量，不会关闭或替换现有 VPN。", Toast.LENGTH_LONG).show();
        }
        String stablePairUrl = activateProfile(nextProfile, true);
        openWorkbench(stablePairUrl == null ? nextProfile.pairUrl : stablePairUrl);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        if (intent.getDataString() != null) connect(intent.getDataString());
    }

    private void openWorkbench(String url) {
        cancelWorkbenchRetry(true);
        pairingPanel.setVisibility(View.GONE);
        swipeRefresh.setVisibility(View.VISIBLE);
        showConnectionOverlay(pairingProfile != null && pairingProfile.easyTier != null
            ? "正在尝试局域网，必要时会自动切换远程线路…"
            : "正在连接桌面工作台…");
        if (pairingProfile != null && pairingProfile.easyTier != null && !hasLocalNetwork()) {
            pendingWorkbenchUrl = url;
        } else {
            pendingWorkbenchUrl = null;
            webView.loadUrl(url);
        }
    }

    private String activateProfile(PairingProfile profile, boolean pairing) {
        if (localProxy == null || profile == null) return null;
        try {
            // The EasyTier service address is only reachable through its local
            // SOCKS endpoint. Do not try it as a normal Android socket while
            // the overlay is still starting; keep LAN available for the fast
            // path, then add the overlay route in onReady.
            boolean localNetworkAvailable = hasLocalNetwork();
            localProxy.updateRoutes(profile.routes.stream()
                .filter(route -> !"easytier".equals(route.id))
                .filter(route -> localNetworkAvailable || !"lan".equals(route.id))
                .toList());
            localGatewayPort = localProxy.start(profile.desktopPort());
            if (profile.easyTier == null) {
                remoteReconnectProfile = null;
                mainHandler.removeCallbacks(remoteReconnect);
                easyTierClient.stop();
            } else {
                remoteReconnectProfile = profile;
                startEasyTier(profile);
            }
            return pairing ? profile.stablePairUrl(localGatewayPort) : profile.stableOrigin(localGatewayPort);
        } catch (Exception error) {
            Toast.makeText(this, "应用内连接通道启动失败，将尝试局域网直连", Toast.LENGTH_LONG).show();
            return null;
        }
    }

    private void showPairing() {
        cancelWorkbenchRetry(true);
        workbenchReadyGeneration++;
        connectionOverlay.setVisibility(View.GONE);
        webView.stopLoading();
        swipeRefresh.setVisibility(View.GONE);
        reconnectButton.setVisibility(View.GONE);
        pairingPanel.setVisibility(View.VISIBLE);
        pairingError.setText("");
    }

    private void confirmDisconnect() {
        new AlertDialog.Builder(this)
            .setTitle("连接设置")
            .setMessage(hasActiveSystemVpn()
                ? "检测到系统 VPN。Harness 当前使用应用内线路，不会抢占系统 VPN。配对信息会保留，重新连接无需扫码。"
                : "配对信息会保留，网络恢复后自动重连；只有“忘记此电脑”才需要重新扫码。")
            .setNegativeButton("取消", null)
            .setNeutralButton("忘记此电脑", (dialog, which) -> confirmForget())
            .setPositiveButton("立即重连", (dialog, which) -> webView.reload())
            .show();
    }

    private void confirmForget() {
        new AlertDialog.Builder(this)
            .setTitle("忘记这台电脑？")
            .setMessage("下次连接需要重新扫描电脑端二维码。")
            .setNegativeButton("取消", null)
            .setPositiveButton("忘记", (dialog, which) -> disconnect())
            .show();
    }

    private void disconnect() {
        getSharedPreferences(PREFS, MODE_PRIVATE).edit().remove(SAVED_ORIGIN).remove(SAVED_PROFILE).apply();
        pairingProfile = null;
        remoteReconnectProfile = null;
        mainHandler.removeCallbacks(remoteReconnect);
        if (localProxy != null) localProxy.updateRoutes(java.util.List.of());
        if (easyTierClient != null) easyTierClient.stop();
        CookieManager.getInstance().removeAllCookies(null);
        CookieManager.getInstance().flush();
        webView.clearHistory();
        webView.loadUrl("about:blank");
        showPairing();
    }

    private void rememberOrigin(String value) {
        try {
            Uri uri = Uri.parse(value);
            boolean stable = PairingProfile.STABLE_HOST.equalsIgnoreCase(uri.getHost());
            if (!stable && !PairingLinkValidator.isSafeHarnessUrl(value, false)) return;
            String origin = String.format(Locale.ROOT, "%s://%s:%d/", uri.getScheme(), uri.getHost(), uri.getPort());
            getSharedPreferences(PREFS, MODE_PRIVATE).edit().putString(SAVED_ORIGIN, origin).apply();
        } catch (RuntimeException ignored) {
        }
    }

    private static boolean sameOrigin(Uri left, Uri right) {
        return left != null && right != null
            && equalsIgnoreCase(left.getScheme(), right.getScheme())
            && equalsIgnoreCase(left.getHost(), right.getHost())
            && effectivePort(left) == effectivePort(right);
    }

    private static int effectivePort(Uri uri) {
        if (uri.getPort() > 0) return uri.getPort();
        return "https".equalsIgnoreCase(uri.getScheme()) ? 443 : 80;
    }

    private static boolean equalsIgnoreCase(String left, String right) {
        return left != null && right != null && left.equalsIgnoreCase(right);
    }

    private void scheduleWorkbenchRetry() {
        if (workbenchRetryScheduled || webView == null || swipeRefresh == null
            || swipeRefresh.getVisibility() != View.VISIBLE) return;
        int delayIndex = Math.min(workbenchRetryAttempt, WORKBENCH_RETRY_DELAYS_MS.length - 1);
        workbenchRetryAttempt = Math.min(workbenchRetryAttempt + 1, WORKBENCH_RETRY_DELAYS_MS.length - 1);
        workbenchRetryScheduled = true;
        setConnectionStatus("正在等待电脑响应，线路恢复后会自动打开…");
        mainHandler.postDelayed(workbenchRetry, WORKBENCH_RETRY_DELAYS_MS[delayIndex]);
    }

    private void cancelWorkbenchRetry(boolean resetAttempts) {
        mainHandler.removeCallbacks(workbenchRetry);
        workbenchRetryScheduled = false;
        retryableMainFrameUrl = null;
        if (resetAttempts) workbenchRetryAttempt = 0;
    }

    private void startEasyTier(PairingProfile profile) {
        mainHandler.removeCallbacks(remoteReconnect);
        setConnectionStatus("正在建立加密远程线路，首次连接可能需要一些时间…");
        easyTierClient.start(profile, new EasyTierClient.Listener() {
            @Override public void onReady(int socksPort) {
                if (pairingProfile != profile || localProxy == null) return;
                java.util.List<PairingProfile.Route> readyRoutes = profile.routesWithEasyTierProxy(socksPort);
                if (!hasLocalNetwork()) {
                    readyRoutes = readyRoutes.stream()
                        .sorted(java.util.Comparator.comparingInt(route -> "easytier".equals(route.id) ? 0 : 1))
                        .toList();
                }
                localProxy.updateRoutes(readyRoutes);
                remoteReconnectAttempt = 0;
                runOnUiThread(() -> {
                    setConnectionStatus("远程线路已连接，正在打开工作台…");
                    if (webView == null) return;
                    if (pendingWorkbenchUrl != null) {
                        String url = pendingWorkbenchUrl;
                        pendingWorkbenchUrl = null;
                        webView.loadUrl(url);
                    } else if (PairingProfile.STABLE_HOST.equalsIgnoreCase(Uri.parse(webView.getUrl() == null ? "" : webView.getUrl()).getHost())) {
                        retryWorkbenchNow();
                    }
                });
            }

            @Override public void onError(String message) {
                if (pairingProfile != profile) return;
                runOnUiThread(() -> {
                    setConnectionStatus("远程线路暂未接通，正在自动重试；局域网连接仍然可用…");
                    long delay = Math.min(15_000L, 3_000L + remoteReconnectAttempt * 2_000L);
                    remoteReconnectAttempt = Math.min(remoteReconnectAttempt + 1, 6);
                    mainHandler.removeCallbacks(remoteReconnect);
                    mainHandler.postDelayed(remoteReconnect, delay);
                });
            }
        });
    }

    private void showConnectionOverlay(String message) {
        setConnectionStatus(message);
        connectionOverlay.setVisibility(View.VISIBLE);
        reconnectButton.setVisibility(View.VISIBLE);
        connectionOverlay.bringToFront();
        loading.bringToFront();
        reconnectButton.bringToFront();
    }

    private void retryWorkbenchNow() {
        mainHandler.removeCallbacks(workbenchRetry);
        workbenchRetryScheduled = false;
        mainHandler.post(workbenchRetry);
    }

    private void setConnectionStatus(String message) {
        if (connectionStatus != null && message != null && !message.isBlank()) connectionStatus.setText(message);
    }

    private void beginWorkbenchReadyCheck() {
        if (webView == null || swipeRefresh.getVisibility() != View.VISIBLE) return;
        int generation = ++workbenchReadyGeneration;
        checkWorkbenchReady(generation, 0);
    }

    private void checkWorkbenchReady(int generation, int attempt) {
        if (generation != workbenchReadyGeneration || webView == null || isDestroyed()) return;
        String script = "(() => Boolean(document.querySelector('[data-slot=\"conversation\"]') && document.querySelector('[data-slot=\"sidebar\"]')))()";
        webView.evaluateJavascript(script, value -> {
            if (generation != workbenchReadyGeneration || isDestroyed()) return;
            if ("true".equals(value)) {
                mobileUiAdapter.inject(webView);
                cancelWorkbenchRetry(true);
                connectionOverlay.setVisibility(View.GONE);
                reconnectButton.setVisibility(View.GONE);
                return;
            }
            if (attempt == 20) setConnectionStatus("已连接电脑，工作台功能仍在加载…");
            if (attempt == 80) setConnectionStatus("工作台加载时间较长。可以点右上角连接按钮立即重试。");
            if (attempt < 120) mainHandler.postDelayed(() -> checkWorkbenchReady(generation, attempt + 1), attempt < 12 ? 250L : 750L);
        });
    }

    private static boolean isRetryableHttpStatus(int statusCode) {
        return statusCode == 502 || statusCode == 503 || statusCode == 504;
    }

    private static boolean isRetryableWebError(int errorCode) {
        return errorCode == WebViewClient.ERROR_CONNECT
            || errorCode == WebViewClient.ERROR_HOST_LOOKUP
            || errorCode == WebViewClient.ERROR_IO
            || errorCode == WebViewClient.ERROR_PROXY_AUTHENTICATION
            || errorCode == WebViewClient.ERROR_TIMEOUT;
    }

    private boolean hasActiveSystemVpn() {
        ConnectivityManager manager = getSystemService(ConnectivityManager.class);
        if (manager == null) return false;
        for (Network network : manager.getAllNetworks()) {
            NetworkCapabilities capabilities = manager.getNetworkCapabilities(network);
            if (capabilities != null && capabilities.hasTransport(NetworkCapabilities.TRANSPORT_VPN)) return true;
        }
        return false;
    }

    private boolean hasLocalNetwork() {
        ConnectivityManager manager = getSystemService(ConnectivityManager.class);
        if (manager == null) return false;
        for (Network network : manager.getAllNetworks()) {
            NetworkCapabilities capabilities = manager.getNetworkCapabilities(network);
            if (capabilities == null || capabilities.hasTransport(NetworkCapabilities.TRANSPORT_VPN)) continue;
            if (capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)
                || capabilities.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)) return true;
        }
        return false;
    }

    private void handleWorkbenchBack() {
        if (swipeRefresh == null || swipeRefresh.getVisibility() != View.VISIBLE) {
            finish();
            return;
        }
        if (backDispatchPending || webView == null) return;
        backDispatchPending = true;
        String dismissTopLayer = "(() => {" +
            "const visible=node=>{if(!node)return false;const s=getComputedStyle(node),r=node.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0};" +
            "const layers=[...document.querySelectorAll('[role=menu],[role=listbox],[role=dialog],dialog')].filter(visible);" +
            "const target=layers.at(-1);" +
            "if(target){" +
              "const buttons=[...target.querySelectorAll('button')].filter(visible);" +
              "let close=buttons.find(button=>/close|关闭|返回/i.test([button.getAttribute('aria-label'),button.getAttribute('title'),button.textContent].filter(Boolean).join(' ')));" +
              "if(!close&&target.matches('[role=dialog],dialog')){const tr=target.getBoundingClientRect();close=buttons.find(button=>{const r=button.getBoundingClientRect(),text=(button.textContent||'').trim();return r.width<=72&&r.height<=72&&r.right>tr.right-96&&r.top<tr.top+112&&(!text||text==='×'||text==='✕')});}" +
              "if(close){close.click();return true;}" +
              "target.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',code:'Escape',bubbles:true}));" +
              "document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',code:'Escape',bubbles:true}));" +
              "return true;" +
            "}" +
            "const sidebar=[...document.querySelectorAll('[data-slot=sidebar] > div')].find(node=>visible(node)&&!String(node.className||'').includes('_collapsed'));" +
            "if(sidebar){const button=[...sidebar.querySelectorAll('button')].filter(visible).find(item=>/收起|关闭|collapse|close/i.test([item.getAttribute('aria-label'),item.getAttribute('title')].filter(Boolean).join(' ')));if(button){button.click();return true;}}" +
            "return false;" +
        "})()";
        webView.evaluateJavascript(dismissTopLayer, value -> {
            backDispatchPending = false;
            if ("true".equals(value)) return;
            // Browser history contains pairing/home redirects and is not a
            // mobile navigation stack. Once no in-page layer is open, keep the
            // workbench in place and offer connection controls instead.
            confirmDisconnect();
        });
    }

    @Override
    protected void onDestroy() {
        cancelWorkbenchRetry(true);
        workbenchReadyGeneration++;
        remoteReconnectProfile = null;
        mainHandler.removeCallbacks(remoteReconnect);
        webView.stopLoading();
        webView.setWebChromeClient(null);
        webView.setWebViewClient(null);
        webView.destroy();
        if (localProxy != null) localProxy.close();
        if (easyTierClient != null) easyTierClient.close();
        if (mobileUiAdapter != null) mobileUiAdapter.close();
        super.onDestroy();
    }
}
