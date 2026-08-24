package io.harnessdesktop.mobile;

import android.accessibilityservice.AccessibilityService;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.provider.Settings;
import android.webkit.CookieManager;

import androidx.core.app.NotificationCompat;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashSet;
import java.util.Set;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

public final class ControlForegroundService extends Service {
    static final String ACTION_START = "io.harnessdesktop.mobile.control.START";
    static final String ACTION_STOP = "io.harnessdesktop.mobile.control.STOP";
    private static final String CHANNEL_ID = "harness_mobile_control";
    private static final int NOTIFICATION_ID = 4401;
    private static final long STATUS_INTERVAL_MS = 5000L;
    private static final Set<String> ALLOWED_URI_SCHEMES = immutableSet("http", "https", "geo", "mailto", "tel");
    private static final Set<String> NON_RETRYABLE_RESULTS = immutableSet(
        "USER_DENIED", "ACCESSIBILITY_REQUIRED", "CACHE_GUIDED_MODE", "CAPTURE_DENIED", "FILE_PICKER_CANCELLED"
    );
    private static volatile ControlForegroundService instance;

    private static Set<String> immutableSet(String... values) {
        return Collections.unmodifiableSet(new HashSet<>(Arrays.asList(values)));
    }

    private final ScheduledExecutorService network = Executors.newSingleThreadScheduledExecutor();
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final AtomicBoolean polling = new AtomicBoolean();
    private volatile ControlCommand current;
    private volatile boolean cancelled;
    private volatile long lastStatusAt;
    private volatile String phase = "ready";
    private volatile String detail = "等待已配对会话下发操作";
    private Runnable timeoutTask;

    static void start(Context context) {
        Intent intent = new Intent(context, ControlForegroundService.class).setAction(ACTION_START);
        if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(intent);
        else context.startService(intent);
    }

    static void stop(Context context) {
        Intent intent = new Intent(context, ControlForegroundService.class).setAction(ACTION_STOP);
        try {
            if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(intent);
            else context.startService(intent);
        } catch (RuntimeException ignored) {
            context.stopService(intent);
        }
    }

    static void requestStatusRefresh(Context context) {
        ControlForegroundService service = instance;
        if (service != null) {
            service.lastStatusAt = 0;
            service.network.execute(service::pollOnce);
        }
    }

    static void completeExternal(ControlResult result) {
        ControlForegroundService service = instance;
        if (service != null) service.finish(result, 0);
    }

    static void promoteForCapture(Context context) {
        ControlForegroundService service = instance;
        if (service == null || Build.VERSION.SDK_INT < 29) return;
        int types = ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC;
        if (Build.VERSION.SDK_INT >= 29) types |= ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION;
        service.startForeground(NOTIFICATION_ID, service.notification("正在截取当前屏幕，可随时停止"), types);
    }

    static void demoteAfterCapture() {
        ControlForegroundService service = instance;
        if (service != null) service.startForegroundForDataSync();
    }

