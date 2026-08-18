package io.harnessdesktop.mobile;

import android.content.Context;
import android.content.SharedPreferences;

final class ControlPreferences {
    static final String PREFS = "harness_mobile_control";
    private static final String ENABLED = "enabled";
    private static final String CAPTURE_APPROVED = "capture_approved";

    private ControlPreferences() {}

    static boolean isEnabled(Context context) {
        return prefs(context).getBoolean(ENABLED, false);
    }

    static void setEnabled(Context context, boolean enabled) {
        prefs(context).edit().putBoolean(ENABLED, enabled).apply();
    }

    static boolean captureWasApproved(Context context) {
        return prefs(context).getBoolean(CAPTURE_APPROVED, false);
    }

    static void setCaptureApproved(Context context, boolean approved) {
        prefs(context).edit().putBoolean(CAPTURE_APPROVED, approved).apply();
    }

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }
}
