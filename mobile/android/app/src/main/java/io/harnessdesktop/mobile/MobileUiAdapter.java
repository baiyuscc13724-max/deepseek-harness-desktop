package io.harnessdesktop.mobile;

import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import android.webkit.WebView;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;

final class MobileUiAdapter {
    private static final String STYLE_ID = "harness-mobile-compat";
    private static final long[] INJECTION_DELAYS_MS = { 0L, 250L, 900L };

    private final Handler handler = new Handler(Looper.getMainLooper());
    private final String injectionScript;

    MobileUiAdapter(Context context) {
        String css = readAsset(context, "mobile-compat.css");
        String runtime = readAsset(context, "mobile-runtime.js");
        injectionScript = "(() => {" +
            "const id=" + JSONObject.quote(STYLE_ID) + ";" +
            "let style=document.getElementById(id);" +
            "if(!style){style=document.createElement('style');style.id=id;(document.head||document.documentElement).appendChild(style);}" +
            "if(style.textContent!==" + JSONObject.quote(css) + ")style.textContent=" + JSONObject.quote(css) + ";" +
            "document.documentElement.dataset.harnessMobile='true';" +
            runtime + ";" +
            "return true;})()";
    }

    void inject(WebView webView) {
        if (webView == null) return;
        for (long delay : INJECTION_DELAYS_MS) {
            handler.postDelayed(() -> {
                if (webView.getHandler() != null) webView.evaluateJavascript(injectionScript, null);
            }, delay);
        }
    }

    void close() {
        handler.removeCallbacksAndMessages(null);
    }

    private static String readAsset(Context context, String name) {
        try (InputStream input = context.getAssets().open(name)) {
            ByteArrayOutputStream output = new ByteArrayOutputStream();
            byte[] buffer = new byte[8192];
            int count;
            while ((count = input.read(buffer)) >= 0) output.write(buffer, 0, count);
            return output.toString(StandardCharsets.UTF_8);
        } catch (IOException error) {
            throw new IllegalStateException("无法加载手机布局样式", error);
        }
    }
}
