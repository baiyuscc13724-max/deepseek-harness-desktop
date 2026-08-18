package io.harnessdesktop.mobile;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.PixelFormat;
import android.hardware.display.DisplayManager;
import android.hardware.display.VirtualDisplay;
import android.media.Image;
import android.media.ImageReader;
import android.media.projection.MediaProjection;
import android.media.projection.MediaProjectionManager;
import android.os.Bundle;
import android.os.Handler;
import android.os.HandlerThread;
import android.util.Base64;
import android.util.DisplayMetrics;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.nio.ByteBuffer;
import java.util.concurrent.atomic.AtomicBoolean;

public final class ScreenCaptureActivity extends Activity {
    private static final int REQUEST_CAPTURE = 701;
    private String commandId;
    private int maxWidth;
    private int quality;

    @Override protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        commandId = getIntent().getStringExtra("commandId");
        maxWidth = getIntent().getIntExtra("maxWidth", 720);
        quality = getIntent().getIntExtra("quality", 62);
        MediaProjectionManager manager = getSystemService(MediaProjectionManager.class);
        if (manager == null) {
            fail("CAPTURE_UNAVAILABLE", "系统不支持屏幕捕获。 ");
            return;
        }
        startActivityForResult(manager.createScreenCaptureIntent(), REQUEST_CAPTURE);
    }

    @Override protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != REQUEST_CAPTURE) return;
        if (resultCode != RESULT_OK || data == null) {
            fail("CAPTURE_DENIED", "用户未允许屏幕捕获。 ");
            return;
        }
        ControlPreferences.setCaptureApproved(this, true);
        ControlForegroundService.promoteForCapture(this);
        capture(resultCode, data);
    }

    private void capture(int resultCode, Intent data) {
        MediaProjectionManager manager = getSystemService(MediaProjectionManager.class);
        MediaProjection projection = manager.getMediaProjection(resultCode, data);
        if (projection == null) {
            fail("CAPTURE_UNAVAILABLE", "无法创建屏幕捕获会话。 ");
            return;
        }
        DisplayMetrics metrics = getResources().getDisplayMetrics();
        int width = metrics.widthPixels;
        int height = metrics.heightPixels;
        ImageReader reader = ImageReader.newInstance(width, height, PixelFormat.RGBA_8888, 2);
        HandlerThread thread = new HandlerThread("HarnessScreenCapture");
        thread.start();
        Handler handler = new Handler(thread.getLooper());
        AtomicBoolean settled = new AtomicBoolean();
        VirtualDisplay[] display = new VirtualDisplay[1];
        projection.registerCallback(new MediaProjection.Callback() {
            @Override public void onStop() {
                if (settled.compareAndSet(false, true)) {
                    release(projection, display[0], reader, thread);
                    runOnUiThread(() -> fail("CAPTURE_STOPPED", "屏幕捕获已由系统或用户停止。 "));
                }
            }
        }, handler);
        Runnable timeout = () -> {
            if (settled.compareAndSet(false, true)) {
                release(projection, display[0], reader, thread);
                runOnUiThread(() -> fail("CAPTURE_TIMEOUT", "等待屏幕图像超时。 "));
            }
        };
        reader.setOnImageAvailableListener(source -> {
            if (!settled.compareAndSet(false, true)) return;
            handler.removeCallbacks(timeout);
            try (Image image = source.acquireLatestImage()) {
                if (image == null) throw new IllegalStateException("屏幕图像为空");
                Image.Plane plane = image.getPlanes()[0];
                ByteBuffer buffer = plane.getBuffer();
                int pixelStride = plane.getPixelStride();
                int rowStride = plane.getRowStride();
                int rowPadding = rowStride - pixelStride * width;
                Bitmap padded = Bitmap.createBitmap(width + rowPadding / pixelStride, height, Bitmap.Config.ARGB_8888);
                padded.copyPixelsFromBuffer(buffer);
                Bitmap cropped = Bitmap.createBitmap(padded, 0, 0, width, height);
                int outputWidth = Math.min(width, Math.max(320, maxWidth));
                int outputHeight = Math.max(1, Math.round(height * (outputWidth / (float) width)));
                Bitmap scaled = outputWidth == width ? cropped : Bitmap.createScaledBitmap(cropped, outputWidth, outputHeight, true);
                ByteArrayOutputStream bytes = new ByteArrayOutputStream();
                scaled.compress(Bitmap.CompressFormat.JPEG, Math.max(35, Math.min(85, quality)), bytes);
                JSONObject payload = new JSONObject()
                    .put("mimeType", "image/jpeg")
                    .put("width", scaled.getWidth())
                    .put("height", scaled.getHeight())
                    .put("base64", Base64.encodeToString(bytes.toByteArray(), Base64.NO_WRAP));
                padded.recycle();
                if (cropped != padded) cropped.recycle();
                if (scaled != cropped) scaled.recycle();
                release(projection, display[0], reader, thread);
                runOnUiThread(() -> {
                    ControlForegroundService.completeExternal(ControlResult.ok(commandId, "已截取当前屏幕。", payload));
                    finishAndRemoveTask();
                });
            } catch (Exception error) {
                release(projection, display[0], reader, thread);
                runOnUiThread(() -> fail("CAPTURE_FAILED", "屏幕捕获失败：" + error.getMessage()));
            }
        }, handler);
        display[0] = projection.createVirtualDisplay(
            "HarnessMobileCapture",
            width,
            height,
            metrics.densityDpi,
            DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
            reader.getSurface(),
            null,
            handler
        );
        handler.postDelayed(timeout, 5000L);
    }

    private static void release(MediaProjection projection, VirtualDisplay display, ImageReader reader, HandlerThread thread) {
        try { display.release(); } catch (RuntimeException ignored) {}
        try { reader.close(); } catch (RuntimeException ignored) {}
        try { projection.stop(); } catch (RuntimeException ignored) {}
        thread.quitSafely();
        ControlForegroundService.demoteAfterCapture();
    }

    private void fail(String code, String message) {
        ControlForegroundService.completeExternal(ControlResult.fail(commandId == null ? "unknown" : commandId, code, message));
        finishAndRemoveTask();
    }
}
