package io.harnessdesktop.mobile;

import org.json.JSONObject;
import java.io.EOFException;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.ByteBuffer;
import java.security.GeneralSecurityException;
import java.util.Arrays;
import java.util.Map;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executor;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ThreadFactory;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicLong;
import java.util.function.Consumer;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.WebSocket;
import okhttp3.WebSocketListener;
import okio.ByteString;

final class WssRelayClient {
    interface Listener {
        void onReady(int socksPort);
        void onFailure(String message);
    }

    private static final long MAX_WEBSOCKET_QUEUE = 4L * 1024 * 1024;
    private static final int MAX_SOCKS_WORKERS = 8;
    private static final int MAX_PENDING_SOCKS = 16;
    private final OkHttpClient httpClient;
    private final ExecutorService acceptor;
    private final ExecutorService workers;
    private final Map<Long, Socket> streams = new ConcurrentHashMap<>();
    private final AtomicLong streamSequence = new AtomicLong(1);
    private volatile WebSocket webSocket;
    private volatile ServerSocket socksServer;
    private volatile RelayTunnelCodec codec;
    private volatile Listener listener;
    private volatile boolean stopping;

    WssRelayClient() {
        acceptor = Executors.newSingleThreadExecutor(daemonThreadFactory("harness-wss-relay-accept"));
        workers = newSocksWorkerPool();
        httpClient = new OkHttpClient.Builder()
            .retryOnConnectionFailure(true)
            .connectTimeout(15, TimeUnit.SECONDS)
            // OkHttp closes the socket when a pong is not received in the next
            // interval, turning silent half-open mobile links into a retry.
            .pingInterval(20, TimeUnit.SECONDS)
            .build();
    }

