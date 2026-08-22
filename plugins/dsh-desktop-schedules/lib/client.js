window.__ModuleLoader__.load({
  id: "dsh-desktop-schedules",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    var React = require("react");
    var h = React.createElement;
    var useEffect = React.useEffect;
    var useState = React.useState;
    var NS = "desktop-schedules";
    var zh = {
      title: "已安排的任务",
      scope: "当前会话",
      intro: "让 Harness 安排任务、设置提醒或定期检查；所有变更都会先进入输入框供你确认。",
      search: "搜索已安排任务",
      all: "全部",
      activeFilter: "活动",
      disabledFilter: "已停用",
      suggestions: "建议",
      suggestionDaily: "每日简报",
      suggestionDailyHint: "工作日早上整理日历、未读消息和优先事项",
      suggestionWeekly: "每周回顾",
      suggestionWeeklyHint: "每周五整理最近的工作进展",
      suggestionMonitor: "跟进监控",
      suggestionMonitorHint: "检查最近的构建和部署状态",
      historyTitle: "最近活动",
      historyEmpty: "暂无运行或停用记录",
      showCreate: "创建",
      hideCreate: "收起创建",
      disable: "准备停用",
      enable: "准备重新创建",
      created: "已创建",
      deleted: "已停用",
      dispatched: "已触发",
      limitationTitle: "仅在会话运行时触发",
      limitation: "仅当前会话运行：退出应用或会话未恢复时不会唤醒系统；重新打开会话后，逾期任务会补发。",
      loading: "正在读取定时任务…",
      retry: "重试",
      unavailable: "当前会话尚未运行，打开或继续该会话后即可查看定时任务。",
      none: "暂无定时任务",
      emptyHint: "创建后的提醒会显示在这里，并标注下次触发时间和运行状态。",
      scheduled: "等待中",
      overdue: "已逾期，等待会话空闲后补发",
      after: "延时一次",
      at: "指定时间一次",
      every: "固定频率",
      createTitle: "新建提醒",
      createHint: "填写规则后，先生成一条待确认请求，不会直接发送。",
      create: "准备创建",
      delete: "准备删除",
      deleteAria: "删除定时任务 {id}",
      prompt: "提醒内容",
      mode: "运行方式",
      value: "时间参数",
      afterHint: "延时秒数（正整数）",
      everyHint: "间隔秒数（至少 300）",
      atHint: "本地日期和时间",
      draftReady: "请求已放入输入框；请检查后手动发送。",
      invalid: "请填写提醒内容和有效时间。固定频率至少为 300 秒。",
      draftUnavailable: "当前输入框不可用，请返回对话后重试。",
      id: "任务 ID",
      next: "下次触发",
      activeTitle: "活动提醒",
      count: "{count} 项",
      refresh: "刷新",
      error: "无法读取：{error}",
      sessionLocal: "会话级"
    };
    var en = {
      title: "Scheduled tasks",
      scope: "Current session",
      intro: "Let Harness schedule work, reminders, or recurring checks. Every change is placed in the composer for review first.",
      search: "Search scheduled tasks",
      all: "All",
      activeFilter: "Active",
      disabledFilter: "Disabled",
      suggestions: "Suggestions",
      suggestionDaily: "Daily briefing",
      suggestionDailyHint: "Review the calendar, unread messages, and priorities each workday morning",
      suggestionWeekly: "Weekly recap",
      suggestionWeeklyHint: "Summarize recent progress every Friday",
      suggestionMonitor: "Follow-up monitor",
      suggestionMonitorHint: "Check recent build and deployment status",
      historyTitle: "Recent activity",
      historyEmpty: "No run or disabled history yet",
      showCreate: "Create",
      hideCreate: "Hide create form",
      disable: "Prepare disable",
      enable: "Prepare recreate",
      created: "Created",
      deleted: "Disabled",
      dispatched: "Ran",
      limitationTitle: "Runs only while this session is active",
      limitation: "Session-local only: closing the app or leaving the session does not wake the OS. Overdue reminders are delivered after this session resumes.",
      loading: "Loading schedules…",
      retry: "Retry",
      unavailable: "This session is not live. Open or continue it to inspect schedules.",
      none: "No schedules yet",
      emptyHint: "Created reminders appear here with their next run time and current status.",
      scheduled: "Scheduled",
      overdue: "Overdue; waiting for this session to become idle",
      after: "One time after delay",
      at: "One time at date",
      every: "Fixed rate",
      createTitle: "New reminder",
      createHint: "Build a reviewable request first. Nothing is sent automatically.",
      create: "Prepare request",
      delete: "Prepare delete",
      deleteAria: "Delete schedule {id}",
      prompt: "Reminder",
      mode: "Rule",
      value: "Time",
      afterHint: "Delay in seconds (positive integer)",
      everyHint: "Interval in seconds (at least 300)",
      atHint: "Local date and time",
      draftReady: "Request added to the composer. Review it, then send manually.",
      invalid: "Enter reminder text and a valid time. Fixed rate must be at least 300 seconds.",
      draftUnavailable: "The composer is unavailable. Return to Chat and try again.",
      id: "Schedule ID",
      next: "Next run",
      activeTitle: "Active reminders",
      count: "{count}",
      refresh: "Refresh",
      error: "Unable to load: {error}",
      sessionLocal: "Session local"
    };
    var lang = ((navigator.language || "en").toLowerCase().indexOf("zh") === 0) ? "zh" : "en";
    function t(key, values) {
      var text = (lang === "zh" ? zh : en)[key] || key;
      Object.keys(values || {}).forEach(function (name) {
        text = text.replace("{" + name + "}", String(values[name]));
      });
      return text;
    }
    function Icon(props) {
      var name = props.name;
      var nodes;
      if (name === "clock") {
        nodes = [
          h("circle", { key: "c", cx: 12, cy: 12, r: 8.5 }),
          h("path", { key: "p", d: "M12 7.5V12l3 1.8" })
        ];
      } else if (name === "refresh") {
        nodes = [h("path", { key: "p", d: "M19.2 8A7.8 7.8 0 1 0 20 13M19.2 8V3.8M19.2 8H15" })];
      } else if (name === "notice") {
        nodes = [
          h("path", { key: "p", d: "M12 3.5 19 6v5c0 4.2-2.5 7.3-7 9.5C7.5 18.3 5 15.2 5 11V6l7-2.5Z" }),
          h("path", { key: "i", d: "M12 8v4.2M12 15.5h.01" })
        ];
      } else if (name === "plus") {
        nodes = [h("path", { key: "p", d: "M12 5v14M5 12h14" })];
      } else if (name === "trash") {
        nodes = [h("path", { key: "p", d: "M5.5 7.5h13M9 7.5V5h6v2.5m2 0-.7 11H7.7L7 7.5m3.2 3v5m3.6-5v5" })];
      } else {
        nodes = [
          h("path", { key: "p", d: "M6 4.5h12a2 2 0 0 1 2 2v12H4v-12a2 2 0 0 1 2-2ZM8 2.8v3.4M16 2.8v3.4M4 9h16" }),
          h("path", { key: "d", d: "M8 13h3M8 16h6" })
        ];
      }
      return h("svg", {
        className: "dds-icon" + (props.className ? " " + props.className : ""),
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
      var style = document.querySelector("style[data-plugin='dsh-desktop-schedules']");
      if (!style) {
        style = document.createElement("style");
        style.dataset.plugin = "dsh-desktop-schedules";
      }
      style.textContent = `
        .dds-view{box-sizing:border-box;height:auto;min-height:100%;overflow:visible;padding:30px clamp(20px,4vw,48px) 72px;color:var(--dsw-alias-label-primary)}
        .dds-shell{width:min(100%,760px);margin:0 auto;display:grid;gap:18px}
        .dds-head{display:flex;align-items:center;justify-content:space-between;gap:24px;padding:2px 2px 4px}
        .dds-heading{display:flex;align-items:center;gap:14px;min-width:0}
        .dds-heading-icon,.dds-kicker{display:none}
        .dds-title{margin:0;font-size:28px;line-height:36px;font-weight:600;letter-spacing:-.02em}
        .dds-sub{max-width:680px;margin:4px 0 0;color:var(--dsw-alias-label-secondary);font-size:14px;line-height:21px}
        .dds-head-actions{display:flex;align-items:center;gap:8px}
        .dds-search{position:relative;display:block}
        .dds-search input{box-sizing:border-box;width:100%;height:38px;border:1px solid var(--dsw-alias-border-l1);border-radius:999px;padding:0 16px 0 38px;color:var(--dsw-alias-label-primary);background:var(--dsw-specific-input-major);font:inherit}
        .dds-search::before{content:"⌕";position:absolute;left:14px;top:8px;color:var(--dsw-alias-label-tertiary);font-size:17px}
        .dds-filters{display:flex;align-items:center;gap:4px;margin-top:-10px}.dds-filter{min-height:30px;border:0;border-bottom:2px solid transparent;border-radius:0;padding:0 9px;color:var(--dsw-alias-label-secondary);background:transparent;cursor:pointer}.dds-filter:hover{color:var(--dsw-alias-label-primary)}.dds-filter[aria-pressed="true"]{border-bottom-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary)}
        .dds-suggestions{display:grid;gap:4px;padding:2px 6px}
        .dds-section-label{margin:0 0 7px;color:var(--dsw-alias-label-secondary);font-size:14px;font-weight:500}
        .dds-suggestion{display:grid;grid-template-columns:24px minmax(0,1fr);gap:3px 10px;width:100%;border:0;border-radius:10px;padding:10px;color:var(--dsw-alias-label-primary);background:transparent;text-align:left;cursor:pointer}
        .dds-suggestion:hover{background:var(--dsw-alias-bg-layer-2)}
        .dds-suggestion .dds-icon{grid-row:1/3;width:17px;height:17px;margin-top:2px;color:var(--dsw-alias-brand-primary)}
        .dds-suggestion strong{font-size:14px;font-weight:500}.dds-suggestion span{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}
        .dds-create.is-collapsed{display:none}
        .dds-history-list{display:grid;gap:6px}.dds-history-item{display:flex;align-items:center;gap:10px;border-top:1px solid color-mix(in srgb,var(--dsw-alias-border-l1) 70%,transparent);padding:10px 2px}.dds-history-item:first-child{border-top:0}.dds-history-copy{display:grid;flex:1;min-width:0;gap:3px}.dds-history-copy strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px}.dds-history-copy span{color:var(--dsw-alias-label-tertiary);font-size:12px}
        .dds-icon{width:19px;height:19px;display:block;flex:none}
        .dds-button{box-sizing:border-box;min-height:36px;display:inline-flex;align-items:center;justify-content:center;gap:7px;border:1px solid var(--dsw-alias-border-l1);border-radius:9px;padding:0 13px;color:var(--dsw-alias-label-primary);background:color-mix(in srgb,var(--dsw-specific-button-secondary) 88%,transparent);font:inherit;font-size:13px;cursor:pointer;transition:border-color .16s ease,background .16s ease,transform .16s ease,box-shadow .16s ease}
        .dds-button:hover:not(:disabled){border-color:var(--dsw-alias-border-l2);background:var(--dsw-specific-button-secondary-hover)}
        .dds-button:active:not(:disabled){transform:translateY(1px)}
        .dds-button:focus-visible,.dds-input:focus-visible{outline:none;box-shadow:0 0 0 3px color-mix(in srgb,var(--dsw-alias-brand-primary) 18%,transparent);border-color:var(--dsw-alias-brand-primary)}
        .dds-button:disabled{cursor:default;opacity:.55}
        .dds-refresh{width:38px;flex:none;padding:0;background:transparent;box-shadow:none}.dds-refresh span{display:none}
        .dds-notice{display:flex;align-items:flex-start;gap:12px;border:1px solid color-mix(in srgb,var(--dsw-alias-state-warn-primary) 20%,var(--dsw-alias-border-l1));border-radius:12px;padding:12px 14px;color:var(--dsw-alias-label-secondary);background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 7%,var(--dsw-alias-bg-layer-1));font-size:13px;line-height:20px}
        .dds-notice-icon{width:30px;height:30px;display:grid;place-items:center;flex:none;border-radius:9px;color:var(--dsw-alias-state-warn-primary);background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 12%,transparent)}
        .dds-notice-icon .dds-icon{width:17px;height:17px}
        .dds-notice strong{display:block;margin-bottom:1px;color:var(--dsw-alias-label-primary);font-weight:600}
        .dds-notice p{margin:0}
        .dds-panel{overflow:hidden;border:1px solid color-mix(in srgb,var(--dsw-alias-border-l1) 82%,transparent);border-radius:12px;background:var(--dsw-alias-bg-layer-1);box-shadow:none}
        .dds-panel-head{display:flex;align-items:center;justify-content:space-between;gap:18px;padding:15px 17px;border-bottom:1px solid color-mix(in srgb,var(--dsw-alias-border-l1) 75%,transparent)}
        .dds-panel-title{display:flex;align-items:center;gap:10px;min-width:0}
        .dds-panel-title-icon{width:30px;height:30px;display:grid;place-items:center;flex:none;border-radius:9px;color:var(--dsw-alias-brand-primary);background:color-mix(in srgb,var(--dsw-alias-brand-primary) 9%,transparent)}
        .dds-panel-title-icon .dds-icon{width:16px;height:16px}
        .dds-panel h2{margin:0;font-size:14px;line-height:21px;font-weight:600}
        .dds-panel-head p{margin:2px 0 0;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}
        .dds-count{flex:none;border-radius:999px;padding:3px 9px;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-2);font-size:12px}
        .dds-form{display:grid;grid-template-columns:minmax(220px,1.3fr) minmax(150px,.72fr) minmax(180px,.9fr) auto;gap:12px;align-items:end;padding:17px}
        .dds-field{display:grid;gap:7px;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}
        .dds-input{box-sizing:border-box;width:100%;height:40px;border:1px solid var(--dsw-alias-border-l1);border-radius:9px;padding:8px 11px;color:var(--dsw-alias-label-primary);background:var(--dsw-specific-input-major);font:inherit;font-size:14px;transition:border-color .16s ease,box-shadow .16s ease,background .16s ease}
        .dds-input:hover{border-color:var(--dsw-alias-border-l2)}
        .dds-input::placeholder{color:var(--dsw-alias-label-dimmed)}
        .dds-primary{height:40px;border-color:transparent;padding:0 16px;color:var(--dsw-specific-button-primary-label);background:var(--dsw-specific-button-primary);box-shadow:none;font-weight:600}
        .dds-primary:hover:not(:disabled){border-color:transparent;background:var(--dsw-specific-button-primary-hover,var(--dsw-specific-button-primary));box-shadow:none}
        .dds-status{display:flex;align-items:center;min-height:20px;margin:-4px 2px 0;padding:0 2px;color:var(--dsw-alias-state-success-primary);font-size:12px;line-height:18px}
        .dds-error{color:var(--dsw-alias-state-error-primary)}
        .dds-feedback{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 16px}
        .dds-empty{min-height:132px;display:grid;place-items:center;border-color:transparent;background:transparent;padding:20px;text-align:center}
        .dds-empty-inner{max-width:420px;display:grid;justify-items:center}
        .dds-empty-icon{width:48px;height:48px;display:grid;place-items:center;margin-bottom:12px;border:1px solid color-mix(in srgb,var(--dsw-alias-brand-primary) 14%,var(--dsw-alias-border-l1));border-radius:15px;color:var(--dsw-alias-brand-primary);background:color-mix(in srgb,var(--dsw-alias-brand-primary) 7%,var(--dsw-alias-bg-layer-2))}
        .dds-empty-icon .dds-icon{width:23px;height:23px}
        .dds-empty h2{margin:0;font-size:15px;line-height:23px;font-weight:600}
        .dds-empty p{max-width:390px;margin:5px 0 0;color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:20px}
        .dds-list{display:grid;gap:0}
        .dds-list-head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:0 2px}
        .dds-list-head h2{margin:0;font-size:14px;line-height:22px;font-weight:600}
        .dds-item{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:14px;align-items:center;border:0;border-bottom:1px solid color-mix(in srgb,var(--dsw-alias-border-l1) 70%,transparent);border-radius:0;padding:14px 2px;background:transparent}.dds-item:last-child{border-bottom:0}
        .dds-badge{display:inline-flex;align-items:center;gap:6px;border-radius:999px;padding:4px 9px;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-2);font-size:12px;white-space:nowrap}
        .dds-badge::before{content:"";width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-state-success-primary);box-shadow:0 0 0 3px color-mix(in srgb,var(--dsw-alias-state-success-primary) 12%,transparent)}
        .dds-overdue{color:var(--dsw-alias-state-warn-primary);background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 9%,var(--dsw-alias-bg-layer-2))}
        .dds-overdue::before{background:var(--dsw-alias-state-warn-primary);box-shadow:0 0 0 3px color-mix(in srgb,var(--dsw-alias-state-warn-primary) 12%,transparent)}
        .dds-prompt{color:var(--dsw-alias-label-primary);font-size:14px;line-height:21px;font-weight:500;overflow-wrap:anywhere}
        .dds-meta{display:flex;flex-wrap:wrap;gap:4px 12px;margin-top:5px;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}
        .dds-meta code{max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:inherit;font:inherit}
        .dds-delete{color:var(--dsw-alias-label-secondary)}
        .dds-delete:hover:not(:disabled){color:var(--dsw-alias-state-error-primary);border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 24%,var(--dsw-alias-border-l1));background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 7%,transparent)}
        @media(max-width:820px){.dds-form{grid-template-columns:1fr 1fr}.dds-form .dds-field:first-child{grid-column:1/-1}.dds-primary{width:100%}.dds-item{grid-template-columns:1fr}.dds-badge{justify-self:start}.dds-delete{justify-self:start}}
        @media(max-width:560px){.dds-view{padding:20px 14px 40px}.dds-head{align-items:flex-start}.dds-heading-icon{display:none}.dds-sub{font-size:13px}.dds-refresh span{display:none}.dds-refresh{width:38px;padding:0}.dds-form{grid-template-columns:1fr}.dds-form .dds-field:first-child{grid-column:auto}.dds-panel-head{align-items:flex-start}.dds-notice{padding:11px 12px}.dds-item{padding:14px}}
        @media(prefers-reduced-motion:reduce){.dds-button,.dds-input{transition:none}.dds-button:active:not(:disabled){transform:none}}
      `;
      if (!style.isConnected) document.head.appendChild(style);
    }
    function fetchState(sessionId) {
      return fetch("/api/desktop-schedules/state?sessionId=" + encodeURIComponent(sessionId), { cache: "no-store", credentials: "same-origin" }).then(function (response) {
        return response.json().then(function (body) {
          if (!response.ok) throw new Error(body.error || ("HTTP " + response.status));
          return body;
        });
      });
    }
    function kindLabel(kind) { return t(kind); }
    function dateLabel(value) {
      try {
        return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "medium" }).format(new Date(value));
      } catch (_) {
        return value;
      }
    }
    function requestText(mode, prompt, value) {
      if (lang === "zh") {
        if (mode === "after") return "请在当前会话创建一个定时任务：" + JSON.stringify(prompt) + "，在 " + value + " 秒后提醒。创建后告诉我任务 ID。";
        if (mode === "every") return "请在当前会话创建一个固定频率定时任务：" + JSON.stringify(prompt) + "，每 " + value + " 秒提醒一次。创建后告诉我任务 ID。";
        var zone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
        return "请在当前会话创建一个定时任务：" + JSON.stringify(prompt) + "，在本地时间 " + value + "（时区 " + zone + "）提醒一次。创建后告诉我任务 ID。";
      }
      if (mode === "after") return "Create a schedule in this session to remind me " + JSON.stringify(prompt) + " after " + value + " seconds. Return its exact id.";
      if (mode === "every") return "Create a fixed-rate schedule in this session to remind me " + JSON.stringify(prompt) + " every " + value + " seconds. Return its exact id.";
      var timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
      return "Create a schedule in this session to remind me " + JSON.stringify(prompt) + " once at local time " + value + " in " + timeZone + ". Return its exact id.";
    }
    function SchedulesView(props) {
      var pair = useState(null), state = pair[0], setState = pair[1];
      var loadPair = useState(true), loading = loadPair[0], setLoading = loadPair[1];
      var errPair = useState(""), error = errPair[0], setError = errPair[1];
      var promptPair = useState(""), prompt = promptPair[0], setPrompt = promptPair[1];
      var modePair = useState("after"), mode = modePair[0], setMode = modePair[1];
      var valuePair = useState(""), value = valuePair[0], setValue = valuePair[1];
      var notePair = useState(""), note = notePair[0], setNote = notePair[1];
      var searchPair = useState(""), search = searchPair[0], setSearch = searchPair[1];
      var filterPair = useState("all"), filter = filterPair[0], setFilter = filterPair[1];
      var createPair = useState(false), showCreate = createPair[0], setShowCreate = createPair[1];
      function reload(silent) {
        if (!silent) setLoading(true);
        setError("");
        return fetchState(props.sessionId).then(setState).catch(function (cause) {
          setError(cause.message || String(cause));
        }).finally(function () {
          if (!silent) setLoading(false);
        });
      }
      useEffect(function () {
        var alive = true;
        function guarded() {
          if (!alive) return Promise.resolve();
          return reload(true);
        }
        setLoading(true);
        fetchState(props.sessionId).then(function (next) {
          if (alive) setState(next);
        }).catch(function (cause) {
          if (alive) setError(cause.message || String(cause));
        }).finally(function () {
          if (alive) setLoading(false);
        });
        var timer = setInterval(guarded, 15000);
        function visible() { if (document.visibilityState === "visible") guarded(); }
        document.addEventListener("visibilitychange", visible);
        window.addEventListener("focus", visible);
        return function () {
          alive = false;
          clearInterval(timer);
          document.removeEventListener("visibilitychange", visible);
          window.removeEventListener("focus", visible);
        };
      }, [props.sessionId]);
      function setDraft(text) {
        if (!props.inputActions || typeof props.inputActions.setDraft !== "function") {
          setNote(t("draftUnavailable"));
          return false;
        }
        props.inputActions.setDraft(text);
        setNote(t("draftReady"));
        return true;
      }
      function create(event) {
        event.preventDefault();
        var seconds = Number(value);
        if (!prompt.trim() || (mode !== "at" && (!Number.isSafeInteger(seconds) || seconds <= 0 || (mode === "every" && seconds < 300))) || (mode === "at" && !value)) {
          setNote(t("invalid"));
          return;
        }
        setDraft(requestText(mode, prompt.trim(), value));
      }
      function remove(id) {
        setDraft(lang === "zh" ? ("请删除当前会话中任务 ID 为 " + JSON.stringify(id) + " 的定时任务，并告诉我结果。") : ("Delete the schedule with exact id " + JSON.stringify(id) + " in this session and report the result."));
      }
      function suggest(text, nextMode, nextValue) {
        setPrompt(text); setMode(nextMode); setValue(nextValue); setShowCreate(true); setNote("");
      }
      function recreate(item) {
        var record = item && item.schedule ? item.schedule : item;
        if (!record || !record.prompt) return;
        if (record.kind === "every") return setDraft(requestText("every", record.prompt, record.everySeconds));
        if (record.kind === "after") return setDraft(requestText("after", record.prompt, record.afterSeconds));
        var message = lang === "zh" ? ("请在当前会话重新创建一次性定时任务：" + JSON.stringify(record.prompt) + "。原计划时间为 " + record.scheduledAt + "，请先向我确认新的未来时间，不要直接创建。") : ("Recreate the one-time schedule " + JSON.stringify(record.prompt) + ". Its former target was " + record.scheduledAt + "; ask me for a new future time before creating it.");
        return setDraft(message);
      }
      var schedules = state && Array.isArray(state.schedules) ? state.schedules : [];
      var history = state && Array.isArray(state.history) ? state.history : [];
      var needle = search.trim().toLocaleLowerCase();
      var activeIds = new Set(schedules.map(function (item) { return item.id; }));
      var visibleSchedules = (filter === "disabled" ? [] : schedules).filter(function (item) { return !needle || (item.prompt + " " + item.id + " " + item.kind).toLocaleLowerCase().indexOf(needle) >= 0; });
      var visibleHistory = history.filter(function (item) {
        var stateMatch = filter === "all" || (filter === "active" ? activeIds.has(item.id) : item.operation === "deleted");
        return stateMatch && (!needle || ((item.prompt || "") + " " + item.id + " " + item.operation).toLocaleLowerCase().indexOf(needle) >= 0);
      }).slice(0, 20);
      var noteIsError = note === t("invalid") || note === t("draftUnavailable");
      return h("main", { className: "dds-view", "aria-labelledby": "dds-title" },
        h("div", { className: "dds-shell" },
          h("header", { className: "dds-head" },
            h("div", { className: "dds-heading" },
              h("span", { className: "dds-heading-icon" }, h(Icon, { name: "calendar" })),
              h("div", null,
                h("div", { className: "dds-kicker" }, t("scope")),
                h("h1", { id: "dds-title", className: "dds-title" }, t("title")),
                h("p", { className: "dds-sub" }, t("intro"))
              )
            ),
            h("div", { className: "dds-head-actions" },
              h("button", { className: "dds-button dds-refresh", type: "button", disabled: loading, onClick: function () { reload(false); } }, h(Icon, { name: "refresh" }), h("span", null, t("refresh"))),
              h("button", { className: "dds-button dds-primary", type: "button", onClick: function () { setShowCreate(!showCreate); } }, h(Icon, { name: "plus" }), showCreate ? t("hideCreate") : t("showCreate"))
            )
          ),
          h("label", { className: "dds-search" }, h("span", { className: "visually-hidden" }, t("search")), h("input", { type: "search", value: search, maxLength: 200, onChange: function (event) { setSearch(event.target.value); }, placeholder: t("search") })),
          h("nav", { className: "dds-filters", "aria-label": t("title") }, [
            ["all", "all"], ["active", "activeFilter"], ["disabled", "disabledFilter"]
          ].map(function (entry) { return h("button", { key: entry[0], className: "dds-filter", type: "button", "aria-pressed": filter === entry[0], onClick: function () { setFilter(entry[0]); } }, t(entry[1])); })),
          !search && filter !== "disabled" ? h("section", { className: "dds-suggestions", "aria-labelledby": "dds-suggestions-title" },
            h("h2", { id: "dds-suggestions-title", className: "dds-section-label" }, t("suggestions")),
            h("button", { className: "dds-suggestion", type: "button", onClick: function () { suggest(lang === "zh" ? "每天早上整理日历、未读消息和优先事项" : "Review my calendar, unread messages, and priorities each workday morning", "every", "86400"); } }, h(Icon, { name: "notice" }), h("strong", null, t("suggestionDaily")), h("span", null, t("suggestionDailyHint"))),
            h("button", { className: "dds-suggestion", type: "button", onClick: function () { suggest(lang === "zh" ? "每周五整理最近的工作进展" : "Summarize my recent progress every Friday", "every", "604800"); } }, h(Icon, { name: "calendar" }), h("strong", null, t("suggestionWeekly")), h("span", null, t("suggestionWeeklyHint"))),
            h("button", { className: "dds-suggestion", type: "button", onClick: function () { suggest(lang === "zh" ? "检查最近的构建和部署状态" : "Check recent build and deployment status", "every", "3600"); } }, h(Icon, { name: "clock" }), h("strong", null, t("suggestionMonitor")), h("span", null, t("suggestionMonitorHint")))
          ) : null,
          h("aside", { className: "dds-notice", role: "note" },
            h("span", { className: "dds-notice-icon" }, h(Icon, { name: "notice" })),
            h("div", null, h("strong", null, t("limitationTitle")), h("p", null, t("limitation")))
          ),
          showCreate ? h("section", { className: "dds-panel dds-create", "aria-labelledby": "dds-create-title" },
            h("div", { className: "dds-panel-head" },
              h("div", { className: "dds-panel-title" },
                h("span", { className: "dds-panel-title-icon" }, h(Icon, { name: "plus" })),
                h("div", null, h("h2", { id: "dds-create-title" }, t("createTitle")), h("p", null, t("createHint")))
              )
            ),
            h("form", { className: "dds-form", onSubmit: create },
              h("label", { className: "dds-field" }, t("prompt"),
                h("input", { className: "dds-input", value: prompt, maxLength: 4096, onChange: function (event) { setPrompt(event.target.value); }, placeholder: t("prompt") })
              ),
              h("label", { className: "dds-field" }, t("mode"),
                h("select", { className: "dds-input", value: mode, onChange: function (event) { setMode(event.target.value); setValue(""); } },
                  h("option", { value: "after" }, t("after")),
                  h("option", { value: "at" }, t("at")),
                  h("option", { value: "every" }, t("every"))
                )
              ),
              h("label", { className: "dds-field" }, t("value"),
                h("input", { className: "dds-input", type: mode === "at" ? "datetime-local" : "number", inputMode: mode === "at" ? undefined : "numeric", min: mode === "every" ? 300 : 1, step: 1, value: value, onChange: function (event) { setValue(event.target.value); }, placeholder: t(mode + "Hint") })
              ),
              h("button", { className: "dds-button dds-primary", type: "submit" }, h(Icon, { name: "plus" }), t("create"))
            )
          ) : null,
          note ? h("div", { className: "dds-status" + (noteIsError ? " dds-error" : ""), role: "status", "aria-live": "polite" }, note) : null,
          loading ? h("section", { className: "dds-panel dds-feedback", role: "status" }, t("loading")) : null,
          error ? h("section", { className: "dds-panel dds-feedback dds-error", role: "alert" },
            h("span", null, t("error", { error: error })),
            h("button", { className: "dds-button", type: "button", onClick: function () { reload(false); } }, t("retry"))
          ) : null,
          !loading && !error && state && !state.available ? h("section", { className: "dds-panel dds-feedback" }, t("unavailable")) : null,
          !loading && !error && state && state.available && state.error ? h("section", { className: "dds-panel dds-feedback dds-error", role: "alert" }, state.error.message) : null,
          !loading && !error && state && state.available && !state.error && filter !== "disabled" && visibleSchedules.length === 0 ? h("section", { className: "dds-panel dds-empty" },
            h("div", { className: "dds-empty-inner" },
              h("span", { className: "dds-empty-icon" }, h(Icon, { name: "clock" })),
              h("h2", null, search ? t("none") : t("none")),
              h("p", null, search ? t("search") : t("emptyHint"))
            )
          ) : null,
          visibleSchedules.length ? h("section", { className: "dds-list", "aria-labelledby": "dds-active-title" },
            h("div", { className: "dds-list-head" }, h("h2", { id: "dds-active-title" }, t("activeTitle")), h("span", { className: "dds-count" }, t("count", { count: visibleSchedules.length }))),
            visibleSchedules.map(function (item) {
              return h("article", { className: "dds-panel dds-item", key: item.id },
                h("span", { className: "dds-badge" + (item.state === "overdue" ? " dds-overdue" : "") }, item.state === "overdue" ? t("overdue") : t("scheduled")),
                h("div", { className: "dds-item-copy" },
                  h("div", { className: "dds-prompt" }, item.prompt),
                  h("div", { className: "dds-meta" },
                    h("span", null, kindLabel(item.kind)),
                    h("span", null, t("next"), ": ", dateLabel(item.scheduledAt)),
                    h("span", null, t("id"), ": ", h("code", null, item.id)),
                    h("span", null, t("sessionLocal"))
                  )
                ),
                h("button", { className: "dds-button dds-delete", type: "button", "aria-label": t("deleteAria", { id: item.id }), onClick: function () { remove(item.id); } },
                  h(Icon, { name: "trash" }), h("span", null, t("disable"))
                )
              );
            })
          ) : null,
          !loading && !error && state && state.available ? h("section", { className: "dds-list", "aria-labelledby": "dds-history-title" },
            h("div", { className: "dds-list-head" }, h("h2", { id: "dds-history-title" }, t("historyTitle")), h("span", { className: "dds-count" }, t("count", { count: visibleHistory.length }))),
            visibleHistory.length ? h("div", { className: "dds-history-list" }, visibleHistory.map(function (item, index) {
              return h("article", { className: "dds-history-item", key: item.id + "-" + item.operation + "-" + index },
                h("span", { className: "dds-badge" }, t(item.operation)),
                h("div", { className: "dds-history-copy" }, h("strong", null, item.prompt || item.id), h("span", null, (item.occurredAt ? dateLabel(item.occurredAt) + " · " : "") + item.id)),
                item.operation === "deleted" ? h("button", { className: "dds-button", type: "button", onClick: function () { recreate(item); } }, t("enable")) : null
              );
            })) : h("div", { className: "dds-panel dds-feedback" }, t("historyEmpty"))
          ) : null
        )
      );
    }
    function apply(ctx) {
      injectStyles();
      try {
        ctx.effect(function () { return ctx.locale.register(NS, { zh: zh, en: en }); }, "desktop-schedules dictionaries");
      } catch (_) {}
      ctx.slots.inject("conversation.view", function () {
        return ctx.slots.register({ name: "conversation.view", id: "desktop-schedules", order: 22, locale: NS, label: function () { return t("title"); } }, SchedulesView);
      });
    }
    exports.apply = apply;
    exports.inject = ["slots", "locale"];
    return module.exports;
  }
});
