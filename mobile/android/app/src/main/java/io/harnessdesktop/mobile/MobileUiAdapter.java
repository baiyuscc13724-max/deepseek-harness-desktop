package io.harnessdesktop.mobile;

import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import android.view.View;
import android.webkit.WebView;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;

final class MobileUiAdapter {
    private static final String STYLE_ID = "harness-mobile-compat";
    static final String RUNTIME_MARKER = "__harnessMobileRuntimeInstalled";
    private static final String RUNTIME_READY = "ready";
    private static final long[] INJECTION_DELAYS_MS = { 0L, 250L, 900L };

    /**
     * Adds one accessible attachment menu to the current composer. Gallery and files
     * retain the HTML file chooser -> Android system picker flow. Camera and speech
     * are explicit, fixed native bridge actions; their results are returned to the
     * current composer without reading media storage, the clipboard, or microphone
     * input inside this application.
     */
    private static final String FILE_ENTRY_JS = "(" +
        "function(){" +
        "if(window.__harnessMobileInputEntryInstalled)return;" +
        "window.__harnessMobileInputEntryInstalled=true;" +
        "var currentTextarea=function(){var card=document.querySelector('[data-composer-card]');return card?card.querySelector('textarea[data-phase]'):null;};" +
        "var workspaceTrigger=function(textarea){return !!(textarea&&textarea.readOnly&&textarea.getAttribute('data-phase')==='inert'&&textarea.getAttribute('aria-haspopup')==='menu');};" +
        "var unavailable=function(){var textarea=currentTextarea();return !textarea||textarea.disabled||(textarea.readOnly&&!workspaceTrigger(textarea));};" +
        "var copyFile=function(file){return new Promise(function(resolve,reject){try{var reader=new FileReader();reader.onload=function(){try{resolve(new File([reader.result],file.name,{type:file.type,lastModified:file.lastModified}));}catch(error){reject(error);}};reader.onerror=function(){reject(reader.error||new Error('Unable to read selected attachment'));};reader.readAsArrayBuffer(file);}catch(error){reject(error);}});};" +
        // Android's ClipboardEvent/DragEvent constructors may silently discard the
        // supplied payload. Define the standard event properties explicitly, as
        // the iOS bridge does, so the official composer paste/drop handlers receive
        // page-owned Files after FileReader consumes the picker-granted content URI.
        "var fileTransfer=function(files){return {files:files,items:files.map(function(file){return {kind:'file',type:file.type,getAsFile:function(){return file;}};}),types:['Files'],dropEffect:'copy',effectAllowed:'all',getData:function(){return '';}};};" +
        "var attachmentStatusTimer=0;var setAttachmentState=function(phase,count,message){var detail={phase:phase,count:count,message:message||'',at:Date.now()};window.__harnessMobileAttachmentState=detail;window.dispatchEvent(new CustomEvent('harness-mobile-attachment-state',{detail:detail}));var status=document.getElementById('harness-mobile-attachment-status');if(!status){status=document.createElement('div');status.id='harness-mobile-attachment-status';status.setAttribute('role','status');status.setAttribute('aria-live','polite');status.style.cssText='position:fixed;left:12px;right:12px;bottom:96px;z-index:2147483001;padding:10px 12px;border-radius:10px;background:rgba(24,24,27,.92);color:#fff;text-align:center;font-size:14px;';document.body.appendChild(status);}clearTimeout(attachmentStatusTimer);status.textContent=detail.message;status.hidden=!detail.message;if(detail.message&&(phase==='success'||phase==='error'))attachmentStatusTimer=setTimeout(function(){status.hidden=true;},phase==='success'?1800:4200);};" +
        "var railCounts=function(files){var wanted={};files.forEach(function(file){wanted[file.name]=(wanted[file.name]||0)+1;});var counts={};var card=document.querySelector('[data-composer-card]');if(!card)return counts;Array.prototype.forEach.call(card.querySelectorAll('[role=\"group\"] img[alt]'),function(image){var name=image.getAttribute('alt')||'';if(wanted[name])counts[name]=(counts[name]||0)+1;});return counts;};" +
        "var waitForRail=function(files,before,timeoutMs){return new Promise(function(resolve){var card=document.querySelector('[data-composer-card]');if(!card){resolve(false);return;}var wanted={};files.forEach(function(file){wanted[file.name]=(wanted[file.name]||0)+1;});var settled=false;var observer=null;var timer=0;var finish=function(ok){if(settled)return;settled=true;if(observer)observer.disconnect();clearTimeout(timer);resolve(ok);};var check=function(){var after=railCounts(files);var names=Object.keys(wanted);if(names.length&&names.every(function(name){return (after[name]||0)>=(before[name]||0)+wanted[name];}))finish(true);};observer=new MutationObserver(check);observer.observe(card,{childList:true,subtree:true,attributes:true,attributeFilter:['alt','src']});timer=setTimeout(function(){finish(false);},timeoutMs);check();});};" +
        "var waitForImageReady=function(timeoutMs){return new Promise(function(resolve){var settled=false;var observer=null;var timer=0;var finish=function(ok){if(settled)return;settled=true;if(observer)observer.disconnect();clearTimeout(timer);resolve(ok);};var check=function(){var textarea=currentTextarea();if(textarea&&!textarea.disabled&&!textarea.readOnly&&textarea.getAttribute('data-phase')!=='inert')finish(true);};observer=new MutationObserver(check);observer.observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['disabled','readonly','data-phase']});timer=setTimeout(function(){finish(false);},timeoutMs);check();});};" +
        "var waitForFreshSession=function(previousSessionId,timeoutMs){return new Promise(function(resolve){var current=function(){var value=window.__harnessMobileCurrentSessionId;return typeof value==='string'&&value&&value!==previousSessionId?value:'';};var settled=false;var timer=0;var finish=function(ok){if(settled)return;settled=true;window.removeEventListener('harness-mobile-session-history-receipt',onReceipt);clearTimeout(timer);resolve(ok);};var onReceipt=function(event){var sessionId=event&&event.detail&&event.detail.sessionId;if(sessionId&&sessionId===current())finish(true);};window.addEventListener('harness-mobile-session-history-receipt',onReceipt);timer=setTimeout(function(){finish(false);},timeoutMs);});};" +
        "var dispatchDrop=function(files){var drop=new Event('drop',{bubbles:true,cancelable:true});Object.defineProperty(drop,'dataTransfer',{configurable:true,value:fileTransfer(files)});document.dispatchEvent(drop);};" +
        "var dispatchImages=function(files){if(!files||!files.length)return Promise.resolve(false);var before=railCounts(files);setAttachmentState('pending',files.length,'正在添加图片…');try{dispatchDrop(files);}catch(dropError){console.warn('Harness Mobile official image drop intake failed',dropError);setAttachmentState('error',files.length,'无法添加图片，请重试');return Promise.resolve(false);}return waitForRail(files,before,8000).then(function(accepted){if(accepted){setAttachmentState('success',files.length,'已添加 '+files.length+' 张图片');return true;}console.error('Harness Mobile attachment rail did not accept selected images');setAttachmentState('error',files.length,'图片未进入附件栏，请重试');return false;});};" +
        "var dispatchDocuments=function(files){if(typeof window.__harnessMobileReceiveDocuments==='function')return Promise.resolve(window.__harnessMobileReceiveDocuments(files,setAttachmentState));setAttachmentState('error',files.length,'当前电脑端还不能接收文档');return Promise.resolve(false);};" +
        "var dispatchFiles=function(files){var images=[];var documents=[];files.forEach(function(file){if(/^image\\//i.test(file.type||''))images.push(file);else documents.push(file);});var deliver=function(){var pending=[];if(images.length)pending.push(dispatchImages(images));if(documents.length)pending.push(dispatchDocuments(documents));return Promise.all(pending);};var textarea=currentTextarea();if(!workspaceTrigger(textarea))return deliver();var previousSessionId=typeof window.__harnessMobileCurrentSessionId==='string'?window.__harnessMobileCurrentSessionId:'';setAttachmentState('pending',files.length,documents.length?'请先选择项目，选择后自动添加附件':'请先选择项目，选择后自动添加图片');var sessionReady=documents.length?waitForFreshSession(previousSessionId,60000):Promise.resolve(true);var card=textarea.closest('[data-composer-card]');if(card)card.click();return Promise.all([waitForImageReady(60000),sessionReady]).then(function(state){if(state[0]&&state[1])return deliver();setAttachmentState('error',files.length,documents.length?'尚未创建新会话，附件未添加':'尚未选择项目，图片未添加');return false;});};" +
        "var intake=function(input){var selected=Array.prototype.slice.call(input.files||[]);if(!selected.length)return;Promise.all(selected.map(copyFile)).then(function(files){input.value='';return dispatchFiles(files);}).catch(function(error){console.warn('Harness Mobile attachment copy failed',error);input.value='';setAttachmentState('error',selected.length,'无法读取所选内容，请重试');});};" +
        "window.__harnessMobileReceiveCapture=function(dataUrl){if(typeof dataUrl!=='string'||dataUrl.indexOf('data:image/jpeg;base64,')!==0)return;fetch(dataUrl).then(function(response){return response.blob();}).then(function(blob){return dispatchFiles([new File([blob],'camera-'+Date.now()+'.jpg',{type:'image/jpeg',lastModified:Date.now()})]);}).catch(function(error){console.warn('Harness Mobile camera intake failed',error);setAttachmentState('error',1,'无法添加拍摄图片，请重试');});};" +
        "window.__harnessMobileReceiveSpeech=function(text){if(typeof text!=='string'||!text)return;var textarea=currentTextarea();if(!textarea||textarea.readOnly||textarea.getAttribute('data-phase')==='inert'||unavailable())return;var start=typeof textarea.selectionStart==='number'?textarea.selectionStart:textarea.value.length;var end=typeof textarea.selectionEnd==='number'?textarea.selectionEnd:start;var next=textarea.value.slice(0,start)+text+textarea.value.slice(end);var setter=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set;setter.call(textarea,next);var caret=start+text.length;textarea.setSelectionRange(caret,caret);textarea.dispatchEvent(new Event('input',{bubbles:true}));textarea.focus();};" +
        "var syncState=function(button){var disabled=unavailable();button.disabled=disabled;button.setAttribute('aria-disabled',disabled?'true':'false');if(disabled){button.setAttribute('aria-expanded','false');var menu=document.getElementById('harness-mobile-input-menu');if(menu)menu.hidden=true;}};" +
        "var makeInput=function(id,accept){var stale=document.getElementById(id);if(stale&&stale.parentElement)stale.parentElement.removeChild(stale);var input=document.createElement('input');input.type='file';input.accept=accept;input.multiple=true;input.id=id;if(id==='harness-mobile-photo-input')input.setAttribute('data-harness-mobile-add-photo','true');input.setAttribute('aria-hidden','true');input.tabIndex=-1;input.style.cssText='position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;';input.addEventListener('change',function(){intake(input);});document.body.appendChild(input);return input;};" +
        "var mount=function(){var card=document.querySelector('[data-composer-card]');if(!card||document.getElementById('harness-mobile-input-button'))return;var staleMenu=document.getElementById('harness-mobile-input-menu');if(staleMenu&&staleMenu.parentElement)staleMenu.parentElement.removeChild(staleMenu);" +
          "var photoInput=makeInput('harness-mobile-photo-input','image/*');var fileInput=makeInput('harness-mobile-file-input','*/*');" +
          "var wrapper=document.createElement('span');wrapper.id='harness-mobile-input-entry';wrapper.style.cssText='position:relative;display:inline-flex;align-items:center;';" +
          "var button=document.createElement('button');button.type='button';button.id='harness-mobile-input-button';button.setAttribute('data-harness-mobile-input-menu','true');button.setAttribute('aria-label','添加附件');button.setAttribute('aria-haspopup','menu');button.setAttribute('aria-expanded','false');button.title='添加附件';button.textContent='＋';button.style.cssText='display:inline-flex;align-items:center;justify-content:center;width:36px;height:36px;padding:0;border:0;border-radius:999px;background:transparent;color:inherit;font-size:24px;line-height:1;';" +
          "var menu=document.createElement('div');menu.id='harness-mobile-input-menu';menu.setAttribute('role','menu');menu.setAttribute('aria-label','附件与输入');menu.hidden=true;menu.style.cssText='position:absolute;left:0;bottom:calc(100% + 8px);z-index:2147483000;min-width:132px;padding:6px;border-radius:12px;background:var(--background,#fff);box-shadow:0 8px 28px rgba(0,0,0,.24);';" +
          "var closeMenu=function(){menu.hidden=true;button.setAttribute('aria-expanded','false');};" +
          "var addItem=function(label,action){var item=document.createElement('button');item.type='button';item.setAttribute('role','menuitem');item.setAttribute('aria-label',label);item.textContent=label;item.style.cssText='display:block;width:100%;padding:10px 12px;border:0;background:transparent;text-align:left;white-space:nowrap;';item.addEventListener('click',function(event){event.stopPropagation();closeMenu();action();});menu.appendChild(item);};" +
          "addItem('相册',function(){photoInput.click();});" +
          "addItem('拍摄',function(){window.HarnessMobileControl&&window.HarnessMobileControl.inputAction&&window.HarnessMobileControl.inputAction('capture');});" +
          "addItem('语音输入',function(){window.HarnessMobileControl&&window.HarnessMobileControl.inputAction&&window.HarnessMobileControl.inputAction('speech');});" +
          "addItem('文件',function(){fileInput.click();});" +
          "button.addEventListener('click',function(event){event.stopPropagation();if(button.disabled)return;menu.hidden=!menu.hidden;button.setAttribute('aria-expanded',menu.hidden?'false':'true');if(!menu.hidden){var textarea=currentTextarea();if(textarea)textarea.blur();var first=menu.querySelector('[role=menuitem]');if(first)first.focus();}});" +
          "menu.addEventListener('keydown',function(event){if(event.key==='Escape'){event.preventDefault();closeMenu();button.focus();}});" +
          "wrapper.appendChild(button);var anchor=card.querySelector('[aria-haspopup=\"listbox\"]');if(anchor&&anchor.parentElement)anchor.parentElement.insertBefore(wrapper,anchor);else card.appendChild(wrapper);(document.body||document.documentElement).appendChild(menu);syncState(button);" +
        "};" +
        "document.addEventListener('click',function(event){var entry=document.getElementById('harness-mobile-input-entry');var menu=document.getElementById('harness-mobile-input-menu');var button=document.getElementById('harness-mobile-input-button');if(entry&&menu&&!menu.hidden&&!entry.contains(event.target)&&!menu.contains(event.target)){menu.hidden=true;if(button)button.setAttribute('aria-expanded','false');}},true);" +
        "mount();" +
        "var syncOrMount=function(){var button=document.getElementById('harness-mobile-input-button');if(button){syncState(button);return;}mount();};" +
        "var affectsEntry=function(records){return records.some(function(record){if(record.type==='attributes')return !!record.target.matches&&record.target.matches('textarea[data-phase]');var target=record.target&&record.target.nodeType===1?record.target:record.target&&record.target.parentElement;if(target&&target.closest&&target.closest('[data-composer-card]'))return true;var nodes=[].slice.call(record.addedNodes||[]).concat([].slice.call(record.removedNodes||[]));return nodes.some(function(node){return node.nodeType===1&&((node.matches&&node.matches('[data-composer-card]'))||(node.querySelector&&node.querySelector('[data-composer-card]')));});});};" +
        "window.__harnessMobileInputEntryObserver=new MutationObserver(function(records){if(affectsEntry(records))syncOrMount();});" +
        "window.__harnessMobileInputEntryObserver.observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['disabled','readonly','data-phase']});" +
        "}())";

