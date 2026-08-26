package io.harnessdesktop.mobile;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.UnsupportedEncodingException;
import java.net.URI;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Collections;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

final class PairingProfile {
    // *.localhost is guaranteed to resolve to loopback in Chromium, while avoiding
    // the official UI's exact "localhost/127.0.0.1" native-desktop feature branch.
    static final String STABLE_HOST = "harness.localhost";
    private static final String DEFAULT_STUN_URL = "stun:stun.cloudflare.com:3478";

    static final class Route {
        final String id;
        final String host;
        final int port;
        final String proxyHost;
        final int proxyPort;

        Route(String id, String host, int port) {
            this(id, host, port, null, 0);
        }

        Route(String id, String host, int port, String proxyHost, int proxyPort) {
            this.id = id;
            this.host = host;
            this.port = port;
            this.proxyHost = proxyHost;
            this.proxyPort = proxyPort;
        }

        String key() {
            return id + ":" + host + ":" + port;
        }

        boolean usesSocks5() {
            return proxyHost != null && proxyPort > 0;
        }

        Route throughSocks5(String host, int port) {
            return new Route(id, this.host, this.port, host, port);
        }
    }

    static final class EasyTierConfig {
        final String networkName;
        final String networkSecret;
        final String desktopAddress;
        final String serviceAddress;
        final String peer;

        EasyTierConfig(String networkName, String networkSecret, String desktopAddress, String serviceAddress, String peer) {
            this.networkName = networkName;
            this.networkSecret = networkSecret;
            this.desktopAddress = desktopAddress;
            this.serviceAddress = serviceAddress;
            this.peer = peer;
        }
    }

    static final class RelayConfig {
        final String relayUrl;
        final String roomId;
        final String tunnelKey;
        final int protocolVersion;

        RelayConfig(String relayUrl, String roomId, String tunnelKey, int protocolVersion) {
            this.relayUrl = relayUrl;
            this.roomId = roomId;
            this.tunnelKey = tunnelKey;
            this.protocolVersion = protocolVersion;
        }
    }

    static final class IceServerConfig {
        final List<String> urls;
        final String username;
        final String credential;

        IceServerConfig(List<String> urls, String username, String credential) {
            this.urls = Collections.unmodifiableList(new ArrayList<>(urls));
            this.username = username;
            this.credential = credential;
        }
    }

    static final class NativeP2pConfig {
        final String signalingUrl;
        final String roomId;
        final String tunnelKey;
        final int protocolVersion;
        final List<IceServerConfig> iceServers;

        NativeP2pConfig(String signalingUrl, String roomId, String tunnelKey, int protocolVersion, List<IceServerConfig> iceServers) {
            this.signalingUrl = signalingUrl;
            this.roomId = roomId;
            this.tunnelKey = tunnelKey;
            this.protocolVersion = protocolVersion;
            this.iceServers = Collections.unmodifiableList(new ArrayList<>(iceServers));
        }
    }

    final int version;
    final String pairUrl;
    final List<Route> routes;
    final EasyTierConfig easyTier;
    final RelayConfig relay;
    final NativeP2pConfig nativeP2p;

    private PairingProfile(int version, String pairUrl, List<Route> routes, EasyTierConfig easyTier, RelayConfig relay, NativeP2pConfig nativeP2p) {
        this.version = version;
        this.pairUrl = pairUrl;
        this.routes = Collections.unmodifiableList(routes);
        this.easyTier = easyTier;
        this.relay = relay;
        this.nativeP2p = nativeP2p;
    }

    static PairingProfile parse(String value) {
        String normalized = value == null ? "" : value.trim();
        try {
            URI input = URI.create(normalized);
            if ("harnessmobile".equalsIgnoreCase(input.getScheme()) && "pair".equalsIgnoreCase(input.getHost())) {
                String payload = queryParameter(input, "payload");
                if (payload != null && !payload.isEmpty()) return fromPayload(payload);
                String legacyUrl = queryParameter(input, "url");
                return fromLegacy(legacyUrl);
            }
            if (PairingLinkValidator.isSafeHarnessSetupUrl(normalized)) {
                String payload = PairingLinkValidator.extractSetupPayload(normalized);
                return payload.isEmpty() ? null : fromPayload(payload);
            }
            return fromLegacy(normalized);
        } catch (RuntimeException | JSONException error) {
            return null;
        }
    }

