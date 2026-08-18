package io.harnessdesktop.mobile;

import org.json.JSONException;
import org.json.JSONObject;

final class ControlResult {
    final String id;
    final boolean ok;
    final String code;
    final String message;
    final JSONObject data;

    private ControlResult(String id, boolean ok, String code, String message, JSONObject data) {
        this.id = id;
        this.ok = ok;
        this.code = code;
        this.message = message;
        this.data = data;
    }

    static ControlResult ok(String id, String message, JSONObject data) {
        return new ControlResult(id, true, "OK", message, data);
    }

    static ControlResult fail(String id, String code, String message) {
        return new ControlResult(id, false, code, message, null);
    }

    JSONObject toJson() throws JSONException {
        JSONObject value = new JSONObject()
            .put("id", id)
            .put("ok", ok)
            .put("code", code)
            .put("message", message == null ? "" : message);
        if (data != null) value.put("data", data);
        return value;
    }
}
