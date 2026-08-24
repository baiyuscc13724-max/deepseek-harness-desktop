window.__ModuleLoader__.load({
  id: "dsh-session-experience",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    var React = require("react");
    var h = React.createElement;
    var useState = React.useState;
    var useEffect = React.useEffect;
    var useRef = React.useRef;
    var NS = "session-experience";

    var zh = {
      archiveView: "归档历史", archiveIntro: "已归档会话不会出现在侧栏列表或搜索中；可在这里复制原会话 ID，或恢复为一个新会话继续使用。",
      openArchive: "归档历史", closeArchive: "关闭归档历史", noArchives: "暂无归档会话", noArchivesHint: "在会话列表中归档会话后，会显示在这里。",
      openSession: "打开会话", restoreSession: "恢复为新会话", restored: "已从归档会话恢复副本", copyId: "复制会话 ID", copied: "已复制", copyFailed: "复制失败，请手动选择", locate: "按会话 ID 定位", locatePlaceholder: "粘贴会话 ID 后回车",
      locateMiss: "没有找到该会话 ID", sessionIdLabel: "会话 ID", attachment: "附加文件", attachTitle: "从电脑选择文件并附加到当前输入框",
      uploading: "正在添加附件…", attached: "已添加附件：{path}", attachFailed: "添加附件失败：{error}", unavailable: "当前输入框不可用", revokeHint: "附件保存在工作区 uploads/ 目录，可通过 @ 引用发送。",
      completionRegion: "会话完成通知", taskComplete: "任务已完成", taskCompleteHint: "点击前往这个会话", openCompletedSession: "打开已完成会话：{title}"
    };
    var en = {
      archiveView: "Archive history", archiveIntro: "Archived sessions stay out of the sidebar list and search. Copy the original session ID here or restore a new session to continue.",
      openArchive: "Archive history", closeArchive: "Close archive history", noArchives: "No archived sessions", noArchivesHint: "Sessions you archive from the session list appear here.",
      openSession: "Open session", restoreSession: "Restore as new session", restored: "Restored a copy of the archived session", copyId: "Copy session ID", copied: "Copied", copyFailed: "Copy failed, please select manually", locate: "Locate by session ID", locatePlaceholder: "Paste a session ID and press Enter",
      locateMiss: "No session with that ID", sessionIdLabel: "Session ID", attachment: "Attach file", attachTitle: "Choose a file from this computer and attach it to the current composer",
      uploading: "Adding attachment…", attached: "Attachment added: {path}", attachFailed: "Failed to add attachment: {error}", unavailable: "Composer is unavailable", revokeHint: "Attachments are stored under workspace uploads/ and can be sent with @ mentions.",
      completionRegion: "Session completion notifications", taskComplete: "Task completed", taskCompleteHint: "Open this session", openCompletedSession: "Open completed session: {title}"
    };
    var currentLang = ((typeof navigator !== "undefined" && navigator.language) || "en").toLowerCase().indexOf("zh") === 0 ? "zh" : "en";
    function translate(key, vars) {
      var text = (currentLang === "zh" ? zh : en)[key] || key;
      Object.keys(vars || {}).forEach(function (name) { text = text.split("{" + name + "}").join(String(vars[name])); });
      return text;
    }

    function injectStyles() {
      if (document.getElementById("dsh-session-experience-style")) return;
      var style = document.createElement("style");
      style.id = "dsh-session-experience-style";
      style.textContent = [
        ".dse-attach{display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;border:0;border-radius:8px;color:var(--dsw-alias-label-secondary);background:transparent;cursor:pointer}",
        ".dse-attach:hover:not(:disabled){color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}",
        ".dse-attach:disabled{cursor:default;opacity:.5}",
        ".dse-attach[data-busy=true]{color:var(--dsw-alias-brand-primary)}",
        ".dse-attach svg{display:block}",
        ".dse-status{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}",
        ".dse-status[data-error=true]{color:var(--dsw-alias-state-error-primary)}",
        ".dse-archive{box-sizing:border-box;padding:22px clamp(18px,4vw,44px) 60px;color:var(--dsw-alias-label-primary)}",
        ".dse-archive-shell{width:min(100%,760px);margin:0 auto;display:grid;gap:14px}",
        ".dse-archive-head{margin:0;font-size:20px;line-height:28px}",
        ".dse-archive-sub{margin:4px 0 0;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px}",
        ".dse-locate{display:flex;gap:8px;align-items:center}",
        ".dse-locate input{box-sizing:border-box;min-width:0;flex:1;height:36px;border:1px solid var(--dsw-alias-border-l2);border-radius:9px;padding:6px 10px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-1);font:inherit;font-size:13px}",
        ".dse-locate input:focus{outline:none;border-color:var(--dsw-alias-brand-primary)}",
        ".dse-list{display:grid;gap:8px;margin:0;padding:0;list-style:none}",
        ".dse-item{display:flex;align-items:center;gap:10px;box-sizing:border-box;min-width:0;border:1px solid var(--dsw-alias-border-l2);border-radius:11px;padding:10px 12px;background:var(--dsw-alias-bg-layer-1)}",
        ".dse-item-body{min-width:0;flex:1}.dse-item-title{font-size:13px;line-height:20px;color:var(--dsw-alias-label-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dse-item-meta{display:flex;flex-wrap:wrap;gap:4px 10px;margin-top:3px;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}",
        ".dse-item-meta code{font-family:var(--ds-font-family-code)}",
        ".dse-actions{display:flex;flex:none;gap:6px;align-items:center}",
        ".dse-btn{font:inherit;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);padding:5px 10px;cursor:pointer;font-size:12px;line-height:18px}",
        ".dse-btn:hover{background:var(--dsw-alias-interactive-bg-hover)}",
        ".dse-empty{border:1px dashed var(--dsw-alias-border-l2);border-radius:12px;padding:34px 18px;color:var(--dsw-alias-label-secondary);text-align:center;font-size:13px;line-height:20px}",
        ".dse-completion-stack{pointer-events:auto;position:absolute;z-index:1;top:var(--dsh-workbench-header-height,76px);right:16px;display:grid;gap:10px;width:min(360px,calc(100% - 32px));max-height:calc(100% - var(--dsh-workbench-header-height,76px) - 16px);overflow:auto;overscroll-behavior:contain}",
        ".dse-completion-card{appearance:none;box-sizing:border-box;width:100%;display:grid;grid-template-columns:36px minmax(0,1fr) 20px;align-items:center;gap:10px;border:1px solid color-mix(in srgb,var(--dsw-alias-state-success-primary) 34%,var(--dsw-alias-border-l2));border-radius:14px;padding:12px 13px;text-align:left;color:var(--dsw-alias-label-primary);background:var(--dsw-specific-menu,var(--dsw-alias-bg-layer-1));box-shadow:var(--dsw-shadow-lv3);cursor:pointer;animation:dse-completion-in .22s var(--ds-ease-out,cubic-bezier(.2,.8,.2,1)) both}",
        ".dse-completion-card:hover{border-color:color-mix(in srgb,var(--dsw-alias-state-success-primary) 58%,var(--dsw-alias-border-l2));background:color-mix(in srgb,var(--dsw-specific-menu,var(--dsw-alias-bg-layer-1)) 94%,var(--dsw-alias-state-success-primary))}",
        ".dse-completion-card:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}",
        ".dse-completion-icon{display:inline-flex;align-items:center;justify-content:center;width:36px;height:36px;border-radius:11px;color:var(--dsw-alias-state-success-primary);background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 14%,transparent)}",
        ".dse-completion-copy{min-width:0;display:grid;gap:1px}.dse-completion-kicker{color:var(--dsw-alias-state-success-primary);font-size:12px;font-weight:600;line-height:17px}.dse-completion-title{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-primary);font-size:14px;font-weight:600;line-height:20px}.dse-completion-hint{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:17px}.dse-completion-arrow{display:inline-flex;color:var(--dsw-alias-label-tertiary)}",
        "@keyframes dse-completion-in{from{opacity:0;transform:translateX(20px)}to{opacity:1;transform:translateX(0)}}",
        "@media(prefers-reduced-motion:reduce){.dse-completion-card{animation:none}}",
        "@media(max-width:620px){.dse-item{flex-wrap:wrap}.dse-actions{margin-left:auto}.dse-archive{padding:14px 10px 30px}.dse-completion-stack{right:10px;width:calc(100% - 20px)}}"
      ].join("\n");
      document.head.appendChild(style);
    }

    function copySessionId(sessionId, onDone, onFailed) {
      var value = String(sessionId || "");
      if (!value) { if (onFailed) onFailed(); return; }
      var fallback = function () {
        try {
          window.location.href = "harness-desktop://copy-session-id?value=" + encodeURIComponent(value);
          if (onDone) onDone();
        } catch (_) { if (onFailed) onFailed(); }
      };
      if (typeof navigator !== "undefined" && navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
        navigator.clipboard.writeText(value).then(function () { if (onDone) onDone(); }, fallback);
        return;
      }
      fallback();
    }

    function openRequestedDesktopSession(ctx) {
      var sessionId = "";
      try { sessionId = new URL(window.location.href).searchParams.get("harness-desktop-session") || ""; } catch (_) {}
      if (!sessionId || sessionId.length > 256 || sessionId.trim() !== sessionId) return function () {};
      var settled = false;
      var unsubscribe = null;
      var timer = null;
      function cleanup() {
        if (unsubscribe) unsubscribe();
        unsubscribe = null;
        if (timer) clearTimeout(timer);
        timer = null;
      }
      function attempt() {
        if (settled) return true;
        var snapshot = ctx.sessions.list && typeof ctx.sessions.list.getSnapshot === "function" ? ctx.sessions.list.getSnapshot() : {};
        if (!snapshot.byId || !snapshot.byId[sessionId]) return false;
        settled = true;
        cleanup();
        try { Promise.resolve(ctx.sessions.open(sessionId)).catch(function () {}); } catch (_) {}
        return true;
      }
      if (!attempt() && ctx.sessions.list && typeof ctx.sessions.list.subscribe === "function") unsubscribe = ctx.sessions.list.subscribe(attempt);
      timer = setTimeout(cleanup, 15000);
      return cleanup;
    }

    function PaperclipButton(props) {
      var sessionId = props.sessionId || (props.input && props.input.sessionId) || "";
      var inputActions = props.inputActions;
      var busyPair = useState(false), busy = busyPair[0], setBusy = busyPair[1];
      var statusPair = useState(""), status = statusPair[0], setStatus = statusPair[1];
      var errorPair = useState(false), isError = errorPair[0], setError = errorPair[1];
      var fileRef = useRef(null);
      useEffect(function () {
        var bridge = window.harnessDesktopGuest;
        if (sessionId && bridge && typeof bridge.publishRightWorkspaceContext === "function") bridge.publishRightWorkspaceContext({ sessionId: sessionId });
      }, [sessionId]);
      useEffect(function () {
        var bridge = window.harnessDesktopGuest;
        if (!bridge || typeof bridge.onRightWorkspaceCommand !== "function") return;
        return bridge.onRightWorkspaceCommand(function (command) {
          if (!command || command.type !== "set-draft" || command.sessionId !== sessionId || !inputActions || typeof inputActions.setDraft !== "function") return;
          inputActions.setDraft(command.text);
          setStatus(currentLang === "zh" ? "请求已放入输入框，请检查后手动发送。" : "Request added to the composer. Review it, then send manually.");
          setError(false);
        });
      }, [sessionId, inputActions]);
      function pick() {
        setStatus(""); setError(false);
        if (fileRef.current) { fileRef.current.value = ""; fileRef.current.click(); }
      }
      function upload(event) {
        var file = event.target.files && event.target.files[0];
        if (!file || busy) return;
        if (!sessionId) { setStatus(translate("unavailable")); setError(true); return; }
        if (file.size > 50 * 1024 * 1024) { setStatus(translate("attachFailed", { error: "最大 50 MB" })); setError(true); return; }
        setBusy(true); setStatus(translate("uploading")); setError(false);
        var url = "/api/session-experience/upload?sessionId=" + encodeURIComponent(sessionId) + "&name=" + encodeURIComponent(file.name);
        fetch(url, { method: "POST", headers: { "content-type": file.type || "application/octet-stream" }, body: file, credentials: "same-origin" })
          .then(function (response) { return response.json().catch(function () { return {}; }).then(function (data) { if (!response.ok) { var err = new Error(data.error || "HTTP " + response.status); err.code = data.code; throw err; } return data; }); })
          .then(function (result) {
            var attachPath = result && result.file && result.file.path ? result.file.path : "";
            if (!attachPath) throw new Error("no path");
            if (inputActions && typeof inputActions.setDraft === "function") {
              var quoted = /\s/.test(attachPath) ? "@\"" + attachPath.replace(/\"/g, "") + "\"" : "@" + attachPath;
              var currentDraft = props.input && typeof props.input.draft === "string" ? props.input.draft : "";
              var separator = currentDraft && !/\s$/u.test(currentDraft) ? " " : "";
              inputActions.setDraft(currentDraft + separator + quoted + " ");
              setStatus(translate("attached", { path: attachPath }));
            } else setStatus(translate("unavailable"));
          })
          .catch(function (cause) { setStatus(translate("attachFailed", { error: (cause && cause.message) || String(cause) })); setError(true); })
          .finally(function () { setBusy(false); if (fileRef.current) fileRef.current.value = ""; });
      }
      return h(React.Fragment, null,
        h("input", { ref: fileRef, className: "dse-file-input", type: "file", style: { position: "absolute", width: 1, height: 1, opacity: 0, pointerEvents: "none" }, tabIndex: -1, "aria-hidden": "true", onChange: upload }),
        h("button", { type: "button", className: "dse-attach", "data-busy": busy ? "true" : "false", disabled: busy, onClick: pick, title: translate("attachTitle"), "aria-label": translate("attachment") },
          h("svg", { width: 17, height: 17, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true" },
            h("path", { d: "M21.2 11.2 12.7 19.7a5.2 5.2 0 0 1-7.3-7.3l8.5-8.5a3.4 3.4 0 1 1 4.8 4.8l-8.5 8.5a1.5 1.5 0 1 1-2.1-2.1l7.8-7.8" })
          )
        ),
        status ? h("span", { className: "dse-status", "data-error": isError ? "true" : "false", role: isError ? "alert" : "status" }, status) : null
      );
    }

    var COMPLETE_NOTICE_MS = 8000;
    var COMPLETE_NOTICE_RECHECK_MS = 1000;
    var MAX_COMPLETION_NOTICES = 4;

    function completionRows(snapshot) {
      var byId = (snapshot && snapshot.byId) || {};
      var ids = snapshot && Array.isArray(snapshot.ids) ? snapshot.ids : Object.keys(byId);
      return ids.map(function (id) { return byId[id]; }).filter(function (item) {
        return item && item.completed === true && item.origin !== "subagent";
      });
    }

    function completionTitle(item) {
      return item.displayTitle || item.title || item.id;
    }

    function createCompletionState() {
      return { initialized: false, completed: Object.create(null), notices: [] };
    }

    function reconcileCompletionState(state, snapshot, now) {
      if (!state) state = createCompletionState();
      if (!snapshot || snapshot.phase === "pending") return state;
      var rows = completionRows(snapshot);
      var completed = Object.create(null);
      rows.forEach(function (item) { completed[item.id] = item; });
      if (!state.initialized) return { initialized: true, completed: completed, notices: state.notices };
      var fresh = rows.filter(function (item) { return item.id !== snapshot.current && !state.completed[item.id]; });
      var changed = false;
      var next = state.notices.filter(function (notice) {
        var keep = Boolean(completed[notice.id]) && notice.id !== snapshot.current;
        if (!keep) changed = true;
        return keep;
      }).map(function (notice) {
        var title = completionTitle(completed[notice.id]);
        if (title === notice.title) return notice;
        changed = true;
        return Object.assign({}, notice, { title: title });
      });
      fresh.sort(function (left, right) { return Number(left.updatedAt || 0) - Number(right.updatedAt || 0); }).forEach(function (item) {
        if (next.some(function (notice) { return notice.id === item.id; })) return;
        changed = true;
        next.unshift({ id: item.id, title: completionTitle(item), expiresAt: Number(now) + COMPLETE_NOTICE_MS });
      });
      if (next.length > MAX_COMPLETION_NOTICES) { next = next.slice(0, MAX_COMPLETION_NOTICES); changed = true; }
      return { initialized: true, completed: completed, notices: changed ? next : state.notices };
    }

    function CompletionNotifications(props) {
      var sessions = props.sessions || {};
      var noticesPair = useState([]), notices = noticesPair[0], setNotices = noticesPair[1];
      var stackRef = useRef(null);
      var modelRef = useRef(createCompletionState());
      var noticesRef = useRef(notices);
      noticesRef.current = notices;

      function updateNotices(update) {
        var current = modelRef.current.notices;
        var next = update(current);
        if (next === current) return;
        modelRef.current = Object.assign({}, modelRef.current, { notices: next });
        noticesRef.current = next;
        setNotices(next);
      }

      function dismiss(id) {
        updateNotices(function (current) {
          var next = current.filter(function (notice) { return notice.id !== id; });
          return next.length === current.length ? current : next;
        });
      }

      useEffect(function () {
        var list = sessions.list;
        if (!list || typeof list.getSnapshot !== "function" || typeof list.subscribe !== "function") return;
        var alive = true;
        function apply() {
          if (!alive) return;
          var previous = modelRef.current;
          var next = reconcileCompletionState(previous, list.getSnapshot() || {}, Date.now());
          modelRef.current = next;
          if (next.notices !== previous.notices) {
            noticesRef.current = next.notices;
            setNotices(next.notices);
          }
        }
        apply();
        var unsubscribe = list.subscribe(apply);
        apply();
        return function () { alive = false; if (typeof unsubscribe === "function") unsubscribe(); };
      }, [sessions]);

      useEffect(function () {
        if (!notices.length) return;
        var cancellations = notices.map(function (notice) {
          var timer = null;
          function expireWhenIdle() {
            var stack = stackRef.current;
            var hovered = Boolean(stack && typeof stack.matches === "function" && stack.matches(":hover"));
            var focused = Boolean(stack && document.activeElement && stack.contains(document.activeElement));
            if (hovered || focused) { timer = setTimeout(expireWhenIdle, COMPLETE_NOTICE_RECHECK_MS); return; }
            dismiss(notice.id);
          }
          timer = setTimeout(expireWhenIdle, Math.max(0, notice.expiresAt - Date.now()));
          return function () { if (timer !== null) clearTimeout(timer); };
        });
        return function () { cancellations.forEach(function (cancel) { cancel(); }); };
      }, [notices]);

      useEffect(function () {
        function dismissAll() { updateNotices(function (current) { return current.length ? [] : current; }); }
        function onPointerDown(event) {
          var stack = stackRef.current;
          if (stack && !stack.contains(event.target)) dismissAll();
        }
        function onKeyDown(event) {
          if (event.key !== "Escape" || !noticesRef.current.length) return;
          dismissAll();
          event.preventDefault();
          event.stopPropagation();
        }
        document.addEventListener("pointerdown", onPointerDown, true);
        document.addEventListener("keydown", onKeyDown, true);
        window.addEventListener("blur", dismissAll);
        return function () {
          document.removeEventListener("pointerdown", onPointerDown, true);
          document.removeEventListener("keydown", onKeyDown, true);
          window.removeEventListener("blur", dismissAll);
        };
      }, []);

      function openSession(id) {
        dismiss(id);
        try {
          var opened = sessions.open(id);
          if (opened && typeof opened.catch === "function") opened.catch(function () {});
        } catch (_) {}
      }

      return h("div", { ref: stackRef, className: "dse-completion-stack", role: "region", "aria-live": "polite", "aria-relevant": "additions", "aria-label": translate("completionRegion") },
        notices.map(function (notice) {
          return h("button", { key: notice.id, type: "button", className: "dse-completion-card", "data-session-id": notice.id, onClick: function () { openSession(notice.id); }, title: translate("openCompletedSession", { title: notice.title }), "aria-label": translate("openCompletedSession", { title: notice.title }) },
            h("span", { className: "dse-completion-icon", "aria-hidden": "true" },
              h("svg", { width: 20, height: 20, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.9, strokeLinecap: "round", strokeLinejoin: "round" },
                h("path", { d: "M20 6 9 17l-5-5" })
              )
            ),
            h("span", { className: "dse-completion-copy" },
              h("span", { className: "dse-completion-kicker" }, translate("taskComplete")),
              h("strong", { className: "dse-completion-title" }, notice.title),
              h("span", { className: "dse-completion-hint" }, translate("taskCompleteHint"))
            ),
            h("span", { className: "dse-completion-arrow", "aria-hidden": "true" },
              h("svg", { width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round", strokeLinejoin: "round" },
                h("path", { d: "m9 18 6-6-6-6" })
              )
            )
          );
        })
      );
    }

    function ArchiveView(props) {
      var sessions = props.sessions || {};
      var workspaces = props.workspaces || {};
      var t = translate;
      var locatePair = useState(""), locateInput = locatePair[0], setLocateInput = locatePair[1];
      var noticePair = useState(""), notice = noticePair[0], setNotice = noticePair[1];
      var noticeErrorPair = useState(false), noticeError = noticeErrorPair[0], setNoticeError = noticeErrorPair[1];
      var forcePair = useState(0), force = forcePair[0], setForce = forcePair[1];
      useEffect(function () {
        var list = sessions.list, ws = workspaces.list;
        var alive = true;
        var apply = function () { if (alive) setForce(function (value) { return value + 1; }); };
        var unsubscribers = [];
        if (list && typeof list.subscribe === "function") unsubscribers.push(list.subscribe(apply));
        if (ws && typeof ws.subscribe === "function") unsubscribers.push(ws.subscribe(apply));
        return function () { alive = false; unsubscribers.forEach(function (fn) { if (typeof fn === "function") fn(); }); };
      }, [sessions, workspaces]);
      function snapshot() {
        var listSnapshot = (sessions.list && typeof sessions.list.getSnapshot === "function") ? sessions.list.getSnapshot() : {};
        var wsSnapshot = (workspaces.list && typeof workspaces.list.getSnapshot === "function") ? workspaces.list.getSnapshot() : {};
        var archived = Array.isArray(wsSnapshot.archivedSessionIds) ? wsSnapshot.archivedSessionIds : [];
        var byId = listSnapshot.byId || {};
        return archived.map(function (id) { return byId[id] || { id: id }; }).sort(function (left, right) { return String(right.updatedAt || "").localeCompare(String(left.updatedAt || "")); });
      }
      var items = snapshot();
      function archivedIds() {
        var state = (workspaces.list && typeof workspaces.list.getSnapshot === "function") ? workspaces.list.getSnapshot() : {};
        return Array.isArray(state.archivedSessionIds) ? state.archivedSessionIds : [];
      }
      function failOpen() { setNotice(t("locateMiss")); setNoticeError(true); }
      function openSession(id) {
        var archived = archivedIds().indexOf(id) >= 0;
        if (archived && sessions && typeof sessions.fork === "function" && typeof sessions.open === "function") {
          try {
            Promise.resolve(sessions.fork({ sessionId: id, increaseTitle: true })).then(function (childId) {
              sessions.open(childId); setNotice(t("restored")); setNoticeError(false);
            }).catch(failOpen);
          } catch (_) { failOpen(); }
          return;
        }
        if (sessions && typeof sessions.open === "function") {
          try {
            var opened = sessions.open(id);
            if (opened && typeof opened.catch === "function") opened.catch(failOpen);
          } catch (_) { failOpen(); }
          return;
        }
        failOpen();
      }
      function locate() {
        var id = String(locateInput || "").trim();
        if (!id) return;
        var listSnapshot = (sessions.list && typeof sessions.list.getSnapshot === "function") ? sessions.list.getSnapshot() : {};
        var found = Boolean(listSnapshot.byId && listSnapshot.byId[id]);
        if (!found) { setNotice(t("locateMiss")); setNoticeError(true); return; }
        setNotice(""); setNoticeError(false);
        openSession(id);
      }
      return h("main", { className: "dse-archive", "aria-labelledby": "dse-archive-title" },
        h("div", { className: "dse-archive-shell" },
          h("h1", { id: "dse-archive-title", className: "dse-archive-head" }, t("archiveView")),
          h("p", { className: "dse-archive-sub" }, t("archiveIntro")),
          h("div", { className: "dse-locate" },
            h("input", { type: "text", value: locateInput, onChange: function (event) { setLocateInput(event.target.value); }, onKeyDown: function (event) { if (event.key === "Enter") locate(); }, placeholder: t("locatePlaceholder"), "aria-label": t("locate") }),
            h("button", { className: "dse-btn", type: "button", onClick: locate }, t("locate"))
          ),
          notice ? h("p", { className: "dse-status", "data-error": noticeError ? "true" : "false", role: noticeError ? "alert" : "status" }, notice) : null,
          items.length === 0 ? h("div", { className: "dse-empty" }, h("strong", null, t("noArchives")), h("p", null, t("noArchivesHint"))) : null,
          items.length > 0 ? h("ul", { className: "dse-list" }, items.map(function (item) {
            return h("li", { className: "dse-item", key: item.id },
              h("div", { className: "dse-item-body" },
                h("div", { className: "dse-item-title" }, item.displayTitle || item.title || item.id),
                h("div", { className: "dse-item-meta" },
                  h("code", null, item.id),
                  item.updatedAt ? h("span", null, new Date(item.updatedAt).toLocaleString()) : null,
                  item.running ? h("span", null, currentLang === "zh" ? "运行中" : "running") : null
                )
              ),
              h("div", { className: "dse-actions" },
                h("button", { className: "dse-btn", type: "button", onClick: function () { openSession(item.id); } }, t("restoreSession")),
                h("button", { className: "dse-btn", type: "button", onClick: function () { copySessionId(item.id); } }, t("copyId"))
              )
            );
          })) : null,
          h("p", { className: "dse-status" }, t("revokeHint"))
        )
      );
    }

    function apply(ctx) {
      injectStyles();
      try { ctx.effect(function () { return ctx.locale.register(NS, { zh: zh, en: en }); }, "session-experience: dictionaries"); } catch (_) {}
      try { ctx.locale.subscribe(function () { try { currentLang = ctx.locale.getLocale().active || currentLang; } catch (_) {} }); } catch (_) {}
      try { ctx.effect(function () { return openRequestedDesktopSession(ctx); }, "session-experience: detached session window"); } catch (_) { openRequestedDesktopSession(ctx); }
      function CompletionEntry() { return h(CompletionNotifications, { sessions: ctx.sessions }); }
      function ArchiveEntry(props) { return h(ArchiveView, Object.assign({}, props, { sessions: ctx.sessions, workspaces: ctx.workspaces })); }
      ctx.slots.inject("shell.overlay", function () { return ctx.slots.register({ name: "shell.overlay", id: "session-completion-notifications", order: 70, locale: NS }, CompletionEntry); });
      ctx.slots.inject("conversation.view", function () { return ctx.slots.register({ name: "conversation.view", id: "session-archive", order: 24, locale: NS, label: function () { return translate("archiveView"); } }, ArchiveEntry); });
      ctx.slots.inject("conversation.input.right", function () { return ctx.slots.register({ name: "conversation.input.right", id: "session-attach", order: 30, locale: NS }, PaperclipButton); });
    }

    exports.apply = apply;
    exports.inject = ["slots", "locale", "sessions", "workspaces"];
    exports.__completionTest = { createCompletionState: createCompletionState, reconcileCompletionState: reconcileCompletionState };
    return module.exports;
  }
});
