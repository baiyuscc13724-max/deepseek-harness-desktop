package io.harnessdesktop.mobile;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

import java.nio.charset.StandardCharsets;
import java.util.Base64;

public final class MainActivityTest {
    @Test public void acceptsOnlyPrivateLanPairingLinks() {
        assertTrue(PairingLinkValidator.isSafeHarnessUrl("http://192.168.1.8:3081/__harness_mobile__/pair/abc", true));
        assertTrue(PairingLinkValidator.isSafeHarnessUrl("http://10.0.0.3:4000/", false));
        assertFalse(PairingLinkValidator.isSafeHarnessUrl("https://example.com/__harness_mobile__/pair/abc", true));
        assertFalse(PairingLinkValidator.isSafeHarnessUrl("http://8.8.8.8:3081/__harness_mobile__/pair/abc", true));
        assertFalse(PairingLinkValidator.isSafeHarnessUrl("http://192.168.1.8:3081/", true));
        assertTrue(PairingLinkValidator.extractHttpPairingUrl("harnessmobile://pair?url=http%3A%2F%2F192.168.1.8%3A3081%2F__harness_mobile__%2Fpair%2Fabc").endsWith("/pair/abc"));
    }

    @Test public void acceptsTheSameSetupQrForInAppPairing() {
        String pairUrl = "http://192.168.1.8:3081/__harness_mobile__/pair/abc";
        String payloadJson = "{\"version\":2,\"pairUrl\":\"" + pairUrl + "\",\"transports\":[]}";
        String payload = Base64.getUrlEncoder().withoutPadding().encodeToString(payloadJson.getBytes(StandardCharsets.UTF_8));
        String setupUrl = "http://192.168.1.8:3081/__harness_mobile__/setup?payload=" + payload;

        assertTrue(PairingLinkValidator.isSafeHarnessSetupUrl(setupUrl));
        assertEquals(payload, PairingLinkValidator.extractSetupPayload(setupUrl));
        assertFalse(PairingLinkValidator.isSafeHarnessSetupUrl("https://example.com/__harness_mobile__/setup?payload=" + payload));
    }
}
