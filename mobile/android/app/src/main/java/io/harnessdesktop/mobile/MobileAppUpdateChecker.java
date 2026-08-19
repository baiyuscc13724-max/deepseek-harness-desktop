package io.harnessdesktop.mobile;

import android.content.Context;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HashSet;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Foreground-only update client. Android still owns and confirms final APK installation. */
final class MobileAppUpdateChecker {
    static final int MAX_MANIFEST_BYTES = 256 * 1024;
    static final long MAX_APK_BYTES = 512L * 1024L * 1024L;

    static final class Update {
        final String version;
        final String url;
        final String sha256;
        final boolean required;

        Update(String version, String url, String sha256, boolean required) {
            this.version = version;
            this.url = url;
            this.sha256 = sha256;
            this.required = required;
        }
    }

    interface Callback { void complete(Update update, Exception error); }
    interface DownloadCallback { void complete(File apk, Exception error); }

    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    void check(String manifestUrl, String currentVersion, Callback callback) {
        if (!isSafeHttpsUrl(manifestUrl, false)) {
            callback.complete(null, null);
            return;
        }
        executor.execute(() -> {
            try {
                HttpURLConnection connection = open(manifestUrl);
                int status = connection.getResponseCode();
                if (status != 200) throw new IllegalStateException("更新清单响应异常：" + status);
                int declaredLength = connection.getContentLength();
                if (declaredLength > MAX_MANIFEST_BYTES) throw new IllegalArgumentException("更新清单过大");
                String body;
                try (InputStream input = connection.getInputStream()) {
                    body = new String(readBounded(input, MAX_MANIFEST_BYTES), StandardCharsets.UTF_8);
                } finally {
                    connection.disconnect();
                }
                Update update = parse(body, currentVersion);
                mainHandler.post(() -> callback.complete(update, null));
            } catch (Exception error) {
                mainHandler.post(() -> callback.complete(null, error));
            }
        });
    }

    void downloadAndVerify(Context context, Update update, DownloadCallback callback) {
        executor.execute(() -> {
            File temporary = null;
            try {
                File directory = new File(context.getCacheDir(), "mobile-updates");
                if (!directory.exists() && !directory.mkdirs()) throw new IllegalStateException("无法创建更新目录");
                temporary = new File(directory, "Harness-Mobile-" + update.version + ".apk.part");
                File verified = new File(directory, "Harness-Mobile-" + update.version + ".apk");
                if (!temporary.delete() && temporary.exists()) throw new IllegalStateException("无法清理旧更新文件");
                if (!verified.delete() && verified.exists()) throw new IllegalStateException("无法替换旧更新文件");

                HttpURLConnection connection = open(update.url);
                int status = connection.getResponseCode();
                long declaredLength = connection.getContentLengthLong();
                if (status != 200 || declaredLength > MAX_APK_BYTES) throw new IllegalStateException("APK 下载响应异常");
                MessageDigest digest = MessageDigest.getInstance("SHA-256");
                long total = 0;
                try (InputStream input = connection.getInputStream(); FileOutputStream output = new FileOutputStream(temporary)) {
                    byte[] buffer = new byte[64 * 1024];
                    int read;
                    while ((read = input.read(buffer)) >= 0) {
                        total += read;
                        if (total > MAX_APK_BYTES) throw new IllegalArgumentException("APK 文件过大");
                        digest.update(buffer, 0, read);
                        output.write(buffer, 0, read);
                    }
                    output.getFD().sync();
                } finally {
                    connection.disconnect();
                }
                if (total <= 0 || !hex(digest.digest()).equals(update.sha256)) throw new SecurityException("APK SHA-256 校验失败");
                verifyInstalledSigningIdentity(context, temporary);
                if (!temporary.renameTo(verified)) throw new IllegalStateException("无法提交已校验 APK");
                File result = verified;
                mainHandler.post(() -> callback.complete(result, null));
            } catch (Exception error) {
                if (temporary != null) temporary.delete();
                mainHandler.post(() -> callback.complete(null, error));
            }
        });
    }

    void close() { executor.shutdownNow(); }

