package io.harnessdesktop.mobile;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

import java.io.File;
import java.io.FileOutputStream;
import java.lang.reflect.Method;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.Arrays;

public final class MobileCacheResilienceTest {
    private static final String PAIR_A = "a".repeat(64);
    private static final String PAIR_B = "b".repeat(64);

    private static final class MutableClock implements MobileAssetCache.Clock {
        long now;
        MutableClock(long now) { this.now = now; }
        @Override public long now() { return now; }
    }

    private static final class Fixture {
        final File root;
        final File offline;
        final MutableClock clock;
        final MobileAssetCache cache;

        Fixture(long now) throws Exception {
            root = Files.createTempDirectory("harness-assets-").toFile();
            offline = Files.createTempDirectory("harness-offline-").toFile();
            clock = new MutableClock(now);
            cache = new MobileAssetCache(root, offline, clock);
        }
    }

    private static JSONObject manifest(long epoch, long revision, boolean complete,
                                       JSONArray workspaces, JSONArray sessions,
                                       JSONArray readMessages, JSONArray tombstones) throws Exception {
        return new JSONObject()
            .put("schemaVersion", MobileAssetCache.OFFLINE_SCHEMA_VERSION)
            .put("snapshotEpoch", epoch)
            .put("revision", revision)
            .put("cursor", String.format("cursor-%04d-%04d", epoch, revision))
            .put("complete", complete)
            .put("workspaces", workspaces == null ? new JSONArray() : workspaces)
            .put("sessions", sessions == null ? new JSONArray() : sessions)
            .put("readMessages", readMessages == null ? new JSONArray() : readMessages)
            .put("tombstones", tombstones == null ? new JSONArray() : tombstones);
    }

    private static JSONObject workspace(String id) throws Exception {
        return new JSONObject().put("workspaceId", id).put("title", "Workspace " + id);
    }

    private static JSONObject session(String id, String workspaceId) throws Exception {
        return new JSONObject().put("sessionId", id).put("workspaceId", workspaceId).put("title", "Session " + id);
    }

    private static JSONObject tombstone(String kind, String id) throws Exception {
        return new JSONObject().put("kind", kind).put("id", id);
    }

    private static boolean containsId(JSONArray values, String id) throws Exception {
        for (int index = 0; index < values.length(); index++) {
            JSONObject item = values.getJSONObject(index);
            if (id.equals(item.optString("workspaceId")) || id.equals(item.optString("sessionId"))) return true;
        }
        return false;
    }

    private static long snapshotBytes(File directory) {
        File[] values = directory.listFiles();
        if (values == null) return 0L;
        long total = 0L;
        for (File value : values) total += value.isDirectory() ? snapshotBytes(value) : value.getName().endsWith(".snapshot") ? value.length() : 0L;
        return total;
    }

    private static void writeUtf8(File file, String value) throws Exception {
        Files.write(file.toPath(), value.getBytes(StandardCharsets.UTF_8));
    }

    private static String readUtf8(File file) throws Exception {
        return new String(Files.readAllBytes(file.toPath()), StandardCharsets.UTF_8);
    }

    @Test public void firstLaunchAndOfflineColdStartRestoreOnlyAValidatedCompleteSnapshot() throws Exception {
        Fixture fixture = new Fixture(1_000_000L);
        assertNull(fixture.cache.loadLatestSnapshot(PAIR_A));
        assertFalse(fixture.cache.storeFullSnapshot(PAIR_A,
            manifest(1, 1, false, new JSONArray().put(workspace("w1")), new JSONArray(), new JSONArray(), new JSONArray())));
        assertNull(fixture.cache.loadLatestSnapshot(PAIR_A));

        assertTrue(fixture.cache.storeFullSnapshot(PAIR_A,
            manifest(1, 1, true, new JSONArray().put(workspace("w1")), new JSONArray().put(session("s1", "w1")), new JSONArray(), new JSONArray())));
        MobileAssetCache.OfflineSnapshot restored = fixture.cache.loadLatestSnapshot(PAIR_A);
        assertNotNull(restored);
        assertTrue(containsId(restored.workspaces, "w1"));
        assertTrue(containsId(restored.sessions, "s1"));
    }

