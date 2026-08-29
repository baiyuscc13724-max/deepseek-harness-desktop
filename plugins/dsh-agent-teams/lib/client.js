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
      title: "代理团队", loading: "正在载入团队工作区…", retry: "重试", loadError: "暂时无法更新团队信息：{error}。请重试；如果仍失败，可以返回对话继续工作。", actionError: "操作没有完成。请按页面提示处理后重试；如果仍失败，请返回负责人对话查看状态。技术详情：{error}",
      disabled: "自动团队尚未启用", disabledBody: "启用后，你只需像平常一样描述目标；AI 会判断是否需要团队，简单任务不会强行组队。", enable: "启用自动团队", enabling: "正在启用…", disable: "关闭自动团队", disabling: "正在关闭…", disableActiveHint: "存在活动团队时无法关闭自动团队。请先让负责人完成任务并关闭所有活动团队。", disableSafeHint: "关闭后不会创建新团队；已关闭团队的历史仍会保留。",
      noTeam: "自动团队已开启", wizardIntro: "无需配置团队。回到对话直接说出目标，AI 会自动判断是否需要并行；下面的模板仅供希望立即指定方向时使用。", backToChat: "返回对话，直接说目标", chooseTemplate: "可选：协作方向", defineObjective: "可选：立即填写目标", prepare: "放入输入框", prepared: "已放入底部输入框。请检查内容并点击发送；系统不会自动发送。", objectivePlaceholder: "例如：完成新版团队工作台并通过验证",
      research: "调研与核验", researchBody: "研究员收集资料，分析员交叉验证，负责人汇总结论。", build: "开发与审查", buildBody: "开发负责改动，审查负责风险，测试负责验证。", incident: "问题诊断", incidentBody: "诊断、修复与回归验证并行推进。", custom: "自定义团队", customBody: "只填写目标，由 AI 自动设计成员、职责、任务边界和协作方式。",
      active: "协作进行中", paused: "已由用户停止", pausedBody: "团队已停止，不会在后台继续。要恢复，请生成继续请求并在底部输入框中确认发送。", continueTeam: "生成继续请求", failedNext: "有成员未能完成工作。请打开成员列表查看详情，再让负责人处理未完成任务。", closed: "团队已关闭", closedBody: "该团队不再接受成员协作；历史成员、任务和事件仍可查看。", unknown: "未知", status: "状态", objective: "团队目标", connection: "连接", live: "已更新", polling: "正在保持更新", stale: "信息可能不是最新", disconnected: "正在重新连接", workspaceIntro: "默认只展示现在需要关注的工作；完成内容和协作细节按需查看。",
      members: "成员", tasks: "任务", events: "协作事件", noMembers: "暂无成员", noTasks: "暂无任务", noEvents: "暂无协作事件", lead: "负责人", leadRole: "统筹目标和结果", openConversation: "查看实时工作", currentTask: "当前任务：{value}", model: "模型", mainModel: "主模型", subagentModel: "成员模型", inheritsMain: "与负责人相同", currentWork: "当前工作", listView: "列表", canvasView: "画布", canvasLabel: "团队实时画布", canvasHint: "选择成员可打开统一代理目录；连线表示分配、依赖、阻塞或文件冲突。", assignedRelation: "分配", dependsRelation: "依赖", blockedRelation: "阻塞", conflictRelation: "冲突", completedSummary: "已完成 {count} 项", noActiveTasks: "当前没有待处理或进行中的任务。", completedTasks: "已完成", taskHistory: "任务历史", historyHint: "完成的任务会自动移到这里，不再占用当前工作区。", openHistory: "查看历史 {count}", hideHistory: "收起历史", openMembers: "代理目录 {count}", openActivity: "动态 {count}", memberPanel: "团队成员", activityPanel: "协作动态", closePanel: "关闭侧栏", activeMembers: "当前成员", pastMembers: "过往成员", moreActions: "更多操作", fewerActions: "收起操作", workspaceSettings: "团队设置", archive: "历史", archivedTeams: "历史团队", activeTeamList: "进行中的团队", noArchivedTeams: "暂无历史团队", recentActivity: "最近动态", showMore: "再显示 {count} 条",
      pending: "待处理", in_progress: "进行中", completed: "已完成", cancelled: "已取消", blocked: "受阻", ready: "等待任务", running: "工作中", idle: "本轮工作已完成", provisioning: "正在启动", shutting_down: "正在停止", closing: "正在关闭", retired: "已结束协作", failed: "失败", delivered: "已送达", closedStatus: "已关闭",
      assignee: "执行成员", unassigned: "未分配", blockedBy: "正在等待：{value}", failedBy: "失败的前置任务：{value}", dependencySources: "还需其他团队完成：{value}", conflicts: "文件范围可能冲突：{value}", files: "文件：{value}", filesHidden: "为保护工作区信息，此页面不显示文件路径；需要时请让负责人核对。", taskFallback: "任务 {id}", lastActivity: "最后活动：{value}", deliveryEvent: "{from} → {to} · {status}", crossDelivery: "{fromTeam} → {toTeam} · {from} → {to} · {status}", taskDetail: "任务详情", taskDetailUnavailable: "此任务已结束或当前无法读取。请返回任务板选择其他任务，或查看任务历史。", taskSelectionExpired: "任务信息刚刚更新，原详情已关闭。请从当前任务列表重新选择。", blockedTaskReason: "受阻原因", blockedTaskUnknown: "暂未提供具体阻塞原因。", blockedTaskNext: "下一步：等待列出的依赖完成；如果信息已过期，请让负责人刷新依赖或重新协调任务。", taskDependencies: "依赖任务", taskEvents: "相关实时事件", taskRef: "任务编号", taskBackToBoard: "返回任务板", taskWorkflow: "实时工作流", taskWorkflowHint: "状态和动态会随团队实时更新；没有可靠记录的环节不会猜测。", taskOverview: "任务概览", taskLiveEvents: "实时动态", taskLiveEventsHint: "这里只显示与当前任务有关的最新协作记录。", taskLiveConnected: "详情会随团队状态自动更新。", taskBlockedBranch: "当前阻塞", taskBlockedClear: "当前没有阻塞", taskBlockedBranchHint: "阻塞不是必经阶段；只有任务实时报告受阻时才会点亮。", taskStageCurrent: "当前阶段", taskStageReached: "已有记录", taskStageUpcoming: "尚未到达", taskStageUnknown: "暂无可靠记录", taskCreatedAt: "进入待处理", taskStartedAt: "开始执行", taskCompletedAt: "完成时间", taskResult: "成员成果", taskResultPreview: "已提交成果", taskResultTruncated: "成果较长，已显示安全截断版本。", taskNextStep: "当前下一步", taskNextPending: "等待负责人或成员认领；存在依赖时先完成依赖。", taskNextProgress: "执行成员正在推进；下方动态会持续更新。", taskNextCompleted: "任务已经完成，可在实时动态中回看相关协作。", taskTimelineLimited: "仅显示最新 {count} 条相关动态。",
      quickActions: "快捷提示", addMember: "添加成员", newPeerTeam: "评估是否需要新团队", createTask: "创建任务", coordinate: "协调团队", summarize: "汇总进展", closeTeam: "请求关闭", newTeam: "创建新团队", draftOnly: "操作会写入下方输入框，不会自动发送。", draftSet: "已放入底部输入框。请检查内容并点击发送；系统不会自动发送。", creationSent: "创建请求已发送，正在返回对话。", creationSentFallback: "创建请求已发送。请使用上方“对话”标签查看响应。",
      teamsOverview: "团队总览", teamCount: "共 {count} 个团队", activeTeams: "活跃 {count}", closedTeams: "已关闭 {count}", switchTeam: "切换到团队：{name}", crossTeam: "跨团队动态", noCrossTeam: "暂无跨团队动态", backgroundHint: "切换团队或页面不会停止后台成员。", teamTasks: "{active} 进行中 · {done} 已完成", lastUpdated: "更新于 {value}",
      currentSession: "当前会话", revision: "状态版本 {value}", settingsTitle: "代理团队", settingsDescription: "启用后只需正常描述目标，AI 自动判断是否使用团队；简单任务保持单人执行。数值越高通常会使用更多模型额度并增加费用；不确定时保留推荐值。", settingsEnabled: "启用自动团队", settingsMaxMembers: "每个团队的成员上限", settingsMaxActiveTurns: "同时工作的成员上限（所有团队合计）", settingsSave: "保存设置", settingsSaving: "正在保存…", settingsSaved: "设置已保存", settingsRange: "两项设置都请输入 1 到 8 之间的整数。", settingsCloseTeamsFirst: "请先在负责人会话中关闭所有活动团队，再关闭代理团队功能。"
    };
    var en = {
      title: "Agent Teams", loading: "Loading team workspace…", retry: "Retry", loadError: "Team information could not be updated: {error}. Try again; if it still fails, you can continue working in Chat.", actionError: "The action did not finish. Follow the guidance on this page, then try again. If it still fails, return to the lead conversation to review status. Technical details: {error}",
      disabled: "Automatic teams are disabled", disabledBody: "After enabling, describe goals normally. AI decides whether a team is useful and keeps simple work solo.", enable: "Enable automatic teams", enabling: "Enabling…", disable: "Turn off automatic teams", disabling: "Turning off…", disableActiveHint: "Automatic teams cannot be turned off while a team is active. Ask the lead to finish work and close every active team first.", disableSafeHint: "Turning this off prevents new teams; closed-team history remains available.",
      noTeam: "Automatic teams are ready", wizardIntro: "No team setup is required. Return to Chat and state the goal normally; AI decides whether to parallelize. The templates below are optional shortcuts.", backToChat: "Return to Chat and state a goal", chooseTemplate: "Optional: collaboration direction", defineObjective: "Optional: enter a goal now", prepare: "Put in composer", prepared: "Added to the composer below. Review it and select Send; it will not be sent automatically.", objectivePlaceholder: "For example: deliver the new team workspace and verify it",
      research: "Research & verify", researchBody: "A researcher gathers evidence, an analyst cross-checks it, and the lead synthesizes findings.", build: "Build & review", buildBody: "Development makes changes, Review checks risk, and Test verifies the result.", incident: "Diagnose an issue", incidentBody: "Diagnosis, remediation, and regression verification move in parallel.", custom: "Custom team", customBody: "Enter only the objective; AI designs the members, responsibilities, task boundaries, and collaboration pattern.",
      active: "Collaboration active", paused: "Stopped by user", pausedBody: "This team is stopped and will not continue in the background. To resume, prepare a continue request and confirm Send in the composer below.", continueTeam: "Prepare continue request", failedNext: "A member could not finish its work. Open the member list for details, then ask the lead to handle unfinished tasks.", closed: "Team closed", closedBody: "This team no longer accepts member collaboration. Its members, tasks, and events remain available.", unknown: "Unknown", status: "Status", objective: "Team objective", connection: "Connection", live: "Up to date", polling: "Keeping up to date", stale: "Information may be out of date", disconnected: "Reconnecting", workspaceIntro: "Only work that needs attention is shown by default. Completed work and collaboration details stay available on demand.",
      members: "Members", tasks: "Tasks", events: "Collaboration events", noMembers: "No members", noTasks: "No tasks", noEvents: "No collaboration events", lead: "Lead", leadRole: "Plans the goal and owns the result", openConversation: "View live work", currentTask: "Current task: {value}", model: "Model", mainModel: "Main model", subagentModel: "Member model", inheritsMain: "Same as lead", currentWork: "Current work", listView: "List", canvasView: "Canvas", canvasLabel: "Live team canvas", canvasHint: "Select a member to open the unified agent catalog. Lines show assignment, dependency, blocking, or file conflicts.", assignedRelation: "Assigned", dependsRelation: "Depends on", blockedRelation: "Blocked by", conflictRelation: "Conflict", completedSummary: "{count} completed", noActiveTasks: "No pending or in-progress tasks.", completedTasks: "Completed", taskHistory: "Task history", historyHint: "Completed tasks move here automatically instead of filling the current workspace.", openHistory: "View history {count}", hideHistory: "Hide history", openMembers: "Agents {count}", openActivity: "Activity {count}", memberPanel: "Team members", activityPanel: "Collaboration activity", closePanel: "Close sidebar", activeMembers: "Current members", pastMembers: "Past members", moreActions: "More actions", fewerActions: "Hide actions", workspaceSettings: "Team settings", archive: "History", archivedTeams: "Team history", activeTeamList: "Active teams", noArchivedTeams: "No archived teams", recentActivity: "Recent activity", showMore: "Show {count} more",
      pending: "Pending", in_progress: "In progress", completed: "Completed", cancelled: "Cancelled", blocked: "Blocked", ready: "Waiting for work", running: "Working", idle: "Finished this turn", provisioning: "Starting", shutting_down: "Stopping", closing: "Closing", retired: "No longer active", failed: "Failed", delivered: "Delivered", closedStatus: "Closed",
      assignee: "Assignee", unassigned: "Unassigned", blockedBy: "Waiting for: {value}", failedBy: "Failed prerequisites: {value}", dependencySources: "Waiting for another team: {value}", conflicts: "File boundaries may conflict: {value}", files: "Files: {value}", filesHidden: "File paths are hidden here to protect workspace information. Ask the lead to verify them when needed.", taskFallback: "Task {id}", lastActivity: "Last activity: {value}", deliveryEvent: "{from} → {to} · {status}", crossDelivery: "{fromTeam} → {toTeam} · {from} → {to} · {status}", taskDetail: "Task detail", taskDetailUnavailable: "This task has finished or cannot be read right now. Return to the task board or review task history.", taskSelectionExpired: "Task information just changed, so the old detail was closed. Select it again from the current task list.", blockedTaskReason: "Why this task is blocked", blockedTaskUnknown: "No specific blocking reason is available yet.", blockedTaskNext: "Next: wait for the listed dependencies. If this information is stale, ask the lead to refresh dependencies or coordinate the task again.", taskDependencies: "Dependencies", taskEvents: "Related live events", taskRef: "Task ID", taskBackToBoard: "Back to task board", taskWorkflow: "Live workflow", taskWorkflowHint: "Status and activity update with the team. Stages without reliable evidence are never guessed.", taskOverview: "Task overview", taskLiveEvents: "Live activity", taskLiveEventsHint: "Only the latest collaboration records related to this task are shown here.", taskLiveConnected: "This detail updates with the team state.", taskBlockedBranch: "Current blocker", taskBlockedClear: "No current blocker", taskBlockedBranchHint: "Blocking is not a required stage. It lights up only when the task reports a live blocker.", taskStageCurrent: "Current stage", taskStageReached: "Recorded", taskStageUpcoming: "Not reached", taskStageUnknown: "No reliable record", taskCreatedAt: "Entered pending", taskStartedAt: "Work started", taskCompletedAt: "Completed at", taskResult: "Member result", taskResultPreview: "Result delivered", taskResultTruncated: "This result was long, so a safely truncated version is shown.", taskNextStep: "Current next step", taskNextPending: "Waiting for the lead or a member to claim it; prerequisites finish first.", taskNextProgress: "The assigned member is working; live activity below will keep updating.", taskNextCompleted: "The task is complete. Review related collaboration in the live activity.", taskTimelineLimited: "Showing only the latest {count} related updates.",
      quickActions: "Prompt shortcuts", addMember: "Add member", newPeerTeam: "Check whether another team is needed", createTask: "Create task", coordinate: "Coordinate team", summarize: "Summarize progress", closeTeam: "Request shutdown", newTeam: "Create another team", draftOnly: "Actions write to the composer and never send automatically.", draftSet: "Added to the composer below. Review it and select Send; it will not be sent automatically.", creationSent: "Creation request sent; returning to Chat.", creationSentFallback: "Creation request sent. Use the Chat tab above to view the response.",
      teamsOverview: "Team overview", teamCount: "{count} teams", activeTeams: "{count} active", closedTeams: "{count} closed", switchTeam: "Switch to team: {name}", crossTeam: "Cross-team activity", noCrossTeam: "No cross-team activity", backgroundHint: "Switching teams or views never stops background members.", teamTasks: "{active} active · {done} done", lastUpdated: "Updated {value}",
      currentSession: "Current session", revision: "Status version {value}", settingsTitle: "Agent Teams", settingsDescription: "After enabling, describe goals normally and AI decides whether to use a team; simple work stays solo. Higher values usually use more model quota and may cost more; keep the recommended values if unsure.", settingsEnabled: "Enable automatic teams", settingsMaxMembers: "Member limit per team", settingsMaxActiveTurns: "Members working at once (all teams combined)", settingsSave: "Save settings", settingsSaving: "Saving…", settingsSaved: "Settings saved", settingsRange: "Enter a whole number from 1 to 8 for both settings.", settingsCloseTeamsFirst: "Close every active team from its lead conversation before disabling Agent Teams."
    };
    Object.assign(zh, {
      projectEntryTitle: "多人连接（预览）", projectEntryIntro: "本机成员可以执行团队任务；其他电脑目前只能安全配对、建立加密连接并查看在线状态。", projectCreate: "创建安全连接空间", projectCreating: "正在创建…", projectName: "项目名称", projectNamePlaceholder: "例如：产品发布协作", projectOwner: "你的显示名称", projectOwnerPlaceholder: "例如：负责人", projectNotCreated: "尚未创建连接空间", projectReady: "安全连接配置已就绪", projectPreviewBadge: "仅连接预览", projectRef: "项目 ID", projectMembers: "成员 {count}", projectRevision: "权限版本 {value}", projectLocalMode: "本机智能团队", projectLocalModeHint: "AI 自动判断并组建必要的代理团队。", projectLanMode: "同一局域网", projectLanReady: "已可建立安全的局域网连接", projectLanWaiting: "尚未启动局域网连接", projectLanDiscovery: "局域网配对", projectLanPending: "不会广播扫描其他设备；一次性批准信息会安全携带固定入口和设备凭据。", projectLanEndpoint: "连接地址 {host}:{port}", projectRefresh: "刷新状态", projectRemoteMode: "不在同一网络", projectRemoteHint: "通过中转服务建立端到端加密连接；中转服务只能转发加密数据，不能读取内容。", projectInviteName: "受邀成员显示名称", projectInviteNamePlaceholder: "例如：评审", projectInviteRole: "成员角色", projectCreateInvite: "生成远程邀请", projectInviteCode: "一次性邀请信息", projectCopy: "复制", projectCopied: "已复制", projectRelayUrl: "远程连接地址", projectRelayPlaceholder: "wss://relay.example.com", projectSaveRelay: "保存连接地址", projectConnectRemote: "建立远程连接", projectDisconnectRemote: "断开远程连接", projectRemoteConnected: "远程连接已建立", projectRemoteDisconnected: "远程连接未建立", projectChannelPending: "还差一步：双方完成密钥交换后才能连接。", projectHypoMux: "本功能不会使用下载加速通道同步协作内容。", projectAdvanced: "局域网与远程连接", projectUnavailable: "暂时无法读取多人连接状态：{error}。请重试；如果仍失败，请检查连接信息。", owner: "所有者", maintainer: "维护者", contributor: "贡献者", reviewer: "评审", observer: "观察者"
    });
    Object.assign(en, {
      projectEntryTitle: "Connect other people (preview)", projectEntryIntro: "Local members can run team tasks. Other computers can currently pair securely, establish encrypted connections, and show presence only.", projectCreate: "Create secure access space", projectCreating: "Creating…", projectName: "Project name", projectNamePlaceholder: "e.g. Product release", projectOwner: "Your display name", projectOwnerPlaceholder: "e.g. Lead", projectNotCreated: "No secure access space yet", projectReady: "Secure access configuration is ready", projectPreviewBadge: "Connection preview only", projectRef: "Project ID", projectMembers: "{count} members", projectRevision: "Access version {value}", projectLocalMode: "Local AI team", projectLocalModeHint: "AI decides whether and how to create the necessary agent team.", projectLanMode: "Same LAN", projectLanReady: "A secure LAN connection is ready", projectLanWaiting: "The LAN connection is not started", projectLanDiscovery: "LAN pairing", projectLanPending: "Other devices are not scanned or broadcast. The one-time approval safely carries the fixed endpoint and device credential.", projectLanEndpoint: "Endpoint {host}:{port}", projectRefresh: "Refresh status", projectRemoteMode: "Different networks", projectRemoteHint: "Use a relay to create an end-to-end encrypted connection. The relay can forward encrypted data but cannot read its contents.", projectInviteName: "Invitee display name", projectInviteNamePlaceholder: "e.g. Reviewer", projectInviteRole: "Member role", projectCreateInvite: "Generate remote invite", projectInviteCode: "One-time invitation", projectCopy: "Copy", projectCopied: "Copied", projectRelayUrl: "Remote connection address", projectRelayPlaceholder: "wss://relay.example.com", projectSaveRelay: "Save connection address", projectConnectRemote: "Connect remotely", projectDisconnectRemote: "Disconnect remote connection", projectRemoteConnected: "Remote connection established", projectRemoteDisconnected: "Remote connection not established", projectChannelPending: "The device E2EE channel still requires an explicit key exchange.", projectHypoMux: "HypoMux aggregates Windows multi-NIC downloads; it is not a sync protocol and is not used as the collaboration transport.", projectAdvanced: "LAN and remote access", projectUnavailable: "Collaboration entry unavailable: {error}", owner: "Owner", maintainer: "Maintainer", contributor: "Contributor", reviewer: "Reviewer", observer: "Observer"
    });
    Object.assign(zh, {
      projectJoinExisting: "加入已有团队", projectJoinIntro: "邀请码只用于生成本机密钥和加入请求；由项目负责人批准后，再把批准信息粘贴回来完成配对。", projectJoinInvite: "负责人发来的邀请码", projectPrepareJoin: "生成加入请求", projectJoinRequest: "加入请求", projectApprovalRequest: "成员发来的加入请求", projectApproveJoin: "批准加入", projectJoinResponse: "批准信息", projectCompleteJoin: "完成加入", projectPairingPending: "等待负责人批准", projectPairingReady: "设备密钥交换已完成", projectRelayManualHint: "如果负责人稍后才设置远程连接，请粘贴其提供的同一个连接地址；已经完成的配对不会丢失。", projectChannelReady: "端到端通道已就绪", projectLanHost: "私网 IP", projectLanPort: "端口", projectLanCert: "设备证书（PEM）", projectLanKey: "设备私钥（PEM）", projectLanCa: "项目 CA（PEM）", projectStartLan: "启动局域网入口", projectStopLan: "停止局域网入口", projectConnectLan: "验证局域网连接", projectLanConnected: "局域网 mTLS 已验证"
    });
    Object.assign(en, {
      projectJoinExisting: "Join an existing team", projectJoinIntro: "The invite creates this desktop's keys and join request. Paste the owner's approval response back here to finish pairing.", projectJoinInvite: "Invite from the owner", projectPrepareJoin: "Create join request", projectJoinRequest: "Join request", projectApprovalRequest: "Join request from a member", projectApproveJoin: "Approve join", projectJoinResponse: "Approval response", projectCompleteJoin: "Complete join", projectPairingPending: "Waiting for owner approval", projectPairingReady: "Device key exchange complete", projectRelayManualHint: "If the owner sets up the remote connection later, paste the same connection address they provide. Your completed pairing will remain available.", projectChannelReady: "End-to-end channel ready", projectLanHost: "Private IP", projectLanPort: "Port", projectLanCert: "Device certificate (PEM)", projectLanKey: "Device private key (PEM)", projectLanCa: "Project CA (PEM)", projectStartLan: "Start LAN endpoint", projectStopLan: "Stop LAN endpoint", projectConnectLan: "Verify LAN connection", projectLanConnected: "LAN mTLS verified"
    });
    Object.assign(zh, {
      workspaceNavigation: "代理团队工作台",
      workspaceBoard: "任务板",
      workspaceCanvas: "团队画布",
      workspaceFlow: "团队工作流程",
      workspaceAutomation: "定时与自动化",
      workspaceParticipants: "参与者",
      workspaceInbox: "协调记录",
      boardTitle: "当前团队任务板",
      boardIntro: "按真实运行状态整理当前所选团队；切换团队不会停止后台成员。",
      boardScope: "当前团队任务（仅查看）",
      boardReadOnly: "仅查看",
      boardReadOnlyHint: "这里用于查看最新状态。要创建、分配或完成任务，请在负责人对话中提出；系统仍会校验你的权限和任务状态是否为最新。",
      boardPending: "Ready · 就绪",
      boardProgress: "Running · 执行中",
      boardBlocked: "Attention · 需关注",
      boardCompleted: "Done · 已完成",
      boardCancelled: "已取消",
      boardEmpty: "此区暂无任务",
      boardBlockedDerived: "“需关注”只汇集 Host 投影中的阻塞、失败前置、权限、确认、副作用或冲突事实；不会改写任务的权威状态。",
      boardFactLegend: "事实来源：任务状态、依赖、尝试次数、权限/副作用结论与时间来自 Host 权威投影；成员 Todo 里程碑、checkpoint 和提交结果均明确标为未验证。",
      boardCancelledHistoryHint: "取消的任务只进入历史，不占用当前四个主区。",
      boardOpenCancelled: "查看已取消历史 {count}",
      boardHideCancelled: "收起已取消历史",
      boardAttempt: "尝试 {value}",
      boardMilestones: "成员计划里程碑（未验证） {completed}/{total}",
      boardMemberCheckpoint: "成员 checkpoint（未验证）",
      boardMemberNextStep: "成员下一步（未验证）",
      boardCheckpoint: "成员提交结果（未独立验证）",
      boardHostFacts: "Host 事实",
      boardNeedsConfirmation: "等待人工确认",
      boardPermissionAttention: "权限需要处理",
      boardSideEffectAttention: "副作用边界需要确认",
      boardStaleAttention: "状态已滞留，请由负责人刷新",
      boardNextReady: "下一步：等待成员认领；若有依赖，先完成依赖。",
      boardNextRunning: "下一步：执行成员继续推进，并提交可核对 checkpoint。",
      boardNextAttention: "下一步：按上方 Host 事实解除阻塞或完成确认。",
      boardNextDone: "下一步：负责人核对成果与质量记录。",
      boardMore: "另有 {count} 项未显示；可在团队画布的列表模式查看",
      planLifecycleTitle: "计划生命周期", planLifecycleHint: "阶段、授权和交接均来自 Host 持久记录；未完成或未知的事实不会被推测。", planDraft: "草案", planCommitted: "已提交", planActive: "已激活", planRevision: "计划修订 {value}", planPauseEpoch: "暂停代次 {value}", planAuthorization: "计划预检", planAuthorizationSource: "授权依据：{value}", planAuthorizationHumanAttestedHint: "启用自动团队后，安全范围内的普通计划持续使用此默认授权；这是用户授权记录，不是 Host 验证证明。", planAuthHostVerified: "Host 已验证", planAuthHumanAttested: "自动驾驶默认授权", planAuthUnknown: "需关注 · 尚未验证", planPreflightPermissions: "权限", planPreflightFiles: "文件边界", planPreflightCost: "模型成本", planPreflightEffects: "外部副作用", planLegacyUnplanned: "这是迁移保留的旧团队，尚无完整计划记录。", planLegacyActiveGate: "旧团队的进行中工作已保留；新认领和新成员仍受当前计划门禁约束。", handoffTitle: "负责人交接", handoffNone: "当前没有待接管的交接。", handoffPending: "交接已准备，正在等待目标负责人接管。", handoffPreparedAt: "准备于 {value}", handoffExpiresAt: "有效期至 {value}", handoffHistory: "最近交接记录", handoffPrepared: "已准备交接", handoffAdopted: "已完成接管", handoffHistoryMore: "仅显示最近 {count} 条安全记录。",
      boardLeaseEpoch: "租约代次 {value}", boardCapabilities: "能力已验证 {verified}/{total}", taskAssuranceTitle: "执行安全与历史", taskAssuranceHint: "租约代次与尝试记录由 Host 持久化；成员 checkpoint 仍然是未验证陈述。", taskCurrentAttempt: "当前尝试", taskCurrentLease: "当前租约代次", taskAttemptHistory: "尝试与中断记录", taskHistoryEmpty: "尚无尝试或中断记录。", taskCapabilities: "能力预检", taskCapabilitiesEmpty: "此任务未声明额外能力要求。", taskCapabilityVerified: "已验证", taskCapabilityUnknown: "未知", taskCapabilityUnavailable: "不可用", taskCapabilityChecked: "核验于 {value}", taskEffects: "外部副作用", taskEffectsEmpty: "此任务未声明外部副作用。", taskMemberReports: "成员报告（未验证）", taskHistoryClaimed: "任务已认领", taskHistoryMigratedClaim: "迁移了既有认领", taskHistoryReleased: "任务已释放", taskHistoryRestarted: "启动期间发生 Host 重启", taskHistoryOwnershipAdopted: "团队交接后租约失效", taskHistoryMemberStartFailed: "成员启动失败", taskHistoryStoppedBeforeStart: "启动前被停止", taskHistoryProvisioningFailed: "成员创建失败", taskHistoryUserStop: "用户停止团队", taskHistoryOther: "执行记录：{value}", effectPolicyNone: "无外部副作用", effectPolicyIdempotent: "幂等协议", effectPolicyConfirmEach: "每次确认", effectPolicyForbidden: "禁止", effectOutcomeNotStarted: "未开始", effectOutcomeSucceeded: "已成功", effectOutcomeFailed: "已失败", effectOutcomeUnknown: "结果未知",
      boardOpenCanvas: "查看团队关系",
      flowTitle: "团队执行流程",
      flowIntro: "此页说明团队当前如何工作；现阶段仅供查看，暂不能编辑流程。",
      flowReadOnly: "工作方式说明 · 仅查看",
      flowGoal: "说明目标",
      flowGoalBody: "你向负责人说明想要完成的结果",
      flowPlan: "负责人判断",
      flowPlanBody: "确认是否值得并行，以及成本和边界",
      flowTasks: "可追踪任务",
      flowTasksBody: "先记录任务、先后关系和文件范围",
      flowMembers: "必要成员",
      flowMembersBody: "按任务加入必要成员",
      flowCoordinate: "协调记录",
      flowCoordinateBody: "处理交接、阻塞与跨团队投递",
      flowResult: "汇总结果",
      flowResultBody: "负责人验收并向人交付",
      automationTitle: "定时任务与自动化",
      automationIntro: "左侧是当前会话提醒，右侧是可审批、可追踪的项目自动化；两者互不触发、互不合并记录。",
      projectAutomation: "项目自动化",
      projectAutomationPending: "项目自动化按“手动触发 → 人工批准 → 进入队列 → 后台执行”推进，每一步都会保留可核对的记录。",
      notAvailableYet: "暂不可用",
      sessionSchedules: "当前会话提醒",
      sessionScheduleScope: "仅当前会话",
      sessionScheduleLimit: "仅在原会话在线时触发；错过的提醒会在恢复会话后补发。提醒已触发不代表团队任务已完成。",
      scheduleLoading: "正在读取会话提醒…",
      scheduleUnavailable: "此会话当前未运行。请先恢复原会话，再刷新此页。",
      scheduleEmpty: "暂无会话提醒",
      scheduleHistory: "最近触发与停用记录",
      scheduleOpenFull: "打开完整定时任务",
      scheduleRefresh: "刷新",
      participantsTitle: "参与者与协作接入",
      participantsIntro: "本机成员可以接收团队任务；人类成员和其他电脑目前只能建立安全连接，不能接收任务。",
      collaborationPreview: "可安全配对其他电脑、查看在线状态，并同步项目任务与项目自动化的安全摘要。旧团队任务、团队消息和远端成员分配仍只在负责人团队中处理。",
      executionResources: "当前执行资源",
      collaborationAccess: "多人协作接入",
      participantsEmpty: "当前团队暂无成员",
      participantsOpenCatalog: "打开代理目录",
      participantCurrentTask: "当前任务：{value}",
      participantNoTask: "暂无分配任务",
      inboxTitle: "协调记录",
      inboxIntro: "这里显示谁向谁发送了协调信息、是否送达和时间。为保护内容，消息正文请到对应成员对话查看。",
      inboxMetaOnly: "仅显示投递信息",
      inboxEmpty: "暂无需要关注的协调动态",
      inboxOpenCanvas: "返回团队画布",
      inboxOpenBoard: "返回任务板",
      emptyBoardTitle: "任务板已经就绪",
      emptyBoardIntro: "首个团队出现后，真实任务会自动进入下面四列；现在先保留完整工作台结构，不再用旧向导替代任务板。",
      emptyBoardHint: "任务状态来自团队运行时；创建团队前不会生成示例任务或伪造进度。",
      emptyBoardWaiting: "等待首个团队",
      emptyCanvasTitle: "团队画布已经就绪",
      emptyCanvasIntro: "首个团队出现后，这里会显示负责人、成员、任务以及分配、依赖、阻塞和冲突连线。",
      emptyCanvasGoal: "团队目标",
      emptyCanvasGoalBody: "由人提出要完成的结果",
      emptyCanvasLead: "根负责人",
      emptyCanvasLeadBody: "判断是否组队并承担最终交付",
      emptyCanvasWork: "成员与任务",
      emptyCanvasWorkBody: "按真实任务建立分工与依赖",
      emptyCanvasCoordination: "协调工作区",
      emptyCanvasCoordinationBody: "汇集交接、阻塞和跨团队投递",
      emptyCanvasWaiting: "等待首个团队后接入实时关系图",
      canvasControls: "画布视图控制",
      canvasViewport: "可缩放团队关系画布",
      canvasPanHint: "拖动空白处平移；按住 Ctrl 或 Command 滚动可缩放；方向键可滚动画布。",
      canvasZoomOut: "缩小画布",
      canvasZoomIn: "放大画布",
      canvasResetZoom: "恢复 100% 缩放",
      canvasFit: "适应窗口",
      canvasFitLabel: "适应",
      canvasEdgesLimited: "为保持界面流畅，当前绘制 {shown} 条关系，另有至少 {count} 条关系可在任务详情中查看。",
      boardProjectionLimited: "当前显示 {shown}/{total} 项任务。较早任务仍已保存，可在历史中查看。",
      workspaceUnavailable: "当前视图需要先启用代理团队。"
    });
    Object.assign(en, {
      workspaceNavigation: "Agent Teams workbench",
      workspaceBoard: "Task board",
      workspaceCanvas: "Team canvas",
      workspaceFlow: "How teams work",
      workspaceAutomation: "Schedules & automation",
      workspaceParticipants: "Participants",
      workspaceInbox: "Coordination activity",
      boardTitle: "Current team task board",
      boardIntro: "Organizes the selected team by real runtime state. Switching teams never stops background members.",
      boardScope: "Selected team tasks (view only)",
      boardReadOnly: "View only",
      boardReadOnlyHint: "This page shows the latest status. To create, assign, or complete a task, ask in the lead conversation; permission and current-state checks still apply.",
      boardPending: "Ready",
      boardProgress: "Running",
      boardBlocked: "Attention",
      boardCompleted: "Done",
      boardCancelled: "Cancelled",
      boardEmpty: "No tasks in this section",
      boardBlockedDerived: "Attention contains only blocker, failed prerequisite, permission, confirmation, side-effect, or conflict facts in the Host projection. It never rewrites authoritative task state.",
      boardFactLegend: "Source of truth: task state, dependencies, attempts, permission/effect findings, and timestamps come from the Host projection. Member Todo milestones, checkpoints, and submitted results remain explicitly unverified.",
      boardCancelledHistoryHint: "Cancelled tasks stay in history and never occupy the four current sections.",
      boardOpenCancelled: "View cancelled history {count}",
      boardHideCancelled: "Hide cancelled history",
      boardAttempt: "Attempt {value}",
      boardMilestones: "Member plan milestones (unverified) {completed}/{total}",
      boardMemberCheckpoint: "Member checkpoint (unverified)",
      boardMemberNextStep: "Member next step (unverified)",
      boardCheckpoint: "Member-submitted result (not independently verified)",
      boardHostFacts: "Host facts",
      boardNeedsConfirmation: "Waiting for human confirmation",
      boardPermissionAttention: "Permission needs attention",
      boardSideEffectAttention: "Side-effect boundary needs confirmation",
      boardStaleAttention: "State is stale; ask the lead to refresh it",
      boardNextReady: "Next: wait for a member to claim this task; finish dependencies first when listed.",
      boardNextRunning: "Next: the member continues and submits a reviewable checkpoint.",
      boardNextAttention: "Next: resolve the Host facts above or complete the required confirmation.",
      boardNextDone: "Next: the lead verifies the result and quality records.",
      boardMore: "{count} more are hidden; use List mode in Team canvas to review them",
      planLifecycleTitle: "Plan lifecycle", planLifecycleHint: "Phases, authorization, and handoff status come from durable Host records. Incomplete or unknown facts are never inferred.", planDraft: "Draft", planCommitted: "Committed", planActive: "Active", planRevision: "Plan revision {value}", planPauseEpoch: "Pause epoch {value}", planAuthorization: "Plan preflight", planAuthorizationSource: "Authorization basis: {value}", planAuthorizationHumanAttestedHint: "After Agent Teams is enabled, ordinary plans within the safe scope keep using this default authorization. It is a user authorization record, not Host-verified proof.", planAuthHostVerified: "Host verified", planAuthHumanAttested: "Autopilot default authorization", planAuthUnknown: "Attention · not verified", planPreflightPermissions: "Permissions", planPreflightFiles: "File boundaries", planPreflightCost: "Model cost", planPreflightEffects: "External side effects", planLegacyUnplanned: "This migrated legacy team does not yet have a complete planning record.", planLegacyActiveGate: "Existing legacy work remains active; new claims and members are still gated by the current plan.", handoffTitle: "Lead handoff", handoffNone: "No handoff is awaiting adoption.", handoffPending: "A handoff is prepared and waiting for the target lead to adopt it.", handoffPreparedAt: "Prepared {value}", handoffExpiresAt: "Expires {value}", handoffHistory: "Recent handoff records", handoffPrepared: "Handoff prepared", handoffAdopted: "Ownership adopted", handoffHistoryMore: "Only the latest {count} safe records are shown.",
      boardLeaseEpoch: "Lease epoch {value}", boardCapabilities: "Capabilities verified {verified}/{total}", taskAssuranceTitle: "Execution safety and history", taskAssuranceHint: "Lease epochs and attempts are durable Host facts. Member checkpoints remain unverified statements.", taskCurrentAttempt: "Current attempt", taskCurrentLease: "Current lease epoch", taskAttemptHistory: "Attempt and interruption history", taskHistoryEmpty: "No attempt or interruption has been recorded.", taskCapabilities: "Capability preflight", taskCapabilitiesEmpty: "This task declares no additional capability requirements.", taskCapabilityVerified: "Verified", taskCapabilityUnknown: "Unknown", taskCapabilityUnavailable: "Unavailable", taskCapabilityChecked: "Checked {value}", taskEffects: "External side effects", taskEffectsEmpty: "This task declares no external side effects.", taskMemberReports: "Member reports (unverified)", taskHistoryClaimed: "Task claimed", taskHistoryMigratedClaim: "Existing claim migrated", taskHistoryReleased: "Task released", taskHistoryRestarted: "Host restarted during startup", taskHistoryOwnershipAdopted: "Lease revoked after team handoff", taskHistoryMemberStartFailed: "Member start failed", taskHistoryStoppedBeforeStart: "Stopped before startup", taskHistoryProvisioningFailed: "Member provisioning failed", taskHistoryUserStop: "User stopped the team", taskHistoryOther: "Execution record: {value}", effectPolicyNone: "No external effect", effectPolicyIdempotent: "Idempotent protocol", effectPolicyConfirmEach: "Confirm each time", effectPolicyForbidden: "Forbidden", effectOutcomeNotStarted: "Not started", effectOutcomeSucceeded: "Succeeded", effectOutcomeFailed: "Failed", effectOutcomeUnknown: "Outcome unknown",
      boardOpenCanvas: "View team relationships",
      flowTitle: "Team execution flow",
      flowIntro: "This page explains how teams work today. It is view only and cannot edit the flow yet.",
      flowReadOnly: "How teams work · view only",
      flowGoal: "State the goal",
      flowGoalBody: "You tell the lead what outcome you need",
      flowPlan: "Lead decision",
      flowPlanBody: "Check whether parallel work is worthwhile, with clear cost and boundaries",
      flowTasks: "Tracked tasks",
      flowTasksBody: "Record tasks, prerequisites, and file boundaries first",
      flowMembers: "Necessary members",
      flowMembersBody: "Add only the members each task needs",
      flowCoordinate: "Coordination activity",
      flowCoordinateBody: "Handle handoffs, blocks, and cross-team delivery",
      flowResult: "Result delivery",
      flowResultBody: "The lead verifies and reports to the person",
      automationTitle: "Schedules and automation",
      automationIntro: "Session reminders stay on the left; reviewable project automation stays on the right. They never trigger each other or merge their history.",
      projectAutomation: "Project automation",
      projectAutomationPending: "Project automation follows Manual trigger → Human approval → Queue → Background execution, with a reviewable record at every step.",
      notAvailableYet: "Not available yet",
      sessionSchedules: "Current-session reminders",
      sessionScheduleScope: "This session only",
      sessionScheduleLimit: "Runs only while the original session is live. Missed reminders are delivered after it resumes. Delivery does not mean a team task succeeded.",
      scheduleLoading: "Loading session reminders…",
      scheduleUnavailable: "This session is not running. Resume the original session, then refresh this page.",
      scheduleEmpty: "No session reminders",
      scheduleHistory: "Recent dispatch and disable records",
      scheduleOpenFull: "Open full scheduled tasks",
      scheduleRefresh: "Refresh",
      participantsTitle: "Participants and collaboration access",
      participantsIntro: "Local members can receive team tasks. People and other computers can currently connect securely, but cannot receive tasks.",
      collaborationPreview: "Pair another computer securely, view its presence, and sync safe Project Task and Project Automation summaries. Existing team tasks, team messages, and remote member assignment remain with the lead's team.",
      executionResources: "Current execution resources",
      collaborationAccess: "Human collaboration access",
      participantsEmpty: "This team has no members",
      participantsOpenCatalog: "Open agent catalog",
      participantCurrentTask: "Current task: {value}",
      participantNoTask: "No assigned task",
      inboxTitle: "Coordination activity",
      inboxIntro: "See who sent coordination information to whom, whether it arrived, and when. To protect message content, open the corresponding member conversation to read it.",
      inboxMetaOnly: "Delivery details only",
      inboxEmpty: "No coordination activity needs attention",
      inboxOpenCanvas: "Return to team canvas",
      inboxOpenBoard: "Return to task board",
      emptyBoardTitle: "The task board is ready",
      emptyBoardIntro: "Real tasks will enter these four columns when the first team appears. The workbench structure now stays visible instead of being replaced by the old wizard.",
      emptyBoardHint: "Task state comes from the team runtime. No sample tasks or fake progress are created before a team exists.",
      emptyBoardWaiting: "Waiting for the first team",
      emptyCanvasTitle: "The team canvas is ready",
      emptyCanvasIntro: "When the first team appears, this view shows the lead, members, tasks, assignments, dependencies, blockers, and conflicts.",
      emptyCanvasGoal: "Team goal",
      emptyCanvasGoalBody: "A person states the result to deliver",
      emptyCanvasLead: "Root lead",
      emptyCanvasLeadBody: "Decides whether to form a team and owns delivery",
      emptyCanvasWork: "Members and tasks",
      emptyCanvasWorkBody: "Builds real assignments and dependencies",
      emptyCanvasCoordination: "Coordination workspace",
      emptyCanvasCoordinationBody: "Collects handoffs, blockers, and cross-team delivery",
      emptyCanvasWaiting: "Waiting for the first team to connect the live relationship graph",
      canvasControls: "Canvas view controls",
      canvasViewport: "Zoomable team relationship canvas",
      canvasPanHint: "Drag empty space to pan. Hold Ctrl or Command while scrolling to zoom. Arrow keys scroll the canvas.",
      canvasZoomOut: "Zoom out",
      canvasZoomIn: "Zoom in",
      canvasResetZoom: "Reset zoom to 100%",
      canvasFit: "Fit canvas to viewport",
      canvasFitLabel: "Fit",
      canvasEdgesLimited: "To keep the UI responsive, {shown} relationships are drawn and at least {count} more remain available in task detail.",
      boardProjectionLimited: "Showing {shown} of {total} tasks. Older tasks remain saved and available in history.",
      workspaceUnavailable: "Enable Agent Teams before using this view."
    });
    Object.assign(zh, {
      foundationTitle: "项目基础状态", foundationRefresh: "刷新状态", foundationUnavailableTitle: "尚未使用", foundationUnavailableBody: "系统尚未接管项目工作区与质量门禁。请先完成本机项目配置，再由负责人启动。", foundationInitializingTitle: "正在准备", foundationInitializingBody: "系统正在验证源目录并恢复持久状态。请稍候刷新，不要重复初始化。", foundationReadyTitle: "可以安全落地", foundationReadyBody: "系统已确认工作区、合并队列和质量门禁满足当前落地条件。负责人可继续按现有任务推进。", foundationInvalidTitle: "源目录不可用", foundationInvalidBody: "系统已停止创建工作区，避免写入错误位置。请让负责人从真实 Git 根目录重新打开项目。", foundationDirtyTitle: "源目录需要整理", foundationDirtyBody: "系统检测到未提交或冲突改动并暂停自动推进。请由负责人先核对并整理源目录。", foundationMergeTitle: "等待合并", foundationMergeBody: "系统已保存成员改动并放入合并队列。负责人下一步是核对质量状态并继续合并。", foundationConflictTitle: "合并冲突需要处理", foundationConflictBody: "系统已保留冲突的合并组并阻止落地，没有覆盖任何成员改动。请由负责人解决冲突后重新发布或继续合并。", foundationQualityWaitTitle: "等待可信质量运行器", foundationQualityWaitBody: "系统已保留待检内容，但不会使用未经信任的结果。请由负责人接通可信运行器。", foundationQualityRunTitle: "质量检查进行中", foundationQualityRunBody: "系统已排队或正在运行质量检查。请等待最终结果，不要根据中间状态落地。", foundationDefectTitle: "质量问题待处理", foundationDefectBody: "系统已把失败或本地缺陷记录下来并阻止落地。请由负责人先修复，再重新运行质量门禁。", foundationConnectorTitle: "外部缺陷连接未启用", foundationConnectorBody: "本地缺陷仍会安全保留。需要外部同步时，请由负责人配置可信连接；协作者无需处理凭据。", foundationOutboxTitle: "缺陷同步待发送", foundationOutboxBody: "系统已持久保存待发送记录。请由负责人恢复外部连接，避免重复提交。", foundationCollaboratorTitle: "由主设备负责", foundationCollaboratorBody: "项目工作区、合并和质量门禁由主设备统一管理；此电脑只显示安全状态，不提供操作按钮。", foundationCounts: "工作区 {workspaces} · 资源声明 {claims} · 待合并 {changes} · 质量队列 {queued} · 运行中 {running} · 本地缺陷 {defects}",
      workspaceProjectTasks: "项目任务",
      projectTasksTitle: "项目任务",
      projectTasksIntro: "独立于当前代理团队，按项目长期保存。这里只显示安全的任务摘要。",
      projectTasksLoading: "正在读取项目任务…",
      projectTasksRefresh: "刷新任务",
      projectTasksNoProject: "尚未创建项目。请先到“参与者”中的多人连接设置创建本机项目。",
      projectTasksOpenSettings: "打开项目设置",
      projectTasksCollaboratorUnavailable: "已从主设备安全同步项目任务；当前缓存可继续只读查看。",
      projectTasksSynced: "已从主设备安全同步。这里只显示允许共享的任务摘要。",
      projectTasksWritable: "主设备允许这台电脑提交下方明确列出的安全操作。",
      projectTasksReadOnly: "当前为安全只读。主设备离线、同步重置中或权限已撤销时，请保持本页打开并稍后刷新；已有缓存不会丢失。",
      projectTasksPendingReceipt: "操作已安全保存，正在等待主设备回执。离线时无需重复点击；恢复连接后会自动重试同一请求。",
      projectTasksClaim: "领取任务",
      projectTasksUnavailable: "项目任务当前不可用。请按页面提示检查项目状态后重试。",
      projectTasksCreateTitle: "新建项目任务",
      projectTasksTitleLabel: "任务标题",
      projectTasksTitlePlaceholder: "例如：核对发布验收项",
      projectTasksCreate: "创建任务",
      projectTasksCreating: "正在创建…",
      projectTasksCreateUnavailable: "当前项目任务只可查看，不能在这台电脑创建。",
      projectTasksExplicitOnly: "只执行你明确点击的创建或状态变更；不会自动审批、发送消息或改写冲突。",
      projectTasksEmpty: "暂无项目任务",
      projectTasksHasMore: "仅显示最近 500 项。请先整理现有任务；后续版本将提供分页。",
      projectTasksChangedError: "任务状态已经变化。请刷新后核对最新版本，再明确选择操作。",
      projectTasksIntentConflictError: "这次操作与先前使用同一命令编号的意图不同。系统没有重复执行，请重新明确点击一次。",
      projectTasksPermissionError: "当前设备没有执行此项目任务操作的权限。请在项目所有者所在电脑处理。",
      projectTasksDependencyError: "任务仍有依赖或状态条件未满足。请先处理页面显示的阻塞项。",
      projectTasksProjectError: "项目任务服务当前不可用。请检查项目设置或稍后重试。",
      projectTasksGenericError: "项目任务操作没有完成。请刷新状态后重试。",
      projectTasksRevision: "版本 {value}",
      projectTasksChangeTo: "改为“{value}”",
      projectTasksActionRunning: "正在更新…",
      projectTasksRetryHint: "请刷新后核对最新状态，再重新选择操作。",
      projectTasksSettingsHint: "请先打开项目设置完成本机项目配置。",
      projectTasksNewIntentHint: "请检查任务当前状态，再明确点击一次所需操作。",
      projectTasksGenericHint: "请重试；如果仍失败，请刷新任务状态。",
      projectTaskBacklog: "待整理",
      projectTaskTodo: "待开始",
      projectTaskInProgress: "进行中",
      projectTaskInReview: "待评审",
      projectTaskBlocked: "已阻塞",
      projectTaskDone: "已完成",
      projectTaskCanceled: "已取消",
      projectTaskColumnPlanned: "计划中",
      projectTaskColumnActive: "执行与评审",
      projectTaskColumnBlocked: "已阻塞",
      projectTaskColumnFinished: "已结束",
      projectAutomationSeparate: "项目自动化使用独立项目存储和审计历史；左侧提醒仍只属于当前会话，两者不会互相触发或合并记录。",
      projectAutomationLoading: "正在读取项目自动化…", projectAutomationRefresh: "刷新自动化", projectAutomationNoProject: "尚未创建项目。请先到“参与者”创建本机项目。", projectAutomationCollaborator: "已从主设备安全同步自动化摘要。这里只显示允许共享的数据。", projectAutomationCollaboratorWritable: "主设备已允许审批当前可处理的运行；每次仍以页面给出的按钮为准。", projectAutomationCollaboratorReadOnly: "当前为安全只读。主设备离线、同步重置中或权限已撤销时，请稍后刷新或联系项目所有者。", projectAutomationPendingReceipt: "审批已安全保存，正在等待主设备回执。离线时不要重复点击；恢复连接后会自动重试同一请求。", projectAutomationUnavailable: "项目自动化当前不可用，请按页面提示检查项目状态。",
      projectAutomationCreate: "创建自动化", projectAutomationCreating: "正在创建…", projectAutomationCreateUnavailable: "当前电脑不能创建项目自动化。", projectAutomationName: "自动化名称", projectAutomationTask: "项目任务", projectAutomationTarget: "目标状态", projectAutomationBlockReason: "阻塞原因", projectAutomationChoose: "请选择", projectAutomationEmptyDefinitions: "暂无自动化定义", projectAutomationDefinitions: "自动化定义", projectAutomationRuns: "最近运行", projectAutomationEmptyRuns: "暂无运行", projectAutomationLedger: "最近审计记录", projectAutomationEmptyLedger: "暂无审计记录",
      projectAutomationApprovalBoundary: "批准只会把运行放入队列；按钮请求不会直接执行任务。", projectAutomationActionEnable: "启用", projectAutomationActionDisable: "停用", projectAutomationActionRun: "创建运行", projectAutomationActionApprove: "批准入队", projectAutomationActionReject: "拒绝", projectAutomationActionRetry: "重试", projectAutomationActionCancel: "请求取消", projectAutomationBusy: "正在提交…", projectAutomationRevision: "版本 {value}", projectAutomationStatusEnabled: "已启用", projectAutomationStatusDisabled: "已停用", projectAutomationStatusAwaitingApproval: "等待批准", projectAutomationStatusApproved: "已批准", projectAutomationStatusRejected: "已拒绝", projectAutomationStatusQueued: "已排队", projectAutomationStatusRunning: "运行中", projectAutomationStatusSucceeded: "已成功", projectAutomationStatusFailed: "失败", projectAutomationStatusCancelRequested: "正在请求取消", projectAutomationStatusCanceled: "已取消", projectAutomationLedgerCreated: "已创建运行", projectAutomationLedgerApproval: "已记录审批", projectAutomationLedgerQueued: "已进入队列", projectAutomationLedgerStarted: "已开始运行", projectAutomationLedgerFinished: "运行已结束", projectAutomationLedgerCanceled: "已请求或完成取消", projectAutomationLedgerEvent: "自动化事件", projectAutomationError: "自动化操作没有完成。请刷新权威状态后重试。"
    });
    Object.assign(en, {
      foundationTitle: "Project foundation status", foundationRefresh: "Refresh status", foundationUnavailableTitle: "Not in use", foundationUnavailableBody: "The system is not managing project workspaces or quality gates yet. Finish local project setup, then have the lead start it.", foundationInitializingTitle: "Preparing", foundationInitializingBody: "The system is validating the source and recovering durable state. Wait and refresh instead of initializing again.", foundationReadyTitle: "Ready to land safely", foundationReadyBody: "The system confirms that workspaces, merge state, and quality gates meet the current landing conditions. The lead can continue through the existing tasks.", foundationInvalidTitle: "Source unavailable", foundationInvalidBody: "The system stopped before creating a workspace to avoid writing in the wrong place. Have the lead reopen the project from its real Git root.", foundationDirtyTitle: "Source needs attention", foundationDirtyBody: "The system found uncommitted or conflicting source changes and paused automatic progress. The lead should review and clean up the source first.", foundationMergeTitle: "Waiting to merge", foundationMergeBody: "Member changes are stored durably and queued for merge. The lead should review quality status and continue the merge.", foundationConflictTitle: "Merge conflicts need attention", foundationConflictBody: "The conflicted merge group is preserved and landing is blocked without overwriting member work. The lead should resolve the conflicts, then republish or continue the merge.", foundationQualityWaitTitle: "Waiting for a trusted quality runner", foundationQualityWaitBody: "Pending work is preserved, but untrusted results are never accepted. The lead must connect a trusted runner.", foundationQualityRunTitle: "Quality checks in progress", foundationQualityRunBody: "Quality checks are queued or running. Wait for the final result instead of landing from an intermediate state.", foundationDefectTitle: "Quality issues need work", foundationDefectBody: "Failures or local defects are recorded and landing is blocked. The lead should fix them and run the quality gate again.", foundationConnectorTitle: "External defect connection is off", foundationConnectorBody: "Local defects remain safely stored. The lead can configure a trusted connection if external sync is needed; collaborators never handle credentials.", foundationOutboxTitle: "Defect sync is pending", foundationOutboxBody: "Pending records are stored durably. The lead should restore the external connection instead of submitting them again.", foundationCollaboratorTitle: "Managed by the primary desktop", foundationCollaboratorBody: "The primary desktop manages project workspaces, merges, and quality gates. This computer shows safe status only and has no action buttons.", foundationCounts: "Workspaces {workspaces} · Claims {claims} · Pending merges {changes} · Quality queue {queued} · Running {running} · Local defects {defects}",
      workspaceProjectTasks: "Project tasks",
      projectTasksTitle: "Project tasks",
      projectTasksIntro: "Stored with the project independently of the current Agent Team. Only safe task summaries are shown here.",
      projectTasksLoading: "Loading project tasks…",
      projectTasksRefresh: "Refresh tasks",
      projectTasksNoProject: "No project exists yet. Open the connection settings under Participants to create a local project first.",
      projectTasksOpenSettings: "Open project settings",
      projectTasksCollaboratorUnavailable: "Project tasks were synced securely from the primary desktop. The current cache remains available to read.",
      projectTasksSynced: "Securely synced from the primary desktop. Only task summaries approved for sharing are shown.",
      projectTasksWritable: "The primary desktop allows this computer to submit only the safe actions listed below.",
      projectTasksReadOnly: "This view is safely read only. If the primary desktop is offline, sync is resetting, or access was revoked, keep this page open and refresh later; the existing cache is retained.",
      projectTasksPendingReceipt: "The action is stored safely and is awaiting a receipt from the primary desktop. Do not click again while offline; the identical request retries automatically after reconnecting.",
      projectTasksClaim: "Claim task",
      projectTasksUnavailable: "Project tasks are unavailable. Check the project guidance on this page, then try again.",
      projectTasksCreateTitle: "New project task",
      projectTasksTitleLabel: "Task title",
      projectTasksTitlePlaceholder: "For example: verify release acceptance",
      projectTasksCreate: "Create task",
      projectTasksCreating: "Creating…",
      projectTasksCreateUnavailable: "Project tasks are read only on this desktop, so a task cannot be created here.",
      projectTasksExplicitOnly: "Only the create or status change you explicitly select is run. Nothing is auto-approved, messaged, or rewritten after a conflict.",
      projectTasksEmpty: "No project tasks",
      projectTasksHasMore: "Only the latest 500 tasks are shown. Organize existing tasks first; pagination will be added later.",
      projectTasksChangedError: "The task state changed. Refresh and review the latest revision before explicitly choosing an action.",
      projectTasksIntentConflictError: "This action differs from the earlier intent that used the same command identifier. Nothing was run twice; explicitly select the action again.",
      projectTasksPermissionError: "This desktop is not allowed to perform that project task action. Use the project owner's desktop.",
      projectTasksDependencyError: "A dependency or task-state requirement is not satisfied. Resolve the blockers shown here first.",
      projectTasksProjectError: "The project task service is unavailable. Check project settings or try again later.",
      projectTasksGenericError: "The project task action did not finish. Refresh task state, then try again.",
      projectTasksRevision: "Revision {value}",
      projectTasksChangeTo: "Change to “{value}”",
      projectTasksActionRunning: "Updating…",
      projectTasksRetryHint: "Refresh and review the latest state before choosing the action again.",
      projectTasksSettingsHint: "Open project settings and finish local project setup first.",
      projectTasksNewIntentHint: "Review the task's current state, then explicitly select the action again.",
      projectTasksGenericHint: "Try again. If it still fails, refresh task state.",
      projectTaskBacklog: "Backlog",
      projectTaskTodo: "To do",
      projectTaskInProgress: "In progress",
      projectTaskInReview: "In review",
      projectTaskBlocked: "Blocked",
      projectTaskDone: "Done",
      projectTaskCanceled: "Canceled",
      projectTaskColumnPlanned: "Planned",
      projectTaskColumnActive: "Active and review",
      projectTaskColumnBlocked: "Blocked",
      projectTaskColumnFinished: "Finished",
      projectAutomationSeparate: "Project automation uses separate project storage and audit history. Session reminders on the left stay session-only; neither side triggers or merges records with the other.",
      projectAutomationLoading: "Loading project automation…", projectAutomationRefresh: "Refresh automation", projectAutomationNoProject: "No project exists yet. Create a local project under Participants first.", projectAutomationCollaborator: "Automation summaries were synced securely from the primary desktop. Only approved shared data is shown.", projectAutomationCollaboratorWritable: "The primary desktop allows approval of currently eligible runs; the buttons shown for each run remain the final gate.", projectAutomationCollaboratorReadOnly: "This view is safely read only. If the primary desktop is offline, sync is resetting, or access was revoked, refresh later or contact the project owner.", projectAutomationPendingReceipt: "The approval is stored safely and is awaiting a receipt from the primary desktop. Do not click again while offline; the identical request retries automatically after reconnecting.", projectAutomationUnavailable: "Project automation is unavailable. Follow the project guidance shown here.",
      projectAutomationCreate: "Create automation", projectAutomationCreating: "Creating…", projectAutomationCreateUnavailable: "This desktop cannot create project automation.", projectAutomationName: "Automation name", projectAutomationTask: "Project task", projectAutomationTarget: "Target status", projectAutomationBlockReason: "Block reason", projectAutomationChoose: "Choose", projectAutomationEmptyDefinitions: "No automation definitions", projectAutomationDefinitions: "Automation definitions", projectAutomationRuns: "Recent runs", projectAutomationEmptyRuns: "No runs", projectAutomationLedger: "Recent audit history", projectAutomationEmptyLedger: "No audit records",
      projectAutomationApprovalBoundary: "Approval only queues the run; the button request does not execute the task directly.", projectAutomationActionEnable: "Enable", projectAutomationActionDisable: "Disable", projectAutomationActionRun: "Create run", projectAutomationActionApprove: "Approve and queue", projectAutomationActionReject: "Reject", projectAutomationActionRetry: "Retry", projectAutomationActionCancel: "Request cancellation", projectAutomationBusy: "Submitting…", projectAutomationRevision: "Revision {value}", projectAutomationStatusEnabled: "Enabled", projectAutomationStatusDisabled: "Disabled", projectAutomationStatusAwaitingApproval: "Awaiting approval", projectAutomationStatusApproved: "Approved", projectAutomationStatusRejected: "Rejected", projectAutomationStatusQueued: "Queued", projectAutomationStatusRunning: "Running", projectAutomationStatusSucceeded: "Succeeded", projectAutomationStatusFailed: "Failed", projectAutomationStatusCancelRequested: "Cancellation requested", projectAutomationStatusCanceled: "Canceled", projectAutomationLedgerCreated: "Run created", projectAutomationLedgerApproval: "Approval recorded", projectAutomationLedgerQueued: "Queued", projectAutomationLedgerStarted: "Run started", projectAutomationLedgerFinished: "Run finished", projectAutomationLedgerCanceled: "Cancellation requested or completed", projectAutomationLedgerEvent: "Automation event", projectAutomationError: "The automation action did not finish. Refresh authoritative state, then try again."
    });
    Object.assign(zh, {
      taskOverview: "任务信息",
      taskWorkflowHint: "展示执行成员的当前计划、模型步骤与工具状态；只显示安全摘要，不展示工具参数、结果正文或文件路径。",
      taskLiveEvents: "协作动态",
      taskLiveEventsHint: "这里只显示与该任务相关的成员投递记录；具体执行步骤请看上方实时工作流。",
      taskBrief: "任务简介",
      taskDescription: "详细任务",
      taskDescriptionMissing: "未填写详细任务说明。",
      taskClaimant: "领取人",
      taskResponsible: "责任人",
      taskClaimedAt: "领取时间",
      taskCompletionProgress: "Host 里程碑",
      taskModelUsed: "使用的模型",
      taskNotClaimed: "尚未领取",
      taskNotCompleted: "尚未完成",
      taskModelUndetermined: "尚未确定",
      taskModelConfigured: "配置：{value}",
      taskProgressPlan: "已记录 {completed}/{total} 个里程碑",
      taskProgressComplete: "任务状态已由 Host 标记完成",
      taskProgressPending: "任务尚未开始",
      taskProgressWorking: "任务正在进行；暂无 Host 里程碑计数",
      taskWorkflowPlan: "当前执行计划",
      taskWorkflowPlanEmpty: "执行成员尚未记录细分计划；任务状态仍会实时更新。",
      taskWorkflowTimeline: "实时执行记录",
      taskWorkflowTimelineHint: "最新记录在前；工具只展示名称和执行状态。",
      taskWorkflowEmpty: "任务被领取后，模型步骤和工具状态会实时显示在这里。",
      taskWorkflowLoading: "正在读取详细任务与执行记录…",
      taskWorkflowUnavailable: "暂时无法读取详细执行记录，基础任务状态仍会保持更新。",
      taskWorkflowAmbiguous: "执行成员同时处理多个任务，当前无法可靠区分本任务的具体步骤，因此不做猜测。",
      taskWorkflowSharedLead: "负责人会话同时承担团队协调，无法可靠拆分为单个任务步骤，因此这里只显示任务状态。",
      taskWorkflowSessionUnavailable: "该成员当前没有可读取的会话执行记录；任务状态和时间仍来自持久记录。",
      taskWorkflowLimited: "仅显示最新 {count} 条；较早记录已省略。",
      taskWorkflowTurnStart: "开始第 {turn} 轮工作",
      taskWorkflowStep: "执行步骤 {step}",
      taskWorkflowPlanUpdated: "更新执行计划",
      taskWorkflowModelUpdate: "整理阶段结果",
      taskWorkflowRetry: "模型请求正在重试",
      taskWorkflowTool: "{tool}",
      taskRunRunning: "执行中",
      taskRunCompleted: "已完成",
      taskRunFailed: "失败",
      taskRunStopped: "已停止",
      taskRunBlocked: "受阻",
      taskRunContinued: "继续处理",
      taskRunUnknown: "状态未知",
      taskPlanCounts: "{completed}/{total} 项已完成 · {active} 项进行中",
      responsibilityTitle: "责任与验收",
      responsibilityHint: "仅呈现 Host 持久投影；原分配成员不会被推断为实际交付者。",
      assignedMember: "原分配成员",
      actualExecutor: "实际交付者",
      actualExecutorUnknown: "Host 未记录实际交付者",
      actualExecutorLegacy: "旧记录未证明实际交付者",
      deliveryState: "交付",
      deliverySubmitted: "已提交可验收交付",
      deliveryMissing: "尚无 task-scoped 交付",
      deliveryMissingCompleted: "异常：任务已完成但没有可核对交付",
      deliveryLegacy: "旧完成记录：由迁移合成，不是当前交付证明",
      acceptanceState: "验收",
      acceptanceAccepted: "负责人已验收",
      acceptancePending: "等待负责人验收",
      acceptanceMissingCompleted: "异常：完成记录没有验收事实",
      acceptanceNotApplicable: "尚未进入验收",
      acceptanceLegacy: "旧验收占位：未经当前负责人审查证明",
      acceptedBy: "验收人",
      submissionSource: "交付来源：{value}",
      submissionExplicit: "执行者显式完成",
      submissionLeadTakeover: "负责人接管",
      submissionForced: "强制收敛",
      submissionUnknown: "Host 记录来源未知",
      submissionLegacy: "旧存储迁移合成",
      legacyRecordTitle: "旧迁移记录（未经当前证明）",
      legacyRecordHint: "这些字段仅保留历史兼容性；原分配成员不是已证明的实际交付者，合成验收也不是当前负责人审查证据。",
      legacyResult: "旧结果文本（未经当前证明）",
      legacyResultPreview: "旧结果文本（未经当前证明）",
      taskCancelled: "任务已取消；这不是成功完成",
      responsibilityFacts: "责任事实",
      taskReleased: "任务曾被释放；这是已记录的责任变更",
      releaseReasonLabel: "释放原因",
      releasedAtLabel: "释放时间",
      taskCancellation: "取消记录",
      cancellationReasonLabel: "取消原因",
      cancelledAtLabel: "取消时间",
      reasonUnavailable: "Host 未记录具体原因",
      closureOutcome: "关闭结果",
      closureSucceeded: "目标成功交付",
      closureCancelled: "已取消关闭",
      closureForced: "强制关闭",
      closureFailed: "关闭失败",
      closureUnknown: "关闭结果未知",
      closureSucceededBody: "Host 已记录成功关闭与完成的交付链。",
      closureCancelledBody: "团队已关闭，但结果是取消，不等同于成功。",
      closureForcedBody: "团队被强制关闭；未完成工作不得视为成功。",
      closureFailedBody: "关闭流程发生失败；请核对保留的任务与失败记录。",
      closureUnknownBody: "团队状态为已关闭，但 Host 没有可核对的关闭 outcome；不会推断为成功。",
      closureEmptyBody: "团队没有任何任务交付，成功 receipt 不会在此显示为目标交付成功。",
      closureCancelledCount: "取消任务 {count} 项",
      closureFailureCount: "关闭失败记录 {count} 项"
    });
    Object.assign(en, {
      taskOverview: "Task information",
      taskWorkflowHint: "Shows the member's current plan, model steps, and tool status. Only safe summaries are shown—never tool arguments, result bodies, or file paths.",
      taskLiveEvents: "Coordination activity",
      taskLiveEventsHint: "Only member deliveries related to this task appear here. See the live workflow above for execution steps.",
      taskBrief: "Task brief",
      taskDescription: "Detailed task",
      taskDescriptionMissing: "No detailed task description was provided.",
      taskClaimant: "Claimed by",
      taskResponsible: "Responsible lead",
      taskClaimedAt: "Claimed at",
      taskCompletionProgress: "Host milestones",
      taskModelUsed: "Model used",
      taskNotClaimed: "Not claimed",
      taskNotCompleted: "Not completed",
      taskModelUndetermined: "Not determined",
      taskModelConfigured: "Configured: {value}",
      taskProgressPlan: "{completed}/{total} milestones recorded",
      taskProgressComplete: "Task state is marked completed by the Host",
      taskProgressPending: "Task has not started",
      taskProgressWorking: "Task is running; no Host milestone count is available",
      taskWorkflowPlan: "Current execution plan",
      taskWorkflowPlanEmpty: "The member has not recorded a detailed plan yet. Task status will still update live.",
      taskWorkflowTimeline: "Live execution log",
      taskWorkflowTimelineHint: "Newest first. Tools show only their name and execution status.",
      taskWorkflowEmpty: "Model steps and tool status will appear here after the task is claimed.",
      taskWorkflowLoading: "Loading detailed task and execution records…",
      taskWorkflowUnavailable: "Detailed execution records are temporarily unavailable; base task status will keep updating.",
      taskWorkflowAmbiguous: "The member is handling multiple tasks, so steps cannot be attributed to this task reliably and are not guessed.",
      taskWorkflowSharedLead: "The lead session also coordinates the team, so it cannot be split reliably into one task's steps. Only task status is shown.",
      taskWorkflowSessionUnavailable: "No readable execution session is currently available for this member. Task status and timestamps still come from durable records.",
      taskWorkflowLimited: "Showing only the latest {count} records; earlier records are omitted.",
      taskWorkflowTurnStart: "Started work turn {turn}",
      taskWorkflowStep: "Execution step {step}",
      taskWorkflowPlanUpdated: "Updated execution plan",
      taskWorkflowModelUpdate: "Prepared a step result",
      taskWorkflowRetry: "Retrying the model request",
      taskWorkflowTool: "{tool}",
      taskRunRunning: "Running",
      taskRunCompleted: "Completed",
      taskRunFailed: "Failed",
      taskRunStopped: "Stopped",
      taskRunBlocked: "Blocked",
      taskRunContinued: "Continuing",
      taskRunUnknown: "Unknown status",
      taskPlanCounts: "{completed}/{total} completed · {active} in progress",
      responsibilityTitle: "Responsibility and acceptance",
      responsibilityHint: "Shows only durable Host projections. The original assignee is never inferred to be the actual deliverer.",
      assignedMember: "Original assignee",
      actualExecutor: "Actual deliverer",
      actualExecutorUnknown: "No actual deliverer recorded by the Host",
      actualExecutorLegacy: "Legacy record does not prove an actual deliverer",
      deliveryState: "Delivery",
      deliverySubmitted: "Reviewable delivery submitted",
      deliveryMissing: "No task-scoped delivery yet",
      deliveryMissingCompleted: "Exception: task completed without a reviewable delivery",
      deliveryLegacy: "Legacy completion record synthesized by migration, not current delivery proof",
      acceptanceState: "Acceptance",
      acceptanceAccepted: "Accepted by the lead",
      acceptancePending: "Awaiting lead acceptance",
      acceptanceMissingCompleted: "Exception: completion has no acceptance fact",
      acceptanceNotApplicable: "Not ready for acceptance",
      acceptanceLegacy: "Legacy acceptance placeholder, not proven current lead review",
      acceptedBy: "Accepted by",
      submissionSource: "Delivery source: {value}",
      submissionExplicit: "Explicit executor completion",
      submissionLeadTakeover: "Lead takeover",
      submissionForced: "Forced reconciliation",
      submissionUnknown: "Unknown Host-recorded source",
      submissionLegacy: "Synthesized during legacy storage migration",
      legacyRecordTitle: "Legacy migrated record (not currently proven)",
      legacyRecordHint: "These fields preserve history only. The original assignee is not a proven actual deliverer, and synthesized acceptance is not evidence of current lead review.",
      legacyResult: "Legacy result text (not currently proven)",
      legacyResultPreview: "Legacy result text (not currently proven)",
      taskCancelled: "Task cancelled; this is not successful completion",
      responsibilityFacts: "Responsibility facts",
      taskReleased: "Task was released; this is a recorded responsibility change",
      releaseReasonLabel: "Release reason",
      releasedAtLabel: "Released at",
      taskCancellation: "Cancellation record",
      cancellationReasonLabel: "Cancellation reason",
      cancelledAtLabel: "Cancelled at",
      reasonUnavailable: "No specific reason recorded by the Host",
      closureOutcome: "Closure outcome",
      closureSucceeded: "Objective delivered successfully",
      closureCancelled: "Closed as cancelled",
      closureForced: "Force closed",
      closureFailed: "Closure failed",
      closureUnknown: "Closure outcome unknown",
      closureSucceededBody: "The Host recorded a successful close with a completed delivery chain.",
      closureCancelledBody: "The team is closed, but its outcome is cancellation—not success.",
      closureForcedBody: "The team was force closed. Unfinished work must not be treated as success.",
      closureFailedBody: "The closure flow failed. Review the preserved tasks and failure records.",
      closureUnknownBody: "The team is marked closed, but no reviewable closure outcome is present. Success is not inferred.",
      closureEmptyBody: "The team has no task delivery, so a success receipt is not presented as successful objective delivery here.",
      closureCancelledCount: "{count} cancelled tasks",
      closureFailureCount: "{count} closure failures"
    });
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
        ".dat-btn{box-sizing:border-box;font:inherit;border:1px solid var(--dsw-alias-border-l3);border-radius:8px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);padding:7px 11px;cursor:pointer;line-height:1.25}.dat-btn:hover{background:var(--dsw-alias-interactive-bg-hover)}.dat-btn:focus,.dat-btn:focus-visible{outline:3px solid #2f7cf6;outline-offset:2px;box-shadow:0 0 0 4px rgba(47,124,246,.28)}.dat-field:focus-visible,.dat-template:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#2f7cf6);outline-offset:2px}.dat-btn:disabled{opacity:.5;cursor:not-allowed}.dat-primary{background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground);border-color:transparent}.dat-danger{color:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-state-error-secondary)}.dat-small{padding:4px 8px;font-size:12px}",
        ".dat-error{border:1px solid var(--dsw-alias-state-error-secondary);border-radius:10px;padding:10px 12px;color:var(--dsw-alias-state-error-primary);font-size:13px;margin-bottom:12px}.dat-note{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:1.5}.dat-section-title{font-size:13px;margin:0 0 9px}.dat-field{box-sizing:border-box;width:100%;border:1px solid var(--dsw-alias-border-l3);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);padding:9px 10px;font:inherit;font-size:13px}.dat-label{display:block;margin:13px 0 6px;color:var(--dsw-alias-label-secondary);font-size:12px}",
        ".dat-templates{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:9px}.dat-template{display:block;width:100%;text-align:left;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;padding:12px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);cursor:pointer}.dat-template[aria-pressed=true]{border-color:var(--dsw-alias-brand-primary);box-shadow:inset 0 0 0 1px var(--dsw-alias-brand-primary)}.dat-template strong{display:block;font-size:13px;margin-bottom:4px}.dat-template span{display:block;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.45}",
        ".dat-column-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px}.dat-column-head h2{font-size:14px;margin:0}.dat-stack{display:grid;gap:8px}.dat-card-title{font-size:13px;font-weight:650;overflow-wrap:anywhere}.dat-meta{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.45;overflow-wrap:anywhere}.dat-task-status{margin-top:7px}.dat-event{border-left:2px solid var(--dsw-alias-brand-primary);padding-left:9px}.dat-event time{display:block;color:var(--dsw-alias-label-tertiary);font-size:11px;margin-top:3px}",
        ".dat-actions{display:flex;align-items:center;gap:7px;flex-wrap:wrap;margin:12px 0}.dat-actions-panel{margin:0 0 12px;padding:10px 12px}.dat-closed{border-color:var(--dsw-alias-border-l3);background:var(--dsw-alias-bg-layer-2);margin-bottom:12px}.dat-sr{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}.dat-warn-text{color:var(--dsw-alias-state-warn-primary)}",
        ".dat-overview{margin:0 0 12px}.dat-team-strip{display:flex;align-items:center;gap:7px;overflow:auto;padding:2px 0 4px}.dat-team-list{display:grid;gap:7px;max-height:280px;overflow:auto;list-style:none;margin:8px 0 0;padding:0}.dat-team-choice{min-width:max-content;text-align:left;border:1px solid var(--dsw-alias-border-l2);border-radius:999px;padding:6px 10px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);cursor:pointer}.dat-team-choice[aria-current=true]{border-color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-interactive-bg-hover)}.dat-team-choice:focus-visible,.dat-disclosure>summary:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}.dat-disclosure{border-top:1px solid var(--dsw-alias-border-l2);margin-top:10px;padding-top:8px}.dat-disclosure>summary{cursor:pointer;color:var(--dsw-alias-label-secondary);font-size:12px}.dat-disclosure[open]>summary{margin-bottom:8px}",
        ".dat-active-shell{min-width:0}.dat-active-shell.dat-inspector-open{display:grid;grid-template-columns:minmax(0,1fr) minmax(300px,360px);gap:12px;align-items:start}.dat-work-main{min-width:0}.dat-command-bar{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:12px}.dat-command-title{min-width:0;flex:1 1 320px}.dat-command-title .dat-title{font-size:18px}.dat-work-panel{padding:0;overflow:hidden}.dat-work-panel>.dat-column-head{padding:13px 14px 4px}.dat-work-list{display:grid;gap:0}.dat-task-row{border:0;border-top:1px solid var(--dsw-alias-border-l2);border-radius:0;background:transparent;padding:12px 14px}.dat-task-row:hover{background:var(--dsw-alias-interactive-bg-hover)}.dat-task-row:first-child{border-top:0}.dat-work-empty{padding:24px 14px;text-align:center}.dat-history{margin-top:12px}.dat-history-head{display:flex;align-items:center;justify-content:space-between;gap:8px}.dat-history-list{max-height:min(56vh,620px);overflow:auto;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;margin-top:8px}.dat-history-note{margin:6px 0 0}",
        ".dat-inspector{position:sticky;top:0;max-height:calc(100vh - 150px);overflow:hidden;padding:0;box-shadow:0 12px 30px rgba(0,0,0,.08)}.dat-inspector-head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:12px;border-bottom:1px solid var(--dsw-alias-border-l2)}.dat-inspector-tabs{display:flex;gap:6px}.dat-inspector-body{max-height:calc(100vh - 215px);overflow:auto;padding:10px}.dat-inspector-body .dat-card{background:transparent}.dat-scrim{display:none}.dat-settings-disclosure{margin-top:14px}.dat-settings-disclosure>.dat-panel{margin-top:8px}",
        ".dat-view-toggle{display:inline-flex;gap:3px;padding:3px;border:1px solid var(--dsw-alias-border-l2);border-radius:9px;background:var(--dsw-alias-bg-layer-1)}.dat-view-toggle .dat-btn{border:0}.dat-canvas-panel{padding:12px;overflow:hidden}.dat-canvas-scroll{position:relative;display:block;max-width:100%;overflow:auto;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-1);isolation:isolate}.dat-canvas{position:relative;display:grid;grid-template-rows:82px 104px 82px;align-content:start;box-sizing:border-box;min-height:326px;padding:24px 20px 34px;isolation:isolate}.dat-canvas-lines{position:absolute;z-index:0;inset:0;width:100%;height:100%;pointer-events:none}.dat-canvas-row{position:relative;z-index:1;display:grid;grid-auto-flow:column;grid-auto-columns:152px;column-gap:28px;align-items:start;justify-content:start;min-width:0}.dat-canvas-line{stroke:var(--dsw-alias-brand-primary);stroke-width:2;opacity:.58;vector-effect:non-scaling-stroke}.dat-canvas-line-depends{stroke:var(--dsw-alias-label-tertiary)}.dat-canvas-line-blocked{stroke:var(--dsw-alias-state-warn-primary);stroke-dasharray:7 5}.dat-canvas-line-conflict{stroke:var(--dsw-alias-state-error-primary);stroke-dasharray:7 5}.dat-canvas-line-flow{stroke-dasharray:6 7;opacity:.85;animation:dat-canvas-flow 1.1s linear infinite}.dat-canvas-node{position:relative;display:block;box-sizing:border-box;width:152px;height:82px;min-width:0;margin:0;padding:9px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-2);box-shadow:0 4px 12px rgba(0,0,0,.06);overflow:hidden;overflow-wrap:anywhere;contain:content;transition:border-color .16s ease,transform .16s ease}.dat-canvas-member{cursor:pointer;text-align:left;color:inherit;font:inherit}.dat-canvas-member:hover{border-color:var(--dsw-alias-brand-primary);transform:translateY(-1px)}.dat-canvas-task{border-top:3px solid var(--dsw-alias-border-l3)}.dat-canvas-task[data-state=in_progress]{border-top-color:var(--dsw-alias-brand-primary)}.dat-canvas-task[data-state=blocked]{border-top-color:var(--dsw-alias-state-warn-primary);box-shadow:inset 0 0 0 1px var(--dsw-alias-state-warn-primary)}.dat-canvas-completed{border-top-color:var(--dsw-alias-state-success-primary)}.dat-canvas-task[data-state=completed]{border-top-color:var(--dsw-alias-state-success-primary)}.dat-canvas-node[data-state=retired]{opacity:.55}.dat-canvas-head{display:flex;align-items:center;gap:6px;min-width:0}.dat-canvas-head .dat-card-title{flex:1 1 auto;min-width:0}.dat-canvas-dot{position:relative;width:8px;height:8px;border-radius:50%;flex:none;background:var(--dsw-alias-label-tertiary)}.dat-canvas-node[data-state=running] .dat-canvas-dot,.dat-canvas-node[data-state=provisioning] .dat-canvas-dot{background:var(--dsw-alias-brand-primary)}.dat-canvas-node[data-state=ready] .dat-canvas-dot{background:var(--dsw-alias-state-success-primary)}.dat-canvas-node[data-state=failed] .dat-canvas-dot{background:var(--dsw-alias-state-error-primary)}.dat-canvas-node[data-state=shutting_down] .dat-canvas-dot,.dat-canvas-node[data-state=closing] .dat-canvas-dot{background:var(--dsw-alias-state-warn-primary)}.dat-canvas-node[data-state=running] .dat-canvas-dot::after{position:absolute;inset:-4px;border-radius:50%;border:1px solid var(--dsw-alias-brand-primary);content:\"\";opacity:.7;animation:dat-canvas-pulse 1.8s ease-out infinite}.dat-canvas-status{display:flex;align-items:center;gap:5px;margin-top:5px;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.4;min-width:0}.dat-canvas-node[data-state=running] .dat-canvas-status,.dat-canvas-node[data-state=provisioning] .dat-canvas-status{color:var(--dsw-alias-brand-primary)}.dat-canvas-node[data-state=blocked] .dat-canvas-status{color:var(--dsw-alias-state-warn-primary)}.dat-canvas-node[data-state=failed] .dat-canvas-status{color:var(--dsw-alias-state-error-primary)}.dat-canvas-node[data-state=completed] .dat-canvas-status{color:var(--dsw-alias-state-success-primary)}.dat-canvas-time{margin-top:2px}.dat-canvas-live{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:9px 0 0;padding:7px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-2);font-size:12px}.dat-canvas-live-paused{border-color:var(--dsw-alias-state-warn-primary);color:var(--dsw-alias-state-warn-primary)}.dat-canvas-legend{display:flex;gap:10px;flex-wrap:wrap;margin:9px 0 0;padding:0;list-style:none}.dat-canvas-key{display:inline-flex;align-items:center;gap:5px}.dat-canvas-swatch{width:20px;height:10px;flex:none;overflow:visible}.dat-canvas-swatch .dat-canvas-line{opacity:.95}@keyframes dat-canvas-flow{to{stroke-dashoffset:-13}}@keyframes dat-canvas-pulse{0%{transform:scale(.6);opacity:.8}70%{transform:scale(1.25);opacity:0}100%{transform:scale(1.25);opacity:0}}",
        ".dat-board-card-flag{flex:none;white-space:nowrap}.dat-canvas-header-actions{display:flex;align-items:center;justify-content:flex-end;gap:8px;flex-wrap:wrap}.dat-canvas-toolbar{display:inline-flex;align-items:center;gap:3px;padding:3px;border:1px solid var(--dsw-alias-border-l2);border-radius:9px;background:var(--dsw-alias-bg-layer-2)}.dat-canvas-toolbar .dat-btn{min-width:32px;border:0;padding:5px 8px}.dat-canvas-zoom-readout{min-width:50px;border:0;border-radius:7px;padding:5px 7px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;cursor:pointer}.dat-canvas-zoom-readout:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}.dat-canvas-zoom-readout:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}.dat-canvas-scroll{position:relative;display:block;box-sizing:border-box;width:100%;height:clamp(420px,56vh,640px);min-height:360px;max-width:100%;overflow:auto;overscroll-behavior:contain;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background-color:var(--dsw-alias-bg-layer-1);background-image:radial-gradient(circle,var(--dsw-alias-border-l2) 1px,transparent 1px);background-size:18px 18px;isolation:isolate;scrollbar-gutter:stable;touch-action:pan-x pan-y;cursor:grab}.dat-canvas-scroll[data-dragging=true]{cursor:grabbing;user-select:none}.dat-canvas-scroll:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}.dat-canvas-stage{position:relative;box-sizing:border-box;min-width:100%;min-height:100%}.dat-canvas{position:absolute;display:block;box-sizing:border-box;min-height:0;padding:0;isolation:isolate;transform-origin:0 0;contain:layout paint style}.dat-canvas .dat-canvas-row{position:absolute;z-index:1;display:grid;grid-auto-flow:row;grid-auto-columns:auto;column-gap:28px;row-gap:28px;align-items:start;justify-content:start}.dat-canvas .dat-canvas-node{position:absolute;margin:0;contain:layout paint style}.dat-canvas .dat-canvas-row .dat-canvas-node{position:relative}.dat-canvas-limit-note{margin:8px 0 0;padding:7px 9px;border-radius:8px;background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 7%,var(--dsw-alias-bg-layer-1));color:var(--dsw-alias-label-secondary);font-size:11px;line-height:1.45}.dat-work-list>.dat-task-row{content-visibility:auto;contain-intrinsic-size:auto 116px}",
        ".dat-canvas .dat-canvas-node{height:92px}.dat-canvas-node .dat-card-title{font-size:14px;line-height:1.35;font-weight:700;color:var(--dsw-alias-label-primary)}.dat-canvas-node .dat-canvas-status{font-size:12px;line-height:1.4;font-weight:600}.dat-canvas-node .dat-canvas-time,.dat-canvas-node .dat-canvas-model{font-size:12px;line-height:1.35;color:var(--dsw-alias-label-secondary)}",
        "@media(prefers-reduced-motion:reduce){.dat-canvas-node{transition:none}.dat-canvas-member:hover{transform:none}.dat-canvas-line-flow,.dat-canvas-node[data-state=running] .dat-canvas-dot::after{animation:none}}@media(max-width:900px){.dat-templates{grid-template-columns:1fr}.dat-active-shell.dat-inspector-open{display:block}.dat-scrim{display:block;position:fixed;inset:0;z-index:39;border:0;background:rgba(0,0,0,.28)}.dat-inspector{position:fixed;z-index:40;top:0;right:0;bottom:0;width:min(390px,92vw);max-height:none;border-radius:12px 0 0 12px}.dat-inspector-body{max-height:calc(100vh - 60px)}.dat-canvas-scroll{max-width:100%}}@media(max-width:620px){.dat-view{padding:12px 10px 22px}.dat-head{display:block}.dat-head>.dat-row{margin-top:9px}.dat-panel{padding:12px}.dat-work-panel{padding:0}.dat-command-bar{align-items:flex-start}.dat-command-bar>.dat-row{width:100%}.dat-inspector{width:100%;border-radius:0}.dat-task-row{padding:11px 12px}.dat-canvas-panel{padding:9px}.dat-canvas-hint{display:none}.dat-canvas-scroll{height:clamp(360px,62vh,540px);min-height:320px}.dat-canvas-legend{font-size:11px}.dat-canvas-header-actions{justify-content:flex-start}.dat-canvas-toolbar{width:100%}.dat-canvas-toolbar .dat-btn,.dat-canvas-zoom-readout{flex:1 1 auto}}",
        ".dat-project-entry{margin:0 0 14px;overflow:hidden}.dat-project-entry-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.dat-project-entry-head h2{margin:0;font-size:16px}.dat-project-entry-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:9px;margin-top:12px}.dat-project-route{padding:11px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-2);min-width:0}.dat-project-route strong{display:block;font-size:13px;margin-bottom:4px}.dat-project-form{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:10px;margin-top:12px}.dat-project-form .dat-label{margin-top:0}.dat-project-span{grid-column:1/-1}.dat-project-code{display:block;box-sizing:border-box;width:100%;min-height:72px;resize:vertical;margin-top:7px;border:1px solid var(--dsw-alias-border-l3);border-radius:8px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);padding:9px;font:12px/1.45 ui-monospace,SFMono-Regular,Consolas,monospace;overflow-wrap:anywhere}.dat-project-ref{font:12px/1.45 ui-monospace,SFMono-Regular,Consolas,monospace;overflow-wrap:anywhere}.dat-project-entry details{margin-top:12px;border-top:1px solid var(--dsw-alias-border-l2);padding-top:10px}.dat-project-entry summary{cursor:pointer;font-size:13px;font-weight:650}.dat-project-status{display:flex;align-items:center;gap:7px;flex-wrap:wrap;margin-top:8px}.dat-project-entry .dat-error{margin-top:10px;margin-bottom:0}@media(max-width:760px){.dat-project-entry-grid,.dat-project-form{grid-template-columns:1fr}.dat-project-span{grid-column:auto}}",
        ".dat-task-open{display:block;width:100%;text-align:left;font:inherit;color:inherit;cursor:pointer}.dat-task-open:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}.dat-canvas-task-open{cursor:pointer;text-align:left;color:inherit;font:inherit}.dat-canvas-task-open:hover{border-color:var(--dsw-alias-brand-primary);transform:translateY(-1px)}.dat-canvas-task-open:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}.dat-canvas-model{margin-top:2px;font-size:11px;line-height:1.3;color:var(--dsw-alias-label-tertiary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.dat-task-hero{display:flex;align-items:flex-start;justify-content:space-between;gap:8px}.dat-task-hero .dat-badge{flex:none}.dat-task-facts{display:grid;gap:7px;margin:10px 0 0}.dat-task-fact{display:grid;grid-template-columns:92px minmax(0,1fr);gap:8px;align-items:baseline}.dat-task-fact dt{color:var(--dsw-alias-label-tertiary);font-size:12px}.dat-task-fact dd{margin:0;min-width:0;font-size:12px;line-height:1.45;overflow-wrap:anywhere}.dat-task-section{margin:12px 0 0}.dat-task-section>h3{font-size:12px;margin:0 0 6px;color:var(--dsw-alias-label-tertiary)}.dat-task-events{display:grid;gap:6px}.dat-task-event{padding:7px 9px}.dat-task-event time{display:block;color:var(--dsw-alias-label-tertiary);font-size:11px;margin-top:2px}",
        ".dat-task-result-preview,.dat-board-card-result{display:grid;gap:3px;padding:8px 9px;border:1px solid color-mix(in srgb,var(--dsw-alias-state-success-primary) 34%,var(--dsw-alias-border-l2));border-radius:8px;background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 8%,var(--dsw-alias-bg-layer-2));color:var(--dsw-alias-label-secondary);font-size:11px;line-height:1.4;text-align:left;white-space:pre-wrap;overflow-wrap:anywhere}.dat-task-result-preview strong,.dat-board-card-result strong{color:var(--dsw-alias-state-success-primary);font-size:11px}.dat-task-result{margin-top:12px;padding:12px;border:1px solid color-mix(in srgb,var(--dsw-alias-state-success-primary) 38%,var(--dsw-alias-border-l2));border-radius:10px;background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 7%,var(--dsw-alias-bg-layer-1))}.dat-task-result>h3{margin:0 0 8px;font-size:13px}.dat-task-result-text{color:var(--dsw-alias-label-primary);font-size:12px;line-height:1.58;white-space:pre-wrap;overflow-wrap:anywhere}.dat-task-result .dat-note{margin:8px 0 0}",
        ".dat-responsibility{margin-top:12px;padding:12px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-2)}.dat-responsibility[data-status=accepted]{border-color:color-mix(in srgb,var(--dsw-alias-state-success-primary) 38%,var(--dsw-alias-border-l2))}.dat-responsibility[data-status=attention],.dat-responsibility[data-status=legacy]{border-color:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 48%,var(--dsw-alias-border-l2));background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 7%,var(--dsw-alias-bg-layer-2))}.dat-responsibility-head{display:flex;align-items:flex-start;justify-content:space-between;gap:10px}.dat-responsibility-head h3{margin:0;font-size:13px}.dat-responsibility-head p{margin:3px 0 0}.dat-responsibility-chain{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px;margin:10px 0 0}.dat-responsibility-chain>div{min-width:0;padding:8px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-1)}.dat-responsibility-chain dt{color:var(--dsw-alias-label-tertiary);font-size:11px}.dat-responsibility-chain dd{margin:3px 0 0;color:var(--dsw-alias-label-primary);font-size:12px;line-height:1.4;overflow-wrap:anywhere}.dat-responsibility-source{margin:8px 0 0}.dat-legacy-record{display:grid;gap:3px;margin-top:9px;padding:9px;border:1px solid color-mix(in srgb,var(--dsw-alias-state-warn-primary) 44%,var(--dsw-alias-border-l2));border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);font-size:11px;line-height:1.45}.dat-legacy-record strong{color:var(--dsw-alias-state-warn-primary);font-size:12px}.dat-task-result[data-provenance=legacy_migration],.dat-task-result-preview[data-provenance=legacy_migration],.dat-board-card-result[data-provenance=legacy_migration]{border-color:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 44%,var(--dsw-alias-border-l2));background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 7%,var(--dsw-alias-bg-layer-1))}.dat-task-result[data-provenance=legacy_migration]>h3,.dat-task-result-preview[data-provenance=legacy_migration] strong,.dat-board-card-result[data-provenance=legacy_migration] strong{color:var(--dsw-alias-state-warn-primary)}.dat-responsibility-events{display:grid;gap:7px;margin-top:10px}.dat-responsibility-events h4{margin:0;font-size:12px}.dat-responsibility-event{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.4fr) auto;gap:8px;align-items:start;padding:8px;border:1px solid color-mix(in srgb,var(--dsw-alias-state-warn-primary) 38%,var(--dsw-alias-border-l2));border-radius:8px;background:var(--dsw-alias-bg-layer-1);font-size:11px;line-height:1.45}.dat-responsibility-event span{overflow-wrap:anywhere}.dat-responsibility-event time{color:var(--dsw-alias-label-tertiary);white-space:nowrap}.dat-responsibility-alert{margin:8px 0 0;color:var(--dsw-alias-state-warn-primary);font-size:12px;font-weight:650}.dat-board-card-executor{margin-top:3px;color:var(--dsw-alias-label-secondary);white-space:normal}.dat-board-card-executor[data-status=attention],.dat-board-card-executor[data-status=missing_completed],.dat-board-card-executor[data-status=legacy]{color:var(--dsw-alias-state-warn-primary)}.dat-closure{border-left:4px solid var(--dsw-alias-label-tertiary)}.dat-closure[data-outcome=succeeded]{border-left-color:var(--dsw-alias-state-success-primary)}.dat-closure[data-outcome=cancelled],.dat-closure[data-outcome=forced]{border-left-color:var(--dsw-alias-state-warn-primary)}.dat-closure[data-outcome=failed]{border-left-color:var(--dsw-alias-state-error-primary)}.dat-closure-head{display:flex;align-items:flex-start;justify-content:space-between;gap:10px}.dat-closure-head>div{display:grid;gap:3px}.dat-closure-head time{color:var(--dsw-alias-label-tertiary);font-size:11px}.dat-closure>.dat-meta{margin:7px 0 0}@media(max-width:620px){.dat-responsibility-head,.dat-closure-head{display:block}.dat-responsibility-head>.dat-status-chip,.dat-closure-head>time{margin-top:7px}.dat-responsibility-chain,.dat-responsibility-event{grid-template-columns:1fr}.dat-responsibility-event time{white-space:normal}}",
        ".dat-task-focus{min-height:clamp(460px,62vh,760px);padding:0;overflow:hidden}.dat-task-focus-head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:11px 14px;border-bottom:1px solid var(--dsw-alias-border-l2)}.dat-task-focus-head-copy{display:flex;align-items:center;gap:10px;min-width:0}.dat-task-focus-head-copy h2{margin:0;font-size:14px}.dat-task-focus-body{padding:16px}.dat-task-focus-hero{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.dat-task-focus-title{max-width:820px;margin:3px 0 0;font-size:21px;line-height:1.35;overflow-wrap:anywhere}.dat-task-workflow{margin-top:15px;padding:14px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-2)}.dat-task-workflow-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.dat-task-workflow-head h3,.dat-task-focus-surface>h3,.dat-task-live-head h3{margin:0;font-size:13px}.dat-task-workflow-head p{margin:4px 0 0}.dat-task-stage-track{display:grid;grid-template-columns:minmax(0,1fr) 28px minmax(0,1fr) 28px minmax(0,1fr);align-items:stretch;gap:0;margin-top:13px}.dat-task-stage{min-width:0;padding:10px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-1)}.dat-task-stage[data-state=current]{border-color:var(--dsw-alias-brand-primary);background:color-mix(in srgb,var(--dsw-alias-brand-primary) 8%,var(--dsw-alias-bg-layer-1))}.dat-task-stage[data-state=reached]{border-color:color-mix(in srgb,var(--dsw-alias-state-success-primary) 45%,var(--dsw-alias-border-l2))}.dat-task-stage[data-state=upcoming],.dat-task-stage[data-state=unknown]{opacity:.72}.dat-task-stage-top{display:flex;align-items:center;gap:7px;min-width:0}.dat-task-stage-top strong{font-size:12px;overflow-wrap:anywhere}.dat-task-stage-dot{width:8px;height:8px;border-radius:50%;flex:none;background:var(--dsw-alias-label-tertiary)}.dat-task-stage[data-state=current] .dat-task-stage-dot{background:var(--dsw-alias-brand-primary)}.dat-task-stage[data-state=reached] .dat-task-stage-dot{background:var(--dsw-alias-state-success-primary)}.dat-task-stage>.dat-meta{margin-top:5px}.dat-task-stage>time{display:block;margin-top:4px}.dat-task-stage-arrow{display:grid;place-items:center;color:var(--dsw-alias-label-tertiary)}.dat-task-block-row{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));column-gap:28px;margin-top:10px}.dat-task-block-branch{grid-column:2;min-width:0;padding:9px 10px;border:1px dashed var(--dsw-alias-border-l3);border-radius:10px;background:var(--dsw-alias-bg-layer-1)}.dat-task-block-branch[data-active=true]{border-style:solid;border-color:var(--dsw-alias-state-warn-primary);background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 8%,var(--dsw-alias-bg-layer-1))}.dat-task-block-branch[data-active=true] .dat-task-stage-dot{background:var(--dsw-alias-state-warn-primary)}.dat-task-block-branch>.dat-meta{margin-top:5px}.dat-task-block-branch>time,.dat-task-block-branch>p{display:block;margin:4px 0 0}.dat-task-focus-grid{display:grid;grid-template-columns:minmax(0,1fr);gap:12px;margin-top:12px;align-items:start}.dat-task-focus-main{display:grid;gap:12px;min-width:0}.dat-task-focus-surface{box-sizing:border-box;min-width:0;padding:13px;border:1px solid var(--dsw-alias-border-l2);border-radius:11px;background:var(--dsw-alias-bg-layer-2)}.dat-task-focus-surface>.dat-meta{margin:7px 0 0}.dat-task-next{border-left:3px solid var(--dsw-alias-brand-primary)}.dat-task-next[data-state=blocked]{border-left-color:var(--dsw-alias-state-warn-primary)}.dat-task-next[data-state=completed]{border-left-color:var(--dsw-alias-state-success-primary)}.dat-task-live{min-width:0}.dat-task-live-head{display:flex;align-items:center;justify-content:space-between;gap:8px}.dat-task-live>.dat-note{margin:5px 0 9px}.dat-task-live-list{display:grid;gap:7px;max-height:clamp(280px,46vh,560px);overflow-y:auto;overscroll-behavior:contain;scrollbar-gutter:stable;padding-right:3px}.dat-task-live-list .dat-card{background:var(--dsw-alias-bg-layer-1)}.dat-task-live-empty{padding:22px 8px;text-align:center}.dat-task-live-last{padding-top:9px;border-top:1px solid var(--dsw-alias-border-l2)}",
        ".dat-task-progress{display:grid;gap:7px;margin-top:13px}.dat-task-progress-copy{display:flex;align-items:center;justify-content:space-between;gap:10px;font-size:12px}.dat-task-progress-copy span{color:var(--dsw-alias-label-secondary);text-align:right}.dat-task-progress-track{position:relative;height:7px;overflow:visible;clip-path:inset(-18px 0 -18px 0 round 999px);border-radius:999px;background:color-mix(in srgb,var(--dsw-alias-brand-primary) 5%,var(--dsw-alias-bg-layer-1));box-shadow:inset 0 0 0 1px var(--dsw-alias-border-l2)}.dat-task-progress-fill{display:block;height:100%;min-width:0;border-radius:inherit;background:var(--dsw-alias-brand-primary);transition:width .2s ease}.dat-task-progress-fill.is-indeterminate{position:absolute;top:50%;left:0;width:9px;height:9px;overflow:visible;background:var(--dat-pulse-c7);box-shadow:0 0 0 2px color-mix(in srgb,var(--dat-pulse-c7) 28%,transparent),0 0 10px var(--dat-pulse-c7),0 0 24px color-mix(in srgb,var(--dat-pulse-c6) 72%,transparent);transform:translate(-50%,-50%);animation:dat-task-progress-flow 1.8s cubic-bezier(.35,0,.16,1) infinite}.dat-task-progress-fill.is-indeterminate::before{content:\"\";position:absolute;top:50%;right:45%;width:96px;height:4px;border-radius:999px;background:linear-gradient(90deg,transparent 0%,var(--dat-pulse-c1) 14%,var(--dat-pulse-c2) 28%,var(--dat-pulse-c3) 42%,var(--dat-pulse-c4) 56%,var(--dat-pulse-c5) 70%,var(--dat-pulse-c6) 84%,var(--dat-pulse-c7) 100%);filter:blur(.35px) saturate(1.35);opacity:.9;transform:translateY(-50%)}.dat-task-progress-fill.is-indeterminate::after{content:\"\";position:absolute;inset:-6px;border:1px solid color-mix(in srgb,var(--dat-pulse-c7) 72%,transparent);border-radius:50%;animation:dat-task-progress-aura .72s ease-out infinite}@keyframes dat-task-progress-flow{0%{left:0;opacity:0;transform:translate(-50%,-50%) scale(.62)}8%{opacity:1}48%{transform:translate(-50%,-50%) scale(1)}88%{opacity:1}100%{left:100%;opacity:0;transform:translate(-50%,-50%) scale(1.18)}}@keyframes dat-task-progress-aura{0%{opacity:.9;transform:scale(.45)}100%{opacity:0;transform:scale(1.35)}}@media (prefers-reduced-motion:reduce){.dat-task-progress-fill{transition:none}.dat-task-progress-fill.is-indeterminate{left:50%;animation:none}.dat-task-progress-fill.is-indeterminate::after{animation:none;opacity:.45}}.dat-task-workflow-runtime{display:grid;grid-template-columns:minmax(0,1fr);gap:10px;margin-top:12px}.dat-task-runtime-pane{min-width:0;padding:11px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-1)}.dat-task-runtime-head{display:flex;align-items:flex-start;justify-content:space-between;gap:9px;margin-bottom:8px}.dat-task-runtime-head h4{margin:0;font-size:12px}.dat-task-runtime-head p{margin:3px 0 0}.dat-task-plan{display:grid;gap:7px;max-height:330px;margin:0;padding:0;overflow:auto;list-style:none}.dat-task-plan li{display:grid;grid-template-columns:17px minmax(0,1fr);gap:6px;align-items:start;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.45}.dat-task-plan li[data-state=completed]{color:var(--dsw-alias-label-tertiary);text-decoration:line-through}.dat-task-plan li[data-state=in_progress]{color:var(--dsw-alias-label-primary);font-weight:600}.dat-task-plan-mark{color:var(--dsw-alias-label-tertiary);text-align:center}.dat-task-plan li[data-state=completed] .dat-task-plan-mark{color:var(--dsw-alias-state-success-primary)}.dat-task-plan li[data-state=in_progress] .dat-task-plan-mark{color:var(--dsw-alias-brand-primary)}.dat-task-runtime-list{display:grid;gap:0;max-height:360px;overflow:auto;border-top:1px solid var(--dsw-alias-border-l2)}.dat-task-runtime-event{display:grid;grid-template-columns:10px minmax(0,1fr) auto;gap:8px;align-items:start;padding:9px 2px;border-bottom:1px solid var(--dsw-alias-border-l2)}.dat-task-runtime-dot{width:8px;height:8px;margin-top:4px;border-radius:50%;background:var(--dsw-alias-label-tertiary)}.dat-task-runtime-event[data-status=running] .dat-task-runtime-dot{background:var(--dsw-alias-brand-primary);box-shadow:0 0 0 3px color-mix(in srgb,var(--dsw-alias-brand-primary) 15%,transparent)}.dat-task-runtime-event[data-status=completed] .dat-task-runtime-dot{background:var(--dsw-alias-state-success-primary)}.dat-task-runtime-event[data-status=failed] .dat-task-runtime-dot{background:var(--dsw-alias-state-error-primary)}.dat-task-runtime-event[data-status=blocked] .dat-task-runtime-dot{background:var(--dsw-alias-state-warn-primary)}.dat-task-runtime-copy{min-width:0}.dat-task-runtime-copy strong,.dat-task-runtime-copy span{display:block;overflow-wrap:anywhere}.dat-task-runtime-copy strong{font-size:12px}.dat-task-runtime-copy span{margin-top:2px;color:var(--dsw-alias-label-tertiary);font-size:11px}.dat-task-runtime-event time{color:var(--dsw-alias-label-tertiary);font-size:11px;white-space:nowrap}.dat-task-runtime-empty{margin:10px 0}.dat-task-runtime-limit{margin:8px 0 0}.dat-task-copy-section{display:grid;gap:10px;margin:11px 0 14px}.dat-task-copy-block{padding:10px 11px;border-left:3px solid var(--dsw-alias-border-l3);border-radius:0 9px 9px 0;background:var(--dsw-alias-bg-layer-2)}.dat-task-copy-block:first-child{border-left-color:var(--dsw-alias-brand-primary)}.dat-task-copy-block h4{margin:0 0 5px;color:var(--dsw-alias-label-tertiary);font-size:11px;font-weight:650}.dat-task-copy-block p{margin:0;font-size:13px;line-height:1.55;white-space:pre-wrap;overflow-wrap:anywhere}.dat-task-focus-facts{padding-top:11px;border-top:1px solid var(--dsw-alias-border-l2)}@container dat-workspace (min-width:760px){.dat-task-workflow-runtime{grid-template-columns:minmax(220px,.72fr) minmax(0,1.45fr)}.dat-task-focus-facts{grid-template-columns:repeat(2,minmax(0,1fr));column-gap:20px}}",
        ".dat-workspace{container-type:inline-size;container-name:dat-workspace;min-width:0}.dat-workspace-main{min-width:0}.dat-workspace-nav{position:sticky;top:0;z-index:12;display:flex;align-items:center;gap:5px;box-sizing:border-box;width:100%;max-width:100%;margin:0 0 14px;padding:4px;overflow-x:auto;border:1px solid var(--dsw-alias-border-l2);border-radius:11px;background:color-mix(in srgb,var(--dsw-alias-bg-layer-1) 96%,transparent);box-shadow:0 6px 18px rgba(35,72,80,.08);backdrop-filter:blur(12px);scrollbar-width:thin;overscroll-behavior-inline:contain}.dat-workspace-nav button{display:flex;flex:1 0 auto;align-items:center;justify-content:space-between;gap:8px;min-width:max-content;border:0;border-radius:8px;padding:8px 10px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;cursor:pointer;text-align:left;white-space:nowrap}.dat-workspace-nav button:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}.dat-workspace-nav button[aria-current=page]{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);font-weight:650}.dat-workspace-nav small{color:var(--dsw-alias-label-tertiary);font-size:11px}.dat-workspace-view{min-width:0}.dat-workspace-view-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin:0 0 12px}.dat-workspace-view-head h2{margin:0;font-size:18px}.dat-workspace-view-head p{max-width:760px;margin:4px 0 0;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:1.5}.dat-workspace-view-actions{display:flex;align-items:center;gap:7px;flex-wrap:wrap;justify-content:flex-end}",
        ".dat-board-shell{min-width:0}.dat-board-shell.dat-inspector-open{min-width:0}.dat-board-main{container-type:inline-size;container-name:dat-board-main;min-width:0}.dat-board-toolbar{display:flex;align-items:center;justify-content:space-between;gap:9px;flex-wrap:wrap;margin:0 0 10px;padding:9px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-1)}.dat-board-note{display:flex;align-items:flex-start;gap:8px;margin:0 0 10px;padding:9px 10px;border:1px solid color-mix(in srgb,var(--dsw-alias-state-warn-primary) 24%,var(--dsw-alias-border-l2));border-radius:10px;background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 7%,var(--dsw-alias-bg-layer-1));color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.5}.dat-task-board{display:grid;grid-template-columns:minmax(0,1fr);gap:10px;align-items:start}.dat-board-column{display:flex;flex-direction:column;box-sizing:border-box;height:clamp(360px,56vh,640px);min-width:0;padding:10px;border:1px solid var(--dsw-alias-border-l2);border-radius:11px;background:var(--dsw-alias-bg-layer-1);overflow:hidden}.dat-board-column[data-column=blocked]{border-color:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 30%,var(--dsw-alias-border-l2))}.dat-board-column-head{display:flex;align-items:center;justify-content:space-between;gap:8px;flex:none;margin-bottom:9px;padding:0 2px}.dat-board-column-heading{display:flex;align-items:center;gap:7px;min-width:0}.dat-board-column-heading h3{margin:0;font-size:13px}.dat-board-status-dot{width:8px;height:8px;border-radius:50%;background:var(--dsw-alias-label-tertiary);flex:none}.dat-board-column[data-column=in_progress] .dat-board-status-dot{background:var(--dsw-alias-brand-primary)}.dat-board-column[data-column=blocked] .dat-board-status-dot{background:var(--dsw-alias-state-warn-primary)}.dat-board-column[data-column=completed] .dat-board-status-dot{background:var(--dsw-alias-state-success-primary)}.dat-board-column-list{display:grid;grid-auto-rows:max-content;align-content:start;gap:8px;min-height:0;overflow-y:auto;overscroll-behavior:contain;scrollbar-gutter:stable;padding-right:2px}.dat-board-card{display:grid;align-self:start;gap:7px;width:100%;min-width:0;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;padding:10px;background:var(--dsw-alias-bg-layer-2);color:inherit;font:inherit;text-align:left;cursor:pointer;content-visibility:auto;contain-intrinsic-size:auto 108px}.dat-board-card:hover{border-color:var(--dsw-alias-border-l3);background:var(--dsw-alias-interactive-bg-hover)}.dat-board-card:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}.dat-board-card-top,.dat-board-card-bottom{display:flex;align-items:center;justify-content:space-between;gap:7px;min-width:0}.dat-board-card-id{min-width:0;overflow:hidden;color:var(--dsw-alias-label-tertiary);font:11px/1.4 ui-monospace,SFMono-Regular,Consolas,monospace;text-overflow:ellipsis;white-space:nowrap}.dat-board-card-title{display:-webkit-box;overflow:hidden;font-size:13px;font-weight:650;line-height:1.45;overflow-wrap:anywhere;-webkit-box-orient:vertical;-webkit-line-clamp:3}.dat-board-card-owner{min-width:0;overflow:hidden;color:var(--dsw-alias-label-secondary);font-size:12px;text-overflow:ellipsis;white-space:nowrap}.dat-board-card-flags{display:flex;gap:5px;flex-wrap:wrap}.dat-board-card-flag{border-radius:999px;padding:2px 6px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-tertiary);font-size:11px}.dat-board-card-flag.is-warning{color:var(--dsw-alias-state-warn-primary)}.dat-board-empty{padding:22px 8px;text-align:center;color:var(--dsw-alias-label-tertiary);font-size:12px}.dat-board-overflow{padding:7px 2px 1px;color:var(--dsw-alias-label-tertiary);font-size:11px}.dat-board-shell .dat-scrim{display:block;position:fixed;inset:0;z-index:39;border:0;background:rgba(0,0,0,.28)}.dat-board-shell .dat-inspector{position:fixed;z-index:40;top:0;right:0;bottom:0;width:min(390px,92vw);max-height:none;border-radius:12px 0 0 12px}.dat-board-shell .dat-inspector-body{max-height:calc(100vh - 60px)}",
        ".dat-board-column[data-column=attention]{border-color:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 38%,var(--dsw-alias-border-l2))}.dat-board-column[data-column=running] .dat-board-status-dot{background:var(--dsw-alias-brand-primary)}.dat-board-column[data-column=attention] .dat-board-status-dot{background:var(--dsw-alias-state-warn-primary)}.dat-board-column[data-column=done] .dat-board-status-dot{background:var(--dsw-alias-state-success-primary)}.dat-board-card{min-height:44px;scroll-margin-block:72px}.dat-board-card:focus-visible,.dat-board-history>summary:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}.dat-board-card-facts{display:grid;gap:3px;margin-top:8px;padding:8px;border-left:3px solid var(--dsw-alias-state-warn-primary);border-radius:6px;background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 8%,var(--dsw-alias-bg-layer-2));color:var(--dsw-alias-label-secondary);font-size:11px;line-height:1.45}.dat-board-card-facts strong{color:var(--dsw-alias-label-primary)}.dat-board-card-time{color:var(--dsw-alias-label-tertiary);font-size:11px}.dat-board-card-next{margin-top:8px;color:var(--dsw-alias-label-secondary);font-size:11px;line-height:1.45}.dat-board-history{margin-top:12px;padding:10px 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-1)}.dat-board-history>summary{min-height:44px;display:flex;align-items:center;cursor:pointer;color:var(--dsw-alias-label-secondary);font-size:12px;font-weight:650}.dat-board-history-list{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,240px),1fr));gap:8px;margin-top:8px}.dat-board-card-result{border-color:var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2)}.dat-board-card-result strong{color:var(--dsw-alias-label-secondary)}",
        ".dat-plan-lifecycle{display:grid;gap:13px;margin:0 0 12px;padding:14px}.dat-plan-lifecycle-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.dat-plan-lifecycle-head h3,.dat-plan-subsection h4,.dat-task-assurance h3,.dat-assurance-section h4{margin:0;font-size:13px}.dat-plan-lifecycle-head p,.dat-plan-subsection>p,.dat-task-assurance>p{margin:4px 0 0}.dat-plan-steps{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;list-style:none;margin:0;padding:0}.dat-plan-step{display:flex;align-items:center;gap:8px;min-width:0;padding:9px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:9px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font-size:12px}.dat-plan-step::before{content:\"\";width:8px;height:8px;border-radius:50%;flex:none;background:var(--dsw-alias-label-tertiary)}.dat-plan-step>span{display:grid;gap:2px;min-width:0}.dat-plan-step strong{font-size:12px}.dat-plan-step time{color:var(--dsw-alias-label-tertiary);font-size:11px}.dat-plan-step[data-state=current]{border-color:var(--dsw-alias-brand-primary);background:color-mix(in srgb,var(--dsw-alias-brand-primary) 8%,var(--dsw-alias-bg-layer-2));color:var(--dsw-alias-label-primary);font-weight:650}.dat-plan-step[data-state=current]::before{background:var(--dsw-alias-brand-primary);box-shadow:0 0 0 3px color-mix(in srgb,var(--dsw-alias-brand-primary) 18%,transparent)}.dat-plan-step[data-state=complete]::before{background:var(--dsw-alias-state-success-primary)}.dat-plan-grid{display:grid;grid-template-columns:minmax(0,1.35fr) minmax(260px,.85fr);gap:10px}.dat-plan-subsection{min-width:0;padding:11px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-2)}.dat-preflight-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px;margin-top:9px}.dat-preflight-item{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,auto);align-items:center;gap:8px;min-width:0;padding:8px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;font-size:12px}.dat-preflight-item span:first-child{min-width:0;overflow-wrap:anywhere}.dat-status-chip{display:inline-flex;align-items:center;justify-content:center;min-width:0;max-width:min(100%,210px);border:1px solid var(--dsw-alias-border-l3);border-radius:999px;padding:3px 8px;color:var(--dsw-alias-label-secondary);font-size:11px;line-height:1.35;text-align:center;overflow-wrap:anywhere}.dat-status-chip[data-status=host_verified],.dat-status-chip[data-status=verified],.dat-status-chip[data-status=succeeded]{border-color:color-mix(in srgb,var(--dsw-alias-state-success-primary) 46%,var(--dsw-alias-border-l3));color:var(--dsw-alias-state-success-primary)}.dat-status-chip[data-status=autopilot]{border-color:color-mix(in srgb,var(--dsw-alias-state-success-primary) 30%,var(--dsw-alias-border-l3));background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 7%,var(--dsw-alias-bg-layer-1));color:var(--dsw-alias-label-primary)}.dat-status-chip[data-status=attention],.dat-status-chip[data-status=unknown],.dat-status-chip[data-status=outcome_unknown],.dat-status-chip[data-status=confirm_each]{border-color:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 50%,var(--dsw-alias-border-l3));color:var(--dsw-alias-state-warn-primary)}.dat-status-chip[data-status=unavailable],.dat-status-chip[data-status=failed],.dat-status-chip[data-status=forbidden]{border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 50%,var(--dsw-alias-border-l3));color:var(--dsw-alias-state-error-primary)}.dat-handoff-state{margin-top:9px;padding:9px;border-left:3px solid var(--dsw-alias-border-l3);border-radius:7px;background:var(--dsw-alias-bg-layer-1);font-size:12px;line-height:1.5}.dat-handoff-state[data-pending=true]{border-left-color:var(--dsw-alias-state-warn-primary)}.dat-handoff-meta{display:flex;gap:6px;flex-wrap:wrap;margin-top:4px;color:var(--dsw-alias-label-tertiary);font-size:11px}.dat-handoff-history{margin-top:9px}.dat-handoff-history>summary{display:flex;align-items:center;min-height:44px;cursor:pointer;color:var(--dsw-alias-label-secondary);font-size:12px}.dat-handoff-history>summary:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}.dat-handoff-list,.dat-assurance-list{display:grid;gap:6px;list-style:none;margin:8px 0 0;padding:0}.dat-handoff-list li,.dat-assurance-list li{min-width:0;padding:7px 8px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-1);font-size:12px;line-height:1.4}.dat-handoff-list time,.dat-assurance-list time{display:block;margin-top:2px;color:var(--dsw-alias-label-tertiary);font-size:11px}.dat-plan-migration{margin:0;padding:9px 10px;border:1px solid color-mix(in srgb,var(--dsw-alias-state-warn-primary) 35%,var(--dsw-alias-border-l2));border-radius:9px;background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 7%,var(--dsw-alias-bg-layer-1));color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.5}",
        ".dat-task-assurance{margin-top:14px;padding:13px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-2)}.dat-assurance-current{display:flex;gap:7px;flex-wrap:wrap;margin-top:9px}.dat-assurance-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px;margin-top:10px}.dat-assurance-section{min-width:0;padding:10px;border:1px solid var(--dsw-alias-border-l2);border-radius:9px;background:var(--dsw-alias-bg-layer-1)}.dat-assurance-section-wide{grid-column:1/-1}.dat-assurance-item-head{display:flex;align-items:flex-start;justify-content:space-between;gap:8px;min-width:0}.dat-assurance-item-head strong{min-width:0;font-size:12px;overflow-wrap:anywhere}.dat-assurance-item-meta{margin-top:3px;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:1.4}.dat-history-entry{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;align-items:start}.dat-history-entry-copy{min-width:0}.dat-history-entry-copy strong{display:block;font-size:12px}.dat-history-entry-copy span{display:block;margin-top:2px;color:var(--dsw-alias-label-secondary);font-size:11px;overflow-wrap:anywhere}.dat-history-entry time{white-space:nowrap;color:var(--dsw-alias-label-tertiary);font-size:11px}",
        ".dat-flow-blueprint{display:grid;gap:10px}.dat-flow-chain{display:grid;grid-template-columns:minmax(0,1fr);gap:8px;padding:12px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background-color:var(--dsw-alias-bg-layer-1);background-image:radial-gradient(circle,var(--dsw-alias-border-l2) 1px,transparent 1px);background-size:18px 18px}.dat-flow-step{display:grid;gap:5px;min-width:0;padding:11px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-2)}.dat-flow-step strong{font-size:13px}.dat-flow-step span{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.45}.dat-flow-arrow{display:grid;place-items:center;color:var(--dsw-alias-label-tertiary)}.dat-flow-boundary{margin:0;padding:10px;border-radius:10px;background:color-mix(in srgb,var(--dsw-alias-brand-primary) 7%,var(--dsw-alias-bg-layer-1));color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.5}",
        ".dat-automation-grid{display:grid;gap:12px}.dat-automation-panel{padding:14px}.dat-automation-panel-head{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;margin-bottom:10px}.dat-automation-panel-head h3{margin:0;font-size:14px}.dat-automation-list{display:grid;gap:0}.dat-schedule-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px;align-items:center;padding:10px 0;border-top:1px solid var(--dsw-alias-border-l2)}.dat-schedule-row:first-child{border-top:0}.dat-schedule-copy{min-width:0}.dat-schedule-copy strong{display:block;font-size:13px;overflow-wrap:anywhere}.dat-schedule-copy span{display:block;margin-top:3px;color:var(--dsw-alias-label-tertiary);font-size:11px;overflow-wrap:anywhere}.dat-schedule-history{margin-top:12px;padding-top:10px;border-top:1px solid var(--dsw-alias-border-l2)}.dat-schedule-history h4{margin:0 0 7px;font-size:12px}.dat-schedule-boundary{padding:10px;border-radius:10px;background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 7%,var(--dsw-alias-bg-layer-1));color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.5}",
        ".dat-project-tasks-form{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;align-items:end;margin-bottom:12px}.dat-project-tasks-form .dat-label{margin-top:0}.dat-project-task-card{display:grid;gap:8px}.dat-project-task-card h4{margin:0;font-size:13px;overflow-wrap:anywhere}.dat-project-task-card .dat-actions{margin:0}.dat-project-task-columns{display:grid;grid-template-columns:minmax(0,1fr);gap:10px}.dat-project-task-column{min-width:0;padding:10px;border:1px solid var(--dsw-alias-border-l2);border-radius:11px;background:var(--dsw-alias-bg-layer-1)}.dat-project-task-column h3{margin:0;font-size:13px}.dat-project-task-list{display:grid;gap:8px;margin-top:9px}",
        ".dat-participant-grid{display:grid;grid-template-columns:minmax(0,1fr);gap:10px}.dat-participant-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px;align-items:center;padding:10px 0;border-top:1px solid var(--dsw-alias-border-l2)}.dat-participant-row:first-child{border-top:0}.dat-participant-copy{display:flex;align-items:center;gap:9px;min-width:0}.dat-participant-avatar{display:grid;place-items:center;width:30px;height:30px;border-radius:50%;flex:none;background:color-mix(in srgb,var(--dsw-alias-brand-primary) 12%,var(--dsw-alias-bg-layer-2));color:var(--dsw-alias-brand-primary);font-size:12px;font-weight:650}.dat-participant-copy>span{min-width:0}.dat-participant-copy strong,.dat-participant-copy small{display:block;overflow-wrap:anywhere}.dat-participant-copy small{margin-top:2px;color:var(--dsw-alias-label-tertiary);font-size:11px}.dat-participant-state{text-align:right}.dat-inbox-boundary{margin-bottom:10px}.dat-inbox-list{display:grid;gap:8px}",
        ".dat-empty-workbench{margin-bottom:12px}.dat-empty-workbench .dat-task-board{opacity:.96}.dat-empty-workbench .dat-board-column{height:clamp(250px,40vh,420px)}.dat-empty-workbench .dat-board-empty{padding:28px 8px}.dat-onboarding-slot{margin-top:12px}.dat-team-mode{padding:10px 12px}.dat-team-mode-bar{display:flex;align-items:center;justify-content:space-between;gap:12px}.dat-team-mode-copy{min-width:0;flex:1 1 420px}.dat-team-mode-title{display:flex;align-items:center;gap:7px}.dat-team-mode-title h2{margin:0;font-size:14px}.dat-team-mode-copy p{margin:3px 0 0;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.45}.dat-team-mode-actions{display:flex;align-items:center;justify-content:flex-end;gap:9px;flex-wrap:wrap}.dat-team-mode-switch{display:inline-flex;align-items:center;gap:7px;color:var(--dsw-alias-label-secondary);font-size:12px;cursor:pointer}.dat-team-mode-switch input{position:relative;box-sizing:border-box;width:34px;height:20px;margin:0;border:1px solid var(--dsw-alias-border-l3);border-radius:999px;appearance:none;background:var(--dsw-alias-bg-layer-2);cursor:pointer;transition:background .16s ease,border-color .16s ease}.dat-team-mode-switch input::after{position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;background:var(--dsw-alias-label-tertiary);content:\"\";transition:transform .16s ease,background .16s ease}.dat-team-mode-switch input:checked{border-color:var(--dsw-alias-state-success-primary);background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 20%,var(--dsw-alias-bg-layer-2))}.dat-team-mode-switch input:checked::after{transform:translateX(14px);background:var(--dsw-alias-state-success-primary)}.dat-team-mode-switch input:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}.dat-team-mode-switch input:disabled{opacity:.5;cursor:wait}.dat-onboarding-details{margin-top:9px;border-top:1px solid var(--dsw-alias-border-l2);padding-top:8px}.dat-onboarding-details>summary{cursor:pointer;color:var(--dsw-alias-label-secondary);font-size:12px}.dat-onboarding-details[open]>summary{margin-bottom:10px}.dat-onboarding-fields{padding:0 2px}.dat-empty-canvas-panel{overflow:hidden;padding:14px}.dat-empty-canvas-route{display:flex;align-items:stretch;gap:8px;min-width:0;overflow-x:auto;padding:2px 1px 8px;scrollbar-width:thin}.dat-empty-canvas-node{display:flex;flex:1 0 170px;min-width:170px;max-width:240px;flex-direction:column;gap:5px;padding:14px;border:1px dashed var(--dsw-alias-border-l3);border-radius:11px;background:var(--dsw-alias-bg-layer-2)}.dat-empty-canvas-node strong{font-size:13px}.dat-empty-canvas-node span{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.45}.dat-empty-canvas-arrow{display:grid;place-items:center;flex:0 0 24px;color:var(--dsw-alias-brand-primary);font-size:18px}.dat-empty-canvas-footer{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-top:4px;padding-top:10px;border-top:1px solid var(--dsw-alias-border-l2)}",
        "@container dat-workspace (min-width:680px){.dat-flow-chain{grid-template-columns:repeat(3,minmax(0,1fr))}.dat-flow-arrow{transform:rotate(-90deg)}.dat-participant-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.dat-project-task-columns{grid-template-columns:repeat(2,minmax(0,1fr))}.dat-automation-grid{grid-template-columns:minmax(0,1fr) minmax(260px,.72fr)}}",
        "@container dat-board-main (min-width:680px){.dat-task-board{grid-template-columns:repeat(2,minmax(0,1fr))}}",
        "@container dat-board-main (min-width:900px){.dat-task-board{grid-template-columns:repeat(4,minmax(0,1fr))}}",
        "@container dat-workspace (min-width:900px){.dat-project-task-columns{grid-template-columns:repeat(4,minmax(0,1fr))}.dat-task-focus-grid{grid-template-columns:minmax(0,1.55fr) minmax(280px,.72fr)}}",
        "@container dat-workspace (max-width:900px){.dat-active-shell.dat-inspector-open{display:block}.dat-active-shell .dat-scrim{display:block;position:fixed;inset:0;z-index:39;border:0;background:rgba(0,0,0,.28)}.dat-active-shell .dat-inspector{position:fixed;z-index:40;top:0;right:0;bottom:0;width:min(390px,92vw);max-height:none;border-radius:12px 0 0 12px}.dat-active-shell .dat-inspector-body{max-height:calc(100vh - 60px)}}",
        "@media(max-width:760px){.dat-plan-grid,.dat-assurance-grid{grid-template-columns:1fr}.dat-assurance-section-wide{grid-column:auto}}",
        "@media(max-width:620px){.dat-workspace-nav{overflow-x:auto;border-radius:10px}.dat-btn{min-height:44px;max-width:100%;white-space:normal;overflow-wrap:anywhere}.dat-workspace-nav button{box-sizing:border-box;min-height:44px;max-width:calc(100vw - 28px)}.dat-plan-lifecycle-head{display:block}.dat-plan-lifecycle-head>.dat-row{margin-top:8px}.dat-plan-steps,.dat-preflight-grid{grid-template-columns:1fr}.dat-project-tasks-form{grid-template-columns:1fr}.dat-workspace-view-head{display:block}.dat-workspace-view-actions{justify-content:flex-start;margin-top:9px}.dat-schedule-row,.dat-participant-row{grid-template-columns:minmax(0,1fr)}.dat-participant-state{text-align:left}.dat-team-mode-bar{align-items:flex-start;flex-direction:column}.dat-team-mode-actions{width:100%;justify-content:space-between}.dat-active-shell .dat-inspector{width:100%;border-radius:0}.dat-task-focus-head{align-items:flex-start}.dat-task-focus-head-copy{align-items:flex-start;flex-direction:column}.dat-task-focus-head>.dat-row{align-self:flex-start}.dat-task-focus-body{padding:12px}.dat-task-focus-hero{display:block}.dat-task-focus-hero>.dat-badge{margin-top:8px}.dat-task-stage-track{grid-template-columns:1fr;gap:6px}.dat-task-stage-arrow{transform:rotate(90deg)}.dat-task-block-row{grid-template-columns:1fr;margin-top:7px}.dat-task-block-branch{grid-column:auto}}",
      ].join("\n");
      document.head.appendChild(style);
    }

    function errorText(error) { return error && error.message ? error.message : String(error || "unknown"); }
    function stateUrl(sessionId, selectedTeamId) { return "/api/agent-teams/state?sessionId=" + encodeURIComponent(sessionId) + (selectedTeamId ? "&teamId=" + encodeURIComponent(selectedTeamId) : ""); }
    function eventsUrl(sessionId, selectedTeamId) { return "/api/agent-teams/events?sessionId=" + encodeURIComponent(sessionId) + (selectedTeamId ? "&teamId=" + encodeURIComponent(selectedTeamId) : ""); }
    function taskDetailUrl(sessionId, selectedTeamId, selectedTaskId) { return "/api/agent-teams/task-detail?sessionId=" + encodeURIComponent(sessionId) + "&teamId=" + encodeURIComponent(selectedTeamId) + "&taskId=" + encodeURIComponent(selectedTaskId); }
    function taskDetailEventsUrl(sessionId, selectedTeamId, selectedTaskId) { return "/api/agent-teams/task-detail/events?sessionId=" + encodeURIComponent(sessionId) + "&teamId=" + encodeURIComponent(selectedTeamId) + "&taskId=" + encodeURIComponent(selectedTaskId); }
    function fetchState(sessionId, selectedTeamId) {
      return fetch(stateUrl(sessionId, selectedTeamId), { method: "GET", credentials: "same-origin", headers: { Accept: "application/json" } }).then(function (response) {
        return response.json().catch(function () { return {}; }).then(function (data) { if (!response.ok) { var error = new Error(data.error || ("HTTP " + response.status)); error.code = data.code; error.status = response.status; throw error; } return data; });
      });
    }
    function fetchTaskDetail(sessionId, selectedTeamId, selectedTaskId) {
      return fetch(taskDetailUrl(sessionId, selectedTeamId, selectedTaskId), { method: "GET", credentials: "same-origin", headers: { Accept: "application/json" } }).then(function (response) {
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
        var alive = true, source = null, sourceOpen = false, pollTimer = null, pollAttempt = 0, publishFrame = null, pendingSnapshot = null, loadPromise = null, snapshotFallbackTimer = null, loadGeneration = 0, streamEpoch = 0;
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
        function clearSnapshotFallback() {
          if (snapshotFallbackTimer) clearTimeout(snapshotFallbackTimer);
          snapshotFallbackTimer = null;
        }
        function load(silent, expectedStreamEpoch) {
          if (loadPromise) return loadPromise;
          var generation = loadGeneration;
          var operation = fetchState(sessionId, selectedTeamId).then(function (next) {
            if (alive && generation === loadGeneration && (expectedStreamEpoch === undefined || streamEpoch === expectedStreamEpoch)) {
              failureRef.current = 0;
              queueSnapshot(next);
              if (!sourceOpen) setConnection("polling");
            }
            return next;
          }).catch(function (err) {
            if (alive && generation === loadGeneration) {
              failureRef.current += 1;
              if (!silent) setError(errorText(err));
              else if (failureRef.current >= 2) setConnection("stale");
            }
            throw err;
          });
          loadPromise = operation.finally(function () { loadPromise = null; });
          return loadPromise;
        }
        function closeSource(invalidateLoads) {
          if (invalidateLoads) loadGeneration += 1;
          var current = source;
          source = null;
          sourceOpen = false;
          if (current) {
            current.onopen = null;
            current.onmessage = null;
            current.onerror = null;
            if (typeof current.close === "function") current.close();
          }
          clearPolling();
          clearSnapshotFallback();
        }
        function schedulePolling() {
          if (!alive || hidden() || sourceOpen || pollTimer) return;
          var base = Math.min(30000, 4000 * Math.pow(2, Math.min(pollAttempt, 3)));
          var delay = Math.round(base * (0.8 + Math.random() * 0.4));
          pollTimer = setTimeout(function () {
            pollTimer = null;
            if (!alive || hidden() || sourceOpen) return;
            pollAttempt += 1;
            setConnection("polling");
            var expectedStreamEpoch = streamEpoch;
            load(true, expectedStreamEpoch).catch(function () {}).finally(schedulePolling);
          }, delay);
        }
        function openSource() {
          if (!alive || hidden() || source) return;
          if (typeof EventSource !== "function") { schedulePolling(); return; }
          var current;
          try {
            current = new EventSource(eventsUrl(sessionId, selectedTeamId));
            if (!current || typeof current.addEventListener !== "function" || typeof current.close !== "function") throw new TypeError("EventSource does not support named events");
            source = current;
            current.onopen = function () {
              if (!alive || source !== current) return;
              sourceOpen = true;
              pollAttempt = 0;
              clearPolling();
              setConnection("live");
            };
            var update = function (event) {
              if (!alive || source !== current) return;
              try {
                var next = JSON.parse(event.data);
                if (next && typeof next.enabled === "boolean" && Object.prototype.hasOwnProperty.call(next, "team")) { failureRef.current = 0; streamEpoch += 1; clearSnapshotFallback(); queueSnapshot(next); }
                else if (next && next.state && typeof next.state.enabled === "boolean") { failureRef.current = 0; streamEpoch += 1; clearSnapshotFallback(); queueSnapshot(next.state); }
                else load(true, streamEpoch).catch(function () {});
              } catch (_) { load(true, streamEpoch).catch(function () {}); }
            };
            current.onmessage = update;
            ["snapshot", "state", "update"].forEach(function (name) { current.addEventListener(name, update); });
            current.onerror = function () {
              if (!alive || source !== current || hidden()) return;
              sourceOpen = false;
              failureRef.current += 1;
              setConnection(failureRef.current >= 2 ? "stale" : "disconnected");
              // Native EventSource keeps reconnecting while visible; sparse jittered polling is only a safety net.
              schedulePolling();
            };
            var expectedStreamEpoch = streamEpoch;
            snapshotFallbackTimer = setTimeout(function () {
              snapshotFallbackTimer = null;
              if (!alive || hidden() || source !== current || streamEpoch !== expectedStreamEpoch) return;
              load(true, expectedStreamEpoch).catch(function () {});
            }, 3000);
          } catch (_) {
            if (current && typeof current.close === "function") current.close();
            if (source === current) source = null;
            schedulePolling();
          }
        }
        function onVisibilityChange() {
          if (hidden()) { closeSource(true); return; }
          flushSnapshot();
          setConnection("disconnected");
          openSource();
          if (!source) load(true, streamEpoch).catch(function () {}).finally(schedulePolling);
        }
        acceptRef.current = queueSnapshot;
        reloadRef.current = function () { return load(false, streamEpoch); };
        if (!hidden()) { openSource(); if (!source) load(false, streamEpoch).catch(function () {}).finally(schedulePolling); }
        if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVisibilityChange);
        return function () {
          alive = false;
          acceptRef.current = function () {};
          closeSource(true);
          if (publishFrame !== null) cancelFrame(publishFrame);
          if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVisibilityChange);
        };
      }, [sessionId, selectedTeamId]);
      return { state: state, setState: function (next) { return acceptRef.current(next); }, error: error, setError: setError, connection: connection, reload: function () { return reloadRef.current(); } };
    }

    function useTaskDetailState(sessionId, selectedTeamId, selectedTaskId) {
      var detailPair = useState(null), detail = detailPair[0], setDetail = detailPair[1];
      var errorPair = useState(""), error = errorPair[0], setError = errorPair[1];
      var connectionPair = useState("disconnected"), connection = connectionPair[0], setConnection = connectionPair[1];
      useEffect(function () {
        if (!sessionId || !selectedTeamId || !selectedTaskId) { setDetail(null); setError(""); setConnection("disconnected"); return; }
        var alive = true, source = null, sourceOpen = false, pollTimer = null, loading = false, hasDetail = false;
        setDetail(null); setError(""); setConnection("disconnected");
        function accept(next) {
          if (!alive || !next || next.unavailable || String(next.taskId || "") !== String(selectedTaskId)) return;
          hasDetail = true; setDetail(next); setError("");
        }
        function schedulePoll() {
          if (!alive || sourceOpen || pollTimer) return;
          pollTimer = setTimeout(function () { pollTimer = null; load(true); }, 4000);
        }
        function load(silent) {
          if (!alive || loading) return;
          loading = true;
          fetchTaskDetail(sessionId, selectedTeamId, selectedTaskId).then(function (next) {
            accept(next);
            if (!sourceOpen) setConnection("polling");
          }).catch(function (err) {
            if (!alive) return;
            if (!silent) setError(errorText(err));
            setConnection(hasDetail ? "stale" : "disconnected");
          }).finally(function () { loading = false; schedulePoll(); });
        }
        if (typeof EventSource === "function") {
          try {
            source = new EventSource(taskDetailEventsUrl(sessionId, selectedTeamId, selectedTaskId));
            var update = function (event) {
              if (!alive) return;
              try {
                var next = JSON.parse(event.data);
                if (next && next.unavailable) { setError("unavailable"); setConnection("stale"); return; }
                accept(next);
              } catch (_) { load(true); }
            };
            source.onopen = function () { if (!alive) return; sourceOpen = true; if (pollTimer) clearTimeout(pollTimer); pollTimer = null; setConnection("live"); };
            source.onmessage = update;
            if (typeof source.addEventListener === "function") source.addEventListener("snapshot", update);
            source.onerror = function () { if (!alive) return; sourceOpen = false; setConnection(hasDetail ? "stale" : "disconnected"); schedulePoll(); };
          } catch (_) { source = null; }
        }
        load(false);
        return function () { alive = false; if (pollTimer) clearTimeout(pollTimer); if (source && typeof source.close === "function") source.close(); };
      }, [sessionId, selectedTeamId, selectedTaskId]);
      return { detail: detail, error: error, connection: connection };
    }

    function projectTaskResponseError(response, input) {
      var body = input && typeof input === "object" && !Array.isArray(input) ? input : {};
      var details = body.error && typeof body.error === "object" && !Array.isArray(body.error) ? body.error : {};
      var fallback = "Project task request failed (HTTP " + response.status + ")";
      var message = typeof details.message === "string" && details.message ? details.message : typeof body.error === "string" && body.error ? body.error : fallback;
      var error = new Error(message);
      error.code = typeof details.code === "string" ? details.code : typeof body.code === "string" ? body.code : "PROJECT_TASK_REQUEST_FAILED";
      error.status = response.status;
      error.nextAction = typeof details.nextAction === "string" ? details.nextAction : typeof body.nextAction === "string" ? body.nextAction : "";
      error.retryable = details.retryable === true;
      return error;
    }

    function projectTaskErrorSummary(error, t) {
      var code = String(error && error.code || "").toUpperCase();
      if (code.indexOf("REVISION") >= 0 || code.indexOf("OCC") >= 0 || code.indexOf("STALE") >= 0) return t("projectTasksChangedError");
      if (code.indexOf("IDEMPOTENCY") >= 0 || code.indexOf("COMMAND_ID") >= 0) return t("projectTasksIntentConflictError");
      if (code.indexOf("FORBIDDEN") >= 0 || code.indexOf("PERMISSION") >= 0 || code.indexOf("UNAUTHORIZED") >= 0 || code.indexOf("ACTOR") >= 0) return t("projectTasksPermissionError");
      if (code.indexOf("BLOCKED") >= 0 || code.indexOf("DEPENDENCY") >= 0 || code.indexOf("REQUIRED") >= 0) return t("projectTasksDependencyError");
      if (code.indexOf("UNAVAILABLE") >= 0 || code.indexOf("NOT_CREATED") >= 0 || code.indexOf("PROJECT_ENTRY") >= 0 || code.indexOf("TASK_CONTEXT") >= 0) return t("projectTasksProjectError");
      return t("projectTasksGenericError");
    }

    function normalizeProjectTasksState(input) {
      var source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
      var rawCapability = source.capability && typeof source.capability === "object" && !Array.isArray(source.capability) ? source.capability : {};
      var capabilityKinds = ["authority", "collaborator", "no-project", "unavailable"], rawMode = rawCapability.mode;
      var capabilityKind = typeof rawCapability.kind === "string" && capabilityKinds.indexOf(rawCapability.kind) >= 0 ? rawCapability.kind : rawMode === "collaborator" ? "collaborator" : "";
      var available = rawCapability.available === true, writable = available && (capabilityKind === "authority" || capabilityKind === "collaborator" && rawCapability.writable === true);
      function taskCommands(value) { return Object.freeze(Array.isArray(value) ? value.filter(function (action, index, all) { return ["claim", "transition"].indexOf(action) >= 0 && all.indexOf(action) === index; }) : []); }
      var capability = Object.freeze({ available: available, writable: writable, canCreate: capabilityKind === "authority" && rawCapability.canCreate === true, kind: capabilityKind, reason: typeof rawCapability.reason === "string" ? rawCapability.reason.slice(0, 120) : "", taskCommands: taskCommands(rawCapability.taskCommands) });
      var allowedStates = ["backlog", "todo", "in_progress", "in_review", "blocked", "done", "canceled"];
      var tasks = Array.isArray(source.tasks) ? source.tasks.slice(0, 500).map(function (task) {
        var item = task && typeof task === "object" && !Array.isArray(task) ? task : {};
        return Object.freeze({ taskRef: typeof item.taskRef === "string" ? item.taskRef.slice(0, 256) : "", title: typeof item.title === "string" ? item.title.slice(0, 500) : "", status: allowedStates.indexOf(item.status) >= 0 ? item.status : "backlog", revision: Number.isSafeInteger(item.revision) && item.revision > 0 ? item.revision : 0, hasAssignee: item.hasAssignee === true, blockedByCount: Number.isSafeInteger(item.blockedByCount) && item.blockedByCount >= 0 ? Math.min(item.blockedByCount, 500) : 0, allowedActions: taskCommands(item.allowedActions), allowedTransitions: Object.freeze(capabilityKind === "authority" && Array.isArray(item.allowedTransitions) ? item.allowedTransitions.filter(function (value, index, values) { return allowedStates.indexOf(value) >= 0 && values.indexOf(value) === index; }).slice(0, 7) : []) });
      }).filter(function (task) { return task.taskRef && task.revision > 0; }) : [];
      return Object.freeze({ available: source.available === true, reason: typeof source.reason === "string" ? source.reason.slice(0, 120) : "", hasMore: source.hasMore === true, capability: capability, tasks: Object.freeze(tasks) });
    }

    function useProjectTasksState() {
      var statePair = useState(null), state = statePair[0], setState = statePair[1];
      var loadingPair = useState(true), loading = loadingPair[0], setLoading = loadingPair[1];
      var errorPair = useState(null), error = errorPair[0], setError = errorPair[1];
      var reloadRef = useRef(function () { return Promise.resolve(); });
      useEffect(function () {
        var alive = true, source = null, refetchTimer = null, refetchPending = false, inFlight = null, requestGeneration = 0;
        function load(silent) {
          if (inFlight) { refetchPending = true; return inFlight; }
          var generation = ++requestGeneration;
          if (!silent) setLoading(true);
          inFlight = fetch("/api/agent-teams/project/tasks/state", { method: "GET", cache: "no-store", credentials: "same-origin", headers: { Accept: "application/json" } }).then(function (response) {
            return response.json().catch(function () { return {}; }).then(function (body) { if (!response.ok) throw projectTaskResponseError(response, body); return body; });
          }).then(function (next) { var safe = normalizeProjectTasksState(next); if (alive && generation === requestGeneration) { setState(safe); setError(null); } return safe; }).catch(function (cause) { if (alive && generation === requestGeneration && !silent) setError(cause); throw cause; }).finally(function () { if (generation === requestGeneration) { inFlight = null; if (alive) setLoading(false); if (alive && refetchPending) { refetchPending = false; load(true).catch(function () {}); } } });
          return inFlight;
        }
        reloadRef.current = load;
        load(false).catch(function () {});
        if (typeof EventSource === "function") {
          try {
            source = new EventSource("/api/agent-teams/project/tasks/stream");
            var refetch = function () {
              if (!alive || refetchTimer !== null) return;
              refetchTimer = setTimeout(function () { refetchTimer = null; if (!alive) return; if (inFlight) { refetchPending = true; return; } reloadRef.current(true).catch(function () {}); }, 80);
            };
            source.addEventListener("reset", refetch);
            source.addEventListener("capability", refetch);
            source.addEventListener("task", refetch);
          } catch (_) { if (source && typeof source.close === "function") source.close(); source = null; }
        }
        return function () {
          alive = false;
          requestGeneration += 1;
          reloadRef.current = function () { return Promise.resolve(); };
          if (refetchTimer !== null) clearTimeout(refetchTimer);
          if (source && typeof source.close === "function") source.close();
        };
      }, []);
      return { state: state, loading: loading, error: error, reload: function () { return reloadRef.current(false); } };
    }

    function newProjectTaskCommandId() {
      if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return "project-task-" + crypto.randomUUID();
      return "project-task-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 12);
    }

    function postProjectTaskAction(body) {
      if (!body || !Object.keys(body).every(function (key) { return ["commandId", "type", "taskRef", "expectedRevision", "payload"].indexOf(key) >= 0; })) throw new TypeError("unsupported project task action fields");
      var encoded = JSON.stringify(body);
      function request() {
        return fetch("/api/agent-teams/project/tasks/action", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", Accept: "application/json", "x-harness-agent-teams": "1" }, body: encoded }).then(function (response) {
          return response.json().catch(function () { return {}; }).then(function (result) { if (!response.ok) throw projectTaskResponseError(response, result); return result; });
        });
      }
      return request().catch(function (error) { if (error && error.status) throw error; return request(); });
    }

    function Button(props) {
      return h("button", { type: props.type || "button", className: "dat-btn" + (props.primary ? " dat-primary" : "") + (props.danger ? " dat-danger" : "") + (props.small ? " dat-small" : ""), disabled: props.disabled, onClick: props.onClick, "aria-label": props.ariaLabel, "aria-pressed": props.ariaPressed, ref: props.buttonRef }, props.children);
    }
    function trapInspectorTab(event, element) {
      if (!event || event.key !== "Tab" || !element || typeof window === "undefined" || typeof window.getComputedStyle !== "function") return;
      var style = window.getComputedStyle(element);
      if (!style || style.position !== "fixed" || typeof element.querySelectorAll !== "function") return;
      var nodes = Array.prototype.slice.call(element.querySelectorAll("a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex='-1'])")).filter(function (node) {
        var nodeStyle = window.getComputedStyle(node);
        var hiddenAncestor = typeof node.closest === "function" && node.closest("[hidden],[aria-hidden='true']");
        return !node.hidden && !hiddenAncestor && nodeStyle.display !== "none" && nodeStyle.visibility !== "hidden";
      });
      if (!nodes.length) { event.preventDefault(); element.focus(); return; }
      var first = nodes[0], last = nodes[nodes.length - 1], active = element.ownerDocument && element.ownerDocument.activeElement;
      if (typeof element.contains === "function" && !element.contains(active)) { event.preventDefault(); (event.shiftKey ? last : first).focus(); return; }
      if (event.shiftKey && (active === first || active === element)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && active === last) { event.preventDefault(); first.focus(); }
    }
    function useInspectorModal(elementRef, open) {
      var modalPair = useState(false), modal = modalPair[0], setModal = modalPair[1];
      useEffect(function () {
        if (!open) { setModal(false); return; }
        var element = elementRef && elementRef.current;
        if (!element || typeof window === "undefined" || typeof window.getComputedStyle !== "function") return;
        var frame = null;
        function update() {
          frame = null;
          var next = !!elementRef.current && window.getComputedStyle(elementRef.current).position === "fixed";
          setModal(function (current) { return current === next ? current : next; });
        }
        function schedule() {
          if (frame !== null) return;
          frame = typeof requestAnimationFrame === "function" ? requestAnimationFrame(update) : setTimeout(update, 16);
        }
        update();
        var observer = typeof ResizeObserver === "function" ? new ResizeObserver(schedule) : null;
        if (observer) { observer.observe(element); if (element.parentElement) observer.observe(element.parentElement); }
        window.addEventListener("resize", schedule);
        return function () {
          observer && observer.disconnect();
          window.removeEventListener("resize", schedule);
          if (frame !== null) { if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(frame); else clearTimeout(frame); }
        };
      }, [elementRef, open]);
      return modal;
    }
    function arrayText(value) { return (Array.isArray(value) ? value : value ? [value] : []).map(function (item) { if (item == null) return ""; if (typeof item !== "object") return String(item); return item.title || item.name || item.teamName || item.id || item.taskId || ""; }).filter(Boolean).join(", "); }
    function dependencySourceText(t, value) { return (Array.isArray(value) ? value : value ? [value] : []).map(function (item) { if (item == null) return ""; if (typeof item !== "object") return String(item); return (item.teamName || item.teamId || t("unknown")) + (item.teamStatus ? " · " + statusLabel(t, item.teamStatus) : ""); }).filter(Boolean).join(", "); }
    function memberId(member) { return member.id || member.memberId || member.sessionId || member.childSessionId || member.name; }
    function memberSession(member) { return member.childSessionId || member.sessionId || member.id; }
    function simpleMemberName(member, isLead, t) {
      if (isLead) return t("lead");
      var original = String(member.displayName || member.name || memberSession(member) || t("unknown"));
      var simplified = isChinese() ? original.replace(/^(?:宿主|用户)/u, "").replace(/(?:负责人|实现者|执行者|协调器|作者|子代理)$/u, "").trim() : original.replace(/\s+(?:lead|implementer|executor|coordinator|author|subagent|worker)$/iu, "").trim();
      var display = simplified || original, codePoints = Array.from(display);
      return codePoints.length > 24 ? codePoints.slice(0, 23).join("") + "…" : display;
    }
    function memberModelText(member, t) {
      if (!member) return "";
      var parts = [];
      if (member.model) parts.push(member.provider ? String(member.provider) + " / " + String(member.model) : String(member.model));
      if (member.modelTier === "main") parts.push(t("mainModel"));
      else if (member.modelTier === "subagent") parts.push(t("subagentModel"));
      if (member.inheritsMain) parts.push(t("inheritsMain"));
      return parts.join(" · ");
    }
    function taskId(task) { return task && (task.id || task.taskId || task.title); }
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

    function fetchProjectEntryStatus() {
      return fetch("/api/agent-teams/project/status", { method: "GET", credentials: "same-origin", headers: { Accept: "application/json" } }).then(function (response) {
        return response.json().catch(function () { return {}; }).then(function (data) { if (!response.ok) { var error = new Error(data.error || ("HTTP " + response.status)); error.code = data.code; throw error; } return data.status || {}; });
      });
    }
    function postProjectEntryAction(action, payload) {
      return fetch("/api/agent-teams/project/action", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", Accept: "application/json", "x-harness-agent-teams": "1" }, body: JSON.stringify({ action: action, payload: payload || {} }) }).then(function (response) {
        return response.json().catch(function () { return {}; }).then(function (data) { if (!response.ok) { var error = new Error(data.error || ("HTTP " + response.status)); error.code = data.code; throw error; } return data; });
      });
    }
    function ProjectTeamEntry(props) {
      var t = props.t;
      var statusPair = useState(null), status = statusPair[0], setStatus = statusPair[1];
      var errorPair = useState(""), error = errorPair[0], setError = errorPair[1];
      var busyPair = useState(""), busy = busyPair[0], setBusy = busyPair[1];
      var projectNamePair = useState(""), projectName = projectNamePair[0], setProjectName = projectNamePair[1];
      var ownerPair = useState(""), ownerName = ownerPair[0], setOwnerName = ownerPair[1];
      var inviteNamePair = useState(""), inviteName = inviteNamePair[0], setInviteName = inviteNamePair[1];
      var inviteRolePair = useState("contributor"), inviteRole = inviteRolePair[0], setInviteRole = inviteRolePair[1];
      var invitePair = useState(""), inviteCode = invitePair[0], setInviteCode = invitePair[1];
      var relayPair = useState(""), relayUrl = relayPair[0], setRelayUrl = relayPair[1];
      var copiedPair = useState(""), copied = copiedPair[0], setCopied = copiedPair[1];
      var joinInvitePair = useState(""), joinInvite = joinInvitePair[0], setJoinInvite = joinInvitePair[1];
      var joinNamePair = useState(""), joinName = joinNamePair[0], setJoinName = joinNamePair[1];
      var joinRequestPair = useState(""), joinRequest = joinRequestPair[0], setJoinRequest = joinRequestPair[1];
      var approvalRequestPair = useState(""), approvalRequest = approvalRequestPair[0], setApprovalRequest = approvalRequestPair[1];
      var joinResponsePair = useState(""), joinResponse = joinResponsePair[0], setJoinResponse = joinResponsePair[1];
      var lanHostPair = useState(""), lanHost = lanHostPair[0], setLanHost = lanHostPair[1];
      var lanPortPair = useState(""), lanPort = lanPortPair[0], setLanPort = lanPortPair[1];
      function applyStatus(next) {
        setStatus(next);
        if (next.relay && next.relay.relayUrl) setRelayUrl(next.relay.relayUrl);
        if (next.lan && next.lan.endpoint) { setLanHost(String(next.lan.endpoint.host || "")); setLanPort(String(next.lan.endpoint.port || "")); }
      }
      function reload() {
        setError("");
        return fetchProjectEntryStatus().then(applyStatus).catch(function (cause) { setError(errorText(cause)); });
      }
      useEffect(function () { var alive = true; fetchProjectEntryStatus().then(function (next) { if (alive) applyStatus(next); }).catch(function (cause) { if (alive) setError(errorText(cause)); }); return function () { alive = false; }; }, []);
      function run(action, payload, receive) {
        setBusy(action); setError(""); setCopied("");
        return postProjectEntryAction(action, payload).then(function (data) { if (data.status) applyStatus(data.status); if (typeof receive === "function") receive(data.result || {}); return data; }).catch(function (cause) { setError(errorText(cause)); }).finally(function () { setBusy(""); });
      }
      function copy(value, key) {
        if (!value || typeof navigator === "undefined" || !navigator.clipboard || typeof navigator.clipboard.writeText !== "function") return;
        navigator.clipboard.writeText(value).then(function () { setCopied(key); }, function (cause) { setError(errorText(cause)); });
      }
      var project = status && status.project, lan = status && status.lan || {}, relay = status && status.relay || {}, pairing = status && status.pairing || {};
      var routeGrid = h("div", { className: "dat-project-entry-grid" },
        h("article", { className: "dat-project-route" }, h("strong", null, t("projectLocalMode")), h("div", { className: "dat-meta" }, t("projectLocalModeHint"))),
        h("article", { className: "dat-project-route" }, h("strong", null, t("projectLanMode")), h("div", { className: "dat-meta" }, lan.listening || lan.connected ? t("projectLanConnected") : (lan.implemented ? t("projectLanReady") : t("projectLanWaiting"))), h("div", { className: "dat-note", style: { marginTop: 5 } }, t("projectLanPending"))),
        h("article", { className: "dat-project-route" }, h("strong", null, t("projectRemoteMode")), h("div", { className: "dat-meta" }, t("projectRemoteHint")), h("div", { className: "dat-note", style: { marginTop: 5 } }, relay.connected ? t("projectRemoteConnected") : t("projectRemoteDisconnected")))
      );
      return h("section", { className: "dat-panel dat-project-entry", "aria-labelledby": "dat-project-entry-title" },
        h("div", { className: "dat-project-entry-head" }, h("div", null, h("h2", { id: "dat-project-entry-title" }, t("projectEntryTitle")), h("p", { className: "dat-meta", style: { margin: "5px 0 0" } }, t("projectEntryIntro"))), status ? h("span", { className: "dat-badge" }, project ? t("projectPreviewBadge") : t("projectNotCreated")) : null),
        routeGrid,
        !status ? h("div", { className: "dat-note", role: "status", style: { marginTop: 10 } }, t("loading")) : null,
        status && !project ? h(React.Fragment, null,
          h("div", { className: "dat-project-form" },
            h("label", null, h("span", { className: "dat-label" }, t("projectName")), h("input", { className: "dat-field", value: projectName, maxLength: 200, placeholder: t("projectNamePlaceholder"), onChange: function (event) { setProjectName(event.target.value); } })),
            h("label", null, h("span", { className: "dat-label" }, t("projectOwner")), h("input", { className: "dat-field", value: ownerName, maxLength: 120, placeholder: t("projectOwnerPlaceholder"), onChange: function (event) { setOwnerName(event.target.value); } })),
            h("div", { className: "dat-actions dat-project-span" }, h(Button, { primary: true, disabled: !!busy || !projectName.trim() || !ownerName.trim(), onClick: function () { run("create-project", { projectName: projectName.trim(), displayName: ownerName.trim() }); } }, busy === "create-project" ? t("projectCreating") : t("projectCreate")))
          ),
          h("details", { open: pairing.pending || undefined }, h("summary", null, t("projectJoinExisting")),
            h("p", { className: "dat-note" }, pairing.pending ? t("projectPairingPending") : t("projectJoinIntro")),
            pairing.pending ? h("div", { className: "dat-project-form" },
              h("label", { className: "dat-project-span" }, h("span", { className: "dat-label" }, t("projectJoinResponse")), h("textarea", { className: "dat-project-code", value: joinResponse, onChange: function (event) { setJoinResponse(event.target.value); } })),
              h("div", { className: "dat-actions dat-project-span" }, h(Button, { primary: true, disabled: !!busy || !joinResponse.trim(), onClick: function () { run("complete-join", { joinResponse: joinResponse.trim() }); } }, t("projectCompleteJoin")))
            ) : h("div", { className: "dat-project-form" },
              h("label", null, h("span", { className: "dat-label" }, t("projectOwner")), h("input", { className: "dat-field", value: joinName, maxLength: 120, placeholder: t("projectInviteNamePlaceholder"), onChange: function (event) { setJoinName(event.target.value); } })),
              h("label", { className: "dat-project-span" }, h("span", { className: "dat-label" }, t("projectJoinInvite")), h("textarea", { className: "dat-project-code", value: joinInvite, onChange: function (event) { setJoinInvite(event.target.value); } })),
              h("div", { className: "dat-actions dat-project-span" }, h(Button, { primary: true, disabled: !!busy || !joinInvite.trim() || !joinName.trim(), onClick: function () { run("prepare-join", { inviteCode: joinInvite.trim(), displayName: joinName.trim() }, function (result) { setJoinRequest(result.joinRequest || ""); }); } }, t("projectPrepareJoin"))),
              joinRequest ? h("div", { className: "dat-project-span" }, h("label", { className: "dat-label" }, t("projectJoinRequest")), h("textarea", { className: "dat-project-code", readOnly: true, value: joinRequest }), h("div", { className: "dat-actions" }, h(Button, { small: true, onClick: function () { copy(joinRequest, "join-request"); } }, copied === "join-request" ? t("projectCopied") : t("projectCopy")))) : null
            )
          )
        ) : null,
        project ? h(React.Fragment, null,
          h("div", { className: "dat-project-status" }, project.memberCountKnown === false ? null : h("span", { className: "dat-badge" }, t("projectMembers", { count: project.memberCount || 0 })), h("span", { className: "dat-badge" }, t("projectRevision", { value: project.revision || 0 }))),
          h("div", { className: "dat-meta", style: { marginTop: 8 } }, t("projectRef"), "：", h("span", { className: "dat-project-ref" }, project.projectRef), " ", h(Button, { small: true, onClick: function () { copy(project.projectRef, "project"); } }, copied === "project" ? t("projectCopied") : t("projectCopy"))),
          h("details", null, h("summary", null, t("projectAdvanced")),
            h("div", { className: "dat-project-entry-grid" },
              h("article", { className: "dat-project-route" },
                h("strong", null, t("projectLanMode")),
                h("div", { className: "dat-meta" }, lan.listening ? t("live") : (lan.connected ? t("projectLanConnected") : t("projectLanReady"))),
                lan.endpoint ? h("div", { className: "dat-note", style: { marginTop: 5 } }, t("projectLanEndpoint", { host: lan.endpoint.host, port: lan.endpoint.port })) : null,
                h("div", { className: "dat-note", style: { marginTop: 5 } }, t("projectLanPending")),
                project.role !== "owner" ? h("div", { style: { display: "grid", gridTemplateColumns: "minmax(0,1fr) 96px", gap: 8, marginTop: 9 } },
                  h("label", null, h("span", { className: "dat-label" }, t("projectLanHost")), h("input", { className: "dat-field", value: lanHost, inputMode: "decimal", maxLength: 128, onChange: function (event) { setLanHost(event.target.value); } })),
                  h("label", null, h("span", { className: "dat-label" }, t("projectLanPort")), h("input", { className: "dat-field", value: lanPort, inputMode: "numeric", maxLength: 5, onChange: function (event) { setLanPort(event.target.value.replace(/\D/gu, "").slice(0, 5)); } }))
                ) : null,
                h("div", { className: "dat-actions" },
                  project.role === "owner"
                    ? (lan.listening
                        ? h(Button, { small: true, disabled: !!busy, onClick: function () { run("stop-lan", {}); } }, t("projectStopLan"))
                        : h(Button, { small: true, disabled: !!busy, onClick: function () { run("start-lan", {}); } }, t("projectStartLan")))
                    : h(Button, { small: true, disabled: !!busy || !lanHost.trim() || !lanPort.trim() || lan.connected, onClick: function () { run("connect-lan", { host: lanHost.trim(), port: Number(lanPort) }); } }, lan.connected ? t("projectLanConnected") : t("projectConnectLan")),
                  h(Button, { small: true, disabled: !!busy, onClick: function () { run("lan-status", {}); } }, t("projectRefresh"))
                )
              ),
              h("article", { className: "dat-project-route", style: { gridColumn: "span 2" } }, h("strong", null, t("projectRemoteMode")), h("div", { className: "dat-meta" }, relay.connected ? t("projectRemoteConnected") : t("projectRemoteDisconnected")), h("div", { className: "dat-note", style: { marginTop: 5 } }, relay.channelReady ? t("projectChannelReady") : t("projectChannelPending")))
            ),
            h("div", { className: "dat-project-form" },
              project.role === "owner" ? h(React.Fragment, null,
                h("label", null, h("span", { className: "dat-label" }, t("projectInviteName")), h("input", { className: "dat-field", value: inviteName, maxLength: 120, placeholder: t("projectInviteNamePlaceholder"), onChange: function (event) { setInviteName(event.target.value); } })),
                h("label", null, h("span", { className: "dat-label" }, t("projectInviteRole")), h("select", { className: "dat-field", value: inviteRole, onChange: function (event) { setInviteRole(event.target.value); } }, ["maintainer", "contributor", "reviewer", "observer"].map(function (role) { return h("option", { key: role, value: role }, t(role)); }))),
                h("div", { className: "dat-actions dat-project-span" }, h(Button, { primary: true, disabled: !!busy || !inviteName.trim(), onClick: function () { run("create-invite", { displayName: inviteName.trim(), role: inviteRole }, function (result) { setInviteCode(result.inviteCode || ""); }); } }, t("projectCreateInvite"))),
                inviteCode ? h("div", { className: "dat-project-span" }, h("label", { className: "dat-label", htmlFor: "dat-project-invite" }, t("projectInviteCode")), h("textarea", { id: "dat-project-invite", className: "dat-project-code", readOnly: true, value: inviteCode }), h("div", { className: "dat-actions" }, h(Button, { small: true, onClick: function () { copy(inviteCode, "invite"); } }, copied === "invite" ? t("projectCopied") : t("projectCopy")))) : null,
                h("label", { className: "dat-project-span" }, h("span", { className: "dat-label" }, t("projectApprovalRequest")), h("textarea", { className: "dat-project-code", value: approvalRequest, onChange: function (event) { setApprovalRequest(event.target.value); } })),
                h("div", { className: "dat-actions dat-project-span" }, h(Button, { small: true, disabled: !!busy || !approvalRequest.trim(), onClick: function () { run("approve-join", { joinRequest: approvalRequest.trim() }, function (result) { setJoinResponse(result.joinResponse || ""); }); } }, t("projectApproveJoin"))),
                joinResponse ? h("div", { className: "dat-project-span" }, h("label", { className: "dat-label" }, t("projectJoinResponse")), h("textarea", { className: "dat-project-code", readOnly: true, value: joinResponse }), h("div", { className: "dat-actions" }, h(Button, { small: true, onClick: function () { copy(joinResponse, "join-response"); } }, copied === "join-response" ? t("projectCopied") : t("projectCopy")))) : null
              ) : h(React.Fragment, null, h("div", { className: "dat-note dat-project-span" }, t("projectPairingReady")), h("div", { className: "dat-note dat-project-span" }, t("projectRelayManualHint"))),
              h("label", { className: "dat-project-span" }, h("span", { className: "dat-label" }, t("projectRelayUrl")), h("input", { className: "dat-field", inputMode: "url", value: relayUrl, maxLength: 2048, placeholder: t("projectRelayPlaceholder"), onChange: function (event) { setRelayUrl(event.target.value); } })),
              h("div", { className: "dat-actions dat-project-span" }, h(Button, { small: true, disabled: !!busy || !relayUrl.trim(), onClick: function () { run("set-relay", { relayUrl: relayUrl.trim() }); } }, t("projectSaveRelay")), relay.connected ? h(Button, { small: true, disabled: !!busy, onClick: function () { run("disconnect-remote", {}); } }, t("projectDisconnectRemote")) : h(Button, { small: true, disabled: !!busy || !relay.enabled || !relay.channelReady, onClick: function () { run("connect-remote", { role: relay.role || (project.role === "owner" ? "authority" : "collaborator") }); } }, t("projectConnectRemote")))
            ),
            h("p", { className: "dat-note" }, t("projectHypoMux"))
          )
        ) : null,
        error ? h("div", { className: "dat-error", role: "alert" }, t("projectUnavailable", { error: error }), " ", h(Button, { small: true, onClick: reload }, t("retry"))) : null
      );
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
          ? "请根据以下目标判断是否值得组建团队：" + objective.trim() + "。" + (selected.id === "custom" ? "请完全根据目标自行规划。" : "以“" + selected.title + "”作为协作方向。") + "如果单人即可完成，请直接完成且不要组队；如果确实有至少两个可独立并行的工作流，请先建立可追踪任务、先后关系和互不冲突的文件范围，再只添加必要成员。成员使用“界面、测试、安全、文档”这类简短职责名；负责人承担最终交付。优先使用成本较低的成员模型，仅在复杂或高风险工作中使用主模型。目标很大时，只有在边界清楚且确有并行收益时才创建由同一负责人协调的其他团队。不要让用户设计团队结构，也不要为了凑人数创建成员。"
          : "Decide whether this objective benefits from a team: " + objective.trim() + ". " + (selected.id === "custom" ? "Plan entirely from the objective. " : "Use “" + selected.title + "” as the collaboration direction. ") + "If one agent can complete it well, work solo and do not create a team. If at least two sustained workstreams can proceed independently, create tracked tasks, prerequisites, and non-conflicting file boundaries first, then add only the members needed. Use short duty names such as UI, Test, Security, and Docs, and keep the lead responsible for final delivery. Prefer the lower-cost member model, using the main model only for complex or high-risk work. Create another team under the same lead only when it has a clear boundary and meaningful parallel value. Do not ask the user to design the team structure or add members just to fill seats.";
        props.setDraft(prompt, { creation: true });
      }
      return h("section", { className: "dat-panel dat-team-mode", "aria-labelledby": "dat-first-team" },
        h("div", { className: "dat-team-mode-bar" },
          h("div", { className: "dat-team-mode-copy" }, h("div", { className: "dat-team-mode-title" }, h("span", { className: "dat-dot", "aria-hidden": "true" }), h("h2", { id: "dat-first-team" }, t("noTeam"))), h("p", null, t("wizardIntro"))),
          h("div", { className: "dat-team-mode-actions" },
            typeof props.setView === "function" ? h(Button, { primary: true, small: true, onClick: function () { props.setView("chat"); } }, t("backToChat")) : null,
            h("label", { className: "dat-team-mode-switch", title: t("disableSafeHint") }, h("span", null, t("settingsEnabled")), h("input", { type: "checkbox", role: "switch", checked: true, disabled: props.busy, "aria-label": t("settingsEnabled"), onChange: function (event) { if (!event.target.checked) props.disable(); } }))
          )
        ),
        h("details", { className: "dat-onboarding-details" },
          h("summary", null, t("chooseTemplate")),
          h("div", { className: "dat-onboarding-fields" },
            h("div", { className: "dat-templates", role: "group", "aria-label": t("chooseTemplate") }, templates.map(function (item) {
              return h("button", { key: item.id, type: "button", className: "dat-template", "aria-pressed": template === item.id, onClick: function () { setTemplate(item.id); } }, h("strong", null, item.title), h("span", null, item.body));
            })),
            h("label", { className: "dat-label", htmlFor: "dat-objective" }, t("defineObjective")),
            h("textarea", { id: "dat-objective", className: "dat-field", rows: 3, value: objective, placeholder: t("objectivePlaceholder"), onChange: function (event) { setObjective(event.target.value); } }),
            h("div", { className: "dat-actions" }, h(Button, { primary: true, disabled: !objective.trim(), onClick: prepare }, t("prepare")), h("span", { className: "dat-note" }, t("draftOnly")))
          )
        )
      );
    }

    function visibleTaskResult(task) {
      var result = task && task.result;
      return result && typeof result === "object" && typeof result.text === "string" && result.text.trim() ? result : null;
    }
    function taskResultPreviewText(result, limit) {
      var text = result && result.text || "";
      var max = Number.isFinite(limit) ? limit : 320;
      return text.length > max ? text.slice(0, max).trimEnd() + "…" : text;
    }
    function taskResultLabel(t, task, preview) {
      if (taskResponsibilityProjection(task).legacy) return preview ? t("legacyResultPreview") : t("legacyResult");
      return preview ? t("taskResultPreview") : t("taskResult");
    }
    function taskResponsibilityProjection(task) {
      task = task && typeof task === "object" ? task : {};
      var submission = task.submission && typeof task.submission === "object" ? task.submission : null;
      var acceptance = task.acceptance && typeof task.acceptance === "object" ? task.acceptance : null;
      var result = visibleTaskResult(task), state = normalizeState(task.status || task.state || "pending");
      var assignedId = task.assigneeSessionId || task.assigneeId || task.assignee || task.memberId || "";
      var source = String(submission && submission.source || "").toLowerCase(), legacy = source === "legacy_migration";
      var executorId = legacy ? "" : submission && submission.submittedBy || result && result.reportedBy || "";
      var takeover = !legacy && !!(submission && (source === "lead_takeover" || source === "lead_completion" || source === "forced_takeover" || executorId && assignedId && String(executorId) !== String(assignedId)));
      var deliveryKind = legacy ? "legacy" : submission ? "submitted" : result ? "legacy" : state === "completed" ? "missing_completed" : "missing";
      var acceptanceKind = legacy ? "legacy" : acceptance ? "accepted" : submission ? "pending" : state === "completed" ? "missing_completed" : "not_applicable";
      var releaseHistory = Array.isArray(task.interruptionHistory) ? task.interruptionHistory.filter(function (entry) { return entry && entry.kind === "released"; }) : [];
      var latestRelease = releaseHistory.length ? releaseHistory[releaseHistory.length - 1] : null;
      var release = task.releasedAt || task.releaseReason ? { at: task.releasedAt || "", reason: task.releaseReason || "" } : latestRelease ? { at: latestRelease.at || "", reason: "" } : null;
      var cancellation = task.cancelledAt || task.cancellationReason ? { at: task.cancelledAt || "", reason: task.cancellationReason || "" } : null;
      return { assignedId: assignedId, executorId: executorId, submission: submission, acceptance: acceptance, result: result, source: source, legacy: legacy, takeover: takeover, deliveryKind: deliveryKind, acceptanceKind: acceptanceKind, release: release, cancellation: cancellation, cancelled: state === "cancelled" };
    }
    function responsibilityMember(members, id) {
      return (Array.isArray(members) ? members : []).filter(function (member) { return String(memberSession(member)) === String(id || "") || String(memberId(member)) === String(id || ""); })[0] || null;
    }
    function responsibilityName(members, id, leadSessionId, t, fallback) {
      var member = responsibilityMember(members, id);
      return member ? simpleMemberName(member, member.isLead || member.kind === "lead" || String(memberSession(member)) === String(leadSessionId || ""), t) : fallback;
    }
    function deliveryLabel(t, kind) { return t(kind === "submitted" ? "deliverySubmitted" : kind === "legacy" ? "deliveryLegacy" : kind === "missing_completed" ? "deliveryMissingCompleted" : "deliveryMissing"); }
    function acceptanceLabel(t, kind) { return t(kind === "accepted" ? "acceptanceAccepted" : kind === "legacy" ? "acceptanceLegacy" : kind === "pending" ? "acceptancePending" : kind === "missing_completed" ? "acceptanceMissingCompleted" : "acceptanceNotApplicable"); }
    function submissionSourceLabel(t, truth) {
      if (truth.legacy) return t("submissionLegacy");
      if (truth.takeover) return t("submissionLeadTakeover");
      if (truth.source === "explicit_complete") return t("submissionExplicit");
      if (truth.source === "forced" || truth.source === "force_shutdown" || truth.source === "forced_reconciliation") return t("submissionForced");
      return t("submissionUnknown");
    }
    function ResponsibilityPanel(props) {
      var task = props.task || {}, t = props.t, truth = taskResponsibilityProjection(task), members = props.members || [];
      var assignedName = responsibilityName(members, truth.assignedId, props.leadSessionId, t, t("unassigned"));
      var executorName = truth.executorId ? responsibilityName(members, truth.executorId, props.leadSessionId, t, t("actualExecutorUnknown")) : t(truth.legacy ? "actualExecutorLegacy" : "actualExecutorUnknown");
      var acceptedBy = !truth.legacy && truth.acceptance && truth.acceptance.acceptedBy ? responsibilityName(members, truth.acceptance.acceptedBy, props.leadSessionId, t, t("unknown")) : "";
      var currentState = normalizeState(task.status || task.state || "pending"), releaseNeedsAttention = !!truth.release && currentState === "pending" && !truth.assignedId;
      var state = truth.legacy ? "legacy" : truth.cancelled || releaseNeedsAttention || truth.deliveryKind === "missing_completed" || truth.acceptanceKind === "missing_completed" ? "attention" : truth.acceptanceKind === "accepted" ? "accepted" : "pending";
      return h("section", { className: "dat-responsibility", "data-status": state, "aria-labelledby": props.labelId || "dat-responsibility-title" },
        h("div", { className: "dat-responsibility-head" }, h("div", null, h("h3", { id: props.labelId || "dat-responsibility-title" }, t("responsibilityTitle")), h("p", { className: "dat-note" }, t("responsibilityHint"))), h("span", { className: "dat-status-chip", "data-status": state }, truth.cancelled ? t("cancelled") : acceptanceLabel(t, truth.acceptanceKind))),
        h("dl", { className: "dat-responsibility-chain" },
          h("div", null, h("dt", null, t("assignedMember")), h("dd", null, assignedName)),
          h("div", null, h("dt", null, t("actualExecutor")), h("dd", null, executorName)),
          h("div", null, h("dt", null, t("deliveryState")), h("dd", null, deliveryLabel(t, truth.deliveryKind))),
          h("div", null, h("dt", null, t("acceptanceState")), h("dd", null, acceptanceLabel(t, truth.acceptanceKind))),
          acceptedBy ? h("div", null, h("dt", null, t("acceptedBy")), h("dd", null, acceptedBy)) : null
        ),
        truth.submission ? h("p", { className: "dat-note dat-responsibility-source" }, t("submissionSource", { value: submissionSourceLabel(t, truth) }), truth.submission.submittedAt ? " · " + formatTime(truth.submission.submittedAt) : "") : null,
        truth.legacy ? h("div", { className: "dat-legacy-record", role: "note", "data-provenance": "legacy_migration" }, h("strong", null, t("legacyRecordTitle")), h("span", null, t("legacyRecordHint"))) : null,
        truth.release || truth.cancellation ? h("div", { className: "dat-responsibility-events", role: "note" },
          h("h4", null, t("responsibilityFacts")),
          truth.release ? h("article", { className: "dat-responsibility-event", "data-kind": "released" }, h("strong", null, t("taskReleased")), h("span", null, t("releaseReasonLabel") + ": " + (truth.release.reason || t("reasonUnavailable"))), truth.release.at ? h("time", { dateTime: String(truth.release.at) }, t("releasedAtLabel") + ": " + formatTime(truth.release.at)) : null) : null,
          truth.cancellation ? h("article", { className: "dat-responsibility-event", "data-kind": "cancelled" }, h("strong", null, t("taskCancellation")), h("span", null, t("cancellationReasonLabel") + ": " + (truth.cancellation.reason || t("reasonUnavailable"))), truth.cancellation.at ? h("time", { dateTime: String(truth.cancellation.at) }, t("cancelledAtLabel") + ": " + formatTime(truth.cancellation.at)) : null) : null
        ) : null,
        truth.cancelled ? h("p", { className: "dat-responsibility-alert", role: "note" }, t("taskCancelled")) : null
      );
    }
    function teamExplicitlyEmpty(team) {
      if (!team || typeof team !== "object") return false;
      if (Number.isFinite(team.taskCount)) return team.taskCount === 0;
      return Array.isArray(team.tasks) && team.tasks.length === 0;
    }
    function teamClosureProjection(team) {
      var closure = team && team.closure && typeof team.closure === "object" ? team.closure : null;
      var outcome = String(closure && closure.outcome || "unknown").toLowerCase();
      if (["succeeded", "cancelled", "forced", "failed"].indexOf(outcome) < 0 || outcome === "succeeded" && teamExplicitlyEmpty(team)) outcome = "unknown";
      return { closure: closure, outcome: outcome, cancelledCount: closure && Array.isArray(closure.cancelledTaskIds) ? closure.cancelledTaskIds.length : 0, failureCount: closure && Array.isArray(closure.failures) ? closure.failures.length : 0 };
    }
    function TeamClosureBanner(props) {
      var t = props.t, truth = teamClosureProjection(props.team), emptySuccess = teamExplicitlyEmpty(props.team) && String(props.team && props.team.closure && props.team.closure.outcome || "").toLowerCase() === "succeeded";
      var keys = { succeeded: "closureSucceeded", cancelled: "closureCancelled", forced: "closureForced", failed: "closureFailed", unknown: "closureUnknown" }, bodyKeys = { succeeded: "closureSucceededBody", cancelled: "closureCancelledBody", forced: "closureForcedBody", failed: "closureFailedBody", unknown: emptySuccess ? "closureEmptyBody" : "closureUnknownBody" };
      return h("section", { className: "dat-panel dat-closed dat-closure", "data-outcome": truth.outcome, role: "status", "aria-labelledby": "dat-closure-title" },
        h("div", { className: "dat-closure-head" }, h("div", null, h("span", { className: "dat-note" }, t("closureOutcome")), h("strong", { id: "dat-closure-title" }, t(keys[truth.outcome]))), truth.closure && truth.closure.closedAt ? h("time", { dateTime: String(truth.closure.closedAt) }, formatTime(truth.closure.closedAt)) : null),
        h("p", { className: "dat-meta" }, t(bodyKeys[truth.outcome])),
        truth.cancelledCount || truth.failureCount ? h("div", { className: "dat-row" }, truth.cancelledCount ? h("span", { className: "dat-badge" }, t("closureCancelledCount", { count: truth.cancelledCount })) : null, truth.failureCount ? h("span", { className: "dat-badge" }, t("closureFailureCount", { count: truth.failureCount })) : null) : null,
        props.children || null
      );
    }

    function TaskCard(props) {
      var task = props.task, t = props.t, id = taskId(task), truth = taskResponsibilityProjection(task), assigned = truth.assignedId;
      var memberText = typeof props.memberName === "function" ? props.memberName(assigned) : "";
      var executorText = truth.executorId && typeof props.memberName === "function" ? props.memberName(truth.executorId) : "";
      var modelText = typeof props.memberModel === "function" ? props.memberModel(assigned) : "";
      var className = "dat-card" + (props.compact ? " dat-task-row" : "") + (props.onOpen ? " dat-task-open" : "");
      var label = (task.title || task.name || t("taskFallback", { id: id })) + " · " + statusLabel(t, task.status || task.state || "pending");
      var body = [
        h("div", { className: "dat-card-title" }, task.title || task.name || t("taskFallback", { id: id })),
        task.description ? h("div", { className: "dat-meta", style: { marginTop: 4 } }, task.description) : null,
        visibleTaskResult(task) ? h("div", { className: "dat-task-result-preview", style: { marginTop: 8 }, "data-provenance": truth.legacy ? "legacy_migration" : "current" }, h("strong", null, taskResultLabel(t, task, true)), h("span", null, taskResultPreviewText(visibleTaskResult(task), props.compact ? 220 : 360))) : null,
        h("div", { className: "dat-meta", style: { marginTop: 6 } }, "#" + id + " · " + t("assignedMember") + ": " + (memberText || t("unassigned"))),
        truth.executorId || normalizeState(task.status || task.state) === "completed" ? h("div", { className: "dat-meta", style: { marginTop: 2 } }, t("actualExecutor") + ": " + (executorText || t(truth.legacy ? "actualExecutorLegacy" : "actualExecutorUnknown")) + " · " + deliveryLabel(t, truth.deliveryKind) + " · " + acceptanceLabel(t, truth.acceptanceKind)) : null,
        truth.release ? h("div", { className: "dat-meta dat-warn-text", style: { marginTop: 2 } }, t("taskReleased") + " · " + t("releaseReasonLabel") + ": " + (truth.release.reason || t("reasonUnavailable")), truth.release.at ? " · " + formatTime(truth.release.at) : "") : null,
        truth.cancellation ? h("div", { className: "dat-meta dat-warn-text", style: { marginTop: 2 } }, t("taskCancellation") + " · " + t("cancellationReasonLabel") + ": " + (truth.cancellation.reason || t("reasonUnavailable")), truth.cancellation.at ? " · " + formatTime(truth.cancellation.at) : "") : null,
        modelText ? h("div", { className: "dat-meta", style: { marginTop: 2 } }, t("model") + ": " + modelText) : null,
        arrayText(task.blockedBy) ? h("div", { className: "dat-meta dat-warn-text" }, t("blockedBy", { value: arrayText(task.blockedBy) })) : null,
        arrayText(task.dependencySources) ? h("div", { className: "dat-meta" }, t("dependencySources", { value: dependencySourceText(t, task.dependencySources) })) : null,
        arrayText(task.conflictsWith) ? h("div", { className: "dat-meta dat-warn-text" }, t("conflicts", { value: arrayText(task.conflictsWith) })) : null,
        arrayText(task.files || task.fileScope) ? h("div", { className: "dat-meta" }, t("files", { value: arrayText(task.files || task.fileScope) })) : task.fileScopeProjection && task.fileScopeProjection.projected === false ? h("div", { className: "dat-meta" }, t("filesHidden")) : null,
        h("div", { className: "dat-task-status" }, h("span", { className: "dat-badge" }, statusLabel(t, task.status || "pending")))
      ];
      if (props.onOpen) return h("button", { type: "button", className: className, "data-mobile-slot": "agent-teams.task-detail.trigger", "data-harness-mobile-task-id": String(id), onClick: function (event) { props.onOpen(event, task); }, "aria-label": label }, body);
      return h("article", { className: className, "data-harness-mobile-task-id": String(id) }, body);
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
      return (Array.isArray(value) ? value : value ? [value] : []).map(function (item) { return item && typeof item === "object" ? item.taskId || item.id || item.title : item; }).filter(Boolean);
    }
    function normalizeState(value) {
      var normalized = String(value || "").toLowerCase().replace(/[\s-]+/g, "_");
      var aliases = { active: "running", working: "running", inprogress: "in_progress", done: "completed", complete: "completed", stopped: "retired", error: "failed" };
      return Object.prototype.hasOwnProperty.call(aliases, normalized) ? aliases[normalized] : normalized;
    }
    function memberStateKind(member) {
      return normalizeState(member.state || member.status || "") || "unknown";
    }
    function taskStateKind(task) {
      if (!task || typeof task !== "object") return "unknown";
      if (task.completedAggregate) return "completed";
      var state = normalizeState(task.status || task.state || "");
      if (state === "completed") return "completed";
      if (state === "cancelled") return "cancelled";
      if (state === "blocked" || relationIds(task.blockedBy).length) return "blocked";
      if (state === "in_progress") return "in_progress";
      return state || "pending";
    }
    function safeTaskDetail(task) {
      if (!task || typeof task !== "object") return null;
      var blockedBy = relationIds(task.blockedBy), failedBy = relationIds(task.failedBy), dependencies = relationIds(task.dependencies).concat(relationIds(task.dependsOn));
      var reason = typeof task.blockReason === "string" ? task.blockReason.trim() : typeof task.blockedReason === "string" ? task.blockedReason.trim() : "";
      return { task: task, stateKind: taskStateKind(task), filesText: arrayText(task.files || task.fileScope), blockedBy: blockedBy, failedBy: failedBy, conflicts: relationIds(task.conflictsWith), dependencies: dependencies, reason: reason };
    }
    function safeTaskTime(value) {
      if (typeof value !== "string" && typeof value !== "number") return "";
      return Number.isFinite(Date.parse(value)) ? value : "";
    }
    function taskWorkflowProjection(task) {
      var detail = safeTaskDetail(task);
      if (!detail) return null;
      var rawState = normalizeState(task.status || task.state || "pending");
      var startedAt = safeTaskTime(task.claimedAt || task.startedAt || task.inProgressAt);
      var lifecycleState = rawState === "completed" ? "completed" : rawState === "in_progress" ? "in_progress" : rawState === "blocked" && startedAt ? "in_progress" : "pending";
      var blocked = detail.stateKind === "blocked";
      var stages = [
        { id: "pending", state: lifecycleState === "pending" ? "current" : "reached", at: safeTaskTime(task.createdAt) },
        { id: "in_progress", state: lifecycleState === "in_progress" ? "current" : lifecycleState === "completed" ? startedAt ? "reached" : "unknown" : "upcoming", at: startedAt },
        { id: "completed", state: lifecycleState === "completed" ? "current" : "upcoming", at: safeTaskTime(task.completedAt) }
      ];
      return { lifecycleState: lifecycleState, currentState: blocked ? "blocked" : lifecycleState, stages: stages, blocked: blocked, blockedAt: blocked ? safeTaskTime(task.updatedAt) : "", nextKey: blocked ? "blockedTaskNext" : lifecycleState === "completed" ? "taskNextCompleted" : lifecycleState === "in_progress" ? "taskNextProgress" : "taskNextPending" };
    }
    function taskDetailProgressText(t, progress, task) {
      var state = taskStateKind(task), completed = Number(progress && progress.completed), total = Number(progress && progress.total);
      if (state === "completed") return t("taskProgressComplete");
      if (Number.isFinite(completed) && completed >= 0 && Number.isFinite(total) && total > 0) return t("taskProgressPlan", { completed: Math.min(completed, total), total: total });
      if (state === "pending" || state === "blocked" && !(task.claimedAt || task.startedAt)) return t("taskProgressPending");
      return t("taskProgressWorking");
    }
    function taskRunStatusText(t, status) {
      var key = status === "completed" ? "taskRunCompleted" : status === "failed" ? "taskRunFailed" : status === "stopped" ? "taskRunStopped" : status === "blocked" ? "taskRunBlocked" : status === "continued" ? "taskRunContinued" : status === "unknown" ? "taskRunUnknown" : "taskRunRunning";
      return t(key);
    }
    function taskToolDisplayName(value) {
      var name = String(value || "");
      var zhNames = { read: "读取文件", grep: "搜索内容", glob: "查找文件", edit: "修改文件", write: "写入文件", pwsh: "运行 PowerShell", web_search: "搜索网页", browser_control: "操作浏览器", computer_use: "操作桌面", android_control: "操作手机", image_gen: "生成或编辑图片", skill: "加载技能", todo_write: "更新计划", ask_user_question: "请求用户确认" };
      var enNames = { read: "Read file", grep: "Search content", glob: "Find files", edit: "Edit file", write: "Write file", pwsh: "Run PowerShell", web_search: "Search the web", browser_control: "Control browser", computer_use: "Control desktop", android_control: "Control phone", image_gen: "Generate or edit image", skill: "Load skill", todo_write: "Update plan", ask_user_question: "Ask for confirmation" };
      return (isChinese() ? zhNames : enNames)[name] || name.replace(/_/g, " ") || (isChinese() ? "执行工具" : "Run tool");
    }
    function taskWorkflowEventTitle(t, event) {
      if (event.kind === "turn") return t("taskWorkflowTurnStart", { turn: Number.isFinite(event.turn) ? event.turn : "–" });
      if (event.kind === "step") return t("taskWorkflowStep", { step: Number.isFinite(event.step) ? event.step : "–" });
      if (event.kind === "plan") return t("taskWorkflowPlanUpdated");
      if (event.kind === "model") return t("taskWorkflowModelUpdate");
      if (event.kind === "retry") return t("taskWorkflowRetry");
      if (event.kind === "tool") return t("taskWorkflowTool", { tool: taskToolDisplayName(event.toolName) });
      return t("taskWorkflow");
    }
    function taskWorkflowDuration(startedAt, completedAt) {
      var started = Date.parse(startedAt || ""), completed = Date.parse(completedAt || "");
      if (!Number.isFinite(started) || !Number.isFinite(completed) || completed < started) return "";
      var milliseconds = completed - started;
      if (milliseconds < 1000) return milliseconds + " ms";
      if (milliseconds < 60000) return (milliseconds / 1000).toFixed(milliseconds < 10000 ? 1 : 0) + " s";
      return Math.floor(milliseconds / 60000) + " min " + Math.floor(milliseconds % 60000 / 1000) + " s";
    }
    function taskMemberDisplayName(member, fallback) { return member && (member.displayName || member.name || member.id) || fallback; }
    var CANVAS_NODE_WIDTH = 152, CANVAS_NODE_HEIGHT = 92, CANVAS_GAP_X = 28, CANVAS_GAP_Y = 28, CANVAS_PADDING = 24;
    var CANVAS_MIN_ZOOM = 0.1, CANVAS_MAX_ZOOM = 2, CANVAS_FIT_NATIVE_THRESHOLD = 0.9, CANVAS_EDGE_LIMIT = 500, CANVAS_RELATIONS_PER_KIND = 6;
    function clampCanvasZoom(value) { return Math.max(CANVAS_MIN_ZOOM, Math.min(CANVAS_MAX_ZOOM, Number(value) || 1)); }
    function buildCanvasLayout(members, taskNodes, viewportWidth, viewportHeight) {
      var widthHint = Math.max(320, Number(viewportWidth) || 900), heightHint = Math.max(320, Number(viewportHeight) || 500);
      var largestSection = Math.max(members.length, taskNodes.length, 1);
      var aspect = Math.max(0.55, Math.min(3.2, widthHint / heightHint));
      var pitchRatio = (CANVAS_NODE_HEIGHT + CANVAS_GAP_Y) / (CANVAS_NODE_WIDTH + CANVAS_GAP_X);
      var columns = Math.max(1, Math.min(20, largestSection, Math.ceil(Math.sqrt(largestSection * aspect * pitchRatio))));
      var memberRows = members.length ? Math.ceil(members.length / columns) : 0;
      var taskRows = taskNodes.length ? Math.ceil(taskNodes.length / columns) : 0;
      var memberHeight = memberRows ? memberRows * CANVAS_NODE_HEIGHT + (memberRows - 1) * CANVAS_GAP_Y : 0;
      var taskHeight = taskRows ? taskRows * CANVAS_NODE_HEIGHT + (taskRows - 1) * CANVAS_GAP_Y : 0;
      var taskTop = CANVAS_PADDING + memberHeight + (memberRows && taskRows ? 72 : 0);
      var worldWidth = CANVAS_PADDING * 2 + columns * CANVAS_NODE_WIDTH + Math.max(0, columns - 1) * CANVAS_GAP_X;
      var worldHeight = Math.max(326, taskTop + taskHeight + CANVAS_PADDING);
      var positions = {};
      function place(key, index, top) {
        var column = index % columns, row = Math.floor(index / columns);
        positions[key] = { key: key, x: CANVAS_PADDING + column * (CANVAS_NODE_WIDTH + CANVAS_GAP_X), y: top + row * (CANVAS_NODE_HEIGHT + CANVAS_GAP_Y) };
      }
      members.forEach(function (member, index) { place("member:" + memberId(member), index, CANVAS_PADDING); });
      taskNodes.forEach(function (task, index) { place("task:" + taskId(task), index, taskTop); });
      return { width: worldWidth, height: worldHeight, columns: columns, memberColumns: Math.max(1, Math.min(columns, members.length || 1)), taskColumns: Math.max(1, Math.min(columns, taskNodes.length || 1)), taskTop: taskTop, positions: positions };
    }
    function canvasEdgePoints(from, to) {
      var fromCenterX = from.x + CANVAS_NODE_WIDTH / 2, fromCenterY = from.y + CANVAS_NODE_HEIGHT / 2;
      var toCenterX = to.x + CANVAS_NODE_WIDTH / 2, toCenterY = to.y + CANVAS_NODE_HEIGHT / 2;
      var dx = toCenterX - fromCenterX, dy = toCenterY - fromCenterY;
      if (Math.abs(dx) > Math.abs(dy)) return dx >= 0
        ? { x1: from.x + CANVAS_NODE_WIDTH, y1: fromCenterY, x2: to.x, y2: toCenterY }
        : { x1: from.x, y1: fromCenterY, x2: to.x + CANVAS_NODE_WIDTH, y2: toCenterY };
      return dy >= 0
        ? { x1: fromCenterX, y1: from.y + CANVAS_NODE_HEIGHT, x2: toCenterX, y2: to.y }
        : { x1: fromCenterX, y1: from.y, x2: toCenterX, y2: to.y + CANVAS_NODE_HEIGHT };
    }
    function TeamCanvas(props) {
      var t = props.t, members = sortMembersByActivity(props.members || []), tasks = props.tasks || [];
      var connection = props.connection === "live" ? "live" : props.connection === "polling" ? "polling" : props.connection === "stale" ? "stale" : "disconnected";
      var activeTasks = tasks.filter(function (task) { return String(task.status || task.state || "pending").toLowerCase() !== "completed"; });
      var completedTasks = tasks.filter(function (task) { return String(task.status || task.state || "").toLowerCase() === "completed"; });
      var taskNodes = activeTasks.slice();
      if (completedTasks.length) taskNodes.push({ id: "__completed__", title: t("completedSummary", { count: completedTasks.length }), status: "completed", completedAggregate: true });
      var viewportRef = useRef(null), stageRef = useRef(null), worldRef = useRef(null), zoomOutputRef = useRef(null), dragRef = useRef(null);
      var viewRef = useRef({ scale: 1, mode: "manual", offsetX: 12, offsetY: 12 });
      var sizePair = useState({ width: 0, height: 0 }), viewportSize = sizePair[0], setViewportSize = sizePair[1];
      var layout = buildCanvasLayout(members, taskNodes, viewportSize.width, viewportSize.height);
      var positions = layout.positions, memberLookup = {}, taskLookup = {}, statesByKey = {}, completedKey = "task:__completed__";
      members.forEach(function (member) {
        var key = "member:" + memberId(member);
        [memberId(member), memberSession(member), member.memberId, member.assigneeSessionId].filter(Boolean).forEach(function (id) { memberLookup[String(id)] = key; });
      });
      var modelBySession = {};
      members.forEach(function (member) {
        var modelText = memberModelText(member, t);
        if (!modelText) return;
        [String(memberId(member)), String(memberSession(member)), String(member.sessionId || "")].filter(Boolean).forEach(function (id) { modelBySession[id] = modelText; });
      });
      activeTasks.forEach(function (task) { var key = "task:" + taskId(task); taskLookup[String(taskId(task))] = key; statesByKey[key] = taskStateKind(task); });
      completedTasks.forEach(function (task) { taskLookup[String(taskId(task))] = completedKey; });
      if (completedTasks.length) statesByKey[completedKey] = "completed";
      var edges = [], edgeSeen = {}, omittedEdges = 0;
      function addEdge(from, to, kind, flow) {
        if (!from || !to || from === to || !positions[from] || !positions[to]) return;
        var key = from + "|" + to + "|" + kind;
        if (edgeSeen[key]) return;
        edgeSeen[key] = true;
        if (edges.length >= CANVAS_EDGE_LIMIT) { omittedEdges += 1; return; }
        edges.push({ key: key, from: positions[from], to: positions[to], kind: kind, flow: !!flow, points: canvasEdgePoints(positions[from], positions[to]) });
      }
      function eachBoundedRelation(value, work) {
        var list = Array.isArray(value) ? value : value ? [value] : [];
        var visibleCount = Math.min(list.length, CANVAS_RELATIONS_PER_KIND);
        for (var index = 0; index < visibleCount; index += 1) {
          var item = list[index], id = item && typeof item === "object" ? item.taskId || item.id || item.title : item;
          if (id) work(id);
        }
        if (list.length > visibleCount) omittedEdges += list.length - visibleCount;
      }
      tasks.forEach(function (task) {
        var target = taskLookup[String(taskId(task))], assigned = task.assigneeSessionId || task.assigneeId || task.assignee || task.memberId;
        addEdge(memberLookup[String(assigned || "")], target, "assigned", (statesByKey[target] || "") === "in_progress");
      });
      tasks.forEach(function (task) {
        var target = taskLookup[String(taskId(task))];
        eachBoundedRelation(task.dependsOn, function (id) { addEdge(taskLookup[String(id)], target, "depends"); });
        eachBoundedRelation(task.blockedBy, function (id) { addEdge(taskLookup[String(id)], target, "blocked"); });
        eachBoundedRelation(task.conflictsWith, function (id) { addEdge(target, taskLookup[String(id)], "conflict"); });
      });
      function edgeLabel(kind) { return t(kind === "assigned" ? "assignedRelation" : kind === "depends" ? "dependsRelation" : kind === "blocked" ? "blockedRelation" : "conflictRelation"); }
      function syncCanvasScale(nextScale, mode, anchor) {
        var viewport = viewportRef.current, stage = stageRef.current, world = worldRef.current;
        if (!viewport || !stage || !world) return;
        var previous = viewRef.current, scale = clampCanvasZoom(nextScale);
        var point = anchor || { x: viewport.clientWidth / 2, y: viewport.clientHeight / 2 };
        var logicalX = (viewport.scrollLeft + point.x - previous.offsetX) / previous.scale;
        var logicalY = (viewport.scrollTop + point.y - previous.offsetY) / previous.scale;
        var scaledWidth = layout.width * scale, scaledHeight = layout.height * scale;
        var stageWidth = Math.max(viewport.clientWidth, Math.ceil(scaledWidth + 24));
        var stageHeight = Math.max(viewport.clientHeight, Math.ceil(scaledHeight + 24));
        var offsetX = Math.max(12, Math.round((stageWidth - scaledWidth) / 2)), offsetY = Math.max(12, Math.round((stageHeight - scaledHeight) / 2));
        stage.style.width = stageWidth + "px"; stage.style.height = stageHeight + "px";
        world.style.left = offsetX + "px"; world.style.top = offsetY + "px";
        world.style.width = layout.width + "px"; world.style.height = layout.height + "px";
        world.style.transform = scale === 1 ? "" : "scale(" + scale + ")";
        viewRef.current = { scale: scale, mode: mode || "manual", offsetX: offsetX, offsetY: offsetY };
        if (zoomOutputRef.current) zoomOutputRef.current.textContent = Math.round(scale * 100) + "%";
        if ((mode || "manual") === "fit") { viewport.scrollLeft = 0; viewport.scrollTop = 0; }
        else {
          var nextLeft = offsetX + logicalX * scale - point.x, nextTop = offsetY + logicalY * scale - point.y;
          var applyScroll = function () { viewport.scrollLeft = Math.max(0, nextLeft); viewport.scrollTop = Math.max(0, nextTop); };
          if (typeof requestAnimationFrame === "function") requestAnimationFrame(applyScroll); else applyScroll();
        }
      }
      function fitCanvas() {
        var viewport = viewportRef.current;
        if (!viewport) return;
        var fitScale = Math.min(1, (Math.max(80, viewport.clientWidth) - 24) / layout.width, (Math.max(80, viewport.clientHeight) - 24) / layout.height);
        syncCanvasScale(fitScale >= CANVAS_FIT_NATIVE_THRESHOLD ? 1 : fitScale, "fit");
      }
      function zoomCanvas(delta, anchor) { syncCanvasScale(viewRef.current.scale + delta, "manual", anchor); }
      function resetCanvasZoom() { syncCanvasScale(1, "manual"); }
      useEffect(function () {
        var viewport = viewportRef.current;
        if (!viewport) return;
        function measure() {
          var next = { width: viewport.clientWidth, height: viewport.clientHeight };
          setViewportSize(function (current) { return Math.abs(current.width - next.width) < 1 && Math.abs(current.height - next.height) < 1 ? current : next; });
        }
        measure();
        var observer = typeof ResizeObserver === "function" ? new ResizeObserver(measure) : null;
        if (observer) observer.observe(viewport);
        if (typeof window !== "undefined") window.addEventListener("resize", measure);
        return function () { if (observer) observer.disconnect(); if (typeof window !== "undefined") window.removeEventListener("resize", measure); };
      }, []);
      useEffect(function () {
        if (viewRef.current.mode === "fit") fitCanvas();
        else syncCanvasScale(viewRef.current.scale, "manual");
      }, [layout.width, layout.height, viewportSize.width, viewportSize.height]);
      function onCanvasWheel(event) {
        if (!event.ctrlKey && !event.metaKey) return;
        event.preventDefault();
        var rect = viewportRef.current.getBoundingClientRect();
        var factor = Math.exp(-event.deltaY * 0.0015);
        syncCanvasScale(viewRef.current.scale * factor, "manual", { x: event.clientX - rect.left, y: event.clientY - rect.top });
      }
      function onCanvasPointerDown(event) {
        if (event.button !== 0 || event.pointerType === "touch") return;
        if (event.target && typeof event.target.closest === "function" && event.target.closest(".dat-canvas-node,.dat-canvas-toolbar")) return;
        var viewport = viewportRef.current;
        dragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, left: viewport.scrollLeft, top: viewport.scrollTop, moved: false };
        if (viewport.setPointerCapture) viewport.setPointerCapture(event.pointerId);
      }
      function onCanvasPointerMove(event) {
        var drag = dragRef.current, viewport = viewportRef.current;
        if (!drag || drag.pointerId !== event.pointerId || !viewport) return;
        var dx = event.clientX - drag.x, dy = event.clientY - drag.y;
        if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 4) return;
        drag.moved = true; viewport.dataset.dragging = "true";
        event.preventDefault(); viewport.scrollLeft = drag.left - dx; viewport.scrollTop = drag.top - dy;
      }
      function endCanvasDrag(event) {
        var drag = dragRef.current, viewport = viewportRef.current;
        if (!drag || drag.pointerId !== event.pointerId) return;
        dragRef.current = null;
        if (viewport) { delete viewport.dataset.dragging; if (viewport.releasePointerCapture) { try { viewport.releasePointerCapture(event.pointerId); } catch (_) {} } }
      }
      function onCanvasKeyDown(event) {
        if (event.key === "+" || event.key === "=") { event.preventDefault(); zoomCanvas(0.1); }
        else if (event.key === "-") { event.preventDefault(); zoomCanvas(-0.1); }
        else if (event.key === "0") { event.preventDefault(); resetCanvasZoom(); }
        else if (String(event.key).toLowerCase() === "f") { event.preventDefault(); fitCanvas(); }
      }
      return h("section", { className: "dat-panel dat-canvas-panel", "data-mobile-slot": "agent-teams.canvas", "aria-labelledby": "dat-team-canvas" },
        h("div", { className: "dat-column-head" },
          h("div", null, h("h2", { id: "dat-team-canvas" }, t("canvasLabel")), h("p", { className: "dat-note dat-canvas-hint", style: { margin: "4px 0 0" } }, t("canvasHint"), " ", t("canvasPanHint"))),
          h("div", { className: "dat-canvas-header-actions" }, h("span", { className: "dat-badge" }, activeTasks.length), h("div", { className: "dat-canvas-toolbar", role: "group", "aria-label": t("canvasControls") },
            h(Button, { small: true, onClick: function () { zoomCanvas(-0.1); }, ariaLabel: t("canvasZoomOut") }, "−"),
            h("button", { type: "button", className: "dat-canvas-zoom-readout", ref: zoomOutputRef, onClick: resetCanvasZoom, "aria-label": t("canvasResetZoom") }, "100%"),
            h(Button, { small: true, onClick: function () { zoomCanvas(0.1); }, ariaLabel: t("canvasZoomIn") }, "+"),
            h(Button, { small: true, onClick: fitCanvas, ariaLabel: t("canvasFit") }, t("canvasFitLabel"))
          ))
        ),
        h("div", { className: "dat-canvas-scroll", tabIndex: 0, ref: viewportRef, role: "region", "aria-label": t("canvasViewport") + ". " + t("canvasPanHint"), onWheel: onCanvasWheel, onPointerDown: onCanvasPointerDown, onPointerMove: onCanvasPointerMove, onPointerUp: endCanvasDrag, onPointerCancel: endCanvasDrag, onKeyDown: onCanvasKeyDown },
          h("div", { className: "dat-canvas-stage", ref: stageRef }, h("div", { className: "dat-canvas", ref: worldRef, style: { width: layout.width + "px", height: layout.height + "px" } },
            h("svg", { className: "dat-canvas-lines", viewBox: "0 0 " + layout.width + " " + layout.height, preserveAspectRatio: "none", "aria-hidden": "true" },
              h("defs", null, h("marker", { id: "dat-canvas-arrow", viewBox: "0 0 10 10", refX: 8, refY: 5, markerWidth: 5, markerHeight: 5, orient: "auto-start-reverse" }, h("path", { d: "M 0 0 L 10 5 L 0 10 z", fill: "currentColor" }))),
              edges.map(function (edge) { return h("line", { key: edge.key, className: "dat-canvas-line dat-canvas-line-" + edge.kind + (edge.flow ? " dat-canvas-line-flow" : ""), x1: edge.points.x1, y1: edge.points.y1, x2: edge.points.x2, y2: edge.points.y2, markerEnd: "url(#dat-canvas-arrow)" }, h("title", null, edgeLabel(edge.kind))); })
            ),
            h("div", { className: "dat-canvas-row dat-canvas-member-row", style: { left: CANVAS_PADDING + "px", top: CANVAS_PADDING + "px", gridTemplateColumns: "repeat(" + layout.memberColumns + ", " + CANVAS_NODE_WIDTH + "px)" } }, members.map(function (member) { var position = positions["member:" + memberId(member)], isLead = member.isLead || member.kind === "lead" || memberSession(member) === props.leadSessionId, stateKind = memberStateKind(member); return h("button", { key: position.key, type: "button", className: "dat-canvas-node dat-canvas-member", "data-state": stateKind, onClick: props.openMembers, "aria-label": simpleMemberName(member, isLead, t) + " · " + statusLabel(t, stateKind) }, h("div", { className: "dat-canvas-head" }, h("span", { className: "dat-canvas-dot" }), h("div", { className: "dat-card-title" }, simpleMemberName(member, isLead, t))), h("div", { className: "dat-canvas-status" }, statusLabel(t, stateKind)), member.lastActivityAt ? h("div", { className: "dat-meta dat-canvas-time" }, formatTime(member.lastActivityAt)) : null); })),
            h("div", { className: "dat-canvas-row dat-canvas-task-row", style: { left: CANVAS_PADDING + "px", top: layout.taskTop + "px", gridTemplateColumns: "repeat(" + layout.taskColumns + ", " + CANVAS_NODE_WIDTH + "px)" } }, taskNodes.map(function (task) { var position = positions["task:" + taskId(task)], stateKind = taskStateKind(task), assigned = task.assigneeSessionId || task.assigneeId || task.assignee || task.memberId || "", modelText = modelBySession[String(assigned)] || ""; return task.completedAggregate ? h("article", { key: position.key, className: "dat-canvas-node dat-canvas-task dat-canvas-completed", "data-state": stateKind, "aria-label": (task.title || t("taskFallback", { id: taskId(task) })) + " · " + statusLabel(t, stateKind) }, h("div", { className: "dat-card-title" }, task.title || task.name || t("taskFallback", { id: taskId(task) })), h("div", { className: "dat-canvas-status" }, statusLabel(t, stateKind))) : h("button", { key: position.key, type: "button", className: "dat-canvas-node dat-canvas-task dat-canvas-task-open", "data-state": stateKind, onClick: function (event) { props.openTask(event, task); }, "aria-label": (task.title || task.name || t("taskFallback", { id: taskId(task) })) + " · " + statusLabel(t, stateKind) }, h("div", { className: "dat-card-title" }, task.title || task.name || t("taskFallback", { id: taskId(task) })), h("div", { className: "dat-canvas-status" }, statusLabel(t, stateKind)), modelText ? h("div", { className: "dat-canvas-model" }, modelText) : null); }))
          ))
        ),
        omittedEdges ? h("p", { className: "dat-canvas-limit-note", role: "note" }, t("canvasEdgesLimited", { shown: edges.length, count: omittedEdges })) : null,
        h("div", { className: "dat-canvas-live" + (props.paused ? " dat-canvas-live-paused" : ""), role: "status" },
          h("span", { className: "dat-badge" }, h("span", { className: "dat-dot", style: connection === "live" ? null : { background: "var(--dsw-alias-state-warn-primary)" } }), t(connection)),
          props.paused ? h("span", { className: "dat-note" }, t("paused")) : null,
          h("span", { className: "dat-meta" }, t("teamTasks", { active: activeTasks.length, done: completedTasks.length })),
          props.updatedAt ? h("span", { className: "dat-meta" }, t("lastUpdated", { value: formatTime(props.updatedAt) })) : null
        ),
        h("ul", { className: "dat-canvas-legend", "aria-label": t("canvasHint") }, ["assigned", "depends", "blocked", "conflict"].map(function (kind) { return h("li", { key: kind, className: "dat-meta dat-canvas-key dat-canvas-key-" + kind }, h("svg", { className: "dat-canvas-swatch", viewBox: "0 0 20 10", "aria-hidden": "true" }, h("line", { x1: 1, y1: 5, x2: 19, y2: 5, className: "dat-canvas-line dat-canvas-line-" + kind })), edgeLabel(kind)); })),
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
        return h("button", { key: teamId(team), type: "button", className: "dat-team-choice", "data-mobile-slot": "agent-teams.team.trigger", "data-harness-mobile-team-id": String(teamId(team)), "aria-current": selected ? "true" : undefined, "aria-label": t("switchTeam", { name: name }), onClick: function () { props.select(teamId(team)); } }, name + " · #" + String(teamId(team)).slice(-6), archived ? " · " + t("archive") : active ? " · " + active : "");
      }
      if (teams.length <= 1) return null;
      return h("nav", { className: "dat-overview dat-panel", "data-mobile-slot": "agent-teams.context-switcher", "aria-labelledby": "dat-overview-title" },
        h("div", { className: "dat-column-head" }, h("h2", { id: "dat-overview-title" }, t("activeTeamList")), h("span", { className: "dat-badge" }, activeTeams.length)),
        h("div", { className: "dat-team-strip" }, activeTeams.map(function (team) { return choice(team, false); })),
        archivedTeams.length ? h("details", { className: "dat-disclosure" }, h("summary", null, t("archivedTeams") + " · " + archivedTeams.length), h("div", { className: "dat-team-strip" }, archivedTeams.map(function (team) { return choice(team, true); }))) : null,
        h("p", { className: "dat-note", style: { marginBottom: 0 } }, t("backgroundHint"))
      );
    }

    function TaskDetailSidebar(props) {
      var t = props.t, detail = safeTaskDetail(props.task), task = detail && detail.task, assignee = props.assignee, events = Array.isArray(props.events) ? props.events : [];
      var stateKind = detail ? detail.stateKind : "unknown";
      var filesText = detail ? detail.filesText : "";
      function detailFact(label, value) { return h("div", { className: "dat-task-fact" }, h("dt", null, label), h("dd", null, value == null ? "" : value)); }
      function refTitle(value) {
        var id = value && typeof value === "object" ? value.taskId || value.id || value.title : value;
        var found = (props.tasks || []).filter(function (item) { return taskId(item) === id; })[0];
        return found && (found.title || found.name) || String(id == null ? "" : id);
      }
      return h("aside", { className: "dat-panel dat-inspector", role: props.modal ? "dialog" : "complementary", "aria-modal": props.modal ? true : undefined, tabIndex: -1, ref: props.detailRef, "aria-labelledby": "dat-task-detail-title" },
        h("div", { className: "dat-inspector-head" }, h("h2", { id: "dat-task-detail-title", className: "dat-section-title", style: { margin: 0 } }, t("taskDetail")), h(Button, { small: true, onClick: props.onClose, ariaLabel: t("closePanel") }, "×")),
        h("div", { className: "dat-inspector-body" },
          !task ? h("div", { className: "dat-meta" }, t("taskDetailUnavailable")) : h(React.Fragment, null,
            h("div", { className: "dat-task-hero" }, h("h3", { className: "dat-card-title" }, task.title || task.name || t("taskFallback", { id: taskId(task) })), h("span", { className: "dat-badge" }, statusLabel(t, stateKind))),
            task.description ? h("p", { className: "dat-meta", style: { marginTop: 8, whiteSpace: "pre-wrap" } }, task.description) : null,
            visibleTaskResult(task) ? h("section", { className: "dat-task-result", "data-provenance": taskResponsibilityProjection(task).legacy ? "legacy_migration" : "current", "aria-labelledby": "dat-task-result-title" }, h("h3", { id: "dat-task-result-title" }, taskResultLabel(t, task, false)), h("div", { className: "dat-task-result-text" }, visibleTaskResult(task).text), visibleTaskResult(task).truncated ? h("p", { className: "dat-note" }, t("taskResultTruncated")) : null) : null,
            h("dl", { className: "dat-task-facts" },
              detailFact(t("taskRef"), "#" + taskId(task)),
              detailFact(t("assignee"), assignee ? (assignee.displayName || assignee.name || memberId(assignee)) : t("unassigned")),
              detailFact(t("model"), assignee ? memberModelText(assignee, t) : t("unassigned")),
              filesText ? detailFact(t("files"), filesText) : task.fileScopeProjection && task.fileScopeProjection.projected === false ? detailFact(t("files"), t("filesHidden")) : null,
              detail.blockedBy.length ? detailFact(t("blockedBy"), detail.blockedBy.map(refTitle).join(", ")) : null,
              detail.failedBy.length ? detailFact(t("failedBy"), detail.failedBy.map(refTitle).join(", ")) : null,
              detail.conflicts.length ? detailFact(t("conflicts"), detail.conflicts.map(refTitle).join(", ")) : null,
              arrayText(task.dependencySources) ? detailFact(t("dependencySources"), dependencySourceText(t, task.dependencySources)) : null
            ),
            h(ResponsibilityPanel, { t: t, task: task, members: props.members, leadSessionId: props.leadSessionId, labelId: "dat-sidebar-responsibility-title" }),
            h(TaskAssurancePanel, { t: t, task: task }),
            stateKind === "blocked" ? h("section", { className: "dat-task-section dat-board-note", role: "status", "aria-label": t("blockedTaskReason") }, h("h3", null, t("blockedTaskReason")), h("div", { className: "dat-meta" }, detail.reason || (detail.blockedBy.length ? t("blockedBy", { value: detail.blockedBy.map(refTitle).join(", ") }) : t("blockedTaskUnknown"))), h("p", { className: "dat-note", style: { marginBottom: 0 } }, t("blockedTaskNext"))) : null,
            detail.dependencies.length ? h("section", { className: "dat-task-section", "aria-label": t("taskDependencies") }, h("h3", null, t("taskDependencies")), h("div", { className: "dat-meta" }, detail.dependencies.map(refTitle).join(", "))) : null,
            h("section", { className: "dat-task-section" }, h("h3", null, t("taskEvents")), events.length ? h("div", { className: "dat-task-events" }, events.slice(0, 6).map(function (event) { return h(EventCard, { key: eventIdentity(event, ""), event: event, t: t, teamsById: props.teamsById || {} }); })) : h("div", { className: "dat-note" }, t("noEvents"))),
            task.updatedAt || task.createdAt ? h("p", { className: "dat-note", style: { marginTop: 12, marginBottom: 0 } }, t("lastActivity", { value: formatTime(task.updatedAt || task.createdAt) })) : null
          )
        )
      );
    }

    function TaskWorkflow(props) {
      var t = props.t, workflow = props.workflow, detail = props.detail, runtime = props.runtime;
      if (!workflow || !detail) return null;
      var progress = runtime && runtime.progress, plan = runtime && Array.isArray(runtime.plan) ? runtime.plan : [];
      var runtimeWorkflow = runtime && runtime.workflow || {}, runtimeEvents = Array.isArray(runtimeWorkflow.events) ? runtimeWorkflow.events : [];
      var unavailableReason = runtimeWorkflow.unavailableReason, runtimeEmptyText = !runtime ? props.error ? t("taskWorkflowUnavailable") : t("taskWorkflowLoading") : unavailableReason === "overlapping_tasks" ? t("taskWorkflowAmbiguous") : unavailableReason === "shared_lead_session" ? t("taskWorkflowSharedLead") : unavailableReason === "session_unavailable" ? t("taskWorkflowSessionUnavailable") : t("taskWorkflowEmpty");
      var progressText = taskDetailProgressText(t, progress, detail.task);
      function stageStateText(value) { return t(value === "current" ? "taskStageCurrent" : value === "reached" ? "taskStageReached" : value === "unknown" ? "taskStageUnknown" : "taskStageUpcoming"); }
      var stageNodes = [];
      workflow.stages.forEach(function (stage, index) {
        if (index) stageNodes.push(h("span", { key: "arrow-" + stage.id, className: "dat-task-stage-arrow", "aria-hidden": "true" }, "→"));
        stageNodes.push(h("div", { key: stage.id, className: "dat-task-stage", "data-state": stage.state, "aria-current": stage.state === "current" ? "step" : undefined },
          h("div", { className: "dat-task-stage-top" }, h("span", { className: "dat-task-stage-dot", "aria-hidden": "true" }), h("strong", null, statusLabel(t, stage.id))),
          h("div", { className: "dat-meta" }, stageStateText(stage.state)),
          stage.at ? h("time", { className: "dat-note", dateTime: String(stage.at) }, formatTime(stage.at)) : null
        ));
      });
      var blockerText = props.blockerText || detail.reason || (detail.blockedBy.length ? t("blockedBy", { value: detail.blockedBy.join(", ") }) : t("blockedTaskUnknown"));
      return h("section", { className: "dat-task-workflow", "aria-labelledby": "dat-task-workflow-title" },
        h("div", { className: "dat-task-workflow-head" }, h("div", null, h("h3", { id: "dat-task-workflow-title" }, t("taskWorkflow")), h("p", { className: "dat-note" }, t("taskWorkflowHint"))), h("div", { className: "dat-row" }, h("span", { className: "dat-badge" }, statusLabel(t, workflow.currentState)), props.connection ? h("span", { className: "dat-badge" }, h("span", { className: "dat-dot", style: props.connection === "live" ? null : { background: "var(--dsw-alias-state-warn-primary)" } }), t(props.connection)) : null)),
        h("div", { className: "dat-task-progress", role: "status", "aria-label": t("taskCompletionProgress") },
          h("div", { className: "dat-task-progress-copy" }, h("strong", null, t("taskCompletionProgress")), h("span", null, progressText))
        ),
        h("div", { className: "dat-task-stage-track" }, stageNodes),
        workflow.blocked ? h("div", { className: "dat-task-block-row" }, h("div", { className: "dat-task-block-branch", "data-active": "true" },
          h("div", { className: "dat-task-stage-top" }, h("span", { className: "dat-task-stage-dot", "aria-hidden": "true" }), h("strong", null, t("taskBlockedBranch"))),
          h("div", { className: "dat-meta" }, blockerText),
          workflow.blockedAt ? h("time", { className: "dat-note", dateTime: String(workflow.blockedAt) }, formatTime(workflow.blockedAt)) : null
        )) : null,
        h("div", { className: "dat-task-workflow-runtime" },
          h("section", { className: "dat-task-runtime-pane", "aria-labelledby": "dat-task-plan-title" },
            h("div", { className: "dat-task-runtime-head" }, h("h4", { id: "dat-task-plan-title" }, t("taskWorkflowPlan")), progress && progress.total ? h("span", { className: "dat-badge" }, (progress.completed || 0) + "/" + progress.total) : null),
            plan.length ? h("ul", { className: "dat-task-plan" }, plan.map(function (item, index) { return h("li", { key: index + ":" + item.content, "data-state": item.status }, h("span", { className: "dat-task-plan-mark", "aria-hidden": "true" }, item.status === "completed" ? "✓" : item.status === "in_progress" ? "●" : "○"), h("span", null, item.content)); })) : h("p", { className: "dat-note dat-task-runtime-empty" }, unavailableReason ? runtimeEmptyText : runtime ? t("taskWorkflowPlanEmpty") : runtimeEmptyText)
          ),
          h("section", { className: "dat-task-runtime-pane", "aria-labelledby": "dat-task-runtime-title" },
            h("div", { className: "dat-task-runtime-head" }, h("div", null, h("h4", { id: "dat-task-runtime-title" }, t("taskWorkflowTimeline")), h("p", { className: "dat-note" }, t("taskWorkflowTimelineHint"))), h("span", { className: "dat-badge" }, runtimeEvents.length)),
            runtimeEvents.length ? h("div", { className: "dat-task-runtime-list", "aria-live": "polite" }, runtimeEvents.slice().reverse().map(function (event) {
              var duration = taskWorkflowDuration(event.at, event.completedAt), meta = taskRunStatusText(t, event.status);
              if (event.kind === "plan" && event.counts) meta = t("taskPlanCounts", { completed: event.counts.completed || 0, total: event.counts.total || 0, active: event.counts.inProgress || 0 });
              return h("article", { key: event.id, className: "dat-task-runtime-event", "data-kind": event.kind, "data-status": event.status }, h("span", { className: "dat-task-runtime-dot", "aria-hidden": "true" }), h("div", { className: "dat-task-runtime-copy" }, h("strong", null, taskWorkflowEventTitle(t, event)), h("span", null, meta, duration ? " · " + duration : "")), h("time", { dateTime: event.at }, formatTime(event.at)));
            })) : h("p", { className: "dat-note dat-task-runtime-empty" }, runtimeEmptyText),
            runtimeWorkflow.truncated ? h("p", { className: "dat-note dat-task-runtime-limit" }, t("taskWorkflowLimited", { count: runtimeEvents.length, total: runtimeWorkflow.totalEvents || runtimeEvents.length })) : null
          )
        )
      );
    }

    function TaskDetailFocus(props) {
      var t = props.t, detail = safeTaskDetail(props.task), task = detail && detail.task, assignee = props.assignee, events = Array.isArray(props.events) ? props.events : [], workflow = taskWorkflowProjection(task);
      var runtimeDetail = props.runtimeDetail && task && String(props.runtimeDetail.taskId || "") === String(taskId(task)) ? props.runtimeDetail : null;
      var connectionValue = props.detailConnection || props.connection, connection = connectionValue === "live" ? "live" : connectionValue === "polling" ? "polling" : connectionValue === "stale" ? "stale" : "disconnected";
      var claimant = runtimeDetail && runtimeDetail.claimant || (task && taskStateKind(task) !== "pending" ? assignee : null), responsible = runtimeDetail && runtimeDetail.responsible || props.responsible;
      var executionModel = runtimeDetail && runtimeDetail.executionModel || assignee, progress = runtimeDetail && runtimeDetail.progress, eventLimit = 30;
      function detailFact(label, value) { return h("div", { className: "dat-task-fact" }, h("dt", null, label), h("dd", null, value == null ? "" : value)); }
      function refTitle(value) {
        var id = value && typeof value === "object" ? value.taskId || value.id || value.title : value;
        var found = (props.tasks || []).filter(function (item) { return taskId(item) === id; })[0];
        return found && (found.title || found.name) || String(id == null ? "" : id);
      }
      var blockerText = detail && (detail.reason || (detail.blockedBy.length ? t("blockedBy", { value: detail.blockedBy.map(refTitle).join(", ") }) : ""));
      var claimedAt = runtimeDetail && runtimeDetail.claimedAt || task && (task.claimedAt || task.startedAt || task.inProgressAt), completedAt = runtimeDetail && runtimeDetail.completedAt || task && task.completedAt;
      var progressText = task ? taskDetailProgressText(t, progress, task) : "", modelText = executionModel ? memberModelText(executionModel, t) : "";
      var taskResult = visibleTaskResult(runtimeDetail) || visibleTaskResult(task);
      if (modelText && runtimeDetail && runtimeDetail.executionModel && runtimeDetail.executionModel.observed === false) modelText = t("taskModelConfigured", { value: modelText });
      return h("article", { className: "dat-panel dat-task-focus", role: "region", tabIndex: -1, ref: props.detailRef, "data-mobile-slot": "agent-teams.task-detail", "data-harness-mobile-task-id": String(taskId(task)), "aria-labelledby": "dat-task-focus-title" },
        h("div", { className: "dat-task-focus-head" },
          h("div", { className: "dat-task-focus-head-copy" }, h(Button, { small: true, onClick: props.onClose }, "← " + t("taskBackToBoard")), h("h2", { id: "dat-task-focus-title" }, t("taskDetail"))),
          h("div", { className: "dat-row" }, h("span", { className: "dat-badge", title: t("taskLiveConnected") }, h("span", { className: "dat-dot", style: connection === "live" ? null : { background: "var(--dsw-alias-state-warn-primary)" } }), t(connection)), h(Button, { small: true, onClick: props.onClose, ariaLabel: t("taskBackToBoard") }, "×"))
        ),
        h("div", { className: "dat-task-focus-body" },
          !task ? h("div", { className: "dat-empty" }, h("p", null, t("taskDetailUnavailable"))) : h(React.Fragment, null,
            h("div", { className: "dat-task-focus-hero" }, h("div", null, h("div", { className: "dat-note" }, "#" + taskId(task)), h("h1", { className: "dat-task-focus-title" }, task.title || task.name || t("taskFallback", { id: taskId(task) }))), h("span", { className: "dat-badge" }, statusLabel(t, workflow.currentState))),
            h(TaskWorkflow, { t: t, workflow: workflow, detail: detail, runtime: runtimeDetail, connection: connection, error: props.runtimeError, blockerText: blockerText }),
            h("div", { className: "dat-task-focus-grid" },
              h("div", { className: "dat-task-focus-main" },
                h("section", { className: "dat-task-focus-surface", "aria-labelledby": "dat-task-overview-title" },
                  h("h3", { id: "dat-task-overview-title" }, t("taskOverview")),
                  h("div", { className: "dat-task-copy-section" },
                    h("div", { className: "dat-task-copy-block" }, h("h4", null, t("taskBrief")), h("p", null, runtimeDetail && runtimeDetail.summary || task.title || task.name || t("taskFallback", { id: taskId(task) }))),
                    h("div", { className: "dat-task-copy-block" }, h("h4", null, t("taskDescription")), runtimeDetail ? h("p", { className: runtimeDetail.description ? "" : "dat-note" }, runtimeDetail.description || t("taskDescriptionMissing")) : h("p", { className: "dat-note" }, props.runtimeError ? t("taskWorkflowUnavailable") : t("taskWorkflowLoading")))
                  ),
                  h("dl", { className: "dat-task-facts dat-task-focus-facts" },
                    detailFact(t("taskRef"), "#" + taskId(task)),
                    detailFact(t("taskCompletionProgress"), progressText),
                    detailFact(t("taskClaimant"), taskMemberDisplayName(claimant, t("taskNotClaimed"))),
                    detailFact(t("taskResponsible"), taskMemberDisplayName(responsible, t("unassigned"))),
                    detailFact(t("taskClaimedAt"), claimedAt ? formatTime(claimedAt) : t("taskNotClaimed")),
                    detailFact(t("taskCompletedAt"), completedAt ? formatTime(completedAt) : t("taskNotCompleted")),
                    detailFact(t("taskModelUsed"), modelText || t("taskModelUndetermined")),
                    task.createdAt ? detailFact(t("taskCreatedAt"), formatTime(task.createdAt)) : null,
                    detail.blockedBy.length ? detailFact(t("blockedBy"), detail.blockedBy.map(refTitle).join(", ")) : null,
                    detail.conflicts.length ? detailFact(t("conflicts"), detail.conflicts.map(refTitle).join(", ")) : null,
                    arrayText(task.dependencySources) ? detailFact(t("dependencySources"), dependencySourceText(t, task.dependencySources)) : null
                  )
                ),
                h(ResponsibilityPanel, { t: t, task: task, members: props.members, leadSessionId: props.leadSessionId, labelId: "dat-task-focus-responsibility-title" }),
                h(TaskAssurancePanel, { t: t, task: task }),
                taskResult ? h("section", { className: "dat-task-focus-surface dat-task-result", "data-provenance": taskResponsibilityProjection(task).legacy ? "legacy_migration" : "current", "aria-labelledby": "dat-task-focus-result-title" }, h("h3", { id: "dat-task-focus-result-title" }, taskResultLabel(t, task, false)), h("div", { className: "dat-task-result-text" }, taskResult.text), taskResult.truncated ? h("p", { className: "dat-note" }, t("taskResultTruncated")) : null) : null,
                h("section", { className: "dat-task-focus-surface dat-task-next", "data-state": workflow.currentState, "aria-labelledby": "dat-task-next-title" }, h("h3", { id: "dat-task-next-title" }, t("taskNextStep")), h("p", { className: "dat-meta" }, t(workflow.nextKey))),
                workflow.blocked ? h("section", { className: "dat-task-focus-surface dat-board-note", role: "status", "aria-label": t("blockedTaskReason") }, h("h3", null, t("blockedTaskReason")), h("div", { className: "dat-meta" }, detail.reason || (detail.blockedBy.length ? t("blockedBy", { value: detail.blockedBy.map(refTitle).join(", ") }) : t("blockedTaskUnknown")))) : null,
                detail.dependencies.length ? h("section", { className: "dat-task-focus-surface", "aria-label": t("taskDependencies") }, h("h3", null, t("taskDependencies")), h("div", { className: "dat-meta" }, detail.dependencies.map(refTitle).join(", "))) : null
              ),
              h("aside", { className: "dat-task-focus-surface dat-task-live", "aria-labelledby": "dat-task-live-title" },
                h("div", { className: "dat-task-live-head" }, h("h3", { id: "dat-task-live-title" }, t("taskLiveEvents")), h("span", { className: "dat-badge" }, events.length)),
                h("p", { className: "dat-note" }, t("taskLiveEventsHint")),
                events.length ? h("div", { className: "dat-task-live-list" }, events.slice(0, eventLimit).map(function (event) { return h(EventCard, { key: eventIdentity(event, ""), event: event, t: t, teamsById: props.teamsById || {} }); })) : h("div", { className: "dat-note dat-task-live-empty" }, t("noEvents")),
                events.length > eventLimit ? h("p", { className: "dat-note" }, t("taskTimelineLimited", { count: eventLimit })) : null,
                task.updatedAt || task.createdAt ? h("p", { className: "dat-note dat-task-live-last" }, t("lastActivity", { value: formatTime(task.updatedAt || task.createdAt) })) : null
              )
            )
          )
        )
      );
    }

    function WorkspaceNav(props) {
      var t = props.t, counts = props.counts || {};
      var items = [
        { id: "board", label: t("workspaceBoard"), count: counts.tasks },
        { id: "projectTasks", label: t("workspaceProjectTasks") },
        { id: "canvas", label: t("workspaceCanvas"), count: counts.members },
        { id: "flow", label: t("workspaceFlow") },
        { id: "automation", label: t("workspaceAutomation"), count: counts.schedules },
        { id: "participants", label: t("workspaceParticipants"), count: counts.members },
        { id: "inbox", label: t("workspaceInbox"), count: counts.events }
      ];
      return h("nav", { className: "dat-workspace-nav", "data-mobile-slot": "agent-teams.navigation", "aria-label": t("workspaceNavigation") }, items.map(function (item) {
        return h("button", { key: item.id, type: "button", "data-mobile-slot": item.id === "projectTasks" ? "navigation.tasks" : item.id === "board" ? "navigation.agents" : "agent-teams.view." + item.id, "data-harness-mobile-workspace-view": item.id, "aria-current": props.value === item.id ? "page" : undefined, onClick: function () { props.onChange(item.id); } }, h("span", null, item.label), Number.isFinite(item.count) ? h("small", null, item.count) : null);
      }));
    }

    function taskBoardColumn(task) {
      var status = normalizeState(task.status || task.state || "pending");
      if (status === "completed") return "done";
      if (status === "cancelled") return "cancelled";
      if (status === "blocked" || status === "failed" || relationIds(task.blockedBy).length || relationIds(task.failedBy).length || relationIds(task.conflictsWith).length || task.permissionRequired === true || task.approvalRequired === true || task.confirmationRequired === true || task.requiresConfirmation === true || task.sideEffectApprovalRequired === true || task.stale === true || taskBoardPermissionAttention(task) || taskBoardEffectAttention(task)) return "attention";
      if (status === "in_progress" || status === "running") return "running";
      return "ready";
    }

    function taskBoardPermissionAttention(task) {
      return (Array.isArray(task && task.capabilities) ? task.capabilities : []).some(function (capability) {
        var status = String(capability && (capability.status || capability.state) || "").toLowerCase();
        return status === "unknown" || status === "denied" || status === "unavailable";
      });
    }

    function taskBoardEffectAttention(task) {
      return (Array.isArray(task && task.externalEffects) ? task.externalEffects : []).some(function (effect) {
        var policy = String(effect && effect.policy || "").toLowerCase(), outcome = String(effect && effect.outcome || "").toLowerCase();
        return policy === "confirm_each" || policy === "confirmation_required" || outcome === "outcome_unknown" || outcome === "unknown";
      });
    }

    function taskBoardAttempt(task) {
      var values = [task && task.attempt, task && task.attemptNumber, task && task.retryCount];
      for (var index = 0; index < values.length; index += 1) {
        if (values[index] === undefined || values[index] === null || values[index] === "") continue;
        var value = Number(values[index]), attempt = index === 2 ? value + 1 : value;
        if (Number.isSafeInteger(attempt) && attempt > 0) return attempt;
      }
      return null;
    }

    function taskBoardLeaseEpoch(task) {
      var value = Number(task && task.leaseEpoch);
      return Number.isSafeInteger(value) && value > 0 ? value : null;
    }

    function taskBoardCapabilitySummary(task) {
      var capabilities = Array.isArray(task && task.capabilities) ? task.capabilities : [];
      if (!capabilities.length) return null;
      return { verified: capabilities.filter(function (capability) { return String(capability && capability.status || "").toLowerCase() === "verified"; }).length, total: capabilities.length };
    }

    function taskBoardMilestones(task) {
      var progress = task && task.progress && typeof task.progress === "object" ? task.progress : task && task.milestones && typeof task.milestones === "object" ? task.milestones : null;
      var completed = Number(progress && (progress.completed ?? progress.done)), total = Number(progress && progress.total);
      return Number.isFinite(completed) && completed >= 0 && Number.isFinite(total) && total > 0 ? { completed: Math.min(completed, total), total: total } : null;
    }

    function taskBoardAttentionFacts(t, task) {
      var facts = [];
      var blocked = relationIds(task.blockedBy), failed = relationIds(task.failedBy), conflicts = relationIds(task.conflictsWith);
      if (blocked.length) facts.push(t("blockedBy", { value: blocked.join(", ") }));
      if (failed.length) facts.push(t("failedBy", { value: failed.join(", ") }));
      if (conflicts.length) facts.push(t("conflicts", { value: conflicts.join(", ") }));
      if (task.permissionRequired === true || task.permissionDenied === true || taskBoardPermissionAttention(task)) facts.push(t("boardPermissionAttention"));
      if (task.approvalRequired === true || task.confirmationRequired === true || task.requiresConfirmation === true) facts.push(t("boardNeedsConfirmation"));
      if (task.sideEffectApprovalRequired === true || taskBoardEffectAttention(task)) facts.push(t("boardSideEffectAttention"));
      if (task.stale === true) facts.push(t("boardStaleAttention"));
      var reason = typeof task.blockReason === "string" ? task.blockReason.trim() : typeof task.blockedReason === "string" ? task.blockedReason.trim() : "";
      if (reason && facts.indexOf(reason) < 0) facts.push(reason);
      return facts;
    }

    function taskBoardNextKey(column) {
      return column === "running" ? "boardNextRunning" : column === "attention" ? "boardNextAttention" : column === "done" ? "boardNextDone" : "boardNextReady";
    }

    function taskBoardColumnLabel(t, column) {
      return t(column === "running" ? "boardProgress" : column === "attention" ? "boardBlocked" : column === "done" ? "boardCompleted" : column === "cancelled" ? "boardCancelled" : "boardPending");
    }

    function taskBoardTime(task, fields) {
      for (var index = 0; index < fields.length; index += 1) {
        var raw = task && task[fields[index]];
        if (raw === undefined || raw === null || raw === "") continue;
        var value = Date.parse(raw);
        if (Number.isFinite(value)) return value;
      }
      return 0;
    }

    function sortBoardColumnTasks(tasks, columnId) {
      var pendingQueue = columnId === "ready";
      var fields = columnId === "done" ? ["completedAt", "updatedAt", "createdAt"] : columnId === "ready" ? ["createdAt", "updatedAt"] : ["updatedAt", "createdAt"];
      return tasks.slice().sort(function (left, right) {
        var leftTime = taskBoardTime(left, fields), rightTime = taskBoardTime(right, fields);
        var timeOrder = pendingQueue ? leftTime - rightTime : rightTime - leftTime;
        return timeOrder || String(taskId(left)).localeCompare(String(taskId(right)));
      });
    }

    function eventRelatesToTask(event, task) {
      if (!event || !task) return false;
      var id = String(taskId(task));
      var direct = [event.taskId, event.taskRef, event.fromTaskId, event.toTaskId, event.relatedTaskId].filter(function (value) { return value !== undefined && value !== null; }).map(String);
      if (direct.indexOf(id) >= 0) return true;
      var assigned = task.assigneeSessionId || task.assigneeId || task.assignee || task.memberId || "";
      if (!assigned) return false;
      return [event.fromSessionId, event.toSessionId, event.from, event.to, event.fromName, event.toName, event.memberId, event.actorId].some(function (value) { return String(value || "") === String(assigned); });
    }

    function planAuthorizationLabel(t, value) {
      var normalized = String(value || "unknown").toLowerCase();
      return t(normalized === "host_verified" ? "planAuthHostVerified" : normalized === "human_attested" ? "planAuthHumanAttested" : "planAuthUnknown");
    }

    function planAuthorizationTone(value) {
      var normalized = String(value || "unknown").toLowerCase();
      return normalized === "host_verified" ? "host_verified" : normalized === "human_attested" ? "autopilot" : "attention";
    }

    function taskCapabilityLabel(t, value) {
      var normalized = String(value || "unknown").toLowerCase();
      return t(normalized === "verified" ? "taskCapabilityVerified" : normalized === "unavailable" ? "taskCapabilityUnavailable" : "taskCapabilityUnknown");
    }

    function taskEffectPolicyLabel(t, value) {
      var normalized = String(value || "none").toLowerCase();
      return t(normalized === "idempotent" ? "effectPolicyIdempotent" : normalized === "confirm_each" ? "effectPolicyConfirmEach" : normalized === "forbidden" ? "effectPolicyForbidden" : "effectPolicyNone");
    }

    function taskEffectOutcomeLabel(t, value) {
      var normalized = String(value || "not_started").toLowerCase();
      return t(normalized === "succeeded" ? "effectOutcomeSucceeded" : normalized === "failed" ? "effectOutcomeFailed" : normalized === "outcome_unknown" ? "effectOutcomeUnknown" : "effectOutcomeNotStarted");
    }

    function taskHistoryKindLabel(t, value) {
      var normalized = String(value || "").toLowerCase();
      var labels = { claimed: "taskHistoryClaimed", migrated_claim: "taskHistoryMigratedClaim", released: "taskHistoryReleased", host_restart_during_provisioning: "taskHistoryRestarted", ownership_adopted: "taskHistoryOwnershipAdopted", member_start_failed: "taskHistoryMemberStartFailed", stop_before_provisioning: "taskHistoryStoppedBeforeStart", provisioning_failed: "taskHistoryProvisioningFailed", user_stop: "taskHistoryUserStop" };
      return labels[normalized] ? t(labels[normalized]) : t("taskHistoryOther", { value: normalized ? normalized.split("_").join(" ") : "unknown" });
    }

    function PlanLifecyclePanel(props) {
      var t = props.t, team = props.team || {}, plan = team.plan && typeof team.plan === "object" ? team.plan : {};
      var phase = String(plan.phase || "").toLowerCase(), phaseOrder = ["draft", "committed", "active"], phaseIndex = phaseOrder.indexOf(phase);
      var authorization = plan.authorization && typeof plan.authorization === "object" ? plan.authorization : {}, authorizationSource = String(authorization.source || "unknown").toLowerCase();
      var preflight = [
        { key: "permissions", label: t("planPreflightPermissions"), status: String(authorization.permissions || "unknown").toLowerCase() },
        { key: "files", label: t("planPreflightFiles"), status: String(authorization.files || "unknown").toLowerCase() },
        { key: "cost", label: t("planPreflightCost"), status: String(authorization.cost || "unknown").toLowerCase() },
        { key: "externalSideEffects", label: t("planPreflightEffects"), status: String(authorization.externalSideEffects || "unknown").toLowerCase() }
      ];
      var hasHumanAttested = authorizationSource === "human_attested" || preflight.some(function (item) { return item.status === "human_attested"; });
      var handoff = team.handoff && typeof team.handoff === "object" ? team.handoff : null;
      var ownershipHistory = (Array.isArray(team.ownershipHistory) ? team.ownershipHistory : []).slice(-5).reverse();
      var migrationKey = plan.migrationState === "legacy_unplanned" ? "planLegacyUnplanned" : plan.migrationState === "legacy_active_gate" ? "planLegacyActiveGate" : "";
      var phaseLabels = { draft: "planDraft", committed: "planCommitted", active: "planActive" };
      return h("section", { className: "dat-panel dat-plan-lifecycle", role: "region", "aria-labelledby": "dat-plan-lifecycle-title" },
        h("div", { className: "dat-plan-lifecycle-head" },
          h("div", null, h("h3", { id: "dat-plan-lifecycle-title" }, t("planLifecycleTitle")), h("p", { className: "dat-note" }, t("planLifecycleHint"))),
          h("div", { className: "dat-row" }, Number.isSafeInteger(Number(plan.revision)) ? h("span", { className: "dat-badge" }, t("planRevision", { value: Number(plan.revision) })) : null, h("span", { className: "dat-badge" }, t("planPauseEpoch", { value: Number.isSafeInteger(Number(team.pauseEpoch)) ? Number(team.pauseEpoch) : 0 })))
        ),
        h("ol", { className: "dat-plan-steps", "aria-label": t("planLifecycleTitle") }, phaseOrder.map(function (step, index) {
          var state = phaseIndex < 0 ? "pending" : index < phaseIndex ? "complete" : index === phaseIndex ? "current" : "pending";
          var at = step === "committed" ? plan.committedAt : step === "active" ? plan.activatedAt : "";
          return h("li", { key: step, className: "dat-plan-step", "data-state": state, "aria-current": state === "current" ? "step" : undefined }, h("span", null, h("strong", null, t(phaseLabels[step])), at ? h("time", { dateTime: String(at) }, formatTime(at)) : null));
        })),
        migrationKey ? h("p", { className: "dat-plan-migration", role: "note" }, t(migrationKey)) : null,
        h("div", { className: "dat-plan-grid" },
          h("section", { className: "dat-plan-subsection", "aria-labelledby": "dat-plan-preflight-title" },
            h("h4", { id: "dat-plan-preflight-title" }, t("planAuthorization")),
            h("p", { className: "dat-note" }, t("planAuthorizationSource", { value: planAuthorizationLabel(t, authorizationSource) })),
            hasHumanAttested ? h("p", { className: "dat-note", role: "note" }, t("planAuthorizationHumanAttestedHint")) : null,
            h("div", { className: "dat-preflight-grid", role: "list", "aria-label": t("planAuthorization") }, preflight.map(function (item) { var label = planAuthorizationLabel(t, item.status); return h("div", { key: item.key, className: "dat-preflight-item", role: "listitem" }, h("span", null, item.label), h("span", { className: "dat-status-chip", "data-status": planAuthorizationTone(item.status), role: "status", "aria-label": item.label + ": " + label }, label)); }))
          ),
          h("section", { className: "dat-plan-subsection", "aria-labelledby": "dat-handoff-title" },
            h("h4", { id: "dat-handoff-title" }, t("handoffTitle")),
            h("div", { className: "dat-handoff-state", "data-pending": handoff ? "true" : "false", role: "status", "aria-live": "polite" },
              h("strong", null, t(handoff ? "handoffPending" : "handoffNone")),
              handoff ? h("div", { className: "dat-handoff-meta" }, handoff.createdAt ? h("time", { dateTime: String(handoff.createdAt) }, t("handoffPreparedAt", { value: formatTime(handoff.createdAt) })) : null, handoff.expiresAt ? h("time", { dateTime: String(handoff.expiresAt) }, t("handoffExpiresAt", { value: formatTime(handoff.expiresAt) })) : null) : null
            ),
            ownershipHistory.length ? h("details", { className: "dat-handoff-history" }, h("summary", null, t("handoffHistory")), h("ul", { className: "dat-handoff-list" }, ownershipHistory.map(function (entry, index) { return h("li", { key: String(entry.at || index) + ":" + String(entry.kind || "") }, h("strong", null, t(entry.kind === "handoff_adopted" ? "handoffAdopted" : "handoffPrepared")), Number.isSafeInteger(Number(entry.pauseEpoch)) ? h("span", { className: "dat-note" }, " · " + t("planPauseEpoch", { value: Number(entry.pauseEpoch) })) : null, entry.at ? h("time", { dateTime: String(entry.at) }, formatTime(entry.at)) : null); })), team.projection && team.projection.ownershipHistoryTruncated ? h("p", { className: "dat-note" }, t("handoffHistoryMore", { count: ownershipHistory.length })) : null) : null
          )
        )
      );
    }

    function TaskAssurancePanel(props) {
      var t = props.t, task = props.task || {}, attempt = taskBoardAttempt(task), leaseEpoch = taskBoardLeaseEpoch(task);
      var capabilities = Array.isArray(task.capabilities) ? task.capabilities : [], effects = Array.isArray(task.externalEffects) ? task.externalEffects : [];
      var attemptHistory = Array.isArray(task.attemptHistory) ? task.attemptHistory : [], interruptions = Array.isArray(task.interruptionHistory) ? task.interruptionHistory : [];
      var history = attemptHistory.concat(interruptions).map(function (entry, index) { return { entry: entry || {}, index: index }; }).sort(function (left, right) { return Date.parse(right.entry.at || 0) - Date.parse(left.entry.at || 0) || right.index - left.index; });
      var visibleHistory = history.slice(0, 12), hasMemberReports = !!(task.checkpoint && typeof task.checkpoint.text === "string" && task.checkpoint.text.trim() || task.nextStep && typeof task.nextStep.text === "string" && task.nextStep.text.trim());
      return h("section", { className: "dat-task-assurance", "aria-labelledby": "dat-task-assurance-title" },
        h("h3", { id: "dat-task-assurance-title" }, t("taskAssuranceTitle")),
        h("p", { className: "dat-note" }, t("taskAssuranceHint")),
        attempt !== null || leaseEpoch !== null ? h("div", { className: "dat-assurance-current" }, attempt !== null ? h("span", { className: "dat-badge" }, t("taskCurrentAttempt") + " " + attempt) : null, leaseEpoch !== null ? h("span", { className: "dat-badge" }, t("taskCurrentLease") + " " + leaseEpoch) : null) : null,
        h("div", { className: "dat-assurance-grid" },
          h("section", { className: "dat-assurance-section", "aria-labelledby": "dat-task-capabilities-title" },
            h("h4", { id: "dat-task-capabilities-title" }, t("taskCapabilities")),
            capabilities.length ? h("ul", { className: "dat-assurance-list" }, capabilities.map(function (capability, index) { var status = String(capability && capability.status || "unknown").toLowerCase(); return h("li", { key: String(capability && capability.name || index) }, h("div", { className: "dat-assurance-item-head" }, h("strong", null, capability && capability.name || t("taskCapabilities")), h("span", { className: "dat-status-chip", "data-status": status }, taskCapabilityLabel(t, status))), capability && capability.checkedAt ? h("div", { className: "dat-assurance-item-meta" }, t("taskCapabilityChecked", { value: formatTime(capability.checkedAt) })) : null); })) : h("p", { className: "dat-note" }, t("taskCapabilitiesEmpty"))
          ),
          h("section", { className: "dat-assurance-section", "aria-labelledby": "dat-task-effects-title" },
            h("h4", { id: "dat-task-effects-title" }, t("taskEffects")),
            effects.length ? h("ul", { className: "dat-assurance-list" }, effects.map(function (effect, index) { var policy = String(effect && effect.policy || "none").toLowerCase(), outcome = String(effect && effect.outcome || "not_started").toLowerCase(); return h("li", { key: String(effect && effect.name || index) }, h("div", { className: "dat-assurance-item-head" }, h("strong", null, effect && effect.name || t("taskEffects")), h("span", { className: "dat-status-chip", "data-status": outcome }, taskEffectOutcomeLabel(t, outcome))), h("div", { className: "dat-assurance-item-meta" }, h("span", { className: "dat-status-chip", "data-status": policy }, taskEffectPolicyLabel(t, policy)))); })) : h("p", { className: "dat-note" }, t("taskEffectsEmpty"))
          ),
          hasMemberReports ? h("section", { className: "dat-assurance-section dat-assurance-section-wide", "aria-labelledby": "dat-task-reports-title" },
            h("h4", { id: "dat-task-reports-title" }, t("taskMemberReports")),
            h("ul", { className: "dat-assurance-list" }, task.checkpoint && typeof task.checkpoint.text === "string" && task.checkpoint.text.trim() ? h("li", null, h("strong", null, t("boardMemberCheckpoint")), h("div", { className: "dat-assurance-item-meta" }, taskResultPreviewText(task.checkpoint, 480))) : null, task.nextStep && typeof task.nextStep.text === "string" && task.nextStep.text.trim() ? h("li", null, h("strong", null, t("boardMemberNextStep")), h("div", { className: "dat-assurance-item-meta" }, taskResultPreviewText(task.nextStep, 480))) : null)
          ) : null,
          h("section", { className: "dat-assurance-section dat-assurance-section-wide", "aria-labelledby": "dat-task-history-title" },
            h("h4", { id: "dat-task-history-title" }, t("taskAttemptHistory")),
            visibleHistory.length ? h("ul", { className: "dat-assurance-list" }, visibleHistory.map(function (record) {
              var entry = record.entry, entryAttempt = Number(entry.attempt), entryLease = Number(entry.leaseEpoch), meta = [];
              if (Number.isSafeInteger(entryAttempt) && entryAttempt > 0) meta.push(t("boardAttempt", { value: entryAttempt }));
              if (Number.isSafeInteger(entryLease) && entryLease > 0) meta.push(t("boardLeaseEpoch", { value: entryLease }));
              return h("li", { key: String(entry.at || record.index) + ":" + String(entry.kind || "") + ":" + record.index, className: "dat-history-entry" }, h("div", { className: "dat-history-entry-copy" }, h("strong", null, taskHistoryKindLabel(t, entry.kind)), meta.length ? h("span", null, meta.join(" · ")) : null), entry.at ? h("time", { dateTime: String(entry.at) }, formatTime(entry.at)) : null);
            })) : h("p", { className: "dat-note" }, t("taskHistoryEmpty")),
            history.length > visibleHistory.length ? h("p", { className: "dat-note" }, t("taskTimelineLimited", { count: visibleHistory.length })) : null
          )
        )
      );
    }

    /*
     * Task-board column and card presentation adapted from
     * chuspeeism/dashi-taskboard at f12f473c0049757bd0090be418f9d969a1d91194,
     * Apache License 2.0. Harness modifications: plain React.createElement,
     * selected-team safe projection, derived blocked column, and read-only UI.
     */
    function BoardTaskCard(props) {
      var task = props.task, t = props.t, id = taskId(task), column = taskBoardColumn(task), truth = taskResponsibilityProjection(task);
      var assigned = truth.assignedId;
      var member = responsibilityMember(props.members, assigned), executor = responsibilityMember(props.members, truth.executorId);
      var owner = member ? simpleMemberName(member, member.isLead || member.kind === "lead" || memberSession(member) === props.leadSessionId, t) : t("unassigned");
      var executorName = executor ? simpleMemberName(executor, executor.isLead || executor.kind === "lead" || memberSession(executor) === props.leadSessionId, t) : truth.executorId ? t("actualExecutorUnknown") : truth.legacy ? t("actualExecutorLegacy") : "";
      var model = member ? memberModelText(member, t) : "", attempt = taskBoardAttempt(task), leaseEpoch = taskBoardLeaseEpoch(task), capabilitySummary = taskBoardCapabilitySummary(task), milestones = taskBoardMilestones(task), attentionFacts = taskBoardAttentionFacts(t, task);
      var updatedAt = task.updatedAt || task.lastActivityAt || task.completedAt || task.claimedAt || task.createdAt;
      return h("button", { type: "button", className: "dat-board-card", "data-state": column, onClick: function (event) { props.onOpen(event, task); }, "aria-label": (task.title || task.name || t("taskFallback", { id: id })) + " · " + taskBoardColumnLabel(t, column) },
        h("div", { className: "dat-board-card-top" }, h("span", { className: "dat-board-card-id" }, "#" + id), h("span", { className: "dat-board-card-flag" }, taskBoardColumnLabel(t, column))),
        h("div", { className: "dat-board-card-title" }, task.title || task.name || t("taskFallback", { id: id })),
        h("div", { className: "dat-board-card-owner" }, t("assignedMember") + ": " + owner, model ? " · " + model : ""),
        truth.executorId || column === "done" ? h("div", { className: "dat-board-card-owner dat-board-card-executor", "data-status": truth.deliveryKind === "missing_completed" || truth.acceptanceKind === "missing_completed" ? "attention" : truth.acceptanceKind }, t("actualExecutor") + ": " + (executorName || t("actualExecutorUnknown")) + " · " + deliveryLabel(t, truth.deliveryKind) + " · " + acceptanceLabel(t, truth.acceptanceKind)) : null,
        truth.release ? h("div", { className: "dat-board-card-facts", role: "note", "data-kind": "released" }, h("strong", null, t("taskReleased")), h("span", null, t("releaseReasonLabel") + ": " + (truth.release.reason || t("reasonUnavailable"))), truth.release.at ? h("time", { dateTime: String(truth.release.at) }, formatTime(truth.release.at)) : null) : null,
        truth.cancelled ? h("div", { className: "dat-board-card-facts", role: "note", "data-kind": "cancelled" }, h("strong", null, t("taskCancelled")), h("span", null, t("cancellationReasonLabel") + ": " + (truth.cancellation && truth.cancellation.reason || t("reasonUnavailable"))), truth.cancellation && truth.cancellation.at ? h("time", { dateTime: String(truth.cancellation.at) }, formatTime(truth.cancellation.at)) : null) : attentionFacts.length ? h("div", { className: "dat-board-card-facts", role: "note" }, h("strong", null, t("boardHostFacts")), attentionFacts.slice(0, 3).map(function (fact, index) { return h("span", { key: index }, fact); })) : null,
        milestones || attempt !== null || leaseEpoch !== null || capabilitySummary || updatedAt ? h("div", { className: "dat-board-card-flags" }, milestones ? h("span", { className: "dat-board-card-flag" }, t("boardMilestones", milestones)) : null, attempt !== null ? h("span", { className: "dat-board-card-flag" }, t("boardAttempt", { value: attempt })) : null, leaseEpoch !== null ? h("span", { className: "dat-board-card-flag" }, t("boardLeaseEpoch", { value: leaseEpoch })) : null, capabilitySummary ? h("span", { className: "dat-board-card-flag" }, t("boardCapabilities", capabilitySummary)) : null, updatedAt ? h("time", { className: "dat-board-card-time", dateTime: String(updatedAt) }, t("lastActivity", { value: formatTime(updatedAt) })) : null) : null,
        task.checkpoint && typeof task.checkpoint.text === "string" && task.checkpoint.text.trim() ? h("div", { className: "dat-board-card-result" }, h("strong", null, t("boardMemberCheckpoint")), h("span", null, taskResultPreviewText(task.checkpoint, 180))) : null,
        task.nextStep && typeof task.nextStep.text === "string" && task.nextStep.text.trim() ? h("div", { className: "dat-board-card-result" }, h("strong", null, t("boardMemberNextStep")), h("span", null, taskResultPreviewText(task.nextStep, 180))) : null,
        visibleTaskResult(task) ? h("div", { className: "dat-board-card-result", "data-provenance": truth.legacy ? "legacy_migration" : "current" }, h("strong", null, truth.legacy ? t("legacyResultPreview") : t("boardCheckpoint")), h("span", null, taskResultPreviewText(visibleTaskResult(task), 180))) : null,
        h("div", { className: "dat-board-card-next" }, t(taskBoardNextKey(column)))
      );
    }

    function cancelledHistoryProjection(t) {
      return { id: "cancelled", label: t("boardCancelled"), limit: 200 };
    }

    function TaskBoardWorkspace(props) {
      var t = props.t, team = props.team, tasks = team && team.tasks || [], members = team && team.members || [];
      var totalTaskCount = Number.isFinite(team && team.taskCount) ? team.taskCount : tasks.length;
      var projectionLimited = !!(team && team.projection && team.projection.tasksTruncated) || totalTaskCount > tasks.length;
      var selectedPair = useState(""), selectedTaskId = selectedPair[0], setSelectedTaskId = selectedPair[1];
      var noticePair = useState(""), selectionNotice = noticePair[0], setSelectionNotice = noticePair[1];
      var detailRef = useRef(null), triggerRef = useRef(null), restoreFocusRef = useRef(false);
      var selectedTask = tasks.filter(function (task) { return taskId(task) === selectedTaskId; })[0] || null;
      var taskDetailLive = useTaskDetailState(props.sessionId, team && teamId(team), selectedTaskId);
      var selectedAssignee = selectedTask ? members.filter(function (member) { var assigned = selectedTask.assigneeSessionId || selectedTask.assigneeId || selectedTask.assignee || selectedTask.memberId || ""; return memberSession(member) === assigned || memberId(member) === assigned; })[0] || null : null;
      var responsible = members.filter(function (member) { return memberSession(member) === (team && team.leadSessionId) || member.kind === "lead"; })[0] || null;
      var teamsById = {}; (props.teams || []).forEach(function (item) { teamsById[teamId(item)] = item; });
      var events = [], seenEvents = {};
      if (team) {
        (team.events || team.messages || []).forEach(function (event) { pushUniqueEvent(events, seenEvents, event, teamId(team)); });
        (team.inboundEvents || []).forEach(function (event) { pushUniqueEvent(events, seenEvents, event, event.fromTeamId); });
      }
      events.sort(function (left, right) { return Date.parse(right.createdAt || right.timestamp || right.at || 0) - Date.parse(left.createdAt || left.timestamp || left.at || 0); });
      var selectedTaskEvents = selectedTask ? events.filter(function (event) { return eventRelatesToTask(event, selectedTask); }) : [];
      function closeTaskDetail() { restoreFocusRef.current = true; setSelectedTaskId(""); }
      function openTaskDetail(event, task) { if (!task || !taskId(task)) return; triggerRef.current = event && event.currentTarget; restoreFocusRef.current = false; setSelectionNotice(""); setSelectedTaskId(taskId(task)); }
      useEffect(function () { restoreFocusRef.current = false; setSelectedTaskId(""); setSelectionNotice(""); }, [team && teamId(team)]);
      useEffect(function () { if (selectedTaskId && !selectedTask) { restoreFocusRef.current = true; setSelectedTaskId(""); setSelectionNotice(t("taskSelectionExpired")); } }, [selectedTaskId, selectedTask]);
      useEffect(function () {
        if (!selectedTaskId) {
          if (restoreFocusRef.current) { restoreFocusRef.current = false; if (triggerRef.current && typeof triggerRef.current.focus === "function") triggerRef.current.focus(); }
          return;
        }
        if (detailRef.current && typeof detailRef.current.focus === "function") detailRef.current.focus();
        var onKey = function (event) { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); closeTaskDetail(); } };
        document.addEventListener("keydown", onKey);
        return function () { document.removeEventListener("keydown", onKey); };
      }, [selectedTaskId]);
      var columns = [
        { id: "ready", label: t("boardPending"), limit: 200 },
        { id: "running", label: t("boardProgress"), limit: 200 },
        { id: "attention", label: t("boardBlocked"), limit: 200 },
        { id: "done", label: t("boardCompleted"), limit: 200 }
      ];
      var cancelledHistory = cancelledHistoryProjection(t);
      var cancelledTasks = sortBoardColumnTasks(tasks.filter(function (task) { return taskBoardColumn(task) === cancelledHistory.id; }), cancelledHistory.id);
      return h("section", { className: "dat-workspace-view", "aria-labelledby": "dat-task-board-title", "aria-readonly": "true" },
        h("div", { className: "dat-workspace-view-head" }, h("div", null, h("h2", { id: "dat-task-board-title" }, t("boardTitle")), h("p", null, t("boardIntro"))), h("div", { className: "dat-workspace-view-actions" }, h("span", { className: "dat-badge" }, t("boardReadOnly")), h(Button, { small: true, onClick: function () { props.setWorkspaceView("canvas"); } }, t("boardOpenCanvas")))),
        normalizeState(team.status || team.state) === "closed" || team.closure ? h(TeamClosureBanner, { t: t, team: team }) : null,
        h("div", { className: "dat-board-toolbar" }, h("div", null, h("strong", null, teamName(team, t)), h("div", { className: "dat-note", style: { marginTop: 2 } }, team.objective || t("unknown"))), h("div", { className: "dat-row" }, h("span", { className: "dat-badge" }, t("boardScope")), h("span", { className: "dat-badge" }, t("revision", { value: team.revision || "–" })) )),
        h(PlanLifecyclePanel, { t: t, team: team }),
        h("div", { className: "dat-board-note", role: "note" }, h("span", { "aria-hidden": "true" }, "ⓘ"), h("span", null, t("boardReadOnlyHint"), " ", t("boardBlockedDerived"), " ", t("boardFactLegend"))),
        projectionLimited ? h("div", { className: "dat-board-note dat-board-projection-note", role: "note" }, h("span", { "aria-hidden": "true" }, "⚠"), h("span", null, t("boardProjectionLimited", { shown: tasks.length, total: totalTaskCount }))) : null,
        selectionNotice ? h("div", { className: "dat-board-note", role: "status" }, h("span", { "aria-hidden": "true" }, "ⓘ"), h("span", null, selectionNotice)) : null,
        h("div", { className: "dat-board-shell" + (selectedTaskId ? " dat-task-focus-open" : "") },
          h("div", { className: "dat-board-main", hidden: !!selectedTaskId, "aria-hidden": selectedTaskId ? true : undefined, inert: selectedTaskId ? "" : undefined },
            h("div", { className: "dat-task-board" }, columns.map(function (column) {
              var columnTasks = sortBoardColumnTasks(tasks.filter(function (task) { return taskBoardColumn(task) === column.id; }), column.id);
              var visible = columnTasks.slice(0, column.limit);
              return h("section", { key: column.id, className: "dat-board-column", "data-column": column.id, "aria-labelledby": "dat-board-column-" + column.id },
                h("div", { className: "dat-board-column-head" }, h("div", { className: "dat-board-column-heading" }, h("span", { className: "dat-board-status-dot", "aria-hidden": "true" }), h("h3", { id: "dat-board-column-" + column.id }, column.label)), h("span", { className: "dat-badge" }, columnTasks.length)),
                h("div", { className: "dat-board-column-list" }, visible.length ? visible.map(function (task) { return h(BoardTaskCard, { key: taskId(task), task: task, members: members, leadSessionId: team.leadSessionId, t: t, onOpen: openTaskDetail }); }) : h("div", { className: "dat-board-empty" }, t("boardEmpty")), columnTasks.length > visible.length ? h("div", { className: "dat-board-overflow" }, t("boardMore", { count: columnTasks.length - visible.length })) : null)
              );
            })),
            cancelledTasks.length ? h("details", { className: "dat-board-history" }, h("summary", null, t("boardOpenCancelled", { count: cancelledTasks.length })), h("p", { className: "dat-note" }, t("boardCancelledHistoryHint")), h("div", { className: "dat-board-history-list" }, cancelledTasks.slice(0, cancelledHistory.limit).map(function (task) { return h(BoardTaskCard, { key: taskId(task), task: task, members: members, leadSessionId: team.leadSessionId, t: t, onOpen: openTaskDetail }); }))) : null
          ),
          selectedTaskId ? h(TaskDetailFocus, { t: t, task: selectedTask, assignee: selectedAssignee, responsible: responsible, members: members, leadSessionId: team.leadSessionId, runtimeDetail: taskDetailLive.detail, runtimeError: taskDetailLive.error, detailConnection: taskDetailLive.connection, events: selectedTaskEvents, tasks: tasks, teamsById: teamsById, connection: props.connection, detailRef: detailRef, onClose: closeTaskDetail }) : null
        )
      );
    }

    function EmptyTaskBoardWorkspace(props) {
      var t = props.t;
      var columns = [
        { id: "ready", label: t("boardPending") },
        { id: "running", label: t("boardProgress") },
        { id: "attention", label: t("boardBlocked") },
        { id: "done", label: t("boardCompleted") }
      ];
      return h(React.Fragment, null,
        h("section", { className: "dat-workspace-view dat-empty-workbench", "data-empty-workspace": "board", "aria-labelledby": "dat-empty-board-title", "aria-readonly": "true" },
          h("div", { className: "dat-workspace-view-head" }, h("div", null, h("h2", { id: "dat-empty-board-title" }, t("emptyBoardTitle")), h("p", null, t("emptyBoardIntro"))), h("span", { className: "dat-badge" }, t("emptyBoardWaiting"))),
          h("div", { className: "dat-board-note", role: "note" }, h("span", { "aria-hidden": "true" }, "ⓘ"), h("span", null, t("emptyBoardHint"))),
          h("div", { className: "dat-board-main" }, h("div", { className: "dat-task-board" }, columns.map(function (column) {
            return h("section", { key: column.id, className: "dat-board-column", "data-column": column.id, "aria-labelledby": "dat-empty-board-column-" + column.id },
              h("div", { className: "dat-board-column-head" }, h("div", { className: "dat-board-column-heading" }, h("span", { className: "dat-board-status-dot", "aria-hidden": "true" }), h("h3", { id: "dat-empty-board-column-" + column.id }, column.label)), h("span", { className: "dat-badge" }, "0")),
              h("div", { className: "dat-board-column-list" }, h("div", { className: "dat-board-empty" }, t("boardEmpty")))
            );
          })))
        ),
        h("div", { className: "dat-onboarding-slot" }, h(FirstTeamWizard, { t: t, setDraft: props.setDraft, setView: props.setView, disable: props.disable, busy: props.busy }))
      );
    }

    function EmptyTeamCanvasWorkspace(props) {
      var t = props.t;
      var nodes = [
        ["emptyCanvasGoal", "emptyCanvasGoalBody"],
        ["emptyCanvasLead", "emptyCanvasLeadBody"],
        ["emptyCanvasWork", "emptyCanvasWorkBody"],
        ["emptyCanvasCoordination", "emptyCanvasCoordinationBody"]
      ];
      var route = [];
      nodes.forEach(function (node, index) {
        route.push(h("article", { key: node[0], className: "dat-empty-canvas-node" }, h("strong", null, t(node[0])), h("span", null, t(node[1]))));
        if (index < nodes.length - 1) route.push(h("div", { key: node[0] + "-arrow", className: "dat-empty-canvas-arrow", "aria-hidden": "true" }, "→"));
      });
      return h("section", { className: "dat-workspace-view", "data-empty-workspace": "canvas", "aria-labelledby": "dat-empty-canvas-title", "aria-readonly": "true" },
        h("div", { className: "dat-workspace-view-head" }, h("div", null, h("h2", { id: "dat-empty-canvas-title" }, t("emptyCanvasTitle")), h("p", null, t("emptyCanvasIntro"))), h("span", { className: "dat-badge" }, t("emptyBoardWaiting"))),
        h("div", { className: "dat-panel dat-empty-canvas-panel" },
          h("div", { className: "dat-empty-canvas-route" }, route),
          h("div", { className: "dat-empty-canvas-footer" }, h("span", { className: "dat-note" }, t("emptyCanvasWaiting")), typeof props.setView === "function" ? h(Button, { primary: true, onClick: function () { props.setView("chat"); } }, t("backToChat")) : null)
        )
      );
    }

    function projectTaskCapabilityKind(state) {
      if (!state) return "loading";
      var capability = state.capability && typeof state.capability === "object" ? state.capability : {};
      var reason = String(capability.reason || state.reason || "").toLowerCase().replace(/[^a-z]/g, "");
      if (capability.kind === "no-project" || reason.indexOf("noproject") >= 0 || reason.indexOf("notcreated") >= 0) return "no-project";
      if (capability.kind === "collaborator" || reason.indexOf("collaborator") >= 0 || reason.indexOf("remote") >= 0) return "collaborator";
      if (capability.kind === "authority" || capability.available === true || state.available === true) return "ready";
      return "unavailable";
    }

    function projectTaskStatusLabel(t, status) {
      var labels = { backlog: "projectTaskBacklog", todo: "projectTaskTodo", in_progress: "projectTaskInProgress", in_review: "projectTaskInReview", blocked: "projectTaskBlocked", done: "projectTaskDone", canceled: "projectTaskCanceled" };
      return t(labels[String(status || "").toLowerCase()] || "unknown");
    }

    function collaboratorTaskTargets(status) {
      var transitions = { backlog: ["todo", "canceled"], todo: ["backlog", "in_progress", "canceled"], in_progress: ["todo", "canceled"], in_review: ["in_progress", "canceled"], blocked: ["todo", "in_progress", "canceled"], done: ["todo"], canceled: ["backlog"] };
      return transitions[String(status || "").toLowerCase()] || [];
    }

    function projectTaskColumn(status) {
      var value = String(status || "").toLowerCase();
      if (value === "backlog" || value === "todo") return "queue";
      if (value === "in_progress" || value === "in_review") return "active";
      if (value === "blocked") return "blocked";
      return "finished";
    }

    function projectTaskNextAction(error, t) {
      var value = String(error && error.nextAction || "").toLowerCase().replace(/[^a-z]/g, "");
      if (value.indexOf("setting") >= 0 || value.indexOf("project") >= 0) return t("projectTasksSettingsHint");
      if (value.indexOf("refresh") >= 0 || value.indexOf("reload") >= 0 || value.indexOf("latest") >= 0) return t("projectTasksRetryHint");
      if (value.indexOf("new") >= 0 || value.indexOf("intent") >= 0 || value.indexOf("again") >= 0) return t("projectTasksNewIntentHint");
      return t("projectTasksGenericHint");
    }

    function ProjectTasksWorkspace(props) {
      var t = props.t, tasks = useProjectTasksState();
      var titlePair = useState(""), title = titlePair[0], setTitle = titlePair[1];
      var busyPair = useState({}), busyKeys = busyPair[0], setBusyKeys = busyPair[1];
      var actionErrorPair = useState(null), actionError = actionErrorPair[0], setActionError = actionErrorPair[1];
      var pendingPair = useState({}), pendingReceipts = pendingPair[0], setPendingReceipts = pendingPair[1];
      var capabilityKind = projectTaskCapabilityKind(tasks.state), capability = tasks.state && tasks.state.capability, collaborator = capabilityKind === "collaborator";
      var canCreate = capability && capability.canCreate === true, canWrite = collaborator && capability.available === true && capability.writable === true;
      var safeTasks = (capabilityKind === "ready" || collaborator) && tasks.state && Array.isArray(tasks.state.tasks) ? tasks.state.tasks : null;
      function setBusyKey(actionKey, value) {
        setBusyKeys(function (current) { var next = Object.assign({}, current); if (value === false) delete next[actionKey]; else next[actionKey] = true; return next; });
      }
      function perform(actionKey, body, afterSuccess) {
        if (busyKeys[actionKey] === true) return Promise.resolve();
        setBusyKey(actionKey); setActionError(null);
        return postProjectTaskAction(body).then(function (result) { setPendingReceipts(function (current) { var next = Object.assign({}, current); if (result && result.queued === true) next[actionKey] = true; else delete next[actionKey]; return next; }); if (typeof afterSuccess === "function") afterSuccess(); return tasks.reload(); }).catch(function (error) { setActionError(error); }).finally(function () { setBusyKey(actionKey, false); });
      }
      function createTask(event) {
        event.preventDefault();
        if (!canCreate || !title.trim() || busyKeys.create) return;
        return perform("create", { commandId: newProjectTaskCommandId(), type: "create", expectedRevision: 0, payload: { title: title.trim() } }, function () { setTitle(""); });
      }
      function claimTask(safeTask) {
        var actionKey = "claim:" + safeTask.taskRef;
        if (!canWrite || capability.taskCommands.indexOf("claim") < 0 || safeTask.allowedActions.indexOf("claim") < 0 || safeTask.status !== "todo" || safeTask.hasAssignee) return Promise.resolve();
        return perform(actionKey, { commandId: newProjectTaskCommandId(), type: "claim", taskRef: safeTask.taskRef, expectedRevision: safeTask.revision, payload: {} });
      }
      function transitionTask(safeTask, nextStatus) {
        var actionKey = "transition:" + safeTask.taskRef + ":" + nextStatus;
        if (collaborator && (!canWrite || capability.taskCommands.indexOf("transition") < 0 || safeTask.allowedActions.indexOf("transition") < 0 || collaboratorTaskTargets(safeTask.status).indexOf(nextStatus) < 0)) return Promise.resolve();
        return perform(actionKey, { commandId: newProjectTaskCommandId(), type: "transition", taskRef: safeTask.taskRef, expectedRevision: safeTask.revision, payload: { to: nextStatus } });
      }
      var head = h("div", { className: "dat-workspace-view-head" }, h("div", null, h("h2", { id: "dat-project-tasks-title" }, t("projectTasksTitle")), h("p", null, t("projectTasksIntro")), h("p", { className: "dat-note", "data-mobile-slot": "tasks.context", "data-harness-mobile-project-bound": "true" }, t("workspaceProjectTasks") + " · " + capabilityKind)), h(Button, { small: true, disabled: tasks.loading, onClick: tasks.reload }, t("projectTasksRefresh")));
      if (tasks.loading && !tasks.state) return h("section", { className: "dat-workspace-view", "aria-labelledby": "dat-project-tasks-title" }, head, h("div", { className: "dat-panel dat-empty", role: "status" }, h("p", null, t("projectTasksLoading"))));
      if (tasks.error && !tasks.state) return h("section", { className: "dat-workspace-view", "aria-labelledby": "dat-project-tasks-title" }, head, h("div", { className: "dat-error", role: "alert" }, projectTaskErrorSummary(tasks.error, t), " ", projectTaskNextAction(tasks.error, t)));
      if (capabilityKind === "no-project") return h("section", { className: "dat-workspace-view", "aria-labelledby": "dat-project-tasks-title" }, head, h("div", { className: "dat-panel dat-empty" }, h("p", null, t("projectTasksNoProject")), h(Button, { primary: true, onClick: function () { props.setWorkspaceView("participants"); } }, t("projectTasksOpenSettings"))));
      if (capabilityKind !== "ready" && !collaborator) return h("section", { className: "dat-workspace-view", "aria-labelledby": "dat-project-tasks-title" }, head, h("div", { className: "dat-panel dat-empty" }, h("p", null, t("projectTasksUnavailable"))));
      var columns = [
        { id: "queue", label: t("projectTaskColumnPlanned") },
        { id: "active", label: t("projectTaskColumnActive") },
        { id: "blocked", label: t("projectTaskColumnBlocked") },
        { id: "finished", label: t("projectTaskColumnFinished") }
      ];
      return h("section", { className: "dat-workspace-view", "data-mobile-slot": "tasks.workspace", "data-harness-mobile-project-bound": "true", "aria-labelledby": "dat-project-tasks-title" }, head,
        tasks.error ? h("div", { className: "dat-error", role: "alert" }, projectTaskErrorSummary(tasks.error, t), " ", projectTaskNextAction(tasks.error, t)) : null,
        actionError ? h("div", { className: "dat-error", role: "alert" }, projectTaskErrorSummary(actionError, t), " ", projectTaskNextAction(actionError, t)) : null,
        collaborator ? h("div", { className: "dat-board-note", role: "status" }, h("span", { "aria-hidden": "true" }, "ⓘ"), h("span", null, t("projectTasksCollaboratorUnavailable"), " ", t(capability.available && canWrite ? "projectTasksWritable" : "projectTasksReadOnly"))) : null,
        Object.keys(pendingReceipts).length ? h("div", { className: "dat-board-note", role: "status" }, h("span", { "aria-hidden": "true" }, "⌛"), h("span", null, t("projectTasksPendingReceipt"))) : null,
        canCreate ? h("form", { className: "dat-panel dat-project-tasks-form", onSubmit: createTask }, h("label", { className: "dat-label" }, t("projectTasksTitleLabel"), h("input", { className: "dat-field", value: title, maxLength: 500, disabled: busyKeys.create === true, placeholder: t("projectTasksTitlePlaceholder"), onChange: function (event) { setTitle(event.target.value); } })), h(Button, { type: "submit", primary: true, disabled: busyKeys.create === true || !title.trim() }, busyKeys.create === true ? t("projectTasksCreating") : t("projectTasksCreate"))) : h("div", { className: "dat-panel dat-empty", role: "note" }, h("p", null, t("projectTasksCreateUnavailable"))),
        h("div", { className: "dat-board-note", role: "note" }, h("span", { "aria-hidden": "true" }, "ⓘ"), h("span", null, t("projectTasksExplicitOnly"))),
        tasks.state.hasMore ? h("div", { className: "dat-board-note", role: "note" }, h("span", { "aria-hidden": "true" }, "ⓘ"), h("span", null, t("projectTasksHasMore"))) : null,
        safeTasks.length ? h("div", { className: "dat-project-task-columns" }, columns.map(function (column) {
          var columnTasks = safeTasks.filter(function (safeTask) { return projectTaskColumn(safeTask.status) === column.id; });
          return h("section", { key: column.id, className: "dat-project-task-column", "data-column": column.id },
            h("div", { className: "dat-column-head" }, h("h3", null, column.label), h("span", { className: "dat-badge" }, columnTasks.length)),
            h("div", { className: "dat-project-task-list" }, columnTasks.length ? columnTasks.map(function (safeTask) {
              var allowed = collaborator && canWrite && capability.taskCommands.indexOf("transition") >= 0 && safeTask.allowedActions.indexOf("transition") >= 0 ? collaboratorTaskTargets(safeTask.status) : Array.isArray(safeTask.allowedTransitions) ? safeTask.allowedTransitions : [];
              var canClaim = collaborator && canWrite && capability.taskCommands.indexOf("claim") >= 0 && safeTask.allowedActions.indexOf("claim") >= 0 && safeTask.status === "todo" && !safeTask.hasAssignee;
              return h("article", { key: safeTask.taskRef, className: "dat-card dat-project-task-card", "data-mobile-slot": "tasks.item", "data-harness-mobile-task-id": String(safeTask.taskRef) },
                h("h4", null, safeTask.title || t("unknown")),
                h("div", { className: "dat-row" }, h("span", { className: "dat-badge" }, projectTaskStatusLabel(t, safeTask.status)), h("span", { className: "dat-badge" }, t("projectTasksRevision", { value: safeTask.revision }))),
                canClaim || allowed.length ? h("div", { className: "dat-actions" }, canClaim ? h(Button, { small: true, disabled: busyKeys["claim:" + safeTask.taskRef] === true || pendingReceipts["claim:" + safeTask.taskRef] === true, onClick: function () { claimTask(safeTask); } }, busyKeys["claim:" + safeTask.taskRef] === true ? t("projectTasksActionRunning") : t("projectTasksClaim")) : null, allowed.map(function (nextStatus) {
                  var actionKey = "transition:" + safeTask.taskRef + ":" + nextStatus;
                  return h(Button, { key: nextStatus, small: true, disabled: busyKeys[actionKey] === true || pendingReceipts[actionKey] === true, onClick: function () { transitionTask(safeTask, nextStatus); } }, busyKeys[actionKey] === true ? t("projectTasksActionRunning") : t("projectTasksChangeTo", { value: projectTaskStatusLabel(t, nextStatus) }));
                })) : null
              );
            }) : h("div", { className: "dat-board-empty" }, t("boardEmpty")))
          );
        })) : h("div", { className: "dat-panel dat-empty" }, h("p", null, t("projectTasksEmpty")))
      );
    }

    function normalizeProjectFoundationsState(input) {
      var source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
      var modes = ["authority", "collaborator", "unavailable"], statuses = ["authority_managed", "git_unavailable", "not_created", "not_initialized", "ready", "root_unavailable", "source_dirty", "source_invalid", "status_unavailable"], attentionTokens = ["connector_credentials_unavailable", "connector_disabled", "git_unavailable", "merge_conflict", "merge_queue_empty", "root_unavailable", "runner_unavailable", "source_dirty", "source_invalid", "status_unavailable"];
      function count(value) { return Number.isSafeInteger(value) && value >= 0 ? Math.min(value, 1000000) : 0; }
      var mode = modes.indexOf(source.mode) >= 0 ? source.mode : "unavailable", sourceStatus = statuses.indexOf(source.sourceStatus) >= 0 ? source.sourceStatus : "status_unavailable";
      var attention = Object.freeze(Array.isArray(source.attention) ? source.attention.filter(function (value, index, all) { return attentionTokens.indexOf(value) >= 0 && all.indexOf(value) === index; }).sort() : []);
      return Object.freeze({ ok: source.ok === true, mode: mode, available: source.available === true, ready: source.ready === true, sourceStatus: sourceStatus, workspaceCount: count(source.workspaceCount), claimCount: count(source.claimCount), queuedChangeSetCount: count(source.queuedChangeSetCount), campaignCount: count(source.campaignCount), queuedJobCount: count(source.queuedJobCount), runningJobCount: count(source.runningJobCount), defectCount: count(source.defectCount), outboxPendingCount: count(source.outboxPendingCount), attention: attention });
    }

    function projectFoundationStatus(state) {
      if (!state || state.mode === "unavailable" || state.available !== true || state.sourceStatus === "not_created") return "unavailable";
      if (state.mode === "collaborator" || state.sourceStatus === "authority_managed") return "collaborator";
      if (state.sourceStatus === "not_initialized" || state.sourceStatus === "status_unavailable") return "initializing";
      if (["source_invalid", "root_unavailable", "git_unavailable"].indexOf(state.sourceStatus) >= 0) return "invalid";
      if (state.sourceStatus === "source_dirty") return "dirty";
      if (state.attention.indexOf("merge_conflict") >= 0) return "conflict";
      if (state.defectCount > 0) return "defect";
      if (state.outboxPendingCount > 0) return "outbox";
      if (state.runningJobCount > 0 || state.queuedJobCount > 0) return "quality-running";
      if (state.attention.indexOf("runner_unavailable") >= 0) return "quality-waiting";
      if (state.queuedChangeSetCount > 0) return "merge";
      if (state.attention.indexOf("connector_disabled") >= 0 || state.attention.indexOf("connector_credentials_unavailable") >= 0) return "connector";
      return state.ready ? "ready" : "initializing";
    }

    function useProjectFoundationsState() {
      var statePair = useState(null), state = statePair[0], setState = statePair[1], loadingPair = useState(true), loading = loadingPair[0], setLoading = loadingPair[1], errorPair = useState(""), error = errorPair[0], setError = errorPair[1], generationRef = useRef(0);
      function reload() { var generation = ++generationRef.current; setLoading(true); setError(""); return fetch("/api/agent-teams/project/foundations/state", { method: "GET", cache: "no-store", credentials: "same-origin", headers: { Accept: "application/json", "x-harness-agent-teams": "1" } }).then(function (response) { return response.json().catch(function () { return {}; }).then(function (body) { if (!response.ok) throw new Error("HTTP " + response.status); return normalizeProjectFoundationsState(body); }); }).then(function (next) { if (generation === generationRef.current) setState(next); }).catch(function () { if (generation === generationRef.current) { setState(normalizeProjectFoundationsState({ mode: "unavailable", sourceStatus: "status_unavailable", attention: ["status_unavailable"] })); setError("status_unavailable"); } }).finally(function () { if (generation === generationRef.current) setLoading(false); }); }
      useEffect(function () { reload().catch(function () {}); return function () { generationRef.current += 1; }; }, []);
      return { state: state, loading: loading, error: error, reload: reload };
    }

    function ProjectFoundationStatusCard(props) {
      var t = props.t, live = props.live, state = live.state, status = projectFoundationStatus(state), keys = { unavailable: ["foundationUnavailableTitle", "foundationUnavailableBody"], initializing: ["foundationInitializingTitle", "foundationInitializingBody"], ready: ["foundationReadyTitle", "foundationReadyBody"], invalid: ["foundationInvalidTitle", "foundationInvalidBody"], dirty: ["foundationDirtyTitle", "foundationDirtyBody"], conflict: ["foundationConflictTitle", "foundationConflictBody"], merge: ["foundationMergeTitle", "foundationMergeBody"], "quality-waiting": ["foundationQualityWaitTitle", "foundationQualityWaitBody"], "quality-running": ["foundationQualityRunTitle", "foundationQualityRunBody"], defect: ["foundationDefectTitle", "foundationDefectBody"], connector: ["foundationConnectorTitle", "foundationConnectorBody"], outbox: ["foundationOutboxTitle", "foundationOutboxBody"], collaborator: ["foundationCollaboratorTitle", "foundationCollaboratorBody"] }, copy = keys[status] || keys.unavailable;
      return h("section", { className: "dat-panel dat-foundation-status", "aria-labelledby": "dat-foundation-title", "aria-live": "polite" }, h("div", { className: "dat-column-head" }, h("div", null, h("h3", { id: "dat-foundation-title" }, t("foundationTitle")), h("strong", null, t(copy[0]))), state && state.mode === "authority" ? h(Button, { small: true, disabled: live.loading, onClick: function () { live.reload().catch(function () {}); } }, t("foundationRefresh")) : null), h("p", { className: "dat-meta" }, t(copy[1])), state ? h("p", { className: "dat-note", style: { marginBottom: 0 } }, t("foundationCounts", { workspaces: state.workspaceCount, claims: state.claimCount, changes: state.queuedChangeSetCount, queued: state.queuedJobCount, running: state.runningJobCount, defects: state.defectCount })) : null);
    }

    function FlowWorkspace(props) {
      var t = props.t, foundations = useProjectFoundationsState();
      var steps = [
        ["flowGoal", "flowGoalBody"], ["flowPlan", "flowPlanBody"], ["flowTasks", "flowTasksBody"],
        ["flowMembers", "flowMembersBody"], ["flowCoordinate", "flowCoordinateBody"], ["flowResult", "flowResultBody"]
      ];
      return h("section", { className: "dat-workspace-view dat-flow-blueprint", "aria-labelledby": "dat-flow-title", "aria-readonly": "true" },
        h("div", { className: "dat-workspace-view-head" }, h("div", null, h("h2", { id: "dat-flow-title" }, t("flowTitle")), h("p", null, t("flowIntro"))), h("span", { className: "dat-badge" }, t("flowReadOnly"))),
        h("div", { className: "dat-flow-chain" }, steps.map(function (step, index) { return h("article", { key: step[0], className: "dat-flow-step" }, h("strong", null, (index + 1) + ". " + t(step[0])), h("span", null, t(step[1]))); })),
        h(ProjectFoundationStatusCard, { t: t, live: foundations }),
        h("p", { className: "dat-flow-boundary" }, t("projectAutomationPending"))
      );
    }

    function normalizeProjectAutomationsState(input) {
      var source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
      var rawCapability = source.capability && typeof source.capability === "object" && !Array.isArray(source.capability) ? source.capability : {};
      var kinds = ["authority", "collaborator", "no-project", "unavailable"];
      var definitionActions = ["enable", "disable", "run"], runActions = ["approve", "reject", "retry", "cancel"];
      function text(value, max) { return typeof value === "string" ? value.slice(0, max) : ""; }
      function actions(value, allowed) { return Object.freeze(Array.isArray(value) ? value.filter(function (item, index, all) { return allowed.indexOf(item) >= 0 && all.indexOf(item) === index; }) : []); }
      var kind = kinds.indexOf(rawCapability.kind) >= 0 ? rawCapability.kind : rawCapability.mode === "collaborator" ? "collaborator" : "unavailable", available = rawCapability.available === true, writable = rawCapability.writable === true && (kind === "authority" || kind === "collaborator") && available;
      var automationCommands = actions(rawCapability.automationCommands, ["approve", "reject"]);
      var capability = Object.freeze({ available: available, writable: writable, canCreate: kind === "authority" && writable && rawCapability.canCreate === true, kind: kind, reason: text(rawCapability.reason, 120), automationCommands: automationCommands });
      var definitions = Object.freeze((Array.isArray(source.definitions) ? source.definitions : []).slice(0, 100).map(function (item) { return Object.freeze({ definitionRef: text(item.definitionRef, 256), revision: Number.isSafeInteger(item.revision) ? item.revision : 0, status: item.status === "enabled" ? "enabled" : "disabled", name: text(item.name, 200), taskRef: text(item.taskRef, 256), taskTitle: text(item.taskTitle, 500), targetStatus: text(item.targetStatus, 32), blockReason: text(item.blockReason, 500), allowedActions: kind === "authority" && writable ? actions(item.allowedActions, definitionActions) : Object.freeze([]) }); }).filter(function (item) { return item.definitionRef && item.revision > 0; }));
      var taskChoices = Object.freeze((Array.isArray(source.taskChoices) ? source.taskChoices : []).slice(0, 200).map(function (item) { return Object.freeze({ taskRef: text(item.taskRef, 256), title: text(item.title, 500), revision: Number.isSafeInteger(item.revision) ? item.revision : 0, allowedTargets: kind === "authority" && writable ? actions(item.allowedTargets, ["backlog", "todo", "in_progress", "blocked", "canceled"]) : Object.freeze([]) }); }).filter(function (item) { return item.taskRef && item.revision > 0; }));
      var statuses = ["awaiting_approval", "queued", "running", "succeeded", "failed", "cancel_requested", "canceled"];
      var runs = Object.freeze((Array.isArray(source.runs) ? source.runs : []).slice(0, 200).map(function (item) { var status = statuses.indexOf(item.status) >= 0 ? item.status : "failed", allowed = kind === "collaborator" ? writable && status === "awaiting_approval" ? actions(item.allowedActions, automationCommands) : Object.freeze([]) : writable ? actions(item.allowedActions, runActions) : Object.freeze([]); return Object.freeze({ runRef: text(item.runRef, 256), definitionRef: text(item.definitionRef, 256), definitionName: text(item.definitionName, 200), revision: Number.isSafeInteger(item.revision) ? item.revision : 0, status: status, createdAt: text(item.createdAt, 64), startedAt: text(item.startedAt, 64), finishedAt: text(item.finishedAt, 64), errorCode: text(item.errorCode, 128), retryable: item.retryable === true, allowedActions: allowed }); }).filter(function (item) { return item.runRef && item.revision > 0; }));
      var recentLedger = Object.freeze((Array.isArray(source.recentLedger) ? source.recentLedger : []).slice(0, 100).map(function (item) { return Object.freeze({ occurredAt: text(item.occurredAt, 64), type: text(item.type, 128), runRef: text(item.runRef, 256), definitionName: text(item.definitionName, 200), status: text(item.status, 64), errorCode: text(item.errorCode, 128) }); }));
      return Object.freeze({ capability: capability, definitions: definitions, taskChoices: taskChoices, runs: runs, recentLedger: recentLedger });
    }

    function projectAutomationActionBody(command, type, definition, run, expectedRevision, payload) {
      var body = { commandId: command, type: type };
      if (definition !== undefined) body.definitionRef = definition;
      if (run !== undefined) body.runRef = run;
      body.expectedRevision = expectedRevision;
      body.payload = payload || {};
      return body;
    }

    function postProjectAutomationAction(body) {
      if (!body || !Object.keys(body).every(function (key) { return ["commandId", "type", "definitionRef", "runRef", "expectedRevision", "payload"].indexOf(key) >= 0; })) throw new TypeError("unsupported project automation action fields");
      var encoded = JSON.stringify(body);
      function request() { return fetch("/api/agent-teams/project/automations/action", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", Accept: "application/json", "x-harness-agent-teams": "1" }, body: encoded }).then(function (response) { return response.json().catch(function () { return {}; }).then(function (result) { if (!response.ok) throw projectTaskResponseError(response, result); return result; }); }); }
      return request().catch(function (error) { if (error && error.status) throw error; return request(); });
    }

    function useProjectAutomationsState() {
      var statePair = useState(null), state = statePair[0], setState = statePair[1];
      var loadingPair = useState(true), loading = loadingPair[0], setLoading = loadingPair[1];
      var errorPair = useState(null), error = errorPair[0], setError = errorPair[1];
      var reloadRef = useRef(function () { return Promise.resolve(); });
      useEffect(function () {
        var alive = true, source = null, timer = null, inFlight = null, pending = false;
        function load() { if (inFlight) { pending = true; return inFlight; } setLoading(true); inFlight = fetch("/api/agent-teams/project/automations/state", { method: "GET", cache: "no-store", credentials: "same-origin", headers: { Accept: "application/json" } }).then(function (response) { return response.json().catch(function () { return {}; }).then(function (body) { if (!response.ok) throw projectTaskResponseError(response, body); return body; }); }).then(function (body) { var safe = normalizeProjectAutomationsState(body); if (alive) { setState(safe); setError(null); } return safe; }).catch(function (cause) { if (alive) setError(cause); throw cause; }).finally(function () { inFlight = null; if (alive) setLoading(false); if (alive && pending) { pending = false; load().catch(function () {}); } }); return inFlight; }
        reloadRef.current = load; load().catch(function () {});
        if (typeof EventSource === "function") { try { source = new EventSource("/api/agent-teams/project/automations/stream"); var refetch = function () { if (!alive || timer !== null) return; timer = setTimeout(function () { timer = null; if (alive) reloadRef.current().catch(function () {}); }, 80); }; source.addEventListener("reset", refetch); source.addEventListener("capability", refetch); source.addEventListener("automation", refetch); source.addEventListener("definition", refetch); source.addEventListener("run", refetch); source.addEventListener("ledger", refetch); } catch (_) { if (source && typeof source.close === "function") source.close(); source = null; } }
        return function () { alive = false; reloadRef.current = function () { return Promise.resolve(); }; if (timer !== null) clearTimeout(timer); if (source && typeof source.close === "function") source.close(); };
      }, []);
      return { state: state, loading: loading, error: error, reload: function () { return reloadRef.current(); } };
    }

    function projectAutomationStatus(t, value) { var keys = { enabled: "projectAutomationStatusEnabled", disabled: "projectAutomationStatusDisabled", pending: "projectAutomationStatusAwaitingApproval", awaiting_approval: "projectAutomationStatusAwaitingApproval", pending_approval: "projectAutomationStatusAwaitingApproval", approved: "projectAutomationStatusApproved", rejected: "projectAutomationStatusRejected", queued: "projectAutomationStatusQueued", running: "projectAutomationStatusRunning", succeeded: "projectAutomationStatusSucceeded", failed: "projectAutomationStatusFailed", cancel_requested: "projectAutomationStatusCancelRequested", canceled: "projectAutomationStatusCanceled" }; return t(keys[value] || "unknown"); }
    function projectAutomationActionLabel(t, value) { var keys = { enable: "projectAutomationActionEnable", disable: "projectAutomationActionDisable", run: "projectAutomationActionRun", approve: "projectAutomationActionApprove", reject: "projectAutomationActionReject", retry: "projectAutomationActionRetry", cancel: "projectAutomationActionCancel" }; return t(keys[value] || "unknown"); }
    function projectAutomationLedgerLabel(t, value) { var text = String(value || "").toLowerCase(); if (text.indexOf("approval") >= 0 || text.indexOf("approve") >= 0 || text.indexOf("reject") >= 0) return t("projectAutomationLedgerApproval"); if (text.indexOf("queue") >= 0) return t("projectAutomationLedgerQueued"); if (text.indexOf("start") >= 0) return t("projectAutomationLedgerStarted"); if (text.indexOf("finish") >= 0 || text.indexOf("succeed") >= 0 || text.indexOf("fail") >= 0) return t("projectAutomationLedgerFinished"); if (text.indexOf("cancel") >= 0) return t("projectAutomationLedgerCanceled"); if (text.indexOf("create") >= 0 || text.indexOf("trigger") >= 0) return t("projectAutomationLedgerCreated"); return t("projectAutomationLedgerEvent"); }

    function ProjectAutomationPanel(props) {
      var t = props.t, live = useProjectAutomationsState();
      var namePair = useState(""), name = namePair[0], setName = namePair[1]; var taskPair = useState(""), selectedTask = taskPair[0], setSelectedTask = taskPair[1]; var targetPair = useState(""), target = targetPair[0], setTarget = targetPair[1]; var reasonPair = useState(""), blockReason = reasonPair[0], setBlockReason = reasonPair[1]; var busyPair = useState({}), busy = busyPair[0], setBusy = busyPair[1]; var pendingPair = useState({}), pending = pendingPair[0], setPending = pendingPair[1]; var actionErrorPair = useState(null), actionError = actionErrorPair[0], setActionError = actionErrorPair[1];
      var state = live.state, capability = state && state.capability, kind = capability && capability.kind || "unavailable", collaborator = kind === "collaborator", canWrite = capability && capability.writable === true && (kind === "authority" || collaborator) && capability.available === true, canCreate = kind === "authority" && canWrite && capability.canCreate === true;
      function mark(key, value) { setBusy(function (current) { var next = Object.assign({}, current); if (value === false) delete next[key]; else next[key] = true; return next; }); }
      function dispatchAutomation(key, body, done) { if (!canWrite || busy[key] === true) return Promise.resolve(); mark(key); setActionError(null); return postProjectAutomationAction(body).then(function (result) { setPending(function (current) { var next = Object.assign({}, current); if (result && result.queued === true) next[key] = true; else delete next[key]; return next; }); if (done) done(); return live.reload(); }).catch(setActionError).finally(function () { mark(key, false); }); }
      function create(event) { event.preventDefault(); var choice = (state.taskChoices || []).filter(function (item) { return item.taskRef === selectedTask; })[0]; if (!canCreate || !choice || !name.trim() || !target || choice.allowedTargets.indexOf(target) < 0 || target === "blocked" && !blockReason.trim()) return; var payload = { name: name.trim(), taskRef: choice.taskRef, targetStatus: target }; if (target === "blocked") payload.blockReason = blockReason.trim(); return dispatchAutomation("create", projectAutomationActionBody(newProjectTaskCommandId(), "definition.create", undefined, undefined, 0, payload), function () { setName(""); setSelectedTask(""); setTarget(""); setBlockReason(""); }); }
      function definitionAction(item, action) { if (!canWrite || item.allowedActions.indexOf(action) < 0) return Promise.resolve(); var choice = (state.taskChoices || []).filter(function (candidate) { return candidate.taskRef === item.taskRef; })[0]; if (action === "run" && !choice) return Promise.resolve(); var type = action === "run" ? "manual_run" : "definition.update", payload = action === "run" ? { taskRevision: choice.revision } : { status: action === "enable" ? "enabled" : "disabled" }; return dispatchAutomation("definition:" + item.definitionRef + ":" + action, projectAutomationActionBody(newProjectTaskCommandId(), type, item.definitionRef, undefined, item.revision, payload)); }
      function runAction(item, action) { if (!canWrite || item.allowedActions.indexOf(action) < 0 || collaborator && (item.status !== "awaiting_approval" || capability.automationCommands.indexOf(action) < 0 || ["approve", "reject"].indexOf(action) < 0)) return Promise.resolve(); return dispatchAutomation("run:" + item.runRef + ":" + action, projectAutomationActionBody(newProjectTaskCommandId(), action, undefined, item.runRef, item.revision, {})); }
      if (live.loading && !state) return h("div", { className: "dat-board-empty", role: "status" }, t("projectAutomationLoading"));
      if (kind === "no-project") return h("div", { className: "dat-board-empty" }, h("p", null, t("projectAutomationNoProject")), h(Button, { onClick: function () { props.setWorkspaceView("participants"); } }, t("projectTasksOpenSettings")));
      if (!state || kind !== "authority" && !collaborator) return h("div", { className: "dat-board-empty" }, t("projectAutomationUnavailable"));
      var choice = state.taskChoices.filter(function (item) { return item.taskRef === selectedTask; })[0], targets = choice ? choice.allowedTargets : [];
      return h("div", { className: "dat-stack" }, h("div", { className: "dat-schedule-boundary" }, t("projectAutomationSeparate")), h("div", { className: "dat-actions" }, h(Button, { small: true, disabled: live.loading, onClick: function () { live.reload().catch(function () {}); } }, t("projectAutomationRefresh"))), live.error || actionError ? h("div", { className: "dat-error", role: "alert" }, t("projectAutomationError"), " ", projectTaskNextAction(actionError || live.error, t)) : null,
        collaborator ? h("div", { className: "dat-board-note", role: "status" }, h("span", { "aria-hidden": "true" }, "ⓘ"), h("span", null, t("projectAutomationCollaborator"), " ", t(canWrite ? "projectAutomationCollaboratorWritable" : "projectAutomationCollaboratorReadOnly"))) : null,
        Object.keys(pending).length ? h("div", { className: "dat-board-note", role: "status" }, h("span", { "aria-hidden": "true" }, "⌛"), h("span", null, t("projectAutomationPendingReceipt"))) : null,
        canCreate ? h("form", { className: "dat-stack", onSubmit: create }, h("label", { className: "dat-label" }, t("projectAutomationName"), h("input", { className: "dat-field", value: name, maxLength: 200, onChange: function (event) { setName(event.target.value); } })), h("label", { className: "dat-label" }, t("projectAutomationTask"), h("select", { className: "dat-field", value: selectedTask, onChange: function (event) { setSelectedTask(event.target.value); setTarget(""); } }, h("option", { value: "" }, t("projectAutomationChoose")), state.taskChoices.map(function (item) { return h("option", { key: item.taskRef, value: item.taskRef }, item.title); }))), h("label", { className: "dat-label" }, t("projectAutomationTarget"), h("select", { className: "dat-field", value: target, onChange: function (event) { setTarget(event.target.value); } }, h("option", { value: "" }, t("projectAutomationChoose")), targets.map(function (item) { return h("option", { key: item, value: item }, projectTaskStatusLabel(t, item)); }))), target === "blocked" ? h("label", { className: "dat-label" }, t("projectAutomationBlockReason"), h("input", { className: "dat-field", value: blockReason, maxLength: 500, onChange: function (event) { setBlockReason(event.target.value); } })) : null, h(Button, { type: "submit", primary: true, disabled: busy.create === true || !name.trim() || !selectedTask || !target || target === "blocked" && !blockReason.trim() }, busy.create ? t("projectAutomationCreating") : t("projectAutomationCreate"))) : h("div", { className: "dat-note" }, t("projectAutomationCreateUnavailable")),
        h("h4", null, t("projectAutomationDefinitions")), state.definitions.length ? state.definitions.map(function (item) { return h("article", { key: item.definitionRef, className: "dat-card" }, h("strong", null, item.name), h("div", { className: "dat-meta" }, item.taskTitle + " → " + projectTaskStatusLabel(t, item.targetStatus) + " · " + projectAutomationStatus(t, item.status) + " · " + t("projectAutomationRevision", { value: item.revision }) + (item.blockReason ? " · " + item.blockReason : "")), h("div", { className: "dat-actions" }, item.allowedActions.map(function (action) { var key = "definition:" + item.definitionRef + ":" + action; return h(Button, { key: action, small: true, disabled: busy[key] === true || pending[key] === true, onClick: function () { definitionAction(item, action); } }, busy[key] ? t("projectAutomationBusy") : projectAutomationActionLabel(t, action)); }))); }) : h("div", { className: "dat-board-empty" }, t("projectAutomationEmptyDefinitions")),
        h("h4", null, t("projectAutomationRuns")), h("div", { className: "dat-note" }, t("projectAutomationApprovalBoundary")), state.runs.length ? state.runs.map(function (item) { return h("article", { key: item.runRef, className: "dat-card" }, h("strong", null, item.definitionName), h("div", { className: "dat-meta" }, projectAutomationStatus(t, item.status) + " · " + formatTime(item.createdAt) + " · " + t("projectAutomationRevision", { value: item.revision }) + (item.errorCode ? " · " + item.errorCode : "")), h("div", { className: "dat-actions" }, item.allowedActions.map(function (action) { var key = "run:" + item.runRef + ":" + action; return h(Button, { key: action, small: true, disabled: busy[key] === true || pending[key] === true, onClick: function () { runAction(item, action); } }, busy[key] ? t("projectAutomationBusy") : projectAutomationActionLabel(t, action)); }))); }) : h("div", { className: "dat-board-empty" }, t("projectAutomationEmptyRuns")),
        collaborator ? null : h(React.Fragment, null, h("h4", null, t("projectAutomationLedger")), state.recentLedger.length ? state.recentLedger.map(function (item, index) { return h("div", { key: item.runRef + ":" + index, className: "dat-meta" }, formatTime(item.occurredAt) + " · " + item.definitionName + " · " + projectAutomationLedgerLabel(t, item.type) + (item.status ? " · " + projectAutomationStatus(t, item.status) : "") + (item.errorCode ? " · " + item.errorCode : "")); }) : h("div", { className: "dat-board-empty" }, t("projectAutomationEmptyLedger"))));
    }

    function AutomationWorkspace(props) {
      var t = props.t;
      var statePair = useState(null), state = statePair[0], setState = statePair[1];
      var loadingPair = useState(true), loading = loadingPair[0], setLoading = loadingPair[1];
      var errorPair = useState(""), error = errorPair[0], setError = errorPair[1];
      var requestRef = useRef(0);
      function loadSchedules() {
        var request = ++requestRef.current;
        setLoading(true); setError("");
        return fetch("/api/desktop-schedules/state?sessionId=" + encodeURIComponent(props.sessionId), { method: "GET", cache: "no-store", credentials: "same-origin", headers: { Accept: "application/json" } }).then(function (response) {
          return response.json().catch(function () { return {}; }).then(function (body) { if (!response.ok) throw new Error(body.error || ("HTTP " + response.status)); return body; });
        }).then(function (next) { if (request === requestRef.current) setState(next); }).catch(function (cause) { if (request === requestRef.current) setError(errorText(cause)); }).finally(function () { if (request === requestRef.current) setLoading(false); });
      }
      useEffect(function () {
        loadSchedules();
        return function () { requestRef.current += 1; };
      }, [props.sessionId]);
      function scheduleTime(value) { return value ? formatTime(value) : "–"; }
      var schedules = state && Array.isArray(state.schedules) ? state.schedules : [];
      var history = state && Array.isArray(state.history) ? state.history.slice(0, 8) : [];
      return h("section", { className: "dat-workspace-view", "aria-labelledby": "dat-automation-title" },
        h("div", { className: "dat-workspace-view-head" }, h("div", null, h("h2", { id: "dat-automation-title" }, t("automationTitle")), h("p", null, t("automationIntro"))), h("div", { className: "dat-workspace-view-actions" }, h(Button, { small: true, disabled: loading, onClick: loadSchedules }, t("scheduleRefresh")), typeof props.setView === "function" ? h(Button, { small: true, onClick: function () { props.setView("desktop-schedules"); } }, t("scheduleOpenFull")) : null)),
        h("div", { className: "dat-automation-grid" },
          h("section", { className: "dat-panel dat-automation-panel", "aria-labelledby": "dat-session-schedules" },
            h("div", { className: "dat-automation-panel-head" }, h("div", null, h("h3", { id: "dat-session-schedules" }, t("sessionSchedules")), h("div", { className: "dat-note", style: { marginTop: 3 } }, t("sessionScheduleScope"))), h("span", { className: "dat-badge" }, schedules.length)),
            h("div", { className: "dat-schedule-boundary" }, t("sessionScheduleLimit")),
            loading ? h("div", { className: "dat-board-empty", role: "status" }, t("scheduleLoading")) : error ? h("div", { className: "dat-error", role: "alert", style: { marginTop: 10 } }, error) : state && !state.available ? h("div", { className: "dat-board-empty" }, t("scheduleUnavailable")) : schedules.length ? h("div", { className: "dat-automation-list" }, schedules.map(function (item) { return h("article", { key: item.id, className: "dat-schedule-row" }, h("div", { className: "dat-schedule-copy" }, h("strong", null, item.prompt || item.id), h("span", null, statusLabel(t, item.state || "scheduled") + " · " + scheduleTime(item.scheduledAt) + " · " + item.id)), h("span", { className: "dat-badge" }, item.kind || "schedule")); })) : h("div", { className: "dat-board-empty" }, t("scheduleEmpty")),
            history.length ? h("div", { className: "dat-schedule-history" }, h("h4", null, t("scheduleHistory")), history.map(function (item, index) { return h("div", { key: item.id + ":" + index, className: "dat-meta", style: { marginTop: index ? 5 : 0 } }, (item.operation || t("unknown")) + " · " + (item.prompt || item.id) + (item.occurredAt ? " · " + scheduleTime(item.occurredAt) : "")); })) : null
          ),
          h("section", { className: "dat-panel dat-automation-panel", "aria-labelledby": "dat-project-automation" }, h("div", { className: "dat-automation-panel-head" }, h("div", null, h("h3", { id: "dat-project-automation" }, t("projectAutomation")))), h(ProjectAutomationPanel, { t: t, setWorkspaceView: props.setWorkspaceView }))
        )
      );
    }

    function ParticipantsWorkspace(props) {
      var t = props.t, team = props.team, members = team && sortMembersByActivity(team.members || []) || [], tasks = team && team.tasks || [];
      function assignedTask(member) { var id = memberSession(member); return tasks.filter(function (task) { return (task.assigneeSessionId || task.assigneeId || task.assignee || task.memberId) === id && taskBoardColumn(task) !== "completed"; })[0] || null; }
      function openAgentCatalog() {
        if (!team || !team.leadSessionId || !props.sessions || typeof props.sessions.setSubagentCatalogOpen !== "function") return;
        props.sessions.setSubagentCatalogOpen(team.leadSessionId, true);
        if (typeof window !== "undefined" && typeof window.dispatchEvent === "function" && typeof window.CustomEvent === "function") window.dispatchEvent(new window.CustomEvent(SUBAGENT_CATALOG_EVENT, { detail: { parentSessionId: team.leadSessionId } }));
      }
      return h("section", { className: "dat-workspace-view", "aria-labelledby": "dat-participants-title" },
        h("div", { className: "dat-workspace-view-head" }, h("div", null, h("h2", { id: "dat-participants-title" }, t("participantsTitle")), h("p", null, t("participantsIntro"))), team ? h(Button, { small: true, disabled: !team.leadSessionId || !props.sessions || typeof props.sessions.setSubagentCatalogOpen !== "function", onClick: openAgentCatalog }, t("participantsOpenCatalog")) : null),
        h("section", { className: "dat-panel", "aria-labelledby": "dat-execution-resources" }, h("div", { className: "dat-column-head" }, h("h3", { id: "dat-execution-resources", className: "dat-section-title", style: { margin: 0 } }, t("executionResources")), h("span", { className: "dat-badge" }, members.length)), members.length ? h("div", { className: "dat-participant-grid" }, members.map(function (member) { var task = assignedTask(member), isLead = member.isLead || member.kind === "lead" || team && memberSession(member) === team.leadSessionId; return h("article", { key: memberId(member), className: "dat-participant-row" }, h("div", { className: "dat-participant-copy" }, h("span", { className: "dat-participant-avatar", "aria-hidden": "true" }, Array.from(simpleMemberName(member, isLead, t))[0] || "AI"), h("span", null, h("strong", null, simpleMemberName(member, isLead, t)), h("small", null, memberModelText(member, t) || t("unknown")))), h("div", { className: "dat-participant-state" }, h("span", { className: "dat-badge" }, statusLabel(t, memberStateKind(member))), h("small", null, task ? t("participantCurrentTask", { value: task.title || taskId(task) }) : t("participantNoTask")))); })) : h("div", { className: "dat-board-empty" }, t("participantsEmpty"))),
        h("div", { style: { marginTop: 12 } }, h("h3", { className: "dat-section-title" }, t("collaborationAccess")), h("div", { className: "dat-board-note dat-collaboration-boundary", role: "note" }, h("span", { "aria-hidden": "true" }, "ⓘ"), h("span", null, t("collaborationPreview"))), h(ProjectTeamEntry, { t: t }))
      );
    }

    function CoordinationInboxWorkspace(props) {
      var t = props.t, team = props.team, events = [], seen = {}, teamsById = {};
      (props.teams || []).forEach(function (item) { teamsById[teamId(item)] = item; });
      if (team) {
        (team.events || team.messages || []).forEach(function (event) { pushUniqueEvent(events, seen, event, teamId(team)); });
        (team.inboundEvents || []).forEach(function (event) { pushUniqueEvent(events, seen, event, event.fromTeamId); });
      }
      events.sort(function (left, right) { return Date.parse(right.createdAt || right.timestamp || right.at || 0) - Date.parse(left.createdAt || left.timestamp || left.at || 0); });
      return h("section", { className: "dat-workspace-view", "aria-labelledby": "dat-inbox-title", "aria-readonly": "true" },
        h("div", { className: "dat-workspace-view-head" }, h("div", null, h("h2", { id: "dat-inbox-title" }, t("inboxTitle")), h("p", null, t("inboxIntro"))), h("div", { className: "dat-workspace-view-actions" }, h("span", { className: "dat-badge" }, t("inboxMetaOnly")), typeof props.setWorkspaceView === "function" ? h(Button, { small: true, onClick: function () { props.setWorkspaceView(team ? "canvas" : "board"); } }, t(team ? "inboxOpenCanvas" : "inboxOpenBoard")) : null)),
        h("div", { className: "dat-board-note dat-inbox-boundary", role: "note" }, h("span", { "aria-hidden": "true" }, "ⓘ"), h("span", null, t("inboxIntro"))),
        events.length ? h("div", { className: "dat-inbox-list" }, events.slice(0, 40).map(function (event) { return h(EventCard, { key: eventIdentity(event, team && teamId(team)), event: event, t: t, teamsById: teamsById }); })) : h("section", { className: "dat-panel dat-empty" }, h("p", null, t("inboxEmpty")))
      );
    }

    function ActiveTeam(props) {
      var t = props.t, team = props.team, members = team.members || [], tasks = team.tasks || [];
      var totalTaskCount = Number.isFinite(team.taskCount) ? team.taskCount : tasks.length;
      var projectionLimited = !!(team.projection && team.projection.tasksTruncated) || totalTaskCount > tasks.length;
      var historyPair = useState(!!props.closed), historyOpen = historyPair[0], setHistoryOpen = historyPair[1];
      var modePair = useState("canvas"), workMode = modePair[0], setWorkMode = modePair[1];
      var actionsPair = useState(false), actionsOpen = actionsPair[0], setActionsOpen = actionsPair[1];
      var drawerPair = useState(false), drawerOpen = drawerPair[0], setDrawerOpen = drawerPair[1];
      var historyLimitPair = useState(40), historyLimit = historyLimitPair[0], setHistoryLimit = historyLimitPair[1];
      var drawerRef = useRef(null), triggerRef = useRef(null);
      var taskDetailPair = useState(""), selectedTaskId = taskDetailPair[0], setSelectedTaskId = taskDetailPair[1];
      var taskNoticePair = useState(""), taskSelectionNotice = taskNoticePair[0], setTaskSelectionNotice = taskNoticePair[1];
      var taskDetailRef = useRef(null);
      var activeInspectorRef = drawerOpen ? drawerRef : taskDetailRef;
      var inspectorModal = useInspectorModal(activeInspectorRef, drawerOpen || !!selectedTaskId);
      var events = [], seenEvents = {}, teamsById = {};
      (props.teams || []).forEach(function (item) { teamsById[teamId(item)] = item; });
      teamsById[teamId(team)] = team;
      (team.events || team.messages || []).forEach(function (event) { pushUniqueEvent(events, seenEvents, event, teamId(team)); });
      (team.inboundEvents || []).forEach(function (event) { pushUniqueEvent(events, seenEvents, event, event.fromTeamId); });
      (props.teams || []).forEach(function (source) { if (teamId(source) !== teamId(team)) (source.events || source.messages || []).forEach(function (event) { if (event.toTeamId === teamId(team)) pushUniqueEvent(events, seenEvents, event, teamId(source)); }); });
      events.sort(function (left, right) { return Date.parse(right.createdAt || right.timestamp || right.at || 0) - Date.parse(left.createdAt || left.timestamp || left.at || 0); });
      var selectedTask = tasks.filter(function (item) { return taskId(item) === selectedTaskId; })[0] || null;
      var selectedAssignee = selectedTask ? members.filter(function (member) { return memberSession(member) === (selectedTask.assigneeSessionId || selectedTask.assigneeId || selectedTask.assignee || selectedTask.memberId); })[0] || null : null;
      var selectedTaskEvents = selectedTask ? events.filter(function (event) { return eventRelatesToTask(event, selectedTask); }) : [];
      function openTaskDetail(event, task) {
        if (!task) return;
        triggerRef.current = event && event.currentTarget;
        setDrawerOpen(false);
        setTaskSelectionNotice("");
        setSelectedTaskId(taskId(task));
      }
      function closeTaskDetail() {
        setSelectedTaskId("");
        if (triggerRef.current && typeof triggerRef.current.focus === "function") triggerRef.current.focus();
      }
      var activeTasks = tasks.filter(function (task) { return String(task.status || task.state || "pending").toLowerCase() !== "completed"; }).sort(function (left, right) { return String(left.status || left.state) === "in_progress" ? -1 : String(right.status || right.state) === "in_progress" ? 1 : 0; });
      var completedTasks = tasks.filter(function (task) { return String(task.status || task.state || "").toLowerCase() === "completed"; }).sort(function (left, right) { return Date.parse(right.updatedAt || right.completedAt || 0) - Date.parse(left.updatedAt || left.completedAt || 0); });
      var currentMembers = sortMembersByActivity(members.filter(function (member) { return String(member.state || member.status || "").toLowerCase() !== "retired"; }));
      var hasFailedMember = currentMembers.some(function (member) { return memberStateKind(member) === "failed"; });
      var agentCount = currentMembers.filter(function (member) { return !(member.isLead || member.kind === "lead" || memberSession(member) === team.leadSessionId); }).length;
      function nameFor(id) { var found = members.filter(function (member) { return memberId(member) === id || memberSession(member) === id; })[0]; return found && (found.displayName || found.name || memberId(found)); }
      function modelFor(id) { var found = members.filter(function (member) { return memberId(member) === id || memberSession(member) === id; })[0]; return found ? memberModelText(found, t) : ""; }
      function closePanel() { setDrawerOpen(false); if (triggerRef.current && typeof triggerRef.current.focus === "function") triggerRef.current.focus(); }
      function openActivityPanel(event) { if (drawerOpen) { closePanel(); return; } triggerRef.current = event && event.currentTarget; setSelectedTaskId(""); setDrawerOpen(true); }
      function openAgentCatalog() {
        if (!team.leadSessionId || !props.sessions || typeof props.sessions.setSubagentCatalogOpen !== "function") return;
        setDrawerOpen(false);
        props.sessions.setSubagentCatalogOpen(team.leadSessionId, true);
        if (typeof window !== "undefined" && typeof window.dispatchEvent === "function" && typeof window.CustomEvent === "function") window.dispatchEvent(new window.CustomEvent(SUBAGENT_CATALOG_EVENT, { detail: { parentSessionId: team.leadSessionId } }));
      }
      useEffect(function () { setHistoryOpen(!!props.closed); setHistoryLimit(40); setWorkMode("canvas"); setActionsOpen(false); setDrawerOpen(false); setSelectedTaskId(""); setTaskSelectionNotice(""); }, [teamId(team), props.closed]);
      useEffect(function () { if (selectedTaskId && !selectedTask) { setSelectedTaskId(""); setTaskSelectionNotice(t("taskSelectionExpired")); } }, [selectedTaskId, selectedTask]);
      useEffect(function () {
        if (!drawerOpen && !selectedTaskId) return;
        var focusTarget = drawerOpen ? drawerRef.current : taskDetailRef.current;
        if (focusTarget && typeof focusTarget.focus === "function") focusTarget.focus();
        var onKey = function (event) { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); if (drawerOpen) closePanel(); else closeTaskDetail(); } else trapInspectorTab(event, focusTarget); };
        document.addEventListener("keydown", onKey);
        return function () { document.removeEventListener("keydown", onKey); };
      }, [drawerOpen, selectedTaskId]);
      var objective = team.objective || t("unknown");
      var targetContext = isChinese() ? "目标团队：‘" + teamName(team, t) + "’（team_id: " + teamId(team) + "）。" : "Target team: ‘" + teamName(team, t) + "’ (team_id: " + teamId(team) + "). ";
      var teamSummary = (props.teams || []).map(function (item) { var itemTasks = item.tasks || [], runningTasks = Number.isFinite(item.activeTaskCount) ? item.activeTaskCount : itemTasks.filter(function (task) { return (task.status || task.state) === "in_progress"; }).length; return teamName(item, t) + " [" + teamId(item) + ", " + teamStatusLabel(t, item.status || item.state) + ", " + (isChinese() ? "目标：" : "objective: ") + String(item.objective || t("unknown")).slice(0, 160) + ", " + runningTasks + (isChinese() ? " 个进行中任务" : " active tasks") + "]"; }).join("; ");
      function prompt(text, options) { props.setDraft(targetContext + text + (options && options.includeTeams && teamSummary ? (isChinese() ? " 当前团队安全摘要：" : " Current safe team summary: ") + teamSummary : ""), options); }
      var prompts = isChinese() ? [
        { key: "addMember", text: "请根据团队目标、当前任务缺口、成本和同时工作上限，判断是否真的需要新增成员。只有能明显减少重复工作且文件边界不冲突时，才自动确定简短职责名、职责、合适模型和首个任务；先建立可追踪任务，再添加并分配成员。如果不需要，请说明原因且不要扩员。负责人承担最终交付；新成员优先使用成本较低的成员模型，只有复杂或高风险任务才使用主模型。" },
        { key: "newPeerTeam", creation: true, includeTeams: true, text: "请根据当前项目目标、现有团队分工和成本，判断是否真的需要另一个由同一负责人协调的团队。只有职责边界清楚且可以独立并行时才创建；自动确定新团队目标、必要成员和跨团队任务依赖。如果现有团队足够，请说明原因且不要创建。" },
        { key: "createTask", text: "请把团队目标的下一步拆成一个任务，明确负责人、依赖关系和文件范围。" },
        { key: "coordinate", text: "请检查团队当前阻塞和文件冲突，协调成员并更新任务分配。" },
        { key: "summarize", text: "请汇总团队当前进展、风险、阻塞和下一步行动。" },
        { key: "closeTeam", text: "请先收集所有成员的最终报告，确认没有进行中任务，再优雅退役成员并关闭团队。" }
      ] : [
        { key: "addMember", text: "Decide from the team objective, current task gaps, cost, and simultaneous-work limit whether another member is genuinely useful. Only when it clearly reduces duplicated work and has a non-conflicting file boundary, choose a short duty name, role, suitable model, and first task; create a tracked task before adding and assigning the member. Otherwise explain why and do not expand the team. Keep the lead responsible for final delivery; prefer the lower-cost member model and use the main model only for complex or high-risk work." },
        { key: "newPeerTeam", creation: true, includeTeams: true, text: "Decide from the project objective, existing team responsibilities, and cost whether another team under the same lead is genuinely useful. Create it only with a clear independent boundary and useful parallelism. Choose its objective, necessary members, and cross-team task dependencies. If the existing teams are enough, explain why and do not create one." },
        { key: "createTask", text: "Break the next step toward the team objective into a task with an assignee, dependencies, and file scope." },
        { key: "coordinate", text: "Review current blockers and file conflicts, coordinate members, and update task assignments." },
        { key: "summarize", text: "Summarize the team’s progress, risks, blockers, and next actions." },
        { key: "closeTeam", text: "Collect every member's final report, confirm that no task is still running, then gracefully retire members and close the team." }
      ];
      var inspector = drawerOpen ? h(React.Fragment, null,
        h("button", { type: "button", className: "dat-scrim", onClick: closePanel, "aria-label": t("closePanel") }),
        h("aside", { className: "dat-panel dat-inspector", role: inspectorModal ? "dialog" : "complementary", "aria-modal": inspectorModal ? true : undefined, tabIndex: -1, ref: drawerRef, "aria-labelledby": "dat-activity-panel-title" },
          h("div", { className: "dat-inspector-head" }, h("h2", { id: "dat-activity-panel-title", className: "dat-section-title", style: { margin: 0 } }, t("activityPanel")), h(Button, { small: true, onClick: closePanel, ariaLabel: t("closePanel") }, "×")),
          h("div", { className: "dat-inspector-body" },
            h("div", { className: "dat-column-head" }, h("h2", null, t("recentActivity")), h("span", { className: "dat-badge" }, events.length)),
            h("div", { className: "dat-stack" }, events.length ? events.slice(0, 20).map(function (event) { return h(EventCard, { key: eventIdentity(event, teamId(team)), event: event, t: t, teamsById: teamsById }); }) : h("div", { className: "dat-meta" }, t("noEvents")))
          )
        )
      ) : null;
      var taskInspector = selectedTaskId ? h(React.Fragment, null,
        h("button", { type: "button", className: "dat-scrim", onClick: closeTaskDetail, "aria-label": t("closePanel") }),
        h(TaskDetailSidebar, { t: t, task: selectedTask, assignee: selectedAssignee, members: members, leadSessionId: team.leadSessionId, events: selectedTaskEvents, tasks: tasks, teamsById: teamsById, detailRef: taskDetailRef, modal: inspectorModal, onClose: closeTaskDetail })
      ) : null;
      return h("div", { className: "dat-active-shell" + (drawerOpen || selectedTaskId ? " dat-inspector-open" : "") },
        h("div", { className: "dat-work-main", "aria-hidden": inspectorModal ? true : undefined, inert: inspectorModal ? "" : undefined },
          !props.closed && team.closure ? h(TeamClosureBanner, { t: t, team: team }) : null,
          props.closed ? h(TeamClosureBanner, { t: t, team: team }, h("div", { style: { marginTop: 10 } }, h(Button, { small: true, onClick: function () { prompt(isChinese() ? "请询问我的下一个目标；收到目标后，由你判断是否需要团队并自动规划必要成员、任务依赖和文件边界，不要让我设计团队结构。" : "Ask for my next objective. After I provide it, decide whether a team is useful and design only the necessary members, task dependencies, and file boundaries yourself; do not ask me to design the team structure.", { creation: true, includeTeams: true }); } }, t("newTeam")))) : props.paused ? h("section", { className: "dat-panel dat-closed", role: "status" }, h("strong", null, t("paused")), h("div", { className: "dat-meta", style: { marginTop: 4 } }, t("pausedBody")), h("div", { style: { marginTop: 10 } }, h(Button, { small: true, onClick: function () { prompt(isChinese() ? "请恢复这个团队。恢复后请先检查未完成任务和成员状态，再继续工作。" : "Please resume this team. After resuming, check unfinished tasks and member status before continuing."); } }, t("continueTeam")))) : null,
          h("header", { className: "dat-command-bar" }, h("div", { className: "dat-command-title" }, h("h2", { className: "dat-title" }, teamName(team, t)), h("p", { className: "dat-subtitle" }, objective), h("div", { className: "dat-row", style: { marginTop: 6 } }, h("span", { className: "dat-badge" }, teamStatusLabel(t, team.status)), h("span", { className: "dat-badge" }, t("revision", { value: team.revision || "–" })))), h("div", { className: "dat-row" }, h(Button, { small: true, disabled: !team.leadSessionId || !props.sessions || typeof props.sessions.setSubagentCatalogOpen !== "function", onClick: openAgentCatalog }, t("openMembers", { count: agentCount })), h(Button, { small: true, ariaPressed: drawerOpen, onClick: openActivityPanel }, t("openActivity", { count: events.length })), completedTasks.length ? h(Button, { small: true, ariaPressed: historyOpen, onClick: function () { setHistoryOpen(!historyOpen); } }, historyOpen ? t("hideHistory") : t("openHistory", { count: completedTasks.length })) : null, !props.closed && !props.paused ? h(Button, { small: true, ariaPressed: actionsOpen, onClick: function () { setActionsOpen(!actionsOpen); } }, actionsOpen ? t("fewerActions") : t("moreActions")) : null)),
          projectionLimited ? h("div", { className: "dat-board-note dat-board-projection-note", role: "note" }, h("span", { "aria-hidden": "true" }, "⚠"), h("span", null, t("boardProjectionLimited", { shown: tasks.length, total: totalTaskCount }))) : null,
          taskSelectionNotice ? h("div", { className: "dat-board-note", role: "status" }, h("span", { "aria-hidden": "true" }, "ⓘ"), h("span", null, taskSelectionNotice)) : null,
          hasFailedMember ? h("div", { className: "dat-board-note", role: "alert" }, h("span", { "aria-hidden": "true" }, "⚠"), h("span", null, t("failedNext")), h(Button, { small: true, disabled: !team.leadSessionId || !props.sessions || typeof props.sessions.setSubagentCatalogOpen !== "function", onClick: openAgentCatalog }, t("openMembers", { count: agentCount }))) : null,
          h("div", { className: "dat-row", style: { justifyContent: "flex-end", marginBottom: 10 } }, h("div", { className: "dat-view-toggle", role: "group", "aria-label": t("currentWork") }, h(Button, { small: true, ariaPressed: workMode === "canvas", onClick: function () { setWorkMode("canvas"); } }, t("canvasView")), h(Button, { small: true, ariaPressed: workMode === "list", onClick: function () { setWorkMode("list"); } }, t("listView")))),
          actionsOpen && !props.closed && !props.paused ? h("section", { className: "dat-panel dat-actions-panel", "aria-labelledby": "dat-quick-actions" }, h("h2", { id: "dat-quick-actions", className: "dat-section-title" }, t("quickActions")), h("div", { className: "dat-actions" }, prompts.map(function (item) { return h(Button, { key: item.key, small: true, onClick: function () { prompt(item.text, { creation: item.creation, includeTeams: item.includeTeams }); } }, t(item.key)); })), h("div", { className: "dat-note" }, t("draftOnly"))) : null,
          workMode === "canvas" ? h(TeamCanvas, { t: t, members: currentMembers, tasks: tasks, leadSessionId: team.leadSessionId, openMembers: openAgentCatalog, connection: props.connection, paused: props.paused, updatedAt: team.lastActivityAt, openTask: openTaskDetail }) : h("section", { className: "dat-panel dat-work-panel", "aria-labelledby": "dat-current-work" }, h("div", { className: "dat-column-head" }, h("h2", { id: "dat-current-work" }, t("currentWork")), h("span", { className: "dat-badge" }, activeTasks.length)), h("div", { className: "dat-work-list" }, activeTasks.length ? activeTasks.map(function (task) { return h(TaskCard, { key: taskId(task), task: task, compact: true, t: t, memberName: nameFor, memberModel: modelFor, onOpen: openTaskDetail }); }) : h("div", { className: "dat-meta dat-work-empty" }, t("noActiveTasks")))),
          completedTasks.length ? h("section", { className: "dat-history", "aria-labelledby": "dat-task-history" }, h("div", { className: "dat-history-head" }, h("h2", { id: "dat-task-history", className: "dat-section-title", style: { margin: 0 } }, t("taskHistory")), h("span", { className: "dat-badge" }, completedTasks.length)), h("p", { className: "dat-note dat-history-note" }, t("historyHint")), historyOpen ? h("div", { className: "dat-history-list" }, completedTasks.slice(0, historyLimit).map(function (task) { return h(TaskCard, { key: taskId(task), task: task, compact: true, t: t, memberName: nameFor, memberModel: modelFor, onOpen: openTaskDetail }); }), completedTasks.length > historyLimit ? h("div", { className: "dat-actions", style: { justifyContent: "center", padding: "0 12px 12px" } }, h(Button, { small: true, onClick: function () { setHistoryLimit(historyLimit + 40); } }, t("showMore", { count: Math.min(40, completedTasks.length - historyLimit) }))) : null) : null) : null
        ),
        inspector,
        taskInspector
      );
    }

    function TeamView(props) {
      var t = useLocale();
      var selectedPair = useState(""), selectedId = selectedPair[0], setSelectedId = selectedPair[1];
      var workspacePair = useState("board"), workspaceView = workspacePair[0], setWorkspaceView = workspacePair[1];
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
      var taskCount = team ? (Number.isFinite(team.taskCount) ? team.taskCount : Array.isArray(team.tasks) ? team.tasks.length : 0) : 0;
      var memberCount = team && Array.isArray(team.members) ? team.members.length : 0;
      var eventCount = team ? (team.events || team.messages || []).length + (team.inboundEvents || []).length : 0;
      var workspaceContent = null;
      if (workspaceView === "projectTasks") {
        workspaceContent = h(ProjectTasksWorkspace, { t: t, setWorkspaceView: setWorkspaceView });
      } else if (!snapshot && !live.error) {
        workspaceContent = h("div", { className: "dat-panel dat-empty", role: "status" }, t("loading"));
      } else if (snapshot && !snapshot.enabled) {
        workspaceContent = h("section", { className: "dat-panel dat-empty", "aria-labelledby": "dat-disabled" }, h("h2", { id: "dat-disabled" }, t("disabled")), h("p", null, t("disabledBody")), h(Button, { primary: true, disabled: busy, onClick: enable }, busy ? t("enabling") : t("enable")));
      } else if (workspaceView === "participants") {
        workspaceContent = h(React.Fragment, null, teams.length > 1 ? h(TeamOverview, { t: t, teams: teams, selectedId: team && teamId(team), select: setSelectedId }) : null, h(ParticipantsWorkspace, { t: t, team: team, teams: teams, sessions: props.sessions }));
      } else if (workspaceView === "automation") {
        workspaceContent = h(AutomationWorkspace, { t: t, sessionId: props.sessionId, setView: props.setView, setWorkspaceView: setWorkspaceView });
      } else if (workspaceView === "flow") {
        workspaceContent = h(FlowWorkspace, { t: t, team: team });
      } else if (snapshot && snapshot.enabled && teams.length === 0) {
        workspaceContent = workspaceView === "canvas"
          ? h(EmptyTeamCanvasWorkspace, { t: t, setView: props.setView })
          : workspaceView === "inbox"
            ? h(CoordinationInboxWorkspace, { t: t, team: null, teams: [], setWorkspaceView: setWorkspaceView })
            : h(EmptyTaskBoardWorkspace, { t: t, setDraft: setDraft, setView: props.setView, disable: disable, busy: busy });
      } else if (snapshot && snapshot.enabled && team) {
        workspaceContent = h(React.Fragment, null,
          h(TeamOverview, { t: t, teams: teams, selectedId: team && teamId(team), select: setSelectedId }),
          workspaceView === "canvas"
            ? h(ActiveTeam, { t: t, team: team, teams: teams, closed: closed, paused: paused, setDraft: setDraft, sessions: props.sessions, connection: live.connection })
            : workspaceView === "inbox"
              ? h(CoordinationInboxWorkspace, { t: t, team: team, teams: teams, setWorkspaceView: setWorkspaceView })
              : h(TaskBoardWorkspace, { t: t, sessionId: props.sessionId, team: team, teams: teams, connection: live.connection, setWorkspaceView: setWorkspaceView }),
          h("details", { className: "dat-disclosure dat-settings-disclosure" }, h("summary", null, t("workspaceSettings")), h(DisableAutomaticTeams, { t: t, labelId: "dat-disable-teams", disable: disable, busy: busy, hasActive: hasActiveTeams }))
        );
      }
      return h("main", { className: "dat-view", "data-mobile-slot": "agent-teams.workspace", "data-harness-mobile-session-id": String(props.sessionId || ""), "data-harness-mobile-team-id": team ? String(teamId(team)) : undefined, "aria-labelledby": "dat-view-title" }, h("div", { className: "dat-shell" },
        h(WorkspaceNav, { t: t, value: workspaceView, onChange: setWorkspaceView, counts: { tasks: taskCount, members: memberCount, events: eventCount } }),
        h("div", { className: "dat-head" }, h("div", null, h("h1", { id: "dat-view-title", className: "dat-title" }, t("title")), h("p", { className: "dat-subtitle" }, t("workspaceIntro"))), h("span", { className: "dat-badge", "data-mobile-slot": "agent-teams.context", "data-harness-mobile-session-id": String(props.sessionId || ""), title: t("connection") + " · " + props.sessionId }, h("span", { className: "dat-dot", style: live.connection === "live" ? null : { background: "var(--dsw-alias-state-warn-primary)" } }), t(connectionKey) + " · " + String(props.sessionId || "").slice(-8))),
        live.error ? h("div", { className: "dat-error", role: "alert" }, t("loadError", { error: live.error }), " ", h(Button, { small: true, onClick: live.reload }, t("retry"))) : null,
        actionError ? h("div", { className: "dat-error", role: "alert" }, t("actionError", { error: actionError })) : null,
        notice ? h("div", { className: "dat-board-note", role: "status", "aria-live": "polite" }, notice) : null,
        h("section", { className: "dat-workspace" }, h("div", { className: "dat-workspace-main" }, workspaceContent))
      ));
    }

    function resolveSettingsSessionId(sessions) {
      try { var current = sessions && sessions.list && sessions.list.getSnapshot().current; if (typeof current === "string" && current) return current; if (current && (current.sessionId || current.id)) return current.sessionId || current.id; } catch (_) {}
      return "settings";
    }
    function AgentTeamsSettings(props) {
      var t = useLocale();
      var sessionId = resolveSettingsSessionId(props.sessions);
      var valuesPair = useState({ enabled: false, maxMembers: 4, maxActiveTurns: 4 }), values = valuesPair[0], setValues = valuesPair[1];
      var loadingPair = useState(true), loading = loadingPair[0], setLoading = loadingPair[1];
      var savingPair = useState(false), saving = savingPair[0], setSaving = savingPair[1];
      var errorPair = useState(""), error = errorPair[0], setError = errorPair[1];
      var savedPair = useState(false), saved = savedPair[0], setSaved = savedPair[1];
      function applyState(state) { var config = state.config || {}; setValues({ enabled: !!state.enabled, maxMembers: Number(config.maxMembers) || 4, maxActiveTurns: Number(config.maxActiveTurns) || 4 }); }
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
      try { ctx.effect(function () { return ctx.locale.subscribe(function () { try { currentLang = ctx.locale.getLocale().active || currentLang; } catch (_) {} localeListeners.slice().forEach(function (listener) { listener(); }); }); }, "agent-teams: locale subscription"); } catch (_) {}
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