    static ThreadPoolExecutor newSocksWorkerPool() {
        return new ThreadPoolExecutor(
            MAX_SOCKS_WORKERS,
            MAX_SOCKS_WORKERS,
            0L,
            TimeUnit.MILLISECONDS,
            new ArrayBlockingQueue<>(MAX_PENDING_SOCKS),
            daemonThreadFactory("harness-wss-relay-worker"),
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

    synchronized void start(PairingProfile.RelayConfig config, Listener listener) {
        stop();
        stopping = false;
        this.listener = listener;
        try { codec = new RelayTunnelCodec(config.tunnelKey); }
        catch (RuntimeException error) { listener.onFailure(error.getMessage()); return; }
        Request request = new Request.Builder().url(config.relayUrl).build();
        webSocket = httpClient.newWebSocket(request, new WebSocketListener() {
            @Override public void onOpen(WebSocket socket, Response response) {
                JSONObject hello = new JSONObject();
                try {
                    hello.put("type", "hello"); hello.put("version", 1); hello.put("role", "mobile"); hello.put("roomId", config.roomId);
                    socket.send(hello.toString());
                } catch (Exception error) { fail(error); }
            }
            @Override public void onMessage(WebSocket socket, String text) {
                try {
                    JSONObject message = new JSONObject(text);
                    if ("welcome".equals(message.optString("type")) && "mobile".equals(message.optString("role"))) {
                        if (!message.optBoolean("desktopOnline", false)) fail(new IOException("Desktop WSS relay is offline"));
                        else openSocksServer();
                    } else if ("desktop-offline".equals(message.optString("type"))) fail(new IOException("Desktop WSS relay is offline"));
                } catch (Exception error) { fail(error); }
            }
            @Override public void onMessage(WebSocket socket, ByteString bytes) { handleEnvelope(bytes.toByteArray()); }
            @Override public void onFailure(WebSocket socket, Throwable error, Response response) { fail(error); }
            @Override public void onClosed(WebSocket socket, int code, String reason) { if (!stopping) fail(new IOException("WSS relay closed: " + reason)); }
        });
    }

    private synchronized void openSocksServer() throws IOException {
        if (socksServer != null) return;
        ServerSocket server = new ServerSocket(0, 16, InetAddress.getByName("127.0.0.1"));
        socksServer = server;
        acceptor.execute(() -> acceptLoop(server, workers, this::handleSocks, this::fail));
        Listener active = listener;
        if (active != null) active.onReady(server.getLocalPort());
    }

    static void acceptLoop(
        ServerSocket server,
        Executor workers,
        Consumer<Socket> handler,
        Consumer<Throwable> failure
    ) {
        while (!server.isClosed()) {
            Socket socket = null;
            try {
                // Accept on this single loop before dispatching. Moving accept()
                // inside the worker Runnable creates unbounded blocking tasks.
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

    private static void closeQuietly(Socket socket) {
        if (socket != null) try { socket.close(); } catch (IOException ignored) {}
    }

    private void handleSocks(Socket socket) {
        long streamId = -1;
        try {
            socket.setSoTimeout(10_000);
            InputStream input = socket.getInputStream();
            OutputStream output = socket.getOutputStream();
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
            streams.put(streamId, socket);
            send(RelayTunnelCodec.OPEN, streamId, new byte[0]);
            output.write(new byte[]{5, 0, 0, 1, 127, 0, 0, 1, 0, 0}); output.flush();
            socket.setSoTimeout(0);
            byte[] buffer = new byte[RelayTunnelCodec.MAX_PAYLOAD];
            int count;
            while ((count = input.read(buffer)) >= 0) {
                if (count > 0) send(RelayTunnelCodec.DATA, streamId, Arrays.copyOf(buffer, count));
            }
            send(RelayTunnelCodec.FIN, streamId, new byte[0]);
        } catch (Exception error) {
            if (streamId >= 0) try { send(RelayTunnelCodec.RESET, streamId, new byte[0]); } catch (Exception ignored) {}
        } finally {
            if (streamId >= 0) streams.remove(streamId);
            try { socket.close(); } catch (IOException ignored) {}
        }
    }

    private long nextStreamId() {
        for (;;) {
            long value = streamSequence.getAndUpdate(previous -> previous >= 0xfffffffdL ? 1 : previous + 2);
            if (!streams.containsKey(value)) return value;
        }
    }

    private void handleEnvelope(byte[] envelope) {
        if (envelope.length <= 8) { fail(new IOException("Truncated WSS relay envelope")); return; }
        for (int index = 0; index < 8; index++) if (envelope[index] != 0) { fail(new IOException("Invalid WSS relay sender")); return; }
        try {
            RelayTunnelCodec.Frame frame = codec.decode(Arrays.copyOfRange(envelope, 8, envelope.length));
            Socket socket = streams.get(frame.streamId);
            if (socket == null) { if (frame.type != RelayTunnelCodec.RESET) send(RelayTunnelCodec.RESET, frame.streamId, new byte[0]); return; }
            if (frame.type == RelayTunnelCodec.DATA) {
                synchronized (socket) { socket.getOutputStream().write(frame.payload); socket.getOutputStream().flush(); }
            } else if (frame.type == RelayTunnelCodec.FIN || frame.type == RelayTunnelCodec.RESET) {
                streams.remove(frame.streamId); socket.close();
            } else if (frame.type == RelayTunnelCodec.PING) send(RelayTunnelCodec.PONG, frame.streamId, new byte[0]);
        } catch (Exception error) { fail(error); }
    }

    private void send(int type, long streamId, byte[] payload) throws GeneralSecurityException, IOException {
        WebSocket socket = webSocket;
        if (socket == null || socket.queueSize() > MAX_WEBSOCKET_QUEUE) throw new IOException("WSS relay backpressure limit exceeded");
        byte[] packet = codec.encode(type, streamId, payload);
        byte[] envelope = ByteBuffer.allocate(8 + packet.length).putLong(0).put(packet).array();
        if (!socket.send(ByteString.of(envelope))) throw new IOException("WSS relay is disconnected");
    }

    private synchronized void fail(Throwable error) {
        if (stopping) return;
        Listener active = listener;
        stop();
        if (active != null) active.onFailure(error.getMessage() == null ? "WSS relay failed" : error.getMessage());
    }

    synchronized void stop() {
        stopping = true;
        listener = null;
        if (webSocket != null) webSocket.close(1000, "mobile stopping");
        webSocket = null;
        if (socksServer != null) try { socksServer.close(); } catch (IOException ignored) {}
        socksServer = null;
        for (Socket socket : streams.values()) try { socket.close(); } catch (IOException ignored) {}
        streams.clear();
        codec = null;
    }

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
}