    @Test public void temporaryEmptyAndIncompleteSameEpochCannotReplaceLastGoodState() throws Exception {
        Fixture fixture = new Fixture(2_000_000L);
        assertTrue(fixture.cache.storeFullSnapshot(PAIR_A,
            manifest(7, 10, true, new JSONArray().put(workspace("w1")), new JSONArray().put(session("s1", "w1")), new JSONArray(), new JSONArray())));
        assertFalse(fixture.cache.applyIncrement(PAIR_A,
            manifest(7, 11, false, new JSONArray(), new JSONArray(), new JSONArray(), new JSONArray())));
        assertFalse(fixture.cache.applyIncrement(PAIR_A,
            manifest(7, 11, true, new JSONArray(), new JSONArray(), new JSONArray(), new JSONArray())));
        MobileAssetCache.OfflineSnapshot restored = fixture.cache.loadLatestSnapshot(PAIR_A);
        assertNotNull(restored);
        assertTrue(containsId(restored.sessions, "s1"));
    }

    @Test public void normalIncrementUsesExplicitTombstonesAndRejectsDuplicateOrOutOfOrderEvents() throws Exception {
        Fixture fixture = new Fixture(3_000_000L);
        assertTrue(fixture.cache.storeFullSnapshot(PAIR_A,
            manifest(9, 20, true, new JSONArray().put(workspace("w1")),
                new JSONArray().put(session("s1", "w1")).put(session("s2", "w1")), new JSONArray(), new JSONArray())));
        assertTrue(fixture.cache.applyIncrement(PAIR_A,
            manifest(9, 21, true, new JSONArray(), new JSONArray().put(session("s3", "w1")), new JSONArray(),
                new JSONArray().put(tombstone("session", "s1")))));
        assertFalse(fixture.cache.applyIncrement(PAIR_A,
            manifest(9, 21, true, new JSONArray(), new JSONArray().put(session("duplicate", "w1")), new JSONArray(), new JSONArray())));
        assertFalse(fixture.cache.applyIncrement(PAIR_A,
            manifest(9, 19, true, new JSONArray(), new JSONArray().put(session("old", "w1")), new JSONArray(), new JSONArray())));
        assertFalse(fixture.cache.applyIncrement(PAIR_A,
            manifest(10, 1, true, new JSONArray(), new JSONArray().put(session("wrong-generation", "w1")), new JSONArray(), new JSONArray())));

        MobileAssetCache.OfflineSnapshot restored = fixture.cache.loadLatestSnapshot(PAIR_A);
        assertNotNull(restored);
        assertFalse(containsId(restored.sessions, "s1"));
        assertTrue(containsId(restored.sessions, "s2"));
        assertTrue(containsId(restored.sessions, "s3"));
        assertFalse(containsId(restored.sessions, "duplicate"));
        assertFalse(containsId(restored.sessions, "old"));
    }

    @Test public void corruptTruncatedAndInterruptedWritesFailClosedWithoutHidingAnotherValidSnapshot() throws Exception {
        Fixture fixture = new Fixture(4_000_000L);
        assertTrue(fixture.cache.storeFullSnapshot(PAIR_A,
            manifest(1, 1, true, new JSONArray().put(workspace("w1")), new JSONArray(), new JSONArray(), new JSONArray())));
        File pairDirectory = new File(fixture.offline, PAIR_A);
        writeUtf8(new File(pairDirectory, "2.snapshot"), "{\"payload\":\"truncated");
        writeUtf8(new File(pairDirectory, "3.snapshot.tmp"), "partial-write");
        writeUtf8(new File(pairDirectory, "4.snapshot"),
            new JSONObject().put("payload", "{}").put("sha256", "0".repeat(64)).toString());

        MobileAssetCache.OfflineSnapshot restored = fixture.cache.loadLatestSnapshot(PAIR_A);
        assertNotNull(restored);
        assertTrue(containsId(restored.workspaces, "w1"));
        assertFalse(new File(pairDirectory, "2.snapshot").exists());
        assertFalse(new File(pairDirectory, "4.snapshot").exists());
    }

