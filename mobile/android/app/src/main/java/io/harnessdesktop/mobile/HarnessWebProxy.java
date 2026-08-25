package io.harnessdesktop.mobile;

import android.content.Context;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicReference;

final class HarnessWebProxy implements AutoCloseable {
    private static final int MAX_HEADER_BYTES = 64 * 1024;
    private static final int LAN_CONNECT_TIMEOUT_MS = 800;
    private static final int REMOTE_CONNECT_TIMEOUT_MS = 2_200;
    private static final long LAN_RETRY_DELAY_MS = 12_000;
    private static final long REMOTE_RETRY_DELAY_MS = 15_000;

    private static final int MAX_ACTIVE_CONNECTIONS = 24;

    private final ExecutorService acceptExecutor = Executors.newSingleThreadExecutor();
    private final ExecutorService connectionExecutor = Executors.newFixedThreadPool(MAX_ACTIVE_CONNECTIONS);
    private final ExecutorService pipeExecutor = Executors.newFixedThreadPool(MAX_ACTIVE_CONNECTIONS);
    private final ConnectivityManager connectivityManager;
    private final Map<String, Long> retryAfter = new ConcurrentHashMap<>();
    private final AtomicReference<RoutePreference> lastGoodRoute = new AtomicReference<>();
    private volatile List<PairingProfile.Route> routes = Collections.emptyList();
    private volatile boolean closed;
    private ServerSocket server;

    private record RoutePreference(String key) {}

    HarnessWebProxy(Context context) {
        connectivityManager = context.getSystemService(ConnectivityManager.class);
    }

    synchronized int start(int preferredPort) throws IOException {
        if (server != null) return server.getLocalPort();
        try {
            server = new ServerSocket(preferredPort, 16, InetAddress.getByName("127.0.0.1"));
        } catch (IOException error) {
            server = new ServerSocket(0, 16, InetAddress.getByName("127.0.0.1"));
        }
        acceptExecutor.execute(this::acceptLoop);
        return server.getLocalPort();
    }

    void updateRoutes(List<PairingProfile.Route> values) {
        routes = values == null
            ? Collections.emptyList()
            : Collections.unmodifiableList(new ArrayList<>(values));
        List<String> routeKeys = routes.stream().map(PairingProfile.Route::key).collect(Collectors.toList());
        retryAfter.keySet().retainAll(routeKeys);
        RoutePreference preferred = lastGoodRoute.get();
        if (preferred != null && !routeKeys.contains(preferred.key())) lastGoodRoute.compareAndSet(preferred, null);
    }

    private void acceptLoop() {
        while (!closed) {
            try {
                Socket client = server.accept();
                client.setTcpNoDelay(true);
                connectionExecutor.execute(() -> handle(client));
            } catch (IOException error) {
                if (!closed) error.printStackTrace();
            }
        }
    }

    private void handle(Socket client) {
        try (client) {
            InputStream clientInput = client.getInputStream();
            OutputStream clientOutput = client.getOutputStream();
            byte[] header = readHeader(clientInput);
            if (header.length == 0) return;
            Socket upstream = connectRoute();
            if (upstream == null) {
                sendUnavailable(clientOutput);
                return;
            }
            try (upstream) {
                upstream.setTcpNoDelay(true);
                if (isConnectRequest(header)) {
                    clientOutput.write("HTTP/1.1 200 Connection Established\r\nProxy-Agent: HarnessMobile\r\n\r\n".getBytes(StandardCharsets.ISO_8859_1));
                    clientOutput.flush();
                    pipeExecutor.execute(() -> copy(client, upstream));
                    copy(upstream, client);
                    return;
                }

                boolean webSocketUpgrade = isWebSocketUpgrade(header);
                boolean eventStreamRequest = isEventStreamRequest(header);
                OutputStream upstreamOutput = upstream.getOutputStream();
                upstreamOutput.write(rewriteRequest(header, webSocketUpgrade || eventStreamRequest));
                forwardRequestBody(header, clientInput, upstreamOutput);
                upstreamOutput.flush();

                if (webSocketUpgrade) {
                    pipeExecutor.execute(() -> copy(client, upstream));
                    copy(upstream, client);
                } else {
                    forwardSingleHttpResponse(upstream.getInputStream(), clientOutput, requestMethod(header), eventStreamRequest);
                }
            }
        } catch (IOException ignored) {
        }
    }

