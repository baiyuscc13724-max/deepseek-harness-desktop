package io.harnessdesktop.mobile;

import android.accessibilityservice.AccessibilityService;
import android.accessibilityservice.GestureDescription;
import android.app.AlertDialog;
import android.graphics.Path;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.WindowManager;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayDeque;
import java.util.Locale;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.Consumer;

public final class HarnessControlAccessibilityService extends AccessibilityService {
    private static volatile HarnessControlAccessibilityService instance;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private AlertDialog confirmationDialog;

    static boolean isConnected() {
        return instance != null;
    }

    static HarnessControlAccessibilityService get() {
        return instance;
    }

    @Override protected void onServiceConnected() {
        instance = this;
        ControlForegroundService.requestStatusRefresh(this);
    }

    @Override public void onAccessibilityEvent(AccessibilityEvent event) {
        // Deliberately do not persist event text. Node content is read only for an active command.
    }

    @Override public void onInterrupt() {
        cancelConfirmation();
    }

    @Override public void onDestroy() {
        if (instance == this) instance = null;
        cancelConfirmation();
        ControlForegroundService.requestStatusRefresh(this);
        super.onDestroy();
    }

    JSONObject observe(int maximum, boolean includeText) throws JSONException {
        JSONObject output = new JSONObject();
        AccessibilityNodeInfo root = getRootInActiveWindow();
        if (root == null) return output.put("packageName", "").put("nodes", new JSONArray()).put("reason", "NO_ACTIVE_WINDOW");
        output.put("packageName", String.valueOf(root.getPackageName()));
        output.put("windowId", root.getWindowId());
        JSONArray nodes = new JSONArray();
        ArrayDeque<NodeDepth> queue = new ArrayDeque<>();
        queue.add(new NodeDepth(root, 0));
        try {
            while (!queue.isEmpty() && nodes.length() < maximum) {
                NodeDepth entry = queue.removeFirst();
                AccessibilityNodeInfo node = entry.node;
                JSONObject summary = new JSONObject()
                    .put("className", safe(node.getClassName(), 120))
                    .put("viewId", safe(node.getViewIdResourceName(), 160))
                    .put("clickable", node.isClickable())
                    .put("editable", node.isEditable())
                    .put("enabled", node.isEnabled())
                    .put("focused", node.isFocused())
                    .put("depth", entry.depth);
                android.graphics.Rect bounds = new android.graphics.Rect();
                node.getBoundsInScreen(bounds);
                summary.put("bounds", new JSONObject().put("left", bounds.left).put("top", bounds.top).put("right", bounds.right).put("bottom", bounds.bottom));
                if (includeText && !looksSensitive(node)) {
                    String text = safe(node.getText(), 240);
                    String description = safe(node.getContentDescription(), 240);
                    if (!text.isEmpty()) summary.put("text", text);
                    if (!description.isEmpty()) summary.put("description", description);
                }
                nodes.put(summary);
                for (int index = 0; index < node.getChildCount(); index++) {
                    AccessibilityNodeInfo child = node.getChild(index);
                    if (child != null) queue.addLast(new NodeDepth(child, entry.depth + 1));
                }
                if (node != root) node.recycle();
            }
        } finally {
            for (NodeDepth entry : queue) entry.node.recycle();
            root.recycle();
        }
        output.put("nodes", nodes);
        output.put("truncated", !queue.isEmpty());
        return output;
    }

    void tap(float x, float y, long durationMs, Consumer<Boolean> callback) {
        Path path = new Path();
        path.moveTo(x, y);
        GestureDescription gesture = new GestureDescription.Builder()
            .addStroke(new GestureDescription.StrokeDescription(path, 0, Math.max(40, durationMs)))
            .build();
        dispatchGesture(gesture, new GestureResultCallback() {
            @Override public void onCompleted(GestureDescription gestureDescription) { callback.accept(true); }
            @Override public void onCancelled(GestureDescription gestureDescription) { callback.accept(false); }
        }, mainHandler);
    }

    void swipe(float startX, float startY, float endX, float endY, long durationMs, Consumer<Boolean> callback) {
        Path path = new Path();
        path.moveTo(startX, startY);
        path.lineTo(endX, endY);
        GestureDescription gesture = new GestureDescription.Builder()
            .addStroke(new GestureDescription.StrokeDescription(path, 0, Math.max(120, durationMs)))
            .build();
        dispatchGesture(gesture, new GestureResultCallback() {
            @Override public void onCompleted(GestureDescription gestureDescription) { callback.accept(true); }
            @Override public void onCancelled(GestureDescription gestureDescription) { callback.accept(false); }
        }, mainHandler);
    }

    boolean global(int action) {
        return performGlobalAction(action);
    }