    @Test public void diskFailureReturnsFalseAndDoesNotInventACommittedSnapshot() throws Exception {
        File assets = Files.createTempDirectory("harness-assets-").toFile();
        File unusableRoot = File.createTempFile("harness-offline-file-", ".tmp");
        MobileAssetCache cache = new MobileAssetCache(assets, unusableRoot, System::currentTimeMillis);
        assertFalse(cache.storeFullSnapshot(PAIR_A,
            manifest(1, 1, true, new JSONArray().put(workspace("w1")), new JSONArray(), new JSONArray(), new JSONArray())));
        assertNull(cache.loadLatestSnapshot(PAIR_A));
    }

    @Test public void ttlCapacitySchemaUpgradeAndClockRollbackCannotMakeStaleStateAuthoritative() throws Exception {
        Fixture fixture = new Fixture(10_000_000L);
        assertTrue(fixture.cache.storeFullSnapshot(PAIR_A,
            manifest(1, 1, true, new JSONArray().put(workspace("w1")), new JSONArray(), new JSONArray(), new JSONArray())));
        fixture.clock.now += MobileAssetCache.OFFLINE_TTL_MS + 1;
        assertNull(fixture.cache.loadLatestSnapshot(PAIR_A));

        fixture.clock.now = 20_000_000L;
        assertTrue(fixture.cache.storeFullSnapshot(PAIR_A,
            manifest(2, 1, true, new JSONArray().put(workspace("w2")), new JSONArray(), new JSONArray(), new JSONArray())));
        fixture.clock.now = 19_000_000L;
        assertNull("wall-clock rollback must not extend a cache entry indefinitely", fixture.cache.loadLatestSnapshot(PAIR_A));

        File schemaDirectory = new File(fixture.offline, PAIR_B);
        assertTrue(schemaDirectory.mkdirs());
        writeUtf8(new File(schemaDirectory, "1.snapshot"),
            new JSONObject().put("payload", new JSONObject().put("schemaVersion", 0).toString()).put("sha256", "invalid").toString());
        assertNull(fixture.cache.loadLatestSnapshot(PAIR_B));

        byte[] block = new byte[2 * 1024 * 1024];
        Arrays.fill(block, (byte) 7);
        for (int index = 0; index < 10; index++) {
            File pair = new File(fixture.offline, String.format("%064x", index + 100));
            assertTrue(pair.mkdirs());
            try (FileOutputStream output = new FileOutputStream(new File(pair, "1.snapshot"))) { output.write(block); }
        }
        Method prune = MobileAssetCache.class.getDeclaredMethod("pruneOfflineCache");
        prune.setAccessible(true);
        prune.invoke(fixture.cache);
        assertTrue(snapshotBytes(fixture.offline) <= MobileAssetCache.MAX_OFFLINE_CACHE_BYTES);
    }

    @Test public void pairingIsolationRevocationAndNetworkSwitchesPreserveOnlyTheIntendedIdentity() throws Exception {
        Fixture fixture = new Fixture(30_000_000L);
        assertTrue(fixture.cache.storeFullSnapshot(PAIR_A,
            manifest(1, 1, true, new JSONArray().put(workspace("desktop-a")), new JSONArray(), new JSONArray(), new JSONArray())));
        assertTrue(fixture.cache.storeFullSnapshot(PAIR_B,
            manifest(1, 1, true, new JSONArray().put(workspace("desktop-b")), new JSONArray(), new JSONArray(), new JSONArray())));
        assertTrue(containsId(fixture.cache.loadLatestSnapshot(PAIR_A).workspaces, "desktop-a"));
        assertFalse(containsId(fixture.cache.loadLatestSnapshot(PAIR_A).workspaces, "desktop-b"));
        assertTrue(containsId(fixture.cache.loadLatestSnapshot(PAIR_B).workspaces, "desktop-b"));

        // A Wi-Fi/5G handoff must not mutate the logical cache generation.
        assertNotNull(fixture.cache.loadLatestSnapshot(PAIR_A));
        assertNotNull(fixture.cache.loadLatestSnapshot(PAIR_A));
        fixture.cache.clearOfflineSnapshots(PAIR_A);
        assertNull(fixture.cache.loadLatestSnapshot(PAIR_A));
        assertNotNull(fixture.cache.loadLatestSnapshot(PAIR_B));
    }

