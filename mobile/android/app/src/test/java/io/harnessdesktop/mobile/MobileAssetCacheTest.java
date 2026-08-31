package io.harnessdesktop.mobile;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;

public final class MobileAssetCacheTest {
    @Rule public final TemporaryFolder temporary = new TemporaryFolder();

    @Test public void completeSnapshotRestoresOfflineAndNeverPersistsMessageBodies() throws Exception {
        MutableClock clock = new MutableClock(1_000_000L);
        File offline = temporary.newFolder("offline");
        MobileAssetCache cache = cache(offline, clock);
        JSONObject session = session("s1", "w1").put("body", "SECRET-MESSAGE-BODY").put("token", "SECRET-TOKEN");

        assertTrue(cache.storeFullSnapshot(identity('a'), manifest(7, 11, cursor(11))
            .put("workspaces", new JSONArray().put(workspace("w1")))
            .put("sessions", new JSONArray().put(session))));

        MobileAssetCache.OfflineSnapshot restored = cache.loadLatestSnapshot(identity('a'));
        assertEquals(7, restored.snapshotEpoch);
        assertEquals(11, restored.revision);
        assertEquals("Workbench", restored.workspaces.getJSONObject(0).getString("title"));
        assertEquals("Session", restored.sessions.getJSONObject(0).getString("title"));
        String disk = new String(Files.readAllBytes(new File(new File(offline, identity('a')), "7.snapshot").toPath()), StandardCharsets.UTF_8);
        assertFalse(disk.contains("SECRET-MESSAGE-BODY"));
        assertFalse(disk.contains("SECRET-TOKEN"));
    }

    @Test public void emptyOrIncompleteFullResponsesCannotReplaceLastCompleteSnapshot() throws Exception {
        MobileAssetCache cache = cache(temporary.newFolder("offline"), new MutableClock(2_000_000L));
        assertTrue(cache.storeFullSnapshot(identity('a'), manifest(1, 1, cursor(1))
            .put("workspaces", new JSONArray().put(workspace("w1")))));
        assertFalse(cache.applyIncrement(identity('a'), manifest(1, 2, cursor(2)).put("complete", false)));
        assertFalse(cache.storeFullSnapshot(identity('a'), manifest(2, 1, cursor(3))));
        assertFalse(cache.storeFullSnapshot(identity('a'), manifest(2, 2, cursor(4)).put("complete", false)
            .put("workspaces", new JSONArray().put(workspace("w2")))));

        MobileAssetCache.OfflineSnapshot restored = cache.loadLatestSnapshot(identity('a'));
        assertEquals(1, restored.snapshotEpoch);
        assertEquals(1, restored.revision);
        assertEquals("w1", restored.workspaces.getJSONObject(0).getString("workspaceId"));
    }

    @Test public void partialIncrementMergesMonotonicallyAndOnlyTombstoneDeletes() throws Exception {
        MobileAssetCache cache = cache(temporary.newFolder("offline"), new MutableClock(3_000_000L));
        assertTrue(cache.storeFullSnapshot(identity('a'), manifest(4, 1, cursor(1))
            .put("workspaces", new JSONArray().put(workspace("w1")))
            .put("sessions", new JSONArray().put(session("s1", "w1")))));
        assertTrue(cache.applyIncrement(identity('a'), manifest(4, 2, cursor(2)).put("complete", false)
            .put("sessions", new JSONArray().put(session("s2", "w1")))));
        assertFalse(cache.applyIncrement(identity('a'), manifest(4, 2, cursor(3)).put("complete", false)
            .put("sessions", new JSONArray().put(session("s3", "w1")))));
        assertEquals(2, cache.loadLatestSnapshot(identity('a')).sessions.length());

        assertTrue(cache.applyIncrement(identity('a'), manifest(4, 3, cursor(4)).put("complete", false)
            .put("tombstones", new JSONArray().put(new JSONObject().put("kind", "session").put("id", "s1")))));
        MobileAssetCache.OfflineSnapshot deleted = cache.loadLatestSnapshot(identity('a'));
        assertEquals(1, deleted.sessions.length());
        assertEquals("s2", deleted.sessions.getJSONObject(0).getString("sessionId"));
    }

    @Test public void desktopManifestEnvelopeRestoresThenAppliesOnlyChanges() throws Exception {
        MobileAssetCache cache = cache(temporary.newFolder("offline"), new MutableClock(3_500_000L));
        JSONObject full = new JSONObject()
            .put("schemaVersion", 1).put("snapshotEpoch", 8).put("revision", 1).put("cursor", cursor(1)).put("complete", true)
            .put("snapshot", new JSONObject()
                .put("workspaces", new JSONArray().put(workspace("w1")))
                .put("sessions", new JSONArray().put(session("s1", "w1")))
                .put("readMessages", new JSONArray()).put("tombstones", new JSONArray()))
            .put("changes", new JSONArray());
        assertTrue(cache.applySyncResponse(identity('a'), full));
        assertFalse(cache.applySyncResponse(identity('a'), new JSONObject(full.toString()).put("ok", false)));
        assertFalse(cache.applySyncResponse(identity('a'), new JSONObject(full.toString()).put("protected", true)));

        JSONObject change = new JSONObject().put("revision", 2).put("cursor", cursor(2)).put("complete", false)
            .put("workspaces", new JSONArray()).put("sessions", new JSONArray().put(session("s2", "w1")))
            .put("readMessages", new JSONArray()).put("tombstones", new JSONArray());
        JSONObject incremental = new JSONObject()
            .put("schemaVersion", 1).put("snapshotEpoch", 8).put("revision", 2).put("cursor", cursor(2)).put("complete", true)
            .put("snapshot", JSONObject.NULL).put("changes", new JSONArray().put(change));
        assertTrue(cache.applySyncResponse(identity('a'), incremental));
        assertEquals(2, cache.loadLatestSnapshot(identity('a')).sessions.length());
    }

