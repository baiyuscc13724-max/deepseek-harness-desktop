package io.harnessdesktop.mobile;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import org.junit.Test;
import org.json.JSONObject;

import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

public final class MainActivityTest {
    @Test public void galleryBatchSelectionHasABoundedNativeLimit() {
        assertEquals(20, MainActivity.MAX_PICKED_IMAGES);
    }

    @Test public void acceptsOnlyPrivateLanPairingLinks() {
        assertTrue(PairingLinkValidator.isSafeHarnessUrl("http://192.168.1.8:3081/__harness_mobile__/pair/abc", true));
        assertTrue(PairingLinkValidator.isSafeHarnessUrl("http://10.0.0.3:4000/", false));
        assertFalse(PairingLinkValidator.isSafeHarnessUrl("https://example.com/__harness_mobile__/pair/abc", true));
        assertFalse(PairingLinkValidator.isSafeHarnessUrl("http://8.8.8.8:3081/__harness_mobile__/pair/abc", true));
        assertFalse(PairingLinkValidator.isSafeHarnessUrl("http://192.168.1.8:3081/", true));
        assertTrue(PairingLinkValidator.extractHttpPairingUrl("harnessmobile://pair?url=http%3A%2F%2F192.168.1.8%3A3081%2F__harness_mobile__%2Fpair%2Fabc").endsWith("/pair/abc"));
    }

    @Test public void rejectedOrExpiredPairingReturnsToNativePairing() {
        assertTrue(MainActivity.isPairingRejectedHttpStatus(401));
        assertTrue(MainActivity.isPairingRejectedHttpStatus(403));
        assertTrue(MainActivity.isPairingRejectedHttpStatus(410));
        assertFalse(MainActivity.isPairingRejectedHttpStatus(502));
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
        // Percent-encoded query keys exercise the API-26-compatible decoder used by real scanner payloads.
        PairingProfile profile = PairingProfile.parse("harnessmobile://pair?%70ayload=" + payload);
        assertTrue(profile != null && profile.relay != null && profile.nativeP2p != null);
        assertEquals("wss://relay.example.com/tunnel", profile.relay.relayUrl);
        assertEquals(profile.relay.relayUrl, profile.nativeP2p.signalingUrl);
        assertEquals("stun:stun.cloudflare.com:3478", profile.nativeP2p.iceServers.get(0).urls.get(0));
        assertEquals(3, profile.routes.size());
        PairingProfile.Route upgraded = profile.routesWithNativeP2pProxy(4123).stream()
            .filter(route -> "native-p2p".equals(route.id)).findFirst().orElseThrow();
        assertTrue(upgraded.usesSocks5());
        PairingProfile restored = PairingProfile.fromStoredJson(profile.toJson());
        assertTrue(restored != null && restored.relay != null && restored.nativeP2p != null);
    }

    @Test public void parsesPersistsAndActivatesOnlyExplicitNativeP2pDescription() throws Exception {
        String pairUrl = "http://192.168.1.8:3081/__harness_mobile__/pair/abc";
        JSONObject nativeTransport = new JSONObject()
            .put("id", "native-p2p")
            .put("origin", "http://10.253.77.254:3081")
            .put("signalingUrl", "wss://relay.example.com/tunnel")
            .put("roomId", "r".repeat(43))
            .put("tunnelKey", "k".repeat(43))
            .put("protocolVersion", 1)
            .put("iceServers", new org.json.JSONArray().put(new JSONObject()
                .put("urls", new org.json.JSONArray().put("stun:stun.example.com:3478"))));
        JSONObject object = new JSONObject().put("version", 3).put("pairUrl", pairUrl)
            .put("transports", new org.json.JSONArray().put(nativeTransport));
        String payload = Base64.getUrlEncoder().withoutPadding().encodeToString(object.toString().getBytes(StandardCharsets.UTF_8));

        PairingProfile profile = PairingProfile.parse("harnessmobile://pair?payload=" + payload);
        assertTrue(profile != null && profile.nativeP2p != null);
        assertEquals("wss://relay.example.com/tunnel", profile.nativeP2p.signalingUrl);
        assertEquals("stun:stun.example.com:3478", profile.nativeP2p.iceServers.get(0).urls.get(0));
        PairingProfile restored = PairingProfile.fromStoredJson(profile.toJson());
        assertTrue(restored != null && restored.nativeP2p != null);
        PairingProfile.Route direct = restored.routesWithNativeP2pProxy(4123).stream()
            .filter(route -> "native-p2p".equals(route.id)).findFirst().orElseThrow();
        assertTrue(direct.usesSocks5());
        assertEquals(4123, direct.proxyPort);

        PairingProfile legacy = PairingProfile.parse(pairUrl);
        assertTrue(legacy != null && legacy.nativeP2p == null && legacy.relay == null && legacy.easyTier == null);
    }