    static Update parse(String body, String currentVersion) throws Exception {
        JSONObject root = new JSONObject(body);
        if (root.optInt("schemaVersion", 0) != 1) throw new IllegalArgumentException("不支持的手机更新清单");
        JSONObject android = root.getJSONObject("platforms").getJSONObject("android");
        String version = android.getString("version").trim();
        String url = android.getString("url").trim();
        String sha256 = android.getString("sha256").trim().toLowerCase();
        if (!version.matches("[0-9]+(?:\\.[0-9]+){1,3}")) throw new IllegalArgumentException("Android 更新版本无效");
        if (!isSafeHttpsUrl(url, true)) throw new IllegalArgumentException("Android 更新必须是无凭据的 HTTPS APK");
        if (!sha256.matches("[0-9a-f]{64}")) throw new IllegalArgumentException("Android APK SHA-256 无效");
        if (compareVersions(version, currentVersion) <= 0) return null;
        return new Update(version, url, sha256, android.optBoolean("required", false));
    }

    static int compareVersions(String left, String right) {
        String[] a = String.valueOf(left).split("\\.");
        String[] b = String.valueOf(right).split("\\.");
        for (int index = 0; index < Math.max(a.length, b.length); index++) {
            int av = index < a.length && a[index].matches("[0-9]+") ? Integer.parseInt(a[index]) : 0;
            int bv = index < b.length && b[index].matches("[0-9]+") ? Integer.parseInt(b[index]) : 0;
            if (av != bv) return Integer.compare(av, bv);
        }
        return 0;
    }

    private static HttpURLConnection open(String value) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(value).openConnection();
        connection.setConnectTimeout(12_000);
        connection.setReadTimeout(30_000);
        connection.setInstanceFollowRedirects(false);
        connection.setRequestProperty("Accept", "application/json, application/vnd.android.package-archive");
        return connection;
    }

    private static boolean isSafeHttpsUrl(String value, boolean apk) {
        try {
            URI uri = URI.create(String.valueOf(value));
            if (!"https".equalsIgnoreCase(uri.getScheme()) || uri.getHost() == null || uri.getUserInfo() != null || uri.getFragment() != null) return false;
            return !apk || uri.getPath().toLowerCase().endsWith(".apk");
        } catch (Exception ignored) {
            return false;
        }
    }

    private static void verifyInstalledSigningIdentity(Context context, File apk) throws Exception {
        PackageManager manager = context.getPackageManager();
        int flags = Build.VERSION.SDK_INT >= 28 ? PackageManager.GET_SIGNING_CERTIFICATES : PackageManager.GET_SIGNATURES;
        PackageInfo archive = manager.getPackageArchiveInfo(apk.getAbsolutePath(), flags);
        PackageInfo installed = manager.getPackageInfo(context.getPackageName(), flags);
        if (archive == null || !context.getPackageName().equals(archive.packageName)) throw new SecurityException("APK 包名不匹配");
        Set<String> archiveSigners = signerDigests(archive);
        Set<String> installedSigners = signerDigests(installed);
        archiveSigners.retainAll(installedSigners);
        if (archiveSigners.isEmpty()) throw new SecurityException("APK 应用签名与当前安装不一致");
    }

    @SuppressWarnings("deprecation")
    private static Set<String> signerDigests(PackageInfo info) throws Exception {
        Signature[] signatures;
        if (Build.VERSION.SDK_INT >= 28) {
            if (info.signingInfo == null) return Set.of();
            signatures = info.signingInfo.hasMultipleSigners()
                ? info.signingInfo.getApkContentsSigners()
                : info.signingInfo.getSigningCertificateHistory();
        } else {
            signatures = info.signatures;
        }
        Set<String> result = new HashSet<>();
        if (signatures != null) for (Signature signature : signatures) {
            result.add(hex(MessageDigest.getInstance("SHA-256").digest(signature.toByteArray())));
        }
        return result;
    }

    private static String hex(byte[] value) {
        StringBuilder result = new StringBuilder(value.length * 2);
        for (byte item : value) result.append(String.format("%02x", item & 0xff));
        return result.toString();
    }

    private static byte[] readBounded(InputStream input, int limit) throws Exception {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        byte[] buffer = new byte[8 * 1024];
        int read;
        while ((read = input.read(buffer)) >= 0) {
            if (output.size() + read > limit) throw new IllegalArgumentException("更新清单过大");
            output.write(buffer, 0, read);
        }
        return output.toByteArray();
    }
}
