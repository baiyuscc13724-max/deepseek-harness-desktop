package io.harnessdesktop.mobile;

import android.content.Context;

import org.json.JSONObject;
import org.webrtc.DataChannel;
import org.webrtc.IceCandidate;
import org.webrtc.MediaConstraints;
import org.webrtc.MediaStream;
import org.webrtc.PeerConnection;
import org.webrtc.PeerConnectionFactory;
import org.webrtc.RtpReceiver;
import org.webrtc.SdpObserver;
import org.webrtc.SessionDescription;

import java.io.EOFException;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Base64;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executor;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ThreadFactory;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicLong;
import java.util.function.Consumer;

import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.WebSocket;
import okhttp3.WebSocketListener;
import okio.ByteString;

/**
 * One authenticated connection for both optional WebRTC signalling and the
 * existing encrypted WSS data fallback. Old relay deployments still expose a
 * working binary tunnel; only a welcome advertising signalingVersion=1 enables
 * SDP/ICE exchange.
 */
final class NativeP2pClient implements AutoCloseable {
    interface Listener {
        void onRelayReady(int socksPort);
        void onDirectReady(int socksPort);
        void onDirectFailure(String message);
        void onFailure(String message);
    }

    static final String DATA_CHANNEL_LABEL = "harness-sync-v1";
    static final String SIGNAL_HELLO = "hello";
    static final String SIGNAL_MESSAGE = "signal";
    static final String SIGNAL_ICE = "ice";
    static final int SIGNAL_PROTOCOL_VERSION = 1;
    private static final String DEFAULT_STUN_URL = "stun:stun.cloudflare.com:3478";
    private static final int MAX_SOCKS_WORKERS = 8;
    private static final int MAX_PENDING_SOCKS = 16;
    private static final int MAX_ICE_CANDIDATES = 128;
    private static final int MAX_SIGNAL_PLAIN_BYTES = 32 * 1024;
    private static final long MAX_BUFFERED_BYTES = 4L * 1024 * 1024;
    private static final long NEGOTIATION_TIMEOUT_SECONDS = 20L;
    private static final AtomicBoolean WEBRTC_INITIALIZED = new AtomicBoolean();

    private final Context context;
    private final OkHttpClient httpClient;
    private final ExecutorService acceptor;
    private final ExecutorService workers;
    private final ScheduledExecutorService timer;
    enum StreamPath { DIRECT, RELAY }

    static final class StreamRecord {
        final Socket socket;
        final StreamPath path;
        StreamRecord(Socket socket, StreamPath path) { this.socket = socket; this.path = path; }
        boolean accepts(StreamPath incoming) { return path == incoming; }
    }

    private final Map<Long, StreamRecord> streams = new ConcurrentHashMap<>();
    private final AtomicLong streamSequence = new AtomicLong(1);
    private final SecureRandom sessionRandom = new SecureRandom();

    private volatile PairingProfile.NativeP2pConfig config;
    private volatile RelayTunnelCodec roomCodec;
    private volatile RelayTunnelCodec.NativeP2pSessionCodec sessionCodec;
    private volatile Listener listener;
    private volatile WebSocket socket;
    private volatile PeerConnectionFactory factory;
    private volatile PeerConnection peerConnection;
    private volatile DataChannel dataChannel;
    private volatile ServerSocket socksServer;
    private volatile boolean stopping = true;
    private volatile boolean directReported;
    private volatile boolean directFailureReported;
    private volatile boolean directUsable;
    private volatile boolean sessionReady;
    private volatile boolean relaySupportsSignaling;
    private volatile boolean signalingV2;
    private volatile String peerId;
    private volatile String desktopNonce;
    private volatile String mobileNonce;
    private volatile String sessionId;
    private volatile int iceCandidateCount;
    private volatile long generation;

    NativeP2pClient(Context context) {
        this.context = context.getApplicationContext();
        acceptor = Executors.newSingleThreadExecutor(daemonThreadFactory("harness-p2p-accept"));
        workers = newWorkerPool();
        timer = Executors.newSingleThreadScheduledExecutor(daemonThreadFactory("harness-p2p-timer"));
        httpClient = new OkHttpClient.Builder()
            .retryOnConnectionFailure(true)
            .connectTimeout(12, TimeUnit.SECONDS)
            .pingInterval(20, TimeUnit.SECONDS)
            .build();
    }

