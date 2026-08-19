package io.harnessdesktop.mobile;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public final class MobileAppUpdateCheckerTest {
    private static final String HASH = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

    @Test public void selectsOnlyNewerAndroidApk() throws Exception {
        String manifest = "{\"schemaVersion\":1,\"platforms\":{\"android\":{" +
            "\"version\":\"1.0.21\",\"url\":\"https://updates.example/Harness-Mobile-1.0.21.apk\"," +
            "\"sha256\":\"" + HASH + "\",\"required\":false}}}";
        MobileAppUpdateChecker.Update update = MobileAppUpdateChecker.parse(manifest, "1.0.20");
        assertEquals("1.0.21", update.version);
        assertEquals(HASH, update.sha256);
        assertFalse(update.required);
        assertNull(MobileAppUpdateChecker.parse(manifest, "1.0.21"));
    }

    @Test public void rejectsCrossPlatformOrInsecureAssets() {
        String insecure = "{\"schemaVersion\":1,\"platforms\":{\"android\":{" +
            "\"version\":\"2.0.0\",\"url\":\"https://updates.example/Harness-Mobile.ipa\"," +
            "\"sha256\":\"" + HASH + "\"}}}";
        boolean rejected = false;
        try { MobileAppUpdateChecker.parse(insecure, "1.0.20"); }
        catch (Exception expected) { rejected = true; }
        assertTrue(rejected);
    }

    @Test public void comparesNumericVersions() {
        assertTrue(MobileAppUpdateChecker.compareVersions("1.10.0", "1.9.9") > 0);
        assertEquals(0, MobileAppUpdateChecker.compareVersions("1.2", "1.2.0"));
    }
}
