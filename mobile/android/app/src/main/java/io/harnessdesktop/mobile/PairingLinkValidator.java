package io.harnessdesktop.mobile;

import java.io.UnsupportedEncodingException;
import java.net.URI;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;

final class PairingLinkValidator {
    private PairingLinkValidator() {}

    static boolean isAllowedRemoteHost(String host) {
        return isPrivateIpv4(host) || isTailscaleIpv4(host);
    }

    static boolean isSafeHarnessUrl(String value, boolean requirePairingPath) {
        try {
            URI uri = URI.create(value);
            if (!"http".equalsIgnoreCase(uri.getScheme()) || uri.getHost() == null || uri.getPort() < 1024) return false;
            if (!isPrivateOrOverlayIpv4(uri.getHost())) return false;
            return !requirePairingPath || (uri.getPath() != null && uri.getPath().startsWith("/__harness_mobile__/pair/"));
        } catch (RuntimeException error) {
            return false;
        }
    }

    static boolean isSafeHarnessSetupUrl(String value) {
        try {
            URI uri = URI.create(value);
            return "http".equalsIgnoreCase(uri.getScheme())
                && uri.getHost() != null
                && uri.getPort() >= 1024
                && isPrivateOrOverlayIpv4(uri.getHost())
                && "/__harness_mobile__/setup".equals(uri.getPath());
        } catch (RuntimeException error) {
            return false;
        }
    }

    static String extractSetupPayload(String value) {
        if (!isSafeHarnessSetupUrl(value)) return "";
        try {
            String query = URI.create(value).getRawQuery();
            if (query == null) return "";
            for (String part : query.split("&")) {
                int separator = part.indexOf('=');
                String key = separator < 0 ? part : part.substring(0, separator);
                if (!"payload".equals(decodeQueryComponent(key))) continue;
                return decodeQueryComponent(separator < 0 ? "" : part.substring(separator + 1));
            }
        } catch (RuntimeException ignored) {
            // Invalid QR input is handled as an empty payload by the caller.
        }
        return "";
    }

    private static String decodeQueryComponent(String value) {
        try {
            return URLDecoder.decode(value, StandardCharsets.UTF_8.name());
        } catch (UnsupportedEncodingException impossible) {
            throw new IllegalStateException(impossible);
        }
    }

    static String extractHttpPairingUrl(String value) {
        PairingProfile profile = PairingProfile.parse(value);
        return profile == null ? "" : profile.pairUrl;
    }

    static boolean isPrivateIpv4(String host) {
        return isPrivateOrOverlayIpv4(host) && !isTailscaleIpv4(host);
    }

    static boolean isPrivateOrOverlayIpv4(String host) {
        String[] parts = host.split("\\.");
        if (parts.length != 4) return false;
        try {
            int a = Integer.parseInt(parts[0]);
            int b = Integer.parseInt(parts[1]);
            for (String part : parts) {
                int number = Integer.parseInt(part);
                if (number < 0 || number > 255) return false;
            }
            return a == 10 || a == 127 || (a == 192 && b == 168) || (a == 172 && b >= 16 && b <= 31) || (a == 100 && b >= 64 && b <= 127);
        } catch (NumberFormatException error) {
            return false;
        }
    }

    private static boolean isTailscaleIpv4(String host) {
        String[] parts = host.split("\\.");
        if (parts.length != 4) return false;
        try {
            int a = Integer.parseInt(parts[0]);
            int b = Integer.parseInt(parts[1]);
            return a == 100 && b >= 64 && b <= 127;
        } catch (NumberFormatException error) {
            return false;
        }
    }
}