    static ThreadPoolExecutor newWorkerPool() {
        return new ThreadPoolExecutor(
            MAX_SOCKS_WORKERS, MAX_SOCKS_WORKERS, 0L, TimeUnit.MILLISECONDS,
            new ArrayBlockingQueue<>(MAX_PENDING_SOCKS),
            daemonThreadFactory("harness-p2p-worker"),
            new ThreadPoolExecutor.AbortPolicy()
        );
    }

    private static ThreadFactory daemonThreadFactory(String name) {
        return runnable -> {
            Thread thread = new Thread(runnable, name);
            thread.setDaemon(true);
            return thread;
        };
    }

    synchronized void start(PairingProfile.NativeP2pConfig config, Listener listener) {
        stopTransport();
        stopping = false;
        directReported = false;
        directFailureReported = false;
        directUsable = false;
        sessionReady = false;
        relaySupportsSignaling = false;
        signalingV2 = false;
        peerId = null;
        desktopNonce = null;
        mobileNonce = null;
        sessionId = null;
        iceCandidateCount = 0;
        long activeGeneration = ++generation;
        this.config = config;
        this.listener = listener;
        try {
            roomCodec = new RelayTunnelCodec(config.tunnelKey);
            ensurePeerConnectionFactory();
        } catch (RuntimeException error) {
            fail(activeGeneration, error);
            return;
        }
        socket = httpClient.newWebSocket(new Request.Builder().url(config.signalingUrl).build(), new WebSocketListener() {
            @Override public void onOpen(WebSocket webSocket, Response response) {
                try {
                    JSONObject hello = new JSONObject()
                        .put("type", SIGNAL_HELLO)
                        .put("version", 1)
                        .put("role", "mobile")
                        .put("roomId", config.roomId)
                        .put("capabilities", new org.json.JSONArray().put("native-p2p-v2"));
                    if (!webSocket.send(hello.toString())) throw new IOException("P2P/WSS socket rejected hello");
                } catch (Exception error) {
                    fail(activeGeneration, error);
                }
            }

            @Override public void onMessage(WebSocket webSocket, String text) { handleControl(activeGeneration, text); }
            @Override public void onMessage(WebSocket webSocket, ByteString bytes) {
                if (bytes.size() <= 8 || bytes.size() > 8 + RelayTunnelCodec.MAX_PACKET) {
                    fail(activeGeneration, new IOException("Invalid WSS relay envelope size"));
                    return;
                }
                handleRelayEnvelope(activeGeneration, bytes.toByteArray());
            }
            @Override public void onFailure(WebSocket webSocket, Throwable error, Response response) { fail(activeGeneration, error); }
            @Override public void onClosed(WebSocket webSocket, int code, String reason) {
                if (!stopping) fail(activeGeneration, new IOException("P2P/WSS socket closed: " + reason));
            }
        });
    }

    private synchronized void ensurePeerConnectionFactory() {
        if (WEBRTC_INITIALIZED.compareAndSet(false, true)) {
            PeerConnectionFactory.initialize(
                PeerConnectionFactory.InitializationOptions.builder(context)
                    .setEnableInternalTracer(false)
                    .createInitializationOptions()
            );
        }
        // The factory is process-local infrastructure, not authenticated session
        // state. Reuse it across weak-network reconnects; peer/data channels and
        // every room/session codec are still rebuilt below for each generation.
        if (factory == null) factory = PeerConnectionFactory.builder().createPeerConnectionFactory();
    }

    private void handleControl(long activeGeneration, String text) {
        try {
            if (text == null || text.length() > MAX_SIGNAL_PLAIN_BYTES * 2) throw new IOException("Invalid P2P control message size");
            JSONObject message = new JSONObject(text);
            String type = message.optString("type", "");
            if ("welcome".equals(type) && "mobile".equals(message.optString("role"))) {
                relaySupportsSignaling = message.optInt("signalingVersion", 0) == SIGNAL_PROTOCOL_VERSION;
                String assignedPeer = message.optString("peerId", "");
                if (relaySupportsSignaling && !validPeerId(assignedPeer)) throw new IOException("Invalid native P2P peer id");
                peerId = validPeerId(assignedPeer) ? assignedPeer : null;
                if (message.optBoolean("desktopOnline", false)) configureDesktopMode(activeGeneration, message);
                else if (!relaySupportsSignaling) throw new IOException("Desktop WSS relay is offline");
                return;
            }
            if ("desktop-online".equals(type)) {
                configureDesktopMode(activeGeneration, message);
                return;
            }
            if ("desktop-offline".equals(type)) {
                if (!relaySupportsSignaling || sessionReady) throw new IOException("Desktop WSS relay is offline");
                return;
            }
            if (!SIGNAL_MESSAGE.equals(type) || message.optInt("version", 0) != SIGNAL_PROTOCOL_VERSION
                || !"desktop".equals(message.optString("source"))) return;
            if (!signalingV2 || !validPeerId(peerId)) throw new IOException("Unexpected native P2P signal");
            handleEncryptedSignal(activeGeneration, message.optString("payload", ""));
        } catch (Exception error) {
            fail(activeGeneration, error);
        }
    }

