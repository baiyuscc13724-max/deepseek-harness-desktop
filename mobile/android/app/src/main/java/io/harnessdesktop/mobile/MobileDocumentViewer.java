package io.harnessdesktop.mobile;

import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.Intent;
import android.net.Uri;
import android.webkit.CookieManager;
import android.webkit.MimeTypeMap;
import android.webkit.WebView;
import android.widget.Toast;

import androidx.appcompat.app.AppCompatActivity;
import androidx.core.content.FileProvider;

import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

final class MobileDocumentViewer implements AutoCloseable {
    private static final long MAX_DOCUMENT_BYTES = 100L * 1024L * 1024L;
    private static final String DOCUMENT_DIRECTORY = "mobile-documents";
    private final AppCompatActivity activity;
    private final WebView webView;
    private final ExecutorService downloads = Executors.newSingleThreadExecutor();

    MobileDocumentViewer(AppCompatActivity activity, WebView webView) {
        this.activity = activity;
        this.webView = webView;
    }

    void open(String urlValue, String suggestedName, String suggestedMimeType) {
        if (activity.isFinishing() || activity.isDestroyed()) return;
        Uri current = Uri.parse(webView.getUrl() == null ? "" : webView.getUrl());
        Uri target = Uri.parse(urlValue == null ? "" : urlValue);
        if (!sameOrigin(current, target) || !allowedPath(target.getPath())) {
            notifyState("error", suggestedName, "无法打开不受信任的文档地址");
            return;
        }
        String cookie = CookieManager.getInstance().getCookie(target.toString());
        String userAgent = webView.getSettings().getUserAgentString();
        String safeName = safeFileName(suggestedName, target);
        notifyState("pending", safeName, "正在准备文档…");
        downloads.execute(() -> {
            File downloaded = null;
            try {
                downloaded = download(target, safeName, cookie, userAgent);
                String mimeType = resolveMimeType(suggestedMimeType, downloaded.getName());
                File ready = downloaded;
                activity.runOnUiThread(() -> openDownloaded(ready, mimeType));
            } catch (Exception error) {
                if (downloaded != null) downloaded.delete();
                notifyState("error", safeName, "文档读取失败，请确认电脑端仍在线后重试");
            }
        });
    }

    private File download(Uri target, String fileName, String cookie, String userAgent) throws IOException {
        HttpURLConnection connection = (HttpURLConnection) localProxyUrl(target).openConnection();
        connection.setInstanceFollowRedirects(false);
        connection.setConnectTimeout(15_000);
        connection.setReadTimeout(60_000);
        connection.setRequestProperty("Accept", "*/*");
        if (cookie != null && !cookie.isEmpty()) connection.setRequestProperty("Cookie", cookie);
        if (userAgent != null && !userAgent.isEmpty()) connection.setRequestProperty("User-Agent", userAgent);
        int status = connection.getResponseCode();
        if (status < 200 || status >= 300) {
            connection.disconnect();
            throw new IOException("document HTTP " + status);
        }
        long declared = connection.getContentLengthLong();
        if (declared > MAX_DOCUMENT_BYTES) {
            connection.disconnect();
            throw new IOException("document is too large");
        }
        File directory = new File(activity.getCacheDir(), DOCUMENT_DIRECTORY);
        if (!directory.exists() && !directory.mkdirs()) {
            connection.disconnect();
            throw new IOException("document directory unavailable");
        }
        removeOldDocuments(directory);
        File temporary = new File(directory, fileName + ".part");
        File destination = new File(directory, fileName);
        long total = 0L;
        try (InputStream input = connection.getInputStream(); FileOutputStream output = new FileOutputStream(temporary, false)) {
            byte[] buffer = new byte[32 * 1024];
            int read;
            while ((read = input.read(buffer)) >= 0) {
                if (read == 0) continue;
                total += read;
                if (total > MAX_DOCUMENT_BYTES) throw new IOException("document is too large");
                output.write(buffer, 0, read);
            }
            output.flush();
        } finally {
            connection.disconnect();
        }
        if (total == 0L || (!temporary.renameTo(destination) && !replaceFile(temporary, destination))) {
            temporary.delete();
            throw new IOException("document was not saved");
        }
        return destination;
    }

