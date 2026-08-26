package io.harnessdesktop.mobile;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.widget.Button;
import android.widget.TextView;
import android.widget.Toast;

import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.appcompat.app.AppCompatActivity;
import androidx.appcompat.widget.SwitchCompat;
import androidx.core.content.ContextCompat;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;

public final class ControlSettingsActivity extends AppCompatActivity {
    private TextView readySummary;
    private TextView accessibilityStatus;
    private TextView captureStatus;
    private TextView notificationStatus;
    private TextView liveStatus;
    private Button accessibilityButton;
    private Button notificationButton;
    private SwitchCompat masterSwitch;
    private boolean painting;

    private final ActivityResultLauncher<String> notificationPermission = registerForActivityResult(
        new ActivityResultContracts.RequestPermission(),
        granted -> {
            Toast.makeText(this, granted ? getString(R.string.notification_granted_toast) : getString(R.string.notification_denied_toast), Toast.LENGTH_LONG).show();
            refresh();
        }
    );

    @Override protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_control_settings);
        applyInsets();
        readySummary = findViewById(R.id.control_ready_summary);
        accessibilityStatus = findViewById(R.id.accessibility_status);
        captureStatus = findViewById(R.id.capture_status);
        notificationStatus = findViewById(R.id.notification_status);
        liveStatus = findViewById(R.id.control_live_status);
        accessibilityButton = findViewById(R.id.open_accessibility);
        notificationButton = findViewById(R.id.request_notifications);
        masterSwitch = findViewById(R.id.control_master_switch);

        findViewById(R.id.control_back).setOnClickListener(view -> finish());
        accessibilityButton.setOnClickListener(view -> startActivity(new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)));
        notificationButton.setOnClickListener(view -> requestNotificationPermission());
        findViewById(R.id.control_stop_now).setOnClickListener(view -> stopNow(getString(R.string.stop_now_toast)));
        masterSwitch.setOnCheckedChangeListener((button, checked) -> {
            if (painting) return;
            if (checked && !HarnessControlAccessibilityService.isConnected()) {
                painting = true;
                masterSwitch.setChecked(false);
                painting = false;
                Toast.makeText(this, getString(R.string.accessibility_needed_toast), Toast.LENGTH_LONG).show();
                startActivity(new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS));
                return;
            }
            ControlPreferences.setEnabled(this, checked);
            if (checked) ControlForegroundService.start(this);
            else ControlForegroundService.stop(this);
            refresh();
        });
        refresh();
    }

    @Override protected void onResume() {
        super.onResume();
        refresh();
    }

    private void applyInsets() {
        android.view.View root = findViewById(R.id.control_settings_root);
        ViewCompat.setOnApplyWindowInsetsListener(root, (view, insets) -> {
            Insets bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom);
            return insets;
        });
    }

    private void refresh() {
        if (masterSwitch == null) return;
        boolean accessibility = HarnessControlAccessibilityService.isConnected();
        boolean enabled = ControlPreferences.isEnabled(this);
        boolean notifications = notificationsGranted();
        painting = true;
        masterSwitch.setChecked(enabled);
        painting = false;

        accessibilityStatus.setText(accessibility
            ? getString(R.string.accessibility_on_status)
            : getString(R.string.accessibility_off_status));
        accessibilityButton.setText(accessibility ? getString(R.string.accessibility_view) : getString(R.string.accessibility_open));
        captureStatus.setText(ControlPreferences.captureWasApproved(this)
            ? getString(R.string.capture_approved_status)
            : getString(R.string.capture_not_requested_status));
        notificationStatus.setText(notifications
            ? getString(R.string.notification_on_status)
            : getString(R.string.notification_off_status));
        notificationButton.setEnabled(!notifications && Build.VERSION.SDK_INT >= 33);
        notificationButton.setText(notifications
            ? getString(R.string.notification_granted)
            : Build.VERSION.SDK_INT >= 33 ? getString(R.string.notification_request) : getString(R.string.notification_supported));

        if (enabled && accessibility) {
            readySummary.setText(getString(R.string.ready_enabled));
            liveStatus.setText(getString(R.string.live_enabled));
        } else if (accessibility) {
            readySummary.setText(getString(R.string.ready_accessibility_only));
            liveStatus.setText(getString(R.string.live_disabled));
        } else {
            readySummary.setText(getString(R.string.ready_setup_required));
            liveStatus.setText(getString(R.string.live_safety));
        }
    }

    private void requestNotificationPermission() {
        if (Build.VERSION.SDK_INT >= 33 && !notificationsGranted()) notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS);
        else refresh();
    }

    private boolean notificationsGranted() {
        return Build.VERSION.SDK_INT < 33 || ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED;
    }

    private void stopNow(String message) {
        ControlPreferences.setEnabled(this, false);
        ControlPreferences.setCaptureApproved(this, false);
        ControlForegroundService.stop(this);
        Toast.makeText(this, message, Toast.LENGTH_LONG).show();
        refresh();
    }
}