package io.harnessdesktop.mobile;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.net.Uri;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.MediaStore;
import android.speech.RecognizerIntent;
import android.util.Base64;
import android.view.View;
import android.view.WindowManager;
import android.view.inputmethod.InputMethodManager;
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
import androidx.activity.result.PickVisualMediaRequest;
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

import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.util.Collections;
import java.util.Locale;
import java.util.stream.Collectors;

public final class MainActivity extends AppCompatActivity {
    static final String PREFS = "harness_mobile";
    static final String SAVED_ORIGIN = "saved_origin";
    static final String SAVED_PROFILE = "saved_profile";
    private static final long[] WORKBENCH_RETRY_DELAYS_MS = { 800L, 1500L, 2500L, 4000L, 5000L };
    private static final long NETWORK_RECONNECT_DEBOUNCE_MS = 1_500L;
    private static final long MOBILE_UPDATE_CHECK_INTERVAL_MS = 6L * 60L * 60L * 1_000L;
    private static final long MAX_CAPTURE_BYTES = 12L * 1024L * 1024L;
    static final int MAX_PICKED_IMAGES = 20;

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
    private NativeP2pClient nativeP2pClient;
    private MobileUiAdapter mobileUiAdapter;
    private ScreenCaptureObserver screenCaptureObserver;
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
    private int nativeReconnectAttempt;
    private int easyTierSocksPort;
    private int wssRelaySocksPort;
    private int nativeP2pSocksPort;
    private String routeStatus = "尚未验证可用线路";
    private boolean backDispatchPending;
    private ConnectivityManager connectivityManager;
    private boolean networkCallbackRegistered;
    private final NetworkReconnectPolicy networkReconnectPolicy = new NetworkReconnectPolicy();
    private final MobileAppUpdateChecker mobileAppUpdateChecker = new MobileAppUpdateChecker();
    private boolean mobileUpdatePrompted;
    private long lastMobileUpdateCheckAt;
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
            if (profile.nativeP2p != null && nativeP2pClient != null) startNativeP2p(profile);
            else if (profile.relay != null && wssRelayClient != null) startWssRelay(profile);
            else if (profile.easyTier != null && easyTierClient != null) startEasyTier(profile);
        }
    };
    private final Runnable nativeReconnect = () -> {
        PairingProfile profile = remoteReconnectProfile;
        if (profile != null && profile == pairingProfile && profile.nativeP2p != null && nativeP2pClient != null) startNativeP2p(profile);
    };

    private final ActivityResultLauncher<ScanOptions> scanner = registerForActivityResult(
        new ScanContract(),
        this::onScanResult
    );

    // 工作台 HTML 附件上传：相册使用系统 Photo Picker 多选，文件继续使用系统文档选择器。
    // 两条链路都是按次 URI 授权，不申请媒体/存储权限，也不持久读取相册。
    private ValueCallback<Uri[]> fileChooserCallback;
    private File pendingCameraFile;
    private final ActivityResultLauncher<PickVisualMediaRequest> recentImagePicker = registerForActivityResult(
        new ActivityResultContracts.PickMultipleVisualMedia(MAX_PICKED_IMAGES),
        uris -> completeFileChooser(uris == null || uris.isEmpty() ? null : uris.toArray(new Uri[0]))
    );
    private final ActivityResultLauncher<Intent> systemFilePicker = registerForActivityResult(
        new ActivityResultContracts.StartActivityForResult(),
        result -> completeFileChooser(toChosenUris(result.getResultCode(), result.getData()))
    );
    private final ActivityResultLauncher<Intent> systemCamera = registerForActivityResult(
        new ActivityResultContracts.StartActivityForResult(),
        result -> completeCameraCapture(result.getResultCode())
    );
    private final ActivityResultLauncher<Intent> systemSpeechRecognizer = registerForActivityResult(
        new ActivityResultContracts.StartActivityForResult(),
        result -> completeSpeechRecognition(result.getResultCode(), result.getData())
    );

    private void completeFileChooser(Uri[] uris) {
        ValueCallback<Uri[]> callback = fileChooserCallback;
        fileChooserCallback = null;
        if (callback != null) callback.onReceiveValue(uris);
    }

    private void launchSystemCamera() {
        cleanupPendingCameraFile();
        try {
            File directory = new File(getCacheDir(), "mobile-input");
            if (!directory.exists() && !directory.mkdirs()) throw new IOException("capture directory unavailable");
            pendingCameraFile = File.createTempFile("capture-", ".jpg", directory);
            Uri output = FileProvider.getUriForFile(this, getPackageName() + ".mobile-inputs", pendingCameraFile);
            Intent intent = new Intent(MediaStore.ACTION_IMAGE_CAPTURE)
                .putExtra(MediaStore.EXTRA_OUTPUT, output)
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
            intent.setClipData(ClipData.newRawUri("Harness camera output", output));
            systemCamera.launch(intent);
        } catch (ActivityNotFoundException | SecurityException | IOException failure) {
            cleanupPendingCameraFile();
            Toast.makeText(this, "没有可用的系统相机", Toast.LENGTH_SHORT).show();
        }
    }

    private void completeCameraCapture(int resultCode) {
        File captured = pendingCameraFile;
        pendingCameraFile = null;
        try {
            if (resultCode != RESULT_OK || captured == null || !captured.isFile()) return;
            long length = captured.length();
            if (length <= 0L || length > MAX_CAPTURE_BYTES) {
                Toast.makeText(this, "拍摄内容为空或超过 12 MB", Toast.LENGTH_SHORT).show();
                return;
            }
            byte[] bytes = new byte[(int) length];
            int offset = 0;
            try (FileInputStream input = new FileInputStream(captured)) {
                while (offset < bytes.length) {
                    int count = input.read(bytes, offset, bytes.length - offset);
                    if (count < 0) break;
                    offset += count;
                }
            }
            if (offset != bytes.length) return;
            String dataUrl = "data:image/jpeg;base64," + Base64.encodeToString(bytes, Base64.NO_WRAP);
            evaluateMobileCallback("__harnessMobileReceiveCapture", dataUrl);
        } catch (IOException failure) {
            Toast.makeText(this, "无法读取拍摄内容", Toast.LENGTH_SHORT).show();
        } finally {
            if (captured != null) captured.delete();
        }
    }

    private void launchSystemSpeechRecognizer() {
        try {
            Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
                .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                .putExtra(RecognizerIntent.EXTRA_PROMPT, "语音输入");
            // Deliberately omit EXTRA_LANGUAGE: the system recognizer retains the user's
            // configured language and multilingual recognition behavior.
            systemSpeechRecognizer.launch(intent);
        } catch (ActivityNotFoundException | SecurityException failure) {
            Toast.makeText(this, "没有可用的系统语音识别服务", Toast.LENGTH_SHORT).show();
        }
    }

    private void completeSpeechRecognition(int resultCode, Intent data) {
        if (resultCode != RESULT_OK || data == null) return;
        java.util.ArrayList<String> results = data.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS);
        if (results == null || results.isEmpty()) return;
        String text = results.get(0);
        if (text != null && !text.trim().isEmpty()) evaluateMobileCallback("__harnessMobileReceiveSpeech", text);
    }

    private void evaluateMobileCallback(String fixedCallback, String value) {
        if (webView == null || value == null) return;
        if (!"__harnessMobileReceiveCapture".equals(fixedCallback) && !"__harnessMobileReceiveSpeech".equals(fixedCallback)) return;
        String script = "window." + fixedCallback + "&&window." + fixedCallback + "(" + JSONObject.quote(value) + ");true;";
        webView.evaluateJavascript(script, null);
    }

    private void cleanupPendingCameraFile() {
        File file = pendingCameraFile;
        pendingCameraFile = null;
        if (file != null) file.delete();
    }

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
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            screenCaptureObserver = new ScreenCaptureObserver(this, this::notifyScreenCaptured);
        }
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

    @Override
    protected void onStart() {
        super.onStart();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE && screenCaptureObserver != null) {
            screenCaptureObserver.register();
        }
    }

    @Override
    protected void onStop() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE && screenCaptureObserver != null) {
            screenCaptureObserver.unregister();
        }
        super.onStop();
    }

    private void notifyScreenCaptured() {
        if (webView == null || swipeRefresh == null || swipeRefresh.getVisibility() != View.VISIBLE || isFinishing() || isDestroyed()) return;
        // Android 14+ reports only that a screenshot occurred. It intentionally
        // supplies no Bitmap or URI; the page therefore offers an explicit Photo
        // Picker action instead of reading MediaStore or guessing the newest file.
        webView.evaluateJavascript("window.dispatchEvent(new Event('harness-mobile-screen-captured')); true;", null);
    }

    @Override
    protected void onResume() {
        super.onResume();
        checkMobileAppUpdate();
        if (webView == null || swipeRefresh == null || swipeRefresh.getVisibility() != View.VISIBLE) return;
        // Home/Recents、系统照片选择器和 Android Back 后恢复时保留当前
        // WebView 文档、草稿、附件与流式会话。只唤醒页面并重新注入幂等的
        // 移动适配，不 reload；真正的断网仍由 NetworkCallback 的重试链处理。
        webView.onResume();
        webView.resumeTimers();
        if (mobileUiAdapter != null) mobileUiAdapter.inject(webView);
        webView.evaluateJavascript("(() => { window.dispatchEvent(new Event('online')); window.dispatchEvent(new Event('focus')); return true; })()", null);
    }

    private void checkMobileAppUpdate() {
        long now = System.currentTimeMillis();
        if (mobileUpdatePrompted || now - lastMobileUpdateCheckAt < MOBILE_UPDATE_CHECK_INTERVAL_MS) return;
        lastMobileUpdateCheckAt = now;
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
            boolean imeVisible = windowInsets.isVisible(WindowInsetsCompat.Type.ime());
            view.setPadding(
                left + systemBars.left,
                top + systemBars.top,
                right + systemBars.right,
                bottom + systemBars.bottom
            );
            publishImeInsets(imeVisible, Math.max(0, ime.bottom - systemBars.bottom));
            return windowInsets;
        });
        ViewCompat.requestApplyInsets(root);
    }

    private void publishImeInsets(boolean visible, int height) {
        if (webView == null || webView.getHandler() == null) return;
        int safeHeight = Math.max(0, height);
        String state = visible ? "open" : "closed";
        String script = "(() => {" +
            "const root=document.documentElement;if(!root)return false;" +
            "root.dataset.harnessMobileIme='" + state + "';" +
            "root.style.setProperty('--harness-mobile-ime-height','" + safeHeight + "px');" +
            "window.dispatchEvent(new CustomEvent('harness-mobile-ime-change',{detail:{visible:" + visible + ",height:" + safeHeight + "}}));" +
            "return true;})()";
        webView.evaluateJavascript(script, null);
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
        nativeP2pClient = new NativeP2pClient(this);
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
            // 用户主动点击页面里的上传控件才会触发；图片使用系统 Photo Picker 批量选择，
            // 按系统顺序回到输入框。文件仍原样回传，取消则回传 null；不要求存储权限。
            @Override public boolean onShowFileChooser(
                    WebView view,
                    ValueCallback<Uri[]> filePath,
                    FileChooserParams fileChooserParams) {
                if (fileChooserCallback != null) {
                    fileChooserCallback.onReceiveValue(null);
                    fileChooserCallback = null;
                }
                fileChooserCallback = filePath;
                boolean imageChooser = isImageChooser(fileChooserParams);
                try {
                    if (imageChooser) {
                        PickVisualMediaRequest request = new PickVisualMediaRequest.Builder()
                            .setMediaType(ActivityResultContracts.PickVisualMedia.ImageOnly.INSTANCE)
                            .build();
                        recentImagePicker.launch(request);
                    } else {
                        systemFilePicker.launch(buildSystemFilePickerIntent(fileChooserParams, false));
                    }
                    return true;
                } catch (ActivityNotFoundException | SecurityException failure) {
                    try {
                        systemFilePicker.launch(buildSystemFilePickerIntent(fileChooserParams, imageChooser));
                    } catch (ActivityNotFoundException | SecurityException fallbackFailure) {
                        completeFileChooser(null);
                    }
                    return true;
                }
            }

            private boolean isImageChooser(FileChooserParams params) {
                String[] acceptTypes = params.getAcceptTypes();
                if (acceptTypes == null || acceptTypes.length == 0) return false;
                boolean found = false;
                for (String acceptType : acceptTypes) {
                    if (acceptType == null || acceptType.trim().isEmpty()) continue;
                    found = true;
                    if (!acceptType.trim().toLowerCase(Locale.ROOT).startsWith("image/")) return false;
                }
                return found;
            }

            private Intent buildSystemFilePickerIntent(FileChooserParams params, boolean forceMultiple) {
                String[] acceptTypes = params.getAcceptTypes();
                String primary = (acceptTypes == null || acceptTypes.length == 0
                    || acceptTypes[0] == null || acceptTypes[0].trim().isEmpty()) ? "*/*" : acceptTypes[0];
                boolean multiple = forceMultiple || params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE;
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
                } else if (request.isForMainFrame() && isPairingRejectedHttpStatus(errorResponse.getStatusCode())) {
                    setConnectionStatus(getString(R.string.pairing_expired_status));
                    mainHandler.post(() -> {
                        disconnect();
                        showPairingError(getString(R.string.pairing_expired_status));
                    });
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
        boolean hasRemoteRoute = pairingProfile != null && (pairingProfile.nativeP2p != null || pairingProfile.relay != null || pairingProfile.easyTier != null);
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
                .filter(route -> !"easytier".equals(route.id) && !"wss-relay".equals(route.id) && !"native-p2p".equals(route.id))
                .filter(route -> localNetworkAvailable || !"lan".equals(route.id))
                .collect(Collectors.toList()));
            localGatewayPort = localProxy.start(profile.desktopPort());
            easyTierSocksPort = 0;
            wssRelaySocksPort = 0;
            nativeP2pSocksPort = 0;
            nativeReconnectAttempt = 0;
            routeStatus = localNetworkAvailable ? "局域网候选线路正在验证" : "尚无已验证线路";
            easyTierClient.stop();
            wssRelayClient.stop();
            nativeP2pClient.stop();
            mainHandler.removeCallbacks(nativeReconnect);
            if (profile.nativeP2p == null && profile.relay == null && profile.easyTier == null) {
                remoteReconnectProfile = null;
                mainHandler.removeCallbacks(remoteReconnect);
            } else {
                remoteReconnectProfile = profile;
                if (profile.nativeP2p != null) startNativeP2p(profile);
                else if (profile.relay != null) startWssRelay(profile);
                else if (profile.easyTier != null) startEasyTier(profile);
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
            .filter(route -> !"easytier".equals(route.id) && !"wss-relay".equals(route.id) && !"native-p2p".equals(route.id))
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
            mainHandler.removeCallbacks(nativeReconnect);
            if (easyTierClient != null) easyTierClient.stop();
            if (wssRelayClient != null) wssRelayClient.stop();
            if (nativeP2pClient != null) nativeP2pClient.stop();
            easyTierSocksPort = 0;
            wssRelaySocksPort = 0;
            nativeP2pSocksPort = 0;
            routeStatus = "网络已断开";
            showConnectionOverlay(getString(R.string.network_lost_status));
            return;
        }
        boolean hasRemoteRoute = profile.nativeP2p != null || profile.relay != null || profile.easyTier != null;
        showConnectionOverlay(hasRemoteRoute
            ? getString(R.string.network_switched_remote_status)
            : getString(R.string.network_switched_local_status));
        retryableMainFrameUrl = null;
        webView.stopLoading();
        if (hasRemoteRoute) {
            remoteReconnectProfile = profile;
            remoteReconnectAttempt = 0;
            nativeReconnectAttempt = 0;
            if (profile.nativeP2p != null) startNativeP2p(profile);
            else if (profile.relay != null) startWssRelay(profile);
            else if (profile.easyTier != null) startEasyTier(profile);
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
        String details = hasActiveSystemVpn()
            ? getString(R.string.connection_settings_message_vpn)
            : getString(R.string.connection_settings_message);
        new AlertDialog.Builder(this)
            .setTitle(getString(R.string.connection_settings_title))
            .setMessage(details + "\n\n真实线路状态：" + routeStatus)
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
        mainHandler.removeCallbacks(nativeReconnect);
        if (localProxy != null) localProxy.updateRoutes(Collections.emptyList());
        if (easyTierClient != null) easyTierClient.stop();
        if (wssRelayClient != null) wssRelayClient.stop();
        if (nativeP2pClient != null) nativeP2pClient.stop();
        routeStatus = "已断开";
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

    private java.util.List<PairingProfile.Route> readyRoutes(PairingProfile profile) {
        if (profile == null) return Collections.emptyList();
        boolean localNetworkAvailable = hasLocalNetwork();
        java.util.List<PairingProfile.Route> ready = new java.util.ArrayList<>();
        for (PairingProfile.Route route : profile.routes) {
            if ("native-p2p".equals(route.id)) {
                if (profile.nativeP2p != null && nativeP2pSocksPort > 0) ready.add(route.throughSocks5("127.0.0.1", nativeP2pSocksPort));
            } else if ("wss-relay".equals(route.id)) {
                if (profile.relay != null && wssRelaySocksPort > 0) ready.add(route.throughSocks5("127.0.0.1", wssRelaySocksPort));
            } else if ("easytier".equals(route.id)) {
                if (profile.easyTier != null && easyTierSocksPort > 0) ready.add(route.throughSocks5("127.0.0.1", easyTierSocksPort));
            } else if (localNetworkAvailable || !"lan".equals(route.id)) {
                ready.add(route);
            }
        }
        ready.sort(java.util.Comparator.comparingInt(route -> routeRank(route.id, localNetworkAvailable)));
        return ready;
    }

    private static int routeRank(String id, boolean localNetworkAvailable) {
        if (localNetworkAvailable && "lan".equals(id)) return 0;
        if ("native-p2p".equals(id)) return 1;
        if ("wss-relay".equals(id)) return 2;
        if ("easytier".equals(id)) return 3;
        return 4;
    }

    private void applyReadyRoutes(PairingProfile profile) {
        if (localProxy != null && pairingProfile == profile) localProxy.updateRoutes(readyRoutes(profile));
    }

    private void openPendingWorkbenchOrRetry() {
        if (webView == null) return;
        if (pendingWorkbenchUrl != null) {
            String url = pendingWorkbenchUrl;
            pendingWorkbenchUrl = null;
            webView.loadUrl(url);
        } else if (PairingProfile.STABLE_HOST.equalsIgnoreCase(Uri.parse(webView.getUrl() == null ? "" : webView.getUrl()).getHost())) {
            retryWorkbenchNow();
        }
    }

    private void startNativeP2p(PairingProfile profile) {
        mainHandler.removeCallbacks(nativeReconnect);
        if (profile.nativeP2p == null) return;
        setConnectionStatus("正在协商应用内 P2P 直连；WSS 备用线路同时保留…");
        nativeP2pClient.start(profile.nativeP2p, new NativeP2pClient.Listener() {
            @Override public void onRelayReady(int socksPort) {
                if (pairingProfile != profile || localProxy == null) return;
                wssRelaySocksPort = socksPort;
                nativeReconnectAttempt = 0;
                applyReadyRoutes(profile);
                runOnUiThread(() -> {
                    routeStatus = "WSS/443 备用线路已实际连接；P2P 仍在协商";
                    setConnectionStatus("WSS/443 备用线路已连接，正在继续尝试 P2P 直连…");
                    openPendingWorkbenchOrRetry();
                });
            }

            @Override public void onDirectReady(int socksPort) {
                if (pairingProfile != profile || localProxy == null) return;
                nativeP2pSocksPort = socksPort;
                nativeReconnectAttempt = 0;
                // Drop an old fallback preference before restoring all ready routes.
                localProxy.updateRoutes(readyRoutes(profile).stream()
                    .filter(route -> !"wss-relay".equals(route.id) && !"easytier".equals(route.id))
                    .collect(Collectors.toList()));
                applyReadyRoutes(profile);
                runOnUiThread(() -> {
                    routeStatus = "P2P DataChannel 已实际打开（WSS 备用线路已就绪）";
                    setConnectionStatus("P2P 直连 DataChannel 已打开，正在打开工作台…");
                    openPendingWorkbenchOrRetry();
                });
            }

            @Override public void onDirectFailure(String message) {
                if (pairingProfile != profile) return;
                nativeP2pSocksPort = 0;
                applyReadyRoutes(profile);
                runOnUiThread(() -> {
                    routeStatus = wssRelaySocksPort > 0
                        ? "P2P 未接通；当前实际可用线路为 WSS/443"
                        : "P2P 未接通；尚无已验证远程线路";
                    setConnectionStatus(wssRelaySocksPort > 0
                        ? "P2P 直连未接通，已无感保留 WSS/443 加密备用线路。"
                        : "P2P 直连暂未接通；局域网仍可用…");
                });
            }

            @Override public void onFailure(String message) {
                if (pairingProfile != profile) return;
                nativeP2pSocksPort = 0;
                wssRelaySocksPort = 0;
                applyReadyRoutes(profile);
                runOnUiThread(() -> {
                    routeStatus = "P2P/WSS 均尚未验证接通";
                    setConnectionStatus("P2P/WSS 线路暂未接通，正在自动重试；局域网仍可用…");
                    long delay = Math.min(30_000L, 5_000L + nativeReconnectAttempt * 5_000L);
                    nativeReconnectAttempt = Math.min(nativeReconnectAttempt + 1, 6);
                    mainHandler.removeCallbacks(nativeReconnect);
                    mainHandler.postDelayed(nativeReconnect, delay);
                });
            }
        });
    }

    private void startWssRelay(PairingProfile profile) {
        mainHandler.removeCallbacks(remoteReconnect);
        setConnectionStatus(getString(R.string.wss_connecting_status));
        wssRelayClient.start(profile.relay, new WssRelayClient.Listener() {
            @Override public void onReady(int socksPort) {
                if (pairingProfile != profile || localProxy == null) return;
                wssRelaySocksPort = socksPort;
                applyReadyRoutes(profile);
                remoteReconnectAttempt = 0;
                runOnUiThread(() -> {
                    routeStatus = nativeP2pSocksPort > 0
                        ? "P2P DataChannel 已实际打开（WSS 备用线路已就绪）"
                        : "WSS/443 备用线路已实际连接；P2P 仍在协商";
                    setConnectionStatus(profile.nativeP2p == null
                        ? getString(R.string.wss_ready_status)
                        : "WSS/443 备用线路已连接，正在继续尝试 P2P 直连…");
                    openPendingWorkbenchOrRetry();
                });
            }

            @Override public void onFailure(String message) {
                if (pairingProfile != profile) return;
                wssRelaySocksPort = 0;
                applyReadyRoutes(profile);
                runOnUiThread(() -> {
                    routeStatus = nativeP2pSocksPort > 0
                        ? "P2P DataChannel 已实际打开；WSS 备用线路暂不可用"
                        : "WSS 与 P2P 均尚未验证接通";
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
                easyTierSocksPort = socksPort;
                applyReadyRoutes(profile);
                remoteReconnectAttempt = 0;
                runOnUiThread(() -> {
                    routeStatus = "EasyTier 远程线路已实际连接";
                    setConnectionStatus(getString(R.string.easytier_ready_status));
                    openPendingWorkbenchOrRetry();
                });
            }

            @Override public void onError(String message) {
                if (pairingProfile != profile) return;
                easyTierSocksPort = 0;
                applyReadyRoutes(profile);
                runOnUiThread(() -> {
                    routeStatus = "EasyTier 远程线路尚未接通";
                    setConnectionStatus(getString(R.string.easytier_failed_status));
                    long delay = Math.min(15_000L, 3_000L + remoteReconnectAttempt * 2_000L);
                    remoteReconnectAttempt = Math.min(remoteReconnectAttempt + 1, 6);
                    mainHandler.removeCallbacks(remoteReconnect);
                    mainHandler.postDelayed(remoteReconnect, delay);
                });
            }
        });
    }

    private void hideSoftKeyboard() {
        View focused = getCurrentFocus();
        if (focused != null) {
            InputMethodManager keyboard = (InputMethodManager) getSystemService(Context.INPUT_METHOD_SERVICE);
            if (keyboard != null) keyboard.hideSoftInputFromWindow(focused.getWindowToken(), 0);
            focused.clearFocus();
        }
        if (webView != null) webView.evaluateJavascript("document.activeElement?.blur?.()", null);
    }

    private void showConnectionOverlay(String message) {
        hideSoftKeyboard();
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

    static boolean isPairingRejectedHttpStatus(int statusCode) {
        return statusCode == 401 || statusCode == 403 || statusCode == 410;
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
            // mobile navigation stack. Once no in-page layer is open, Android
            // Back should behave like a normal phone app: move this task to the
            // background while the proxy/tunnel and desktop generation continue.
            if (!moveTaskToBack(true)) finishAfterTransition();
        });
    }

    /**
     * Isolates API 34 symbols from MainActivity class verification on API 26–33.
     * Registration follows the Activity visibility lifecycle required by Android.
     */
    @androidx.annotation.RequiresApi(Build.VERSION_CODES.UPSIDE_DOWN_CAKE)
    private static final class ScreenCaptureObserver {
        private final Activity activity;
        private final Activity.ScreenCaptureCallback callback;
        private boolean registered;

        ScreenCaptureObserver(Activity activity, Runnable listener) {
            this.activity = activity;
            this.callback = listener::run;
        }

        void register() {
            if (registered) return;
            activity.registerScreenCaptureCallback(activity.getMainExecutor(), callback);
            registered = true;
        }

        void unregister() {
            if (!registered) return;
            activity.unregisterScreenCaptureCallback(callback);
            registered = false;
        }
    }

    private final class MobileControlBridge {
        @JavascriptInterface public void openSettings() {
            runOnUiThread(() -> startActivity(new Intent(MainActivity.this, ControlSettingsActivity.class)));
        }

        @JavascriptInterface public void inputAction(String action) {
            if (!"capture".equals(action) && !"speech".equals(action)) return;
            runOnUiThread(() -> {
                if ("capture".equals(action)) launchSystemCamera();
                else launchSystemSpeechRecognizer();
            });
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
        cleanupPendingCameraFile();
        ControlPreferences.setEnabled(this, false);
        ControlForegroundService.stop(this);
        cancelWorkbenchRetry(true);
        workbenchReadyGeneration++;
        remoteReconnectProfile = null;
        mainHandler.removeCallbacks(remoteReconnect);
        mainHandler.removeCallbacks(nativeReconnect);
        unregisterNetworkMonitoring();
        webView.stopLoading();
        webView.setWebChromeClient(null);
        webView.setWebViewClient(null);
        webView.destroy();
        if (localProxy != null) localProxy.close();
        if (easyTierClient != null) easyTierClient.close();
        if (wssRelayClient != null) wssRelayClient.stop();
        if (nativeP2pClient != null) nativeP2pClient.close();
        if (mobileUiAdapter != null) mobileUiAdapter.close();
        mobileAppUpdateChecker.close();
        super.onDestroy();
    }
}