    private void configureDesktopMode(long activeGeneration, JSONObject message) throws IOException {
        if (signalingV2 || sessionReady || socksServer != null) return;
        if (relaySupportsSignaling && hasNativeP2pV2Capability(message)) {
            if (!validPeerId(peerId)) throw new IOException("Invalid native P2P peer id");
            signalingV2 = true;
            // Keep the existing external-network route usable immediately while
            // WebRTC negotiates in the background. A later v2 session closes
            // these v1 streams before new SOCKS connections select v2/direct.
            openSocksServer(activeGeneration);
            timer.schedule(() -> directTimedOut(activeGeneration), NEGOTIATION_TIMEOUT_SECONDS, TimeUnit.SECONDS);
            return;
        }
        openSocksServer(activeGeneration);
        reportDirectFailure(activeGeneration, "桌面或个人中继不支持 P2P v2，继续使用旧版 WSS/443");
    }

    static boolean hasNativeP2pV2Capability(JSONObject message) {
        org.json.JSONArray capabilities = message == null ? null : message.optJSONArray("desktopCapabilities");
        if (capabilities == null || capabilities.length() > 16) return false;
        for (int index = 0; index < capabilities.length(); index++) {
            if ("native-p2p-v2".equals(capabilities.optString(index, ""))) return true;
        }
        return false;
    }

    private void handleEncryptedSignal(long activeGeneration, String encoded) throws Exception {
        if (encoded == null || encoded.isEmpty() || encoded.length() > 48 * 1024 || !encoded.matches("[A-Za-z0-9_-]+")) {
            throw new IOException("Invalid encrypted P2P signal");
        }
        byte[] packet = Base64.getUrlDecoder().decode(encoded);
        if (packet.length > RelayTunnelCodec.MAX_PACKET) throw new IOException("Encrypted P2P signal is too large");
        RelayTunnelCodec.Frame frame = roomCodec.decode(packet);
        if (frame.type != RelayTunnelCodec.DATA || frame.streamId != 0 || frame.payload.length > MAX_SIGNAL_PLAIN_BYTES) {
            throw new IOException("Invalid encrypted P2P signal frame");
        }
        JSONObject signal = new JSONObject(new String(frame.payload, StandardCharsets.UTF_8));
        validateSignalBinding(signal);
        String kind = signal.optString("kind", "");
        if ("offer".equals(kind)) {
            if (desktopNonce != null) throw new IOException("Replayed native P2P offer was rejected");
            String offeredDesktopNonce = signal.optString("desktopNonce", "");
            if (!validNonce(offeredDesktopNonce)) throw new IOException("Invalid native P2P desktop nonce");
            JSONObject description = signal.optJSONObject("description");
            String sdp = description == null ? "" : bounded(description.optString("sdp", ""), MAX_SIGNAL_PLAIN_BYTES, "SDP offer");
            if (!"offer".equals(description.optString("type", ""))) throw new IOException("Invalid SDP offer type");
            byte[] generated = new byte[32];
            sessionRandom.nextBytes(generated);
            String generatedMobileNonce = Base64.getUrlEncoder().withoutPadding().encodeToString(generated);
            RelayTunnelCodec.NativeP2pSession session = RelayTunnelCodec.deriveNativeP2pSession(
                config.tunnelKey, config.roomId, peerId, offeredDesktopNonce, generatedMobileNonce);
            desktopNonce = offeredDesktopNonce;
            mobileNonce = generatedMobileNonce;
            sessionId = session.sessionIdBase64Url();
            sessionCodec = new RelayTunnelCodec.NativeP2pSessionCodec(
                session.sessionKey, session.sessionId, peerId,
                RelayTunnelCodec.DIRECTION_MOBILE_TO_DESKTOP,
                RelayTunnelCodec.DIRECTION_DESKTOP_TO_MOBILE);
            ensurePeerConnection(activeGeneration);
            peerConnection.setRemoteDescription(new SimpleSdpObserver() {
                @Override public void onSetSuccess() { createAndSendAnswer(activeGeneration); }
                @Override public void onSetFailure(String error) { disableDirect(activeGeneration, "无法设置 P2P offer: " + error); }
            }, new SessionDescription(SessionDescription.Type.OFFER, sdp));
        } else if (SIGNAL_ICE.equals(kind)) {
            validateIceSession(signal);
            ensurePeerConnection(activeGeneration);
            if (++iceCandidateCount > MAX_ICE_CANDIDATES) throw new IOException("Too many ICE candidates");
            JSONObject candidate = signal.optJSONObject("candidate");
            if (candidate == null) throw new IOException("Invalid ICE candidate");
            String value = bounded(candidate.optString("candidate", ""), 8 * 1024, "ICE candidate");
            String sdpMid = candidate.optString("sdpMid", "");
            int line = candidate.optInt("sdpMLineIndex", -1);
            if (sdpMid.length() > 256 || line < 0 || line > 64) throw new IOException("Invalid ICE candidate metadata");
            peerConnection.addIceCandidate(new IceCandidate(sdpMid, line, value));
        } else if ("end-of-candidates".equals(kind)) {
            validateIceSession(signal);
        } else {
            throw new IOException("Unknown native P2P signal kind");
        }
    }