    @Test public void persistedCacheAllowlistExcludesTokensKeysAndSensitiveMessageBodies() throws Exception {
        Fixture fixture = new Fixture(40_000_000L);
        String token = "bearer-secret-must-not-persist";
        String privateKey = "private-key-must-not-persist";
        String body = "sensitive-message-body-must-not-persist";
        JSONObject unsafeWorkspace = workspace("w1").put("token", token).put("apiKey", privateKey).put("body", body);
        JSONObject unsafeSession = session("s1", "w1").put("authorization", token).put("content", body).put("messages", new JSONArray().put(body));
        assertTrue(fixture.cache.storeFullSnapshot(PAIR_A,
            manifest(1, 1, true, new JSONArray().put(unsafeWorkspace), new JSONArray().put(unsafeSession), new JSONArray(), new JSONArray())));

        String persisted = readUtf8(new File(new File(fixture.offline, PAIR_A), "1.snapshot"));
        assertFalse(persisted.contains(token));
        assertFalse(persisted.contains(privateKey));
        assertFalse(persisted.contains(body));
        assertFalse(persisted.contains("authorization"));
        assertFalse(persisted.contains("messages"));
    }

    @Test public void desktopSyncEnvelopeConvergesAndDuplicateReplayIsIdempotent() throws Exception {
        Fixture fixture = new Fixture(50_000_000L);
        JSONObject baseline = new JSONObject()
            .put("schemaVersion", MobileAssetCache.OFFLINE_SCHEMA_VERSION)
            .put("snapshotEpoch", 12)
            .put("revision", 1)
            .put("cursor", "cursor-0012-0001")
            .put("complete", true)
            .put("snapshot", new JSONObject()
                .put("workspaces", new JSONArray().put(workspace("w1")))
                .put("sessions", new JSONArray().put(session("s1", "w1")))
                .put("readMessages", new JSONArray())
                .put("tombstones", new JSONArray()))
            .put("changes", new JSONArray());
        assertTrue(fixture.cache.applySyncResponse(PAIR_A, baseline));

        JSONObject increment = new JSONObject()
            .put("schemaVersion", MobileAssetCache.OFFLINE_SCHEMA_VERSION)
            .put("snapshotEpoch", 12)
            .put("revision", 2)
            .put("cursor", "cursor-0012-0002")
            .put("complete", true)
            .put("changes", new JSONArray().put(new JSONObject()
                .put("revision", 2)
                .put("cursor", "cursor-0012-0002")
                .put("complete", false)
                .put("workspaces", new JSONArray())
                .put("sessions", new JSONArray().put(session("s2", "w1")))
                .put("readMessages", new JSONArray())
                .put("tombstones", new JSONArray().put(tombstone("session", "s1")))));
        assertTrue(fixture.cache.applySyncResponse(PAIR_A, increment));
        MobileAssetCache.OfflineSnapshot converged = fixture.cache.loadLatestSnapshot(PAIR_A);
        assertNotNull(converged);
        assertFalse(containsId(converged.sessions, "s1"));
        assertTrue(containsId(converged.sessions, "s2"));
        assertTrue("replaying an already committed response must be a successful no-op",
            fixture.cache.applySyncResponse(PAIR_A, increment));

        JSONObject outOfOrder = new JSONObject(increment.toString())
            .put("revision", 1)
            .put("cursor", "cursor-0012-0001")
            .put("changes", new JSONArray().put(new JSONObject()
                .put("revision", 1)
                .put("cursor", "cursor-0012-0001")
                .put("sessions", new JSONArray().put(session("stale", "w1")))));
        assertFalse(fixture.cache.applySyncResponse(PAIR_A, outOfOrder));
        assertFalse(containsId(fixture.cache.loadLatestSnapshot(PAIR_A).sessions, "stale"));
    }
}