    static PairingProfile fromStoredJson(String value) {
        if (value == null || value.isEmpty()) return null;
        try {
            JSONObject object = new JSONObject(value);
            return fromObject(object);
        } catch (JSONException | RuntimeException error) {
            return null;
        }
    }

    private static PairingProfile fromPayload(String payload) throws JSONException {
        byte[] decoded = Base64.getUrlDecoder().decode(payload);
        return fromObject(new JSONObject(new String(decoded, StandardCharsets.UTF_8)));
    }

    private static PairingProfile fromObject(JSONObject object) throws JSONException {
        int version = object.optInt("version", 1);
        String pairUrl = object.optString("pairUrl", object.optString("url", ""));
        if (!PairingLinkValidator.isSafeHarnessUrl(pairUrl, true)) return null;
        List<Route> routes = new ArrayList<>();
        addRoute(routes, "lan", pairUrl);
        EasyTierConfig easyTier = null;
        RelayConfig relay = null;
        NativeP2pConfig nativeP2p = null;
        JSONArray transports = object.optJSONArray("transports");
        if (transports != null) {
            for (int index = 0; index < transports.length(); index++) {
                JSONObject transport = transports.optJSONObject(index);
                if (transport == null) continue;
                String id = transport.optString("id", "remote");
                addRoute(routes, id, transport.optString("origin", ""));
                if ("easytier".equals(id)) easyTier = parseEasyTier(transport);
                if ("wss-relay".equals(id)) relay = parseRelay(transport);
                if ("native-p2p".equals(id)) nativeP2p = parseNativeP2p(transport);
            }
        }
        // Saved profiles from earlier app versions contain only the legacy
        // wss-relay descriptor. Reuse that already-authenticated room/key as the
        // optional P2P rendezvous without requiring users to scan a new QR code.
        // NativeP2pClient still waits for welcome.signalingVersion=1, so an old
        // relay deployment remains a pure encrypted WSS tunnel.
        if (nativeP2p == null && relay != null) {
            Route relayRoute = null;
            for (Route route : routes) {
                if ("wss-relay".equals(route.id)) {
                    relayRoute = route;
                    break;
                }
            }
            if (relayRoute != null) {
                nativeP2p = new NativeP2pConfig(
                    relay.relayUrl,
                    relay.roomId,
                    relay.tunnelKey,
                    relay.protocolVersion,
                    Collections.singletonList(new IceServerConfig(Collections.singletonList(DEFAULT_STUN_URL), "", ""))
                );
                routes.add(new Route("native-p2p", relayRoute.host, relayRoute.port));
            }
        }
        return routes.isEmpty() ? null : new PairingProfile(version, pairUrl, deduplicate(routes), easyTier, relay, nativeP2p);
    }

    private static PairingProfile fromLegacy(String value) {
        if (!PairingLinkValidator.isSafeHarnessUrl(value, true)) return null;
        List<Route> routes = new ArrayList<>();
        addRoute(routes, "lan", value);
        return new PairingProfile(1, value, routes, null, null, null);
    }

    private static EasyTierConfig parseEasyTier(JSONObject object) {
        String networkName = object.optString("networkName", "");
        String networkSecret = object.optString("networkSecret", "");
        String desktopAddress = object.optString("desktopAddress", "");
        String serviceAddress = object.optString("serviceAddress", "");
        String peer = object.optString("peer", "");
        if (!networkName.matches("[A-Za-z0-9._-]{1,96}")) return null;
        if (!networkSecret.matches("[A-Za-z0-9_-]{32,128}")) return null;
        if (!PairingLinkValidator.isAllowedRemoteHost(desktopAddress)) return null;
        if (!PairingLinkValidator.isAllowedRemoteHost(serviceAddress)) return null;
        try {
            URI peerUri = URI.create(peer);
            if (!("tcp".equalsIgnoreCase(peerUri.getScheme()) || "udp".equalsIgnoreCase(peerUri.getScheme()))) return null;
            if (peerUri.getHost() == null || peerUri.getHost().isEmpty() || peerUri.getPort() < 1 || peerUri.getPort() > 65535) return null;
            if (peerUri.getUserInfo() != null || peerUri.getRawQuery() != null || peerUri.getRawFragment() != null) return null;
            peer = peerUri.getScheme().toLowerCase() + "://" + peerUri.getHost() + ":" + peerUri.getPort();
        } catch (RuntimeException error) {
            return null;
        }
        return new EasyTierConfig(networkName, networkSecret, desktopAddress, serviceAddress, peer);
    }