    private void validateSignalBinding(JSONObject signal) throws IOException {
        if (!"desktop".equals(signal.optString("source", ""))
            || !peerId.equals(signal.optString("target", ""))) {
            throw new IOException("Native P2P signal session binding was rejected");
        }
    }

    private void validateIceSession(JSONObject signal) throws IOException {
        if (!validNonce(desktopNonce) || !desktopNonce.equals(signal.optString("desktopNonce", ""))) {
            throw new IOException("Native P2P ICE nonce binding was rejected");
        }
        String candidateMobileNonce = signal.optString("mobileNonce", "");
        if (!candidateMobileNonce.isEmpty() && (!validNonce(candidateMobileNonce) || !candidateMobileNonce.equals(mobileNonce))) {
            throw new IOException("Native P2P ICE mobile nonce was rejected");
        }
    }

    private static boolean validPeerId(String value) { return value != null && value.matches("[a-f0-9]{16}"); }

    private static boolean validNonce(String value) {
        if (value == null || !value.matches("[A-Za-z0-9_-]{43}")) return false;
        try { return Base64.getUrlDecoder().decode(value).length == 32; }
        catch (IllegalArgumentException error) { return false; }
    }

    private static String bounded(String value, int maxLength, String label) throws IOException {
        if (value == null || value.isEmpty() || value.length() > maxLength) throw new IOException("Invalid " + label);
        return value;
    }

    private synchronized void ensurePeerConnection(long activeGeneration) throws IOException {
        if (generation != activeGeneration || stopping || peerConnection != null) return;
        ArrayList<PeerConnection.IceServer> servers = new ArrayList<>();
        if (config.iceServers.isEmpty()) {
            servers.add(PeerConnection.IceServer.builder(DEFAULT_STUN_URL).createIceServer());
        } else {
            for (PairingProfile.IceServerConfig server : config.iceServers) {
                servers.add(PeerConnection.IceServer.builder(server.urls).createIceServer());
            }
        }
        PeerConnection.RTCConfiguration rtc = new PeerConnection.RTCConfiguration(servers);
        rtc.sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN;
        rtc.tcpCandidatePolicy = PeerConnection.TcpCandidatePolicy.ENABLED;
        peerConnection = factory.createPeerConnection(rtc, new PeerConnection.Observer() {
            @Override public void onSignalingChange(PeerConnection.SignalingState state) {}
            @Override public void onIceConnectionChange(PeerConnection.IceConnectionState state) {
                if (state == PeerConnection.IceConnectionState.FAILED || state == PeerConnection.IceConnectionState.CLOSED
                    || state == PeerConnection.IceConnectionState.DISCONNECTED) {
                    disableDirect(activeGeneration, "P2P ICE " + state.name().toLowerCase(Locale.ROOT));
                }
            }
            @Override public void onIceConnectionReceivingChange(boolean receiving) {}
            @Override public void onIceGatheringChange(PeerConnection.IceGatheringState state) {
                if (state == PeerConnection.IceGatheringState.COMPLETE) sendEndOfCandidates(activeGeneration);
            }
            @Override public void onIceCandidate(IceCandidate candidate) { sendIce(activeGeneration, candidate); }
            @Override public void onIceCandidatesRemoved(IceCandidate[] candidates) {}
            @Override public void onAddStream(MediaStream stream) {}
            @Override public void onRemoveStream(MediaStream stream) {}
            @Override public void onDataChannel(DataChannel channel) { attachDataChannel(activeGeneration, channel); }
            @Override public void onRenegotiationNeeded() {}
            @Override public void onAddTrack(RtpReceiver receiver, MediaStream[] streams) {}
        });
        if (peerConnection == null) throw new IOException("WebRTC peer connection could not be created");
    }