    private Socket connectRoute() {
        long now = System.currentTimeMillis();
        RoutePreference preferred = lastGoodRoute.get();
        List<PairingProfile.Route> candidates = prioritizeRoutes(routes, retryAfter, preferred == null ? null : preferred.key(), now);
        boolean hasReadyRoute = candidates.stream().anyMatch(route -> retryAfter.getOrDefault(route.key(), 0L) <= now);
        for (PairingProfile.Route route : candidates) {
            if (hasReadyRoute && retryAfter.getOrDefault(route.key(), 0L) > now) continue;
            try {
                Socket socket = connect(route);
                retryAfter.remove(route.key());
                lastGoodRoute.set(new RoutePreference(route.key()));
                return socket;
            } catch (IOException error) {
                if (preferred != null && route.key().equals(preferred.key())) lastGoodRoute.compareAndSet(preferred, null);
                retryAfter.put(route.key(), now + ("lan".equals(route.id) ? LAN_RETRY_DELAY_MS : REMOTE_RETRY_DELAY_MS));
            }
        }
        return null;
    }

    static List<PairingProfile.Route> prioritizeRoutes(
        List<PairingProfile.Route> values,
        Map<String, Long> retryAfter,
        String lastGoodRouteKey,
        long now
    ) {
        List<PairingProfile.Route> candidates = new ArrayList<>(values == null ? Collections.emptyList() : values);
        candidates.sort(
            Comparator.<PairingProfile.Route>comparingInt(route -> retryAfter.getOrDefault(route.key(), 0L) <= now ? 0 : 1)
                .thenComparingInt(route -> route.key().equals(lastGoodRouteKey) ? 0 : 1)
                .thenComparingLong(route -> retryAfter.getOrDefault(route.key(), 0L))
        );
        return candidates;
    }

    private Socket connect(PairingProfile.Route route) throws IOException {
        if (route.usesSocks5()) return connectThroughSocks5(route);
        Socket socket = createDirectSocket(route);
        try {
            socket.connect(new InetSocketAddress(route.host, route.port), "lan".equals(route.id) ? LAN_CONNECT_TIMEOUT_MS : REMOTE_CONNECT_TIMEOUT_MS);
            return socket;
        } catch (IOException error) {
            try { socket.close(); } catch (IOException ignored) {}
            throw error;
        }
    }

