package io.harnessdesktop.mobile;

import android.content.Context;
import android.webkit.CookieManager;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.StandardCopyOption;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.HashSet;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Semaphore;

final class MobileAssetCache {
    private static final int CONNECT_TIMEOUT_MS = 8_000;
    private static final int READ_TIMEOUT_MS = 45_000;
    private static final int MAX_ENTRY_BYTES = 8 * 1024 * 1024;
    private static final long MAX_CACHE_BYTES = 64L * 1024L * 1024L;
    private static final long PRUNE_TO_BYTES = 48L * 1024L * 1024L;
    static final int OFFLINE_SCHEMA_VERSION = 1;
    static final int MAX_OFFLINE_ENTRY_BYTES = 2 * 1024 * 1024;
    static final long MAX_OFFLINE_CACHE_BYTES = 16L * 1024L * 1024L;
    static final long OFFLINE_TTL_MS = 14L * 24L * 60L * 60L * 1000L;
    private static final int MAX_CURSOR_LENGTH = 2_048;
    private static final Set<String> WORKSPACE_FIELDS = fields("workspaceId", "title", "createdAt", "updatedAt");
    private static final Set<String> SESSION_FIELDS = fields("sessionId", "workspaceId", "title", "status", "archived", "createdAt", "updatedAt", "lastActivityAt");
    private static final Set<String> READ_MESSAGE_FIELDS = fields("sessionId", "messageId", "readAt");

    interface Clock { long now(); }

    static final class OfflineSnapshot {
        final long snapshotEpoch;
        final long revision;
        final String cursor;
        final long storedAt;
        final JSONArray workspaces;
        final JSONArray sessions;
        final JSONArray readMessages;

        OfflineSnapshot(JSONObject payload) throws JSONException {
            snapshotEpoch = payload.getLong("snapshotEpoch");
            revision = payload.getLong("revision");
            cursor = payload.getString("cursor");
            storedAt = payload.getLong("storedAt");
            workspaces = new JSONArray(payload.getJSONArray("workspaces").toString());
            sessions = new JSONArray(payload.getJSONArray("sessions").toString());
            readMessages = new JSONArray(payload.getJSONArray("readMessages").toString());
        }

        JSONObject toJson() throws JSONException {
            return new JSONObject()
                .put("schemaVersion", OFFLINE_SCHEMA_VERSION)
                .put("snapshotEpoch", snapshotEpoch)
                .put("revision", revision)
                .put("cursor", cursor)
                .put("storedAt", storedAt)
                .put("workspaces", new JSONArray(workspaces.toString()))
                .put("sessions", new JSONArray(sessions.toString()))
                .put("readMessages", new JSONArray(readMessages.toString()));
        }
    }

    private final File root;
    private final File offlineRoot;
    private final Clock clock;
    private final Map<String, Object> locks = new ConcurrentHashMap<>();
    private final Semaphore downloads = new Semaphore(6, true);

    MobileAssetCache(Context context) {
        this(new File(context.getCacheDir(), "harness-static-assets-v1"),
            new File(context.getNoBackupFilesDir(), "harness-offline-snapshots-v1"), System::currentTimeMillis);
    }

