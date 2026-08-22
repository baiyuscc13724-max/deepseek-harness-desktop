window.__ModuleLoader__.load({
  id: "dsh-desktop-files",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    var React = require("react");
    var h = React.createElement;
    var useEffect = React.useEffect;
    var useLayoutEffect = React.useLayoutEffect || React.useEffect;
    var useRef = React.useRef;
    var useState = React.useState;
    var NS = "desktop-files";
    var zh = {
      title: "文件",
      scope: "当前工作区",
      intro: "上传和管理工作区文件，或准备由 Harness 官方工具执行的编辑请求。",
      boundaryTitle: "文件始终受工作区策略保护",
      boundary: "上传文件保存在当前工作区的 uploads/ 目录。编辑请求只会放入输入框，检查后由你手动发送；不会绕过 Harness 的文件策略。",
      upload: "上传文件",
      uploadTitle: "添加文件",
      uploadHint: "支持一次选择或拖入多个文件。",
      uploading: "正在上传…",
      choose: "选择文件",
      dropTitle: "将文件拖到这里",
      dropActive: "松开即可上传",
      dropHint: "或点击此区域从电脑中选择",
      uploaded: "上传完成：{path}",
      files: "已上传文件",
      fileCount: "{count} 个文件",
      empty: "还没有上传文件",
      emptyHint: "上传后的文件会显示在这里，可直接引用、下载或准备编辑。",
      mention: "引用",
      edit: "准备编辑",
      editTitle: "编辑或下载工作区文件",
      editHint: "填写相对路径；编辑请求仍会先进入输入框等待确认。",
      download: "下载",
      path: "工作区相对路径",
      instruction: "修改要求",
      prepareEdit: "放入编辑请求",
      editReady: "编辑请求已放入输入框，请检查后手动发送。",
      draftUnavailable: "当前输入框不可用，请返回对话后重试。",
      invalidPath: "请输入工作区内的相对路径。",
      invalidEdit: "请输入文件路径和修改要求。",
      failed: "操作失败：{error}",
      refresh: "刷新",
      size: "大小",
      modified: "修改时间",
      limit: "单个上传最大 50 MB；单个下载最大 100 MB。",
      loading: "正在读取文件列表…"
    };
    var en = {
      title: "Files",
      scope: "Current workspace",
      intro: "Upload and manage workspace files, or prepare edits for the official Harness tools.",
      boundaryTitle: "Files stay protected by workspace policy",
      boundary: "Uploads are stored in this workspace under uploads/. Edit requests are added to the composer for your review and never bypass Harness file policy.",
      upload: "Upload files",
      uploadTitle: "Add files",
      uploadHint: "Select or drop multiple files at once.",
      uploading: "Uploading…",
      choose: "Choose files",
      dropTitle: "Drop files here",
      dropActive: "Release to upload",
      dropHint: "or click this area to choose from your computer",
      uploaded: "Uploaded: {path}",
      files: "Uploaded files",
      fileCount: "{count} files",
      empty: "No uploaded files yet",
      emptyHint: "Uploaded files appear here, ready to mention, download, or prepare for editing.",
      mention: "Mention",
      edit: "Prepare edit",
      editTitle: "Edit or download a workspace file",
      editHint: "Use a relative path. Edit requests still wait in the composer for review.",
      download: "Download",
      path: "Workspace-relative path",
      instruction: "Requested change",
      prepareEdit: "Add edit request",
      editReady: "Edit request added to the composer. Review it, then send manually.",
      draftUnavailable: "The composer is unavailable. Return to Chat and try again.",
      invalidPath: "Enter a workspace-relative path.",
      invalidEdit: "Enter a file path and requested change.",
      failed: "Action failed: {error}",
      refresh: "Refresh",
      size: "Size",
      modified: "Modified",
      limit: "Maximum 50 MB per upload and 100 MB per download.",
      loading: "Loading files…"
    };
    var lang = ((navigator.language || "en").toLowerCase().indexOf("zh") === 0) ? "zh" : "en";
    function t(key, values) {
      var value = (lang === "zh" ? zh : en)[key] || key;
      Object.keys(values || {}).forEach(function (name) {
        value = value.replace("{" + name + "}", String(values[name]));
      });
      return value;
    }
    function Icon(props) {
      var name = props.name;
      var nodes;
      if (name === "refresh") {
        nodes = [h("path", { key: "p", d: "M19.2 8A7.8 7.8 0 1 0 20 13M19.2 8V3.8M19.2 8H15" })];
      } else if (name === "notice") {
        nodes = [
          h("path", { key: "p", d: "M12 3.5 19 6v5c0 4.2-2.5 7.3-7 9.5C7.5 18.3 5 15.2 5 11V6l7-2.5Z" }),
          h("path", { key: "i", d: "M12 8v4.2M12 15.5h.01" })
        ];
      } else if (name === "upload") {
        nodes = [h("path", { key: "p", d: "M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5M5 14v4.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V14" })];
      } else if (name === "edit") {
        nodes = [
          h("path", { key: "p", d: "m14.5 5.5 4 4M5 19l3.5-.8L19 7.7a1.4 1.4 0 0 0 0-2L17.8 4.5a1.4 1.4 0 0 0-2 0L5.8 14.6 5 19Z" }),
          h("path", { key: "l", d: "M13.5 6.5l4 4" })
        ];
      } else if (name === "folder") {
        nodes = [h("path", { key: "p", d: "M3.8 7.5h6l1.8 2H20v7.8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6.7a2 2 0 0 1 2-2h3.2l1.8 2h7a2 2 0 0 1 2 2v.8" })];
      } else if (name === "download") {
        nodes = [h("path", { key: "p", d: "M12 4v11m0 0 4-4m-4 4-4-4M5 19h14" })];
      } else {
        nodes = [
          h("path", { key: "p", d: "M7 3.8h7l4 4V20H7a2 2 0 0 1-2-2V5.8a2 2 0 0 1 2-2Z" }),
          h("path", { key: "f", d: "M14 3.8V8h4M8.5 12h7M8.5 15.5h5" })
        ];
      }
      return h("svg", {
        className: "ddf-icon" + (props.className ? " " + props.className : ""),
        viewBox: "0 0 24 24",
        fill: "none",
        stroke: "currentColor",
        strokeWidth: 1.7,
        strokeLinecap: "round",
        strokeLinejoin: "round",
        "aria-hidden": "true"
      }, nodes);
    }
    function injectStyles() {
      var style = document.querySelector("style[data-plugin='dsh-desktop-files']");
      if (!style) {
        style = document.createElement("style");
        style.dataset.plugin = "dsh-desktop-files";
      }
      style.textContent = `
        .ddf-view{box-sizing:border-box;height:auto;min-height:100%;overflow:visible;padding:30px clamp(20px,4vw,48px) 72px;color:var(--dsw-alias-label-primary)}
        .ddf-shell{width:min(100%,980px);margin:0 auto;display:grid;gap:18px}
        .ddf-head{display:flex;align-items:center;justify-content:space-between;gap:24px;padding:2px 2px 4px}
        .ddf-heading{display:flex;align-items:center;gap:14px;min-width:0}
        .ddf-heading-icon{width:42px;height:42px;display:grid;place-items:center;flex:none;border:1px solid color-mix(in srgb,var(--dsw-alias-brand-primary) 18%,var(--dsw-alias-border-l1));border-radius:13px;color:var(--dsw-alias-brand-primary);background:color-mix(in srgb,var(--dsw-alias-brand-primary) 9%,var(--dsw-alias-bg-layer-1));box-shadow:0 8px 24px color-mix(in srgb,var(--dsw-alias-brand-primary) 8%,transparent)}
        .ddf-kicker{margin:0 0 2px;color:var(--dsw-alias-brand-primary);font-size:12px;font-weight:600;letter-spacing:.02em}
        .ddf-title{margin:0;font-size:22px;line-height:30px;font-weight:600;letter-spacing:-.01em}
        .ddf-sub{max-width:680px;margin:4px 0 0;color:var(--dsw-alias-label-secondary);font-size:14px;line-height:21px}
        .ddf-icon{width:19px;height:19px;display:block;flex:none}
        .ddf-button{box-sizing:border-box;min-height:36px;display:inline-flex;align-items:center;justify-content:center;gap:7px;border:1px solid var(--dsw-alias-border-l1);border-radius:9px;padding:0 13px;color:var(--dsw-alias-label-primary);background:color-mix(in srgb,var(--dsw-specific-button-secondary) 88%,transparent);font:inherit;font-size:13px;cursor:pointer;transition:border-color .16s ease,background .16s ease,transform .16s ease,box-shadow .16s ease}
        .ddf-button:hover:not(:disabled){border-color:var(--dsw-alias-border-l2);background:var(--dsw-specific-button-secondary-hover)}
        .ddf-button:active:not(:disabled){transform:translateY(1px)}
        .ddf-button:focus-visible,.ddf-input:focus-visible,.ddf-drop:focus-visible{outline:none;box-shadow:0 0 0 3px color-mix(in srgb,var(--dsw-alias-brand-primary) 18%,transparent);border-color:var(--dsw-alias-brand-primary)}
        .ddf-button:disabled{cursor:default;opacity:.55}
        .ddf-refresh{flex:none;background:color-mix(in srgb,var(--dsw-alias-bg-layer-1) 82%,transparent);box-shadow:0 5px 16px color-mix(in srgb,#000 5%,transparent)}
        .ddf-notice{display:flex;align-items:flex-start;gap:12px;border:1px solid color-mix(in srgb,var(--dsw-alias-brand-primary) 15%,var(--dsw-alias-border-l1));border-radius:12px;padding:12px 14px;color:var(--dsw-alias-label-secondary);background:color-mix(in srgb,var(--dsw-alias-brand-primary) 5%,var(--dsw-alias-bg-layer-1));font-size:13px;line-height:20px}
        .ddf-notice-icon{width:30px;height:30px;display:grid;place-items:center;flex:none;border-radius:9px;color:var(--dsw-alias-brand-primary);background:color-mix(in srgb,var(--dsw-alias-brand-primary) 10%,transparent)}
        .ddf-notice-icon .ddf-icon{width:17px;height:17px}
        .ddf-notice strong{display:block;margin-bottom:1px;color:var(--dsw-alias-label-primary);font-weight:600}
        .ddf-notice p{margin:0}
        .ddf-panel{overflow:hidden;border:1px solid color-mix(in srgb,var(--dsw-alias-border-l1) 88%,transparent);border-radius:14px;background:color-mix(in srgb,var(--dsw-alias-bg-layer-1) 94%,transparent);box-shadow:0 10px 34px color-mix(in srgb,#000 5%,transparent)}
        .ddf-panel-head{display:flex;align-items:center;justify-content:space-between;gap:18px;padding:15px 17px;border-bottom:1px solid color-mix(in srgb,var(--dsw-alias-border-l1) 75%,transparent)}
        .ddf-panel-title{display:flex;align-items:center;gap:10px;min-width:0}
        .ddf-panel-title-icon{width:30px;height:30px;display:grid;place-items:center;flex:none;border-radius:9px;color:var(--dsw-alias-brand-primary);background:color-mix(in srgb,var(--dsw-alias-brand-primary) 9%,transparent)}
        .ddf-panel-title-icon .ddf-icon{width:16px;height:16px}
        .ddf-panel h2{margin:0;font-size:14px;line-height:21px;font-weight:600}
        .ddf-panel-head p{margin:2px 0 0;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}
        .ddf-count{flex:none;border-radius:999px;padding:3px 9px;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-2);font-size:12px}
        .ddf-upload-body{padding:16px}
        .ddf-file-input{position:absolute!important;width:1px!important;height:1px!important;padding:0!important;margin:-1px!important;overflow:hidden!important;clip:rect(0,0,0,0)!important;white-space:nowrap!important;border:0!important}
        .ddf-drop{min-height:150px;box-sizing:border-box;display:grid;place-items:center;border:1.5px dashed color-mix(in srgb,var(--dsw-alias-brand-primary) 30%,var(--dsw-alias-border-l1));border-radius:12px;padding:22px;text-align:center;cursor:pointer;background:linear-gradient(135deg,color-mix(in srgb,var(--dsw-alias-brand-primary) 4%,transparent),color-mix(in srgb,var(--dsw-alias-bg-layer-2) 72%,transparent));transition:border-color .18s ease,background .18s ease,box-shadow .18s ease,transform .18s ease}
        .ddf-drop:hover:not([aria-disabled='true']){border-color:color-mix(in srgb,var(--dsw-alias-brand-primary) 54%,var(--dsw-alias-border-l1));background:linear-gradient(135deg,color-mix(in srgb,var(--dsw-alias-brand-primary) 7%,transparent),color-mix(in srgb,var(--dsw-alias-bg-layer-2) 86%,transparent))}
        .ddf-drop[aria-disabled='true']{cursor:default;opacity:.62}
        .ddf-drop-active{border-style:solid;border-color:var(--dsw-alias-brand-primary);background:color-mix(in srgb,var(--dsw-alias-brand-primary) 10%,var(--dsw-alias-bg-layer-1));box-shadow:0 0 0 4px color-mix(in srgb,var(--dsw-alias-brand-primary) 10%,transparent),0 16px 32px color-mix(in srgb,var(--dsw-alias-brand-primary) 10%,transparent);transform:translateY(-1px)}
        .ddf-drop-inner{display:grid;justify-items:center;max-width:460px}
        .ddf-drop-icon{width:46px;height:46px;display:grid;place-items:center;margin-bottom:10px;border-radius:14px;color:var(--dsw-alias-brand-primary);background:color-mix(in srgb,var(--dsw-alias-brand-primary) 10%,var(--dsw-alias-bg-layer-1));box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--dsw-alias-brand-primary) 12%,transparent)}
        .ddf-drop-icon .ddf-icon{width:23px;height:23px}
        .ddf-drop strong{font-size:15px;line-height:23px;font-weight:600}
        .ddf-drop p{margin:4px 0 12px;color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:20px}
        .ddf-drop-action{height:36px;pointer-events:none;color:var(--dsw-specific-button-primary-label);border-color:transparent;background:var(--dsw-specific-button-primary);font-weight:600;box-shadow:0 7px 18px color-mix(in srgb,var(--dsw-alias-brand-primary) 16%,transparent)}
        .ddf-limit{margin:10px 2px 0;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;text-align:center}
        .ddf-form{display:grid;grid-template-columns:minmax(190px,.9fr) minmax(260px,1.4fr) auto;gap:12px;align-items:end;padding:17px}
        .ddf-field{display:grid;gap:7px;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}
        .ddf-input{box-sizing:border-box;width:100%;height:40px;border:1px solid var(--dsw-alias-border-l1);border-radius:9px;padding:8px 11px;color:var(--dsw-alias-label-primary);background:var(--dsw-specific-input-major);font:inherit;font-size:14px;transition:border-color .16s ease,box-shadow .16s ease,background .16s ease}
        .ddf-input:hover{border-color:var(--dsw-alias-border-l2)}
        .ddf-input::placeholder{color:var(--dsw-alias-label-dimmed)}
        .ddf-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
        .ddf-primary{height:40px;border-color:transparent;color:var(--dsw-specific-button-primary-label);background:var(--dsw-specific-button-primary);box-shadow:0 7px 18px color-mix(in srgb,var(--dsw-alias-brand-primary) 18%,transparent);font-weight:600}
        .ddf-primary:hover:not(:disabled){border-color:transparent;background:var(--dsw-specific-button-primary-hover,var(--dsw-specific-button-primary));box-shadow:0 9px 22px color-mix(in srgb,var(--dsw-alias-brand-primary) 24%,transparent)}
        .ddf-status{display:flex;align-items:center;min-height:20px;margin:-4px 2px 0;padding:0 2px;color:var(--dsw-alias-state-success-primary);font-size:12px;line-height:18px}
        .ddf-error{color:var(--dsw-alias-state-error-primary)}
        .ddf-feedback{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 16px}
        .ddf-empty{min-height:178px;display:grid;place-items:center;padding:24px;text-align:center}
        .ddf-empty-inner{max-width:420px;display:grid;justify-items:center}
        .ddf-empty-icon{width:48px;height:48px;display:grid;place-items:center;margin-bottom:12px;border:1px solid color-mix(in srgb,var(--dsw-alias-brand-primary) 14%,var(--dsw-alias-border-l1));border-radius:15px;color:var(--dsw-alias-brand-primary);background:color-mix(in srgb,var(--dsw-alias-brand-primary) 7%,var(--dsw-alias-bg-layer-2))}
        .ddf-empty-icon .ddf-icon{width:23px;height:23px}
        .ddf-empty h2{margin:0;font-size:15px;line-height:23px;font-weight:600}
        .ddf-empty p{max-width:390px;margin:5px 0 0;color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:20px}
        .ddf-file-list{display:grid;gap:10px}
        .ddf-list-head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:0 2px}
        .ddf-list-head h2{margin:0;font-size:14px;line-height:22px;font-weight:600}
        .ddf-list{display:grid;gap:10px}
        .ddf-item{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:13px;align-items:center;padding:14px 15px}
        .ddf-file-icon{width:34px;height:34px;display:grid;place-items:center;border-radius:10px;color:var(--dsw-alias-brand-primary);background:color-mix(in srgb,var(--dsw-alias-brand-primary) 8%,var(--dsw-alias-bg-layer-2))}
        .ddf-file-icon .ddf-icon{width:17px;height:17px}
        .ddf-name{color:var(--dsw-alias-label-primary);font-size:14px;line-height:21px;font-weight:550;overflow-wrap:anywhere}
        .ddf-meta{display:flex;flex-wrap:wrap;gap:4px 12px;margin-top:4px;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}
        .ddf-item .ddf-button{min-height:34px;padding:0 11px}
        @media(max-width:820px){.ddf-form{grid-template-columns:1fr 1fr}.ddf-form .ddf-field:nth-child(2){grid-column:auto}.ddf-form .ddf-actions{grid-column:1/-1}.ddf-item{grid-template-columns:auto minmax(0,1fr)}.ddf-item .ddf-actions{grid-column:1/-1;padding-left:47px}}
        @media(max-width:560px){.ddf-view{padding:20px 14px 40px}.ddf-head{align-items:flex-start}.ddf-heading-icon{display:none}.ddf-sub{font-size:13px}.ddf-refresh span{display:none}.ddf-refresh{width:38px;padding:0}.ddf-notice{padding:11px 12px}.ddf-panel-head{align-items:flex-start}.ddf-form{grid-template-columns:1fr}.ddf-form .ddf-actions{grid-column:auto}.ddf-form .ddf-button{flex:1}.ddf-drop{min-height:142px;padding:18px 12px}.ddf-item{padding:13px}.ddf-item .ddf-actions{padding-left:0}}
        @media(prefers-reduced-motion:reduce){.ddf-button,.ddf-input,.ddf-drop{transition:none}.ddf-button:active:not(:disabled),.ddf-drop-active{transform:none}}
      `;
      if (!style.isConnected) document.head.appendChild(style);
    }
    function api(path, options) {
      return fetch(path, Object.assign({ cache: "no-store", credentials: "same-origin" }, options || {})).then(function (response) {
        if ((response.headers.get("content-type") || "").indexOf("application/json") >= 0) {
          return response.json().then(function (body) {
            if (!response.ok) throw new Error(body.error || ("HTTP " + response.status));
            return body;
          });
        }
        if (!response.ok) throw new Error("HTTP " + response.status);
        return response;
      });
    }
    function stateUrl(sessionId) { return "/api/desktop-files/state?sessionId=" + encodeURIComponent(sessionId); }
    function quoteMention(path) { return /\s/.test(path) ? "@\"" + path.replace(/\"/g, "") + "\"" : "@" + path; }
    function prettySize(value) {
      var size = Number(value) || 0;
      if (size < 1024) return size + " B";
      if (size < 1048576) return (size / 1024).toFixed(1) + " KB";
      return (size / 1048576).toFixed(1) + " MB";
    }
    function resetViewScroll(node) {
      if (!node) return;
      node.scrollTop = 0;
      var parent = node.parentElement;
      while (parent && parent !== document.body) {
        if (parent.scrollHeight > parent.clientHeight) parent.scrollTop = 0;
        parent = parent.parentElement;
      }
    }
    function isFileDrag(event) {
      var transfer = event && event.dataTransfer;
      if (!transfer) return false;
      var types = transfer.types;
      if (types && typeof types.indexOf === "function" && types.indexOf("Files") >= 0) return true;
      if (types && typeof types.contains === "function" && types.contains("Files")) return true;
      try { return Array.from(types || []).indexOf("Files") >= 0 || Boolean(transfer.files && transfer.files.length); } catch (_) { return false; }
    }
    function FilesView(props) {
      var viewRef = useRef(null);
      var fileRef = useRef(null);
      var dragDepth = useRef(0);
      var statePair = useState(null), state = statePair[0], setState = statePair[1];
      var loadPair = useState(true), loading = loadPair[0], setLoading = loadPair[1];
      var busyPair = useState(false), busy = busyPair[0], setBusy = busyPair[1];
      var dragPair = useState(false), dragging = dragPair[0], setDragging = dragPair[1];
      var notePair = useState(""), note = notePair[0], setNote = notePair[1];
      var errorPair = useState(""), error = errorPair[0], setError = errorPair[1];
      var pathPair = useState(""), filePath = pathPair[0], setFilePath = pathPair[1];
      var instructionPair = useState(""), instruction = instructionPair[0], setInstruction = instructionPair[1];
      function reload() {
        setLoading(true);
        setError("");
        return api(stateUrl(props.sessionId)).then(setState).catch(function (cause) {
          setError(cause.message || String(cause));
        }).finally(function () {
          setLoading(false);
        });
      }
      useLayoutEffect(function () {
        var node = viewRef.current;
        if (!node) return;
        resetViewScroll(node);
        var frame = requestAnimationFrame(function () { resetViewScroll(node); });
        return function () { cancelAnimationFrame(frame); };
      }, [props.sessionId]);
      useEffect(function () {
        var node = viewRef.current;
        if (!node || typeof IntersectionObserver !== "function") return;
        var wasVisible = false;
        var observer = new IntersectionObserver(function (entries) {
          var visible = Boolean(entries[0] && entries[0].isIntersecting);
          if (visible && !wasVisible) resetViewScroll(node);
          wasVisible = visible;
        }, { threshold: 0.01 });
        observer.observe(node);
        return function () { observer.disconnect(); };
      }, [props.sessionId]);
      useEffect(function () { reload(); }, [props.sessionId]);
      function setDraft(value) {
        if (!props.inputActions || typeof props.inputActions.setDraft !== "function") {
          setNote(t("draftUnavailable"));
          return false;
        }
        props.inputActions.setDraft(value);
        setNote(t("editReady"));
        return true;
      }
      function mention(value) { setDraft(quoteMention(value) + " "); }
      function edit(value) { setFilePath(value); setInstruction(""); setNote(""); }
      function prepareEdit(event) {
        event.preventDefault();
        if (!filePath.trim() || !instruction.trim() || /^(?:[A-Za-z]:[\\/]|[\\/]{1,2})/.test(filePath.trim())) {
          setNote(t("invalidEdit"));
          return;
        }
        var mentionText = quoteMention(filePath.trim());
        var request = lang === "zh" ? ("请先读取 " + mentionText + "，按以下要求编辑该文件，并展示修改摘要：" + instruction.trim()) : ("Read " + mentionText + " first, edit it as follows, and show a concise change summary: " + instruction.trim());
        setDraft(request);
      }
      function upload(files) {
        if (!files || !files.length || busy) return;
        setBusy(true);
        setError("");
        setNote("");
        Array.from(files).reduce(function (chain, file) {
          return chain.then(function () {
            if (!(file instanceof File)) return;
            if (file.size > 50 * 1024 * 1024) throw new Error(file.name + ": " + t("limit"));
            var url = "/api/desktop-files/upload?sessionId=" + encodeURIComponent(props.sessionId) + "&name=" + encodeURIComponent(file.name);
            return api(url, { method: "POST", headers: { "content-type": file.type || "application/octet-stream" }, body: file }).then(function (result) {
              setNote(t("uploaded", { path: result.file.path }));
            });
          });
        }, Promise.resolve()).then(reload).catch(function (cause) {
          setError(cause.message || String(cause));
        }).finally(function () {
          setBusy(false);
          setDragging(false);
          dragDepth.current = 0;
          if (fileRef.current) fileRef.current.value = "";
        });
      }
      function openPicker() {
        if (!busy && fileRef.current) fileRef.current.click();
      }
      function onDragEnter(event) {
        if (busy || !isFileDrag(event)) return;
        event.preventDefault();
        event.stopPropagation();
        dragDepth.current += 1;
        setDragging(true);
      }
      function onDragOver(event) {
        if (busy || !isFileDrag(event)) return;
        event.preventDefault();
        event.stopPropagation();
        if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
      }
      function onDragLeave(event) {
        if (dragDepth.current === 0) return;
        event.preventDefault();
        event.stopPropagation();
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (dragDepth.current === 0) setDragging(false);
      }
      function onDrop(event) {
        var fileDrop = isFileDrag(event);
        event.preventDefault();
        event.stopPropagation();
        dragDepth.current = 0;
        setDragging(false);
        if (fileDrop && !busy) upload(event.dataTransfer.files);
      }
      function download(value) {
        if (!value || /^(?:[A-Za-z]:[\\/]|[\\/]{1,2})/.test(value)) {
          setError(t("invalidPath"));
          return;
        }
        setError("");
        var url = "/api/desktop-files/download?sessionId=" + encodeURIComponent(props.sessionId) + "&path=" + encodeURIComponent(value);
        fetch(url, { cache: "no-store", credentials: "same-origin" }).then(function (response) {
          if (!response.ok) return response.json().then(function (body) { throw new Error(body.error || ("HTTP " + response.status)); });
          return response.blob().then(function (blob) {
            var objectUrl = URL.createObjectURL(blob);
            var anchor = document.createElement("a");
            anchor.href = objectUrl;
            anchor.download = value.split(/[\\/]/).pop() || "download";
            document.body.appendChild(anchor);
            anchor.click();
            anchor.remove();
            setTimeout(function () { URL.revokeObjectURL(objectUrl); }, 1000);
          });
        }).catch(function (cause) {
          setError(cause.message || String(cause));
        });
      }
      var files = state && Array.isArray(state.files) ? state.files : [];
      var noteIsError = note === t("invalidEdit") || note === t("draftUnavailable");
      return h("main", { ref: viewRef, className: "ddf-view", "aria-labelledby": "ddf-title" },
        h("div", { className: "ddf-shell" },
          h("header", { className: "ddf-head" },
            h("div", { className: "ddf-heading" },
              h("span", { className: "ddf-heading-icon" }, h(Icon, { name: "file" })),
              h("div", null,
                h("div", { className: "ddf-kicker" }, t("scope")),
                h("h1", { id: "ddf-title", className: "ddf-title" }, t("title")),
                h("p", { className: "ddf-sub" }, t("intro"))
              )
            ),
            h("button", { className: "ddf-button ddf-refresh", type: "button", disabled: loading, onClick: reload }, h(Icon, { name: "refresh" }), h("span", null, t("refresh")))
          ),
          h("aside", { className: "ddf-notice", role: "note" },
            h("span", { className: "ddf-notice-icon" }, h(Icon, { name: "notice" })),
            h("div", null, h("strong", null, t("boundaryTitle")), h("p", null, t("boundary")))
          ),
          h("section", { className: "ddf-panel", "aria-labelledby": "ddf-upload-title" },
            h("div", { className: "ddf-panel-head" },
              h("div", { className: "ddf-panel-title" },
                h("span", { className: "ddf-panel-title-icon" }, h(Icon, { name: "upload" })),
                h("div", null, h("h2", { id: "ddf-upload-title" }, t("uploadTitle")), h("p", null, t("uploadHint")))
              )
            ),
            h("div", { className: "ddf-upload-body" },
              h("input", { ref: fileRef, className: "ddf-file-input", type: "file", multiple: true, disabled: busy, tabIndex: -1, onChange: function (event) { upload(event.target.files); } }),
              h("div", {
                className: "ddf-drop" + (dragging ? " ddf-drop-active" : ""),
                role: "button",
                tabIndex: busy ? -1 : 0,
                "aria-disabled": busy ? "true" : "false",
                "aria-label": busy ? t("uploading") : t("dropTitle"),
                onClick: openPicker,
                onKeyDown: function (event) { if ((event.key === "Enter" || event.key === " ") && !busy) { event.preventDefault(); openPicker(); } },
                onDragEnter: onDragEnter,
                onDragOver: onDragOver,
                onDragLeave: onDragLeave,
                onDrop: onDrop
              },
                h("div", { className: "ddf-drop-inner" },
                  h("span", { className: "ddf-drop-icon" }, h(Icon, { name: "upload" })),
                  h("strong", null, busy ? t("uploading") : dragging ? t("dropActive") : t("dropTitle")),
                  h("p", null, t("dropHint")),
                  h("span", { className: "ddf-button ddf-drop-action", "aria-hidden": "true" }, t("choose"))
                )
              ),
              h("p", { className: "ddf-limit" }, t("limit"))
            )
          ),
          h("section", { className: "ddf-panel", "aria-labelledby": "ddf-edit-title" },
            h("div", { className: "ddf-panel-head" },
              h("div", { className: "ddf-panel-title" },
                h("span", { className: "ddf-panel-title-icon" }, h(Icon, { name: "edit" })),
                h("div", null, h("h2", { id: "ddf-edit-title" }, t("editTitle")), h("p", null, t("editHint")))
              )
            ),
            h("form", { className: "ddf-form", onSubmit: prepareEdit },
              h("label", { className: "ddf-field" }, t("path"), h("input", { className: "ddf-input", value: filePath, onChange: function (event) { setFilePath(event.target.value); }, placeholder: "src/example.js" })),
              h("label", { className: "ddf-field" }, t("instruction"), h("input", { className: "ddf-input", value: instruction, onChange: function (event) { setInstruction(event.target.value); }, placeholder: t("instruction") })),
              h("div", { className: "ddf-actions" },
                h("button", { className: "ddf-button ddf-primary", type: "submit" }, h(Icon, { name: "edit" }), t("prepareEdit")),
                h("button", { className: "ddf-button", type: "button", onClick: function () { download(filePath.trim()); } }, h(Icon, { name: "download" }), t("download"))
              )
            )
          ),
          error || note ? h("div", { className: "ddf-status" + (error || noteIsError ? " ddf-error" : ""), role: error ? "alert" : "status", "aria-live": "polite" }, error ? t("failed", { error: error }) : note) : null,
          loading ? h("section", { className: "ddf-panel ddf-feedback", role: "status" }, t("loading")) : null,
          !loading && files.length === 0 ? h("section", { className: "ddf-panel ddf-empty" },
            h("div", { className: "ddf-empty-inner" },
              h("span", { className: "ddf-empty-icon" }, h(Icon, { name: "folder" })),
              h("h2", null, t("empty")),
              h("p", null, t("emptyHint"))
            )
          ) : null,
          !loading && files.length ? h("section", { className: "ddf-file-list", "aria-labelledby": "ddf-files-title" },
            h("div", { className: "ddf-list-head" }, h("h2", { id: "ddf-files-title" }, t("files")), h("span", { className: "ddf-count" }, t("fileCount", { count: files.length }))),
            h("div", { className: "ddf-list" }, files.map(function (file) {
              return h("article", { className: "ddf-panel ddf-item", key: file.path },
                h("span", { className: "ddf-file-icon" }, h(Icon, { name: "file" })),
                h("div", null,
                  h("div", { className: "ddf-name" }, file.path),
                  h("div", { className: "ddf-meta" }, h("span", null, t("size"), "：", prettySize(file.size)), h("span", null, t("modified"), "：", new Date(file.modifiedAt).toLocaleString()))
                ),
                h("div", { className: "ddf-actions" },
                  h("button", { className: "ddf-button", type: "button", onClick: function () { mention(file.path); } }, t("mention")),
                  h("button", { className: "ddf-button", type: "button", onClick: function () { edit(file.path); } }, t("edit")),
                  h("button", { className: "ddf-button", type: "button", onClick: function () { download(file.path); } }, t("download"))
                )
              );
            }))
          ) : null
        )
      );
    }
    // The standalone Files conversation page is intentionally retired. File
    // management APIs remain available for tools and compatibility, while the
    // user-facing upload affordance now lives on the chat composer paperclip in
    // dsh-session-experience.
    function apply() {}
    exports.apply = apply;
    exports.inject = [];
    return module.exports;
  }
});
