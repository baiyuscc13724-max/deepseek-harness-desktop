package io.harnessdesktop.mobile;

import android.app.Activity;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Bundle;
import android.provider.OpenableColumns;
import android.util.Base64;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;

public final class DocumentPickerActivity extends Activity {
    private static final int REQUEST_DOCUMENT = 702;
    private String commandId;
    private String mode;
    private int maxBytes;
    private byte[] content;

    @Override protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        commandId = getIntent().getStringExtra("commandId");
        mode = getIntent().getStringExtra("mode");
        maxBytes = getIntent().getIntExtra("maxBytes", 2 * 1024 * 1024);
        String mimeType = getIntent().getStringExtra("mimeType");
        if (mimeType == null || mimeType.isBlank()) mimeType = "*/*";
        Intent picker;
        if ("create".equals(mode)) {
            picker = new Intent(Intent.ACTION_CREATE_DOCUMENT).setType(mimeType);
            picker.putExtra(Intent.EXTRA_TITLE, getIntent().getStringExtra("suggestedName"));
            String encoded = getIntent().getStringExtra("contentBase64");
            try { content = encoded == null || encoded.isBlank() ? new byte[0] : Base64.decode(encoded, Base64.DEFAULT); }
            catch (IllegalArgumentException error) {
                fail("INVALID_FILE_CONTENT", "待保存文件内容无效。 ");
                return;
            }
            if (content.length > 8 * 1024 * 1024) {
                fail("FILE_TOO_LARGE", "待保存文件超过 8 MB 安全上限。 ");
                return;
            }
        } else {
            picker = new Intent(Intent.ACTION_OPEN_DOCUMENT).setType(mimeType);
            picker.addCategory(Intent.CATEGORY_OPENABLE);
        }
        picker.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        startActivityForResult(picker, REQUEST_DOCUMENT);
    }

    @Override protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != REQUEST_DOCUMENT) return;
        if (resultCode != RESULT_OK || data == null || data.getData() == null) {
            fail("FILE_PICKER_CANCELLED", "用户取消了系统文件选择。 ");
            return;
        }
        Uri uri = data.getData();
        int flags = data.getFlags() & (Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
        try { getContentResolver().takePersistableUriPermission(uri, flags); }
        catch (SecurityException ignored) {}
        if ("create".equals(mode)) writeDocument(uri);
        else readDocument(uri);
    }

    private void readDocument(Uri uri) {
        new Thread(() -> {
            try (InputStream input = getContentResolver().openInputStream(uri)) {
                if (input == null) throw new IllegalStateException("无法读取所选文件");
                ByteArrayOutputStream output = new ByteArrayOutputStream();
                byte[] buffer = new byte[16 * 1024];
                int count;
                int total = 0;
                while ((count = input.read(buffer)) >= 0) {
                    total += count;
                    if (total > maxBytes) throw new IllegalStateException("所选文件超过授权读取上限");
                    output.write(buffer, 0, count);
                }
                JSONObject data = metadata(uri)
                    .put("size", total)
                    .put("base64", Base64.encodeToString(output.toByteArray(), Base64.NO_WRAP));
                complete(ControlResult.ok(commandId, "已读取用户明确选择的文件。", data));
            } catch (Exception error) {
                complete(ControlResult.fail(commandId, "FILE_READ_FAILED", "读取所选文件失败：" + error.getMessage()));
            }
        }, "HarnessDocumentRead").start();
    }

    private void writeDocument(Uri uri) {
        new Thread(() -> {
            try (OutputStream output = getContentResolver().openOutputStream(uri, "wt")) {
                if (output == null) throw new IllegalStateException("无法写入所选文件");
                output.write(content);
                output.flush();
                JSONObject data = metadata(uri).put("size", content.length);
                complete(ControlResult.ok(commandId, "已保存到用户明确选择的位置。", data));
            } catch (Exception error) {
                complete(ControlResult.fail(commandId, "FILE_WRITE_FAILED", "保存文件失败：" + error.getMessage()));
            }
        }, "HarnessDocumentWrite").start();
    }

    private JSONObject metadata(Uri uri) throws Exception {
        JSONObject data = new JSONObject().put("uri", uri.toString()).put("mimeType", String.valueOf(getContentResolver().getType(uri)));
        try (Cursor cursor = getContentResolver().query(uri, new String[]{OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE}, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                int name = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                int size = cursor.getColumnIndex(OpenableColumns.SIZE);
                if (name >= 0) data.put("name", cursor.getString(name));
                if (size >= 0 && !cursor.isNull(size)) data.put("reportedSize", cursor.getLong(size));
            }
        }
        return data;
    }

    private void complete(ControlResult result) {
        runOnUiThread(() -> {
            ControlForegroundService.completeExternal(result);
            finishAndRemoveTask();
        });
    }

    private void fail(String code, String message) {
        ControlForegroundService.completeExternal(ControlResult.fail(commandId == null ? "unknown" : commandId, code, message));
        finishAndRemoveTask();
    }
}