    private void createAndSendAnswer(long activeGeneration) {
        PeerConnection connection = peerConnection;
        if (connection == null) return;
        connection.createAnswer(new SimpleSdpObserver() {
            @Override public void onCreateSuccess(SessionDescription answer) {
                connection.setLocalDescription(new SimpleSdpObserver() {
                    @Override public void onSetSuccess() {
                        try {
                            sendSignal(new JSONObject().put("kind", "answer").put("mobileNonce", mobileNonce)
                                .put("description", new JSONObject().put("type", "answer").put("sdp", answer.description)));
                            // The answer authenticates a candidate session, but WSS
                            // stays authoritative until the DataChannel is actually open.
                            openSocksServer(activeGeneration);
                            promoteDirectIfValidated(activeGeneration);
                        } catch (Exception error) {
                            fail(activeGeneration, error);
                        }
                    }
                    @Override public void onSetFailure(String error) { disableDirect(activeGeneration, "无法设置 P2P answer: " + error); }
                }, answer);
            }
            @Override public void onCreateFailure(String error) { disableDirect(activeGeneration, "无法创建 P2P answer: " + error); }
        }, new MediaConstraints());
    }

    private void sendIce(long activeGeneration, IceCandidate candidate) {
        if (!validNonce(desktopNonce) || !validNonce(mobileNonce) || sessionId == null) return;
        try {
            sendSignal(new JSONObject().put("kind", "ice").put("candidate", new JSONObject()
                .put("candidate", candidate.sdp)
                .put("sdpMid", candidate.sdpMid == null ? "" : candidate.sdpMid)
                .put("sdpMLineIndex", candidate.sdpMLineIndex)));
        } catch (Exception error) {
            disableDirect(activeGeneration, error.getMessage());
        }
    }

    private void sendEndOfCandidates(long activeGeneration) {
        if (!validNonce(desktopNonce) || !validNonce(mobileNonce) || sessionId == null) return;
        try { sendSignal(new JSONObject().put("kind", "end-of-candidates")); }
        catch (Exception error) { disableDirect(activeGeneration, error.getMessage()); }
    }

    static JSONObject bindMobileSignal(
        JSONObject signal,
        String peerId,
        String desktopNonce,
        String mobileNonce
    ) throws Exception {
        if (signal == null || !validPeerId(peerId) || !validNonce(desktopNonce) || !validNonce(mobileNonce)) {
            throw new IOException("Native P2P signal session is not ready");
        }
        return signal.put("source", peerId)
            .put("target", "desktop")
            .put("desktopNonce", desktopNonce)
            .put("mobileNonce", mobileNonce);
    }

    private void sendSignal(JSONObject signal) throws Exception {
        bindMobileSignal(signal, peerId, desktopNonce, mobileNonce);
        byte[] plain = signal.toString().getBytes(StandardCharsets.UTF_8);
        if (plain.length > MAX_SIGNAL_PLAIN_BYTES) throw new IOException("P2P signal is too large");
        String payload = Base64.getUrlEncoder().withoutPadding().encodeToString(roomCodec.encode(RelayTunnelCodec.DATA, 0, plain));
        JSONObject envelope = new JSONObject()
            .put("type", SIGNAL_MESSAGE)
            .put("version", SIGNAL_PROTOCOL_VERSION)
            .put("target", "desktop")
            .put("payload", payload);
        WebSocket active = socket;
        if (active == null || active.queueSize() > MAX_BUFFERED_BYTES || !active.send(envelope.toString())) {
            throw new IOException("P2P signalling backpressure limit exceeded");
        }
    }

    private synchronized void attachDataChannel(long activeGeneration, DataChannel channel) {
        if (generation != activeGeneration || stopping || channel == null || !DATA_CHANNEL_LABEL.equals(channel.label())) {
            if (channel != null) channel.close();
            return;
        }
        if (dataChannel != null && dataChannel != channel) dataChannel.close();
        dataChannel = channel;
        channel.registerObserver(new DataChannel.Observer() {
            @Override public void onBufferedAmountChange(long previousAmount) {}
            @Override public void onStateChange() {
                if (channel.state() == DataChannel.State.OPEN) {
                    promoteDirectIfValidated(activeGeneration);
                } else if (channel.state() == DataChannel.State.CLOSED) {
                    disableDirect(activeGeneration, "P2P DataChannel 已关闭，继续使用 WSS/443");
                }
            }
            @Override public void onMessage(DataChannel.Buffer buffer) { handleDirectPacket(activeGeneration, buffer); }
        });
        promoteDirectIfValidated(activeGeneration);
    }