    private static RelayConfig parseRelay(JSONObject object) {
        String relayUrl = object.optString("relayUrl", "");
        String roomId = object.optString("roomId", "");
        String tunnelKey = object.optString("tunnelKey", "");
        int protocolVersion = object.optInt("protocolVersion", 0);
        try {
            URI uri = URI.create(relayUrl);
            if (!"wss".equalsIgnoreCase(uri.getScheme()) || uri.getHost() == null || uri.getHost().isEmpty()) return null;
            if ((uri.getPort() != -1 && uri.getPort() != 443) || uri.getUserInfo() != null || uri.getRawFragment() != null) return null;
            if (!roomId.matches("[A-Za-z0-9_-]{43}") || !tunnelKey.matches("[A-Za-z0-9_-]{43}") || protocolVersion != 1) return null;
            if (Base64.getUrlDecoder().decode(tunnelKey).length != 32) return null;
            return new RelayConfig(uri.toString(), roomId, tunnelKey, protocolVersion);
        } catch (RuntimeException error) {
            return null;
        }
    }

    private static NativeP2pConfig parseNativeP2p(JSONObject object) {
        String signalingUrl = object.optString("signalingUrl", object.optString("relayUrl", ""));
        String roomId = object.optString("roomId", "");
        String tunnelKey = object.optString("tunnelKey", "");
        int protocolVersion = object.optInt("protocolVersion", 0);
        try {
            URI uri = URI.create(signalingUrl);
            if (!"wss".equalsIgnoreCase(uri.getScheme()) || uri.getHost() == null || uri.getHost().isEmpty()) return null;
            if ((uri.getPort() != -1 && uri.getPort() != 443) || uri.getUserInfo() != null || uri.getRawFragment() != null) return null;
            if (!roomId.matches("[A-Za-z0-9_-]{43}") || !tunnelKey.matches("[A-Za-z0-9_-]{43}") || protocolVersion != 1) return null;
            if (Base64.getUrlDecoder().decode(tunnelKey).length != 32) return null;
            JSONArray input = object.optJSONArray("iceServers");
            List<IceServerConfig> iceServers = new ArrayList<>();
            if (input != null) {
                if (input.length() > 8) return null;
                for (int index = 0; index < input.length(); index++) {
                    JSONObject item = input.optJSONObject(index);
                    if (item == null) return null;
                    JSONArray urlsJson = item.optJSONArray("urls");
                    List<String> urls = new ArrayList<>();
                    if (urlsJson != null) {
                        if (urlsJson.length() == 0 || urlsJson.length() > 8) return null;
                        for (int urlIndex = 0; urlIndex < urlsJson.length(); urlIndex++) {
                            String url = urlsJson.optString(urlIndex, "");
                            if (!isSafeIceUrl(url)) return null;
                            urls.add(url);
                        }
                    } else {
                        String url = item.optString("url", "");
                        if (!isSafeIceUrl(url)) return null;
                        urls.add(url);
                    }
                    String username = item.optString("username", "");
                    String credential = item.optString("credential", "");
                    if (!username.isEmpty() || !credential.isEmpty()) return null;
                    iceServers.add(new IceServerConfig(urls, "", ""));
                }
            }
            return new NativeP2pConfig(uri.toString(), roomId, tunnelKey, protocolVersion, iceServers);
        } catch (RuntimeException error) {
            return null;
        }
    }

    private static boolean isSafeIceUrl(String value) {
        if (value == null || value.length() < 8 || value.length() > 512 || value.matches(".*\\s+.*")) return false;
        try {
            URI uri = URI.create(value);
            String scheme = uri.getScheme();
            if (!"stun".equalsIgnoreCase(scheme)) return false;
            String address = uri.getRawSchemeSpecificPart();
            return address != null && !address.isEmpty() && !address.startsWith("//") && !address.contains("@");
        } catch (RuntimeException error) {
            return false;
        }
    }

    private static void addRoute(List<Route> routes, String id, String value) {
        if (!PairingLinkValidator.isSafeHarnessUrl(value, false)) return;
        URI uri = URI.create(value);
        routes.add(new Route(id, uri.getHost(), uri.getPort()));
    }

