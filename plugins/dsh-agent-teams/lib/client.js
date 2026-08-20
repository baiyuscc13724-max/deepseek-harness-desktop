window.__ModuleLoader__.load({
  id: "dsh-agent-teams",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    var React = require("react");
    var h = React.createElement;
    var useState = React.useState;
    var useEffect = React.useEffect;
    var useRef = React.useRef;
    var NS = "agent-teams";

    var zh = {
      title: "代理团队工作台", button: "代理团队", close: "关闭", loading: "正在载入代理团队…", retry: "重试",
      loadError: "无法载入代理团队：{error}", actionError: "操作失败：{error}", experiment: "代理团队实验功能",
      disabledBody: "此实验功能当前已停用。启用后，可让多个可继续对话的代理围绕同一目标协作。",
      enable: "启用实验功能", enabling: "正在启用…", noTeam: "当前会话尚无团队", objective: "团队目标",
      objectivePlaceholder: "描述团队要共同完成的具体目标…", start: "创建团队", starting: "正在创建…",
      status: "状态", members: "成员", tasks: "任务", costWarning: "多成员并行工作会增加模型调用与费用，请留意预算。",
      live: "实时", polling: "轮询", disconnected: "重新连接中", maxMembers: "成员上限 {count}", maxTurns: "并行回合 {count}",
      memberSection: "团队成员", spawn: "添加成员", name: "名称", role: "角色", prompt: "初始任务说明", model: "模型",
      namePlaceholder: "例如：研究员", rolePlaceholder: "例如：研究与核验", promptPlaceholder: "说明该成员的职责和首个任务…",
      modelPlaceholder: "留空使用默认模型", add: "添加", openConversation: "打开对话", message: "发送消息", messagePlaceholder: "给该成员发送后续指令…",
      send: "发送", interrupt: "中断", retire: "退役", lead: "负责人", unknown: "未知", noMembers: "暂无成员",
      taskBoard: "任务看板", pending: "待处理", in_progress: "进行中", completed: "已完成", noTasks: "暂无任务",
      createTask: "创建任务", taskTitle: "任务标题", taskDescription: "任务说明", dependencies: "依赖任务 ID（逗号分隔）", files: "可能修改的文件（逗号分隔）",
      fileScope: "文件范围：{value}", conflicts: "文件冲突风险：{value}", assignee: "负责人", unassigned: "未分配", create: "创建", assign: "分配", claim: "认领", complete: "完成", reopen: "重新打开",
      dependsOn: "依赖：{value}", blockedBy: "阻塞于：{value}", taskId: "任务 {id}", messages: "最近消息", noMessages: "暂无团队消息",
      closeTeam: "关闭团队", closeConfirm: "确定关闭这个团队吗？成员会被停止，未完成任务将保留在历史记录中。",
      retireConfirm: "确定让该成员退役吗？", enabledHint: "实验功能已启用。在负责人会话中直接要求创建团队；敏感团队变更只通过经过鉴权的模型工具执行。", manageHint: "打开成员会话可直接发消息或中断；创建成员、任务分配和关闭团队请在负责人会话中提出。",
      counts: "{members} 成员 · {active} 进行中 · {done} 已完成", current: "当前会话", state: "状态",
      settingsTitle: "代理团队", settingsDescription: "配置原生多代理团队实验功能和全局并发限制。更高的限制可能增加模型用量与费用。",
      settingsEnabled: "启用代理团队", settingsMaxMembers: "团队成员上限", settingsMaxActiveTurns: "最大并行回合数",
      settingsSave: "保存设置", settingsSaving: "正在保存…", settingsSaved: "设置已保存", settingsRange: "请输入 1 到 8 之间的整数。"
    };
    var en = {
      title: "Team Workbench", button: "Team", close: "Close", loading: "Loading team…", retry: "Retry",
      loadError: "Could not load team: {error}", actionError: "Action failed: {error}", experiment: "Agent Teams experiment",
      disabledBody: "This experiment is disabled. Enable it to coordinate continuable agents around a shared objective.",
      enable: "Enable experiment", enabling: "Enabling…", noTeam: "No team for this session", objective: "Team objective",
      objectivePlaceholder: "Describe the concrete objective the team should accomplish…", start: "Start team", starting: "Starting…",
      status: "Status", members: "Members", tasks: "Tasks", costWarning: "Parallel members increase model usage and cost. Keep an eye on your budget.",
      live: "Live", polling: "Polling", disconnected: "Reconnecting", maxMembers: "Up to {count} members", maxTurns: "{count} active turns",
      memberSection: "Team members", spawn: "Add member", name: "Name", role: "Role", prompt: "Initial prompt", model: "Model",
      namePlaceholder: "e.g. Researcher", rolePlaceholder: "e.g. Research and verification", promptPlaceholder: "Describe this member's role and first assignment…",
      modelPlaceholder: "Leave blank for the default model", add: "Add", openConversation: "Open conversation", message: "Message", messagePlaceholder: "Send this member a follow-up…",
      send: "Send", interrupt: "Interrupt", retire: "Retire", lead: "Lead", unknown: "Unknown", noMembers: "No members yet",
      taskBoard: "Task board", pending: "Pending", in_progress: "In progress", completed: "Completed", noTasks: "No tasks",
      createTask: "Create task", taskTitle: "Task title", taskDescription: "Task description", dependencies: "Dependency task IDs (comma-separated)", files: "Files this task may edit (comma-separated)",
      fileScope: "Files: {value}", conflicts: "File conflict risk: {value}", assignee: "Assignee", unassigned: "Unassigned", create: "Create", assign: "Assign", claim: "Claim", complete: "Complete", reopen: "Reopen",
      dependsOn: "Depends on: {value}", blockedBy: "Blocked by: {value}", taskId: "Task {id}", messages: "Recent messages", noMessages: "No team messages",
      closeTeam: "Close team", closeConfirm: "Close this team? Members will be stopped and unfinished tasks retained in history.",
      retireConfirm: "Retire this member?", enabledHint: "The experiment is enabled. Ask the lead conversation to create a team; sensitive team mutations run only through authenticated model tools.", manageHint: "Open a member conversation to message or interrupt it. Ask the lead conversation to add members, assign tasks, or close the team.",
      counts: "{members} members · {active} active · {done} done", current: "Current session", state: "State",
      settingsTitle: "Agent Teams", settingsDescription: "Configure the native multi-agent team experiment and its global concurrency limits. Higher limits may increase model usage and cost.",
      settingsEnabled: "Enable Agent Teams", settingsMaxMembers: "Maximum team members", settingsMaxActiveTurns: "Maximum active turns",
      settingsSave: "Save settings", settingsSaving: "Saving…", settingsSaved: "Settings saved", settingsRange: "Enter a whole number from 1 to 8."
    };
    var currentLang = ((typeof navigator !== "undefined" && navigator.language) || "en").toLowerCase().indexOf("zh") === 0 ? "zh" : "en";
    var translate = function (key, vars) {
      var text = (currentLang === "zh" ? zh : en)[key] || key;
      Object.keys(vars || {}).forEach(function (name) { text = text.split("{" + name + "}").join(String(vars[name])); });
      return text;
    };
    var localeListeners = [];
    function useLocale() {
      var pair = useState(0);
      useEffect(function () {
        var cb = function () { pair[1](function (n) { return n + 1; }); };
        localeListeners.push(cb);
        return function () { localeListeners = localeListeners.filter(function (item) { return item !== cb; }); };
      }, []);
      return translate;
    }

    function injectStyles() {
      if (document.getElementById("dsh-agent-teams-client-style")) return;
      var style = document.createElement("style");
      style.id = "dsh-agent-teams-client-style";
      style.textContent = [
        ".dat-btn{font:inherit;border:1px solid var(--dsw-alias-border-l3);border-radius:7px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);padding:5px 9px;cursor:pointer;line-height:1.25}",
        ".dat-btn:hover{background:var(--dsw-alias-interactive-bg-hover)}.dat-btn:focus-visible,.dat-field:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}",
        ".dat-btn:disabled{opacity:.5;cursor:not-allowed}.dat-primary{background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground);border-color:transparent}",
        ".dat-danger{color:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-state-error-secondary)}.dat-compact{padding:3px 7px;font-size:12px;white-space:nowrap}",
        ".dat-overlay{position:fixed;inset:0;z-index:2400;display:grid;place-items:center;padding:16px;background:rgba(0,0,0,.46);backdrop-filter:blur(3px)}",
        ".dat-modal{width:min(1040px,calc(100vw - 32px));max-height:calc(100vh - 32px);overflow:auto;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);border-radius:14px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);box-shadow:var(--dsw-shadow-lv4,0 22px 65px rgba(0,0,0,.35));font-family:var(--dsw-font-family,system-ui,sans-serif)}",
        ".dat-modal-head{position:sticky;top:0;z-index:2;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 16px;border-bottom:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1)}",
        ".dat-body{padding:14px 16px}.dat-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.dat-between{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap}",
        ".dat-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(245px,1fr));gap:10px}.dat-card{border:1px solid var(--dsw-alias-border-l2);border-radius:10px;padding:11px;background:var(--dsw-alias-bg-layer-2);min-width:0}",
        ".dat-field{box-sizing:border-box;width:100%;min-width:0;border:1px solid var(--dsw-alias-border-l3);border-radius:7px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);padding:7px 9px;font:inherit;font-size:13px}",
        ".dat-label{display:block;font-size:12px;color:var(--dsw-alias-label-secondary);margin:7px 0 4px}.dat-meta{font-size:12px;color:var(--dsw-alias-label-tertiary);overflow-wrap:anywhere}.dat-section{margin-top:16px}.dat-section h3{font-size:14px;margin:0 0 8px}",
        ".dat-badge{display:inline-flex;align-items:center;border:1px solid var(--dsw-alias-border-l3);border-radius:999px;padding:2px 7px;font-size:11px;color:var(--dsw-alias-label-secondary)}",
        ".dat-dot{width:7px;height:7px;border-radius:50%;background:var(--dsw-alias-state-success-primary);display:inline-block;margin-right:5px}.dat-warn{border:1px solid var(--dsw-alias-state-warn-secondary);background:var(--dsw-alias-state-warn-tertiary,var(--dsw-alias-bg-layer-2));color:var(--dsw-alias-state-warn-primary);border-radius:8px;padding:8px 10px;font-size:12px;margin-top:10px}",
        ".dat-error{color:var(--dsw-alias-state-error-primary);font-size:12px;margin:8px 0}.dat-empty{text-align:center;padding:28px 12px;color:var(--dsw-alias-label-secondary)}",
        ".dat-dock{width:100%;box-sizing:border-box;display:flex;align-items:center;justify-content:space-between;gap:10px;padding:5px 9px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font-size:12px;cursor:pointer;text-align:left}",
        ".dat-task-title{font-weight:600;font-size:13px;overflow-wrap:anywhere}.dat-columns{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}.dat-column{min-width:0}.dat-column>h4{font-size:12px;margin:0 0 6px;color:var(--dsw-alias-label-secondary)}",
        ".dat-message{border-left:2px solid var(--dsw-alias-brand-primary);padding:4px 8px;margin:5px 0;font-size:12px;overflow-wrap:anywhere}.dat-sr{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}",
        "@media(max-width:720px){.dat-overlay{padding:0;align-items:end}.dat-modal{width:100vw;max-height:94vh;border-radius:14px 14px 0 0}.dat-body{padding:12px}.dat-columns{grid-template-columns:1fr}.dat-grid{grid-template-columns:1fr}}"
      ].join("\n");
      document.head.appendChild(style);
    }

    function errorText(error) { return error && error.message ? error.message : String(error || "unknown"); }
    function stateUrl(sessionId) { return "/api/agent-teams/state?sessionId=" + encodeURIComponent(sessionId); }
    function eventsUrl(sessionId) { return "/api/agent-teams/events?sessionId=" + encodeURIComponent(sessionId); }
    function fetchState(sessionId) {
      return fetch(stateUrl(sessionId), { method: "GET", credentials: "same-origin", headers: { Accept: "application/json" } }).then(function (response) {
        return response.json().catch(function () { return {}; }).then(function (data) {
          if (!response.ok) throw new Error(data.error || ("HTTP " + response.status));
          return data;
        });
      });
    }
    function postAction(sessionId, action, payload) {
      return fetch("/api/agent-teams/action", {
        method: "POST", credentials: "same-origin",
        headers: { "content-type": "application/json", Accept: "application/json", "x-harness-agent-teams": "1" },
        body: JSON.stringify(Object.assign({ sessionId: sessionId, action: action }, payload || {}))
      }).then(function (response) {
        return response.json().catch(function () { return {}; }).then(function (data) {
          if (!response.ok) throw new Error(data.error || ("HTTP " + response.status));
          return data;
        });
      });
    }

    function useTeamState(sessionId) {
      var statePair = useState(null), state = statePair[0], setState = statePair[1];
      var errorPair = useState(""), error = errorPair[0], setError = errorPair[1];
      var connectionPair = useState("disconnected"), connection = connectionPair[0], setConnection = connectionPair[1];
      var reloadRef = useRef(function () {});
      useEffect(function () {
        if (!sessionId) return;
        var alive = true, source = null, poll = null;
        function load(silent) {
          return fetchState(sessionId).then(function (next) {
            if (!alive) return next;
            setState(next); setError("");
            return next;
          }).catch(function (err) {
            if (alive && !silent) setError(errorText(err));
            throw err;
          });
        }
        function beginPolling() {
          if (!alive || poll) return;
          setConnection("polling");
          poll = setInterval(function () { load(true).catch(function () {}); }, 4000);
        }
        reloadRef.current = function () { return load(false); };
        load(false).catch(function () {});
        if (typeof EventSource === "function") {
          try {
            source = new EventSource(eventsUrl(sessionId));
            source.onopen = function () { if (alive) setConnection("live"); };
            var handleEvent = function (event) {
              if (!alive) return;
              try {
                var next = JSON.parse(event.data);
                if (next && typeof next.enabled === "boolean" && Object.prototype.hasOwnProperty.call(next, "team")) { setState(next); setError(""); }
                else if (next && next.state && typeof next.state.enabled === "boolean") { setState(next.state); setError(""); }
                else load(true).catch(function () {});
              } catch (_) { load(true).catch(function () {}); }
            };
            source.onmessage = handleEvent;
            source.addEventListener("snapshot", handleEvent);
            source.addEventListener("state", handleEvent);
            source.addEventListener("update", handleEvent);
            source.onerror = function () {
              if (source) { source.close(); source = null; }
              beginPolling();
            };
          } catch (_) { beginPolling(); }
        } else beginPolling();
        return function () { alive = false; if (source) source.close(); if (poll) clearInterval(poll); };
      }, [sessionId]);
      return { state: state, setState: setState, error: error, setError: setError, connection: connection, reload: function () { return reloadRef.current(); } };
    }

    function FormField(props) {
      return h("label", null, h("span", { className: "dat-label" }, props.label), props.multiline
        ? h("textarea", { className: "dat-field", rows: props.rows || 3, value: props.value, placeholder: props.placeholder, required: props.required, onChange: function (e) { props.onChange(e.target.value); } })
        : h("input", { className: "dat-field", type: props.type || "text", value: props.value, placeholder: props.placeholder, required: props.required, min: props.min, max: props.max, step: props.step, onChange: function (e) { props.onChange(e.target.value); } }));
    }
    function Button(props) {
      return h("button", { type: props.type || "button", className: "dat-btn" + (props.primary ? " dat-primary" : "") + (props.danger ? " dat-danger" : "") + (props.compact ? " dat-compact" : ""), disabled: props.disabled, title: props.title, "aria-label": props.ariaLabel || props.title, onClick: props.onClick }, props.children);
    }
    function arrayText(value) {
      if (!value) return "";
      return (Array.isArray(value) ? value : [value]).map(function (item) { return typeof item === "object" ? (item.title || item.name || item.id || JSON.stringify(item)) : item; }).join(", ");
    }
    function memberId(member) { return member.id || member.memberId || member.sessionId || member.childSessionId; }
    function memberSession(member) { return member.childSessionId || member.sessionId || member.id; }
    function taskId(task) { return task.id || task.taskId; }

    function MemberCard(props) {
      var t = props.t, member = props.member;
      var child = memberSession(member);
      return h("article", { className: "dat-card" },
        h("div", { className: "dat-between" },
          h("div", null, h("div", { style: { fontWeight: 650 } }, member.name || child || t("unknown"), member.isLead || child === props.team.leadSessionId ? h("span", { className: "dat-badge", style: { marginLeft: 6 } }, t("lead")) : null), h("div", { className: "dat-meta" }, member.role || t("unknown"))),
          h("span", { className: "dat-badge" }, member.state || member.status || t("unknown"))
        ),
        h("div", { className: "dat-meta", style: { marginTop: 6 } }, t("model") + ": " + (member.model || t("unknown"))),
        h("div", { className: "dat-row", style: { marginTop: 8 } },
          child ? h(Button, { compact: true, onClick: function () { props.open(child); } }, t("openConversation")) : null
        ),
        h("div", { className: "dat-meta", style: { marginTop: 8 } }, t("manageHint"))
      );
    }

    function TaskCard(props) {
      var t = props.t, task = props.task, id = taskId(task);
      var assigned = task.assigneeId || task.assignee || task.memberId || "";
      return h("article", { className: "dat-card", style: { marginBottom: 7 } },
        h("div", { className: "dat-task-title" }, task.title || task.name || t("taskId", { id: id })),
        task.description ? h("div", { className: "dat-meta", style: { marginTop: 4 } }, task.description) : null,
        h("div", { className: "dat-meta", style: { marginTop: 5 } }, "#" + id + " · " + t("assignee") + ": " + (props.memberName(assigned) || t("unassigned"))),
        arrayText(task.dependencies || task.dependsOn) ? h("div", { className: "dat-meta" }, t("dependsOn", { value: arrayText(task.dependencies || task.dependsOn) })) : null,
        arrayText(task.blockedBy) ? h("div", { className: "dat-meta", style: { color: "var(--dsw-alias-state-warn-primary)" } }, t("blockedBy", { value: arrayText(task.blockedBy) })) : null,
        arrayText(task.files) ? h("div", { className: "dat-meta" }, t("fileScope", { value: arrayText(task.files) })) : null,
        arrayText(task.conflictsWith) ? h("div", { className: "dat-meta", style: { color: "var(--dsw-alias-state-error-primary)" } }, t("conflicts", { value: arrayText(task.conflictsWith) })) : null
      );
    }

    function Workbench(props) {
      var t = useLocale(), live = props.live, snapshot = live.state;
      var busyPair = useState(""), busy = busyPair[0], setBusy = busyPair[1];
      var localErrorPair = useState(""), localError = localErrorPair[0], setLocalError = localErrorPair[1];
      var closeRef = useRef(null);
      useEffect(function () {
        function keydown(event) { if (event.key === "Escape") props.onClose(); }
        document.addEventListener("keydown", keydown); if (closeRef.current) closeRef.current.focus();
        return function () { document.removeEventListener("keydown", keydown); };
      }, []);
      function act(action, payload) {
        setBusy(action); setLocalError("");
        return postAction(props.sessionId, action, payload).then(function (result) {
          if (result && typeof result.enabled === "boolean" && Object.prototype.hasOwnProperty.call(result, "team")) live.setState(result);
          else if (result && result.state && typeof result.state.enabled === "boolean") live.setState(result.state);
          else return live.reload();
          return result;
        }).catch(function (err) { setLocalError(errorText(err)); throw err; }).finally(function () { setBusy(""); });
      }
      function openChild(childSessionId) { props.sessions.openSubagent({ parentSessionId: (snapshot && snapshot.team && snapshot.team.leadSessionId) || props.sessionId, childSessionId: childSessionId, mode: "continuable" }); props.onClose(); }
      var team = snapshot && snapshot.team;
      var config = snapshot && snapshot.config || {};
      var members = team && team.members || [], tasks = team && team.tasks || [];
      function nameFor(id) { var match = members.filter(function (m) { return memberId(m) === id || memberSession(m) === id; })[0]; return match && (match.name || memberId(match)); }
      var connectionKey = live.connection === "live" ? "live" : (live.connection === "polling" ? "polling" : "disconnected");
      return h("div", { className: "dat-overlay", onMouseDown: function (e) { if (e.target === e.currentTarget) props.onClose(); } },
        h("section", { className: "dat-modal", role: "dialog", "aria-modal": "true", "aria-labelledby": "dat-title" },
          h("header", { className: "dat-modal-head" }, h("div", null, h("div", { id: "dat-title", style: { fontWeight: 700 } }, t("title")), h("div", { className: "dat-meta" }, h("span", { className: "dat-dot", style: live.connection === "live" ? null : { background: "var(--dsw-alias-state-warn-primary)" } }), t(connectionKey))), h(Button, { compact: true, onClick: props.onClose, ariaLabel: t("close"), title: t("close") }, "×")),
          h("div", { className: "dat-body" },
            live.error ? h("div", { className: "dat-error" }, t("loadError", { error: live.error }), " ", h(Button, { compact: true, onClick: live.reload }, t("retry"))) : null,
            localError ? h("div", { className: "dat-error", role: "alert" }, t("actionError", { error: localError })) : null,
            !snapshot ? h("div", { className: "dat-empty" }, t("loading")) : !snapshot.enabled ? h("div", { className: "dat-empty" }, h("h3", null, t("experiment")), h("p", null, t("disabledBody")), h("label", { className: "dat-row", style: { justifyContent: "center", cursor: busy ? "default" : "pointer" } }, h("input", { type: "checkbox", role: "switch", checked: false, disabled: !!busy, onChange: function (event) { act("settings", { enabled: event.target.checked }).catch(function () {}); } }), h("strong", null, busy ? t("enabling") : t("enable")))) : !team ? h("div", { className: "dat-empty" },
              h("h3", null, t("noTeam")), h("p", { className: "dat-meta" }, t("enabledHint"))
            ) : h(React.Fragment, null,
              h("div", { className: "dat-between" }, h("div", { style: { minWidth: 0, flex: "1 1 420px" } }, h("div", { className: "dat-row" }, h("span", { className: "dat-badge" }, t("status") + ": " + (team.status || t("unknown"))), h("span", { className: "dat-badge" }, t("maxMembers", { count: config.maxMembers || "–" })), h("span", { className: "dat-badge" }, t("maxTurns", { count: config.maxActiveTurns || "–" }))), h("h2", { style: { fontSize: 17, margin: "8px 0 3px", overflowWrap: "anywhere" } }, team.objective), h("div", { className: "dat-meta" }, "#" + team.id + " · rev " + team.revision)), h("span", { className: "dat-meta" }, t("manageHint"))),
              h("div", { className: "dat-warn" }, t("costWarning")),
              h("section", { className: "dat-section" }, h("div", { className: "dat-between" }, h("h3", null, t("memberSection") + " (" + members.length + ")"), h("span", { className: "dat-meta" }, t("current") + ": " + props.sessionId)), members.length ? h("div", { className: "dat-grid" }, members.map(function (member) { return h(MemberCard, { key: memberId(member), t: t, member: member, team: team, open: openChild }); })) : h("div", { className: "dat-card dat-meta" }, t("noMembers")),
                h("div", { className: "dat-meta", style: { marginTop: 10 } }, t("manageHint"))
              ),
              h("section", { className: "dat-section" }, h("h3", null, t("taskBoard") + " (" + tasks.length + ")"), h("div", { className: "dat-columns" }, ["pending", "in_progress", "completed"].map(function (status) { var list = tasks.filter(function (taskItem) { return (taskItem.status || "pending") === status; }); return h("div", { className: "dat-column", key: status }, h("h4", null, t(status) + " · " + list.length), list.length ? list.map(function (taskItem) { return h(TaskCard, { key: taskId(taskItem), t: t, task: taskItem, memberName: nameFor }); }) : h("div", { className: "dat-card dat-meta" }, t("noTasks"))); })),
                h("div", { className: "dat-meta", style: { marginTop: 10 } }, t("manageHint"))
              ),
              h("section", { className: "dat-section" }, h("h3", null, t("messages")), (team.messages || []).length ? h("div", { className: "dat-card" }, team.messages.slice(-8).reverse().map(function (msg, index) { return h("div", { className: "dat-message", key: msg.id || index }, h("strong", null, msg.fromName || msg.memberName || msg.from || t("unknown")), " — ", msg.text || msg.message || "", msg.createdAt ? h("div", { className: "dat-meta" }, new Date(msg.createdAt).toLocaleString()) : null); })) : h("div", { className: "dat-card dat-meta" }, t("noMessages")))
            )
          )
        )
      );
    }

    function TeamEntry(props) {
      var t = useLocale();
      var openPair = useState(false), open = openPair[0], setOpen = openPair[1];
      var live = useTeamState(props.sessionId);
      return h(React.Fragment, null, h(Button, { compact: true, title: t("title"), onClick: function () { setOpen(true); } }, "⚭ ", t("button"), live.state && live.state.team ? h("span", { className: "dat-badge", style: { marginLeft: 5 } }, (live.state.team.members || []).length) : null), open ? h(Workbench, { sessionId: props.sessionId, sessions: props.sessions, live: live, onClose: function () { setOpen(false); } }) : null);
    }
    function TeamDock(props) {
      var t = useLocale();
      var openPair = useState(false), open = openPair[0], setOpen = openPair[1];
      var live = useTeamState(props.sessionId);
      var team = live.state && live.state.team;
      if (!team) return null;
      var members = team.members || [], tasks = team.tasks || [];
      var active = tasks.filter(function (item) { return item.status === "in_progress"; }).length;
      var done = tasks.filter(function (item) { return item.status === "completed"; }).length;
      return h(React.Fragment, null, h("button", { type: "button", className: "dat-dock", onClick: function () { setOpen(true); }, "aria-label": t("title") }, h("span", null, "⚭ ", h("strong", null, t("title")), " · ", team.objective), h("span", { style: { whiteSpace: "nowrap" } }, t("counts", { members: members.length, active: active, done: done }))), open ? h(Workbench, { sessionId: props.sessionId, sessions: props.sessions, live: live, onClose: function () { setOpen(false); } }) : null);
    }

    function resolveSettingsSessionId(sessions) {
      try {
        var current = sessions && sessions.list && sessions.list.getSnapshot().current;
        if (typeof current === "string" && current) return current;
        if (current && (current.sessionId || current.id)) return current.sessionId || current.id;
      } catch (_) {}
      return "settings";
    }
    function useSettingsSessionId(sessions) {
      var pair = useState(function () { return resolveSettingsSessionId(sessions); });
      useEffect(function () {
        if (!sessions || !sessions.list || typeof sessions.list.subscribe !== "function") return;
        return sessions.list.subscribe(function () { pair[1](resolveSettingsSessionId(sessions)); });
      }, [sessions]);
      return pair[0];
    }
    function AgentTeamsSettings(props) {
      var t = useLocale();
      var sessionId = useSettingsSessionId(props.sessions);
      var valuesPair = useState({ enabled: false, maxMembers: 4, maxActiveTurns: 2 }), values = valuesPair[0], setValues = valuesPair[1];
      var loadingPair = useState(true), loading = loadingPair[0], setLoading = loadingPair[1];
      var savingPair = useState(false), saving = savingPair[0], setSaving = savingPair[1];
      var errorPair = useState(""), error = errorPair[0], setError = errorPair[1];
      var savedPair = useState(false), saved = savedPair[0], setSaved = savedPair[1];
      useEffect(function () {
        var alive = true;
        setLoading(true); setError(""); setSaved(false);
        fetchState(sessionId).then(function (state) {
          if (!alive) return;
          var config = state.config || {};
          setValues({ enabled: !!state.enabled, maxMembers: Number(config.maxMembers) || 4, maxActiveTurns: Number(config.maxActiveTurns) || 2 });
        }).catch(function (err) { if (alive) setError(errorText(err)); }).finally(function () { if (alive) setLoading(false); });
        return function () { alive = false; };
      }, [sessionId]);
      function numberInRange(value) { var number = Number(value); return Number.isInteger(number) && number >= 1 && number <= 8; }
      function submit(event) {
        event.preventDefault();
        if (!numberInRange(values.maxMembers) || !numberInRange(values.maxActiveTurns)) { setError(t("settingsRange")); return; }
        var payload = { enabled: !!values.enabled, maxMembers: Number(values.maxMembers), maxActiveTurns: Number(values.maxActiveTurns) };
        setSaving(true); setSaved(false); setError("");
        postAction(sessionId, "settings", payload).then(function () { setSaved(true); }).catch(function (err) { setError(errorText(err)); }).finally(function () { setSaving(false); });
      }
      return h("section", { style: { maxWidth: 680, color: "var(--dsw-alias-label-primary)", fontFamily: "var(--dsw-font-family,system-ui,sans-serif)" }, "aria-labelledby": "dat-settings-title" },
        h("h2", { id: "dat-settings-title", style: { fontSize: 17, margin: "0 0 4px" } }, t("settingsTitle")),
        h("p", { className: "dat-meta", style: { margin: "0 0 14px", lineHeight: 1.5 } }, t("settingsDescription")),
        loading ? h("div", { className: "dat-meta" }, t("loading")) : h("form", { onSubmit: submit, className: "dat-card" },
          h("label", { className: "dat-between", style: { alignItems: "center", cursor: saving ? "default" : "pointer" } }, h("span", { style: { fontWeight: 600, fontSize: 13 } }, t("settingsEnabled")), h("input", { type: "checkbox", role: "switch", checked: values.enabled, disabled: saving, onChange: function (event) { setValues(Object.assign({}, values, { enabled: event.target.checked })); setSaved(false); } })),
          h("div", { className: "dat-grid", style: { marginTop: 9 } },
            h(FormField, { label: t("settingsMaxMembers"), type: "number", min: 1, max: 8, step: 1, value: values.maxMembers, onChange: function (value) { setValues(Object.assign({}, values, { maxMembers: value })); setSaved(false); } }),
            h(FormField, { label: t("settingsMaxActiveTurns"), type: "number", min: 1, max: 8, step: 1, value: values.maxActiveTurns, onChange: function (value) { setValues(Object.assign({}, values, { maxActiveTurns: value })); setSaved(false); } })
          ),
          h("div", { className: "dat-between", style: { alignItems: "center", marginTop: 11 } }, h("div", null, error ? h("span", { className: "dat-error", role: "alert" }, t("actionError", { error: error })) : null, saved ? h("span", { className: "dat-meta", role: "status", style: { color: "var(--dsw-alias-state-success-primary)" } }, t("settingsSaved")) : null), h(Button, { type: "submit", primary: true, disabled: saving }, saving ? t("settingsSaving") : t("settingsSave")))
        )
      );
    }

    function apply(ctx) {
      injectStyles();
      try { ctx.effect(function () { return ctx.locale.register(NS, { zh: zh, en: en }); }, "agent-teams: dictionaries"); } catch (_) {}
      try { translate = ctx.locale.bind(NS); } catch (_) {}
      try { currentLang = ctx.locale.getLocale().active || currentLang; } catch (_) {}
      try { ctx.locale.subscribe(function () { try { currentLang = ctx.locale.getLocale().active || currentLang; } catch (_) {} localeListeners.slice().forEach(function (listener) { listener(); }); }); } catch (_) {}
      function Header(props) { return h(TeamEntry, { sessionId: props.sessionId, sessions: ctx.sessions }); }
      function Dock(props) { return h(TeamDock, { sessionId: props.sessionId, sessions: ctx.sessions }); }
      function Settings() { return h(AgentTeamsSettings, { sessions: ctx.sessions }); }
      ctx.slots.inject("settings.section", function () { return ctx.slots.register({ name: "settings.section", id: "agent-teams-settings", order: 35, locale: NS, label: function () { return translate("settingsTitle"); } }, Settings); });
      ctx.slots.inject("conversation.session.header.actions", function () { return ctx.slots.register({ name: "conversation.session.header.actions", id: "agent-teams", order: 30, locale: NS, label: function () { return translate("title"); } }, Header); });
      ctx.slots.inject("conversation.input.dock", function () { return ctx.slots.register({ name: "conversation.input.dock", id: "agent-teams", order: 30, locale: NS, label: function () { return translate("title"); } }, Dock); });
    }

    exports.apply = apply;
    exports.inject = ["slots", "locale", "sessions"];
    return module.exports;
  }
});