    @Override public void onCreate() {
        super.onCreate();
        instance = this;
        createNotificationChannel();
        startForegroundForDataSync();
        network.scheduleWithFixedDelay(this::pollOnce, 0, 850, TimeUnit.MILLISECONDS);
    }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent == null ? ACTION_START : intent.getAction();
        if (ACTION_STOP.equals(action)) {
            ControlPreferences.setEnabled(this, false);
            cancelCurrent("USER_STOPPED", "用户已立即停止手机控制。 ");
            phase = "stopped";
            detail = "手机控制已关闭";
            network.execute(() -> {
                postStatus();
                stopForeground(STOP_FOREGROUND_REMOVE);
                stopSelf();
            });
            return START_NOT_STICKY;
        }
        if (!ControlPreferences.isEnabled(this)) {
            stopSelf();
            return START_NOT_STICKY;
        }
        updateNotification("手机控制已开启，等待操作");
        return START_NOT_STICKY;
    }

    @Override public IBinder onBind(Intent intent) {
        return null;
    }

    @Override public void onTaskRemoved(Intent rootIntent) {
        ControlPreferences.setEnabled(this, false);
        cancelCurrent("APP_EXITED", "APP 已退出，所有命令失效。 ");
        stopSelf();
        super.onTaskRemoved(rootIntent);
    }

    @Override public void onDestroy() {
        if (instance == this) instance = null;
        cancelCurrent("SERVICE_STOPPED", "前台控制服务已停止。 ");
        network.shutdownNow();
        mainHandler.removeCallbacksAndMessages(null);
        HarnessControlAccessibilityService accessibility = HarnessControlAccessibilityService.get();
        if (accessibility != null) accessibility.cancelConfirmation();
        super.onDestroy();
    }

    private void startForegroundForDataSync() {
        Notification value = notification(detail);
        if (Build.VERSION.SDK_INT >= 29) startForeground(NOTIFICATION_ID, value, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
        else startForeground(NOTIFICATION_ID, value);
    }

    private void pollOnce() {
        if (!ControlPreferences.isEnabled(this) || !polling.compareAndSet(false, true)) return;
        try {
            long now = System.currentTimeMillis();
            if (now - lastStatusAt >= STATUS_INTERVAL_MS) {
                postStatus();
                lastStatusAt = now;
            }
            if (current != null) return;
            JSONObject response = request("GET", "/__harness_mobile__/control/poll?protocolVersion=" + ControlCommand.PROTOCOL_VERSION, null, 64 * 1024);
            JSONObject commandValue = response.optJSONObject("command");
            if (commandValue == null) return;
            ControlCommand command = ControlCommand.parse(commandValue);
            if ("stop".equals(command.type)) {
                ControlPreferences.setEnabled(this, false);
                cancelCurrent("DESKTOP_STOP", "电脑端已停止手机控制。 ");
                phase = "stopped";
                detail = "电脑端已立即停止控制";
                postStatus();
                stopSelf();
                return;
            }
            if ("cancel".equals(command.type)) {
                if (current != null && command.payload.optString("commandId").equals(current.id)) cancelCurrent("COMMAND_CANCELLED", "命令已取消。 ");
                return;
            }
            current = command;
            cancelled = false;
            phase = "executing";
            detail = actionLabel(command.action);
            updateNotification(detail + " · 可随时停止");
            postStatus();
            timeoutTask = () -> finish(ControlResult.fail(command.id, "TIMEOUT", "手机操作超时，已取消。 "), 0);
            mainHandler.postDelayed(timeoutTask, command.timeoutMs);
            execute(command, 0);
        } catch (Exception error) {
            phase = "connection-error";
            detail = "控制通道暂时不可用，正在重试";
        } finally {
            polling.set(false);
        }
    }

    private void execute(ControlCommand command, int attempt) {
        if (cancelled || current != command) return;
        HarnessControlAccessibilityService accessibility = HarnessControlAccessibilityService.get();
        if (command.requiresConfirmation) {
            if (accessibility == null) {
                finish(ControlResult.fail(command.id, "ACCESSIBILITY_REQUIRED", "敏感动作需要先开启 Harness 无障碍服务。 "), attempt);
                return;
            }
            phase = "waiting-confirmation";
            detail = "等待你在手机上确认";
            updateNotification(detail);
            accessibility.confirmSensitive(command.action, allowed -> {
                if (!allowed) finish(ControlResult.fail(command.id, "USER_DENIED", "用户拒绝了本次敏感操作。 "), command.retryLimit);
                else executeApproved(command, attempt);
            });
            return;
        }
        executeApproved(command, attempt);
    }

    private void executeApproved(ControlCommand command, int attempt) {
        if (cancelled || current != command) return;
        mainHandler.post(() -> {
            try {
                switch (command.action) {
                    case "observe" -> executeObserve(command, attempt);
                    case "tap" -> requireAccessibility(command, attempt, service -> service.tap(
                        (float) command.payload.optDouble("x"),
                        (float) command.payload.optDouble("y"),
                        60,
                        ok -> gestureResult(command, attempt, ok, "已点击指定位置。")
                    ));
                    case "longPress" -> requireAccessibility(command, attempt, service -> service.tap(
                        (float) command.payload.optDouble("x"),
                        (float) command.payload.optDouble("y"),
                        command.payload.optLong("durationMs", 650),
                        ok -> gestureResult(command, attempt, ok, "已长按指定位置。")
                    ));
                    case "swipe" -> requireAccessibility(command, attempt, service -> service.swipe(
                        (float) command.payload.optDouble("startX"),
                        (float) command.payload.optDouble("startY"),
                        (float) command.payload.optDouble("endX"),
                        (float) command.payload.optDouble("endY"),
                        command.payload.optLong("durationMs", 450),
                        ok -> gestureResult(command, attempt, ok, "已完成滑动。")
                    ));
                    case "back" -> executeGlobal(command, attempt, AccessibilityService.GLOBAL_ACTION_BACK, "已返回上一页。 ");
                    case "home" -> executeGlobal(command, attempt, AccessibilityService.GLOBAL_ACTION_HOME, "已返回主屏幕。 ");
                    case "recents" -> executeGlobal(command, attempt, AccessibilityService.GLOBAL_ACTION_RECENTS, "已打开最近任务。 ");
                    case "textInput" -> requireAccessibility(command, attempt, service -> {
                        boolean ok = service.inputText(command.payload.optString("text", ""));
                        finish(ok ? ControlResult.ok(command.id, "已向当前非密码编辑控件输入文字。", null) : ControlResult.fail(command.id, "TEXT_TARGET_UNAVAILABLE", "没有找到可安全输入的非密码编辑控件。 "), attempt);
                    });
                    case "openApp" -> openApp(command, attempt);
                    case "openUri" -> openUri(command, attempt);
                    case "openSettings" -> openSettings(command, attempt);
                    case "screenshot" -> startScreenCapture(command);
                    case "fileOpen", "fileCreate" -> startDocumentPicker(command);
                    case "clearCache" -> clearCache(command, attempt);
                    default -> finish(ControlResult.fail(command.id, "UNSUPPORTED_ACTION", "不支持的手机操作。 "), command.retryLimit);
                }
            } catch (Exception error) {
                finish(ControlResult.fail(command.id, "ACTION_FAILED", "手机操作失败：" + error.getMessage()), attempt);
            }
        });
    }

    private void executeObserve(ControlCommand command, int attempt) throws JSONException {
        HarnessControlAccessibilityService service = HarnessControlAccessibilityService.get();
        if (service == null) {
            finish(ControlResult.fail(command.id, "ACCESSIBILITY_REQUIRED", "请先开启 Harness 无障碍服务。 "), attempt);
            return;
        }
        JSONObject data = service.observe(command.payload.optInt("maxNodes", 80), command.payload.optBoolean("includeText", true));
        finish(ControlResult.ok(command.id, "已读取当前前台页面的可访问节点摘要。", data), attempt);
    }

    private void executeGlobal(ControlCommand command, int attempt, int action, String message) {
        requireAccessibility(command, attempt, service -> {
            boolean ok = service.global(action);
            finish(ok ? ControlResult.ok(command.id, message, null) : ControlResult.fail(command.id, "GLOBAL_ACTION_FAILED", "系统拒绝了全局导航操作。 "), attempt);
        });
    }

    private void openApp(ControlCommand command, int attempt) {
        String packageName = command.payload.optString("packageName", "");
        if (!packageName.matches("[A-Za-z][A-Za-z0-9_]*(?:\\.[A-Za-z0-9_]+)+")) {
            finish(ControlResult.fail(command.id, "INVALID_PACKAGE", "目标应用包名无效。 "), command.retryLimit);
            return;
        }
        Intent intent = new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER).setPackage(packageName).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            startActivity(intent);
            finish(ControlResult.ok(command.id, "已请求打开目标应用。", new JSONObject().put("packageName", packageName)), attempt);
        } catch (Exception error) {
            finish(ControlResult.fail(command.id, "APP_NOT_FOUND", "未找到可打开的目标应用。 "), command.retryLimit);
        }
    }

    private void openUri(ControlCommand command, int attempt) {
        Uri uri = Uri.parse(command.payload.optString("uri", ""));
        String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase();
        if (!ALLOWED_URI_SCHEMES.contains(scheme)) {
            finish(ControlResult.fail(command.id, "URI_NOT_ALLOWED", "该链接协议不在允许列表中。 "), command.retryLimit);
            return;
        }
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, uri).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            finish(ControlResult.ok(command.id, "已交给系统打开明确链接。", null), attempt);
        } catch (Exception error) {
            finish(ControlResult.fail(command.id, "URI_OPEN_FAILED", "没有可处理此链接的应用。 "), command.retryLimit);
        }
    }

    private void openSettings(ControlCommand command, int attempt) {
        String target = command.payload.optString("target", "settings");
        String packageName = command.payload.optString("packageName", getPackageName());
        Intent intent;
        if ("accessibility".equals(target)) intent = new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS);
        else if ("usageAccess".equals(target)) intent = new Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS);
        else if ("notifications".equals(target)) intent = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, packageName);
        else if ("appDetails".equals(target)) intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + packageName));
        else if ("appStorage".equals(target)) intent = new Intent(Settings.ACTION_INTERNAL_STORAGE_SETTINGS, Uri.parse("package:" + packageName));
        else intent = new Intent(Settings.ACTION_SETTINGS);
        try {
            startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            finish(ControlResult.ok(command.id, "已打开系统设置页面。", null), attempt);
        } catch (Exception error) {
            finish(ControlResult.fail(command.id, "SETTINGS_UNAVAILABLE", "此系统没有对应的设置页面。 "), command.retryLimit);
        }
    }

    private void startScreenCapture(ControlCommand command) {
        phase = "waiting-capture";
        detail = "等待你允许屏幕捕获";
        updateNotification(detail);
        Intent intent = new Intent(this, ScreenCaptureActivity.class)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_EXCLUDE_FROM_RECENTS)
            .putExtra("commandId", command.id)
            .putExtra("maxWidth", command.payload.optInt("maxWidth", 720))
            .putExtra("quality", command.payload.optInt("quality", 62));
        try { startActivity(intent); }
        catch (Exception error) { finish(ControlResult.fail(command.id, "CAPTURE_PROMPT_FAILED", "无法显示屏幕捕获授权。 "), command.retryLimit); }
    }

    private void startDocumentPicker(ControlCommand command) {
        phase = "waiting-file";
        detail = "等待你在系统文件选择器中选择";
        updateNotification(detail);
        Intent intent = new Intent(this, DocumentPickerActivity.class)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_EXCLUDE_FROM_RECENTS)
            .putExtra("commandId", command.id)
            .putExtra("mode", "fileCreate".equals(command.action) ? "create" : "open")
            .putExtra("mimeType", command.payload.optString("mimeType", "*/*"))
            .putExtra("suggestedName", command.payload.optString("suggestedName", "Harness-export"))
            .putExtra("maxBytes", command.payload.optInt("maxBytes", 2 * 1024 * 1024))
            .putExtra("contentBase64", command.payload.optString("contentBase64", ""));
        try { startActivity(intent); }
        catch (Exception error) { finish(ControlResult.fail(command.id, "FILE_PICKER_FAILED", "无法打开系统文件选择器。 "), command.retryLimit); }
    }

    private void clearCache(ControlCommand command, int attempt) {
        String packageName = command.payload.optString("packageName", "");
        if (!packageName.matches("[A-Za-z][A-Za-z0-9_]*(?:\\.[A-Za-z0-9_]+)+")) {
            finish(ControlResult.fail(command.id, "INVALID_PACKAGE", "目标应用包名无效。 "), command.retryLimit);
            return;
        }
        try {
            Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + packageName)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(intent);
            phase = "guided-cache";
            detail = "已打开存储设置，正在查找“清除缓存”";
            updateNotification(detail);
            mainHandler.postDelayed(() -> {
                HarnessControlAccessibilityService service = HarnessControlAccessibilityService.get();
                if (service != null && service.clickClearCacheButton()) {
                    finish(ControlResult.ok(command.id, "已点击系统“清除缓存”按钮；未触碰“清除数据”。", new JSONObject()), attempt);
                } else {
                    finish(ControlResult.fail(command.id, "CACHE_GUIDED_MODE", "系统或 ROM 未提供可识别的“清除缓存”按钮。已停留在目标应用设置页，请手动点击；未执行清除数据。 "), command.retryLimit);
                }
            }, 1500L);
        } catch (Exception error) {
            finish(ControlResult.fail(command.id, "CACHE_SETTINGS_UNAVAILABLE", "无法打开目标应用系统设置页。 "), command.retryLimit);
        }
    }

    private void requireAccessibility(ControlCommand command, int attempt, java.util.function.Consumer<HarnessControlAccessibilityService> action) {
        HarnessControlAccessibilityService service = HarnessControlAccessibilityService.get();
        if (service == null) finish(ControlResult.fail(command.id, "ACCESSIBILITY_REQUIRED", "请先开启 Harness 无障碍服务。 "), attempt);
        else action.accept(service);
    }

    private void gestureResult(ControlCommand command, int attempt, boolean ok, String message) {
        finish(ok ? ControlResult.ok(command.id, message, null) : ControlResult.fail(command.id, "GESTURE_CANCELLED", "系统取消了手势。 "), attempt);
    }

    private synchronized void finish(ControlResult result, int attempt) {
        ControlCommand command = current;
        if (command == null || !command.id.equals(result.id)) return;
        if (!result.ok && attempt < command.retryLimit && !NON_RETRYABLE_RESULTS.contains(result.code)) {
            mainHandler.postDelayed(() -> execute(command, attempt + 1), 350L);
            return;
        }
        if (timeoutTask != null) mainHandler.removeCallbacks(timeoutTask);
        timeoutTask = null;
        current = null;
        phase = result.ok ? "completed" : "failed";
        detail = result.ok ? "操作已完成" : result.message;
        updateNotification(detail + " · 可随时停止");
        network.execute(() -> {
            try { request("POST", "/__harness_mobile__/control/result", result.toJson(), 10 * 1024 * 1024); }
            catch (Exception ignored) {}
            lastStatusAt = 0;
        });
    }

    private synchronized void cancelCurrent(String code, String message) {
        cancelled = true;
        ControlCommand command = current;
        if (command != null) finish(ControlResult.fail(command.id, code, message), command.retryLimit);
        current = null;
        if (timeoutTask != null) mainHandler.removeCallbacks(timeoutTask);
        timeoutTask = null;
    }

    private void postStatus() {
        try {
            JSONArray capabilities = new JSONArray();
            for (String value : new String[]{"nodeSummary", "tap", "longPress", "swipe", "back", "home", "recents", "textInput", "openApp", "openUri", "openSettings", "screenshot", "filePicker", "clearCache"}) capabilities.put(value);
            JSONObject status = new JSONObject()
                .put("protocolVersion", ControlCommand.PROTOCOL_VERSION)
                .put("enabled", ControlPreferences.isEnabled(this))
                .put("ready", ControlPreferences.isEnabled(this) && HarnessControlAccessibilityService.isConnected())
                .put("accessibility", HarnessControlAccessibilityService.isConnected())
                .put("captureActive", "waiting-capture".equals(phase))
                .put("capabilities", capabilities)
                .put("phase", phase)
                .put("detail", detail);
            if (current != null) status.put("currentCommandId", current.id);
            request("POST", "/__harness_mobile__/control/status", status, 128 * 1024);
        } catch (Exception ignored) {}
    }

    private JSONObject request(String method, String path, JSONObject body, int maximumBytes) throws Exception {
        String origin = getSharedPreferences(MainActivity.PREFS, MODE_PRIVATE).getString(MainActivity.SAVED_ORIGIN, "");
        if (!PairingLinkValidator.isSafeHarnessUrl(origin, false) && !origin.contains(PairingProfile.STABLE_HOST)) throw new IllegalStateException("尚未连接电脑工作台");
        URL url = new URL(origin.replaceAll("/$", "") + path);
        HttpURLConnection connection = (HttpURLConnection) url.openConnection();
        connection.setRequestMethod(method);
        connection.setConnectTimeout(2500);
        connection.setReadTimeout(5000);
        connection.setUseCaches(false);
        connection.setRequestProperty("Accept", "application/json");
        String cookie = CookieManager.getInstance().getCookie(origin);
        if (cookie != null && !cookie.isBlank()) connection.setRequestProperty("Cookie", cookie);
        if (body != null) {
            byte[] bytes = body.toString().getBytes(StandardCharsets.UTF_8);
            connection.setDoOutput(true);
            connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
            connection.setFixedLengthStreamingMode(bytes.length);
            try (OutputStream output = connection.getOutputStream()) { output.write(bytes); }
        }
        int status = connection.getResponseCode();
        InputStream input = status >= 400 ? connection.getErrorStream() : connection.getInputStream();
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        if (input != null) {
            try (input) {
                byte[] buffer = new byte[8192];
                int count;
                while ((count = input.read(buffer)) >= 0) {
                    if (output.size() + count > maximumBytes) throw new IllegalStateException("控制响应超过大小上限");
                    output.write(buffer, 0, count);
                }
            }
        }
        connection.disconnect();
        String text = new String(output.toByteArray(), StandardCharsets.UTF_8);
        if (status < 200 || status >= 300) throw new IllegalStateException("HTTP " + status);
        return text.isBlank() ? new JSONObject() : new JSONObject(text);
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationChannel channel = new NotificationChannel(CHANNEL_ID, "Harness 手机控制", NotificationManager.IMPORTANCE_LOW);
        channel.setDescription("显示手机控制状态，并提供立即停止入口");
        getSystemService(NotificationManager.class).createNotificationChannel(channel);
    }

    private Notification notification(String message) {
        PendingIntent settings = PendingIntent.getActivity(this, 0, new Intent(this, ControlSettingsActivity.class), PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        PendingIntent stop = PendingIntent.getService(this, 1, new Intent(this, ControlForegroundService.class).setAction(ACTION_STOP), PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        return new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle("Harness 手机控制")
            .setContentText(message)
            .setContentIntent(settings)
            .setOngoing(true)
            .setSilent(true)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .addAction(android.R.drawable.ic_media_pause, "立即停止", stop)
            .build();
    }

    private void updateNotification(String message) {
        getSystemService(NotificationManager.class).notify(NOTIFICATION_ID, notification(message));
    }

    private static String actionLabel(String action) {
        return switch (action) {
            case "observe" -> "正在观察当前页面";
            case "tap" -> "正在点击";
            case "longPress" -> "正在长按";
            case "swipe" -> "正在滑动";
            case "textInput" -> "等待确认输入文字";
            case "screenshot" -> "等待屏幕捕获授权";
            case "fileOpen", "fileCreate" -> "等待系统文件选择";
            case "clearCache" -> "准备打开应用存储设置";
            default -> "正在执行手机操作";
        };
    }
}
