package io.harnessdesktop.mobile;

import android.annotation.SuppressLint;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
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
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
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
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.appcompat.app.AlertDialog;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.content.FileProvider;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout;

import com.journeyapps.barcodescanner.ScanContract;
import com.journeyapps.barcodescanner.ScanIntentResult;
import com.journeyapps.barcodescanner.ScanOptions;

import java.util.Collections;
import java.util.Locale;
import java.util.stream.Collectors;

public final class MainActivity extends AppCompatActivity {
    static final String PREFS = "harness_mobile";
    static final String SAVED_ORIGIN = "saved_origin";
    static final String SAVED_PROFILE = "saved_profile";
    private static final long[] WORKBENCH_RETRY_DELAYS_MS = { 800L, 1500L, 2500L, 4000L, 5000L };
    private static final long NETWORK_RECONNECT_DEBOUNCE_MS = 1_500L;

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
    private WssRelayClient wssRelayClient;
    private MobileUiAdapter mobileUiAdapter;
    private MobileAssetCache mobileAssetCache;
    private PairingProfileStore pairingProfileStore;
    private PairingProfile pairingProfile;
    private PairingProfile remoteReconnectProfile;
    private String pendingWorkbenchUrl;
    private int localGatewayPort;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private String retryableMainFrameUrl;
    private boolean mainFrameLoadFailed;
    private boolean workbenchRetryScheduled;
    private int workbenchRetryAttempt;
    private int workbenchReadyGeneration;
    private int remoteReconnectAttempt;
    private boolean backDispatchPending;
    private ConnectivityManager connectivityManager;
    private boolean networkCallbackRegistered;
    private final NetworkReconnectPolicy networkReconnectPolicy = new NetworkReconnectPolicy();
    private final MobileAppUpdateChecker mobileAppUpdateChecker = new MobileAppUpdateChecker();
    private boolean mobileUpdatePrompted;
    private final Runnable networkChangedReconnect = this::reconnectAfterNetworkChange;
    private final ConnectivityManager.NetworkCallback networkCallback = new ConnectivityManager.NetworkCallback() {
        @Override public void onAvailable(Network network) { observeAvailableNetwork(network, null); }
        @Override public void onCapabilitiesChanged(Network network, NetworkCapabilities capabilities) { observeAvailableNetwork(network, capabilities); }
        @Override public void onLost(Network network) {
            if (network != null && networkReconnectPolicy.lost(network.getNetworkHandle())) scheduleNetworkChangedReconnect();
        }
    };
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
        if (profile != null && profile == pairingProfile) {
            if (profile.relay != null && wssRelayClient != null) startWssRelay(profile);
            else if (profile.easyTier != null && easyTierClient != null) startEasyTier(profile);
        }
    };

    private final ActivityResultLauncher<ScanOptions> scanner = registerForActivityResult(
        new ScanContract(),
        this::onScanResult
    );

    // 工作台 HTML 文件上传：仅在被页面主动触发（按钮点击）时启动系统选择器，
    // 按次授权、可多选、可取消；不申请任何存储权限，也不持久化 URI 授权。
    private ValueCallback<Uri[]> fileChooserCallback;
    private final ActivityResultLauncher<Intent> systemFilePicker = registerForActivityResult(
        new ActivityResultContracts.StartActivityForResult(),
        result -> {
            ValueCallback<Uri[]> callback = fileChooserCallback;
            fileChooserCallback = null;
            if (callback == null) return;
            callback.onReceiveValue(toChosenUris(result.getResultCode(), result.getData()));
        }
    );

    private static Uri[] toChosenUris(int resultCode, Intent data) {
        if (resultCode != RESULT_OK || data == null) return null;
        java.util.List<Uri> uris = new java.util.ArrayList<>();
        ClipData clips = data.getClipData();
        if (clips != null) {
            for (int index = 0; index < clips.getItemCount(); index++) {
                Uri uri = clips.getItemAt(index).getUri();
                if (uri != null) uris.add(uri);
            }
        }
        Uri single = data.getData();
        if (single != null && !uris.contains(single)) uris.add(single);
        return uris.isEmpty() ? null : uris.toArray(new Uri[0]);
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        setTheme(R.style.Theme_HarnessMobile);
        super.onCreate(savedInstanceState);
        getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);
        setContentView(R.layout.activity_main);
        applySystemBarInsets();
        bindViews();
        configureWebView();
        configureActions();
        if (ControlPreferences.isEnabled(this)) ControlForegroundService.start(this);

        String incomingPairing = getIntent().getDataString();
        pairingProfile = pairingProfileStore.loadAndMigrate();
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
        registerNetworkMonitoring();
        checkMobileAppUpdate();
    }

    private void checkMobileAppUpdate() {
        mobileAppUpdateChecker.check(BuildConfig.MOBILE_UPDATE_MANIFEST_URL, BuildConfig.VERSION_NAME, (update, error) -> {
            if (isFinishing() || isDestroyed() || update == null || mobileUpdatePrompted) return;
            mobileUpdatePrompted = true;
            AlertDialog dialog = new AlertDialog.Builder(this)
                .setTitle(update.required ? getString(R.string.update_title_required) : getString(R.string.update_title_optional))
                .setMessage(getString(R.string.update_message, update.version))
                .setPositiveButton(getString(R.string.update_download), (ignored, which) -> downloadMobileAppUpdate(update))
                .create();
            if (!update.required) dialog.setButton(AlertDialog.BUTTON_NEGATIVE, getString(R.string.update_later), (ignored, which) -> {});
            dialog.setCanceledOnTouchOutside(!update.required);
            dialog.setCancelable(!update.required);
            dialog.show();
        });
    }

    private void downloadMobileAppUpdate(MobileAppUpdateChecker.Update update) {
        Toast.makeText(this, getString(R.string.update_downloading), Toast.LENGTH_SHORT).show();
        mobileAppUpdateChecker.downloadAndVerify(this, update, (apk, error) -> {
            if (isFinishing() || isDestroyed()) return;
            if (error != null || apk == null) {
                Toast.makeText(this, error == null ? getString(R.string.update_verify_failed) : error.getMessage(), Toast.LENGTH_LONG).show();
                return;
            }
            try {
                Uri uri = FileProvider.getUriForFile(this, getPackageName() + ".updates", apk);
                Intent install = new Intent(Intent.ACTION_VIEW)
                    .setDataAndType(uri, "application/vnd.android.package-archive")
                    .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                startActivity(install);
            } catch (ActivityNotFoundException failure) {
                Toast.makeText(this, getString(R.string.update_no_installer), Toast.LENGTH_LONG).show();
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
            Insets ime = windowInsets.getInsets(WindowInsetsCompat.Type.ime());
            view.setPadding(
                left + systemBars.left,
                top + systemBars.top,
                right + systemBars.right,
                bottom + Math.max(systemBars.bottom, ime.bottom)
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
        wssRelayClient = new WssRelayClient();
        mobileUiAdapter = new MobileUiAdapter(this);
        mobileAssetCache = new MobileAssetCache(this);
        pairingProfileStore = new PairingProfileStore(this);

        CookieManager cookieManager = CookieManager.getInstance();
        cookieManager.setAcceptCookie(true);
        cookieManager.setAcceptThirdPartyCookies(webView, true);

        webView.getSettings().setJavaScriptEnabled(true);
        webView.getSettings().setDomStorageEnabled(true);
        webView.getSettings().setDatabaseEnabled(true);
        webView.getSettings().setAllowFileAccess(false);
        webView.getSettings().setAllowContentAccess(false);
        webView.getSettings().setMediaPlaybackRequiresUserGesture(true);
        webView.getSettings().setUserAgentString(webView.getSettings().getUserAgentString() + " HarnessMobile/1 Android");
        webView.addJavascriptInterface(new MobileControlBridge(), "HarnessMobileControl");
        if (android.os.Build.VERSION.SDK_INT >= 26) webView.getSettings().setSafeBrowsingEnabled(true);

        webView.setWebChromeClient(new WebChromeClient() {
            @Override public void onProgressChanged(WebView view, int newProgress) {
                loading.setProgress(newProgress);
                loading.setVisibility(newProgress >= 100 ? View.GONE : View.VISIBLE);
            }

            // HTML <input type="file">/file input 的系统选择器桥：
            // 用户主动点击页面里的上传控件才会触发；选择结果（含多选）原样回传
            // 给页面，取消则回传 null。只走系统 picker 的按次授权，不要求存储权限。
            @Override public boolean onShowFileChooser(
                    WebView view,
                    ValueCallback<Uri[]> filePath,
                    FileChooserParams fileChooserParams) {
                if (fileChooserCallback != null) {
                    fileChooserCallback.onReceiveValue(null);
                    fileChooserCallback = null;
                }
                fileChooserCallback = filePath;
                try {
                    systemFilePicker.launch(buildSystemFilePickerIntent(fileChooserParams));
                    return true;
                } catch (ActivityNotFoundException | SecurityException failure) {
                    fileChooserCallback = null;
                    filePath.onReceiveValue(null);
                    return true;
                }
            }

            private Intent buildSystemFilePickerIntent(FileChooserParams params) {
                String[] acceptTypes = params.getAcceptTypes();
                String primary = (acceptTypes == null || acceptTypes.length == 0
                    || acceptTypes[0] == null || acceptTypes[0].trim().isEmpty()) ? "*/*" : acceptTypes[0];
                boolean multiple = params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE;
                Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT)
                    .addCategory(Intent.CATEGORY_OPENABLE)
                    .setType(primary)
                    .putExtra(Intent.EXTRA_ALLOW_MULTIPLE, multiple);
                if (acceptTypes != null && acceptTypes.length > 1) {
                    intent.putExtra(Intent.EXTRA_MIME_TYPES, acceptTypes);
                }
                return intent;
            }
        });
        webView.setWebViewClient(new WebViewClient() {
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                WebResourceResponse cached = mobileAssetCache.intercept(request);
                return cached == null ? super.shouldInterceptRequest(view, request) : cached;
            }

            @Override public void onPageStarted(WebView view, String url, Bitmap favicon) {
                mainFrameLoadFailed = false;
                workbenchReadyGeneration++;
                mobileUiAdapter.inject(view);
                loading.setVisibility(View.VISIBLE);
            }

            @Override public void onPageCommitVisible(WebView view, String url) {
                mobileUiAdapter.inject(view);
                if (!mainFrameLoadFailed) revealWorkbench();
                else beginWorkbenchReadyCheck();
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
                    if (!mainFrameLoadFailed) revealWorkbench();
                    else beginWorkbenchReadyCheck();
                }
            }

            @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) mainFrameLoadFailed = true;
                if (request.isForMainFrame() && isRetryableWebError(error.getErrorCode())) {
                    retryableMainFrameUrl = request.getUrl().toString();
                    scheduleWorkbenchRetry();
                }
                super.onReceivedError(view, request, error);
            }

            @Override public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse errorResponse) {
                if (request.isForMainFrame()) mainFrameLoadFailed = true;
                if (request.isForMainFrame() && isRetryableHttpStatus(errorResponse.getStatusCode())) {
                    retryableMainFrameUrl = request.getUrl().toString();
                    setConnectionStatus(getString(R.string.waiting_desktop_status));
                    scheduleWorkbenchRetry();
                } else if (request.isForMainFrame() && (errorResponse.getStatusCode() == 401 || errorResponse.getStatusCode() == 403)) {
                    setConnectionStatus(getString(R.string.pairing_expired_status));
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
                    Toast.makeText(MainActivity.this, getString(R.string.no_app_to_open), Toast.LENGTH_SHORT).show();
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
            .setPrompt(getString(R.string.scan_prompt))
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
            showPairingError(getString(R.string.pairing_error_invalid));
            return;
        }
        try { pairingProfileStore.save(nextProfile); }
        catch (Exception error) {
            showPairingError(getString(R.string.pairing_error_save_failed));
            return;
        }
        pairingError.setText("");
        pairingError.setVisibility(View.GONE);
        pairingProfile = nextProfile;
        if (hasActiveSystemVpn()) {
            Toast.makeText(this, getString(R.string.vpn_notice), Toast.LENGTH_LONG).show();
        }
        String stablePairUrl = activateProfile(nextProfile, true);
        openWorkbench(stablePairUrl == null ? nextProfile.pairUrl : stablePairUrl);
    }

    private void showPairingError(String message) {
        pairingError.setText(message);
        pairingError.setVisibility(View.VISIBLE);
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
        boolean hasRemoteRoute = pairingProfile != null && (pairingProfile.relay != null || pairingProfile.easyTier != null);
        showConnectionOverlay(hasRemoteRoute
            ? getString(R.string.connecting_lan_status)
            : getString(R.string.connecting_workbench_status));
        if (hasRemoteRoute && !hasLocalNetwork()) {
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
                .filter(route -> !"easytier".equals(route.id) && !"wss-relay".equals(route.id))
                .filter(route -> localNetworkAvailable || !"lan".equals(route.id))
                .collect(Collectors.toList()));
            localGatewayPort = localProxy.start(profile.desktopPort());
            easyTierClient.stop();
            wssRelayClient.stop();
            if (profile.relay == null && profile.easyTier == null) {
                remoteReconnectProfile = null;
                mainHandler.removeCallbacks(remoteReconnect);
            } else {
                remoteReconnectProfile = profile;
                if (profile.relay != null) startWssRelay(profile);
                else startEasyTier(profile);
            }
            return pairing ? profile.stablePairUrl(localGatewayPort) : profile.stableOrigin(localGatewayPort);
        } catch (Exception error) {
            Toast.makeText(this, getString(R.string.connecting_failed_toast), Toast.LENGTH_LONG).show();
            return null;
        }
    }

    private void updateRoutesBeforeRemoteReady(PairingProfile profile) {
        if (localProxy == null || profile == null) return;
        boolean localNetworkAvailable = hasLocalNetwork();
        localProxy.updateRoutes(profile.routes.stream()
            .filter(route -> !"easytier".equals(route.id) && !"wss-relay".equals(route.id))
            .filter(route -> localNetworkAvailable || !"lan".equals(route.id))
            .collect(Collectors.toList()));
    }

    private void registerNetworkMonitoring() {
        connectivityManager = getSystemService(ConnectivityManager.class);
        if (connectivityManager == null || networkCallbackRegistered) return;
        Network active = connectivityManager.getActiveNetwork();
        NetworkCapabilities capabilities = active == null ? null : connectivityManager.getNetworkCapabilities(active);
        networkReconnectPolicy.seed(
            active == null ? NetworkReconnectPolicy.NO_NETWORK : active.getNetworkHandle(),
            isUsableNetwork(capabilities)
        );
        try {
            connectivityManager.registerDefaultNetworkCallback(networkCallback);
            networkCallbackRegistered = true;
        } catch (RuntimeException ignored) {
            networkCallbackRegistered = false;
        }
    }

    private void observeAvailableNetwork(Network network, NetworkCapabilities capabilities) {
        if (network == null) return;
        NetworkCapabilities resolved = capabilities;
        if (resolved == null && connectivityManager != null) resolved = connectivityManager.getNetworkCapabilities(network);
        if (networkReconnectPolicy.available(network.getNetworkHandle(), isUsableNetwork(resolved))) scheduleNetworkChangedReconnect();
    }

    private void scheduleNetworkChangedReconnect() {
        mainHandler.removeCallbacks(networkChangedReconnect);
        mainHandler.postDelayed(networkChangedReconnect, NETWORK_RECONNECT_DEBOUNCE_MS);
    }

    private void reconnectAfterNetworkChange() {
        PairingProfile profile = pairingProfile;
        if (profile == null || localProxy == null || webView == null || isFinishing() || isDestroyed()) return;
        updateRoutesBeforeRemoteReady(profile);
        if (!networkReconnectPolicy.hasUsableNetwork()) {
            mainHandler.removeCallbacks(remoteReconnect);
            if (easyTierClient != null) easyTierClient.stop();
            if (wssRelayClient != null) wssRelayClient.stop();
            showConnectionOverlay(getString(R.string.network_lost_status));
            return;
        }
        boolean hasRemoteRoute = profile.relay != null || profile.easyTier != null;
        showConnectionOverlay(hasRemoteRoute
            ? getString(R.string.network_switched_remote_status)
            : getString(R.string.network_switched_local_status));
        retryableMainFrameUrl = null;
        webView.stopLoading();
        if (hasRemoteRoute) {
            remoteReconnectProfile = profile;
            remoteReconnectAttempt = 0;
            if (profile.relay != null) startWssRelay(profile);
            else startEasyTier(profile);
        } else {
            retryWorkbenchNow();
        }
    }

    private void unregisterNetworkMonitoring() {
        mainHandler.removeCallbacks(networkChangedReconnect);
        if (!networkCallbackRegistered || connectivityManager == null) return;
        try { connectivityManager.unregisterNetworkCallback(networkCallback); }
        catch (RuntimeException ignored) {}
        networkCallbackRegistered = false;
    }

    private static boolean isUsableNetwork(NetworkCapabilities capabilities) {
        return capabilities != null && capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET);
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
        pairingError.setVisibility(View.GONE);
    }

    private void confirmDisconnect() {
        new AlertDialog.Builder(this)
            .setTitle(getString(R.string.connection_settings_title))
            .setMessage(hasActiveSystemVpn()
                ? getString(R.string.connection_settings_message_vpn)
                : getString(R.string.connection_settings_message))
            .setNegativeButton(getString(R.string.action_cancel), null)
            .setNeutralButton(getString(R.string.action_forget_computer), (dialog, which) -> confirmForget())
            .setPositiveButton(getString(R.string.action_reconnect_now), (dialog, which) -> webView.reload())
            .show();
    }

    private void confirmForget() {
        new AlertDialog.Builder(this)
            .setTitle(getString(R.string.forget_title))
            .setMessage(getString(R.string.forget_message))
            .setNegativeButton(getString(R.string.action_cancel), null)
            .setPositiveButton(getString(R.string.action_forget), (dialog, which) -> disconnect())
            .show();
    }

    private void disconnect() {
        getSharedPreferences(PREFS, MODE_PRIVATE).edit().remove(SAVED_ORIGIN).apply();
        if (pairingProfileStore != null) pairingProfileStore.clear();
        pairingProfile = null;
        remoteReconnectProfile = null;
        mainHandler.removeCallbacks(remoteReconnect);
        if (localProxy != null) localProxy.updateRoutes(Collections.emptyList());
        if (easyTierClient != null) easyTierClient.stop();
        if (wssRelayClient != null) wssRelayClient.stop();
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
        setConnectionStatus(getString(R.string.retry_waiting_status));
        mainHandler.postDelayed(workbenchRetry, WORKBENCH_RETRY_DELAYS_MS[delayIndex]);
    }

    private void cancelWorkbenchRetry(boolean resetAttempts) {
        mainHandler.removeCallbacks(workbenchRetry);
        workbenchRetryScheduled = false;
        retryableMainFrameUrl = null;
        if (resetAttempts) workbenchRetryAttempt = 0;
    }

    private void startWssRelay(PairingProfile profile) {
        mainHandler.removeCallbacks(remoteReconnect);
        setConnectionStatus(getString(R.string.wss_connecting_status));
        wssRelayClient.start(profile.relay, new WssRelayClient.Listener() {
            @Override public void onReady(int socksPort) {
                if (pairingProfile != profile || localProxy == null) return;
                java.util.List<PairingProfile.Route> readyRoutes = profile.routesWithRelayProxy(socksPort);
                if (!hasLocalNetwork()) {
                    readyRoutes = readyRoutes.stream()
                        .sorted(java.util.Comparator.comparingInt(route -> "wss-relay".equals(route.id) ? 0 : 1))
                        .collect(Collectors.toList());
                }
                localProxy.updateRoutes(readyRoutes);
                remoteReconnectAttempt = 0;
                runOnUiThread(() -> {
                    setConnectionStatus(getString(R.string.wss_ready_status));
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

            @Override public void onFailure(String message) {
                if (pairingProfile != profile) return;
                runOnUiThread(() -> {
                    setConnectionStatus(getString(R.string.wss_failed_status));
                    long delay = Math.min(15_000L, 3_000L + remoteReconnectAttempt * 2_000L);
                    remoteReconnectAttempt = Math.min(remoteReconnectAttempt + 1, 6);
                    mainHandler.removeCallbacks(remoteReconnect);
                    mainHandler.postDelayed(remoteReconnect, delay);
                });
            }
        });
    }

    private void startEasyTier(PairingProfile profile) {
        mainHandler.removeCallbacks(remoteReconnect);
        setConnectionStatus(getString(R.string.easytier_connecting_status));
        easyTierClient.start(profile, new EasyTierClient.Listener() {
            @Override public void onReady(int socksPort) {
                if (pairingProfile != profile || localProxy == null) return;
                java.util.List<PairingProfile.Route> readyRoutes = profile.routesWithEasyTierProxy(socksPort);
                if (!hasLocalNetwork()) {
                    readyRoutes = readyRoutes.stream()
                        .sorted(java.util.Comparator.comparingInt(route -> "easytier".equals(route.id) ? 0 : 1))
                        .collect(Collectors.toList());
                }
                localProxy.updateRoutes(readyRoutes);
                remoteReconnectAttempt = 0;
                runOnUiThread(() -> {
                    setConnectionStatus(getString(R.string.easytier_ready_status));
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
                    setConnectionStatus(getString(R.string.easytier_failed_status));
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

    private void revealWorkbench() {
        workbenchReadyGeneration++;
        connectionOverlay.setVisibility(View.GONE);
        reconnectButton.setVisibility(View.GONE);
    }

    private void retryWorkbenchNow() {
        mainHandler.removeCallbacks(workbenchRetry);
        workbenchRetryScheduled = false;
        mainHandler.post(workbenchRetry);
    }

    private void setConnectionStatus(String message) {
        if (connectionStatus != null && message != null && !message.trim().isEmpty()) connectionStatus.setText(message);
    }

    private void beginWorkbenchReadyCheck() {
        if (webView == null || swipeRefresh.getVisibility() != View.VISIBLE) return;
        int generation = ++workbenchReadyGeneration;
        checkWorkbenchReady(generation, 0);
    }

    private void checkWorkbenchReady(int generation, int attempt) {
        if (generation != workbenchReadyGeneration || webView == null || isDestroyed()) return;
        String script = "(() => Boolean(document.querySelector('[data-slot=\"conversation\"]') || document.querySelector('[data-slot=\"sidebar\"]') || document.querySelector('[data-composer-card]') || document.querySelector('textarea[data-phase]')))()";
        webView.evaluateJavascript(script, value -> {
            if (generation != workbenchReadyGeneration || isDestroyed()) return;
            if ("true".equals(value)) {
                mobileUiAdapter.inject(webView);
                cancelWorkbenchRetry(true);
                revealWorkbench();
                return;
            }
            if (attempt == 20) setConnectionStatus(getString(R.string.workbench_loading_status));
            if (attempt == 80) setConnectionStatus(getString(R.string.workbench_slow_status));
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

    private final class MobileControlBridge {
        @JavascriptInterface public void openSettings() {
            runOnUiThread(() -> startActivity(new Intent(MainActivity.this, ControlSettingsActivity.class)));
        }

        @JavascriptInterface public String status() {
            return ControlPreferences.isEnabled(MainActivity.this) && HarnessControlAccessibilityService.isConnected() ? "ready" : "disabled";
        }
    }

    @Override
    protected void onDestroy() {
        if (fileChooserCallback != null) {
            fileChooserCallback.onReceiveValue(null);
            fileChooserCallback = null;
        }
        ControlPreferences.setEnabled(this, false);
        ControlForegroundService.stop(this);
        cancelWorkbenchRetry(true);
        workbenchReadyGeneration++;
        remoteReconnectProfile = null;
        mainHandler.removeCallbacks(remoteReconnect);
        unregisterNetworkMonitoring();
        webView.stopLoading();
        webView.setWebChromeClient(null);
        webView.setWebViewClient(null);
        webView.destroy();
        if (localProxy != null) localProxy.close();
        if (easyTierClient != null) easyTierClient.close();
        if (wssRelayClient != null) wssRelayClient.stop();
        if (mobileUiAdapter != null) mobileUiAdapter.close();
        mobileAppUpdateChecker.close();
        super.onDestroy();
    }
}