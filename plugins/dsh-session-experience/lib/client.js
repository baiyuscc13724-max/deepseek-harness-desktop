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
      uploading: "正在添加附件…", attached: "已添加附件：{path}", attachFailed: "添加附件失败：{error}", unavailable: "当前输入框不可用", revokeHint: "附件保存在工作区 uploads/ 目录，可通过 @ 引用发送。"
    };
    var en = {
      archiveView: "Archive history", archiveIntro: "Archived sessions stay out of the sidebar list and search. Copy the original session ID here or restore a new session to continue.",
      openArchive: "Archive history", closeArchive: "Close archive history", noArchives: "No archived sessions", noArchivesHint: "Sessions you archive from the session list appear here.",
      openSession: "Open session", restoreSession: "Restore as new session", restored: "Restored a copy of the archived session", copyId: "Copy session ID", copied: "Copied", copyFailed: "Copy failed, please select manually", locate: "Locate by session ID", locatePlaceholder: "Paste a session ID and press Enter",
      locateMiss: "No session with that ID", sessionIdLabel: "Session ID", attachment: "Attach file", attachTitle: "Choose a file from this computer and attach it to the current composer",
      uploading: "Adding attachment…", attached: "Attachment added: {path}", attachFailed: "Failed to add attachment: {error}", unavailable: "Composer is unavailable", revokeHint: "Attachments are stored under workspace uploads/ and can be sent with @ mentions."
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
        ".hd-session-copy{display:inline-flex;align-items:center;gap:6px;box-sizing:border-box;min-height:28px;max-width:220px;border:1px solid var(--dsw-alias-border-l2);border-radius:999px;padding:3px 10px;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-2);font-size:12px;cursor:pointer}",
        ".hd-session-copy:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}",
        ".hd-session-copy code{font-family:var(--ds-font-family-code);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
        ".hd-session-id{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
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
        "@media(max-width:620px){.dse-item{flex-wrap:wrap}.dse-actions{margin-left:auto}.dse-archive{padding:14px 10px 30px}}"
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

    function SessionIdAffordance(props) {
      var sessionId = props.sessionId;
      var copiedPair = useState(false), copied = copiedPair[0], setCopied = copiedPair[1];
      useEffect(function () {
        var bridge = window.harnessDesktopGuest;
        if (sessionId && bridge && typeof bridge.publishRightWorkspaceContext === "function") bridge.publishRightWorkspaceContext({ sessionId: sessionId });
      }, [sessionId]);
      if (!sessionId) return null;
      function copy() {
        copySessionId(sessionId, function () { setCopied(true); setTimeout(function () { setCopied(false); }, 1400); }, function () { setCopied(false); });
      }
      return h("button", { type: "button", className: "hd-session-copy", onClick: copy, title: translate("copyId"), "aria-label": translate("copyId") },
        h("code", { className: "hd-session-id" }, sessionId),
        h("span", null, copied ? translate("copied") : translate("copyId"))
      );
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
      function ArchiveEntry(props) { return h(ArchiveView, Object.assign({}, props, { sessions: ctx.sessions, workspaces: ctx.workspaces })); }
      ctx.slots.inject("conversation.view", function () { return ctx.slots.register({ name: "conversation.view", id: "session-archive", order: 24, locale: NS, label: function () { return translate("archiveView"); } }, ArchiveEntry); });
      ctx.slots.inject("conversation.session.header.utilities", function () { return ctx.slots.register({ name: "conversation.session.header.utilities", id: "session-id", order: 10, locale: NS }, SessionIdAffordance); });
      ctx.slots.inject("conversation.input.right", function () { return ctx.slots.register({ name: "conversation.input.right", id: "session-attach", order: 30, locale: NS }, PaperclipButton); });
    }

    exports.apply = apply;
    exports.inject = ["slots", "locale", "sessions", "workspaces"];
    return module.exports;
  }
});