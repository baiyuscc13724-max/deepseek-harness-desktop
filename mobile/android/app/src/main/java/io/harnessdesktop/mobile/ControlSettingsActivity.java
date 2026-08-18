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
            Toast.makeText(this, granted ? "已允许控制状态通知" : "未允许通知；仍可在此页面立即停止", Toast.LENGTH_LONG).show();
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
        findViewById(R.id.control_stop_now).setOnClickListener(view -> stopNow("手机控制已立即停止，待执行命令已清空。"));
        masterSwitch.setOnCheckedChangeListener((button, checked) -> {
            if (painting) return;
            if (checked && !HarnessControlAccessibilityService.isConnected()) {
                painting = true;
                masterSwitch.setChecked(false);
                painting = false;
                Toast.makeText(this, "请先在系统页面开启 Harness 手机控制无障碍服务", Toast.LENGTH_LONG).show();
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
            ? "已开启：可以读取当前页面的可访问节点并执行固定手势。"
            : "未开启：点击下一步，在系统列表中选择“DeepSeek Harness 手机控制”。");
        accessibilityButton.setText(accessibility ? "查看无障碍设置" : "打开无障碍设置");
        captureStatus.setText(ControlPreferences.captureWasApproved(this)
            ? "最近一次屏幕捕获由你允许。下一次需要看屏幕时，系统仍会再次询问；图像只在返回任务结果时短暂保留。"
            : "尚未申请。只有 Agent 确实需要看屏幕时，系统才会显示捕获授权；每次截取后立即停止。 ");
        notificationStatus.setText(notifications
            ? "已允许通知。前台通知会显示当前动作和“立即停止”。文件仍只通过系统选择器按次授权。"
            : "通知尚未允许。建议开启，以便在任何页面看到控制状态和“立即停止”。文件不需要整个存储权限。 ");
        notificationButton.setEnabled(!notifications && Build.VERSION.SDK_INT >= 33);
        notificationButton.setText(notifications ? "通知已允许" : Build.VERSION.SDK_INT >= 33 ? "允许控制状态通知" : "系统已支持前台通知");

        if (enabled && accessibility) {
            readySummary.setText("手机控制已就绪");
            liveStatus.setText("当前允许已配对会话下发固定动作。通知栏和本页都可立即停止。 ");
        } else if (accessibility) {
            readySummary.setText("权限已完成，打开总开关即可使用");
            liveStatus.setText("当前已关闭。待执行命令不会运行。 ");
        } else {
            readySummary.setText("先完成无障碍授权，再打开总开关");
            liveStatus.setText("当前已关闭。密码、支付、验证码和账户安全操作始终拒绝。 ");
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