    private synchronized void promoteDirectIfValidated(long activeGeneration) {
        DataChannel active = dataChannel;
        if (generation != activeGeneration || stopping || sessionCodec == null || active == null
            || active.state() != DataChannel.State.OPEN || sessionReady) return;
        // Only now is the candidate path validated. Retire v1 relay streams after
        // this point; the WSS control socket remains available as the v2 fallback.
        closeStreamsForPath(StreamPath.RELAY);
        sessionReady = true;
        directUsable = true;
        reportDirectReady(activeGeneration);
    }

    private synchronized void openSocksServer(long activeGeneration) throws IOException {
        if (generation != activeGeneration || stopping) return;
        if (socksServer == null) {
            ServerSocket server = new ServerSocket(0, 16, InetAddress.getByName("127.0.0.1"));
            socksServer = server;
            acceptor.execute(() -> acceptLoop(server, workers, this::handleSocks, error -> fail(activeGeneration, error)));
        }
        Listener active = listener;
        if (active != null) active.onRelayReady(socksServer.getLocalPort());
    }

    private void reportDirectReady(long activeGeneration) {
        if (generation != activeGeneration || stopping || directReported || socksServer == null) return;
        directReported = true;
        directFailureReported = false;
        Listener active = listener;
        if (active != null) active.onDirectReady(socksServer.getLocalPort());
    }

    private void directTimedOut(long activeGeneration) {
        if (generation != activeGeneration || stopping || directReported) return;
        if (!sessionReady) {
            try { openSocksServer(activeGeneration); }
            catch (IOException error) { fail(activeGeneration, error); return; }
        }
        disableDirect(activeGeneration, "P2P 协商超时，继续使用 WSS/443");
    }

    private void disableDirect(long activeGeneration, String message) {
        directUsable = false;
        closeStreamsForPath(StreamPath.DIRECT);
        reportDirectFailure(activeGeneration, message);
    }

    private void closeStreamsForPath(StreamPath path) {
        for (Map.Entry<Long, StreamRecord> entry : streams.entrySet()) {
            StreamRecord record = entry.getValue();
            if (record.path == path && streams.remove(entry.getKey(), record)) closeQuietly(record.socket);
        }
    }

    private void reportDirectFailure(long activeGeneration, String message) {
        if (generation != activeGeneration || stopping || (directFailureReported && !directReported)) return;
        directReported = false;
        directFailureReported = true;
        Listener active = listener;
        if (active != null) active.onDirectFailure(message == null ? "P2P 未接通" : message);
    }

    static void acceptLoop(ServerSocket server, Executor workers, Consumer<Socket> handler, Consumer<Throwable> failure) {
        while (!server.isClosed()) {
            Socket socket = null;
            try {
                socket = server.accept();
                Socket accepted = socket;
                workers.execute(() -> handler.accept(accepted));
            } catch (RejectedExecutionException overloaded) {
                closeQuietly(socket);
            } catch (IOException error) {
                closeQuietly(socket);
                if (!server.isClosed()) failure.accept(error);
            } catch (RuntimeException error) {
                closeQuietly(socket);
                if (!server.isClosed()) failure.accept(error);
            }
        }
    }

    private void handleSocks(Socket client) {
        long streamId = -1;
        try {
            client.setSoTimeout(10_000);
            InputStream input = client.getInputStream();
            OutputStream output = client.getOutputStream();
            byte[] greeting = readExactly(input, 2);
            if (greeting[0] != 5) throw new IOException("Invalid SOCKS version");
            readExactly(input, greeting[1] & 0xff);
            output.write(new byte[]{5, 0}); output.flush();
            byte[] request = readExactly(input, 4);
            if (request[0] != 5 || request[1] != 1) throw new IOException("Only SOCKS CONNECT is supported");
            int addressLength = request[3] == 1 ? 4 : request[3] == 4 ? 16 : request[3] == 3 ? readExactly(input, 1)[0] & 0xff : -1;
            if (addressLength < 0) throw new IOException("Invalid SOCKS address");
            readExactly(input, addressLength + 2);
            streamId = nextStreamId();
            StreamPath path = selectStreamPath(directUsable && sessionCodec != null && isDirectChannelOpen());
            StreamRecord record = new StreamRecord(client, path);
            streams.put(streamId, record);
            sendFrame(record, RelayTunnelCodec.OPEN, streamId, new byte[0]);
            output.write(new byte[]{5, 0, 0, 1, 127, 0, 0, 1, 0, 0}); output.flush();
            client.setSoTimeout(0);
            byte[] buffer = new byte[16 * 1024];
            int count;
            while ((count = input.read(buffer)) >= 0) {
                if (count > 0) sendFrame(record, RelayTunnelCodec.DATA, streamId, Arrays.copyOf(buffer, count));
            }
            sendFrame(record, RelayTunnelCodec.FIN, streamId, new byte[0]);
        } catch (Exception error) {
            if (streamId >= 0) {
                StreamRecord record = streams.get(streamId);
                if (record != null) try { sendFrame(record, RelayTunnelCodec.RESET, streamId, new byte[0]); } catch (Exception ignored) {}
            }
        } finally {
            if (streamId >= 0) streams.remove(streamId);
            closeQuietly(client);
        }
    }