    @Test public void rejectsUnsafeNativeP2pSignallingAndIceDescriptions() throws Exception {
        String pairUrl = "http://192.168.1.8:3081/__harness_mobile__/pair/abc";
        JSONObject transport = new JSONObject()
            .put("id", "native-p2p")
            .put("origin", "http://10.253.77.254:3081")
            .put("signalingUrl", "ws://relay.example.com/tunnel")
            .put("roomId", "r".repeat(43))
            .put("tunnelKey", "k".repeat(43))
            .put("protocolVersion", 1)
            .put("iceServers", new org.json.JSONArray().put(new JSONObject().put("url", "https://tracker.example.com")));
        PairingProfile profile = PairingProfile.fromStoredJson(new JSONObject()
            .put("version", 3).put("pairUrl", pairUrl)
            .put("transports", new org.json.JSONArray().put(transport)).toString());
        assertTrue(profile != null);
        assertEquals(null, profile.nativeP2p);
        assertFalse(profile.routesWithNativeP2pProxy(4123).stream()
            .filter(route -> "native-p2p".equals(route.id)).findFirst().orElseThrow().usesSocks5());
    }

    @Test public void nativeP2pRejectsTurnAndIceCredentials() throws Exception {
        String pairUrl = "http://192.168.1.8:3081/__harness_mobile__/pair/abc";
        JSONObject base = new JSONObject()
            .put("id", "native-p2p")
            .put("origin", "http://10.253.77.254:3081")
            .put("signalingUrl", "wss://relay.example.com/tunnel")
            .put("roomId", "r".repeat(43))
            .put("tunnelKey", "k".repeat(43))
            .put("protocolVersion", 1);
        JSONObject turn = new JSONObject(base.toString()).put("iceServers", new org.json.JSONArray()
            .put(new JSONObject().put("url", "turns:third-party.example.com:5349")));
        PairingProfile turnProfile = PairingProfile.fromStoredJson(new JSONObject()
            .put("version", 3).put("pairUrl", pairUrl)
            .put("transports", new org.json.JSONArray().put(turn)).toString());
        assertTrue(turnProfile != null && turnProfile.nativeP2p == null);

        JSONObject credentials = new JSONObject(base.toString()).put("iceServers", new org.json.JSONArray()
            .put(new JSONObject().put("url", "stun:stun.example.com:3478")
                .put("username", "unexpected").put("credential", "unexpected")));
        PairingProfile credentialProfile = PairingProfile.fromStoredJson(new JSONObject()
            .put("version", 3).put("pairUrl", pairUrl)
            .put("transports", new org.json.JSONArray().put(credentials)).toString());
        assertTrue(credentialProfile != null && credentialProfile.nativeP2p == null);
    }

    @Test public void nativeP2pUsesVersionedRoleSeparatedSignallingContract() {
        assertEquals("hello", NativeP2pClient.SIGNAL_HELLO);
        assertEquals("signal", NativeP2pClient.SIGNAL_MESSAGE);
        assertEquals(1, NativeP2pClient.SIGNAL_PROTOCOL_VERSION);
        assertEquals("harness-sync-v1", NativeP2pClient.DATA_CHANNEL_LABEL);
    }