    private static List<Route> deduplicate(List<Route> input) {
        List<Route> output = new ArrayList<>();
        Set<String> seen = new LinkedHashSet<>();
        for (Route route : input) if (seen.add(route.key())) output.add(route);
        return output;
    }

    int desktopPort() {
        return URI.create(pairUrl).getPort();
    }

    List<Route> routesWithEasyTierProxy(int socksPort) {
        return routesWithProxy("easytier", easyTier != null, socksPort);
    }

    List<Route> routesWithRelayProxy(int socksPort) {
        return routesWithProxy("wss-relay", relay != null, socksPort);
    }

    List<Route> routesWithNativeP2pProxy(int socksPort) {
        return routesWithProxy("native-p2p", nativeP2p != null, socksPort);
    }

    private List<Route> routesWithProxy(String transportId, boolean configured, int socksPort) {
        List<Route> values = new ArrayList<>();
        for (Route route : routes) {
            values.add(transportId.equals(route.id) && configured
                ? route.throughSocks5("127.0.0.1", socksPort)
                : route);
        }
        return Collections.unmodifiableList(values);
    }

    String stablePairUrl(int localPort) {
        URI source = URI.create(pairUrl);
        String path = source.getRawPath() == null || source.getRawPath().isEmpty() ? "/" : source.getRawPath();
        return "http://" + STABLE_HOST + ":" + localPort + path + (source.getRawQuery() == null ? "" : "?" + source.getRawQuery());
    }

    String stableOrigin(int localPort) {
        return "http://" + STABLE_HOST + ":" + localPort + "/";
    }

    private static String queryParameter(URI uri, String name) {
        if (uri.getRawQuery() == null) return null;
        for (String part : uri.getRawQuery().split("&")) {
            int separator = part.indexOf('=');
            String key = separator < 0 ? part : part.substring(0, separator);
            if (!name.equals(decodeQueryComponent(key))) continue;
            return decodeQueryComponent(separator < 0 ? "" : part.substring(separator + 1));
        }
        return null;
    }

    private static String decodeQueryComponent(String value) {
        try {
            return URLDecoder.decode(value, StandardCharsets.UTF_8.name());
        } catch (UnsupportedEncodingException impossible) {
            throw new IllegalStateException(impossible);
        }
    }

    String toJson() {
        try {
            JSONObject object = new JSONObject();
            object.put("version", version);
            object.put("pairUrl", pairUrl);
            JSONArray values = new JSONArray();
            for (Route route : routes) {
                JSONObject item = new JSONObject();
                item.put("id", route.id);
                item.put("origin", "http://" + route.host + ":" + route.port);
                if ("easytier".equals(route.id) && easyTier != null) {
                    item.put("networkName", easyTier.networkName);
                    item.put("networkSecret", easyTier.networkSecret);
                    item.put("desktopAddress", easyTier.desktopAddress);
                    item.put("serviceAddress", easyTier.serviceAddress);
                    item.put("peer", easyTier.peer);
                }
                if ("wss-relay".equals(route.id) && relay != null) {
                    item.put("relayUrl", relay.relayUrl);
                    item.put("roomId", relay.roomId);
                    item.put("tunnelKey", relay.tunnelKey);
                    item.put("protocolVersion", relay.protocolVersion);
                }
                if ("native-p2p".equals(route.id) && nativeP2p != null) {
                    item.put("signalingUrl", nativeP2p.signalingUrl);
                    item.put("roomId", nativeP2p.roomId);
                    item.put("tunnelKey", nativeP2p.tunnelKey);
                    item.put("protocolVersion", nativeP2p.protocolVersion);
                    JSONArray servers = new JSONArray();
                    for (IceServerConfig server : nativeP2p.iceServers) {
                        JSONObject serverJson = new JSONObject();
                        serverJson.put("urls", new JSONArray(server.urls));
                        if (!server.username.isEmpty()) serverJson.put("username", server.username);
                        if (!server.credential.isEmpty()) serverJson.put("credential", server.credential);
                        servers.put(serverJson);
                    }
                    item.put("iceServers", servers);
                }
                values.put(item);
            }
            object.put("transports", values);
            return object.toString();
        } catch (JSONException error) {
            throw new IllegalStateException(error);
        }
    }
}
