package io.harnessdesktop.mobile;

import android.content.Context;
import android.webkit.CookieManager;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Semaphore;

final class MobileAssetCache {
    private static final int CONNECT_TIMEOUT_MS = 8_000;
    private static final int READ_TIMEOUT_MS = 45_000;
    private static final int MAX_ENTRY_BYTES = 8 * 1024 * 1024;
    private static final long MAX_CACHE_BYTES = 64L * 1024L * 1024L;
    private static final long PRUNE_TO_BYTES = 48L * 1024L * 1024L;

    private final File root;
    private final Map<String, Object> locks = new ConcurrentHashMap<>();
    private final Semaphore downloads = new Semaphore(6, true);

    MobileAssetCache(Context context) {
        root = new File(context.getCacheDir(), "harness-static-assets-v1");
        if (!root.exists()) root.mkdirs();
    }

    WebResourceResponse intercept(WebResourceRequest request) {
        if (!isVersionedStaticAsset(request)) return null;
        String url = request.getUrl().toString();
        String key = sha256(url);
        File cached = new File(root, key + ".bin");
        if (isUsable(cached)) return response(cached, url);

        Object lock = locks.computeIfAbsent(key, ignored -> new Object());
        try {
            synchronized (lock) {
                if (isUsable(cached)) return response(cached, url);
                boolean acquired = false;
                try {
                    downloads.acquire();
                    acquired = true;
                    return download(request, cached);
                } catch (InterruptedException error) {
                    Thread.currentThread().interrupt();
                    return null;
                } finally {
                    if (acquired) downloads.release();
                }
            }
        } finally {
            locks.remove(key, lock);
        }
    }

    private WebResourceResponse download(WebResourceRequest request, File target) {
        HttpURLConnection connection = null;
        File temporary = new File(root, target.getName() + ".tmp");
        try {
            String path = request.getUrl().getEncodedPath();
            if (path == null || path.isBlank()) path = "/";
            String query = request.getUrl().getEncodedQuery();
            URL loopbackUrl = new URL("http", "127.0.0.1", request.getUrl().getPort(), path + (query == null ? "" : "?" + query));
            connection = (HttpURLConnection) loopbackUrl.openConnection();
            connection.setConnectTimeout(CONNECT_TIMEOUT_MS);
            connection.setReadTimeout(READ_TIMEOUT_MS);
            connection.setUseCaches(false);
            connection.setInstanceFollowRedirects(false);
            connection.setRequestMethod("GET");
            for (Map.Entry<String, String> header : request.getRequestHeaders().entrySet()) {
                String name = header.getKey();
                if (name == null || name.equalsIgnoreCase("Host") || name.equalsIgnoreCase("Connection")
                    || name.equalsIgnoreCase("Accept-Encoding") || name.equalsIgnoreCase("Cookie")) continue;
                connection.setRequestProperty(name, header.getValue());
            }
            connection.setRequestProperty("Accept-Encoding", "identity");
            connection.setRequestProperty("Connection", "close");
            connection.setRequestProperty("Host", PairingProfile.STABLE_HOST + ":" + request.getUrl().getPort());
            String cookie = CookieManager.getInstance().getCookie(request.getUrl().toString());
            if (cookie != null && !cookie.isBlank()) connection.setRequestProperty("Cookie", cookie);

            int status = connection.getResponseCode();
            if (status != HttpURLConnection.HTTP_OK) {
                return null;
            }
            long length;
            try (InputStream input = connection.getInputStream(); FileOutputStream output = new FileOutputStream(temporary)) {
                length = copyBounded(input, output);
                if (length <= 0) return null;
                output.getFD().sync();
            }
            if (target.exists()) target.delete();
            if (!temporary.renameTo(target)) return null;
            target.setLastModified(System.currentTimeMillis());
            pruneIfNeeded();
            return response(target, request.getUrl().toString());
        } catch (IOException error) {
            return null;
        } finally {
            if (temporary.exists()) temporary.delete();
            if (connection != null) connection.disconnect();
        }
    }

    private static long copyBounded(InputStream input, OutputStream output) throws IOException {
        byte[] buffer = new byte[16 * 1024];
        long total = 0;
        int count;
        while ((count = input.read(buffer)) >= 0) {
            total += count;
            if (total > MAX_ENTRY_BYTES) return -1;
            output.write(buffer, 0, count);
        }
        return total;
    }

    private static WebResourceResponse response(File file, String url) {
        try {
            Map<String, String> headers = new HashMap<>();
            headers.put("Cache-Control", "public, max-age=31536000, immutable");
            headers.put("Content-Length", Long.toString(file.length()));
            headers.put("X-Harness-Mobile-Cache", "hit");
            return new WebResourceResponse(mimeType(url), "UTF-8", 200, "OK", headers, new FileInputStream(file));
        } catch (IOException error) {
            return null;
        }
    }

    private static boolean isVersionedStaticAsset(WebResourceRequest request) {
        if (request == null || !"GET".equalsIgnoreCase(request.getMethod())) return false;
        if (!"http".equalsIgnoreCase(request.getUrl().getScheme())) return false;
        if (!PairingProfile.STABLE_HOST.equalsIgnoreCase(request.getUrl().getHost())) return false;
        String path = request.getUrl().getPath();
        if (path == null) return false;
        if (path.startsWith("/plugins/") && path.endsWith("/client.js")) {
            String query = request.getUrl().getQuery();
            return query != null && query.matches("(?:^|.*&)rev=[A-Za-z0-9_-]{8,64}(?:&.*|$)");
        }
        if (!path.startsWith("/assets/")) return false;
        String name = path.substring(path.lastIndexOf('/') + 1);
        return name.matches(".+-[A-Za-z0-9_-]{6,}\\.(?:js|css|svg|png|webp|woff2?)");
    }

    private static String mimeType(String url) {
        String path = url.toLowerCase(Locale.ROOT).split("\\?", 2)[0];
        if (path.endsWith(".js")) return "application/javascript";
        if (path.endsWith(".css")) return "text/css";
        if (path.endsWith(".svg")) return "image/svg+xml";
        if (path.endsWith(".png")) return "image/png";
        if (path.endsWith(".webp")) return "image/webp";
        if (path.endsWith(".woff")) return "font/woff";
        if (path.endsWith(".woff2")) return "font/woff2";
        return "application/octet-stream";
    }

    private static boolean isUsable(File file) {
        return file.isFile() && file.length() > 0 && file.length() <= MAX_ENTRY_BYTES;
    }

    private void pruneIfNeeded() {
        File[] values = root.listFiles((dir, name) -> name.endsWith(".bin"));
        if (values == null) return;
        long total = 0;
        List<File> files = new ArrayList<>();
        for (File file : values) {
            total += file.length();
            files.add(file);
        }
        if (total <= MAX_CACHE_BYTES) return;
        files.sort(Comparator.comparingLong(File::lastModified));
        for (File file : files) {
            long length = file.length();
            if (file.delete()) total -= length;
            if (total <= PRUNE_TO_BYTES) break;
        }
    }

    private static String sha256(String value) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8));
            StringBuilder output = new StringBuilder(digest.length * 2);
            for (byte item : digest) output.append(String.format(Locale.ROOT, "%02x", item & 0xff));
            return output.toString();
        } catch (Exception error) {
            throw new IllegalStateException(error);
        }
    }

}