    boolean inputText(String text) {
        AccessibilityNodeInfo root = getRootInActiveWindow();
        if (root == null) return false;
        AccessibilityNodeInfo editable = findEditable(root);
        try {
            if (editable == null || looksSensitive(editable)) return false;
            Bundle arguments = new Bundle();
            arguments.putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, text);
            return editable.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, arguments);
        } finally {
            if (editable != null && editable != root) editable.recycle();
            root.recycle();
        }
    }

    void confirmSensitive(String action, Consumer<Boolean> callback) {
        mainHandler.post(() -> {
            cancelConfirmation();
            String message;
            if ("textInput".equals(action)) message = "Agent 请求向当前可编辑控件输入文字。请确认当前页面不包含密码、验证码、支付或账户安全信息。";
            else if ("fileCreate".equals(action)) message = "Agent 请求打开系统文件选择器保存文件。只有你明确选择的位置会被授权。";
            else message = "Agent 只能打开目标应用的系统存储页，并尝试点击“清除缓存”。绝不会点击“清除数据”。";
            AtomicBoolean settled = new AtomicBoolean();
            confirmationDialog = new AlertDialog.Builder(this)
                .setTitle("确认手机操作")
                .setMessage(message)
                .setNegativeButton("拒绝", (dialog, which) -> {
                    if (settled.compareAndSet(false, true)) callback.accept(false);
                })
                .setPositiveButton("允许本次", (dialog, which) -> {
                    if (settled.compareAndSet(false, true)) callback.accept(true);
                })
                .setOnCancelListener(dialog -> {
                    if (settled.compareAndSet(false, true)) callback.accept(false);
                })
                .create();
            confirmationDialog.getWindow();
            confirmationDialog.setOnShowListener(dialog -> {
                WindowManager.LayoutParams params = confirmationDialog.getWindow().getAttributes();
                params.type = WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY;
                confirmationDialog.getWindow().setAttributes(params);
            });
            confirmationDialog.getWindow().setType(WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY);
            confirmationDialog.show();
        });
    }

    boolean clickClearCacheButton() {
        AccessibilityNodeInfo root = getRootInActiveWindow();
        if (root == null) return false;
        try {
            ArrayDeque<AccessibilityNodeInfo> queue = new ArrayDeque<>();
            queue.add(root);
            while (!queue.isEmpty()) {
                AccessibilityNodeInfo node = queue.removeFirst();
                String label = (safe(node.getText(), 100) + " " + safe(node.getContentDescription(), 100)).trim().toLowerCase(Locale.ROOT);
                boolean cache = label.matches(".*(?:clear cache|清除缓存|清理缓存|清空缓存).*");
                boolean data = label.matches(".*(?:clear storage|clear data|清除数据|清空数据|删除数据).*");
                if (cache && !data && node.isEnabled()) {
                    AccessibilityNodeInfo clickable = node;
                    while (clickable != null && !clickable.isClickable()) clickable = clickable.getParent();
                    if (clickable != null) return clickable.performAction(AccessibilityNodeInfo.ACTION_CLICK);
                }
                for (int index = 0; index < node.getChildCount(); index++) {
                    AccessibilityNodeInfo child = node.getChild(index);
                    if (child != null) queue.addLast(child);
                }
            }
            return false;
        } finally {
            root.recycle();
        }
    }

    void cancelConfirmation() {
        mainHandler.post(() -> {
            if (confirmationDialog != null) {
                confirmationDialog.dismiss();
                confirmationDialog = null;
            }
        });
    }

    private static AccessibilityNodeInfo findEditable(AccessibilityNodeInfo root) {
        AccessibilityNodeInfo focus = root.findFocus(AccessibilityNodeInfo.FOCUS_INPUT);
        if (focus != null && focus.isEditable()) return focus;
        ArrayDeque<AccessibilityNodeInfo> queue = new ArrayDeque<>();
        queue.add(root);
        while (!queue.isEmpty()) {
            AccessibilityNodeInfo node = queue.removeFirst();
            if (node.isEditable() && (node.isFocused() || node.isAccessibilityFocused())) return node;
            for (int index = 0; index < node.getChildCount(); index++) {
                AccessibilityNodeInfo child = node.getChild(index);
                if (child != null) queue.addLast(child);
            }
        }
        return null;
    }

    private static boolean looksSensitive(AccessibilityNodeInfo node) {
        if (node.isPassword()) return true;
        String value = (safe(node.getViewIdResourceName(), 180) + " " + safe(node.getHintText(), 180) + " " + safe(node.getContentDescription(), 180)).toLowerCase(Locale.ROOT);
        return value.matches(".*(?:password|passwd|pwd|pin|otp|验证码|密码|支付|银行卡|bank|payment).*" );
    }

    private static String safe(CharSequence value, int maximum) {
        if (value == null) return "";
        String text = value.toString().replaceAll("[\\p{Cntrl}]", "").trim();
        return text.length() <= maximum ? text : text.substring(0, maximum);
    }

    private record NodeDepth(AccessibilityNodeInfo node, int depth) {}
}