    static StreamPath selectStreamPath(boolean directAvailable) {
        return directAvailable ? StreamPath.DIRECT : StreamPath.RELAY;
    }

    static boolean isBoundedTunnelPacketSize(int size) {
        return size > 0 && size <= RelayTunnelCodec.MAX_PACKET;
    }

    private boolean isDirectChannelOpen() {
        DataChannel active = dataChannel;
        return active != null && active.state() == DataChannel.State.OPEN;
    }

    private long nextStreamId() {
        for (;;) {
            long value = streamSequence.getAndUpdate(previous -> previous >= 0xfffffffdL ? 1 : previous + 2);
            if (!streams.containsKey(value)) return value;
        }
    }

    private void handleDirectPacket(long activeGeneration, DataChannel.Buffer buffer) {
        if (!buffer.binary) { disableDirect(activeGeneration, "P2P DataChannel 收到非二进制帧"); return; }
        ByteBuffer source = buffer.data.slice();
        int size = source.remaining();
        if (!isBoundedTunnelPacketSize(size)) {
            disableDirect(activeGeneration, "P2P DataChannel 帧大小无效");
            return;
        }
        byte[] packet = new byte[size];
        source.get(packet);
        handleTunnelPacket(activeGeneration, StreamPath.DIRECT, packet);
    }

    private void handleRelayEnvelope(long activeGeneration, byte[] envelope) {
        if (envelope.length <= 8 || envelope.length > 8 + RelayTunnelCodec.MAX_PACKET) {
            fail(activeGeneration, new IOException("Invalid WSS relay envelope size"));
            return;
        }
        for (int index = 0; index < 8; index++) {
            if (envelope[index] != 0) { fail(activeGeneration, new IOException("Invalid WSS relay sender")); return; }
        }
        handleTunnelPacket(activeGeneration, StreamPath.RELAY, Arrays.copyOfRange(envelope, 8, envelope.length));
    }

    private void handleTunnelPacket(long activeGeneration, StreamPath path, byte[] packet) {
        try {
            if (!isBoundedTunnelPacketSize(packet.length)) throw new IOException("P2P/WSS frame size is invalid");
            RelayTunnelCodec.Frame frame;
            if (packet[0] == RelayTunnelCodec.NATIVE_P2P_VERSION && sessionReady && sessionCodec != null) frame = sessionCodec.decode(packet);
            else if (packet[0] == RelayTunnelCodec.VERSION && path == StreamPath.RELAY && !sessionReady) frame = roomCodec.decode(packet);
            else throw new IOException("P2P/WSS packet session or path was rejected");
            StreamRecord record = streams.get(frame.streamId);
            if (record == null) {
                if (frame.type != RelayTunnelCodec.RESET) sendUnboundFrame(path, RelayTunnelCodec.RESET, frame.streamId);
                return;
            }
            if (!record.accepts(path)) {
                streams.remove(frame.streamId, record);
                closeQuietly(record.socket);
                return;
            }
            Socket client = record.socket;
            if (frame.type == RelayTunnelCodec.DATA) {
                synchronized (client) { client.getOutputStream().write(frame.payload); client.getOutputStream().flush(); }
            } else if (frame.type == RelayTunnelCodec.FIN || frame.type == RelayTunnelCodec.RESET) {
                streams.remove(frame.streamId, record);
                closeQuietly(client);
            } else if (frame.type == RelayTunnelCodec.PING) sendFrame(record, RelayTunnelCodec.PONG, frame.streamId, new byte[0]);
        } catch (Exception error) {
            if (path == StreamPath.DIRECT) disableDirect(activeGeneration, error.getMessage());
            else fail(activeGeneration, error);
        }
    }