    @Test public void wssRelayAcceptLoopBlocksBeforeSubmittingBoundedWork() throws Exception {
        InetAddress ipv4Loopback = InetAddress.getByName("127.0.0.1");
        ServerSocket server = new ServerSocket(0, 1, ipv4Loopback);
        assertEquals("127.0.0.1", server.getInetAddress().getHostAddress());
        CountDownLatch submitted = new CountDownLatch(1);
        AtomicReference<Throwable> failure = new AtomicReference<>();
        Thread acceptThread = new Thread(() -> WssRelayClient.acceptLoop(
            server,
            command -> { submitted.countDown(); command.run(); },
            socket -> { try { socket.close(); } catch (Exception ignored) {} },
            failure::set
        ));
        acceptThread.start();
        try {
            assertFalse("accept must block without creating worker tasks", submitted.await(150, TimeUnit.MILLISECONDS));
            try (Socket ignored = new Socket(ipv4Loopback, server.getLocalPort())) {
                assertTrue("one accepted socket must submit one worker task", submitted.await(2, TimeUnit.SECONDS));
            }
            assertEquals(null, failure.get());
        } finally {
            server.close();
            acceptThread.join(2_000L);
        }
        assertFalse("accept loop must stop after server close", acceptThread.isAlive());
    }

    @Test public void wssRelayWorkerPoolIsBoundedAndReleasesCapacity() throws Exception {
        ThreadPoolExecutor pool = WssRelayClient.newSocksWorkerPool();
        CountDownLatch workersStarted = new CountDownLatch(8);
        CountDownLatch releaseWorkers = new CountDownLatch(1);
        CountDownLatch queuedCompleted = new CountDownLatch(16);
        try {
            for (int index = 0; index < 8; index++) {
                pool.execute(() -> {
                    workersStarted.countDown();
                    try { releaseWorkers.await(); } catch (InterruptedException ignored) { Thread.currentThread().interrupt(); }
                });
            }
            assertTrue(workersStarted.await(2, TimeUnit.SECONDS));
            for (int index = 0; index < 16; index++) pool.execute(queuedCompleted::countDown);
            try {
                pool.execute(() -> {});
                fail("worker pool must reject connections beyond its bounded capacity");
            } catch (RejectedExecutionException expected) {
                assertEquals(16, pool.getQueue().size());
            }
            releaseWorkers.countDown();
            assertTrue("completed handlers must release worker and queue capacity", queuedCompleted.await(2, TimeUnit.SECONDS));
            assertEquals(16, pool.getQueue().remainingCapacity());
        } finally {
            releaseWorkers.countDown();
            pool.shutdownNow();
            assertTrue(pool.awaitTermination(2, TimeUnit.SECONDS));
        }
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

    @Test public void webProxyRewritesStableHostToTheDesktopRoute() {
        byte[] input = ("GET http://harness.localhost:3081/__harness_mobile__/health HTTP/1.1\r\n" +
            "Host: harness.localhost:3081\r\nConnection: keep-alive\r\n\r\n").getBytes(StandardCharsets.ISO_8859_1);
        String rewritten = new String(
            HarnessWebProxy.rewriteRequest(input, false, "192.168.1.20:3081"),
            StandardCharsets.ISO_8859_1
        );
        assertTrue(rewritten.startsWith("GET /__harness_mobile__/health HTTP/1.1\r\n"));
        assertTrue(rewritten.contains("Host: 192.168.1.20:3081\r\n"));
        assertFalse(rewritten.contains("Host: harness.localhost:3081"));
        assertTrue(rewritten.contains("Connection: close\r\n"));
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

        String[] supported = {
            "observe", "tap", "longPress", "swipe", "back", "home", "recents",
            "textInput", "openApp", "openUri", "openSettings", "screenshot",
            "fileOpen", "fileCreate", "clearCache"
        };
        for (String action : supported) {
            assertEquals(action, ControlCommand.parse(new JSONObject()
                .put("type", "command")
                .put("protocolVersion", 1)
                .put("id", "00000000-0000-4000-8000-000000000099")
                .put("action", action)).action);
        }

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
        assertTrue(ControlCommand.isSensitive("fileCreate"));
        assertTrue(ControlCommand.isSensitive("clearCache"));
        assertFalse(ControlCommand.isSensitive("tap"));
        assertFalse(ControlCommand.isSensitive("shell"));
    }

    @Test public void easyTierRouteBlankAndWhitespaceInputsAreTreatedAsAbsent() throws Exception {
        // Regression: production code must not call String.isBlank() (Java 11, Android API 33+)
        // because the app targets minSdk 26 without core library desugaring. Whitespace-only
        // inputs must be treated as absent and must not reach JSON parsing.
        assertFalse(EasyTierClient.hasRemoteServiceRoute(null, "10.253.77.254"));
        assertFalse(EasyTierClient.hasRemoteServiceRoute("   ", "10.253.77.254"));
        assertFalse(EasyTierClient.hasRemoteServiceRoute("\t\r\n", "10.253.77.254"));
        assertFalse(EasyTierClient.hasRemoteServiceRoute("{}", null));
        assertFalse(EasyTierClient.hasRemoteServiceRoute("{}", "   "));
        // A real, reachable route must still be detected after the blank-guard rewrite.
        String infos = "{"
            + "\"map\":{\"node\":{\"running\":true,\"routes\":[{\"proxy_cidrs\":[\"10.253.77.254/32\"]}]}}"
            + "}";
        assertTrue(EasyTierClient.hasRemoteServiceRoute(infos, "10.253.77.254"));
        assertFalse(EasyTierClient.hasRemoteServiceRoute(infos, "10.253.77.9"));
    }

    @Test public void nativeP2pV2TranscriptMatchesDesktopVector() throws Exception {
        String roomKey = "BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc";
        String desktopNonce = "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE";
        String mobileNonce = "AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI";
        RelayTunnelCodec.NativeP2pSession session = RelayTunnelCodec.deriveNativeP2pSession(
            roomKey, "r".repeat(43), "0123456789abcdef", desktopNonce, mobileNonce);
        assertEquals("native-p2p-v2\n" + "r".repeat(43) + "\n0123456789abcdef\n" + desktopNonce + "\n" + mobileNonce,
            new String(session.transcript, StandardCharsets.US_ASCII));
        assertEquals("cec4dc58ca3c55414e9c81be2954c2f33023f1a33583913dfbb1e1d61e897e40", hexString(session.sessionKey));
        assertEquals("3d469172199b144d4b0ac221070c8c85", hexString(session.sessionId));
    }

    @Test public void nativeP2pV2MatchesCanonicalDesktopPacketVector() throws Exception {
        String roomKey = "BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc";
        String desktopNonce = "ERERERERERERERERERERERERERERERERERERERERERE";
        String mobileNonce = "IiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiI";
        RelayTunnelCodec.NativeP2pSession session = RelayTunnelCodec.deriveNativeP2pSession(
            roomKey, "r".repeat(43), "0102030405060708", desktopNonce, mobileNonce);
        assertEquals("1a9ec333b9c2197584dd67713757e9da5579cbde5478d916940e6ed5c6228093", hexString(session.sessionKey));
        assertEquals("e0d48e4e9db3f592489d54bfee667da7", hexString(session.sessionId));
        RelayTunnelCodec.NativeP2pSessionCodec desktop = new RelayTunnelCodec.NativeP2pSessionCodec(
            session.sessionKey, session.sessionId, "0102030405060708",
            RelayTunnelCodec.DIRECTION_DESKTOP_TO_MOBILE,
            RelayTunnelCodec.DIRECTION_MOBILE_TO_DESKTOP,
            new CountingRandom(), 0L);
        assertEquals(
            "02010000000000000000000102030405060708090a0b0789a2866244dde15a7892db042d6ab74e973411e337c7fb3e28dad64f",
            hexString(desktop.encode(RelayTunnelCodec.DATA, 9, "interop".getBytes(StandardCharsets.UTF_8))));
    }

    @Test public void nativeP2pV2CodecBindsDirectionPeerAndSessionAndRejectsReplay() throws Exception {
        byte[] key = hex("cec4dc58ca3c55414e9c81be2954c2f33023f1a33583913dfbb1e1d61e897e40");
        byte[] sessionId = hex("3d469172199b144d4b0ac221070c8c85");
        CountingRandom random = new CountingRandom();
        RelayTunnelCodec.NativeP2pSessionCodec desktop = new RelayTunnelCodec.NativeP2pSessionCodec(
            key, sessionId, "0123456789abcdef", RelayTunnelCodec.DIRECTION_DESKTOP_TO_MOBILE,
            RelayTunnelCodec.DIRECTION_MOBILE_TO_DESKTOP, random, 0L);
        RelayTunnelCodec.NativeP2pSessionCodec mobile = new RelayTunnelCodec.NativeP2pSessionCodec(
            key, sessionId, "0123456789abcdef", RelayTunnelCodec.DIRECTION_MOBILE_TO_DESKTOP,
            RelayTunnelCodec.DIRECTION_DESKTOP_TO_MOBILE, new CountingRandom(), 0L);
        byte[] packet = desktop.encode(RelayTunnelCodec.DATA, 7, "bound".getBytes(StandardCharsets.UTF_8));
        assertEquals("02010000000000000000000102030405060708090a0b96cc7ee9f7045c0003e5ecfeecfd8c0396dbe4963ac18a90180bab", hexString(packet));
        RelayTunnelCodec.Frame decoded = mobile.decode(packet);
        assertEquals(7, decoded.streamId);
        assertEquals("bound", new String(decoded.payload, StandardCharsets.UTF_8));
        assertEquals(0, decoded.sequence);
        expectSecurityFailure(() -> mobile.decode(packet));

        RelayTunnelCodec.NativeP2pSessionCodec wrongDirection = new RelayTunnelCodec.NativeP2pSessionCodec(
            key, sessionId, "0123456789abcdef", RelayTunnelCodec.DIRECTION_DESKTOP_TO_MOBILE,
            RelayTunnelCodec.DIRECTION_MOBILE_TO_DESKTOP, new CountingRandom(), 1L);
        expectSecurityFailure(() -> wrongDirection.decode(desktop.encode(RelayTunnelCodec.DATA, 8, new byte[0])));
        RelayTunnelCodec.NativeP2pSessionCodec wrongPeer = new RelayTunnelCodec.NativeP2pSessionCodec(
            key, sessionId, "fedcba9876543210", RelayTunnelCodec.DIRECTION_MOBILE_TO_DESKTOP,
            RelayTunnelCodec.DIRECTION_DESKTOP_TO_MOBILE, new CountingRandom(), 1L);
        expectSecurityFailure(() -> wrongPeer.decode(desktop.encode(RelayTunnelCodec.DATA, 9, new byte[0])));
        byte[] wrongId = sessionId.clone();
        wrongId[0] ^= 1;
        RelayTunnelCodec.NativeP2pSessionCodec wrongSession = new RelayTunnelCodec.NativeP2pSessionCodec(
            key, wrongId, "0123456789abcdef", RelayTunnelCodec.DIRECTION_MOBILE_TO_DESKTOP,
            RelayTunnelCodec.DIRECTION_DESKTOP_TO_MOBILE, new CountingRandom(), 1L);
        expectSecurityFailure(() -> wrongSession.decode(desktop.encode(RelayTunnelCodec.DATA, 10, new byte[0])));
    }

    @Test public void nativeP2pV2CodecUsesA4096PacketReplayWindowStartingAtSequenceZero() throws Exception {
        byte[] key = new byte[32];
        byte[] sessionId = new byte[16];
        RelayTunnelCodec.NativeP2pSessionCodec sender = new RelayTunnelCodec.NativeP2pSessionCodec(
            key, sessionId, "0123456789abcdef", RelayTunnelCodec.DIRECTION_DESKTOP_TO_MOBILE,
            RelayTunnelCodec.DIRECTION_MOBILE_TO_DESKTOP, new CountingRandom(), 0L);
        byte[] sequenceZero = sender.encode(RelayTunnelCodec.DATA, 1, new byte[0]);
        byte[] sequence4095 = null;
        byte[] sequence4096 = null;
        for (int sequence = 1; sequence <= 4096; sequence++) {
            byte[] packet = sender.encode(RelayTunnelCodec.DATA, 1, new byte[0]);
            if (sequence == 4095) sequence4095 = packet;
            else if (sequence == 4096) sequence4096 = packet;
        }

        RelayTunnelCodec.NativeP2pSessionCodec within = new RelayTunnelCodec.NativeP2pSessionCodec(
            key, sessionId, "0123456789abcdef", RelayTunnelCodec.DIRECTION_MOBILE_TO_DESKTOP,
            RelayTunnelCodec.DIRECTION_DESKTOP_TO_MOBILE, new CountingRandom(), 0L);
        assertEquals(4095, within.decode(sequence4095).sequence);
        assertEquals(0, within.decode(sequenceZero).sequence);

        RelayTunnelCodec.NativeP2pSessionCodec outside = new RelayTunnelCodec.NativeP2pSessionCodec(
            key, sessionId, "0123456789abcdef", RelayTunnelCodec.DIRECTION_MOBILE_TO_DESKTOP,
            RelayTunnelCodec.DIRECTION_DESKTOP_TO_MOBILE, new CountingRandom(), 0L);
        assertEquals(4096, outside.decode(sequence4096).sequence);
        expectSecurityFailure(() -> outside.decode(sequenceZero));
    }

    @Test public void nativeP2pV2CodecRejectsOversizedPacketsBeforeDecrypting() throws Exception {
        RelayTunnelCodec.NativeP2pSessionCodec codec = new RelayTunnelCodec.NativeP2pSessionCodec(
            new byte[32], new byte[16], "0123456789abcdef", RelayTunnelCodec.DIRECTION_MOBILE_TO_DESKTOP,
            RelayTunnelCodec.DIRECTION_DESKTOP_TO_MOBILE, new CountingRandom(), 1L);
        expectSecurityFailure(() -> codec.decode(new byte[RelayTunnelCodec.MAX_PACKET + 1]));
        assertTrue(NativeP2pClient.isBoundedTunnelPacketSize(RelayTunnelCodec.MAX_PACKET));
        assertFalse(NativeP2pClient.isBoundedTunnelPacketSize(0));
        assertFalse(NativeP2pClient.isBoundedTunnelPacketSize(RelayTunnelCodec.MAX_PACKET + 1));
    }

    @Test public void nativeP2pV2WaitsOnlyForAnExplicitDesktopCapability() throws Exception {
        assertTrue(NativeP2pClient.hasNativeP2pV2Capability(new JSONObject()
            .put("desktopCapabilities", new org.json.JSONArray().put("native-p2p-v2"))));
        assertFalse(NativeP2pClient.hasNativeP2pV2Capability(new JSONObject()));
        assertFalse(NativeP2pClient.hasNativeP2pV2Capability(new JSONObject()
            .put("desktopCapabilities", new org.json.JSONArray().put("native-p2p-v1"))));
    }

    @Test public void nativeP2pMobileIceAndEndSignalsCarryBothFreshNonces() throws Exception {
        String desktopNonce = "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE";
        String mobileNonce = "AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI";
        for (String kind : List.of("ice", "end-of-candidates")) {
            JSONObject signal = NativeP2pClient.bindMobileSignal(new JSONObject().put("kind", kind),
                "0123456789abcdef", desktopNonce, mobileNonce);
            assertEquals("0123456789abcdef", signal.getString("source"));
            assertEquals("desktop", signal.getString("target"));
            assertEquals(desktopNonce, signal.getString("desktopNonce"));
            assertEquals(mobileNonce, signal.getString("mobileNonce"));
            assertFalse(signal.has("protocolVersion"));
            assertFalse(signal.has("sessionId"));
        }
    }

    @Test public void nativeP2pStreamsPinTheirOpenPathAndRejectRebinding() {
        NativeP2pClient.StreamRecord direct = new NativeP2pClient.StreamRecord(null,
            NativeP2pClient.selectStreamPath(true));
        NativeP2pClient.StreamRecord relay = new NativeP2pClient.StreamRecord(null,
            NativeP2pClient.selectStreamPath(false));
        assertTrue(direct.accepts(NativeP2pClient.StreamPath.DIRECT));
        assertFalse(direct.accepts(NativeP2pClient.StreamPath.RELAY));
        assertTrue(relay.accepts(NativeP2pClient.StreamPath.RELAY));
        assertFalse(relay.accepts(NativeP2pClient.StreamPath.DIRECT));
    }

    private static void expectSecurityFailure(SecurityRunnable action) throws Exception {
        try { action.run(); fail("Expected security failure"); }
        catch (GeneralSecurityException expected) {}
    }

    private interface SecurityRunnable { void run() throws Exception; }

    private static final class CountingRandom extends SecureRandom {
        private int sequence;
        @Override public void nextBytes(byte[] bytes) {
            for (int index = 0; index < bytes.length; index++) bytes[index] = (byte) (sequence + index);
            sequence++;
        }
    }

    private static String hexString(byte[] value) {
        StringBuilder result = new StringBuilder(value.length * 2);
        for (byte item : value) result.append(String.format("%02x", item & 0xff));
        return result.toString();
    }

    private static byte[] hex(String value) {
        byte[] result = new byte[value.length() / 2];
        for (int index = 0; index < result.length; index++) {
            result[index] = (byte) Integer.parseInt(value.substring(index * 2, index * 2 + 2), 16);
        }
        return result;
    }
}