    private final Handler handler = new Handler(Looper.getMainLooper());
    private final String injectionScript;

    MobileUiAdapter(Context context) {
        String css = readAsset(context, "mobile-compat.css");
        String runtime = readAsset(context, "mobile-runtime.js");
        injectionScript = buildInjectionScript(css, runtime);
    }

    static String buildInjectionScript(String css, String runtime) {
        return "(() => {" +
            "const id=" + JSONObject.quote(STYLE_ID) + ";" +
            "const runtimeMarker=" + JSONObject.quote(RUNTIME_MARKER) + ";" +
            "let style=document.getElementById(id);" +
            "if(!style){style=document.createElement('style');style.id=id;(document.head||document.documentElement).appendChild(style);}" +
            "if(style.textContent!==" + JSONObject.quote(css) + ")style.textContent=" + JSONObject.quote(css) + ";" +
            "const root=document.documentElement;const body=document.body;" +
            "if(!root||!body){delete window[runtimeMarker];return false;}" +
            "root.dataset.harnessMobile='true';" +
            "if(window[runtimeMarker]!==" + JSONObject.quote(RUNTIME_READY) + "){try{" +
            runtime + ";" +
            "if(window.__harnessMobileUiObserver&&document.getElementById('harness-mobile-app-shell'))window[runtimeMarker]=" + JSONObject.quote(RUNTIME_READY) + ";" +
            "else delete window[runtimeMarker];" +
            "}catch(error){delete window[runtimeMarker];throw error;}}" +
            FILE_ENTRY_JS + ";" +
            "return window[runtimeMarker]===" + JSONObject.quote(RUNTIME_READY) + ";})()";
    }

    void inject(WebView webView) {
        if (webView == null) return;
        // Chromium exposes its virtual DOM accessibility descendants only when the
        // host WebView participates in Android accessibility. Keep this on the
        // adapter boundary so every idempotent injection path has the same contract.
        webView.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_YES);
        webView.setFocusable(true);
        webView.setFocusableInTouchMode(true);
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
