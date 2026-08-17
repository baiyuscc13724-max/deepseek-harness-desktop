package io.harnessdesktop.mobile;

import android.app.Activity;
import android.os.Bundle;
import android.widget.Button;

import com.journeyapps.barcodescanner.CaptureActivity;
import com.journeyapps.barcodescanner.DecoratedBarcodeView;

/** Portrait QR scanner with an explicit, always-visible exit path. */
public final class HarnessCaptureActivity extends CaptureActivity {
    @Override
    protected DecoratedBarcodeView initializeContent() {
        setContentView(R.layout.activity_scanner);
        return findViewById(R.id.zxing_barcode_scanner);
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        Button backButton = findViewById(R.id.scanner_back_button);
        backButton.setOnClickListener(view -> cancelAndFinish());
    }

    @Override
    public void onBackPressed() {
        cancelAndFinish();
    }

    private void cancelAndFinish() {
        setResult(Activity.RESULT_CANCELED);
        finish();
    }
}
