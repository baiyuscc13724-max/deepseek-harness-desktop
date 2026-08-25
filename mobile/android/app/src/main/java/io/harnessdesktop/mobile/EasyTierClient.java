package io.harnessdesktop.mobile;

import com.easytier.jni.EasyTierJNI;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicLong;
import android.util.Log;
import org.json.JSONArray;
import org.json.JSONObject;

final class EasyTierClient implements AutoCloseable {
    private static final String TAG = "HarnessMobile";
    interface Listener {
        void onReady(int socksPort);
        void onError(String message);
    }

    private static final String INSTANCE_NAME = "harness_mobile";
    private static final int START_TIMEOUT_MS = 75_000;
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final AtomicLong generation = new AtomicLong();
    private volatile boolean running;
    private volatile int socksPort;

    boolean isRunning() {
        return running;
    }

    int socksPort() {
        return socksPort;
    }

    void start(PairingProfile profile, Listener listener) {
        long token = generation.incrementAndGet();
        stopNative();
        if (profile == null || profile.easyTier == null) return;
        executor.execute(() -> startInternal(token, profile, listener));
    }

    private void startInternal(long token, PairingProfile profile, Listener listener) {
        try {
            PairingProfile.EasyTierConfig settings = profile.easyTier;
            int port = findFreeLoopbackPort();
            String config = buildConfig(settings, port);
            debug("EasyTier starting on local SOCKS port " + port);
            if (EasyTierJNI.parseConfig(config) != 0) throw new IOException(lastError("EasyTier 配置无效"));
            if (EasyTierJNI.runNetworkInstance(config) != 0) throw new IOException(lastError("EasyTier 启动失败"));
            long deadline = System.currentTimeMillis() + START_TIMEOUT_MS;
            while (generation.get() == token && System.currentTimeMillis() < deadline) {
                if (canConnect(port) && remoteRouteReady(settings) && remoteServiceHealthy(profile, port)) {
                    socksPort = port;
                    running = true;
                    debug("EasyTier local SOCKS ready on " + port);
                    listener.onReady(port);
                    return;
                }
                Thread.sleep(450);
            }
            throw new IOException("EasyTier 本地通道启动超时");
        } catch (Throwable error) {
            if (generation.get() != token) return;
            stopNative();
            debug("EasyTier failed: " + cleanMessage(error));
            listener.onError(cleanMessage(error));
        }
    }

    private static String buildConfig(PairingProfile.EasyTierConfig settings, int port) {
        return "instance_name = \"" + settings.networkName + "\"\n" +
            "hostname = \"Harness-Mobile\"\n" +
            "dhcp = true\n" +
            "listeners = [\"tcp://0.0.0.0:0\", \"udp://0.0.0.0:0\"]\n" +
            "socks5_proxy = \"socks5://127.0.0.1:" + port + "\"\n\n" +
            "[network_identity]\n" +
            "network_name = \"" + settings.networkName + "\"\n" +
            "network_secret = \"" + settings.networkSecret + "\"\n\n" +
            "[[peer]]\n" +
            "uri = \"" + settings.peer + "\"\n\n" +
            "[console_logger]\nlevel = \"warn\"\n\n" +
            "[flags]\n" +
            "no_tun = true\n" +
            "use_smoltcp = true\n" +
            "bind_device = false\n" +
            "enable_encryption = true\n" +
            "latency_first = true\n" +
            "enable_ipv6 = false\n";
    }

    private static int findFreeLoopbackPort() throws IOException {
        try (ServerSocket socket = new ServerSocket(0, 1, InetAddress.getByName("127.0.0.1"))) {
            return socket.getLocalPort();
        }
    }

    private static boolean canConnect(int port) {
        try (Socket socket = new Socket()) {
            socket.connect(new InetSocketAddress("127.0.0.1", port), 300);
            return true;
        } catch (IOException error) {
            return false;
        }
    }

    private static boolean remoteRouteReady(PairingProfile.EasyTierConfig settings) {
        try {
            String infos = EasyTierJNI.collectNetworkInfos(100);
            return hasRemoteServiceRoute(infos, settings.serviceAddress);
        } catch (Throwable error) {
            return false;
        }
    }

    private static boolean remoteServiceHealthy(PairingProfile profile, int socksPort) {
        PairingProfile.Route remote = null;
        for (PairingProfile.Route route : profile.routesWithEasyTierProxy(socksPort)) {
            if ("easytier".equals(route.id)) {
                remote = route;
                break;
            }
        }
        if (remote == null) return false;
        try (Socket socket = HarnessWebProxy.connectThroughSocks5(remote)) {
            socket.setSoTimeout(3000);
            OutputStream output = socket.getOutputStream();
            String request = "GET /__harness_mobile__/health HTTP/1.1\r\n" +
                "Host: " + remote.host + ":" + remote.port + "\r\n" +
                "Connection: close\r\n\r\n";
            output.write(request.getBytes(java.nio.charset.StandardCharsets.ISO_8859_1));
            output.flush();
            String status = readStatusLine(socket.getInputStream());
            return status.startsWith("HTTP/1.1 200") || status.startsWith("HTTP/1.0 200");
        } catch (IOException error) {
            return false;
        }
    }

    private static String readStatusLine(InputStream input) throws IOException {
        StringBuilder line = new StringBuilder(64);
        while (line.length() < 256) {
            int value = input.read();
            if (value < 0 || value == '\n') break;
            if (value != '\r') line.append((char) value);
        }
        return line.toString();
    }

    static boolean hasRemoteServiceRoute(String infos, String serviceAddress) {
        try {
            if (infos == null || infos.trim().isEmpty() || serviceAddress == null || serviceAddress.trim().isEmpty()) return false;
            JSONObject instances = new JSONObject(infos).optJSONObject("map");
            if (instances == null) return false;
            String expectedCidr = serviceAddress + "/32";
            for (java.util.Iterator<String> keys = instances.keys(); keys.hasNext();) {
                JSONObject instance = instances.optJSONObject(keys.next());
                if (instance == null || !instance.optBoolean("running", false)) continue;
                JSONArray routes = instance.optJSONArray("routes");
                if (routes == null) continue;
                for (int routeIndex = 0; routeIndex < routes.length(); routeIndex++) {
                    JSONObject route = routes.optJSONObject(routeIndex);
                    JSONArray cidrs = route == null ? null : route.optJSONArray("proxy_cidrs");
                    if (cidrs == null) continue;
                    for (int cidrIndex = 0; cidrIndex < cidrs.length(); cidrIndex++) {
                        String cidr = cidrs.optString(cidrIndex, "");
                        if (expectedCidr.equals(cidr) || serviceAddress.equals(cidr)) return true;
                    }
                }
            }
            return false;
        } catch (Throwable ignored) {
            return false;
        }
    }

    private static String lastError(String fallback) {
        try {
            String value = EasyTierJNI.getLastError();
            return value == null || value.trim().isEmpty() ? fallback : value;
        } catch (Throwable ignored) {
            return fallback;
        }
    }

    private static String cleanMessage(Throwable error) {
        String message = error.getMessage();
        if (message == null || message.trim().isEmpty()) message = error.getClass().getSimpleName();
        return message.length() > 240 ? message.substring(0, 240) : message;
    }

    private static void debug(String message) {
        Log.d(TAG, message);
    }

    private void stopNative() {
        running = false;
        socksPort = 0;
        try { EasyTierJNI.stopAllInstances(); }
        catch (Throwable ignored) {}
    }

    void stop() {
        generation.incrementAndGet();
        stopNative();
    }

    @Override public void close() {
        stop();
        executor.shutdownNow();
    }
}
