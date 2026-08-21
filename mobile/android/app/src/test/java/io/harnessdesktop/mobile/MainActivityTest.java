package io.harnessdesktop.mobile;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import org.junit.Test;
import org.json.JSONObject;

import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.List;
import java.util.Map;

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

    @Test public void parsesAndPersistsCredentialFreeWssRelayTransport() throws Exception {
        String pairUrl = "http://192.168.1.8:3081/__harness_mobile__/pair/abc";
        JSONObject transport = new JSONObject()
            .put("id", "wss-relay")
            .put("origin", "http://10.253.77.254:3081")
            .put("relayUrl", "wss://relay.example.com/tunnel")
            .put("roomId", "r".repeat(43))
            .put("tunnelKey", "k".repeat(43))
            .put("protocolVersion", 1);
        JSONObject object = new JSONObject().put("version", 2).put("pairUrl", pairUrl)
            .put("transports", new org.json.JSONArray().put(transport));
        String payload = Base64.getUrlEncoder().withoutPadding().encodeToString(object.toString().getBytes(StandardCharsets.UTF_8));
        PairingProfile profile = PairingProfile.parse("harnessmobile://pair?payload=" + payload);
        assertTrue(profile != null && profile.relay != null);
        assertEquals("wss://relay.example.com/tunnel", profile.relay.relayUrl);
        assertEquals(2, profile.routes.size());
        PairingProfile restored = PairingProfile.fromStoredJson(profile.toJson());
        assertTrue(restored != null && restored.relay != null);
    }

    @Test public void opensNodeGeneratedRelayVectorAndRejectsReplay() throws Exception {
        RelayTunnelCodec codec = new RelayTunnelCodec("BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc");
        byte[] packet = hex("01000102030405060708090a0b1983e9701d23a93b1ec484e887781c9b9850d9ef7c1353fcafca71c638a5771489d6931d56");
        RelayTunnelCodec.Frame frame = codec.decode(packet);
        assertEquals(RelayTunnelCodec.DATA, frame.type);
        assertEquals(42L, frame.streamId);
        assertEquals("private payload", new String(frame.payload, StandardCharsets.UTF_8));
        try { codec.decode(packet); fail("Replay must be rejected"); }
        catch (java.security.GeneralSecurityException expected) { assertTrue(expected.getMessage().contains("replay")); }
    }

    @Test public void reconnectPolicyDebouncesDuplicateNetworkCallbacks() {
        NetworkReconnectPolicy policy = new NetworkReconnectPolicy();
        policy.seed(10L, true);
        assertFalse(policy.available(10L, true));
        assertTrue(policy.available(11L, true));
        assertFalse(policy.lost(10L));
        assertTrue(policy.lost(11L));
        assertFalse(policy.hasUsableNetwork());
    }

    @Test public void webProxyPrefersTheLastGoodReadyRouteAndDefersCoolingRoutes() {
        PairingProfile.Route lan = new PairingProfile.Route("lan", "192.168.1.5", 3081);
        PairingProfile.Route relay = new PairingProfile.Route("wss-relay", "10.253.77.254", 3081, "127.0.0.1", 4100);
        PairingProfile.Route remote = new PairingProfile.Route("remote", "10.0.0.8", 3081);
        long now = 1_000L;
        List<PairingProfile.Route> prioritized = HarnessWebProxy.prioritizeRoutes(
            List.of(lan, relay, remote),
            Map.of(lan.key(), now + 12_000L),
            relay.key(),
            now
        );
        assertEquals(relay.key(), prioritized.get(0).key());
        assertEquals(remote.key(), prioritized.get(1).key());
        assertEquals(lan.key(), prioritized.get(2).key());
    }

    @Test public void parsesOnlyVersionedFixedControlActions() throws Exception {
        ControlCommand command = ControlCommand.parse(new JSONObject()
            .put("type", "command")
            .put("protocolVersion", 1)
            .put("id", "00000000-0000-4000-8000-000000000001")
            .put("action", "tap")
            .put("payload", new JSONObject().put("x", 12).put("y", 34)));
        assertEquals("tap", command.action);
        assertEquals(15000, command.timeoutMs);
        assertFalse(command.requiresConfirmation);

        try {
            ControlCommand.parse(new JSONObject()
                .put("type", "command")
                .put("protocolVersion", 1)
                .put("id", "00000000-0000-4000-8000-000000000002")
                .put("action", "shell"));
            throw new AssertionError("shell must be rejected");
        } catch (org.json.JSONException expected) {
            assertEquals("UNSUPPORTED_ACTION", expected.getMessage());
        }
    }

    @Test public void sensitiveControlActionsAlwaysRequireConfirmation() throws Exception {
        ControlCommand command = ControlCommand.parse(new JSONObject()
            .put("type", "command")
            .put("protocolVersion", 1)
            .put("id", "00000000-0000-4000-8000-000000000003")
            .put("action", "clearCache")
            .put("payload", new JSONObject().put("packageName", "com.example.app")));
        assertTrue(command.requiresConfirmation);
        assertTrue(ControlCommand.isSensitive("textInput"));
    }

    private static byte[] hex(String value) {
        byte[] result = new byte[value.length() / 2];
        for (int index = 0; index < result.length; index++) {
            result[index] = (byte) Integer.parseInt(value.substring(index * 2, index * 2 + 2), 16);
        }
        return result;
    }
}
