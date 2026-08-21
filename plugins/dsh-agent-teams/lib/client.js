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
    var startTransition = typeof React.startTransition === "function" ? React.startTransition : function (work) { work(); };
    var NS = "agent-teams";
    var SUBAGENT_CATALOG_EVENT = "harness-desktop:open-subagent-catalog";

    var zh = {
      title: "代理团队", loading: "正在载入团队工作区…", retry: "重试", loadError: "无法载入代理团队：{error}", actionError: "操作失败：{error}",
      disabled: "自动团队尚未启用", disabledBody: "启用后，你只需像平常一样描述目标；AI 会判断是否需要团队，简单任务不会强行组队。", enable: "启用自动团队", enabling: "正在启用…", disable: "关闭自动团队", disabling: "正在关闭…", disableActiveHint: "存在活动团队时无法关闭自动团队。请先让负责人完成任务并关闭所有活动团队。", disableSafeHint: "关闭后不会创建新团队；已关闭团队的历史仍会保留。",
      noTeam: "自动团队已开启", wizardIntro: "无需配置团队。回到对话直接说出目标，AI 会自动判断是否需要并行；下面的模板仅供希望立即指定方向时使用。", backToChat: "返回对话，直接说目标", chooseTemplate: "可选：协作方向", defineObjective: "可选：立即填写目标", prepare: "放入输入框", prepared: "提示词已放入输入框，确认无误后请手动发送。", objectivePlaceholder: "例如：完成新版团队工作台并通过验证",
      research: "调研与核验", researchBody: "研究员收集资料，分析员交叉验证，负责人汇总结论。", build: "开发与审查", buildBody: "开发负责改动，审查负责风险，测试负责验证。", incident: "问题诊断", incidentBody: "诊断、修复与回归验证并行推进。", custom: "自定义团队", customBody: "只填写目标，由 AI 自动设计成员、职责、任务边界和协作方式。",
      active: "协作进行中", paused: "已由用户停止", pausedBody: "该团队已停止，成员不会在后台继续完成任务。请在后续消息中明确要求继续，系统才会恢复团队。", closed: "团队已关闭", closedBody: "该团队不再接受成员协作；历史成员、任务和事件仍可查看。", unknown: "未知", status: "状态", objective: "团队目标", connection: "连接", live: "实时", polling: "轮询", stale: "数据可能已过期", disconnected: "重连中", workspaceIntro: "默认只展示现在需要关注的工作；完成内容和协作细节按需查看。",
      members: "成员", tasks: "任务", events: "协作事件", noMembers: "暂无成员", noTasks: "暂无任务", noEvents: "暂无协作事件", lead: "负责人", leadRole: "统筹目标和结果", openConversation: "查看实时工作", currentTask: "当前任务：{value}", model: "模型", mainModel: "主模型", subagentModel: "子代理模型", inheritsMain: "继承主模型", currentWork: "当前工作", listView: "列表", canvasView: "画布", canvasLabel: "团队实时画布", canvasHint: "选择成员可打开统一代理目录；连线表示分配、依赖、阻塞或文件冲突。", assignedRelation: "分配", dependsRelation: "依赖", blockedRelation: "阻塞", conflictRelation: "冲突", completedSummary: "已完成 {count} 项", noActiveTasks: "当前没有待处理或进行中的任务。", completedTasks: "已完成", taskHistory: "任务历史", historyHint: "完成的任务会自动移到这里，不再占用当前工作区。", openHistory: "查看历史 {count}", hideHistory: "收起历史", openMembers: "代理目录 {count}", openActivity: "动态 {count}", memberPanel: "团队成员", activityPanel: "协作动态", closePanel: "关闭侧栏", activeMembers: "当前成员", pastMembers: "过往成员", moreActions: "更多操作", fewerActions: "收起操作", workspaceSettings: "团队设置", archive: "历史", archivedTeams: "历史团队", activeTeamList: "进行中的团队", noArchivedTeams: "暂无历史团队", recentActivity: "最近动态", showMore: "再显示 {count} 条",
      pending: "待处理", in_progress: "进行中", completed: "已完成", blocked: "受阻", ready: "可接收任务", running: "工作中", idle: "当前回合结束", provisioning: "正在启动", shutting_down: "正在停止", closing: "正在关闭", retired: "已退役", failed: "失败", delivered: "已送达", closedStatus: "已关闭",
      assignee: "负责人", unassigned: "未分配", blockedBy: "阻塞于：{value}", dependencySources: "跨团队依赖：{value}", conflicts: "冲突任务：{value}", files: "文件：{value}", filesHidden: "文件范围已按安全策略隐藏", taskFallback: "任务 {id}", lastActivity: "最后活动：{value}", deliveryEvent: "{from} → {to} · {status}", crossDelivery: "{fromTeam} → {toTeam} · {from} → {to} · {status}",
      quickActions: "快捷提示", addMember: "添加成员", newPeerTeam: "添加协作团队", createTask: "创建任务", coordinate: "协调团队", summarize: "汇总进展", closeTeam: "请求关闭", newTeam: "创建新团队", draftOnly: "操作会写入下方输入框，不会自动发送。", draftSet: "提示词已写入输入框。", creationSent: "创建请求已发送，正在返回对话。", creationSentFallback: "创建请求已发送。请使用上方“对话”标签查看响应。",
      teamsOverview: "团队总览", teamCount: "共 {count} 个团队", activeTeams: "活跃 {count}", closedTeams: "已关闭 {count}", switchTeam: "切换到团队：{name}", crossTeam: "跨团队动态", noCrossTeam: "暂无跨团队动态", backgroundHint: "切换团队或页面不会停止后台成员。", teamTasks: "{active} 进行中 · {done} 已完成", lastUpdated: "更新于 {value}",
      currentSession: "当前会话", revision: "修订 {value}", settingsTitle: "代理团队", settingsDescription: "启用后只需正常描述目标，AI 自动判断是否使用团队；简单任务保持单人执行。更高并发限制可能增加模型用量与费用。", settingsEnabled: "启用自动团队", settingsMaxMembers: "团队成员上限", settingsMaxActiveTurns: "最大并行回合数", settingsSave: "保存设置", settingsSaving: "正在保存…", settingsSaved: "设置已保存", settingsRange: "请输入 1 到 8 之间的整数。", settingsCloseTeamsFirst: "请先在负责人会话中关闭所有活动团队，再关闭代理团队功能。"
    };
    var en = {
      title: "Agent Teams", loading: "Loading team workspace…", retry: "Retry", loadError: "Could not load Agent Teams: {error}", actionError: "Action failed: {error}",
      disabled: "Automatic teams are disabled", disabledBody: "After enabling, describe goals normally. AI decides whether a team is useful and keeps simple work solo.", enable: "Enable automatic teams", enabling: "Enabling…", disable: "Turn off automatic teams", disabling: "Turning off…", disableActiveHint: "Automatic teams cannot be turned off while a team is active. Ask the lead to finish work and close every active team first.", disableSafeHint: "Turning this off prevents new teams; closed-team history remains available.",
      noTeam: "Automatic teams are ready", wizardIntro: "No team setup is required. Return to Chat and state the goal normally; AI decides whether to parallelize. The templates below are optional shortcuts.", backToChat: "Return to Chat and state a goal", chooseTemplate: "Optional: collaboration direction", defineObjective: "Optional: enter a goal now", prepare: "Put in composer", prepared: "The prompt is in the composer. Review it, then send it manually.", objectivePlaceholder: "For example: deliver the new team workspace and verify it",
      research: "Research & verify", researchBody: "A researcher gathers evidence, an analyst cross-checks it, and the lead synthesizes findings.", build: "Build & review", buildBody: "Development makes changes, Review checks risk, and Test verifies the result.", incident: "Diagnose an issue", incidentBody: "Diagnosis, remediation, and regression verification move in parallel.", custom: "Custom team", customBody: "Enter only the objective; AI designs the members, responsibilities, task boundaries, and collaboration pattern.",
      active: "Collaboration active", paused: "Stopped by user", pausedBody: "This team is stopped and members will not finish tasks in the background. Explicitly ask to continue in a later message before the team can resume.", closed: "Team closed", closedBody: "This team no longer accepts member collaboration. Its members, tasks, and events remain available.", unknown: "Unknown", status: "Status", objective: "Team objective", connection: "Connection", live: "Live", polling: "Polling", stale: "Data may be stale", disconnected: "Reconnecting", workspaceIntro: "Only work that needs attention is shown by default. Completed work and collaboration details stay available on demand.",
      members: "Members", tasks: "Tasks", events: "Collaboration events", noMembers: "No members", noTasks: "No tasks", noEvents: "No collaboration events", lead: "Lead", leadRole: "Plans the goal and owns the result", openConversation: "View live work", currentTask: "Current task: {value}", model: "Model", mainModel: "Main model", subagentModel: "Subagent model", inheritsMain: "inherits main", currentWork: "Current work", listView: "List", canvasView: "Canvas", canvasLabel: "Live team canvas", canvasHint: "Select a member to open the unified agent catalog. Lines show assignment, dependency, blocking, or file conflicts.", assignedRelation: "Assigned", dependsRelation: "Depends on", blockedRelation: "Blocked by", conflictRelation: "Conflict", completedSummary: "{count} completed", noActiveTasks: "No pending or in-progress tasks.", completedTasks: "Completed", taskHistory: "Task history", historyHint: "Completed tasks move here automatically instead of filling the current workspace.", openHistory: "View history {count}", hideHistory: "Hide history", openMembers: "Agents {count}", openActivity: "Activity {count}", memberPanel: "Team members", activityPanel: "Collaboration activity", closePanel: "Close sidebar", activeMembers: "Current members", pastMembers: "Past members", moreActions: "More actions", fewerActions: "Hide actions", workspaceSettings: "Team settings", archive: "History", archivedTeams: "Team history", activeTeamList: "Active teams", noArchivedTeams: "No archived teams", recentActivity: "Recent activity", showMore: "Show {count} more",
      pending: "Pending", in_progress: "In progress", completed: "Completed", blocked: "Blocked", ready: "Ready for work", running: "Working", idle: "Turn complete", provisioning: "Starting", shutting_down: "Stopping", closing: "Closing", retired: "Retired", failed: "Failed", delivered: "Delivered", closedStatus: "Closed",
      assignee: "Assignee", unassigned: "Unassigned", blockedBy: "Blocked by: {value}", dependencySources: "Cross-team dependencies: {value}", conflicts: "Conflicting tasks: {value}", files: "Files: {value}", filesHidden: "File scope hidden by the safety policy", taskFallback: "Task {id}", lastActivity: "Last activity: {value}", deliveryEvent: "{from} → {to} · {status}", crossDelivery: "{fromTeam} → {toTeam} · {from} → {to} · {status}",
      quickActions: "Prompt shortcuts", addMember: "Add member", newPeerTeam: "Add peer team", createTask: "Create task", coordinate: "Coordinate team", summarize: "Summarize progress", closeTeam: "Request shutdown", newTeam: "Create another team", draftOnly: "Actions write to the composer and never send automatically.", draftSet: "Prompt added to the composer.", creationSent: "Creation request sent; returning to Chat.", creationSentFallback: "Creation request sent. Use the Chat tab above to view the response.",
      teamsOverview: "Team overview", teamCount: "{count} teams", activeTeams: "{count} active", closedTeams: "{count} closed", switchTeam: "Switch to team: {name}", crossTeam: "Cross-team activity", noCrossTeam: "No cross-team activity", backgroundHint: "Switching teams or views never stops background members.", teamTasks: "{active} active · {done} done", lastUpdated: "Updated {value}",
      currentSession: "Current session", revision: "Revision {value}", settingsTitle: "Agent Teams", settingsDescription: "After enabling, describe goals normally and AI decides whether to use a team; simple work stays solo. Higher concurrency limits may increase model usage and cost.", settingsEnabled: "Enable automatic teams", settingsMaxMembers: "Maximum team members", settingsMaxActiveTurns: "Maximum active turns", settingsSave: "Save settings", settingsSaving: "Saving…", settingsSaved: "Settings saved", settingsRange: "Enter a whole number from 1 to 8.", settingsCloseTeamsFirst: "Close every active team from its lead conversation before disabling Agent Teams."
    };
    var currentLang = ((typeof navigator !== "undefined" && navigator.language) || "en").toLowerCase().indexOf("zh") === 0 ? "zh" : "en";
    function isChinese() { return String(currentLang || "").toLowerCase().indexOf("zh") === 0; }
    var translate = function (key, vars) {
      var text = (isChinese() ? zh : en)[key] || key;
      Object.keys(vars || {}).forEach(function (name) { text = text.split("{" + name + "}").join(String(vars[name])); });
      return text;
    };
    var localeListeners = [];
    function useLocale() {
      var pair = useState(0);
      useEffect(function () {
        var listener = function () { pair[1](function (value) { return value + 1; }); };
        localeListeners.push(listener);
        return function () { localeListeners = localeListeners.filter(function (item) { return item !== listener; }); };
      }, []);
      return translate;
    }

    function injectStyles() {
      if (document.getElementById("dsh-agent-teams-client-style")) return;
      var style = document.createElement("style");
      style.id = "dsh-agent-teams-client-style";
      style.textContent = [
        ".dat-view{box-sizing:border-box;height:100%;min-height:0;overflow:auto;padding:18px 20px 28px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base);font-family:var(--dsw-font-family,system-ui,sans-serif)}",
        ".dat-shell{width:min(1260px,100%);margin:0 auto}.dat-head{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;margin-bottom:14px}.dat-title{font-size:20px;line-height:1.35;margin:0}.dat-subtitle{margin:5px 0 0;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:1.5;overflow-wrap:anywhere}",
        ".dat-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.dat-badge{display:inline-flex;align-items:center;gap:5px;max-width:100%;border:1px solid var(--dsw-alias-border-l3);border-radius:999px;padding:3px 8px;color:var(--dsw-alias-label-secondary);font-size:12px;overflow-wrap:anywhere}.dat-dot{width:7px;height:7px;border-radius:50%;background:var(--dsw-alias-state-success-primary);flex:none}",
        ".dat-panel,.dat-card{box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);border-radius:12px}.dat-panel{padding:16px}.dat-card{padding:11px;background:var(--dsw-alias-bg-layer-2);min-width:0}.dat-empty{text-align:center;padding:48px 18px}.dat-empty h2{margin:0 0 8px;font-size:18px}.dat-empty p{max-width:620px;margin:0 auto 16px;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:1.55}",
        ".dat-btn{font:inherit;border:1px solid var(--dsw-alias-border-l3);border-radius:8px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);padding:7px 11px;cursor:pointer;line-height:1.25}.dat-btn:hover{background:var(--dsw-alias-interactive-bg-hover)}.dat-btn:focus-visible,.dat-field:focus-visible,.dat-template:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}.dat-btn:disabled{opacity:.5;cursor:not-allowed}.dat-primary{background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground);border-color:transparent}.dat-danger{color:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-state-error-secondary)}.dat-small{padding:4px 8px;font-size:12px}",
        ".dat-error{border:1px solid var(--dsw-alias-state-error-secondary);border-radius:10px;padding:10px 12px;color:var(--dsw-alias-state-error-primary);font-size:13px;margin-bottom:12px}.dat-note{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:1.5}.dat-section-title{font-size:13px;margin:0 0 9px}.dat-field{box-sizing:border-box;width:100%;border:1px solid var(--dsw-alias-border-l3);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);padding:9px 10px;font:inherit;font-size:13px}.dat-label{display:block;margin:13px 0 6px;color:var(--dsw-alias-label-secondary);font-size:12px}",
        ".dat-templates{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:9px}.dat-template{display:block;width:100%;text-align:left;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;padding:12px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);cursor:pointer}.dat-template[aria-pressed=true]{border-color:var(--dsw-alias-brand-primary);box-shadow:inset 0 0 0 1px var(--dsw-alias-brand-primary)}.dat-template strong{display:block;font-size:13px;margin-bottom:4px}.dat-template span{display:block;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.45}",
        ".dat-column-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px}.dat-column-head h2{font-size:14px;margin:0}.dat-stack{display:grid;gap:8px}.dat-card-title{font-size:13px;font-weight:650;overflow-wrap:anywhere}.dat-meta{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.45;overflow-wrap:anywhere}.dat-task-status{margin-top:7px}.dat-event{border-left:2px solid var(--dsw-alias-brand-primary);padding-left:9px}.dat-event time{display:block;color:var(--dsw-alias-label-tertiary);font-size:11px;margin-top:3px}",
        ".dat-actions{display:flex;align-items:center;gap:7px;flex-wrap:wrap;margin:12px 0}.dat-actions-panel{margin:0 0 12px;padding:10px 12px}.dat-closed{border-color:var(--dsw-alias-border-l3);background:var(--dsw-alias-bg-layer-2);margin-bottom:12px}.dat-sr{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}.dat-warn-text{color:var(--dsw-alias-state-warn-primary)}",
        ".dat-overview{margin:0 0 12px}.dat-team-strip{display:flex;align-items:center;gap:7px;overflow:auto;padding:2px 0 4px}.dat-team-list{display:grid;gap:7px;max-height:280px;overflow:auto;list-style:none;margin:8px 0 0;padding:0}.dat-team-choice{min-width:max-content;text-align:left;border:1px solid var(--dsw-alias-border-l2);border-radius:999px;padding:6px 10px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);cursor:pointer}.dat-team-choice[aria-current=true]{border-color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-interactive-bg-hover)}.dat-team-choice:focus-visible,.dat-disclosure>summary:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}.dat-disclosure{border-top:1px solid var(--dsw-alias-border-l2);margin-top:10px;padding-top:8px}.dat-disclosure>summary{cursor:pointer;color:var(--dsw-alias-label-secondary);font-size:12px}.dat-disclosure[open]>summary{margin-bottom:8px}",
        ".dat-active-shell{min-width:0}.dat-active-shell.dat-inspector-open{display:grid;grid-template-columns:minmax(0,1fr) minmax(300px,360px);gap:12px;align-items:start}.dat-work-main{min-width:0}.dat-command-bar{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:12px}.dat-command-title{min-width:0;flex:1 1 320px}.dat-command-title .dat-title{font-size:18px}.dat-work-panel{padding:0;overflow:hidden}.dat-work-panel>.dat-column-head{padding:13px 14px 4px}.dat-work-list{display:grid;gap:0}.dat-task-row{border:0;border-top:1px solid var(--dsw-alias-border-l2);border-radius:0;background:transparent;padding:12px 14px}.dat-task-row:hover{background:var(--dsw-alias-interactive-bg-hover)}.dat-task-row:first-child{border-top:0}.dat-work-empty{padding:24px 14px;text-align:center}.dat-history{margin-top:12px}.dat-history-head{display:flex;align-items:center;justify-content:space-between;gap:8px}.dat-history-list{max-height:min(56vh,620px);overflow:auto;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;margin-top:8px}.dat-history-note{margin:6px 0 0}",
        ".dat-inspector{position:sticky;top:0;max-height:calc(100vh - 150px);overflow:hidden;padding:0;box-shadow:0 12px 30px rgba(0,0,0,.08)}.dat-inspector-head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:12px;border-bottom:1px solid var(--dsw-alias-border-l2)}.dat-inspector-tabs{display:flex;gap:6px}.dat-inspector-body{max-height:calc(100vh - 215px);overflow:auto;padding:10px}.dat-inspector-body .dat-card{background:transparent}.dat-scrim{display:none}.dat-settings-disclosure{margin-top:14px}.dat-settings-disclosure>.dat-panel{margin-top:8px}",
        ".dat-view-toggle{display:inline-flex;gap:3px;padding:3px;border:1px solid var(--dsw-alias-border-l2);border-radius:9px;background:var(--dsw-alias-bg-layer-1)}.dat-view-toggle .dat-btn{border:0}.dat-canvas-panel{padding:12px;overflow:hidden}.dat-canvas-scroll{position:relative;display:block;max-width:100%;overflow:auto;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-1);isolation:isolate}.dat-canvas{position:relative;display:grid;grid-template-rows:82px 104px 82px;align-content:start;box-sizing:border-box;min-height:326px;padding:24px 20px 34px;isolation:isolate}.dat-canvas-lines{position:absolute;z-index:0;inset:0;width:100%;height:100%;pointer-events:none}.dat-canvas-row{position:relative;z-index:1;display:grid;grid-auto-flow:column;grid-auto-columns:152px;column-gap:28px;align-items:start;justify-content:start;min-width:0}.dat-canvas-line{stroke:var(--dsw-alias-brand-primary);stroke-width:2;opacity:.58;vector-effect:non-scaling-stroke}.dat-canvas-line-blocked,.dat-canvas-line-conflict{stroke:var(--dsw-alias-state-warn-primary);stroke-dasharray:7 5}.dat-canvas-node{position:relative;display:block;box-sizing:border-box;width:152px;height:82px;min-width:0;margin:0;padding:9px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-2);box-shadow:0 4px 12px rgba(0,0,0,.06);overflow:hidden;overflow-wrap:anywhere;transition:border-color .16s ease,transform .16s ease}.dat-canvas-member{cursor:pointer;text-align:left;color:inherit;font:inherit}.dat-canvas-member:hover{border-color:var(--dsw-alias-brand-primary);transform:translateY(-1px)}.dat-canvas-task{border-top:3px solid var(--dsw-alias-brand-primary)}.dat-canvas-completed{border-top-color:var(--dsw-alias-state-success-primary)}.dat-canvas-legend{display:flex;gap:10px;flex-wrap:wrap;margin:9px 0 0;padding:0;list-style:none}.dat-canvas-key{display:inline-flex;align-items:center;gap:5px}.dat-canvas-key::before{content:\"\";width:18px;border-top:2px solid var(--dsw-alias-brand-primary)}.dat-canvas-key-blocked::before,.dat-canvas-key-conflict::before{border-top-style:dashed;border-color:var(--dsw-alias-state-warn-primary)}",
        "@media(prefers-reduced-motion:reduce){.dat-canvas-node{transition:none}.dat-canvas-member:hover{transform:none}}@media(max-width:900px){.dat-templates{grid-template-columns:1fr}.dat-active-shell.dat-inspector-open{display:block}.dat-scrim{display:block;position:fixed;inset:0;z-index:39;border:0;background:rgba(0,0,0,.28)}.dat-inspector{position:fixed;z-index:40;top:0;right:0;bottom:0;width:min(390px,92vw);max-height:none;border-radius:12px 0 0 12px}.dat-inspector-body{max-height:calc(100vh - 60px)}.dat-canvas-scroll{max-width:100%}}@media(max-width:620px){.dat-view{padding:12px 10px 22px}.dat-head{display:block}.dat-head>.dat-row{margin-top:9px}.dat-panel{padding:12px}.dat-work-panel{padding:0}.dat-command-bar{align-items:flex-start}.dat-command-bar>.dat-row{width:100%}.dat-inspector{width:100%;border-radius:0}.dat-task-row{padding:11px 12px}.dat-canvas-panel{padding:9px}.dat-canvas-hint{display:none}.dat-canvas-scroll{overflow-x:auto}.dat-canvas-legend{font-size:11px}}"
      ].join("\n");
      document.head.appendChild(style);
    }

    function errorText(error) { return error && error.message ? error.message : String(error || "unknown"); }
    function stateUrl(sessionId, selectedTeamId) { return "/api/agent-teams/state?sessionId=" + encodeURIComponent(sessionId) + (selectedTeamId ? "&teamId=" + encodeURIComponent(selectedTeamId) : ""); }
    function eventsUrl(sessionId, selectedTeamId) { return "/api/agent-teams/events?sessionId=" + encodeURIComponent(sessionId) + (selectedTeamId ? "&teamId=" + encodeURIComponent(selectedTeamId) : ""); }
    function fetchState(sessionId, selectedTeamId) {
      return fetch(stateUrl(sessionId, selectedTeamId), { method: "GET", credentials: "same-origin", headers: { Accept: "application/json" } }).then(function (response) {
        return response.json().catch(function () { return {}; }).then(function (data) { if (!response.ok) { var error = new Error(data.error || ("HTTP " + response.status)); error.code = data.code; error.status = response.status; throw error; } return data; });
      });
    }
    function postAction(sessionId, action, payload) {
      return fetch("/api/agent-teams/action", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", Accept: "application/json", "x-harness-agent-teams": "1" }, body: JSON.stringify(Object.assign({ sessionId: sessionId, action: action }, payload || {})) }).then(function (response) {
        return response.json().catch(function () { return {}; }).then(function (data) { if (!response.ok) { var error = new Error(data.error || ("HTTP " + response.status)); error.code = data.code; error.status = response.status; throw error; } return data; });
      });
    }
    function teamSnapshotVersion(snapshot) {
      if (!snapshot || typeof snapshot !== "object") return "";
      var config = snapshot.config || snapshot.settings || {};
      var teams = teamsFromSnapshot(snapshot);
      var markers = teams.map(function (team) {
        return [teamId(team), team.revision || "", team.updatedAt || "", team.status || team.state || ""];
      });
      if (teams.some(function (team) { return !team.revision && !team.updatedAt; })) return JSON.stringify(snapshot);
      return JSON.stringify([!!snapshot.enabled, config.maxMembers || 0, config.maxActiveTurns || 0, markers]);
    }
    function useTeamState(sessionId, selectedTeamId) {
      var statePair = useState(null), state = statePair[0], setState = statePair[1];
      var errorPair = useState(""), error = errorPair[0], setError = errorPair[1];
      var connectionPair = useState("disconnected"), connection = connectionPair[0], setConnection = connectionPair[1];
      var reloadRef = useRef(function () {}), acceptRef = useRef(function (next) { setState(next); }), failureRef = useRef(0), versionRef = useRef("");
      useEffect(function () {
        if (!sessionId) return;
        var alive = true, source = null, sourceOpen = false, pollTimer = null, pollAttempt = 0, publishFrame = null, pendingSnapshot = null, loadPromise = null;
        versionRef.current = "";
        function hidden() { return typeof document !== "undefined" && document.visibilityState === "hidden"; }
        function requestFrame(work) { return typeof requestAnimationFrame === "function" ? requestAnimationFrame(work) : setTimeout(work, 16); }
        function cancelFrame(handle) { if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(handle); else clearTimeout(handle); }
        function applySnapshot(next) {
          if (!alive || !next) return;
          var version = teamSnapshotVersion(next);
          if (version && version === versionRef.current) return;
          versionRef.current = version;
          startTransition(function () { if (alive) { setState(next); setError(""); } });
        }
        function flushSnapshot() {
          publishFrame = null;
          if (!alive || hidden() || !pendingSnapshot) return;
          var next = pendingSnapshot;
          pendingSnapshot = null;
          applySnapshot(next);
        }
        function queueSnapshot(next) {
          if (!alive || !next) return;
          pendingSnapshot = next;
          if (hidden() || publishFrame !== null) return;
          publishFrame = requestFrame(flushSnapshot);
        }
        function clearPolling() {
          if (pollTimer) clearTimeout(pollTimer);
          pollTimer = null;
        }
        function load(silent) {
          if (loadPromise) return loadPromise;
          var operation = fetchState(sessionId, selectedTeamId).then(function (next) {
            if (alive) {
              failureRef.current = 0;
              queueSnapshot(next);
              if (!sourceOpen) setConnection("polling");
            }
            return next;
          }).catch(function (err) {
            if (alive) {
              failureRef.current += 1;
              if (!silent) setError(errorText(err));
              else if (failureRef.current >= 2) setConnection("stale");
            }
            throw err;
          });
          loadPromise = operation.finally(function () { loadPromise = null; });
          return loadPromise;
        }
        function schedulePolling() {
          if (!alive || sourceOpen || pollTimer) return;
          var base = Math.min(30000, 4000 * Math.pow(2, Math.min(pollAttempt, 3)));
          var delay = Math.round(base * (0.8 + Math.random() * 0.4));
          pollTimer = setTimeout(function () {
            pollTimer = null;
            if (!alive || sourceOpen) return;
            pollAttempt += 1;
            setConnection("polling");
            load(true).catch(function () {}).finally(schedulePolling);
          }, delay);
        }
        function onVisibilityChange() {
          if (hidden()) return;
          flushSnapshot();
          if (!sourceOpen) load(true).catch(function () {});
        }
        acceptRef.current = queueSnapshot;
        reloadRef.current = function () { return load(false); };
        load(false).catch(function () {});
        if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVisibilityChange);
        if (typeof EventSource === "function") {
          try {
            source = new EventSource(eventsUrl(sessionId, selectedTeamId));
            source.onopen = function () {
              if (!alive) return;
              sourceOpen = true;
              pollAttempt = 0;
              clearPolling();
              setConnection("live");
            };
            var update = function (event) {
              if (!alive) return;
              try {
                var next = JSON.parse(event.data);
                if (next && typeof next.enabled === "boolean" && Object.prototype.hasOwnProperty.call(next, "team")) { failureRef.current = 0; queueSnapshot(next); }
                else if (next && next.state && typeof next.state.enabled === "boolean") { failureRef.current = 0; queueSnapshot(next.state); }
                else load(true).catch(function () {});
              } catch (_) { load(true).catch(function () {}); }
            };
            source.onmessage = update;
            ["snapshot", "state", "update"].forEach(function (name) { source.addEventListener(name, update); });
            source.onerror = function () {
              if (!alive) return;
              sourceOpen = false;
              failureRef.current += 1;
              setConnection(failureRef.current >= 2 ? "stale" : "disconnected");
              // Native EventSource keeps reconnecting; sparse jittered polling is only a safety net.
              schedulePolling();
            };
          } catch (_) { schedulePolling(); }
        } else schedulePolling();
        return function () {
          alive = false;
          acceptRef.current = function () {};
          if (source) source.close();
          clearPolling();
          if (publishFrame !== null) cancelFrame(publishFrame);
          if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVisibilityChange);
        };
      }, [sessionId, selectedTeamId]);
      return { state: state, setState: function (next) { return acceptRef.current(next); }, error: error, setError: setError, connection: connection, reload: function () { return reloadRef.current(); } };
    }

    function Button(props) {
      return h("button", { type: props.type || "button", className: "dat-btn" + (props.primary ? " dat-primary" : "") + (props.danger ? " dat-danger" : "") + (props.small ? " dat-small" : ""), disabled: props.disabled, onClick: props.onClick, "aria-label": props.ariaLabel, "aria-pressed": props.ariaPressed, ref: props.buttonRef }, props.children);
    }
    function arrayText(value) { return (Array.isArray(value) ? value : value ? [value] : []).map(function (item) { return typeof item === "object" ? item.title || item.name || item.teamName || item.id || JSON.stringify(item) : item; }).join(", "); }
    function dependencySourceText(t, value) { return (value || []).map(function (item) { return (item.teamName || item.teamId || t("unknown")) + (item.teamStatus ? " · " + statusLabel(t, item.teamStatus) : ""); }).join(", "); }
    function memberId(member) { return member.id || member.memberId || member.sessionId || member.childSessionId || member.name; }
    function memberSession(member) { return member.childSessionId || member.sessionId || member.id; }
    function simpleMemberName(member, isLead, t) {
      if (isLead) return t("lead");
      var original = String(member.displayName || member.name || memberSession(member) || t("unknown"));
      var simplified = isChinese() ? original.replace(/^(?:宿主|用户)/u, "").replace(/(?:负责人|实现者|执行者|协调器|作者|子代理)$/u, "").trim() : original.replace(/\s+(?:lead|implementer|executor|coordinator|author|subagent|worker)$/iu, "").trim();
      var display = simplified || original, codePoints = Array.from(display);
      return codePoints.length > 24 ? codePoints.slice(0, 23).join("") + "…" : display;
    }
    function taskId(task) { return task.id || task.taskId || task.title; }
    function statusLabel(t, value) {
      var normalized = String(value || "unknown").toLowerCase();
      var aliases = { active: "running", working: "running", ready: "ready", pending: "pending", inprogress: "in_progress", "in-progress": "in_progress", done: "completed", complete: "completed", stopped: "retired", error: "failed", closed: "closedStatus" };
      return t(aliases[normalized] || normalized);
    }
    function teamStatusLabel(t, value) { var normalized = String(value || "unknown").toLowerCase(); return normalized === "active" ? t("active") : normalized === "closed" ? t("closedStatus") : normalized === "closing" ? t("closing") : statusLabel(t, normalized); }
    function formatTime(value) { if (!value) return ""; try { return new Date(value).toLocaleString(); } catch (_) { return String(value); } }
    function teamId(team) { return team && (team.id || team.teamId || team.name || team.objective); }
    function teamName(team, t) { return team && (team.name || team.objective || teamId(team)) || t("unknown"); }
    function eventIdentity(event, fallbackTeamId) {
      if (event && event.id) return "id:" + event.id;
      return [event && event.fromTeamId || fallbackTeamId || "", event && event.toTeamId || "", event && event.fromSessionId || event && event.from || "", event && event.toSessionId || event && event.to || "", event && event.createdAt || event && event.timestamp || event && event.at || "", event && event.eventType || "", event && event.status || ""].join("|");
    }
    function pushUniqueEvent(target, seen, event, fallbackTeamId, entry) {
      var key = eventIdentity(event, fallbackTeamId);
      if (seen[key]) return;
      seen[key] = true;
      target.push(entry || event);
    }
    function teamsFromSnapshot(snapshot) {
      if (!snapshot) return [];
      var source = Array.isArray(snapshot.teams) ? snapshot.teams : Array.isArray(snapshot.relatedTeams) ? snapshot.relatedTeams : Array.isArray(snapshot.teamHistory) ? snapshot.teamHistory : [];
      var teams = source.slice();
      if (snapshot.team) {
        var selectedIndex = teams.findIndex(function (item) { return teamId(item) === teamId(snapshot.team); });
        if (selectedIndex >= 0) teams[selectedIndex] = snapshot.team;
        else teams.unshift(snapshot.team);
      }
      return teams;
    }

    function DisableAutomaticTeams(props) {
      var t = props.t;
      return h("section", { className: "dat-panel", "aria-labelledby": props.labelId },
        h("div", { className: "dat-row", style: { justifyContent: "space-between", alignItems: "flex-start" } },
          h("div", { style: { flex: "1 1 320px" } }, h("h2", { id: props.labelId, className: "dat-section-title" }, t("disable")), h("p", { className: props.hasActive ? "dat-meta dat-warn-text" : "dat-meta", style: { margin: 0 } }, props.hasActive ? t("disableActiveHint") : t("disableSafeHint"))),
          h(Button, { danger: true, disabled: props.busy || props.hasActive, onClick: props.disable, ariaLabel: t("disable") }, props.busy ? t("disabling") : t("disable"))
        )
      );
    }

    function FirstTeamWizard(props) {
      var t = props.t;
      var templatePair = useState("custom"), template = templatePair[0], setTemplate = templatePair[1];
      var objectivePair = useState(""), objective = objectivePair[0], setObjective = objectivePair[1];
      var templates = [
        { id: "research", title: t("research"), body: t("researchBody") },
        { id: "build", title: t("build"), body: t("buildBody") },
        { id: "incident", title: t("incident"), body: t("incidentBody") },
        { id: "custom", title: t("custom"), body: t("customBody") }
      ];
      function prepare() {
        var selected = templates.filter(function (item) { return item.id === template; })[0];
        var prompt = isChinese()
          ? "请创建一个代理团队来完成以下目标：" + objective.trim() + "。" + (selected.id === "custom" ? "请完全根据目标自行设计团队。" : "以“" + selected.title + "”作为协作方向。") + "请由 AI 判断是否需要并行、需要多少成员、各自职责、任务依赖和互不冲突的文件边界；目标跨度较大时，可以由同一负责人创建多个同级团队，并建立跨团队依赖和负责人中继；先建立持久任务，再创建必要成员。负责人/大脑始终保持主模型；普通成员默认使用子代理模型来节省消耗，只有高复杂推理、架构或安全关键任务才使用主模型。成员名称使用“界面、测试、安全、文档”这类 2–6 字直白职责名，避免“宿主、协调器、执行器、实现者、子代理”等技术称谓。不要让用户设计团队结构，也不要为了凑人数创建成员。"
          : "Create an agent team for this objective: " + objective.trim() + ". " + (selected.id === "custom" ? "Design the team entirely from the objective. " : "Use “" + selected.title + "” as the collaboration direction. ") + "AI must decide whether parallelism is useful, how many members are needed, their roles, task dependencies, and non-conflicting file boundaries. For a broad objective, the same root lead may create multiple peer teams with cross-team dependencies and lead-authenticated relays. Create durable tasks before only the necessary members. The root lead/brain must stay on the main model; default ordinary members to the subagent model to reduce cost, and use the main model only for complex reasoning, architecture, or security-critical work. Use short, plain function names such as UI, Test, Security, or Docs; avoid technical titles such as host, coordinator, executor, implementer, or subagent. Do not ask the user to design the team or add members just to fill seats.";
        props.setDraft(prompt, { creation: true });
      }
      return h("section", { className: "dat-panel", "aria-labelledby": "dat-first-team" },
        h("div", { className: "dat-empty", style: { paddingTop: 20, paddingBottom: 20 } }, h("h2", { id: "dat-first-team" }, t("noTeam")), h("p", null, t("wizardIntro")), typeof props.setView === "function" ? h(Button, { primary: true, onClick: function () { props.setView("chat"); } }, t("backToChat")) : null),
        h(DisableAutomaticTeams, { t: t, labelId: "dat-disable-empty", disable: props.disable, busy: props.busy, hasActive: false }),
        h("h3", { className: "dat-section-title", style: { marginTop: 16 } }, t("chooseTemplate")),
        h("div", { className: "dat-templates", role: "group", "aria-label": t("chooseTemplate") }, templates.map(function (item) {
          return h("button", { key: item.id, type: "button", className: "dat-template", "aria-pressed": template === item.id, onClick: function () { setTemplate(item.id); } }, h("strong", null, item.title), h("span", null, item.body));
        })),
        h("label", { className: "dat-label", htmlFor: "dat-objective" }, t("defineObjective")),
        h("textarea", { id: "dat-objective", className: "dat-field", rows: 3, value: objective, placeholder: t("objectivePlaceholder"), onChange: function (event) { setObjective(event.target.value); } }),
        h("div", { className: "dat-actions" }, h(Button, { primary: true, disabled: !objective.trim(), onClick: prepare }, t("prepare")), h("span", { className: "dat-note" }, t("draftOnly")))
      );
    }

    function TaskCard(props) {
      var task = props.task, t = props.t, id = taskId(task), assigned = task.assigneeSessionId || task.assigneeId || task.assignee || task.memberId || "";
      return h("article", { className: "dat-card" + (props.compact ? " dat-task-row" : "") },
        h("div", { className: "dat-card-title" }, task.title || task.name || t("taskFallback", { id: id })),
        task.description ? h("div", { className: "dat-meta", style: { marginTop: 4 } }, task.description) : null,
        h("div", { className: "dat-meta", style: { marginTop: 6 } }, "#" + id + " · " + t("assignee") + ": " + (props.memberName(assigned) || t("unassigned"))),
        arrayText(task.blockedBy) ? h("div", { className: "dat-meta dat-warn-text" }, t("blockedBy", { value: arrayText(task.blockedBy) })) : null,
        arrayText(task.dependencySources) ? h("div", { className: "dat-meta" }, t("dependencySources", { value: dependencySourceText(t, task.dependencySources) })) : null,
        arrayText(task.conflictsWith) ? h("div", { className: "dat-meta dat-warn-text" }, t("conflicts", { value: arrayText(task.conflictsWith) })) : null,
        arrayText(task.files || task.fileScope) ? h("div", { className: "dat-meta" }, t("files", { value: arrayText(task.files || task.fileScope) })) : task.fileScopeProjection && task.fileScopeProjection.projected === false ? h("div", { className: "dat-meta" }, t("filesHidden")) : null,
        h("div", { className: "dat-task-status" }, h("span", { className: "dat-badge" }, statusLabel(t, task.status || "pending")))
      );
    }
    function memberActivityValue(member) { return Date.parse(member.lastActivityAt || member.updatedAt || member.createdAt || 0) || 0; }
    function sortMembersByActivity(members) {
      var rank = { running: 0, working: 0, provisioning: 0, failed: 1, shutting_down: 1, closing: 1, ready: 2, idle: 2, retired: 4 };
      return members.slice().sort(function (left, right) {
        var leftState = String(left.state || left.status || "").toLowerCase(), rightState = String(right.state || right.status || "").toLowerCase();
        var stateDelta = (Object.prototype.hasOwnProperty.call(rank, leftState) ? rank[leftState] : 4) - (Object.prototype.hasOwnProperty.call(rank, rightState) ? rank[rightState] : 4);
        return stateDelta || memberActivityValue(right) - memberActivityValue(left) || String(memberId(left)).localeCompare(String(memberId(right)));
      });
    }
    function relationIds(value) {
      return (Array.isArray(value) ? value : value ? [value] : []).map(function (item) { return typeof item === "object" ? item.taskId || item.id || item.title : item; }).filter(Boolean);
    }
    function TeamCanvas(props) {
      var t = props.t, members = sortMembersByActivity(props.members || []), tasks = props.tasks || [];
      var activeTasks = tasks.filter(function (task) { return String(task.status || task.state || "pending").toLowerCase() !== "completed"; });
      var completedTasks = tasks.filter(function (task) { return String(task.status || task.state || "").toLowerCase() === "completed"; });
      var taskNodes = activeTasks.slice();
      if (completedTasks.length) taskNodes.push({ id: "__completed__", title: t("completedSummary", { count: completedTasks.length }), status: "completed", completedAggregate: true });
      var width = Math.max(760, Math.max(members.length, taskNodes.length, 1) * 180 + 40), height = 326;
      var positions = {}, memberLookup = {}, taskLookup = {}, completedKey = "task:__completed__";
      members.forEach(function (member, index) {
        var key = "member:" + memberId(member), position = { x: 20 + index * 180, y: 24, key: key };
        positions[key] = position;
        [memberId(member), memberSession(member), member.memberId, member.assigneeSessionId].filter(Boolean).forEach(function (id) { memberLookup[String(id)] = key; });
      });
      activeTasks.forEach(function (task, index) { var key = "task:" + taskId(task); positions[key] = { x: 20 + index * 180, y: 210, key: key }; taskLookup[String(taskId(task))] = key; });
      completedTasks.forEach(function (task) { taskLookup[String(taskId(task))] = completedKey; });
      if (completedTasks.length) positions[completedKey] = { x: 20 + activeTasks.length * 180, y: 210, key: completedKey };
      var edges = [], edgeSeen = {};
      function addEdge(from, to, kind) {
        if (!from || !to || from === to || !positions[from] || !positions[to]) return;
        var key = from + "|" + to + "|" + kind;
        if (edgeSeen[key]) return;
        edgeSeen[key] = true; edges.push({ key: key, from: positions[from], to: positions[to], kind: kind });
      }
      tasks.forEach(function (task) {
        var target = taskLookup[String(taskId(task))], assigned = task.assigneeSessionId || task.assigneeId || task.assignee || task.memberId;
        addEdge(memberLookup[String(assigned || "")], target, "assigned");
        relationIds(task.dependsOn).forEach(function (id) { addEdge(taskLookup[String(id)], target, "depends"); });
        relationIds(task.blockedBy).forEach(function (id) { addEdge(taskLookup[String(id)], target, "blocked"); });
        relationIds(task.conflictsWith).forEach(function (id) { addEdge(target, taskLookup[String(id)], "conflict"); });
      });
      function edgeLabel(kind) { return t(kind === "assigned" ? "assignedRelation" : kind === "depends" ? "dependsRelation" : kind === "blocked" ? "blockedRelation" : "conflictRelation"); }
      return h("section", { className: "dat-panel dat-canvas-panel", "aria-labelledby": "dat-team-canvas" },
        h("div", { className: "dat-column-head" }, h("div", null, h("h2", { id: "dat-team-canvas" }, t("canvasLabel")), h("p", { className: "dat-note dat-canvas-hint", style: { margin: "4px 0 0" } }, t("canvasHint"))), h("span", { className: "dat-badge" }, activeTasks.length)),
        h("div", { className: "dat-canvas-scroll", tabIndex: 0 }, h("div", { className: "dat-canvas", style: { width: width + "px", height: height + "px" } },
          h("svg", { className: "dat-canvas-lines", viewBox: "0 0 " + width + " " + height, preserveAspectRatio: "none", "aria-hidden": "true" },
            h("defs", null, h("marker", { id: "dat-canvas-arrow", viewBox: "0 0 10 10", refX: 8, refY: 5, markerWidth: 5, markerHeight: 5, orient: "auto-start-reverse" }, h("path", { d: "M 0 0 L 10 5 L 0 10 z", fill: "currentColor" }))),
            edges.map(function (edge) { return h("line", { key: edge.key, className: "dat-canvas-line dat-canvas-line-" + edge.kind, x1: edge.from.x + 76, y1: edge.from.y + 82, x2: edge.to.x + 76, y2: edge.to.y, markerEnd: "url(#dat-canvas-arrow)" }, h("title", null, edgeLabel(edge.kind))); })
          ),
          h("div", { className: "dat-canvas-row dat-canvas-member-row" }, members.map(function (member) { var position = positions["member:" + memberId(member)], isLead = member.isLead || member.kind === "lead" || memberSession(member) === props.leadSessionId; return h("button", { key: position.key, type: "button", className: "dat-canvas-node dat-canvas-member", onClick: props.openMembers, "aria-label": simpleMemberName(member, isLead, t) + " · " + statusLabel(t, member.state || member.status) }, h("div", { className: "dat-card-title" }, simpleMemberName(member, isLead, t)), h("div", { className: "dat-meta", style: { marginTop: 5 } }, statusLabel(t, member.state || member.status)), member.lastActivityAt ? h("div", { className: "dat-meta", style: { marginTop: 3 } }, formatTime(member.lastActivityAt)) : null); })),
          h("div", { className: "dat-canvas-gap", "aria-hidden": "true" }),
          h("div", { className: "dat-canvas-row dat-canvas-task-row" }, taskNodes.map(function (task) { var position = positions["task:" + taskId(task)]; return h("article", { key: position.key, className: "dat-canvas-node dat-canvas-task" + (task.completedAggregate ? " dat-canvas-completed" : "") }, h("div", { className: "dat-card-title" }, task.title || task.name || t("taskFallback", { id: taskId(task) })), h("div", { className: "dat-meta", style: { marginTop: 5 } }, statusLabel(t, task.status || task.state || "pending"))); }))
        )),
        h("ul", { className: "dat-canvas-legend", "aria-label": t("canvasHint") }, ["assigned", "depends", "blocked", "conflict"].map(function (kind) { return h("li", { key: kind, className: "dat-meta dat-canvas-key dat-canvas-key-" + kind }, edgeLabel(kind)); })),
        h("ul", { className: "dat-sr" }, edges.map(function (edge) { return h("li", { key: "text:" + edge.key }, edgeLabel(edge.kind) + ": " + edge.from.key + " → " + edge.to.key); }))
      );
    }

    function EventCard(props) {
      var event = props.event, t = props.t, teamsById = props.teamsById || {};
      var from = event.fromName || event.memberName || event.actorName || event.from || t("unknown");
      var to = event.toName || event.toSessionId || t("unknown");
      var status = statusLabel(t, event.status || event.eventType || "pending");
      var fromTeam = event.fromTeamName || teamName(teamsById[event.fromTeamId], t), toTeam = event.toTeamName || teamName(teamsById[event.toTeamId], t);
      var title = event.fromTeamId && event.toTeamId ? t("crossDelivery", { fromTeam: fromTeam, toTeam: toTeam, from: from, to: to, status: status }) : t("deliveryEvent", { from: from, to: to, status: status });
      return h("article", { className: "dat-card dat-event" },
        h("div", { className: "dat-card-title" }, title),
        event.createdAt || event.timestamp || event.at ? h("time", { dateTime: event.createdAt || event.timestamp || event.at }, formatTime(event.createdAt || event.timestamp || event.at)) : null
      );
    }

    function TeamOverview(props) {
      var t = props.t, teams = props.teams;
      var activeTeams = teams.filter(function (team) { return String(team.status || team.state || "").toLowerCase() !== "closed"; });
      var archivedTeams = teams.filter(function (team) { return String(team.status || team.state || "").toLowerCase() === "closed"; });
      function choice(team, archived) {
        var tasks = team.tasks || [], active = Number.isFinite(team.activeTaskCount) ? team.activeTaskCount : tasks.filter(function (task) { return (task.status || task.state) === "in_progress"; }).length;
        var name = teamName(team, t), selected = teamId(team) === props.selectedId;
        return h("button", { key: teamId(team), type: "button", className: "dat-team-choice", "aria-current": selected ? "true" : undefined, "aria-label": t("switchTeam", { name: name }), onClick: function () { props.select(teamId(team)); } }, name, archived ? " · " + t("archive") : active ? " · " + active : "");
      }
      if (teams.length <= 1) return null;
      return h("nav", { className: "dat-overview dat-panel", "aria-labelledby": "dat-overview-title" },
        h("div", { className: "dat-column-head" }, h("h2", { id: "dat-overview-title" }, t("activeTeamList")), h("span", { className: "dat-badge" }, activeTeams.length)),
        h("div", { className: "dat-team-strip" }, activeTeams.map(function (team) { return choice(team, false); })),
        archivedTeams.length ? h("details", { className: "dat-disclosure" }, h("summary", null, t("archivedTeams") + " · " + archivedTeams.length), h("div", { className: "dat-team-strip" }, archivedTeams.map(function (team) { return choice(team, true); }))) : null,
        h("p", { className: "dat-note", style: { marginBottom: 0 } }, t("backgroundHint"))
      );
    }

    function ActiveTeam(props) {
      var t = props.t, team = props.team, members = team.members || [], tasks = team.tasks || [];
      var historyPair = useState(!!props.closed), historyOpen = historyPair[0], setHistoryOpen = historyPair[1];
      var modePair = useState("canvas"), workMode = modePair[0], setWorkMode = modePair[1];
      var actionsPair = useState(false), actionsOpen = actionsPair[0], setActionsOpen = actionsPair[1];
      var drawerPair = useState(false), drawerOpen = drawerPair[0], setDrawerOpen = drawerPair[1];
      var historyLimitPair = useState(40), historyLimit = historyLimitPair[0], setHistoryLimit = historyLimitPair[1];
      var drawerRef = useRef(null), triggerRef = useRef(null);
      var events = [], seenEvents = {}, teamsById = {};
      (props.teams || []).forEach(function (item) { teamsById[teamId(item)] = item; });
      teamsById[teamId(team)] = team;
      (team.events || team.messages || []).forEach(function (event) { pushUniqueEvent(events, seenEvents, event, teamId(team)); });
      (team.inboundEvents || []).forEach(function (event) { pushUniqueEvent(events, seenEvents, event, event.fromTeamId); });
      (props.teams || []).forEach(function (source) { if (teamId(source) !== teamId(team)) (source.events || source.messages || []).forEach(function (event) { if (event.toTeamId === teamId(team)) pushUniqueEvent(events, seenEvents, event, teamId(source)); }); });
      events.sort(function (left, right) { return Date.parse(right.createdAt || right.timestamp || right.at || 0) - Date.parse(left.createdAt || left.timestamp || left.at || 0); });
      var activeTasks = tasks.filter(function (task) { return String(task.status || task.state || "pending").toLowerCase() !== "completed"; }).sort(function (left, right) { return String(left.status || left.state) === "in_progress" ? -1 : String(right.status || right.state) === "in_progress" ? 1 : 0; });
      var completedTasks = tasks.filter(function (task) { return String(task.status || task.state || "").toLowerCase() === "completed"; }).sort(function (left, right) { return Date.parse(right.updatedAt || right.completedAt || 0) - Date.parse(left.updatedAt || left.completedAt || 0); });
      var currentMembers = sortMembersByActivity(members.filter(function (member) { return String(member.state || member.status || "").toLowerCase() !== "retired"; }));
      var agentCount = currentMembers.filter(function (member) { return !(member.isLead || member.kind === "lead" || memberSession(member) === team.leadSessionId); }).length;
      function nameFor(id) { var found = members.filter(function (member) { return memberId(member) === id || memberSession(member) === id; })[0]; return found && (found.displayName || found.name || memberId(found)); }
      function closePanel() { setDrawerOpen(false); if (triggerRef.current && typeof triggerRef.current.focus === "function") triggerRef.current.focus(); }
      function openActivityPanel(event) { if (drawerOpen) { closePanel(); return; } triggerRef.current = event && event.currentTarget; setDrawerOpen(true); }
      function openAgentCatalog() {
        if (!team.leadSessionId || !props.sessions || typeof props.sessions.setSubagentCatalogOpen !== "function") return;
        setDrawerOpen(false);
        props.sessions.setSubagentCatalogOpen(team.leadSessionId, true);
        if (typeof window !== "undefined" && typeof window.dispatchEvent === "function" && typeof window.CustomEvent === "function") window.dispatchEvent(new window.CustomEvent(SUBAGENT_CATALOG_EVENT, { detail: { parentSessionId: team.leadSessionId } }));
      }
      useEffect(function () { setHistoryOpen(!!props.closed); setHistoryLimit(40); setWorkMode("canvas"); setActionsOpen(false); setDrawerOpen(false); }, [teamId(team), props.closed]);
      useEffect(function () {
        if (!drawerOpen) return;
        if (drawerRef.current && typeof drawerRef.current.focus === "function") drawerRef.current.focus();
        var onKey = function (event) { if (event.key === "Escape") closePanel(); };
        document.addEventListener("keydown", onKey);
        return function () { document.removeEventListener("keydown", onKey); };
      }, [drawerOpen]);
      var objective = team.objective || t("unknown");
      var targetContext = isChinese() ? "目标团队：‘" + teamName(team, t) + "’（team_id: " + teamId(team) + "）。" : "Target team: ‘" + teamName(team, t) + "’ (team_id: " + teamId(team) + "). ";
      var teamSummary = (props.teams || []).map(function (item) { var itemTasks = item.tasks || [], runningTasks = Number.isFinite(item.activeTaskCount) ? item.activeTaskCount : itemTasks.filter(function (task) { return (task.status || task.state) === "in_progress"; }).length; return teamName(item, t) + " [" + teamId(item) + ", " + teamStatusLabel(t, item.status || item.state) + ", " + (isChinese() ? "目标：" : "objective: ") + String(item.objective || t("unknown")).slice(0, 160) + ", " + runningTasks + (isChinese() ? " 个进行中任务" : " active tasks") + "]"; }).join("; ");
      function prompt(text, options) { props.setDraft(targetContext + text + (options && options.includeTeams && teamSummary ? (isChinese() ? " 当前团队安全摘要：" : " Current safe team summary: ") + teamSummary : ""), options); }
      var prompts = isChinese() ? [
        { key: "addMember", text: "请根据团队目标、当前任务缺口、成本和并行上限，判断是否真的需要新增成员。只有能明显减少重复工作并且文件边界不冲突时，才由你自动确定名称、职责、模型和首个任务；名称使用用户语言的 2–12 字符直白职责名（中文建议“界面、测试、安全、文档”这类 2–6 字名称，英文可用 UI、Test、Security、Docs），先创建持久任务再添加并分配成员；如果不需要，请说明原因且不要扩员。负责人始终使用主模型；新成员默认使用子代理模型，只有高复杂或高风险任务才分配主模型。" },
        { key: "newPeerTeam", creation: true, includeTeams: true, text: "请根据当前项目目标、现有团队分工和成本，判断是否真的需要新增一个由同一负责人管理的同级协作团队。只有职责边界清楚且可以独立并行时才创建；由你自动确定新团队目标、必要成员、主/子模型分配、跨团队任务依赖和负责人中继。如果现有团队足够，请说明原因且不要创建。" },
        { key: "createTask", text: "请把团队目标的下一步拆成一个任务，明确负责人、依赖关系和文件范围。" },
        { key: "coordinate", text: "请检查团队当前阻塞和文件冲突，协调成员并更新任务分配。" },
        { key: "summarize", text: "请汇总团队当前进展、风险、阻塞和下一步行动。" },
        { key: "closeTeam", text: "请先收集所有成员的最终报告，确认没有进行中任务，再优雅退役成员并关闭团队。" }
      ] : [
        { key: "addMember", text: "Decide from the team objective, current task gaps, cost, and concurrency limit whether another member is genuinely useful. Only when it clearly reduces duplicated work and has a non-conflicting file boundary, choose a plain 2–12 character duty name in the user's language (for example UI, Test, Security, or Docs in English), role, model, and first task yourself; create the durable task before spawning and assigning the member. Otherwise explain why and do not expand the team. Keep the lead on the main model; default the new member to the subagent model and choose the main model only for highly complex or high-risk work." },
        { key: "newPeerTeam", creation: true, includeTeams: true, text: "Decide from the project objective, existing team responsibilities, and cost whether another peer team under the same root lead is genuinely useful. Create it only with a clear independent boundary and useful parallelism. Choose its objective, necessary members, main/subagent model assignments, cross-team task dependencies, and lead-authenticated relays yourself. If the existing teams are enough, explain why and do not create one." },
        { key: "createTask", text: "Break the next step toward the team objective into a task with an assignee, dependencies, and file scope." },
        { key: "coordinate", text: "Review current blockers and file conflicts, coordinate members, and update task assignments." },
        { key: "summarize", text: "Summarize the team’s progress, risks, blockers, and next actions." },
        { key: "closeTeam", text: "Collect every member's final report, confirm that no task is still running, then gracefully retire members and close the team." }
      ];
      var inspector = drawerOpen ? h(React.Fragment, null,
        h("button", { type: "button", className: "dat-scrim", onClick: closePanel, "aria-label": t("closePanel") }),
        h("aside", { className: "dat-panel dat-inspector", role: "complementary", tabIndex: -1, ref: drawerRef, "aria-label": t("activityPanel") },
          h("div", { className: "dat-inspector-head" }, h("h2", { className: "dat-section-title", style: { margin: 0 } }, t("activityPanel")), h(Button, { small: true, onClick: closePanel, ariaLabel: t("closePanel") }, "×")),
          h("div", { className: "dat-inspector-body" },
            h("div", { className: "dat-column-head" }, h("h2", null, t("recentActivity")), h("span", { className: "dat-badge" }, events.length)),
            h("div", { className: "dat-stack" }, events.length ? events.slice(0, 20).map(function (event) { return h(EventCard, { key: eventIdentity(event, teamId(team)), event: event, t: t, teamsById: teamsById }); }) : h("div", { className: "dat-meta" }, t("noEvents")))
          )
        )
      ) : null;
      return h("div", { className: "dat-active-shell" + (drawerOpen ? " dat-inspector-open" : "") },
        h("div", { className: "dat-work-main" },
          props.closed ? h("section", { className: "dat-panel dat-closed", role: "status" }, h("strong", null, t("closed")), h("div", { className: "dat-meta", style: { marginTop: 4 } }, t("closedBody")), h("div", { style: { marginTop: 10 } }, h(Button, { small: true, onClick: function () { prompt(isChinese() ? "请询问我的下一个目标；收到目标后，由你判断是否需要团队并自动规划必要成员、任务依赖和文件边界，不要让我设计团队结构。" : "Ask for my next objective. After I provide it, decide whether a team is useful and design only the necessary members, task dependencies, and file boundaries yourself; do not ask me to design the team structure.", { creation: true, includeTeams: true }); } }, t("newTeam")))) : props.paused ? h("section", { className: "dat-panel dat-closed", role: "status" }, h("strong", null, t("paused")), h("div", { className: "dat-meta", style: { marginTop: 4 } }, t("pausedBody"))) : null,
          h("header", { className: "dat-command-bar" }, h("div", { className: "dat-command-title" }, h("h2", { className: "dat-title" }, teamName(team, t)), h("p", { className: "dat-subtitle" }, objective), h("div", { className: "dat-row", style: { marginTop: 6 } }, h("span", { className: "dat-badge" }, teamStatusLabel(t, team.status)), h("span", { className: "dat-badge" }, t("revision", { value: team.revision || "–" })))), h("div", { className: "dat-row" }, h(Button, { small: true, disabled: !team.leadSessionId || !props.sessions || typeof props.sessions.setSubagentCatalogOpen !== "function", onClick: openAgentCatalog }, t("openMembers", { count: agentCount })), h(Button, { small: true, ariaPressed: drawerOpen, onClick: openActivityPanel }, t("openActivity", { count: events.length })), completedTasks.length ? h(Button, { small: true, ariaPressed: historyOpen, onClick: function () { setHistoryOpen(!historyOpen); } }, historyOpen ? t("hideHistory") : t("openHistory", { count: completedTasks.length })) : null, !props.closed && !props.paused ? h(Button, { small: true, ariaPressed: actionsOpen, onClick: function () { setActionsOpen(!actionsOpen); } }, actionsOpen ? t("fewerActions") : t("moreActions")) : null)),
          h("div", { className: "dat-row", style: { justifyContent: "flex-end", marginBottom: 10 } }, h("div", { className: "dat-view-toggle", role: "group", "aria-label": t("currentWork") }, h(Button, { small: true, ariaPressed: workMode === "canvas", onClick: function () { setWorkMode("canvas"); } }, t("canvasView")), h(Button, { small: true, ariaPressed: workMode === "list", onClick: function () { setWorkMode("list"); } }, t("listView")))),
          actionsOpen && !props.closed && !props.paused ? h("section", { className: "dat-panel dat-actions-panel", "aria-labelledby": "dat-quick-actions" }, h("h2", { id: "dat-quick-actions", className: "dat-section-title" }, t("quickActions")), h("div", { className: "dat-actions" }, prompts.map(function (item) { return h(Button, { key: item.key, small: true, onClick: function () { prompt(item.text, { creation: item.creation, includeTeams: item.includeTeams }); } }, t(item.key)); })), h("div", { className: "dat-note" }, t("draftOnly"))) : null,
          workMode === "canvas" ? h(TeamCanvas, { t: t, members: currentMembers, tasks: tasks, leadSessionId: team.leadSessionId, openMembers: openAgentCatalog }) : h("section", { className: "dat-panel dat-work-panel", "aria-labelledby": "dat-current-work" }, h("div", { className: "dat-column-head" }, h("h2", { id: "dat-current-work" }, t("currentWork")), h("span", { className: "dat-badge" }, activeTasks.length)), h("div", { className: "dat-work-list" }, activeTasks.length ? activeTasks.map(function (task) { return h(TaskCard, { key: taskId(task), task: task, compact: true, t: t, memberName: nameFor }); }) : h("div", { className: "dat-meta dat-work-empty" }, t("noActiveTasks")))),
          completedTasks.length ? h("section", { className: "dat-history", "aria-labelledby": "dat-task-history" }, h("div", { className: "dat-history-head" }, h("h2", { id: "dat-task-history", className: "dat-section-title", style: { margin: 0 } }, t("taskHistory")), h("span", { className: "dat-badge" }, completedTasks.length)), h("p", { className: "dat-note dat-history-note" }, t("historyHint")), historyOpen ? h("div", { className: "dat-history-list" }, completedTasks.slice(0, historyLimit).map(function (task) { return h(TaskCard, { key: taskId(task), task: task, compact: true, t: t, memberName: nameFor }); }), completedTasks.length > historyLimit ? h("div", { className: "dat-actions", style: { justifyContent: "center", padding: "0 12px 12px" } }, h(Button, { small: true, onClick: function () { setHistoryLimit(historyLimit + 40); } }, t("showMore", { count: Math.min(40, completedTasks.length - historyLimit) }))) : null) : null) : null
        ),
        inspector
      );
    }

    function TeamView(props) {
      var t = useLocale();
      var selectedPair = useState(""), selectedId = selectedPair[0], setSelectedId = selectedPair[1];
      var live = useTeamState(props.sessionId, selectedId);
      var inputPhase = props.useInput(function (state) { return state.phase; });
      var inputDraft = props.useInput(function (state) { return state.draft; });
      var inputDraftRev = props.useInput(function (state) { return state.draftRev; });
      var busyPair = useState(false), busy = busyPair[0], setBusy = busyPair[1];
      var actionErrorPair = useState(""), actionError = actionErrorPair[0], setActionError = actionErrorPair[1];
      var noticePair = useState(""), notice = noticePair[0], setNotice = noticePair[1];
      var creationRef = useRef(null), previousPhaseRef = useRef(inputPhase);
      var snapshot = live.state, teams = teamsFromSnapshot(snapshot);
      var preferredId = snapshot && (snapshot.activeTeamId || snapshot.selectedTeamId) || snapshot && snapshot.team && teamId(snapshot.team);
      var team = teams.filter(function (item) { return teamId(item) === selectedId; })[0] || teams.filter(function (item) { return teamId(item) === preferredId; })[0] || teams[0] || null;
      useEffect(function () {
        if (team && teamId(team) !== selectedId) setSelectedId(teamId(team));
      }, [selectedId, preferredId, teams.map(teamId).join("|")]);
      useEffect(function () {
        var pending = creationRef.current;
        if (pending && pending.observedInComposer && previousPhaseRef.current !== "submitting" && inputPhase === "submitting") {
          pending.submitting = true;
          pending.submittedDraft = inputDraft;
          pending.submittedDraftRev = inputDraftRev;
        }
        if (pending && pending.submitting && previousPhaseRef.current === "submitting" && inputPhase === "plain") {
          var draftConsumed = inputDraft === "" && inputDraftRev !== pending.submittedDraftRev;
          if (draftConsumed) {
            creationRef.current = null;
            if (typeof props.setView === "function") {
              setNotice(t("creationSent"));
              props.setView("chat");
            } else setNotice(t("creationSentFallback"));
          } else pending.submitting = false;
        }
        previousPhaseRef.current = inputPhase;
      }, [inputPhase, inputDraft, inputDraftRev, props.setView]);
      useEffect(function () {
        if (creationRef.current && inputDraft === creationRef.current.prompt) creationRef.current.observedInComposer = true;
      }, [inputDraft]);
      function setDraft(prompt, options) {
        if (!props.inputActions || typeof props.inputActions.setDraft !== "function") { setActionError("inputActions.setDraft unavailable"); return; }
        props.inputActions.setDraft(prompt);
        if (options && options.creation) creationRef.current = { prompt: prompt, observedInComposer: false };
        setNotice(t("draftSet"));
      }
      function applyActionState(result) {
        if (result && result.state) { live.setState(result.state); return true; }
        if (result && typeof result.enabled === "boolean") { live.setState(result); return true; }
        return false;
      }
      function enable() {
        setBusy(true); setActionError("");
        postAction(props.sessionId, "settings", { enabled: true }).then(function (result) {
          if (!applyActionState(result)) live.reload().catch(function () {});
          if (typeof props.setView === "function") props.setView("chat");
        }).catch(function (error) { setActionError(errorText(error)); }).finally(function () { setBusy(false); });
      }
      function disable() {
        setBusy(true); setActionError("");
        postAction(props.sessionId, "settings", { enabled: false }).then(function (result) {
          if (!applyActionState(result)) return fetchState(props.sessionId).then(function (state) { live.setState(state); });
        }).catch(function (error) {
          setActionError(error && error.code === "AGENT_TEAMS_CONFLICT" ? t("disableActiveHint") : errorText(error));
          return fetchState(props.sessionId).then(function (state) { live.setState(state); }).catch(function () {});
        }).finally(function () { setBusy(false); });
      }
      var connectionKey = live.connection === "live" ? "live" : live.connection === "polling" ? "polling" : live.connection === "stale" ? "stale" : "disconnected";
      var closed = !!(team && String(team.status || team.state || "").toLowerCase() === "closed");
      var paused = !!(team && String(team.status || team.state || "").toLowerCase() === "paused");
      var hasActiveTeams = teams.some(function (item) { return String(item.status || item.state || "").toLowerCase() !== "closed"; });
      return h("main", { className: "dat-view", "aria-labelledby": "dat-view-title" }, h("div", { className: "dat-shell" },
        h("div", { className: "dat-head" }, h("div", null, h("h1", { id: "dat-view-title", className: "dat-title" }, t("title")), h("p", { className: "dat-subtitle" }, t("workspaceIntro"))), h("span", { className: "dat-badge", title: t("connection") + " · " + props.sessionId }, h("span", { className: "dat-dot", style: live.connection === "live" ? null : { background: "var(--dsw-alias-state-warn-primary)" } }), t(connectionKey))),
        live.error ? h("div", { className: "dat-error", role: "alert" }, t("loadError", { error: live.error }), " ", h(Button, { small: true, onClick: live.reload }, t("retry"))) : null,
        actionError ? h("div", { className: "dat-error", role: "alert" }, t("actionError", { error: actionError })) : null,
        h("div", { className: "dat-sr", role: "status", "aria-live": "polite" }, notice),
        !snapshot && !live.error ? h("div", { className: "dat-panel dat-empty", role: "status" }, t("loading")) : null,
        snapshot && !snapshot.enabled ? h("section", { className: "dat-panel dat-empty", "aria-labelledby": "dat-disabled" }, h("h2", { id: "dat-disabled" }, t("disabled")), h("p", null, t("disabledBody")), h(Button, { primary: true, disabled: busy, onClick: enable }, busy ? t("enabling") : t("enable"))) : null,
        snapshot && snapshot.enabled && teams.length === 0 ? h(FirstTeamWizard, { t: t, setDraft: setDraft, setView: props.setView, disable: disable, busy: busy }) : null,
        snapshot && snapshot.enabled && teams.length > 0 ? h(React.Fragment, null,
          h(TeamOverview, { t: t, teams: teams, selectedId: team && teamId(team), select: setSelectedId }),
          team ? h(ActiveTeam, { t: t, team: team, teams: teams, closed: closed, paused: paused, setDraft: setDraft, sessions: props.sessions }) : null,
          h("details", { className: "dat-disclosure dat-settings-disclosure" }, h("summary", null, t("workspaceSettings")), h(DisableAutomaticTeams, { t: t, labelId: "dat-disable-teams", disable: disable, busy: busy, hasActive: hasActiveTeams }))
        ) : null
      ));
    }

    function resolveSettingsSessionId(sessions) {
      try { var current = sessions && sessions.list && sessions.list.getSnapshot().current; if (typeof current === "string" && current) return current; if (current && (current.sessionId || current.id)) return current.sessionId || current.id; } catch (_) {}
      return "settings";
    }
    function AgentTeamsSettings(props) {
      var t = useLocale();
      var sessionId = resolveSettingsSessionId(props.sessions);
      var valuesPair = useState({ enabled: false, maxMembers: 4, maxActiveTurns: 2 }), values = valuesPair[0], setValues = valuesPair[1];
      var loadingPair = useState(true), loading = loadingPair[0], setLoading = loadingPair[1];
      var savingPair = useState(false), saving = savingPair[0], setSaving = savingPair[1];
      var errorPair = useState(""), error = errorPair[0], setError = errorPair[1];
      var savedPair = useState(false), saved = savedPair[0], setSaved = savedPair[1];
      function applyState(state) { var config = state.config || {}; setValues({ enabled: !!state.enabled, maxMembers: Number(config.maxMembers) || 4, maxActiveTurns: Number(config.maxActiveTurns) || 2 }); }
      useEffect(function () {
        var alive = true; setLoading(true); setError("");
        fetchState(sessionId).then(function (state) { if (alive) applyState(state); }).catch(function (err) { if (alive) setError(errorText(err)); }).finally(function () { if (alive) setLoading(false); });
        return function () { alive = false; };
      }, [sessionId]);
      function valid(value) { var number = Number(value); return Number.isInteger(number) && number >= 1 && number <= 8; }
      function submit(event) {
        event.preventDefault(); if (!valid(values.maxMembers) || !valid(values.maxActiveTurns)) { setError(t("settingsRange")); return; }
        setSaving(true); setSaved(false); setError("");
        postAction(sessionId, "settings", { enabled: !!values.enabled, maxMembers: Number(values.maxMembers), maxActiveTurns: Number(values.maxActiveTurns) }).then(function (result) { if (result && result.state) applyState(result.state); setSaved(true); }).catch(function (err) {
          setError(err && err.code === "AGENT_TEAMS_CONFLICT" ? t("settingsCloseTeamsFirst") : errorText(err));
          return fetchState(sessionId).then(applyState).catch(function () {});
        }).finally(function () { setSaving(false); });
      }
      function numberField(id, label, key) { return h("label", { htmlFor: id }, h("span", { className: "dat-label" }, label), h("input", { id: id, className: "dat-field", type: "number", min: 1, max: 8, step: 1, value: values[key], onChange: function (event) { var next = {}; next[key] = event.target.value; setValues(Object.assign({}, values, next)); setSaved(false); } })); }
      return h("section", { style: { maxWidth: 680, color: "var(--dsw-alias-label-primary)" }, "aria-labelledby": "dat-settings-title" },
        h("h2", { id: "dat-settings-title" }, t("settingsTitle")), h("p", { className: "dat-meta" }, t("settingsDescription")),
        loading ? h("div", { role: "status" }, t("loading")) : h("form", { onSubmit: submit, className: "dat-panel" },
          h("label", { className: "dat-row", style: { justifyContent: "space-between" } }, h("span", null, t("settingsEnabled")), h("input", { type: "checkbox", role: "switch", checked: values.enabled, disabled: saving, onChange: function (event) { setValues(Object.assign({}, values, { enabled: event.target.checked })); setSaved(false); } })),
          numberField("dat-max-members", t("settingsMaxMembers"), "maxMembers"), numberField("dat-max-turns", t("settingsMaxActiveTurns"), "maxActiveTurns"),
          error ? h("div", { className: "dat-error", role: "alert" }, error) : null,
          h("div", { className: "dat-actions" }, h(Button, { type: "submit", primary: true, disabled: saving }, saving ? t("settingsSaving") : t("settingsSave")), saved ? h("span", { className: "dat-note", role: "status" }, t("settingsSaved")) : null)
        )
      );
    }

    function apply(ctx) {
      injectStyles();
      try { ctx.effect(function () { return ctx.locale.register(NS, { zh: zh, en: en }); }, "agent-teams: dictionaries"); } catch (_) {}
      try { translate = ctx.locale.bind(NS); } catch (_) {}
      try { currentLang = ctx.locale.getLocale().active || currentLang; } catch (_) {}
      try { ctx.locale.subscribe(function () { try { currentLang = ctx.locale.getLocale().active || currentLang; } catch (_) {} localeListeners.slice().forEach(function (listener) { listener(); }); }); } catch (_) {}
      function View(props) { return h(TeamView, Object.assign({}, props, { sessions: ctx.sessions })); }
      function Settings() { return h(AgentTeamsSettings, { sessions: ctx.sessions }); }
      ctx.slots.inject("conversation.view", function () { return ctx.slots.register({ name: "conversation.view", id: "agent-teams", order: 20, locale: NS, label: function () { return translate("title"); } }, View); });
      ctx.slots.inject("settings.section", function () { return ctx.slots.register({ name: "settings.section", id: "agent-teams-settings", order: 35, locale: NS, label: function () { return translate("settingsTitle"); } }, Settings); });
    }

    exports.apply = apply;
    exports.inject = ["slots", "locale", "sessions"];
    return module.exports;
  }
});