    private Socket createDirectSocket(PairingProfile.Route route) {
        if ("lan".equals(route.id) && connectivityManager != null) {
            for (Network network : connectivityManager.getAllNetworks()) {
                NetworkCapabilities capabilities = connectivityManager.getNetworkCapabilities(network);
                if (capabilities == null || capabilities.hasTransport(NetworkCapabilities.TRANSPORT_VPN)) continue;
                if (!capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) && !capabilities.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)) continue;
                try { return network.getSocketFactory().createSocket(); }
                catch (IOException ignored) {}
            }
        }
        return new Socket();
    }

    static Socket connectThroughSocks5(PairingProfile.Route route) throws IOException {
        Socket socket = new Socket();
        try {
            socket.connect(new InetSocketAddress(route.proxyHost, route.proxyPort), 1200);
            socket.setSoTimeout(REMOTE_CONNECT_TIMEOUT_MS);
            InputStream input = socket.getInputStream();
            OutputStream output = socket.getOutputStream();
            output.write(new byte[]{5, 1, 0});
            output.flush();
            byte[] greeting = readExactly(input, 2);
            if (greeting[0] != 5 || greeting[1] != 0) throw new IOException("SOCKS5 authentication rejected");

            byte[] address = InetAddress.getByName(route.host).getAddress();
            if (address.length != 4) throw new IOException("EasyTier route requires IPv4");
            ByteArrayOutputStream request = new ByteArrayOutputStream(10);
            request.write(new byte[]{5, 1, 0, 1});
            request.write(address);
            request.write((route.port >>> 8) & 0xff);
            request.write(route.port & 0xff);
            output.write(request.toByteArray());
            output.flush();

            byte[] response = readExactly(input, 4);
            if (response[0] != 5 || response[1] != 0) throw new IOException("EasyTier SOCKS5 connection failed: " + (response[1] & 0xff));
            int addressLength;
            if (response[3] == 1) addressLength = 4;
            else if (response[3] == 4) addressLength = 16;
            else if (response[3] == 3) addressLength = readExactly(input, 1)[0] & 0xff;
            else throw new IOException("Invalid SOCKS5 address type");
            readExactly(input, addressLength + 2);
            socket.setSoTimeout(0);
            return socket;
        } catch (IOException error) {
            try { socket.close(); } catch (IOException ignored) {}
            throw error;
        }
    }

    private static byte[] readExactly(InputStream input, int length) throws IOException {
        byte[] output = new byte[length];
        int offset = 0;
        while (offset < length) {
            int count = input.read(output, offset, length - offset);
            if (count < 0) throw new IOException("Unexpected end of SOCKS5 response");
            offset += count;
        }
        return output;
    }

    private static byte[] readHeader(InputStream input) throws IOException {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        int matched = 0;
        while (output.size() < MAX_HEADER_BYTES) {
            int value = input.read();
            if (value < 0) break;
            output.write(value);
            matched = value == new int[]{13, 10, 13, 10}[matched] ? matched + 1 : value == 13 ? 1 : 0;
            if (matched == 4) break;
        }
        return output.toByteArray();
    }

    private static byte[] rewriteRequest(byte[] input, boolean preserveConnection) {
        String header = new String(input, StandardCharsets.ISO_8859_1);
        String[] lines = header.split("\r\n", -1);
        if (lines.length < 2) return input;

        String requestLine = lines[0];
        String[] parts = requestLine.split(" ", 3);
        if (parts.length == 3 && (parts[1].startsWith("http://") || parts[1].startsWith("ws://"))) {
            try {
                java.net.URI uri = java.net.URI.create(parts[1]);
                String path = uri.getRawPath();
                if (path == null || path.isEmpty()) path = "/";
                if (uri.getRawQuery() != null) path += "?" + uri.getRawQuery();
                requestLine = parts[0] + " " + path + " " + parts[2];
            } catch (RuntimeException ignored) {
            }
        }

        StringBuilder rewritten = new StringBuilder(header.length() + 24).append(requestLine).append("\r\n");
        for (int index = 1; index < lines.length; index++) {
            String line = lines[index];
            if (line.isEmpty()) continue;
            int separator = line.indexOf(':');
            String name = separator < 0 ? "" : line.substring(0, separator).trim();
            if (!preserveConnection && ("connection".equalsIgnoreCase(name) || "proxy-connection".equalsIgnoreCase(name))) continue;
            rewritten.append(line).append("\r\n");
        }
        if (!preserveConnection) rewritten.append("Connection: close\r\n");
        rewritten.append("\r\n");
        return rewritten.toString().getBytes(StandardCharsets.ISO_8859_1);
    }

    private static void forwardRequestBody(byte[] header, InputStream input, OutputStream output) throws IOException {
        long contentLength = contentLength(header);
        if (contentLength > 0) copyExactly(input, output, contentLength);
        else if (hasHeaderToken(header, "transfer-encoding", "chunked")) copyChunked(input, output);
    }

    private static void forwardSingleHttpResponse(InputStream input, OutputStream output, String method, boolean streamRequested) throws IOException {
        while (true) {
            byte[] responseHeader = readHeader(input);
            if (responseHeader.length == 0) throw new IOException("Upstream closed before response headers");
            int status = responseStatus(responseHeader);
            boolean informational = status >= 100 && status < 200 && status != 101;
            boolean eventStream = streamRequested || hasHeaderToken(responseHeader, "content-type", "text/event-stream");

            output.write(rewriteResponse(responseHeader, eventStream));
            output.flush();
            if (informational) continue;
            if ("HEAD".equals(method) || status == 101 || status == 204 || status == 304) return;
            if (eventStream || status == 101) {
                copy(input, output);
                return;
            }

            long contentLength = contentLength(responseHeader);
            if (contentLength >= 0) copyExactly(input, output, contentLength);
            else if (hasHeaderToken(responseHeader, "transfer-encoding", "chunked")) copyChunked(input, output);
            else copy(input, output);
            output.flush();
            return;
        }
    }

    private static byte[] rewriteResponse(byte[] input, boolean preserveConnection) {
        if (preserveConnection) return input;
        String header = new String(input, StandardCharsets.ISO_8859_1);
        String[] lines = header.split("\r\n", -1);
        if (lines.length == 0) return input;
        StringBuilder rewritten = new StringBuilder(header.length() + 24).append(lines[0]).append("\r\n");
        for (int index = 1; index < lines.length; index++) {
            String line = lines[index];
            if (line.isEmpty()) continue;
            int separator = line.indexOf(':');
            String name = separator < 0 ? "" : line.substring(0, separator).trim();
            if ("connection".equalsIgnoreCase(name) || "proxy-connection".equalsIgnoreCase(name)
                || "keep-alive".equalsIgnoreCase(name)) continue;
            rewritten.append(line).append("\r\n");
        }
        rewritten.append("Connection: close\r\n\r\n");
        return rewritten.toString().getBytes(StandardCharsets.ISO_8859_1);
    }

    private static void copyExactly(InputStream input, OutputStream output, long length) throws IOException {
        byte[] buffer = new byte[16 * 1024];
        long remaining = length;
        while (remaining > 0) {
            int count = input.read(buffer, 0, (int) Math.min(buffer.length, remaining));
            if (count < 0) throw new IOException("Unexpected end of HTTP body");
            output.write(buffer, 0, count);
            remaining -= count;
        }
    }

    private static void copyChunked(InputStream input, OutputStream output) throws IOException {
        while (true) {
            byte[] sizeLine = readLine(input);
            output.write(sizeLine);
            String value = new String(sizeLine, StandardCharsets.ISO_8859_1).trim();
            int extension = value.indexOf(';');
            if (extension >= 0) value = value.substring(0, extension).trim();
            long size;
            try { size = Long.parseLong(value, 16); }
            catch (NumberFormatException error) { throw new IOException("Invalid chunk size", error); }
            if (size > 0) {
                copyExactly(input, output, size);
                copyExactly(input, output, 2);
                continue;
            }
            while (true) {
                byte[] trailer = readLine(input);
                output.write(trailer);
                if (trailer.length == 2) return;
            }
        }
    }

    private static byte[] readLine(InputStream input) throws IOException {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        int previous = -1;
        while (output.size() < MAX_HEADER_BYTES) {
            int value = input.read();
            if (value < 0) throw new IOException("Unexpected end of HTTP line");
            output.write(value);
            if (previous == '\r' && value == '\n') return output.toByteArray();
            previous = value;
        }
        throw new IOException("HTTP line is too large");
    }

    private static long contentLength(byte[] header) {
        String value = headerValue(header, "content-length");
        if (value == null || value.trim().isEmpty()) return -1;
        try { return Long.parseLong(value.trim()); }
        catch (NumberFormatException ignored) { return -1; }
    }

    private static String headerValue(byte[] header, String expectedName) {
        String[] lines = new String(header, StandardCharsets.ISO_8859_1).split("\r\n");
        for (int index = 1; index < lines.length; index++) {
            int separator = lines[index].indexOf(':');
            if (separator < 0 || !expectedName.equalsIgnoreCase(lines[index].substring(0, separator).trim())) continue;
            return lines[index].substring(separator + 1).trim();
        }
        return null;
    }

    private static boolean hasHeaderToken(byte[] header, String name, String token) {
        String value = headerValue(header, name);
        return value != null && value.toLowerCase(java.util.Locale.ROOT).contains(token.toLowerCase(java.util.Locale.ROOT));
    }

    private static boolean isWebSocketUpgrade(byte[] header) {
        return hasHeaderToken(header, "upgrade", "websocket");
    }

    private static boolean isEventStreamRequest(byte[] header) {
        return hasHeaderToken(header, "accept", "text/event-stream");
    }

    private static String requestMethod(byte[] header) {
        String firstLine = new String(header, StandardCharsets.ISO_8859_1).split("\r\n", 2)[0];
        int separator = firstLine.indexOf(' ');
        return separator < 0 ? "" : firstLine.substring(0, separator).toUpperCase(java.util.Locale.ROOT);
    }

    private static int responseStatus(byte[] header) {
        String firstLine = new String(header, StandardCharsets.ISO_8859_1).split("\r\n", 2)[0];
        String[] parts = firstLine.split(" ", 3);
        if (parts.length < 2) return 0;
        try { return Integer.parseInt(parts[1]); }
        catch (NumberFormatException ignored) { return 0; }
    }

    private static boolean isConnectRequest(byte[] input) {
        int length = Math.min(input.length, 16);
        return new String(input, 0, length, StandardCharsets.ISO_8859_1).startsWith("CONNECT ");
    }

    private static void copy(Socket from, Socket to) {
        try {
            InputStream input = from.getInputStream();
            OutputStream output = to.getOutputStream();
            byte[] buffer = new byte[16 * 1024];
            int count;
            while ((count = input.read(buffer)) >= 0) {
                output.write(buffer, 0, count);
                output.flush();
            }
        } catch (IOException ignored) {
        } finally {
            try { to.shutdownOutput(); } catch (IOException ignored) {}
        }
    }

    private static void copy(InputStream input, OutputStream output) {
        try {
            byte[] buffer = new byte[16 * 1024];
            int count;
            while ((count = input.read(buffer)) >= 0) {
                output.write(buffer, 0, count);
                output.flush();
            }
        } catch (IOException ignored) {
        }
    }

    private static void sendUnavailable(OutputStream output) throws IOException {
        byte[] body = ("<!doctype html><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'>" +
            "<style>body{font:16px system-ui;padding:32px;color:#173c3a;background:#f5f8f7}</style>" +
            "<h2>正在寻找电脑</h2><p>请确认电脑端同步开关已开启。Harness Mobile 会自动尝试局域网和备用线路。</p>")
            .getBytes(StandardCharsets.UTF_8);
        String header = "HTTP/1.1 503 Service Unavailable\r\nContent-Type: text/html; charset=utf-8\r\nCache-Control: no-store\r\nContent-Length: " + body.length + "\r\nConnection: close\r\n\r\n";
        output.write(header.getBytes(StandardCharsets.ISO_8859_1));
        output.write(body);
        output.flush();
    }

    @Override public synchronized void close() {
        closed = true;
        try { if (server != null) server.close(); } catch (IOException ignored) {}
        server = null;
        acceptExecutor.shutdownNow();
        connectionExecutor.shutdownNow();
        pipeExecutor.shutdownNow();
    }
}