    private void sendUnboundFrame(StreamPath path, int type, long streamId) throws Exception {
        byte[] packet = encodePacket(type, streamId, new byte[0]);
        sendPacket(path, packet, null);
    }

    private void sendFrame(StreamRecord record, int type, long streamId, byte[] payload) throws Exception {
        if (record == null || !streams.containsKey(streamId)) throw new IOException("P2P/WSS stream is closed");
        byte[] packet = encodePacket(type, streamId, payload);
        sendPacket(record.path, packet, record);
    }

    private byte[] encodePacket(int type, long streamId, byte[] payload) throws Exception {
        RelayTunnelCodec.NativeP2pSessionCodec session = sessionCodec;
        if (!sessionReady) return roomCodec.encode(type, streamId, payload);
        if (session == null) throw new IOException("Native P2P v2 session is not established");
        return session.encode(type, streamId, payload);
    }

    private void sendPacket(StreamPath path, byte[] packet, StreamRecord record) throws Exception {
        if (path == StreamPath.DIRECT) {
            DataChannel direct = dataChannel;
            if (!directUsable || direct == null || direct.state() != DataChannel.State.OPEN
                || direct.bufferedAmount() + packet.length > MAX_BUFFERED_BYTES
                || !direct.send(new DataChannel.Buffer(ByteBuffer.wrap(packet), true))) {
                disableDirect(generation, "P2P 直连拥塞或已关闭，现有直连流已关闭，新连接使用 WSS/443");
                throw new IOException("P2P direct path is unavailable; stream was not rebound");
            }
            return;
        }
        WebSocket relay = socket;
        if (relay == null || relay.queueSize() + packet.length + 8 > MAX_BUFFERED_BYTES) {
            if (record != null) closeQuietly(record.socket);
            throw new IOException("P2P/WSS backpressure limit exceeded");
        }
        byte[] envelope = ByteBuffer.allocate(8 + packet.length).putLong(0).put(packet).array();
        if (!relay.send(ByteString.of(envelope))) {
            if (record != null) closeQuietly(record.socket);
            throw new IOException("P2P/WSS relay is disconnected");
        }
    }

    private synchronized void fail(long activeGeneration, Throwable error) {
        if (generation != activeGeneration || stopping) return;
        Listener active = listener;
        String message = error.getMessage() == null ? "Native P2P/WSS failed" : error.getMessage();
        stopTransport();
        if (active != null) active.onFailure(message);
    }

    synchronized void stop() { ++generation; stopTransport(); }

    private void stopTransport() {
        stopping = true;
        listener = null;
        if (socket != null) socket.close(1000, "mobile p2p stopping");
        socket = null;
        if (socksServer != null) try { socksServer.close(); } catch (IOException ignored) {}
        socksServer = null;
        for (StreamRecord stream : streams.values()) closeQuietly(stream.socket);
        streams.clear();
        if (dataChannel != null) { dataChannel.close(); dataChannel.dispose(); }
        dataChannel = null;
        if (peerConnection != null) { peerConnection.close(); peerConnection.dispose(); }
        peerConnection = null;
        roomCodec = null;
        sessionCodec = null;
        config = null;
        directReported = false;
        directFailureReported = false;
        directUsable = false;
        sessionReady = false;
        relaySupportsSignaling = false;
        signalingV2 = false;
        peerId = null;
        desktopNonce = null;
        mobileNonce = null;
        sessionId = null;
    }

    private static void closeQuietly(Socket socket) { if (socket != null) try { socket.close(); } catch (IOException ignored) {} }

    private static byte[] readExactly(InputStream input, int length) throws IOException {
        byte[] value = new byte[length];
        int offset = 0;
        while (offset < length) {
            int count = input.read(value, offset, length - offset);
            if (count < 0) throw new EOFException();
            offset += count;
        }
        return value;
    }

    @Override public synchronized void close() {
        stop();
        if (factory != null) factory.dispose();
        factory = null;
        acceptor.shutdownNow();
        workers.shutdownNow();
        timer.shutdownNow();
        httpClient.dispatcher().executorService().shutdown();
        httpClient.connectionPool().evictAll();
    }

    private abstract static class SimpleSdpObserver implements SdpObserver {
        @Override public void onCreateSuccess(SessionDescription description) {}
        @Override public void onSetSuccess() {}
        @Override public void onCreateFailure(String error) {}
        @Override public void onSetFailure(String error) {}
    }
}