    private static boolean replaceFile(File source, File destination) throws IOException {
        if (destination.exists() && !destination.delete()) return false;
        if (source.renameTo(destination)) return true;
        try (InputStream input = new java.io.FileInputStream(source); FileOutputStream output = new FileOutputStream(destination, false)) {
            byte[] buffer = new byte[32 * 1024];
            int read;
            while ((read = input.read(buffer)) >= 0) {
                if (read > 0) output.write(buffer, 0, read);
            }
        }
        source.delete();
        return true;
    }

    private void openDownloaded(File document, String mimeType) {
        if (activity.isFinishing() || activity.isDestroyed()) return;
        try {
            Uri content = FileProvider.getUriForFile(activity, activity.getPackageName() + ".mobile-inputs", document);
            Intent view = new Intent(Intent.ACTION_VIEW)
                .setDataAndType(content, mimeType)
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            view.setClipData(ClipData.newRawUri("Harness document", content));
            activity.startActivity(Intent.createChooser(view, "打开文档"));
            notifyState("success", document.getName(), "已交给手机上的文档应用打开");
        } catch (ActivityNotFoundException | IllegalArgumentException | SecurityException error) {
            notifyState("error", document.getName(), "手机上没有可打开此文档的应用");
        }
    }

    private void notifyState(String phase, String name, String message) {
        activity.runOnUiThread(() -> {
            if (activity.isFinishing() || activity.isDestroyed()) return;
            Toast.makeText(activity, message, "error".equals(phase) ? Toast.LENGTH_LONG : Toast.LENGTH_SHORT).show();
            if (webView.getHandler() == null) return;
            String script = "window.dispatchEvent(new CustomEvent('harness-mobile-document-open-state',{detail:{phase:"
                + JSONObject.quote(phase) + ",name:" + JSONObject.quote(name == null ? "" : name)
                + ",message:" + JSONObject.quote(message) + "}}));true;";
            webView.evaluateJavascript(script, null);
        });
    }

    private static boolean sameOrigin(Uri left, Uri right) {
        if (left == null || right == null || left.getScheme() == null || right.getScheme() == null) return false;
        if (!left.getScheme().equalsIgnoreCase(right.getScheme())) return false;
        if (left.getHost() == null || right.getHost() == null || !left.getHost().equalsIgnoreCase(right.getHost())) return false;
        return effectivePort(left) == effectivePort(right);
    }

    private static int effectivePort(Uri value) {
        if (value.getPort() >= 0) return value.getPort();
        return "https".equalsIgnoreCase(value.getScheme()) ? 443 : 80;
    }

    private static URL localProxyUrl(Uri target) throws IOException {
        if (!"http".equalsIgnoreCase(target.getScheme())) throw new IOException("local document proxy must use HTTP");
        Uri loopback = target.buildUpon().encodedAuthority("127.0.0.1:" + effectivePort(target)).build();
        return new URL(loopback.toString());
    }

    private static boolean allowedPath(String path) {
        return "/api/desktop-files/content".equals(path) || "/api/desktop-files/download".equals(path);
    }

    private static String safeFileName(String value, Uri target) {
        String fallback = target == null ? "document" : target.getLastPathSegment();
        String name = value == null || value.trim().isEmpty() ? fallback : value.trim();
        if (name == null || name.isEmpty()) name = "document";
        name = name.replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]", "_");
        while (name.startsWith(".")) name = name.substring(1);
        if (name.isEmpty()) name = "document";
        if (name.length() > 180) name = name.substring(name.length() - 180);
        return name;
    }

    private static String resolveMimeType(String suggested, String name) {
        if (suggested != null && !suggested.trim().isEmpty() && !"application/octet-stream".equalsIgnoreCase(suggested.trim())) {
            return suggested.trim();
        }
        String extension = MimeTypeMap.getFileExtensionFromUrl(name == null ? "" : name).toLowerCase(Locale.ROOT);
        String detected = MimeTypeMap.getSingleton().getMimeTypeFromExtension(extension);
        if (detected != null && !detected.isEmpty()) return detected;
        if ("docx".equals(extension)) return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
        if ("xlsx".equals(extension)) return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
        if ("pptx".equals(extension)) return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
        if ("md".equals(extension)) return "text/markdown";
        return "application/octet-stream";
    }

    private static void removeOldDocuments(File directory) {
        File[] files = directory.listFiles();
        if (files == null) return;
        long cutoff = System.currentTimeMillis() - 24L * 60L * 60L * 1_000L;
        for (File file : files) if (file.isFile() && file.lastModified() < cutoff) file.delete();
    }

    @Override public void close() {
        downloads.shutdownNow();
    }
}
