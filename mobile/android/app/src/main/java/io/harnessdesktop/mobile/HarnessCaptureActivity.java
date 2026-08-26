package io.harnessdesktop.mobile;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Bundle;
import android.provider.Settings;
import android.view.View;
import android.widget.Button;

import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.content.ContextCompat;

import com.google.zxing.BarcodeFormat;
import com.google.zxing.client.android.Intents;
import com.journeyapps.barcodescanner.DecoratedBarcodeView;
import com.journeyapps.barcodescanner.DefaultDecoderFactory;

import java.util.Collections;

/** Portrait QR scanner with recoverable, app-owned camera permission handling. */
public final class HarnessCaptureActivity extends AppCompatActivity {
    private DecoratedBarcodeView barcodeView;
    private View permissionPanel;
    private boolean awaitingPermission;
    private boolean scannerRunning;

    private final ActivityResultLauncher<String> cameraPermission = registerForActivityResult(
        new ActivityResultContracts.RequestPermission(),
        granted -> {
            awaitingPermission = false;
            if (Boolean.TRUE.equals(granted)) startScanner();
            else showPermissionRecovery();
        }
    );

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_scanner);

        barcodeView = findViewById(R.id.zxing_barcode_scanner);
        permissionPanel = findViewById(R.id.scanner_permission_panel);
        barcodeView.getBarcodeView().setDecoderFactory(
            new DefaultDecoderFactory(Collections.singletonList(BarcodeFormat.QR_CODE))
        );

        Button backButton = findViewById(R.id.scanner_back_button);
        Button retryButton = findViewById(R.id.scanner_permission_retry);
        Button settingsButton = findViewById(R.id.scanner_permission_settings);
        backButton.setOnClickListener(view -> cancelAndFinish());
        retryButton.setOnClickListener(view -> requestCameraPermission());
        settingsButton.setOnClickListener(view -> openAppSettings());

        if (hasCameraPermission()) startScanner();
        else requestCameraPermission();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (hasCameraPermission()) startScanner();
    }

    @Override
    protected void onPause() {
        if (barcodeView != null && scannerRunning) barcodeView.pause();
        scannerRunning = false;
        super.onPause();
    }

    @Override
    public void onBackPressed() {
        setResult(Activity.RESULT_CANCELED);
        super.onBackPressed();
    }

    private boolean hasCameraPermission() {
        return ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA)
            == PackageManager.PERMISSION_GRANTED;
    }

    private void requestCameraPermission() {
        if (awaitingPermission) return;
        awaitingPermission = true;
        cameraPermission.launch(Manifest.permission.CAMERA);
    }

    private void showPermissionRecovery() {
        scannerRunning = false;
        barcodeView.pause();
        barcodeView.setVisibility(View.INVISIBLE);
        permissionPanel.setVisibility(View.VISIBLE);
        permissionPanel.announceForAccessibility(getString(R.string.scanner_permission_title));
    }

    private void startScanner() {
        if (!hasCameraPermission() || scannerRunning) return;
        permissionPanel.setVisibility(View.GONE);
        barcodeView.setVisibility(View.VISIBLE);
        barcodeView.decodeSingle(result -> {
            Intent data = new Intent();
            data.putExtra(Intents.Scan.RESULT, result.getText());
            data.putExtra(Intents.Scan.RESULT_FORMAT, result.getBarcodeFormat().toString());
            byte[] raw = result.getRawBytes();
            if (raw != null && raw.length > 0) data.putExtra(Intents.Scan.RESULT_BYTES, raw);
            setResult(Activity.RESULT_OK, data);
            finish();
        });
        barcodeView.resume();
        scannerRunning = true;
    }

    private void openAppSettings() {
        Intent intent = new Intent(
            Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
            Uri.parse("package:" + getPackageName())
        );
        startActivity(intent);
    }

    private void cancelAndFinish() {
        setResult(Activity.RESULT_CANCELED);
        finish();
    }
}
