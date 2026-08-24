package io.harnessdesktop.mobile;

import org.json.JSONException;
import org.json.JSONObject;

import java.util.Arrays;
import java.util.Collections;
import java.util.HashSet;
import java.util.Set;

final class ControlCommand {
    static final int PROTOCOL_VERSION = 1;
    private static final Set<String> ACTIONS = immutableSet(
        "observe", "tap", "longPress", "swipe", "back", "home", "recents",
        "textInput", "openApp", "openUri", "openSettings", "screenshot",
        "fileOpen", "fileCreate", "clearCache"
    );
    private static final Set<String> SENSITIVE = immutableSet("textInput", "fileCreate", "clearCache");

    private static Set<String> immutableSet(String... values) {
        return Collections.unmodifiableSet(new HashSet<>(Arrays.asList(values)));
    }

    final String type;
    final String id;
    final String action;
    final JSONObject payload;
    final int timeoutMs;
    final int retryLimit;
    final boolean requiresConfirmation;

    private ControlCommand(String type, String id, String action, JSONObject payload, int timeoutMs, int retryLimit, boolean requiresConfirmation) {
        this.type = type;
        this.id = id;
        this.action = action;
        this.payload = payload;
        this.timeoutMs = timeoutMs;
        this.retryLimit = retryLimit;
        this.requiresConfirmation = requiresConfirmation || SENSITIVE.contains(action);
    }

    static ControlCommand parse(JSONObject value) throws JSONException {
        if (value.optInt("protocolVersion", 0) != PROTOCOL_VERSION) throw new JSONException("PROTOCOL_MISMATCH");
        String type = value.optString("type", "");
        String id = value.optString("id", "");
        if (!id.matches("[0-9A-Za-z-]{16,80}")) throw new JSONException("INVALID_COMMAND_ID");
        if ("stop".equals(type) || "cancel".equals(type)) {
            return new ControlCommand(type, id, type, value.optJSONObject("payload") == null ? new JSONObject() : value.optJSONObject("payload"), 1000, 0, false);
        }
        if (!"command".equals(type)) throw new JSONException("INVALID_COMMAND_TYPE");
        String action = value.optString("action", "");
        if (!ACTIONS.contains(action)) throw new JSONException("UNSUPPORTED_ACTION");
        JSONObject payload = value.optJSONObject("payload");
        return new ControlCommand(
            type,
            id,
            action,
            payload == null ? new JSONObject() : payload,
            clamp(value.optInt("timeoutMs", 15000), 1000, 60000),
            clamp(value.optInt("retryLimit", 0), 0, 2),
            value.optBoolean("requiresConfirmation", false)
        );
    }

    static boolean isSensitive(String action) {
        return SENSITIVE.contains(action);
    }

    private static int clamp(int value, int minimum, int maximum) {
        return Math.max(minimum, Math.min(maximum, value));
    }
}