    @Test public void pairingIdentityAndEpochAreIsolated() throws Exception {
        MobileAssetCache cache = cache(temporary.newFolder("offline"), new MutableClock(4_000_000L));
        assertTrue(cache.storeFullSnapshot(identity('a'), manifest(1, 1, cursor(1))
            .put("workspaces", new JSONArray().put(workspace("wa")))));
        assertTrue(cache.storeFullSnapshot(identity('b'), manifest(9, 1, cursor(1))
            .put("workspaces", new JSONArray().put(workspace("wb")))));
        assertEquals("wa", cache.loadLatestSnapshot(identity('a')).workspaces.getJSONObject(0).getString("workspaceId"));
        assertEquals("wb", cache.loadLatestSnapshot(identity('b')).workspaces.getJSONObject(0).getString("workspaceId"));
        assertFalse(cache.applyIncrement(identity('a'), manifest(2, 2, cursor(2)).put("complete", false)
            .put("workspaces", new JSONArray().put(workspace("leak")))));
    }

    @Test public void corruptionTtlAndClockRollbackExpireSafely() throws Exception {
        MutableClock clock = new MutableClock(5_000_000L);
        File offline = temporary.newFolder("offline");
        MobileAssetCache cache = cache(offline, clock);
        assertTrue(cache.storeFullSnapshot(identity('a'), manifest(1, 1, cursor(1))
            .put("workspaces", new JSONArray().put(workspace("w1")))));
        File snapshot = new File(new File(offline, identity('a')), "1.snapshot");
        Files.write(snapshot.toPath(), "corrupt".getBytes(StandardCharsets.UTF_8));
        assertNull(cache.loadLatestSnapshot(identity('a')));

        assertTrue(cache.storeFullSnapshot(identity('a'), manifest(2, 1, cursor(2))
            .put("workspaces", new JSONArray().put(workspace("w2")))));
        clock.now--;
        assertNull(cache.loadLatestSnapshot(identity('a')));
        clock.now = 6_000_000L;
        assertTrue(cache.storeFullSnapshot(identity('a'), manifest(3, 1, cursor(3))
            .put("workspaces", new JSONArray().put(workspace("w3")))));
        clock.now += MobileAssetCache.OFFLINE_TTL_MS + 1;
        assertNull(cache.loadLatestSnapshot(identity('a')));
    }

    @Test public void pairingCacheIdentityIsStableAndContainsNoPairingSecret() {
        PairingProfile first = PairingProfile.parse("http://192.168.1.8:3081/__harness_mobile__/pair/secret-a");
        PairingProfile same = PairingProfile.parse("http://192.168.1.8:3081/__harness_mobile__/pair/secret-a");
        PairingProfile second = PairingProfile.parse("http://192.168.1.8:3081/__harness_mobile__/pair/secret-b");
        String identity = PairingProfileStore.cacheIdentity(first);
        assertEquals(identity, PairingProfileStore.cacheIdentity(same));
        assertFalse(identity.equals(PairingProfileStore.cacheIdentity(second)));
        assertTrue(identity.matches("[a-f0-9]{64}"));
        assertFalse(identity.contains("secret-a"));
    }

    private MobileAssetCache cache(File offline, MutableClock clock) throws Exception {
        return new MobileAssetCache(temporary.newFolder("assets-" + System.nanoTime()), offline, clock);
    }

    private static JSONObject manifest(long epoch, long revision, String cursor) throws Exception {
        return new JSONObject()
            .put("schemaVersion", MobileAssetCache.OFFLINE_SCHEMA_VERSION)
            .put("snapshotEpoch", epoch).put("revision", revision).put("cursor", cursor).put("complete", true)
            .put("workspaces", new JSONArray()).put("sessions", new JSONArray())
            .put("readMessages", new JSONArray()).put("tombstones", new JSONArray());
    }

    private static JSONObject workspace(String id) throws Exception {
        return new JSONObject().put("workspaceId", id).put("title", "Workbench").put("updatedAt", "2026-01-01T00:00:00.000Z");
    }

    private static JSONObject session(String id, String workspaceId) throws Exception {
        return new JSONObject().put("sessionId", id).put("workspaceId", workspaceId).put("title", "Session")
            .put("status", "active").put("archived", false).put("updatedAt", "2026-01-01T00:00:00.000Z");
    }

    private static String cursor(long value) { return String.format("cursor-%010d", value); }
    private static String identity(char value) { return String.valueOf(value).repeat(64); }

    private static final class MutableClock implements MobileAssetCache.Clock {
        long now;
        MutableClock(long now) { this.now = now; }
        @Override public long now() { return now; }
    }
}
