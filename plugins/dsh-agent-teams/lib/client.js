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
      assignee: "负责人", unassigned: "未分配", blockedBy: "阻塞于：{value}", dependencySources: "跨团队依赖：{value}", conflicts: "冲突任务：{value}", files: "文件：{value}", filesHidden: "文件范围已按安全策略隐藏", taskFallback: "任务 {id}", lastActivity: "最后活动：{value}", deliveryEvent: "{from} → {to} · {status}", crossDelivery: "{fromTeam} → {toTeam} · {from} → {to} · {status}", taskDetail: "任务详情", taskDetailUnavailable: "该任务已结束或不可用", taskDependencies: "依赖任务", taskEvents: "相关实时事件", taskRef: "任务编号",
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
      assignee: "Assignee", unassigned: "Unassigned", blockedBy: "Blocked by: {value}", dependencySources: "Cross-team dependencies: {value}", conflicts: "Conflicting tasks: {value}", files: "Files: {value}", filesHidden: "File scope hidden by the safety policy", taskFallback: "Task {id}", lastActivity: "Last activity: {value}", deliveryEvent: "{from} → {to} · {status}", crossDelivery: "{fromTeam} → {toTeam} · {from} → {to} · {status}", taskDetail: "Task detail", taskDetailUnavailable: "This task has finished or is unavailable", taskDependencies: "Dependencies", taskEvents: "Related live events", taskRef: "Task ID",
      quickActions: "Prompt shortcuts", addMember: "Add member", newPeerTeam: "Add peer team", createTask: "Create task", coordinate: "Coordinate team", summarize: "Summarize progress", closeTeam: "Request shutdown", newTeam: "Create another team", draftOnly: "Actions write to the composer and never send automatically.", draftSet: "Prompt added to the composer.", creationSent: "Creation request sent; returning to Chat.", creationSentFallback: "Creation request sent. Use the Chat tab above to view the response.",
      teamsOverview: "Team overview", teamCount: "{count} teams", activeTeams: "{count} active", closedTeams: "{count} closed", switchTeam: "Switch to team: {name}", crossTeam: "Cross-team activity", noCrossTeam: "No cross-team activity", backgroundHint: "Switching teams or views never stops background members.", teamTasks: "{active} active · {done} done", lastUpdated: "Updated {value}",
      currentSession: "Current session", revision: "Revision {value}", settingsTitle: "Agent Teams", settingsDescription: "After enabling, describe goals normally and AI decides whether to use a team; simple work stays solo. Higher concurrency limits may increase model usage and cost.", settingsEnabled: "Enable automatic teams", settingsMaxMembers: "Maximum team members", settingsMaxActiveTurns: "Maximum active turns", settingsSave: "Save settings", settingsSaving: "Saving…", settingsSaved: "Settings saved", settingsRange: "Enter a whole number from 1 to 8.", settingsCloseTeamsFirst: "Close every active team from its lead conversation before disabling Agent Teams."
    };
    Object.assign(zh, {
      projectEntryTitle: "多人安全接入", projectEntryIntro: "本机代理可执行团队任务；局域网与公网入口当前只提供签名配对、加密连通和在线状态预览。", projectCreate: "创建安全接入空间", projectCreating: "正在创建…", projectName: "项目名称", projectNamePlaceholder: "例如：产品发布协作", projectOwner: "你的显示名称", projectOwnerPlaceholder: "例如：负责人", projectNotCreated: "尚未创建安全接入空间", projectReady: "安全接入配置已就绪", projectPreviewBadge: "连接预览", projectRef: "项目 ID", projectMembers: "成员 {count}", projectRevision: "权限修订 {value}", projectLocalMode: "本机智能团队", projectLocalModeHint: "AI 自动判断并组建必要的代理团队。", projectLanMode: "同一局域网", projectLanReady: "mTLS 安全连通验证可用", projectLanWaiting: "等待启动局域网入口", projectLanDiscovery: "局域网配对", projectLanPending: "不广播设备扫描；一次性批准信息会安全携带固定入口和设备凭据。", projectLanEndpoint: "入口 {host}:{port}", projectRefresh: "刷新状态", projectRemoteMode: "不在同一网络", projectRemoteHint: "通过凭证化邀请和 WSS/443 盲中继建立 E2EE 连通；中继只转发有界密文。", projectInviteName: "受邀成员显示名称", projectInviteNamePlaceholder: "例如：评审", projectInviteRole: "成员角色", projectCreateInvite: "生成远程邀请", projectInviteCode: "一次性邀请信息", projectCopy: "复制", projectCopied: "已复制", projectRelayUrl: "WSS 中继地址", projectRelayPlaceholder: "wss://relay.example.com", projectSaveRelay: "保存中继", projectConnectRemote: "连接远程中继", projectDisconnectRemote: "断开远程中继", projectRemoteConnected: "远程中继已连接", projectRemoteDisconnected: "远程中继未连接", projectChannelPending: "设备端到端通道仍需完成显式密钥交换。", projectHypoMux: "HypoMux 仅用于 Windows 多网卡下载聚合，不是同步协议；项目不会将其作为协作传输层。", projectAdvanced: "局域网与远程接入", projectUnavailable: "无法读取协作入口：{error}", owner: "所有者", maintainer: "维护者", contributor: "贡献者", reviewer: "评审", observer: "观察者"
    });
    Object.assign(en, {
      projectEntryTitle: "Secure multi-person access", projectEntryIntro: "Local agents can execute team tasks. LAN and remote entries currently provide signed pairing, encrypted connectivity, and presence preview only.", projectCreate: "Create secure access space", projectCreating: "Creating…", projectName: "Project name", projectNamePlaceholder: "e.g. Product release", projectOwner: "Your display name", projectOwnerPlaceholder: "e.g. Lead", projectNotCreated: "No secure access space yet", projectReady: "Secure access configuration is ready", projectPreviewBadge: "Connectivity preview", projectRef: "Project ID", projectMembers: "{count} members", projectRevision: "Authority revision {value}", projectLocalMode: "Local AI team", projectLocalModeHint: "AI decides whether and how to create the necessary agent team.", projectLanMode: "Same LAN", projectLanReady: "mTLS connectivity verification is ready", projectLanWaiting: "LAN entry is not started", projectLanDiscovery: "LAN pairing", projectLanPending: "No device scan is broadcast. The one-time approval safely carries the pinned endpoint and device credential.", projectLanEndpoint: "Endpoint {host}:{port}", projectRefresh: "Refresh status", projectRemoteMode: "Different networks", projectRemoteHint: "Establish E2EE connectivity with authenticated invitations and a WSS/443 blind relay that forwards bounded ciphertext only.", projectInviteName: "Invitee display name", projectInviteNamePlaceholder: "e.g. Reviewer", projectInviteRole: "Member role", projectCreateInvite: "Generate remote invite", projectInviteCode: "One-time invitation", projectCopy: "Copy", projectCopied: "Copied", projectRelayUrl: "WSS relay URL", projectRelayPlaceholder: "wss://relay.example.com", projectSaveRelay: "Save relay", projectConnectRemote: "Connect remote relay", projectDisconnectRemote: "Disconnect remote relay", projectRemoteConnected: "Remote relay connected", projectRemoteDisconnected: "Remote relay disconnected", projectChannelPending: "The device E2EE channel still requires an explicit key exchange.", projectHypoMux: "HypoMux aggregates Windows multi-NIC downloads; it is not a sync protocol and is not used as the collaboration transport.", projectAdvanced: "LAN and remote access", projectUnavailable: "Collaboration entry unavailable: {error}", owner: "Owner", maintainer: "Maintainer", contributor: "Contributor", reviewer: "Reviewer", observer: "Observer"
    });
    Object.assign(zh, {
      projectJoinExisting: "加入已有团队", projectJoinIntro: "邀请码只用于生成本机密钥和加入请求；由项目负责人批准后，再把批准信息粘贴回来完成配对。", projectJoinInvite: "负责人发来的邀请码", projectPrepareJoin: "生成加入请求", projectJoinRequest: "加入请求", projectApprovalRequest: "成员发来的加入请求", projectApproveJoin: "批准加入", projectJoinResponse: "批准信息", projectCompleteJoin: "完成加入", projectPairingPending: "等待负责人批准", projectPairingReady: "设备密钥交换已完成", projectRelayManualHint: "如果负责人在批准后才配置中继，请填写负责人提供的同一无凭据 WSS 地址；已批准的房间信息会继续保留。", projectChannelReady: "端到端通道已就绪", projectLanHost: "私网 IP", projectLanPort: "端口", projectLanCert: "设备证书（PEM）", projectLanKey: "设备私钥（PEM）", projectLanCa: "项目 CA（PEM）", projectStartLan: "启动局域网入口", projectStopLan: "停止局域网入口", projectConnectLan: "验证局域网连接", projectLanConnected: "局域网 mTLS 已验证"
    });
    Object.assign(en, {
      projectJoinExisting: "Join an existing team", projectJoinIntro: "The invite creates this desktop's keys and join request. Paste the owner's approval response back here to finish pairing.", projectJoinInvite: "Invite from the owner", projectPrepareJoin: "Create join request", projectJoinRequest: "Join request", projectApprovalRequest: "Join request from a member", projectApproveJoin: "Approve join", projectJoinResponse: "Approval response", projectCompleteJoin: "Complete join", projectPairingPending: "Waiting for owner approval", projectPairingReady: "Device key exchange complete", projectRelayManualHint: "If the owner configured the relay after approval, enter the same credential-free WSS URL they provide; the approved room remains available.", projectChannelReady: "End-to-end channel ready", projectLanHost: "Private IP", projectLanPort: "Port", projectLanCert: "Device certificate (PEM)", projectLanKey: "Device private key (PEM)", projectLanCa: "Project CA (PEM)", projectStartLan: "Start LAN endpoint", projectStopLan: "Stop LAN endpoint", projectConnectLan: "Verify LAN connection", projectLanConnected: "LAN mTLS verified"
    });
    Object.assign(zh, {
      workspaceNavigation: "代理团队工作台",
      workspaceBoard: "任务板",
      workspaceCanvas: "团队画布",
      workspaceFlow: "流程画布",
      workspaceAutomation: "定时与自动化",
      workspaceParticipants: "参与者",
      workspaceInbox: "协调收件箱",
      boardTitle: "当前团队任务板",
      boardIntro: "按真实运行状态整理当前所选团队；切换团队不会停止后台成员。",
      boardScope: "当前所选团队的安全投影",
      boardReadOnly: "只读任务板",
      boardReadOnlyHint: "现阶段状态变更仍由负责人通过受控团队工具执行，界面不会绕过权限与 revision 校验。",
      boardPending: "待处理",
      boardProgress: "进行中",
      boardBlocked: "已阻塞",
      boardCompleted: "已完成",
      boardEmpty: "此列暂无任务",
      boardBlockedDerived: "“已阻塞”由 blockedBy 实时派生，不是另一套任务状态。",
      boardMore: "另有 {count} 项未显示；可在团队画布的列表模式查看",
      boardOpenCanvas: "打开团队操作",
      flowTitle: "团队执行流程",
      flowIntro: "先把现有团队生命周期画清楚；流程编辑器将在项目自动化命令接线后开放。",
      flowReadOnly: "运行时蓝图 · 只读",
      flowGoal: "目标进入",
      flowGoalBody: "人向根负责人描述目标",
      flowPlan: "负责人判断",
      flowPlanBody: "验证并行价值、成本与边界",
      flowTasks: "持久任务",
      flowTasksBody: "先建任务、依赖和文件范围",
      flowMembers: "必要成员",
      flowMembersBody: "按任务启动可继续的成员",
      flowCoordinate: "协调与收件箱",
      flowCoordinateBody: "处理交接、阻塞与跨团队投递",
      flowResult: "汇总结果",
      flowResultBody: "负责人验收并向人交付",
      automationTitle: "定时任务与自动化",
      automationIntro: "保留现有 dsh-schedule 会话提醒；项目自动化与 Run Ledger 仍按正式服务分阶段接入。",
      projectAutomation: "项目自动化",
      projectAutomationPending: "尚未接线：不会用长 Prompt 或前端假状态代替 Automation Definition、Run 与审计记录。",
      sessionSchedules: "当前会话提醒",
      sessionScheduleScope: "会话本地 · 现有能力",
      sessionScheduleLimit: "仅在原会话在线时触发；恢复会话后会补发 overdue 提醒。触发记录不等于团队任务执行成功。",
      scheduleLoading: "正在读取会话提醒…",
      scheduleUnavailable: "当前会话尚未运行，恢复后即可读取提醒。",
      scheduleEmpty: "暂无会话提醒",
      scheduleHistory: "最近触发与停用记录",
      scheduleOpenFull: "打开完整定时任务",
      scheduleRefresh: "刷新",
      participantsTitle: "参与者与协作接入",
      participantsIntro: "本地代理是当前可分配的执行资源；人类成员与多电脑安全接入在下方单独显示。",
      collaborationPreview: "多电脑协作目前是安全配对与连通性预览：支持签名身份、LAN mTLS、远程 E2EE 和在线状态；团队任务、消息、离线恢复与冲突合并尚未接通，远端成员不会被标为可分配执行者。",
      executionResources: "当前执行资源",
      collaborationAccess: "多人协作接入",
      participantsEmpty: "当前团队暂无成员",
      participantsOpenCatalog: "打开代理目录",
      participantCurrentTask: "当前任务：{value}",
      participantNoTask: "暂无分配任务",
      inboxTitle: "协调收件箱",
      inboxIntro: "集中查看当前团队的交接与跨团队投递元数据；正文仍受安全投影保护。",
      inboxMetaOnly: "只读投递元数据",
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
      boardProjectionLimited: "当前仅显示安全投影中的 {shown}/{total} 项任务；较早任务仍保留在运行时，并未丢失。",
      workspaceUnavailable: "当前视图需要先启用代理团队。"
    });
    Object.assign(en, {
      workspaceNavigation: "Agent Teams workbench",
      workspaceBoard: "Task board",
      workspaceCanvas: "Team canvas",
      workspaceFlow: "Flow canvas",
      workspaceAutomation: "Schedules & automation",
      workspaceParticipants: "Participants",
      workspaceInbox: "Coordination inbox",
      boardTitle: "Current team task board",
      boardIntro: "Organizes the selected team by real runtime state. Switching teams never stops background members.",
      boardScope: "Selected-team safe projection",
      boardReadOnly: "Read-only task board",
      boardReadOnlyHint: "For now, state changes still run through the lead's guarded team tools. The UI never bypasses authority or revision checks.",
      boardPending: "Pending",
      boardProgress: "In progress",
      boardBlocked: "Blocked",
      boardCompleted: "Completed",
      boardEmpty: "No tasks in this column",
      boardBlockedDerived: "Blocked is derived live from blockedBy; it is not a second task status.",
      boardMore: "{count} more are hidden; use List mode in Team canvas to review them",
      boardOpenCanvas: "Open team controls",
      flowTitle: "Team execution flow",
      flowIntro: "First make the existing lifecycle clear. Editing opens after project automation commands are wired.",
      flowReadOnly: "Runtime blueprint · read only",
      flowGoal: "Goal intake",
      flowGoalBody: "A person states the goal to the root lead",
      flowPlan: "Lead decision",
      flowPlanBody: "Validate parallel value, cost, and boundaries",
      flowTasks: "Durable tasks",
      flowTasksBody: "Create tasks, dependencies, and file scope first",
      flowMembers: "Necessary members",
      flowMembersBody: "Start continuable members for concrete tasks",
      flowCoordinate: "Coordination & inbox",
      flowCoordinateBody: "Handle handoffs, blocks, and cross-team delivery",
      flowResult: "Result delivery",
      flowResultBody: "The lead verifies and reports to the person",
      automationTitle: "Schedules and automation",
      automationIntro: "Keep the existing dsh-schedule session reminders. Project automation and a Run Ledger arrive through formal services in phases.",
      projectAutomation: "Project automation",
      projectAutomationPending: "Not wired yet: long prompts and front-end fake state will not replace Automation Definitions, Runs, and audit records.",
      sessionSchedules: "Current-session reminders",
      sessionScheduleScope: "Session local · existing capability",
      sessionScheduleLimit: "Runs only while the original session is live; overdue reminders dispatch after resume. A dispatch record is not proof that a team task succeeded.",
      scheduleLoading: "Loading session reminders…",
      scheduleUnavailable: "This session is not live. Resume it to inspect reminders.",
      scheduleEmpty: "No session reminders",
      scheduleHistory: "Recent dispatch and disable records",
      scheduleOpenFull: "Open full scheduled tasks",
      scheduleRefresh: "Refresh",
      participantsTitle: "Participants and collaboration access",
      participantsIntro: "Local agents are the currently assignable execution resources. Human and multi-computer access is shown separately below.",
      collaborationPreview: "Multi-computer collaboration is currently a secure pairing and connectivity preview: signed identity, LAN mTLS, remote E2EE, and presence are available. Team-task sync, messages, offline recovery, and conflict merging are not wired yet, so remote people are not presented as assignable executors.",
      executionResources: "Current execution resources",
      collaborationAccess: "Human collaboration access",
      participantsEmpty: "This team has no members",
      participantsOpenCatalog: "Open agent catalog",
      participantCurrentTask: "Current task: {value}",
      participantNoTask: "No assigned task",
      inboxTitle: "Coordination inbox",
      inboxIntro: "Review handoff and cross-team delivery metadata for the selected team. Message bodies remain protected by the safe projection.",
      inboxMetaOnly: "Read-only delivery metadata",
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
      boardProjectionLimited: "Showing {shown} of {total} tasks from the safe projection. Older runtime tasks are retained and have not been lost.",
      workspaceUnavailable: "Enable Agent Teams before using this view."
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
        ".dat-btn{font:inherit;border:1px solid var(--dsw-alias-border-l3);border-radius:8px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);padding:7px 11px;cursor:pointer;line-height:1.25}.dat-btn:hover{background:var(--dsw-alias-interactive-bg-hover)}.dat-btn:focus-visible,.dat-field:focus-visible,.dat-template:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}.dat-btn:disabled{opacity:.5;cursor:not-allowed}.dat-primary{background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground);border-color:transparent}.dat-danger{color:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-state-error-secondary)}.dat-small{padding:4px 8px;font-size:12px}",
        ".dat-error{border:1px solid var(--dsw-alias-state-error-secondary);border-radius:10px;padding:10px 12px;color:var(--dsw-alias-state-error-primary);font-size:13px;margin-bottom:12px}.dat-note{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:1.5}.dat-section-title{font-size:13px;margin:0 0 9px}.dat-field{box-sizing:border-box;width:100%;border:1px solid var(--dsw-alias-border-l3);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);padding:9px 10px;font:inherit;font-size:13px}.dat-label{display:block;margin:13px 0 6px;color:var(--dsw-alias-label-secondary);font-size:12px}",
        ".dat-templates{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:9px}.dat-template{display:block;width:100%;text-align:left;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;padding:12px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);cursor:pointer}.dat-template[aria-pressed=true]{border-color:var(--dsw-alias-brand-primary);box-shadow:inset 0 0 0 1px var(--dsw-alias-brand-primary)}.dat-template strong{display:block;font-size:13px;margin-bottom:4px}.dat-template span{display:block;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.45}",
        ".dat-column-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px}.dat-column-head h2{font-size:14px;margin:0}.dat-stack{display:grid;gap:8px}.dat-card-title{font-size:13px;font-weight:650;overflow-wrap:anywhere}.dat-meta{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.45;overflow-wrap:anywhere}.dat-task-status{margin-top:7px}.dat-event{border-left:2px solid var(--dsw-alias-brand-primary);padding-left:9px}.dat-event time{display:block;color:var(--dsw-alias-label-tertiary);font-size:11px;margin-top:3px}",
        ".dat-actions{display:flex;align-items:center;gap:7px;flex-wrap:wrap;margin:12px 0}.dat-actions-panel{margin:0 0 12px;padding:10px 12px}.dat-closed{border-color:var(--dsw-alias-border-l3);background:var(--dsw-alias-bg-layer-2);margin-bottom:12px}.dat-sr{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}.dat-warn-text{color:var(--dsw-alias-state-warn-primary)}",
        ".dat-overview{margin:0 0 12px}.dat-team-strip{display:flex;align-items:center;gap:7px;overflow:auto;padding:2px 0 4px}.dat-team-list{display:grid;gap:7px;max-height:280px;overflow:auto;list-style:none;margin:8px 0 0;padding:0}.dat-team-choice{min-width:max-content;text-align:left;border:1px solid var(--dsw-alias-border-l2);border-radius:999px;padding:6px 10px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);cursor:pointer}.dat-team-choice[aria-current=true]{border-color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-interactive-bg-hover)}.dat-team-choice:focus-visible,.dat-disclosure>summary:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}.dat-disclosure{border-top:1px solid var(--dsw-alias-border-l2);margin-top:10px;padding-top:8px}.dat-disclosure>summary{cursor:pointer;color:var(--dsw-alias-label-secondary);font-size:12px}.dat-disclosure[open]>summary{margin-bottom:8px}",
        ".dat-active-shell{min-width:0}.dat-active-shell.dat-inspector-open{display:grid;grid-template-columns:minmax(0,1fr) minmax(300px,360px);gap:12px;align-items:start}.dat-work-main{min-width:0}.dat-command-bar{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:12px}.dat-command-title{min-width:0;flex:1 1 320px}.dat-command-title .dat-title{font-size:18px}.dat-work-panel{padding:0;overflow:hidden}.dat-work-panel>.dat-column-head{padding:13px 14px 4px}.dat-work-list{display:grid;gap:0}.dat-task-row{border:0;border-top:1px solid var(--dsw-alias-border-l2);border-radius:0;background:transparent;padding:12px 14px}.dat-task-row:hover{background:var(--dsw-alias-interactive-bg-hover)}.dat-task-row:first-child{border-top:0}.dat-work-empty{padding:24px 14px;text-align:center}.dat-history{margin-top:12px}.dat-history-head{display:flex;align-items:center;justify-content:space-between;gap:8px}.dat-history-list{max-height:min(56vh,620px);overflow:auto;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;margin-top:8px}.dat-history-note{margin:6px 0 0}",
        ".dat-inspector{position:sticky;top:0;max-height:calc(100vh - 150px);overflow:hidden;padding:0;box-shadow:0 12px 30px rgba(0,0,0,.08)}.dat-inspector-head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:12px;border-bottom:1px solid var(--dsw-alias-border-l2)}.dat-inspector-tabs{display:flex;gap:6px}.dat-inspector-body{max-height:calc(100vh - 215px);overflow:auto;padding:10px}.dat-inspector-body .dat-card{background:transparent}.dat-scrim{display:none}.dat-settings-disclosure{margin-top:14px}.dat-settings-disclosure>.dat-panel{margin-top:8px}",
        ".dat-view-toggle{display:inline-flex;gap:3px;padding:3px;border:1px solid var(--dsw-alias-border-l2);border-radius:9px;background:var(--dsw-alias-bg-layer-1)}.dat-view-toggle .dat-btn{border:0}.dat-canvas-panel{padding:12px;overflow:hidden}.dat-canvas-scroll{position:relative;display:block;max-width:100%;overflow:auto;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-1);isolation:isolate}.dat-canvas{position:relative;display:grid;grid-template-rows:82px 104px 82px;align-content:start;box-sizing:border-box;min-height:326px;padding:24px 20px 34px;isolation:isolate}.dat-canvas-lines{position:absolute;z-index:0;inset:0;width:100%;height:100%;pointer-events:none}.dat-canvas-row{position:relative;z-index:1;display:grid;grid-auto-flow:column;grid-auto-columns:152px;column-gap:28px;align-items:start;justify-content:start;min-width:0}.dat-canvas-line{stroke:var(--dsw-alias-brand-primary);stroke-width:2;opacity:.58;vector-effect:non-scaling-stroke}.dat-canvas-line-depends{stroke:var(--dsw-alias-label-tertiary)}.dat-canvas-line-blocked{stroke:var(--dsw-alias-state-warn-primary);stroke-dasharray:7 5}.dat-canvas-line-conflict{stroke:var(--dsw-alias-state-error-primary);stroke-dasharray:7 5}.dat-canvas-line-flow{stroke-dasharray:6 7;opacity:.85;animation:dat-canvas-flow 1.1s linear infinite}.dat-canvas-node{position:relative;display:block;box-sizing:border-box;width:152px;height:82px;min-width:0;margin:0;padding:9px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-2);box-shadow:0 4px 12px rgba(0,0,0,.06);overflow:hidden;overflow-wrap:anywhere;contain:content;transition:border-color .16s ease,transform .16s ease}.dat-canvas-member{cursor:pointer;text-align:left;color:inherit;font:inherit}.dat-canvas-member:hover{border-color:var(--dsw-alias-brand-primary);transform:translateY(-1px)}.dat-canvas-task{border-top:3px solid var(--dsw-alias-border-l3)}.dat-canvas-task[data-state=in_progress]{border-top-color:var(--dsw-alias-brand-primary)}.dat-canvas-task[data-state=blocked]{border-top-color:var(--dsw-alias-state-warn-primary);box-shadow:inset 0 0 0 1px var(--dsw-alias-state-warn-primary)}.dat-canvas-completed{border-top-color:var(--dsw-alias-state-success-primary)}.dat-canvas-task[data-state=completed]{border-top-color:var(--dsw-alias-state-success-primary)}.dat-canvas-node[data-state=retired]{opacity:.55}.dat-canvas-head{display:flex;align-items:center;gap:6px;min-width:0}.dat-canvas-head .dat-card-title{flex:1 1 auto;min-width:0}.dat-canvas-dot{position:relative;width:8px;height:8px;border-radius:50%;flex:none;background:var(--dsw-alias-label-tertiary)}.dat-canvas-node[data-state=running] .dat-canvas-dot,.dat-canvas-node[data-state=provisioning] .dat-canvas-dot{background:var(--dsw-alias-brand-primary)}.dat-canvas-node[data-state=ready] .dat-canvas-dot{background:var(--dsw-alias-state-success-primary)}.dat-canvas-node[data-state=failed] .dat-canvas-dot{background:var(--dsw-alias-state-error-primary)}.dat-canvas-node[data-state=shutting_down] .dat-canvas-dot,.dat-canvas-node[data-state=closing] .dat-canvas-dot{background:var(--dsw-alias-state-warn-primary)}.dat-canvas-node[data-state=running] .dat-canvas-dot::after{position:absolute;inset:-4px;border-radius:50%;border:1px solid var(--dsw-alias-brand-primary);content:\"\";opacity:.7;animation:dat-canvas-pulse 1.8s ease-out infinite}.dat-canvas-status{display:flex;align-items:center;gap:5px;margin-top:5px;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.4;min-width:0}.dat-canvas-node[data-state=running] .dat-canvas-status,.dat-canvas-node[data-state=provisioning] .dat-canvas-status{color:var(--dsw-alias-brand-primary)}.dat-canvas-node[data-state=blocked] .dat-canvas-status{color:var(--dsw-alias-state-warn-primary)}.dat-canvas-node[data-state=failed] .dat-canvas-status{color:var(--dsw-alias-state-error-primary)}.dat-canvas-node[data-state=completed] .dat-canvas-status{color:var(--dsw-alias-state-success-primary)}.dat-canvas-time{margin-top:2px}.dat-canvas-live{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:9px 0 0;padding:7px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-2);font-size:12px}.dat-canvas-live-paused{border-color:var(--dsw-alias-state-warn-primary);color:var(--dsw-alias-state-warn-primary)}.dat-canvas-legend{display:flex;gap:10px;flex-wrap:wrap;margin:9px 0 0;padding:0;list-style:none}.dat-canvas-key{display:inline-flex;align-items:center;gap:5px}.dat-canvas-swatch{width:20px;height:10px;flex:none;overflow:visible}.dat-canvas-swatch .dat-canvas-line{opacity:.95}@keyframes dat-canvas-flow{to{stroke-dashoffset:-13}}@keyframes dat-canvas-pulse{0%{transform:scale(.6);opacity:.8}70%{transform:scale(1.25);opacity:0}100%{transform:scale(1.25);opacity:0}}",
        ".dat-board-card-flag{flex:none;white-space:nowrap}.dat-canvas-header-actions{display:flex;align-items:center;justify-content:flex-end;gap:8px;flex-wrap:wrap}.dat-canvas-toolbar{display:inline-flex;align-items:center;gap:3px;padding:3px;border:1px solid var(--dsw-alias-border-l2);border-radius:9px;background:var(--dsw-alias-bg-layer-2)}.dat-canvas-toolbar .dat-btn{min-width:32px;border:0;padding:5px 8px}.dat-canvas-zoom-readout{min-width:50px;border:0;border-radius:7px;padding:5px 7px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;cursor:pointer}.dat-canvas-zoom-readout:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}.dat-canvas-zoom-readout:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}.dat-canvas-scroll{position:relative;display:block;box-sizing:border-box;width:100%;height:clamp(420px,56vh,640px);min-height:360px;max-width:100%;overflow:auto;overscroll-behavior:contain;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background-color:var(--dsw-alias-bg-layer-1);background-image:radial-gradient(circle,var(--dsw-alias-border-l2) 1px,transparent 1px);background-size:18px 18px;isolation:isolate;scrollbar-gutter:stable;touch-action:pan-x pan-y;cursor:grab}.dat-canvas-scroll[data-dragging=true]{cursor:grabbing;user-select:none}.dat-canvas-scroll:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}.dat-canvas-stage{position:relative;box-sizing:border-box;min-width:100%;min-height:100%}.dat-canvas{position:absolute;display:block;box-sizing:border-box;min-height:0;padding:0;isolation:isolate;transform-origin:0 0;will-change:transform;contain:layout paint style}.dat-canvas .dat-canvas-row{position:absolute;z-index:1;display:grid;grid-auto-flow:row;grid-auto-columns:auto;column-gap:28px;row-gap:28px;align-items:start;justify-content:start}.dat-canvas .dat-canvas-node{position:absolute;margin:0;contain:layout paint style}.dat-canvas .dat-canvas-row .dat-canvas-node{position:relative}.dat-canvas-limit-note{margin:8px 0 0;padding:7px 9px;border-radius:8px;background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 7%,var(--dsw-alias-bg-layer-1));color:var(--dsw-alias-label-secondary);font-size:11px;line-height:1.45}.dat-work-list>.dat-task-row{content-visibility:auto;contain-intrinsic-size:auto 116px}",
        "@media(prefers-reduced-motion:reduce){.dat-canvas-node{transition:none}.dat-canvas-member:hover{transform:none}.dat-canvas-line-flow,.dat-canvas-node[data-state=running] .dat-canvas-dot::after{animation:none}}@media(max-width:900px){.dat-templates{grid-template-columns:1fr}.dat-active-shell.dat-inspector-open{display:block}.dat-scrim{display:block;position:fixed;inset:0;z-index:39;border:0;background:rgba(0,0,0,.28)}.dat-inspector{position:fixed;z-index:40;top:0;right:0;bottom:0;width:min(390px,92vw);max-height:none;border-radius:12px 0 0 12px}.dat-inspector-body{max-height:calc(100vh - 60px)}.dat-canvas-scroll{max-width:100%}}@media(max-width:620px){.dat-view{padding:12px 10px 22px}.dat-head{display:block}.dat-head>.dat-row{margin-top:9px}.dat-panel{padding:12px}.dat-work-panel{padding:0}.dat-command-bar{align-items:flex-start}.dat-command-bar>.dat-row{width:100%}.dat-inspector{width:100%;border-radius:0}.dat-task-row{padding:11px 12px}.dat-canvas-panel{padding:9px}.dat-canvas-hint{display:none}.dat-canvas-scroll{height:clamp(360px,62vh,540px);min-height:320px}.dat-canvas-legend{font-size:11px}.dat-canvas-header-actions{justify-content:flex-start}.dat-canvas-toolbar{width:100%}.dat-canvas-toolbar .dat-btn,.dat-canvas-zoom-readout{flex:1 1 auto}}",
        ".dat-project-entry{margin:0 0 14px;overflow:hidden}.dat-project-entry-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.dat-project-entry-head h2{margin:0;font-size:16px}.dat-project-entry-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:9px;margin-top:12px}.dat-project-route{padding:11px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-2);min-width:0}.dat-project-route strong{display:block;font-size:13px;margin-bottom:4px}.dat-project-form{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:10px;margin-top:12px}.dat-project-form .dat-label{margin-top:0}.dat-project-span{grid-column:1/-1}.dat-project-code{display:block;box-sizing:border-box;width:100%;min-height:72px;resize:vertical;margin-top:7px;border:1px solid var(--dsw-alias-border-l3);border-radius:8px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);padding:9px;font:12px/1.45 ui-monospace,SFMono-Regular,Consolas,monospace;overflow-wrap:anywhere}.dat-project-ref{font:12px/1.45 ui-monospace,SFMono-Regular,Consolas,monospace;overflow-wrap:anywhere}.dat-project-entry details{margin-top:12px;border-top:1px solid var(--dsw-alias-border-l2);padding-top:10px}.dat-project-entry summary{cursor:pointer;font-size:13px;font-weight:650}.dat-project-status{display:flex;align-items:center;gap:7px;flex-wrap:wrap;margin-top:8px}.dat-project-entry .dat-error{margin-top:10px;margin-bottom:0}@media(max-width:760px){.dat-project-entry-grid,.dat-project-form{grid-template-columns:1fr}.dat-project-span{grid-column:auto}}",
        ".dat-task-open{display:block;width:100%;text-align:left;font:inherit;color:inherit;cursor:pointer}.dat-task-open:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}.dat-canvas-task-open{cursor:pointer;text-align:left;color:inherit;font:inherit}.dat-canvas-task-open:hover{border-color:var(--dsw-alias-brand-primary);transform:translateY(-1px)}.dat-canvas-task-open:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}.dat-canvas-model{margin-top:2px;font-size:11px;line-height:1.3;color:var(--dsw-alias-label-tertiary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.dat-task-hero{display:flex;align-items:flex-start;justify-content:space-between;gap:8px}.dat-task-hero .dat-badge{flex:none}.dat-task-facts{display:grid;gap:7px;margin:10px 0 0}.dat-task-fact{display:grid;grid-template-columns:92px minmax(0,1fr);gap:8px;align-items:baseline}.dat-task-fact dt{color:var(--dsw-alias-label-tertiary);font-size:12px}.dat-task-fact dd{margin:0;min-width:0;font-size:12px;line-height:1.45;overflow-wrap:anywhere}.dat-task-section{margin:12px 0 0}.dat-task-section>h3{font-size:12px;margin:0 0 6px;color:var(--dsw-alias-label-tertiary)}.dat-task-events{display:grid;gap:6px}.dat-task-event{padding:7px 9px}.dat-task-event time{display:block;color:var(--dsw-alias-label-tertiary);font-size:11px;margin-top:2px}",
        ".dat-workspace{container-type:inline-size;container-name:dat-workspace;min-width:0}.dat-workbench{display:grid;gap:14px;min-width:0}.dat-workspace-main{min-width:0}.dat-workspace-nav{display:flex;align-items:center;gap:5px;max-width:100%;margin:0 0 12px;padding:4px;overflow-x:auto;border:1px solid var(--dsw-alias-border-l2);border-radius:11px;background:var(--dsw-alias-bg-layer-1);scrollbar-width:thin}.dat-workspace-nav button{display:flex;align-items:center;justify-content:space-between;gap:8px;min-width:max-content;border:0;border-radius:8px;padding:8px 10px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;cursor:pointer;text-align:left}.dat-workspace-nav button:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}.dat-workspace-nav button[aria-current=page]{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);font-weight:650}.dat-workspace-nav small{color:var(--dsw-alias-label-tertiary);font-size:11px}.dat-workspace-view{min-width:0}.dat-workspace-view-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin:0 0 12px}.dat-workspace-view-head h2{margin:0;font-size:18px}.dat-workspace-view-head p{max-width:760px;margin:4px 0 0;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:1.5}.dat-workspace-view-actions{display:flex;align-items:center;gap:7px;flex-wrap:wrap;justify-content:flex-end}",
        ".dat-board-shell{min-width:0}.dat-board-shell.dat-inspector-open{min-width:0}.dat-board-main{container-type:inline-size;container-name:dat-board-main;min-width:0}.dat-board-toolbar{display:flex;align-items:center;justify-content:space-between;gap:9px;flex-wrap:wrap;margin:0 0 10px;padding:9px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-1)}.dat-board-note{display:flex;align-items:flex-start;gap:8px;margin:0 0 10px;padding:9px 10px;border:1px solid color-mix(in srgb,var(--dsw-alias-state-warn-primary) 24%,var(--dsw-alias-border-l2));border-radius:10px;background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 7%,var(--dsw-alias-bg-layer-1));color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.5}.dat-task-board{display:grid;grid-template-columns:minmax(0,1fr);gap:10px;align-items:start}.dat-board-column{display:flex;flex-direction:column;box-sizing:border-box;height:clamp(360px,56vh,640px);min-width:0;padding:10px;border:1px solid var(--dsw-alias-border-l2);border-radius:11px;background:var(--dsw-alias-bg-layer-1);overflow:hidden}.dat-board-column[data-column=blocked]{border-color:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 30%,var(--dsw-alias-border-l2))}.dat-board-column-head{display:flex;align-items:center;justify-content:space-between;gap:8px;flex:none;margin-bottom:9px;padding:0 2px}.dat-board-column-heading{display:flex;align-items:center;gap:7px;min-width:0}.dat-board-column-heading h3{margin:0;font-size:13px}.dat-board-status-dot{width:8px;height:8px;border-radius:50%;background:var(--dsw-alias-label-tertiary);flex:none}.dat-board-column[data-column=in_progress] .dat-board-status-dot{background:var(--dsw-alias-brand-primary)}.dat-board-column[data-column=blocked] .dat-board-status-dot{background:var(--dsw-alias-state-warn-primary)}.dat-board-column[data-column=completed] .dat-board-status-dot{background:var(--dsw-alias-state-success-primary)}.dat-board-column-list{display:grid;grid-auto-rows:max-content;align-content:start;gap:8px;min-height:0;overflow-y:auto;overscroll-behavior:contain;scrollbar-gutter:stable;padding-right:2px}.dat-board-card{display:grid;align-self:start;gap:7px;width:100%;min-width:0;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;padding:10px;background:var(--dsw-alias-bg-layer-2);color:inherit;font:inherit;text-align:left;cursor:pointer;content-visibility:auto;contain-intrinsic-size:auto 108px}.dat-board-card:hover{border-color:var(--dsw-alias-border-l3);background:var(--dsw-alias-interactive-bg-hover)}.dat-board-card:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}.dat-board-card-top,.dat-board-card-bottom{display:flex;align-items:center;justify-content:space-between;gap:7px;min-width:0}.dat-board-card-id{min-width:0;overflow:hidden;color:var(--dsw-alias-label-tertiary);font:11px/1.4 ui-monospace,SFMono-Regular,Consolas,monospace;text-overflow:ellipsis;white-space:nowrap}.dat-board-card-title{display:-webkit-box;overflow:hidden;font-size:13px;font-weight:650;line-height:1.45;overflow-wrap:anywhere;-webkit-box-orient:vertical;-webkit-line-clamp:3}.dat-board-card-owner{min-width:0;overflow:hidden;color:var(--dsw-alias-label-secondary);font-size:12px;text-overflow:ellipsis;white-space:nowrap}.dat-board-card-flags{display:flex;gap:5px;flex-wrap:wrap}.dat-board-card-flag{border-radius:999px;padding:2px 6px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-tertiary);font-size:11px}.dat-board-card-flag.is-warning{color:var(--dsw-alias-state-warn-primary)}.dat-board-empty{padding:22px 8px;text-align:center;color:var(--dsw-alias-label-tertiary);font-size:12px}.dat-board-overflow{padding:7px 2px 1px;color:var(--dsw-alias-label-tertiary);font-size:11px}.dat-board-shell .dat-scrim{display:block;position:fixed;inset:0;z-index:39;border:0;background:rgba(0,0,0,.28)}.dat-board-shell .dat-inspector{position:fixed;z-index:40;top:0;right:0;bottom:0;width:min(390px,92vw);max-height:none;border-radius:12px 0 0 12px}.dat-board-shell .dat-inspector-body{max-height:calc(100vh - 60px)}",
        ".dat-flow-blueprint{display:grid;gap:10px}.dat-flow-chain{display:grid;grid-template-columns:minmax(0,1fr);gap:8px;padding:12px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background-color:var(--dsw-alias-bg-layer-1);background-image:radial-gradient(circle,var(--dsw-alias-border-l2) 1px,transparent 1px);background-size:18px 18px}.dat-flow-step{display:grid;gap:5px;min-width:0;padding:11px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-2)}.dat-flow-step strong{font-size:13px}.dat-flow-step span{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.45}.dat-flow-arrow{display:grid;place-items:center;color:var(--dsw-alias-label-tertiary)}.dat-flow-boundary{margin:0;padding:10px;border-radius:10px;background:color-mix(in srgb,var(--dsw-alias-brand-primary) 7%,var(--dsw-alias-bg-layer-1));color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.5}",
        ".dat-automation-grid{display:grid;gap:12px}.dat-automation-panel{padding:14px}.dat-automation-panel-head{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;margin-bottom:10px}.dat-automation-panel-head h3{margin:0;font-size:14px}.dat-automation-list{display:grid;gap:0}.dat-schedule-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px;align-items:center;padding:10px 0;border-top:1px solid var(--dsw-alias-border-l2)}.dat-schedule-row:first-child{border-top:0}.dat-schedule-copy{min-width:0}.dat-schedule-copy strong{display:block;font-size:13px;overflow-wrap:anywhere}.dat-schedule-copy span{display:block;margin-top:3px;color:var(--dsw-alias-label-tertiary);font-size:11px;overflow-wrap:anywhere}.dat-schedule-history{margin-top:12px;padding-top:10px;border-top:1px solid var(--dsw-alias-border-l2)}.dat-schedule-history h4{margin:0 0 7px;font-size:12px}.dat-schedule-boundary{padding:10px;border-radius:10px;background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 7%,var(--dsw-alias-bg-layer-1));color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.5}",
        ".dat-participant-grid{display:grid;grid-template-columns:minmax(0,1fr);gap:10px}.dat-participant-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px;align-items:center;padding:10px 0;border-top:1px solid var(--dsw-alias-border-l2)}.dat-participant-row:first-child{border-top:0}.dat-participant-copy{display:flex;align-items:center;gap:9px;min-width:0}.dat-participant-avatar{display:grid;place-items:center;width:30px;height:30px;border-radius:50%;flex:none;background:color-mix(in srgb,var(--dsw-alias-brand-primary) 12%,var(--dsw-alias-bg-layer-2));color:var(--dsw-alias-brand-primary);font-size:12px;font-weight:650}.dat-participant-copy>span{min-width:0}.dat-participant-copy strong,.dat-participant-copy small{display:block;overflow-wrap:anywhere}.dat-participant-copy small{margin-top:2px;color:var(--dsw-alias-label-tertiary);font-size:11px}.dat-participant-state{text-align:right}.dat-inbox-boundary{margin-bottom:10px}.dat-inbox-list{display:grid;gap:8px}",
        ".dat-empty-workbench{margin-bottom:12px}.dat-empty-workbench .dat-task-board{opacity:.96}.dat-empty-workbench .dat-board-column{height:clamp(250px,40vh,420px)}.dat-empty-workbench .dat-board-empty{padding:28px 8px}.dat-onboarding-slot{margin-top:12px}.dat-team-mode{padding:10px 12px}.dat-team-mode-bar{display:flex;align-items:center;justify-content:space-between;gap:12px}.dat-team-mode-copy{min-width:0;flex:1 1 420px}.dat-team-mode-title{display:flex;align-items:center;gap:7px}.dat-team-mode-title h2{margin:0;font-size:14px}.dat-team-mode-copy p{margin:3px 0 0;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.45}.dat-team-mode-actions{display:flex;align-items:center;justify-content:flex-end;gap:9px;flex-wrap:wrap}.dat-team-mode-switch{display:inline-flex;align-items:center;gap:7px;color:var(--dsw-alias-label-secondary);font-size:12px;cursor:pointer}.dat-team-mode-switch input{position:relative;box-sizing:border-box;width:34px;height:20px;margin:0;border:1px solid var(--dsw-alias-border-l3);border-radius:999px;appearance:none;background:var(--dsw-alias-bg-layer-2);cursor:pointer;transition:background .16s ease,border-color .16s ease}.dat-team-mode-switch input::after{position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;background:var(--dsw-alias-label-tertiary);content:\"\";transition:transform .16s ease,background .16s ease}.dat-team-mode-switch input:checked{border-color:var(--dsw-alias-state-success-primary);background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 20%,var(--dsw-alias-bg-layer-2))}.dat-team-mode-switch input:checked::after{transform:translateX(14px);background:var(--dsw-alias-state-success-primary)}.dat-team-mode-switch input:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}.dat-team-mode-switch input:disabled{opacity:.5;cursor:wait}.dat-onboarding-details{margin-top:9px;border-top:1px solid var(--dsw-alias-border-l2);padding-top:8px}.dat-onboarding-details>summary{cursor:pointer;color:var(--dsw-alias-label-secondary);font-size:12px}.dat-onboarding-details[open]>summary{margin-bottom:10px}.dat-onboarding-fields{padding:0 2px}.dat-empty-canvas-panel{overflow:hidden;padding:14px}.dat-empty-canvas-route{display:flex;align-items:stretch;gap:8px;min-width:0;overflow-x:auto;padding:2px 1px 8px;scrollbar-width:thin}.dat-empty-canvas-node{display:flex;flex:1 0 170px;min-width:170px;max-width:240px;flex-direction:column;gap:5px;padding:14px;border:1px dashed var(--dsw-alias-border-l3);border-radius:11px;background:var(--dsw-alias-bg-layer-2)}.dat-empty-canvas-node strong{font-size:13px}.dat-empty-canvas-node span{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.45}.dat-empty-canvas-arrow{display:grid;place-items:center;flex:0 0 24px;color:var(--dsw-alias-brand-primary);font-size:18px}.dat-empty-canvas-footer{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-top:4px;padding-top:10px;border-top:1px solid var(--dsw-alias-border-l2)}",
        "@container dat-workspace (min-width:680px){.dat-flow-chain{grid-template-columns:repeat(3,minmax(0,1fr))}.dat-flow-arrow{transform:rotate(-90deg)}.dat-participant-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.dat-automation-grid{grid-template-columns:minmax(0,1fr) minmax(260px,.72fr)}}",
        "@container dat-board-main (min-width:680px){.dat-task-board{grid-template-columns:repeat(2,minmax(0,1fr))}}",
        "@container dat-board-main (min-width:900px){.dat-task-board{grid-template-columns:repeat(4,minmax(0,1fr))}}",
        "@container dat-workspace (min-width:900px){.dat-board-shell.dat-inspector-open{display:grid;grid-template-columns:minmax(0,1fr) minmax(300px,360px);gap:12px;align-items:start}.dat-board-shell .dat-scrim{display:none}.dat-board-shell .dat-inspector{position:sticky;z-index:auto;top:0;right:auto;bottom:auto;width:auto;max-height:calc(100vh - 150px);border-radius:12px}.dat-board-shell .dat-inspector-body{max-height:calc(100vh - 215px)}}",
        "@container dat-workspace (min-width:1120px){.dat-workbench{grid-template-columns:172px minmax(0,1fr);align-items:start}.dat-workspace-nav{position:sticky;top:0;display:grid;align-content:start;margin:0;padding:6px;overflow:visible}.dat-workspace-nav button{width:100%;min-width:0}.dat-workspace-nav small{margin-left:auto}}",
        "@container dat-workspace (max-width:900px){.dat-workspace-nav{overflow-x:auto}.dat-active-shell.dat-inspector-open{display:block}.dat-active-shell .dat-scrim{display:block;position:fixed;inset:0;z-index:39;border:0;background:rgba(0,0,0,.28)}.dat-active-shell .dat-inspector{position:fixed;z-index:40;top:0;right:0;bottom:0;width:min(390px,92vw);max-height:none;border-radius:12px 0 0 12px}.dat-active-shell .dat-inspector-body{max-height:calc(100vh - 60px)}}",
        "@media(max-width:620px){.dat-workspace-nav{overflow-x:auto;border-radius:10px}.dat-workspace-view-head{display:block}.dat-workspace-view-actions{justify-content:flex-start;margin-top:9px}.dat-schedule-row,.dat-participant-row{grid-template-columns:minmax(0,1fr)}.dat-participant-state{text-align:left}.dat-team-mode-bar{align-items:flex-start;flex-direction:column}.dat-team-mode-actions{width:100%;justify-content:space-between}.dat-board-shell .dat-inspector,.dat-active-shell .dat-inspector{width:100%;border-radius:0}}",
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
    function memberModelText(member, t) {
      if (!member) return "";
      var parts = [];
      if (member.model) parts.push(member.provider ? String(member.provider) + " / " + String(member.model) : String(member.model));
      if (member.modelTier === "main") parts.push(t("mainModel"));
      else if (member.modelTier === "subagent") parts.push(t("subagentModel"));
      if (member.inheritsMain) parts.push(t("inheritsMain"));
      return parts.join(" · ");
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
          ? "请创建一个代理团队来完成以下目标：" + objective.trim() + "。" + (selected.id === "custom" ? "请完全根据目标自行设计团队。" : "以“" + selected.title + "”作为协作方向。") + "请由 AI 判断是否需要并行、需要多少成员、各自职责、任务依赖和互不冲突的文件边界；目标跨度较大时，可以由同一负责人创建多个同级团队，并建立跨团队依赖和负责人中继；先建立持久任务，再创建必要成员。负责人/大脑始终保持主模型；普通成员默认使用子代理模型来节省消耗，只有高复杂推理、架构或安全关键任务才使用主模型。成员名称使用“界面、测试、安全、文档”这类 2–6 字直白职责名，避免“宿主、协调器、执行器、实现者、子代理”等技术称谓。不要让用户设计团队结构，也不要为了凑人数创建成员。"
          : "Create an agent team for this objective: " + objective.trim() + ". " + (selected.id === "custom" ? "Design the team entirely from the objective. " : "Use “" + selected.title + "” as the collaboration direction. ") + "AI must decide whether parallelism is useful, how many members are needed, their roles, task dependencies, and non-conflicting file boundaries. For a broad objective, the same root lead may create multiple peer teams with cross-team dependencies and lead-authenticated relays. Create durable tasks before only the necessary members. The root lead/brain must stay on the main model; default ordinary members to the subagent model to reduce cost, and use the main model only for complex reasoning, architecture, or security-critical work. Use short, plain function names such as UI, Test, Security, or Docs; avoid technical titles such as host, coordinator, executor, implementer, or subagent. Do not ask the user to design the team or add members just to fill seats.";
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

    function TaskCard(props) {
      var task = props.task, t = props.t, id = taskId(task), assigned = task.assigneeSessionId || task.assigneeId || task.assignee || task.memberId || "";
      var memberText = typeof props.memberName === "function" ? props.memberName(assigned) : "";
      var modelText = typeof props.memberModel === "function" ? props.memberModel(assigned) : "";
      var className = "dat-card" + (props.compact ? " dat-task-row" : "") + (props.onOpen ? " dat-task-open" : "");
      var label = (task.title || task.name || t("taskFallback", { id: id })) + " · " + statusLabel(t, task.status || task.state || "pending");
      var body = [
        h("div", { className: "dat-card-title" }, task.title || task.name || t("taskFallback", { id: id })),
        task.description ? h("div", { className: "dat-meta", style: { marginTop: 4 } }, task.description) : null,
        h("div", { className: "dat-meta", style: { marginTop: 6 } }, "#" + id + " · " + t("assignee") + ": " + (memberText || t("unassigned"))),
        modelText ? h("div", { className: "dat-meta", style: { marginTop: 2 } }, t("model") + ": " + modelText) : null,
        arrayText(task.blockedBy) ? h("div", { className: "dat-meta dat-warn-text" }, t("blockedBy", { value: arrayText(task.blockedBy) })) : null,
        arrayText(task.dependencySources) ? h("div", { className: "dat-meta" }, t("dependencySources", { value: dependencySourceText(t, task.dependencySources) })) : null,
        arrayText(task.conflictsWith) ? h("div", { className: "dat-meta dat-warn-text" }, t("conflicts", { value: arrayText(task.conflictsWith) })) : null,
        arrayText(task.files || task.fileScope) ? h("div", { className: "dat-meta" }, t("files", { value: arrayText(task.files || task.fileScope) })) : task.fileScopeProjection && task.fileScopeProjection.projected === false ? h("div", { className: "dat-meta" }, t("filesHidden")) : null,
        h("div", { className: "dat-task-status" }, h("span", { className: "dat-badge" }, statusLabel(t, task.status || "pending")))
      ];
      if (props.onOpen) return h("button", { type: "button", className: className, onClick: function (event) { props.onOpen(event, task); }, "aria-label": label }, body);
      return h("article", { className: className }, body);
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
    function normalizeState(value) {
      var normalized = String(value || "").toLowerCase().replace(/[\s-]+/g, "_");
      var aliases = { active: "running", working: "running", inprogress: "in_progress", done: "completed", complete: "completed", stopped: "retired", error: "failed" };
      return Object.prototype.hasOwnProperty.call(aliases, normalized) ? aliases[normalized] : normalized;
    }
    function memberStateKind(member) {
      return normalizeState(member.state || member.status || "") || "unknown";
    }
    function taskStateKind(task) {
      if (task && task.completedAggregate) return "completed";
      var state = normalizeState(task.status || task.state || "");
      if (state === "completed") return "completed";
      if (state === "in_progress") return relationIds(task.blockedBy).length ? "blocked" : "in_progress";
      return state || "pending";
    }
    var CANVAS_NODE_WIDTH = 152, CANVAS_NODE_HEIGHT = 82, CANVAS_GAP_X = 28, CANVAS_GAP_Y = 28, CANVAS_PADDING = 24;
    var CANVAS_MIN_ZOOM = 0.1, CANVAS_MAX_ZOOM = 2, CANVAS_EDGE_LIMIT = 500, CANVAS_RELATIONS_PER_KIND = 6;
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
      var viewRef = useRef({ scale: 1, mode: "fit", offsetX: 12, offsetY: 12 });
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
        var offsetX = Math.max(12, (stageWidth - scaledWidth) / 2), offsetY = Math.max(12, (stageHeight - scaledHeight) / 2);
        stage.style.width = stageWidth + "px"; stage.style.height = stageHeight + "px";
        world.style.left = offsetX + "px"; world.style.top = offsetY + "px";
        world.style.width = layout.width + "px"; world.style.height = layout.height + "px";
        world.style.transform = "scale(" + scale + ")";
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
        var scale = Math.min(1, (Math.max(80, viewport.clientWidth) - 24) / layout.width, (Math.max(80, viewport.clientHeight) - 24) / layout.height);
        syncCanvasScale(scale, "fit");
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
      return h("section", { className: "dat-panel dat-canvas-panel", "aria-labelledby": "dat-team-canvas" },
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

    function TaskDetailSidebar(props) {
      var t = props.t, task = props.task, assignee = props.assignee, events = props.events || [];
      var stateKind = taskStateKind(task);
      var filesText = arrayText(task && (task.files || task.fileScope));
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
            h("dl", { className: "dat-task-facts" },
              detailFact(t("taskRef"), "#" + taskId(task)),
              detailFact(t("assignee"), assignee ? (assignee.displayName || assignee.name || memberId(assignee)) : t("unassigned")),
              detailFact(t("model"), assignee ? memberModelText(assignee, t) : t("unassigned")),
              filesText ? detailFact(t("files"), filesText) : task.fileScopeProjection && task.fileScopeProjection.projected === false ? detailFact(t("files"), t("filesHidden")) : null,
              arrayText(task.blockedBy) ? detailFact(t("blockedBy"), arrayText(task.blockedBy).map(refTitle).join(", ")) : null,
              arrayText(task.conflictsWith) ? detailFact(t("conflicts"), arrayText(task.conflictsWith).map(refTitle).join(", ")) : null,
              arrayText(task.dependencySources) ? detailFact(t("dependencySources"), dependencySourceText(t, task.dependencySources)) : null
            ),
            task.dependencies && task.dependencies.length ? h("section", { className: "dat-task-section", "aria-label": t("taskDependencies") }, h("h3", null, t("taskDependencies")), h("div", { className: "dat-meta" }, task.dependencies.map(refTitle).join(", "))) : null,
            h("section", { className: "dat-task-section" }, h("h3", null, t("taskEvents")), events.length ? h("div", { className: "dat-task-events" }, events.slice(0, 6).map(function (event) { return h(EventCard, { key: eventIdentity(event, ""), event: event, t: t, teamsById: props.teamsById || {} }); })) : h("div", { className: "dat-note" }, t("noEvents"))),
            task.updatedAt || task.createdAt ? h("p", { className: "dat-note", style: { marginTop: 12, marginBottom: 0 } }, t("lastActivity", { value: formatTime(task.updatedAt || task.createdAt) })) : null
          )
        )
      );
    }

    function WorkspaceNav(props) {
      var t = props.t, counts = props.counts || {};
      var items = [
        { id: "board", label: t("workspaceBoard"), count: counts.tasks },
        { id: "canvas", label: t("workspaceCanvas"), count: counts.members },
        { id: "flow", label: t("workspaceFlow") },
        { id: "automation", label: t("workspaceAutomation"), count: counts.schedules },
        { id: "participants", label: t("workspaceParticipants"), count: counts.members },
        { id: "inbox", label: t("workspaceInbox"), count: counts.events }
      ];
      return h("nav", { className: "dat-workspace-nav", "aria-label": t("workspaceNavigation") }, items.map(function (item) {
        return h("button", { key: item.id, type: "button", "aria-current": props.value === item.id ? "page" : undefined, onClick: function () { props.onChange(item.id); } }, h("span", null, item.label), Number.isFinite(item.count) ? h("small", null, item.count) : null);
      }));
    }

    function taskBoardColumn(task) {
      if (relationIds(task.blockedBy).length) return "blocked";
      var status = normalizeState(task.status || task.state || "pending");
      if (status === "completed") return "completed";
      if (status === "in_progress") return "in_progress";
      return "pending";
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
      var pendingQueue = columnId === "pending";
      var fields = columnId === "completed" ? ["completedAt", "updatedAt", "createdAt"] : columnId === "pending" ? ["createdAt", "updatedAt"] : ["updatedAt", "createdAt"];
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

    /*
     * Task-board column and card presentation adapted from
     * chuspeeism/dashi-taskboard at f12f473c0049757bd0090be418f9d969a1d91194,
     * Apache License 2.0. Harness modifications: plain React.createElement,
     * selected-team safe projection, derived blocked column, and read-only UI.
     */
    function BoardTaskCard(props) {
      var task = props.task, t = props.t, id = taskId(task);
      var assigned = task.assigneeSessionId || task.assigneeId || task.assignee || task.memberId || "";
      var member = (props.members || []).filter(function (item) { return memberId(item) === assigned || memberSession(item) === assigned; })[0];
      var owner = member ? simpleMemberName(member, member.isLead || member.kind === "lead" || memberSession(member) === props.leadSessionId, t) : t("unassigned");
      var model = member ? memberModelText(member, t) : "";
      var dependencies = relationIds(task.dependsOn).length + relationIds(task.blockedBy).length;
      var conflicts = relationIds(task.conflictsWith).length;
      return h("button", { type: "button", className: "dat-board-card", onClick: function (event) { props.onOpen(event, task); }, "aria-label": (task.title || task.name || t("taskFallback", { id: id })) + " · " + statusLabel(t, taskBoardColumn(task)) },
        h("div", { className: "dat-board-card-top" }, h("span", { className: "dat-board-card-id" }, "#" + id), h("span", { className: "dat-board-card-flag" }, statusLabel(t, taskBoardColumn(task)))),
        h("div", { className: "dat-board-card-title" }, task.title || task.name || t("taskFallback", { id: id })),
        h("div", { className: "dat-board-card-owner" }, owner, model ? " · " + model : ""),
        dependencies || conflicts ? h("div", { className: "dat-board-card-flags" }, dependencies ? h("span", { className: "dat-board-card-flag" + (taskBoardColumn(task) === "blocked" ? " is-warning" : "") }, t("taskDependencies") + " " + dependencies) : null, conflicts ? h("span", { className: "dat-board-card-flag is-warning" }, t("conflicts", { value: conflicts })) : null) : null
      );
    }

    function TaskBoardWorkspace(props) {
      var t = props.t, team = props.team, tasks = team && team.tasks || [], members = team && team.members || [];
      var totalTaskCount = Number.isFinite(team && team.taskCount) ? team.taskCount : tasks.length;
      var projectionLimited = !!(team && team.projection && team.projection.tasksTruncated) || totalTaskCount > tasks.length;
      var selectedPair = useState(""), selectedTaskId = selectedPair[0], setSelectedTaskId = selectedPair[1];
      var detailRef = useRef(null), triggerRef = useRef(null);
      var detailModal = useInspectorModal(detailRef, !!selectedTaskId);
      var selectedTask = tasks.filter(function (task) { return taskId(task) === selectedTaskId; })[0] || null;
      var selectedAssignee = selectedTask ? members.filter(function (member) { var assigned = selectedTask.assigneeSessionId || selectedTask.assigneeId || selectedTask.assignee || selectedTask.memberId || ""; return memberSession(member) === assigned || memberId(member) === assigned; })[0] || null : null;
      var teamsById = {}; (props.teams || []).forEach(function (item) { teamsById[teamId(item)] = item; });
      var events = [], seenEvents = {};
      if (team) {
        (team.events || team.messages || []).forEach(function (event) { pushUniqueEvent(events, seenEvents, event, teamId(team)); });
        (team.inboundEvents || []).forEach(function (event) { pushUniqueEvent(events, seenEvents, event, event.fromTeamId); });
      }
      events.sort(function (left, right) { return Date.parse(right.createdAt || right.timestamp || right.at || 0) - Date.parse(left.createdAt || left.timestamp || left.at || 0); });
      var selectedTaskEvents = selectedTask ? events.filter(function (event) { return eventRelatesToTask(event, selectedTask); }) : [];
      function closeTaskDetail() {
        setSelectedTaskId("");
        if (triggerRef.current && typeof triggerRef.current.focus === "function") triggerRef.current.focus();
      }
      function openTaskDetail(event, task) { triggerRef.current = event && event.currentTarget; setSelectedTaskId(taskId(task)); }
      useEffect(function () { setSelectedTaskId(""); }, [team && teamId(team)]);
      useEffect(function () {
        if (!selectedTaskId) return;
        if (detailRef.current && typeof detailRef.current.focus === "function") detailRef.current.focus();
        var onKey = function (event) { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); closeTaskDetail(); } else trapInspectorTab(event, detailRef.current); };
        document.addEventListener("keydown", onKey);
        return function () { document.removeEventListener("keydown", onKey); };
      }, [selectedTaskId]);
      var columns = [
        { id: "pending", label: t("boardPending"), limit: 200 },
        { id: "in_progress", label: t("boardProgress"), limit: 200 },
        { id: "blocked", label: t("boardBlocked"), limit: 200 },
        { id: "completed", label: t("boardCompleted"), limit: 200 }
      ];
      return h("section", { className: "dat-workspace-view", "aria-labelledby": "dat-task-board-title", "aria-readonly": "true" },
        h("div", { className: "dat-workspace-view-head" }, h("div", null, h("h2", { id: "dat-task-board-title" }, t("boardTitle")), h("p", null, t("boardIntro"))), h("div", { className: "dat-workspace-view-actions" }, h("span", { className: "dat-badge" }, t("boardReadOnly")), h(Button, { small: true, onClick: function () { props.setWorkspaceView("canvas"); } }, t("boardOpenCanvas")))),
        h("div", { className: "dat-board-toolbar" }, h("div", null, h("strong", null, teamName(team, t)), h("div", { className: "dat-note", style: { marginTop: 2 } }, team.objective || t("unknown"))), h("div", { className: "dat-row" }, h("span", { className: "dat-badge" }, t("boardScope")), h("span", { className: "dat-badge" }, t("revision", { value: team.revision || "–" })))),
        h("div", { className: "dat-board-note", role: "note" }, h("span", { "aria-hidden": "true" }, "ⓘ"), h("span", null, t("boardReadOnlyHint"), " ", t("boardBlockedDerived"))),
        projectionLimited ? h("div", { className: "dat-board-note dat-board-projection-note", role: "note" }, h("span", { "aria-hidden": "true" }, "⚠"), h("span", null, t("boardProjectionLimited", { shown: tasks.length, total: totalTaskCount }))) : null,
        h("div", { className: "dat-board-shell" + (selectedTaskId ? " dat-inspector-open" : "") },
          h("div", { className: "dat-board-main", "aria-hidden": detailModal ? true : undefined, inert: detailModal ? "" : undefined }, h("div", { className: "dat-task-board" }, columns.map(function (column) {
            var columnTasks = sortBoardColumnTasks(tasks.filter(function (task) { return taskBoardColumn(task) === column.id; }), column.id);
            var visible = columnTasks.slice(0, column.limit);
            return h("section", { key: column.id, className: "dat-board-column", "data-column": column.id, "aria-labelledby": "dat-board-column-" + column.id },
              h("div", { className: "dat-board-column-head" }, h("div", { className: "dat-board-column-heading" }, h("span", { className: "dat-board-status-dot", "aria-hidden": "true" }), h("h3", { id: "dat-board-column-" + column.id }, column.label)), h("span", { className: "dat-badge" }, columnTasks.length)),
              h("div", { className: "dat-board-column-list" }, visible.length ? visible.map(function (task) { return h(BoardTaskCard, { key: taskId(task), task: task, members: members, leadSessionId: team.leadSessionId, t: t, onOpen: openTaskDetail }); }) : h("div", { className: "dat-board-empty" }, t("boardEmpty")), columnTasks.length > visible.length ? h("div", { className: "dat-board-overflow" }, t("boardMore", { count: columnTasks.length - visible.length })) : null)
            );
          }))),
          selectedTaskId ? h(React.Fragment, null, h("button", { type: "button", className: "dat-scrim", onClick: closeTaskDetail, "aria-label": t("closePanel") }), h(TaskDetailSidebar, { t: t, task: selectedTask, assignee: selectedAssignee, events: selectedTaskEvents, tasks: tasks, teamsById: teamsById, detailRef: detailRef, modal: detailModal, onClose: closeTaskDetail })) : null
        )
      );
    }

    function EmptyTaskBoardWorkspace(props) {
      var t = props.t;
      var columns = [
        { id: "pending", label: t("boardPending") },
        { id: "in_progress", label: t("boardProgress") },
        { id: "blocked", label: t("boardBlocked") },
        { id: "completed", label: t("boardCompleted") }
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

    function FlowWorkspace(props) {
      var t = props.t;
      var steps = [
        ["flowGoal", "flowGoalBody"], ["flowPlan", "flowPlanBody"], ["flowTasks", "flowTasksBody"],
        ["flowMembers", "flowMembersBody"], ["flowCoordinate", "flowCoordinateBody"], ["flowResult", "flowResultBody"]
      ];
      return h("section", { className: "dat-workspace-view dat-flow-blueprint", "aria-labelledby": "dat-flow-title", "aria-readonly": "true" },
        h("div", { className: "dat-workspace-view-head" }, h("div", null, h("h2", { id: "dat-flow-title" }, t("flowTitle")), h("p", null, t("flowIntro"))), h("span", { className: "dat-badge" }, t("flowReadOnly"))),
        h("div", { className: "dat-flow-chain" }, steps.map(function (step, index) { return h("article", { key: step[0], className: "dat-flow-step" }, h("strong", null, (index + 1) + ". " + t(step[0])), h("span", null, t(step[1]))); })),
        h("p", { className: "dat-flow-boundary" }, t("projectAutomationPending"))
      );
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
          h("section", { className: "dat-panel dat-automation-panel", "aria-labelledby": "dat-project-automation" }, h("div", { className: "dat-automation-panel-head" }, h("div", null, h("h3", { id: "dat-project-automation" }, t("projectAutomation"))), h("span", { className: "dat-badge" }, "planned")), h("div", { className: "dat-schedule-boundary" }, t("projectAutomationPending")))
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
        setSelectedTaskId(taskId(task));
      }
      function closeTaskDetail() {
        setSelectedTaskId("");
        if (triggerRef.current && typeof triggerRef.current.focus === "function") triggerRef.current.focus();
      }
      var activeTasks = tasks.filter(function (task) { return String(task.status || task.state || "pending").toLowerCase() !== "completed"; }).sort(function (left, right) { return String(left.status || left.state) === "in_progress" ? -1 : String(right.status || right.state) === "in_progress" ? 1 : 0; });
      var completedTasks = tasks.filter(function (task) { return String(task.status || task.state || "").toLowerCase() === "completed"; }).sort(function (left, right) { return Date.parse(right.updatedAt || right.completedAt || 0) - Date.parse(left.updatedAt || left.completedAt || 0); });
      var currentMembers = sortMembersByActivity(members.filter(function (member) { return String(member.state || member.status || "").toLowerCase() !== "retired"; }));
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
      useEffect(function () { setHistoryOpen(!!props.closed); setHistoryLimit(40); setWorkMode("canvas"); setActionsOpen(false); setDrawerOpen(false); setSelectedTaskId(""); }, [teamId(team), props.closed]);
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
        h(TaskDetailSidebar, { t: t, task: selectedTask, assignee: selectedAssignee, events: selectedTaskEvents, tasks: tasks, teamsById: teamsById, detailRef: taskDetailRef, modal: inspectorModal, onClose: closeTaskDetail })
      ) : null;
      return h("div", { className: "dat-active-shell" + (drawerOpen || selectedTaskId ? " dat-inspector-open" : "") },
        h("div", { className: "dat-work-main", "aria-hidden": inspectorModal ? true : undefined, inert: inspectorModal ? "" : undefined },
          props.closed ? h("section", { className: "dat-panel dat-closed", role: "status" }, h("strong", null, t("closed")), h("div", { className: "dat-meta", style: { marginTop: 4 } }, t("closedBody")), h("div", { style: { marginTop: 10 } }, h(Button, { small: true, onClick: function () { prompt(isChinese() ? "请询问我的下一个目标；收到目标后，由你判断是否需要团队并自动规划必要成员、任务依赖和文件边界，不要让我设计团队结构。" : "Ask for my next objective. After I provide it, decide whether a team is useful and design only the necessary members, task dependencies, and file boundaries yourself; do not ask me to design the team structure.", { creation: true, includeTeams: true }); } }, t("newTeam")))) : props.paused ? h("section", { className: "dat-panel dat-closed", role: "status" }, h("strong", null, t("paused")), h("div", { className: "dat-meta", style: { marginTop: 4 } }, t("pausedBody"))) : null,
          h("header", { className: "dat-command-bar" }, h("div", { className: "dat-command-title" }, h("h2", { className: "dat-title" }, teamName(team, t)), h("p", { className: "dat-subtitle" }, objective), h("div", { className: "dat-row", style: { marginTop: 6 } }, h("span", { className: "dat-badge" }, teamStatusLabel(t, team.status)), h("span", { className: "dat-badge" }, t("revision", { value: team.revision || "–" })))), h("div", { className: "dat-row" }, h(Button, { small: true, disabled: !team.leadSessionId || !props.sessions || typeof props.sessions.setSubagentCatalogOpen !== "function", onClick: openAgentCatalog }, t("openMembers", { count: agentCount })), h(Button, { small: true, ariaPressed: drawerOpen, onClick: openActivityPanel }, t("openActivity", { count: events.length })), completedTasks.length ? h(Button, { small: true, ariaPressed: historyOpen, onClick: function () { setHistoryOpen(!historyOpen); } }, historyOpen ? t("hideHistory") : t("openHistory", { count: completedTasks.length })) : null, !props.closed && !props.paused ? h(Button, { small: true, ariaPressed: actionsOpen, onClick: function () { setActionsOpen(!actionsOpen); } }, actionsOpen ? t("fewerActions") : t("moreActions")) : null)),
          projectionLimited ? h("div", { className: "dat-board-note dat-board-projection-note", role: "note" }, h("span", { "aria-hidden": "true" }, "⚠"), h("span", null, t("boardProjectionLimited", { shown: tasks.length, total: totalTaskCount }))) : null,
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
      if (!snapshot && !live.error) {
        workspaceContent = h("div", { className: "dat-panel dat-empty", role: "status" }, t("loading"));
      } else if (snapshot && !snapshot.enabled) {
        workspaceContent = h("section", { className: "dat-panel dat-empty", "aria-labelledby": "dat-disabled" }, h("h2", { id: "dat-disabled" }, t("disabled")), h("p", null, t("disabledBody")), h(Button, { primary: true, disabled: busy, onClick: enable }, busy ? t("enabling") : t("enable")));
      } else if (workspaceView === "participants") {
        workspaceContent = h(React.Fragment, null, teams.length > 1 ? h(TeamOverview, { t: t, teams: teams, selectedId: team && teamId(team), select: setSelectedId }) : null, h(ParticipantsWorkspace, { t: t, team: team, teams: teams, sessions: props.sessions }));
      } else if (workspaceView === "automation") {
        workspaceContent = h(AutomationWorkspace, { t: t, sessionId: props.sessionId, setView: props.setView });
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
              : h(TaskBoardWorkspace, { t: t, team: team, teams: teams, setWorkspaceView: setWorkspaceView }),
          h("details", { className: "dat-disclosure dat-settings-disclosure" }, h("summary", null, t("workspaceSettings")), h(DisableAutomaticTeams, { t: t, labelId: "dat-disable-teams", disable: disable, busy: busy, hasActive: hasActiveTeams }))
        );
      }
      return h("main", { className: "dat-view", "aria-labelledby": "dat-view-title" }, h("div", { className: "dat-shell" },
        h("div", { className: "dat-head" }, h("div", null, h("h1", { id: "dat-view-title", className: "dat-title" }, t("title")), h("p", { className: "dat-subtitle" }, t("workspaceIntro"))), h("span", { className: "dat-badge", title: t("connection") + " · " + props.sessionId }, h("span", { className: "dat-dot", style: live.connection === "live" ? null : { background: "var(--dsw-alias-state-warn-primary)" } }), t(connectionKey))),
        live.error ? h("div", { className: "dat-error", role: "alert" }, t("loadError", { error: live.error }), " ", h(Button, { small: true, onClick: live.reload }, t("retry"))) : null,
        actionError ? h("div", { className: "dat-error", role: "alert" }, t("actionError", { error: actionError })) : null,
        h("div", { className: "dat-sr", role: "status", "aria-live": "polite" }, notice),
        h("section", { className: "dat-workspace" }, h("div", { className: "dat-workbench" },
          h(WorkspaceNav, { t: t, value: workspaceView, onChange: setWorkspaceView, counts: { tasks: taskCount, members: memberCount, events: eventCount } }),
          h("div", { className: "dat-workspace-main" }, workspaceContent)
        ))
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
