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

    /**
     * 移动端附件入口。官方会话 UI 只提供拖拽/剪贴板两条 intakeImages 管线
     * （dsh-client-ui-conversation 的 textarea onPaste，含限额与预览），页面本身
     * 没有 input[type=file]；因此这里注入一个可访问的“添加照片”按钮 + 隐藏的
     * image/* 多选 file input。用户点击 → WebView onShowFileChooser → 系统选择器
     * （按次授权、可多选/取消，URI 原样回传）→ input change 事件把所选 File
     * 放入 DataTransfer，再派发 ClipboardEvent('paste') 给当前 composer textarea，
     * 由官方 onPaste 进入 intakeImages 预览与限额管线；若引擎不支持构造
     * clipboardData，则回退到官方 ComposerAttachments 的 document drop 管线
     * （其 onAddImages 同样指向 intakeImages）。按钮随 SPA 重渲染恢复，并与
     * textarea 的 disabled/readOnly(忙碌) 状态联动禁用。文本输入/粘贴保持原生。
     */
    private static final String FILE_ENTRY_JS = "(" +
        "function(){" +
        "if(window.__harnessMobileFileEntryInstalled)return;" +
        "window.__harnessMobileFileEntryInstalled=true;" +
        "var syncState=function(button){" +
          "var card=document.querySelector('[data-composer-card]');" +
          "var textarea=card?card.querySelector('textarea[data-phase]'):null;" +
          "var unavailable=!textarea||textarea.disabled||textarea.readOnly||textarea.getAttribute('data-phase')==='inert';" +
          "if(button.disabled!==unavailable)button.disabled=unavailable;" +
          "var ariaDisabled=unavailable?'true':'false';" +
          "if(button.getAttribute('aria-disabled')!==ariaDisabled)button.setAttribute('aria-disabled',ariaDisabled);" +
        "};" +
        "var mount=function(){" +
          "if(typeof DataTransfer!=='function'||typeof ClipboardEvent!=='function')return;" +
          "var card=document.querySelector('[data-composer-card]');" +
          "if(!card)return;" +
          "if(document.getElementById('harness-mobile-photo-button'))return;" +
          "var input=document.createElement('input');" +
          "input.type='file';" +
          "input.accept='image/*';" +
          "input.multiple=true;" +
          "input.id='harness-mobile-photo-input';" +
          "input.setAttribute('aria-hidden','true');" +
          "input.tabIndex=-1;" +
          "input.style.cssText='position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;';" +
          "var button=document.createElement('button');" +
          "button.type='button';" +
          "button.id='harness-mobile-photo-button';" +
          "button.setAttribute('data-harness-mobile-add-photo','true');" +
          "button.setAttribute('aria-label','添加照片或截图');" +
          "button.title='添加照片或截图';" +
          "button.textContent='照片';" +
          "var intake=function(){" +
            "var files=Array.prototype.slice.call(input.files||[]);" +
            "input.value='';" +
            "if(!files.length)return;" +
            "var card2=document.querySelector('[data-composer-card]');" +
            "var textarea=card2?card2.querySelector('textarea[data-phase]'):null;" +
            "var transfer=new DataTransfer();" +
            "for(var i=0;i<files.length;i++)transfer.items.add(files[i]);" +
            "if(textarea&&!textarea.disabled&&!textarea.readOnly){" +
              "var paste=new ClipboardEvent('paste',{clipboardData:transfer,bubbles:true,cancelable:true});" +
              "if(paste.clipboardData&&paste.clipboardData.items.length>0){textarea.dispatchEvent(paste);return;}" +
            "}" +
            "document.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:transfer}));" +
          "};" +
          "button.addEventListener('click',function(){if(!button.disabled)input.click();});" +
          "input.addEventListener('change',intake);" +
          "var anchor=card.querySelector('[aria-haspopup=\"listbox\"]');" +
          "if(anchor&&anchor.parentElement){anchor.parentElement.insertBefore(button,anchor);}" +
          "else{card.appendChild(button);}" +
          "document.body.appendChild(input);" +
          "syncState(button);" +
        "};" +
        "mount();" +
        "var syncOrMount=function(){" +
          "var button=document.getElementById('harness-mobile-photo-button');" +
          "if(button){syncState(button);return;}" +
          "mount();" +
        "};" +
        "if(!window.__harnessMobileFileEntryObserver){" +
          "window.__harnessMobileFileEntryObserver=new MutationObserver(function(){syncOrMount();});" +
          "window.__harnessMobileFileEntryObserver.observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['disabled','readonly','data-phase']});" +
        "}" +
        "}())";

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
            FILE_ENTRY_JS + ";" +
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
            return new String(output.toByteArray(), StandardCharsets.UTF_8);
        } catch (IOException error) {
            throw new IllegalStateException("无法加载手机布局样式", error);
        }
    }
}