    MobileAssetCache(File assetRoot, File offlineRoot, Clock clock) {
        this.root = assetRoot;
        this.offlineRoot = offlineRoot;
        this.clock = clock;
        if (!root.exists()) root.mkdirs();
        if (!offlineRoot.exists()) offlineRoot.mkdirs();
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
            if (path == null || path.trim().isEmpty()) path = "/";
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
            if (cookie != null && !cookie.trim().isEmpty()) connection.setRequestProperty("Cookie", cookie);

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

    synchronized boolean storeFullSnapshot(String pairingIdentity, JSONObject manifest) {
        return storeSnapshot(pairingIdentity, manifest, false);
    }

    synchronized boolean applyIncrement(String pairingIdentity, JSONObject manifest) {
        return storeSnapshot(pairingIdentity, manifest, true);
    }

    /** Consumes the desktop /sync/manifest response without exposing cache internals to WebProxy/UI. */
    synchronized boolean applySyncResponse(String pairingIdentity, JSONObject response) {
        if (response == null || response.optInt("schemaVersion", -1) != OFFLINE_SCHEMA_VERSION
            || !response.optBoolean("ok", true) || response.optBoolean("protected", false)
            || !response.optBoolean("complete", false)) return false;
        try {
            OfflineSnapshot existing = loadLatestSnapshot(pairingIdentity);
            if (existing != null && existing.snapshotEpoch == response.optLong("snapshotEpoch", -1)
                && existing.revision == response.optLong("revision", -1)
                && existing.cursor.equals(response.optString("cursor", ""))) return true;
            JSONObject snapshot = response.optJSONObject("snapshot");
            if (snapshot != null) {
                return storeFullSnapshot(pairingIdentity, flatten(response, snapshot, true));
            }
            JSONArray changes = response.optJSONArray("changes");
            if (changes == null) return false;
            if (changes.length() == 0) {
                OfflineSnapshot current = loadLatestSnapshot(pairingIdentity);
                return current != null && current.snapshotEpoch == response.optLong("snapshotEpoch", -1)
                    && current.revision == response.optLong("revision", -1)
                    && current.cursor.equals(response.optString("cursor", ""));
            }
            for (int index = 0; index < changes.length(); index++) {
                JSONObject change = changes.optJSONObject(index);
                if (change == null || !applyIncrement(pairingIdentity, flatten(response, change, false))) return false;
            }
            OfflineSnapshot current = loadLatestSnapshot(pairingIdentity);
            return current != null && current.snapshotEpoch == response.optLong("snapshotEpoch", -1)
                && current.revision == response.optLong("revision", -1)
                && current.cursor.equals(response.optString("cursor", ""));
        } catch (JSONException error) {
            return false;
        }
    }

    synchronized OfflineSnapshot loadLatestSnapshot(String pairingIdentity) {
        if (!isPairingIdentity(pairingIdentity)) return null;
        File directory = new File(offlineRoot, pairingIdentity);
        File[] files = directory.listFiles((dir, name) -> name.endsWith(".snapshot"));
        if (files == null) return null;
        OfflineSnapshot latest = null;
        for (File file : files) {
            OfflineSnapshot candidate = readSnapshot(file);
            if (candidate == null) continue;
            if (latest == null || candidate.snapshotEpoch > latest.snapshotEpoch
                || (candidate.snapshotEpoch == latest.snapshotEpoch && candidate.revision > latest.revision)) latest = candidate;
        }
        return latest;
    }

    synchronized void clearOfflineSnapshots(String pairingIdentity) {
        if (!isPairingIdentity(pairingIdentity)) return;
        deleteRecursively(new File(offlineRoot, pairingIdentity));
    }

    private boolean storeSnapshot(String pairingIdentity, JSONObject manifest, boolean incremental) {
        if (!isPairingIdentity(pairingIdentity)) return false;
        PreparedManifest incoming;
        try {
            incoming = prepareManifest(manifest, !incremental);
        } catch (JSONException | IllegalArgumentException error) {
            return false;
        }
        OfflineSnapshot latest = loadLatestSnapshot(pairingIdentity);
        if (incremental && (latest == null || latest.snapshotEpoch != incoming.snapshotEpoch)) return false;
        if (latest != null && (incoming.snapshotEpoch < latest.snapshotEpoch
            || (incoming.snapshotEpoch == latest.snapshotEpoch && incoming.revision <= latest.revision))) return false;
        if (latest != null && incoming.isEmpty() && incoming.tombstones.length() == 0) return false;

        try {
            JSONObject payload = merge(latest, incoming);
            String serialized = payload.toString();
            if (serialized.getBytes(StandardCharsets.UTF_8).length > MAX_OFFLINE_ENTRY_BYTES) return false;
            String envelope = new JSONObject().put("payload", serialized).put("sha256", sha256(serialized)).toString();
            File directory = new File(offlineRoot, pairingIdentity);
            if (!directory.exists() && !directory.mkdirs()) return false;
            File target = new File(directory, incoming.snapshotEpoch + ".snapshot");
            File temporary = new File(directory, incoming.snapshotEpoch + ".snapshot.tmp");
            try (FileOutputStream output = new FileOutputStream(temporary)) {
                output.write(envelope.getBytes(StandardCharsets.UTF_8));
                output.getFD().sync();
            }
            Files.move(temporary.toPath(), target.toPath(), StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
            target.setLastModified(clock.now());
            pruneOfflineCache();
            return true;
        } catch (IOException | JSONException error) {
            return false;
        }
    }

    private PreparedManifest prepareManifest(JSONObject manifest, boolean requireComplete) throws JSONException {
        if (manifest == null || manifest.optInt("schemaVersion", -1) != OFFLINE_SCHEMA_VERSION
            || (requireComplete && !manifest.optBoolean("complete", false))) {
            throw new IllegalArgumentException("A complete schema-v1 snapshot is required");
        }
        long epoch = manifest.optLong("snapshotEpoch", -1);
        long revision = manifest.optLong("revision", -1);
        String cursor = manifest.optString("cursor", "");
        if (epoch < 0 || revision < 0 || cursor.isEmpty() || cursor.length() > MAX_CURSOR_LENGTH || containsControlCharacter(cursor)) {
            throw new IllegalArgumentException("Invalid snapshot ordering metadata");
        }
        return new PreparedManifest(epoch, revision, cursor,
            sanitizeItems(manifest.optJSONArray("workspaces"), WORKSPACE_FIELDS, "workspaceId"),
            sanitizeItems(manifest.optJSONArray("sessions"), SESSION_FIELDS, "sessionId"),
            sanitizeItems(manifest.optJSONArray("readMessages"), READ_MESSAGE_FIELDS, "sessionId:messageId"),
            sanitizeTombstones(manifest.optJSONArray("tombstones")));
    }

    private static JSONObject flatten(JSONObject response, JSONObject values, boolean complete) throws JSONException {
        return new JSONObject()
            .put("schemaVersion", response.getInt("schemaVersion"))
            .put("snapshotEpoch", response.getLong("snapshotEpoch"))
            .put("revision", complete ? response.getLong("revision") : values.getLong("revision"))
            .put("cursor", complete ? response.getString("cursor") : values.getString("cursor"))
            .put("complete", complete)
            .put("workspaces", values.optJSONArray("workspaces") == null ? new JSONArray() : values.getJSONArray("workspaces"))
            .put("sessions", values.optJSONArray("sessions") == null ? new JSONArray() : values.getJSONArray("sessions"))
            .put("readMessages", values.optJSONArray("readMessages") == null ? new JSONArray() : values.getJSONArray("readMessages"))
            .put("tombstones", values.optJSONArray("tombstones") == null ? new JSONArray() : values.getJSONArray("tombstones"));
    }

    private JSONObject merge(OfflineSnapshot previous, PreparedManifest incoming) throws JSONException {
        LinkedHashMap<String, JSONObject> workspaces = index(previous == null ? null : previous.workspaces, "workspaceId");
        LinkedHashMap<String, JSONObject> sessions = index(previous == null ? null : previous.sessions, "sessionId");
        LinkedHashMap<String, JSONObject> readMessages = index(previous == null ? null : previous.readMessages, "sessionId:messageId");
        putAll(workspaces, incoming.workspaces, "workspaceId");
        putAll(sessions, incoming.sessions, "sessionId");
        putAll(readMessages, incoming.readMessages, "sessionId:messageId");
        for (int index = 0; index < incoming.tombstones.length(); index++) {
            JSONObject tombstone = incoming.tombstones.getJSONObject(index);
            String kind = tombstone.getString("kind");
            String id = tombstone.getString("id");
            if ("workspace".equals(kind)) {
                workspaces.remove(id);
                List<String> sessionIds = new ArrayList<>();
                for (JSONObject session : sessions.values()) if (id.equals(session.optString("workspaceId"))) sessionIds.add(session.optString("sessionId"));
                for (String sessionId : sessionIds) {
                    sessions.remove(sessionId);
                    readMessages.entrySet().removeIf(entry -> entry.getKey().startsWith(sessionId + ":"));
                }
            } else if ("session".equals(kind)) {
                sessions.remove(id);
                readMessages.entrySet().removeIf(entry -> entry.getKey().startsWith(id + ":"));
            } else {
                readMessages.remove(id);
            }
        }
        return new JSONObject()
            .put("schemaVersion", OFFLINE_SCHEMA_VERSION)
            .put("snapshotEpoch", incoming.snapshotEpoch)
            .put("revision", incoming.revision)
            .put("cursor", incoming.cursor)
            .put("storedAt", clock.now())
            .put("workspaces", new JSONArray(workspaces.values()))
            .put("sessions", new JSONArray(sessions.values()))
            .put("readMessages", new JSONArray(readMessages.values()));
    }

    private OfflineSnapshot readSnapshot(File file) {
        try {
            if (!file.isFile() || file.length() <= 0 || file.length() > MAX_OFFLINE_ENTRY_BYTES + 1024) {
                file.delete();
                return null;
            }
            byte[] bytes = Files.readAllBytes(file.toPath());
            JSONObject envelope = new JSONObject(new String(bytes, StandardCharsets.UTF_8));
            String serialized = envelope.getString("payload");
            if (!sha256(serialized).equals(envelope.optString("sha256"))) throw new JSONException("Snapshot checksum mismatch");
            JSONObject payload = new JSONObject(serialized);
            if (payload.optInt("schemaVersion", -1) != OFFLINE_SCHEMA_VERSION) return null;
            OfflineSnapshot snapshot = new OfflineSnapshot(payload);
            if (snapshot.snapshotEpoch < 0 || snapshot.revision < 0 || snapshot.cursor.length() > MAX_CURSOR_LENGTH) throw new JSONException("Invalid snapshot metadata");
            long now = clock.now();
            // Wall-clock time is the only durable clock available across process and
            // device restarts. Fail closed after a rollback instead of extending a
            // snapshot's authority beyond its intended TTL.
            if (snapshot.storedAt > now || now - snapshot.storedAt > OFFLINE_TTL_MS) { file.delete(); return null; }
            return snapshot;
        } catch (IOException | JSONException | RuntimeException error) {
            file.delete();
            return null;
        }
    }

    private void pruneOfflineCache() {
        List<File> files = new ArrayList<>();
        collectSnapshotFiles(offlineRoot, files);
        long total = 0;
        long now = clock.now();
        for (File file : new ArrayList<>(files)) {
            if (now - file.lastModified() > OFFLINE_TTL_MS) { file.delete(); files.remove(file); }
            else total += file.length();
        }
        if (total <= MAX_OFFLINE_CACHE_BYTES) return;
        files.sort(Comparator.comparingLong(File::lastModified));
        for (File file : files) {
            long length = file.length();
            if (file.delete()) total -= length;
            if (total <= MAX_OFFLINE_CACHE_BYTES * 3 / 4) break;
        }
    }

    private static void collectSnapshotFiles(File directory, List<File> output) {
        File[] files = directory.listFiles();
        if (files == null) return;
        for (File file : files) {
            if (file.isDirectory()) collectSnapshotFiles(file, output);
            else if (file.getName().endsWith(".snapshot")) output.add(file);
            else if (file.getName().endsWith(".tmp")) file.delete();
        }
    }

    private static JSONArray sanitizeItems(JSONArray values, Set<String> allowedFields, String identityField) throws JSONException {
        JSONArray output = new JSONArray();
        if (values == null) return output;
        if (values.length() > 5_000) throw new IllegalArgumentException("Snapshot collection is too large");
        for (int index = 0; index < values.length(); index++) {
            JSONObject input = values.optJSONObject(index);
            if (input == null) throw new IllegalArgumentException("Snapshot items must be objects");
            JSONObject item = new JSONObject();
            for (String field : allowedFields) {
                if (!input.has(field) || input.isNull(field)) continue;
                Object value = input.get(field);
                if (!(value instanceof String || value instanceof Number || value instanceof Boolean)) throw new IllegalArgumentException("Nested or binary metadata is not cacheable");
                if (value instanceof String && ((String) value).length() > 1_024) throw new IllegalArgumentException("Metadata string is too large");
                item.put(field, value);
            }
            String id = itemIdentity(item, identityField);
            if (!isSafeIdentifier(id)) throw new IllegalArgumentException("Snapshot item identity is invalid");
            output.put(item);
        }
        return output;
    }

    private static JSONArray sanitizeTombstones(JSONArray values) throws JSONException {
        JSONArray output = new JSONArray();
        if (values == null) return output;
        if (values.length() > 5_000) throw new IllegalArgumentException("Too many tombstones");
        for (int index = 0; index < values.length(); index++) {
            JSONObject input = values.optJSONObject(index);
            String kind = input == null ? "" : input.optString("kind", "");
            String id = input == null ? "" : input.optString("id", "");
            if (!("workspace".equals(kind) || "session".equals(kind) || "read-message".equals(kind)) || !isSafeIdentifier(id)) {
                throw new IllegalArgumentException("Invalid tombstone");
            }
            output.put(new JSONObject().put("kind", kind).put("id", id));
        }
        return output;
    }

    private static LinkedHashMap<String, JSONObject> index(JSONArray values, String identityField) throws JSONException {
        LinkedHashMap<String, JSONObject> output = new LinkedHashMap<>();
        if (values == null) return output;
        for (int index = 0; index < values.length(); index++) {
            JSONObject item = values.getJSONObject(index);
            output.put(itemIdentity(item, identityField), new JSONObject(item.toString()));
        }
        return output;
    }

    private static void putAll(Map<String, JSONObject> target, JSONArray values, String identityField) throws JSONException {
        for (int index = 0; index < values.length(); index++) {
            JSONObject item = values.getJSONObject(index);
            target.put(itemIdentity(item, identityField), item);
        }
    }

    private static String itemIdentity(JSONObject item, String identityField) {
        if ("sessionId:messageId".equals(identityField)) {
            String sessionId = item.optString("sessionId", "");
            String messageId = item.optString("messageId", "");
            return sessionId.isEmpty() || messageId.isEmpty() ? "" : sessionId + ":" + messageId;
        }
        return item.optString(identityField, "");
    }

    private static boolean isPairingIdentity(String value) { return value != null && value.matches("[a-f0-9]{64}"); }
    private static boolean isSafeIdentifier(String value) { return value != null && !value.isEmpty() && value.length() <= 520 && !containsControlCharacter(value); }
    private static boolean containsControlCharacter(String value) {
        for (int index = 0; index < value.length(); index++) if (Character.isISOControl(value.charAt(index))) return true;
        return false;
    }
    private static Set<String> fields(String... values) { return Collections.unmodifiableSet(new HashSet<>(Arrays.asList(values))); }
    private static void deleteRecursively(File file) {
        File[] children = file.listFiles();
        if (children != null) for (File child : children) deleteRecursively(child);
        file.delete();
    }

    private static final class PreparedManifest {
        final long snapshotEpoch;
        final long revision;
        final String cursor;
        final JSONArray workspaces;
        final JSONArray sessions;
        final JSONArray readMessages;
        final JSONArray tombstones;
        PreparedManifest(long snapshotEpoch, long revision, String cursor, JSONArray workspaces, JSONArray sessions, JSONArray readMessages, JSONArray tombstones) {
            this.snapshotEpoch = snapshotEpoch;
            this.revision = revision;
            this.cursor = cursor;
            this.workspaces = workspaces;
            this.sessions = sessions;
            this.readMessages = readMessages;
            this.tombstones = tombstones;
        }
        boolean isEmpty() { return workspaces.length() == 0 && sessions.length() == 0 && readMessages.length() == 0; }
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
