(() => {
  const root = document.documentElement
  if (!root) return
  root.dataset.harnessMobile = 'true'

  // Runtime features are shared by default and enabled per capability rather
  // than by user-agent sniffing. Android remains the compatibility default for
  // existing APKs; iOS declares HarnessMobilePlatform before this script runs.
  const mobilePlatform = String(window.HarnessMobilePlatform || 'android').toLowerCase() === 'ios' ? 'ios' : 'android'
  const mobileCapabilities = Object.freeze({
    imeSendBridge: mobilePlatform === 'android',
    nativeImeInsets: mobilePlatform === 'android',
    screenshotSuggestion: mobilePlatform === 'android',
    controlSettings: mobilePlatform === 'android'
  })
  root.dataset.harnessMobilePlatform = mobilePlatform
  if (!window.__harnessMobileCapabilities) {
    Object.defineProperty(window, '__harnessMobileCapabilities', {
      value: mobileCapabilities,
      configurable: false,
      enumerable: false,
      writable: false
    })
  }

  const installAbortSignalAnyCompatibility = () => {
    const Signal = window.AbortSignal
    const Controller = window.AbortController
    if (!Signal || !Controller || typeof Signal.any === 'function') return
    Object.defineProperty(Signal, 'any', {
      configurable: true,
      writable: true,
      value(signals) {
        const sources = Array.from(signals)
        const controller = new Controller()
        const listeners = []
        const abortFrom = source => {
          if (!controller.signal.aborted) controller.abort(source.reason)
          for (const [signal, listener] of listeners) signal.removeEventListener('abort', listener)
          listeners.length = 0
        }
        for (const signal of sources) {
          if (!signal || typeof signal.aborted !== 'boolean' || typeof signal.addEventListener !== 'function') {
            throw new TypeError('AbortSignal.any expects AbortSignal values')
          }
          if (signal.aborted) {
            abortFrom(signal)
            break
          }
          const listener = () => abortFrom(signal)
          listeners.push([signal, listener])
          signal.addEventListener('abort', listener, { once: true })
        }
        return controller.signal
      }
    })
  }
  installAbortSignalAnyCompatibility()

  const serverAcceptsTimeZone = value => value === 'UTC' || /^[A-Za-z][A-Za-z0-9._+-]*(?:\/[A-Za-z0-9._+-]+)+$/.test(String(value || ''))
  const installTimeZoneCompatibility = () => {
    const prototype = window.Intl?.DateTimeFormat?.prototype
    if (!prototype || prototype.__harnessMobileResolvedOptions) return
    const nativeResolvedOptions = prototype.resolvedOptions
    Object.defineProperty(prototype, '__harnessMobileResolvedOptions', { value: nativeResolvedOptions })
    prototype.resolvedOptions = function (...args) {
      const options = nativeResolvedOptions.apply(this, args)
      return serverAcceptsTimeZone(options?.timeZone) ? options : { ...options, timeZone: 'UTC' }
    }
  }
  installTimeZoneCompatibility()

  const visible = node => {
    if (!node) return false
    const style = getComputedStyle(node)
    const rect = node.getBoundingClientRect()
    return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0
  }

  const dismissOfficialNotice = () => {
    const notice = [...document.querySelectorAll('[role="dialog"],dialog')]
      .find(node => /Internal Testing Notice|内部测试提示|内部测试公告|内测声明/i.test(node.textContent || ''))
    if (!notice) return false
    const proceed = [...notice.querySelectorAll('button')]
      .find(button => /^(Continue|继续|我知道了)$/i.test((button.textContent || '').trim()))
    if (!proceed) return false
    proceed.click()
    return true
  }

  const decorateHeader = () => {
    const sessionLog = [...document.querySelectorAll('button')]
      .find(button => /Session log|会话日志|会话记录/i.test(button.textContent || ''))
    if (!sessionLog) return
    sessionLog.dataset.harnessMobileSessionLog = 'true'
    sessionLog.setAttribute('aria-label', '会话日志')

    const utilities = sessionLog.parentElement?.parentElement
    const titleRow = utilities?.parentElement
    if (utilities) utilities.dataset.harnessMobileHeaderUtilities = 'true'
    if (titleRow) {
      titleRow.dataset.harnessMobileTitleRow = 'true'
      if (titleRow.firstElementChild) titleRow.firstElementChild.dataset.harnessMobileTitleCluster = 'true'
    }

    for (const button of titleRow?.querySelectorAll('button') || []) {
      if (/\d+\s*(?:个)?子代理|subagents?/i.test(`${button.textContent || ''} ${button.getAttribute('aria-label') || ''}`)) {
        button.dataset.harnessMobileSubagents = 'true'
        const count = (button.textContent || '').match(/\d+/)?.[0]
        if (count) {
          const label = `${count} 个子代理`
          const countNode = button.querySelector('[class*="_count"]')
          if (countNode && countNode.textContent !== label) countNode.textContent = label
          button.setAttribute('aria-label', label)
        }
      }
    }
  }

  const decorateSessions = () => {
    const rows = [...document.querySelectorAll('[role="treeitem"]')]
    for (const row of rows) {
      const className = String(row.className || '')
      const session = className.includes('_sessionRow')
      delete row.dataset.harnessMobileNavigationBranch
      delete row.dataset.harnessMobileNavigationLeaf
      delete row.dataset.harnessMobileWorkspaceRow
      delete row.dataset.harnessMobileFolderRow
      delete row.dataset.harnessMobileEmptyRow
      for (const child of row.querySelectorAll(':scope > [data-harness-mobile-navigation-chrome="true"]')) delete child.dataset.harnessMobileNavigationChrome
      if (session) {
        row.dataset.harnessMobileSessionRow = 'true'
        delete row.dataset.harnessMobileNavigationRow
      } else {
        row.dataset.harnessMobileNavigationRow = 'true'
        row.dataset[/workspace/i.test(className) ? 'harnessMobileWorkspaceRow' : 'harnessMobileFolderRow'] = 'true'
        if (!String(row.textContent || '').trim()) row.dataset.harnessMobileEmptyRow = 'true'
        delete row.dataset.harnessMobileSessionRow
      }
    }
    for (const row of rows.filter(item => item.dataset.harnessMobileNavigationRow === 'true')) {
      const containsSession = Boolean(row.querySelector('[data-harness-mobile-session-row="true"]'))
      row.dataset[containsSession ? 'harnessMobileNavigationBranch' : 'harnessMobileNavigationLeaf'] = 'true'
      if (!containsSession) continue
      for (const child of row.children) {
        if (child.matches?.('[data-harness-mobile-session-row="true"]') || child.querySelector?.('[data-harness-mobile-session-row="true"]')) continue
        child.dataset.harnessMobileNavigationChrome = 'true'
      }
    }
    for (const node of document.querySelectorAll('[data-harness-mobile-project-row="true"]')) delete node.dataset.harnessMobileProjectRow
    for (const project of rows.filter(item => item.dataset.harnessMobileNavigationRow === 'true' && item.hasAttribute('aria-expanded') && String(item.textContent || '').trim())) {
      project.dataset.harnessMobileProjectRow = 'true'
    }
    for (const branch of document.querySelectorAll('[data-harness-mobile-navigation-branch="true"]')) {
      if (!branch.querySelector('[data-harness-mobile-session-row="true"]')) continue
      const project = [...branch.querySelectorAll('[data-harness-mobile-navigation-leaf="true"]')]
        .find(node => !node.querySelector('[data-harness-mobile-session-row="true"]'))
      if (project) project.dataset.harnessMobileProjectRow = 'true'
    }
    for (const session of rows.filter(item => item.dataset.harnessMobileSessionRow === 'true')) {
      for (let index = rows.indexOf(session) - 1; index >= 0; index -= 1) {
        const project = rows[index]
        if (project.dataset?.harnessMobileNavigationLeaf === 'true') {
          project.dataset.harnessMobileProjectRow = 'true'
          break
        }
      }
    }
    const sessionCount = rows.filter(item => item.dataset.harnessMobileSessionRow === 'true').length
    const projectCount = rows.filter(item => item.dataset.harnessMobileProjectRow === 'true').length
    const countNode = document.querySelector?.('[data-harness-mobile-conversation-count]')
    const recoveryLabel = root.dataset.harnessMobileIndexRecovery ? ' · 正在恢复最新列表' : ''
    if (countNode) countNode.textContent = `${projectCount} 个项目 · ${sessionCount} 个对话${recoveryLabel}`
  }

  let mobileConversationFilter = ''
  const applyMobileConversationFilter = () => {
    const query = mobileConversationFilter.trim().toLocaleLowerCase()
    for (const row of document.querySelectorAll('[data-harness-mobile-session-row="true"], [data-harness-mobile-navigation-row="true"]')) {
      const matched = !query || String(row.textContent || '').toLocaleLowerCase().includes(query)
      if (matched) delete row.dataset.harnessMobileSearchHidden
      else row.dataset.harnessMobileSearchHidden = 'true'
    }
  }

  const translateStableLabels = () => {
    const replacements = new Map([
      ['Session log', '会话日志'],
      ['Settings', '设置'],
      ['Pin', '置顶'],
      ['Unpin', '取消置顶'],
      ['Rename', '重命名'],
      ['Mark as unread', '标为未读'],
      ['Mark as read', '标为已读'],
      ['Archive', '归档'],
      ['Unarchive', '取消归档'],
      ['Project', '项目'],
      ['Copy', '复制'],
      ['Open in new window', '在新窗口中打开'],
      ['Move to project', '移动到项目'],
      ['Remove from project', '移出项目'],
      ['Delete', '删除'],
      ['Workspaces', '对话分组'],
      ['New Session', '新建对话'],
      ['Add workspace', '新建分组'],
      ['Delete workspace', '删除项目'],
      ['Ungrouped', '未分组'],
      ['Loading plugins...', '正在加载功能…'],
      ['Task board', '任务板'],
      ['Project tasks', '项目任务'],
      ['Stored with the project independently of the current Agent Team. Only safe task summaries are shown here.', '项目任务独立于当前代理团队保存；这里只显示安全的任务摘要。'],
      ['Refresh tasks', '刷新任务'],
      ['Task title', '任务标题'],
      ['For example: verify release acceptance', '例如：核对发布验收项'],
      ['Create task', '创建任务'],
      ['Only the create or status change you explicitly select is run. Nothing is auto-approved, messaged, or rewritten after a conflict.', '只执行你明确选择的创建或状态变更；发生冲突后不会自动批准、发送消息或改写内容。'],
      ['No project tasks', '暂无项目任务'],
      ['Team canvas', '团队画布'],
      ['How teams work', '团队说明'],
      ['Schedules & automation', '定时与自动化'],
      ['Participants', '参与者'],
      ['Coordination activity', '协调记录'],
      ['Agent Teams', '代理团队'],
      ['Only work that needs attention is shown by default. Completed work and collaboration details stay available on demand.', '默认只展示需要关注的工作；完成内容和协作细节可按需查看。'],
      ['Up to date', '已更新'],
      ['Running', '运行中'],
      ['Deep diving...', '深度处理中…'],
      ['Context compacted', '上下文已压缩'],
      ['Ongoing Goal', '持续目标'],
      ['To-dos', '待办'],
      ['Update to-do list', '更新待办'],
      ['Tool call', '工具调用'],
      ['Pwsh', '命令'],
      ['Glob', '查找文件'],
      ['Grep', '搜索内容'],
      ['Read', '读取'],
      ['Write', '写入'],
      ['Edit', '编辑'],
      ['Main model', '主模型'],
      ['Active teams', '进行中的团队'],
      ['Team history', '团队历史'],
      ['Collaboration active', '协作进行中'],
      ['View history', '历史记录'],
      ['More actions', '更多操作'],
      ['Canvas', '画布'],
      ['List', '列表'],
      ['Live team canvas', '实时团队画布'],
      ['The team canvas is ready', '团队画布已就绪'],
      ['When the first team appears, this view shows the lead, members, tasks, assignments, dependencies, blockers, and conflicts.', '首个团队创建后，此处将显示负责人、成员、任务、分配关系、依赖、阻塞与冲突。'],
      ['Waiting for the first team', '等待首个团队'],
      ['Team goal', '团队目标'],
      ['A person states the result to deliver', '由用户说明需要交付的结果'],
      ['Root lead', '根负责人'],
      ['Decides whether to form a team and owns delivery', '决定是否组建团队并负责最终交付'],
      ['Members and tasks', '成员与任务'],
      ['Builds real assignments and dependencies', '建立真实的分配关系与依赖'],
      ['Coordination workspace', '协作工作区'],
      ['Collects handoffs, blockers, and cross-team delivery', '汇总交接、阻塞与跨团队交付'],
      ['Waiting for the first team to connect the live relationship graph', '等待首个团队接入实时关系图'],
      ['Return to Chat and state a goal', '返回对话并说明目标'],
      ['Canvas view controls', '画布视图控制'],
      ['Zoomable team relationship canvas', '可缩放的团队关系画布'],
      ['Zoomable team relationship canvas. Drag empty space to pan. Hold Ctrl or Command while scrolling to zoom. Arrow keys scroll the canvas.', '可缩放的团队关系画布。拖动空白区域可平移；按住 Ctrl 或 Command 滚动可缩放；方向键可滚动画布。'],
      ['Zoom out', '缩小'],
      ['Zoom in', '放大'],
      ['Reset zoom to 100%', '重置为 100%'],
      ['Fit canvas to viewport', '使画布适应视口'],
      ['Fit', '适应'],
      ['Working', '工作中'],
      ['Waiting for work', '等待任务'],
      ['Lead', '负责人'],
      ['Select a member to open the unified agent catalog. Lines show assignment, dependency, blocking, or file conflicts. Drag empty space to pan. Hold Ctrl or Command while scrolling to zoom. Arrow keys scroll the canvas.', '选择成员可打开统一代理目录；连线表示分配、依赖、阻塞或文件冲突。拖动画布可平移，双指缩放或使用工具栏调整视图。'],
      ['Switching teams or views never stops background members.', '切换团队或页面不会停止后台成员。'],
      ['Current team task board', '当前团队任务板'],
      ['Organizes the selected team by real runtime state. Switching teams never stops background members.', '按真实运行状态整理当前团队；切换页面不会停止后台成员。'],
      ['View only', '仅查看'],
      ['View team relationships', '查看团队关系'],
      ['Selected team tasks (view only)', '当前团队任务（仅查看）'],
      ['This page shows the latest status. To create, assign, or complete a task, ask in the lead conversation; permission and current-state checks still apply.', '此页展示最新状态。要创建、分配或完成任务，请在负责人对话中提出；权限与实时状态校验仍然有效。'],
      ['This page shows the latest status. To create, assign, or complete a task, ask in the lead conversation; permission and current-state checks still apply. These tasks cannot start until their prerequisites finish; their stored task status is unchanged.', '此页展示最新状态。要创建、分配或完成任务，请在负责人对话中提出；前置任务、权限与实时状态校验仍然有效。'],
      ['Pending', '待处理'],
      ['In progress', '进行中'],
      ['Blocked', '已阻塞'],
      ['Completed', '已完成'],
      ['Cancelled', '已取消'],
      ['Ready', '就绪'],
      ['Running', '执行中'],
      ['Attention', '需关注'],
      ['Done', '已完成'],
      ['Cancelled history', '已取消历史'],
      ['No tasks in this column', '此列暂无任务'],
      ['Team execution flow', '团队执行流程'],
      ['This page explains how teams work today. It is view only and cannot edit the flow yet.', '此页说明团队当前如何工作；现阶段仅供查看。'],
      ['How teams work · view only', '团队工作方式 · 仅查看'],
      ['Schedules and automation', '定时任务与自动化'],
      ['Session reminders stay on the left; reviewable project automation stays on the right. They never trigger each other or merge their history.', '会话提醒与项目自动化分别保存、分别执行；两者不会互相触发，也不会合并历史。'],
      ['Open full scheduled tasks', '打开完整定时任务'],
      ['Current-session reminders', '当前会话提醒'],
      ['This session only', '仅当前会话'],
      ['Runs only while the original session is live. Missed reminders are delivered after it resumes. Delivery does not mean a team task succeeded.', '仅在原会话存续时运行；恢复会话后会补发错过的提醒。提醒送达不代表团队任务已经完成。'],
      ['No session reminders', '暂无会话提醒'],
      ['Project automation', '项目自动化'],
      ['Project automation uses separate project storage and audit history. Session reminders on the left stay session-only; neither side triggers or merges records with the other.', '项目自动化使用独立的项目存储与审计历史；会话提醒仍只属于来源会话，两者不会互相触发或合并记录。'],
      ['Refresh automation', '刷新自动化'],
      ['Loading session reminders…', '正在读取会话提醒…'],
      ['This session is not running. Resume the original session, then refresh this page.', '此会话当前未运行。请先恢复原会话，再刷新此页。'],
      ['Recent dispatch and disable records', '最近触发与停用记录'],
      ['Project automation follows Manual trigger → Human approval → Queue → Background execution, with a reviewable record at every step.', '项目自动化遵循“手动触发 → 人工审批 → 排队 → 后台执行”，每一步都有可审查记录。'],
      ['Loading project automation…', '正在读取项目自动化…'],
      ['No project exists yet. Create a local project under Participants first.', '当前还没有项目。请先在“参与者”中创建本地项目。'],
      ['Automation summaries were synced securely from the primary desktop. Only approved shared data is shown.', '自动化摘要已从主电脑安全同步；这里只显示获准共享的数据。'],
      ['The primary desktop allows approval of currently eligible runs; the buttons shown for each run remain the final gate.', '主电脑允许审批当前符合条件的运行；每条运行显示的按钮仍是最终确认入口。'],
      ['This view is safely read only. If the primary desktop is offline, sync is resetting, or access was revoked, refresh later or contact the project owner.', '此视图为安全只读。如果主电脑离线、同步正在重置或访问已撤销，请稍后刷新或联系项目所有者。'],
      ['The approval is stored safely and is awaiting a receipt from the primary desktop. Do not click again while offline; the identical request retries automatically after reconnecting.', '审批请求已安全保存，正在等待主电脑回执。离线时请勿重复点击；重新连接后会自动重试同一请求。'],
      ['Project automation is unavailable. Follow the project guidance shown here.', '项目自动化当前不可用，请按此处显示的项目指引处理。'],
      ['Automation name', '自动化名称'],
      ['Project task', '项目任务'],
      ['Choose', '请选择'],
      ['Target status', '目标状态'],
      ['Block reason', '阻塞原因'],
      ['Create automation', '创建自动化'],
      ['Creating…', '正在创建…'],
      ['This desktop cannot create project automation.', '当前电脑不能创建项目自动化。'],
      ['Automation definitions', '自动化规则'],
      ['No automation definitions', '暂无自动化规则'],
      ['Recent runs', '最近运行'],
      ['Approval only queues the run; the button request does not execute the task directly.', '审批仅会将运行加入队列；按钮请求不会直接执行任务。'],
      ['No runs', '暂无运行记录'],
      ['Recent audit history', '最近审计记录'],
      ['No audit records', '暂无审计记录'],
      ['Enable', '启用'],
      ['Disable', '停用'],
      ['Create run', '创建运行'],
      ['Approve and queue', '批准入队'],
      ['Reject', '拒绝'],
      ['Retry', '重试'],
      ['Request cancellation', '请求取消'],
      ['Submitting…', '正在提交…'],
      ['Enabled', '已启用'],
      ['Disabled', '已停用'],
      ['Awaiting approval', '等待批准'],
      ['Approved', '已批准'],
      ['Rejected', '已拒绝'],
      ['Queued', '已排队'],
      ['Succeeded', '已成功'],
      ['Failed', '失败'],
      ['Cancellation requested', '正在请求取消'],
      ['Canceled', '已取消'],
      ['Run created', '已创建运行'],
      ['Approval recorded', '已记录审批'],
      ['Run started', '已开始运行'],
      ['Run finished', '运行已结束'],
      ['Cancellation requested or completed', '已请求或完成取消'],
      ['Automation event', '自动化事件'],
      ['The automation action did not finish. Refresh authoritative state, then try again.', '自动化操作未完成。请刷新权威状态后重试。'],
      ['Planned', '待处理'],
      ['Done', '已完成'],
      ['Not available yet', '暂不可用'],
      ['Participants and collaboration access', '参与者与协作接入'],
      ['Current execution resources', '当前执行资源'],
      ['Human collaboration access', '多人协作接入'],
      ['Open agent catalog', '打开代理目录'],
      ['Delivery details only', '仅显示投递信息'],
      ['No coordination activity needs attention', '暂无需要关注的协调动态'],
      ['Refresh', '刷新'],
      ['Into the Unknown', '今天想做什么？'],
      ['Describe what you want to build', '给智能体发消息'],
      ['DSH Plugins', 'DSH 插件'],
      ['General Skills', '通用 Skills'],
      ['DSH Plugin Marketplace', 'DSH 插件市场'],
      ['Fetches all plugins on startup, sorted by stars (10-min cache)', '启动时获取全部插件，按 Star 数排序（缓存 10 分钟）'],
      ['Refresh', '刷新'],
      ['Loading from GitHub ...', '正在从 GitHub 加载…'],
      ['Search plugins (e.g. pdf, image, ppt)...', '搜索插件（如 PDF、图片、PPT）…'],
      ['Disclaimer: all plugins come from third-party GitHub repositories and are not affiliated with DSH Plugin Marketplace — please evaluate their reliability and security yourself.', '说明：插件来自第三方 GitHub 仓库，与 DSH 插件市场无隶属关系，请自行评估可靠性和安全性。']
    ])
    const patternedReplacements = [
      [/^Workspace actions for\s+(.+)$/i, (_, name) => `${name} 的项目操作`],
      [/^New session in\s+(.+)$/i, (_, name) => `在 ${name} 中新建对话`],
      [/^[▶▸]?\s*Team history\s*·\s*(\d+)$/i, (_, count) => `▶ 团队历史 · ${count}`],
      [/^Status version\s+(\d+)$/i, (_, version) => `状态版本 ${version}`],
      [/^Active teams\s+(\d+)$/i, (_, count) => `进行中的团队 ${count}`],
      [/^Show (\d+) more$/i, (_, count) => `再显示 ${count} 条`],
      [/^View history\s+(\d+)$/i, (_, count) => `历史记录 ${count}`],
      [/^(.*?)\s*·\s*History$/i, (_, name) => `${name} · 历史`],
      [/^(\d{1,2})\/(\d{1,2})\/(\d{4}),\s*(\d{1,2}):(\d{2}):(\d{2})\s*(AM|PM)$/i, (_, month, day, year, hour, minute, second, period) => {
        const hour24 = (Number(hour) % 12) + (String(period).toUpperCase() === 'PM' ? 12 : 0)
        return `${year}/${String(month).padStart(2, '0')}/${String(day).padStart(2, '0')} ${String(hour24).padStart(2, '0')}:${minute}:${second}`
      }],
      [/^Agents\s+(\d+)$/i, (_, count) => `代理目录 ${count}`],
      [/^Activity\s+(\d+)$/i, (_, count) => `动态 ${count}`],
      [/^(\d+)\s+completed\s*·\s*(\d+)\s+in progress\s*·\s*(\d+)\s+pending/i, (_, done, active, pending) => `${done} 已完成 · ${active} 进行中 · ${pending} 待处理`],
      [/^Deep diving\.\.\./i, () => '深度处理中…'],
      [/^Compacted\s+(\d+)\s+history items\s+\(~([\d,]+)\s+tokens\)$/i, (_, items, tokens) => `已压缩 ${items} 条历史记录（约 ${tokens} 词元）`],
      [/^Update to-do list\s*·\s*(\d+)\/(\d+)\s+completed$/i, (_, done, total) => `更新待办 · ${done}/${total} 已完成`],
      [/^(\d+)\s+completed$/i, (_, count) => `${count} 已完成`],
      [/^Revision\s+(\d+)$/i, (_, value) => `版本 ${value}`],
      [/^scheduled$/i, () => '已计划'],
      [/^schedule$/i, () => '定时任务'],
      [/^(?:reminder|session reminder)$/i, () => '会话提醒'],
      [/^delivered$/i, () => '已送达'],
      [/^closed$/i, () => '已关闭'],
      [/\bMain model\b/i, () => '主模型'],
      [/\bSubagent model\b/i, () => '成员模型']
    ]
    const replacementFor = text => replacements.get(text) || patternedReplacements.reduce((result, [pattern, replace]) => result || (pattern.test(text) ? text.replace(pattern, replace) : ''), '')
    for (const element of document.querySelectorAll('button,span,p,h1,h2,h3,h4,input,textarea,label,option,div,strong,small,summary,time,text')) {
      const ariaLabel = element.getAttribute?.('aria-label') || ''
      const translatedAriaLabel = replacementFor(ariaLabel.trim())
      if (translatedAriaLabel) element.setAttribute('aria-label', translatedAriaLabel)
      if (element instanceof HTMLInputElement || element.tagName === 'TEXTAREA') {
        const next = replacementFor(element.placeholder || '')
        if (next) element.placeholder = next
        continue
      }
      if (element.children.length > 0) {
        for (const node of element.childNodes) {
          if (node.nodeType !== Node.TEXT_NODE) continue
          const text = String(node.nodeValue || '').trim()
          const next = replacementFor(text)
          if (next) node.nodeValue = String(node.nodeValue || '').replace(text, next)
        }
        continue
      }
      const text = (element.textContent || '').trim()
      const next = replacementFor(text)
      if (next) element.textContent = next
    }
  }

  const sidebarNode = () => typeof document.querySelector === 'function'
    ? document.querySelector('[data-slot="sidebar"]')
    : null

  const accessibleButtonText = button => String(button?.getAttribute?.('aria-label') || button?.title || button?.textContent || '').trim()

  const officialConversationSearch = () => [...(sidebarNode()?.querySelectorAll?.('button') || [])]
    .find(button => /(?:^|\s)(?:搜索|Search)(?:\s|$)/i.test(accessibleButtonText(button))) || null

  const officialChatTarget = () => [...document.querySelectorAll('header [role="tab"], [data-harness-mobile-title-cluster="true"] button, [data-slot="conversation"] header button')]
    .filter(button => !button.closest?.('#harness-mobile-app-shell'))
    .find(button => /^(?:Chat|Conversation|对话|聊天)(?:\s|$)/i.test(accessibleButtonText(button)) || /^(?:chat|conversation)$/i.test(String(button.dataset?.view || button.dataset?.value || ''))) || null

  const decorateConversationHome = () => {
    const sidebar = sidebarNode()
    if (!sidebar) return
    for (const node of sidebar.querySelectorAll('[data-harness-mobile-conversation-search-section="true"]')) delete node.dataset.harnessMobileConversationSearchSection
    for (const node of sidebar.querySelectorAll('[data-harness-mobile-conversation-search-actions="true"]')) delete node.dataset.harnessMobileConversationSearchActions
    for (const node of sidebar.querySelectorAll('[data-harness-mobile-conversation-search="true"]')) delete node.dataset.harnessMobileConversationSearch
    const newConversation = [...sidebar.querySelectorAll('button')]
      .find(button => /^(?:新建会话|新建对话|New Session)$/i.test(accessibleButtonText(button)))
    if (newConversation) newConversation.dataset.harnessMobileOfficialNewConversation = 'true'
    const collapse = sidebarToggle('collapse')
    if (collapse) collapse.dataset.harnessMobileOfficialSidebarCollapse = 'true'
    const search = officialConversationSearch()
    if (!search) return
    search.dataset.harnessMobileConversationSearch = 'true'
    const actions = search.parentElement
    if (actions) actions.dataset.harnessMobileConversationSearchActions = 'true'
    const section = search.closest('[class*="_sectionHeader"]')
    if (section) section.dataset.harnessMobileConversationSearchSection = 'true'
  }

  const releaseComposerFocus = () => {
    const active = document.activeElement
    if (active?.matches?.('input,textarea,[contenteditable="true"]')) active.blur()
    document.querySelector('[data-composer-card] textarea')?.blur()
  }

  const sidebarToggle = mode => {
    const sidebar = sidebarNode()
    if (!sidebar) return null
    const pattern = mode === 'collapse'
      ? /收起侧边栏|Collapse sidebar/i
      : mode === 'open'
        ? /打开侧边栏|Open sidebar/i
        : /(?:打开|收起)侧边栏|(?:Open|Collapse) sidebar/i
    return [...sidebar.querySelectorAll('button')].find(button => pattern.test(`${button.getAttribute('aria-label') || ''} ${button.title || ''}`)) || null
  }

  const sidebarExpanded = () => {
    const panel = sidebarNode()?.firstElementChild
    return Boolean(panel && !String(panel.className || '').includes('_collapsed'))
  }

  let mobileDrawerTrigger = null
  let mobileDrawerWasOpen = false
  const setSidebarExpanded = expanded => {
    if (expanded === sidebarExpanded()) return true
    const toggle = sidebarToggle(expanded ? 'open' : 'collapse') || sidebarToggle('any')
    if (!toggle) return false
    if (expanded) mobileDrawerTrigger = document.activeElement
    toggle.click()
    return true
  }

  const syncDrawerAccessibility = (shell, expanded) => {
    const sidebar = sidebarNode()
    const conversation = document.querySelector('[data-harness-mobile-conversation="true"]')
    const appbar = shell?.querySelector?.('[data-harness-mobile-appbar="true"]')
    const navigation = shell?.querySelector?.('[data-harness-mobile-navigation]')
    if (sidebar) {
      sidebar.setAttribute('role', 'navigation')
      sidebar.setAttribute('aria-label', '项目与对话')
      if (expanded) {
        for (let node = sidebar; node && node !== document.body; node = node.parentElement) {
          node.inert = false
          node.removeAttribute('inert')
          node.setAttribute('aria-hidden', 'false')
        }
        for (const row of sidebar.querySelectorAll('[data-harness-mobile-project-row="true"], [data-harness-mobile-session-row="true"]')) {
          for (let node = row; node && node !== sidebar; node = node.parentElement) {
            node.inert = false
            node.removeAttribute('inert')
            node.setAttribute('aria-hidden', 'false')
          }
          const label = String(row.getAttribute('aria-label') || row.textContent || '').trim()
          if (label) row.setAttribute('aria-label', label)
        }
      } else {
        for (const node of [sidebar, sidebar.firstElementChild]) {
          if (!node) continue
          node.inert = true
          node.setAttribute('aria-hidden', 'true')
        }
      }
    }
    if (conversation) {
      conversation.inert = expanded
      conversation.setAttribute('aria-hidden', expanded ? 'true' : 'false')
    }
    // Keep the fixed bottom rail available while the conversation drawer is open.
    // It is outside the drawer's modal surface and is the only route to the
    // guarded domains on mobile; making it inert leaves visible tabs untouchable.
    if (appbar) {
      appbar.inert = expanded
      appbar.setAttribute('aria-hidden', expanded ? 'true' : 'false')
    }
    if (navigation) {
      navigation.inert = false
      navigation.removeAttribute('inert')
      navigation.setAttribute('aria-hidden', 'false')
    }
    if (expanded && !mobileDrawerWasOpen) {
      const first = sidebar?.querySelector?.('button:not([disabled]),a[href],[role="treeitem"][tabindex="0"],[role="treeitem"]')
      setTimeout(() => first?.focus?.({ preventScroll: true }), 0)
    } else if (!expanded && mobileDrawerWasOpen) {
      const fallback = shell?.querySelector?.('[data-harness-mobile-action="menu"]')
      const trigger = mobileDrawerTrigger?.isConnected ? mobileDrawerTrigger : fallback
      setTimeout(() => trigger?.focus?.({ preventScroll: true }), 0)
      mobileDrawerTrigger = null
    }
    mobileDrawerWasOpen = expanded
  }

  const installSidebarAutoClose = () => {
    if (window.__harnessMobileSidebarAutoClose || typeof document.addEventListener !== 'function') return
    window.__harnessMobileSidebarAutoClose = true
    let lastClose = 0
    const scheduleClose = target => {
      const row = target?.closest?.('[data-harness-mobile-session-row="true"], [role="treeitem"][class*="_sessionRow"]')
      if (!row || !row.closest('[data-slot="sidebar"]')) {
        const project = target?.closest?.('[data-harness-mobile-project-row="true"], [role="treeitem"][aria-expanded]')
        if (project?.closest?.('[data-slot="sidebar"]')) releaseComposerFocus()
        return
      }
      if (row.hasAttribute?.('aria-expanded') || row.dataset?.harnessMobileProjectRow === 'true' || row.dataset?.harnessMobileNavigationRow === 'true') {
        releaseComposerFocus()
        return
      }
      const nested = target.closest?.('button,a,input,textarea,select,[role="menuitem"]')
      if (nested && nested !== row) return
      const now = Date.now()
      if (now - lastClose < 300) return
      lastClose = now
      setTimeout(() => {
        if (typeof window.matchMedia === 'function' && !window.matchMedia('(max-width: 700px)').matches) return
        if (sidebarExpanded()) setSidebarExpanded(false)
        const chat = officialChatTarget()
        if (chat && !chat.disabled && chat.getAttribute?.('aria-disabled') !== 'true') chat.click()
        releaseComposerFocus()
        setTimeout(releaseComposerFocus, 180)
      }, 80)
    }
    document.addEventListener('click', event => scheduleClose(event.target), true)
    document.addEventListener('keyup', event => {
      if (event.key === 'Enter' || event.key === ' ') scheduleClose(event.target)
    }, true)
  }

  const appIcon = name => {
    if (name === 'menu') return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>'
    if (name === 'brand') return '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="7"/><path d="M12 3v4m0 10v4M3 12h4m10 0h4"/></svg>'
    if (name === 'back') return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 5-7 7 7 7"/></svg>'
    if (name === 'more') return '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/></svg>'
    if (name === 'filter') return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M7 12h10M10 18h4"/></svg>'
    if (name === 'new') return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>'
    if (name === 'conversations') return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 6.5h14v9H9l-4 3v-12Z"/><path d="M8 10h8M8 13h5"/></svg>'
    if (name === 'agents') return '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8" r="2.5"/><circle cx="16.5" cy="9.5" r="2"/><path d="M4.5 18c.6-3.2 2.1-4.8 4.5-4.8s4 1.6 4.5 4.8M14 14.2c2.8-.5 4.7.8 5.5 3.8"/></svg>'
    if (name === 'tasks') return '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4.5" y="5.5" width="15" height="14" rx="2"/><path d="M8 3.5v4M16 3.5v4M4.5 9.5h15M12 12v3l2 1"/></svg>'
    if (name === 'me') return '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="3"/><path d="M6.5 18.5c.8-3 2.6-4.5 5.5-4.5s4.7 1.5 5.5 4.5"/><path d="M4 4v16h16V4"/></svg>'
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/></svg>'
  }

  const mobileDomains = Object.freeze([
    { id: 'conversations', label: '对话', route: '/m/conversations', slot: 'navigation.conversations' },
    { id: 'agents', label: '代理团队', route: '/m/agents', slot: 'agent-teams.view.canvas' },
    { id: 'tasks', label: '定时任务', route: '/m/tasks', slot: 'agent-teams.view.automation' },
    { id: 'me', label: '我的', route: '/m/me', slot: 'navigation.me' }
  ])
  const mobileNavigationState = { activeDomain: 'conversations', pendingDomain: '' }

  const mobileNavigationBridge = () => {
    const bridge = window.HarnessMobileNavigation
    return bridge && bridge.version != null && typeof bridge.navigate === 'function' ? bridge : null
  }

  const domainFromRoute = route => {
    const normalized = String(route || '').split(/[?#]/, 1)[0]
    return mobileDomains.find(domain => normalized === domain.route || normalized.startsWith(`${domain.route}/`))?.id || null
  }

  const mobileSlotAliases = Object.freeze({
    agents: Object.freeze(['navigation.agents']),
    tasks: Object.freeze(['navigation.tasks'])
  })

  const mobileSlotNames = domain => [domain.slot, ...(mobileSlotAliases[domain.id] || [])]
  const mobileSlotSelector = domain => mobileSlotNames(domain)
    .map(slot => `[data-mobile-slot="${slot}"]`)
    .join(', ')

  const semanticMobileTarget = (scope, domain) => {
    for (const slot of mobileSlotNames(domain)) {
      const semantic = scope?.querySelector?.(`[data-mobile-slot="${slot}"]`)
      if (!semantic) continue
      if (semantic.matches?.('button,a,[role="button"],[role="tab"]')) return semantic
      const target = semantic.querySelector?.('button,a,[role="button"],[role="tab"]')
      if (target) return target
    }
    return null
  }

  const scheduledTaskLabel = node => /^(?:已安排的任务|Scheduled tasks|定时任务)$/i.test(accessibleButtonText(node))
  const officialScheduledTaskTarget = () => [...document.querySelectorAll('.hd-conversation-more-action, [role="menu"] [role="menuitem"], header [role="tab"]')]
    .find(scheduledTaskLabel) || null
  const officialAgentTeamsMenuTarget = () => [...document.querySelectorAll('[role="menu"] [role="menuitem"], [role="menu"] button, header [role="menuitem"]')]
    .find(button => /^(?:代理团队|Agent Teams?)(?:\s|$)/i.test(accessibleButtonText(button))) || null
  const officialMoreViewsTarget = () => {
    const buttons = [...document.querySelectorAll('[data-slot="conversation"] header button, header button')]
      .filter(button => !button.closest?.('#harness-mobile-app-shell'))
    return buttons.find(button => /^(?:更多视图|更多|More views?|Options?|Actions?|Menu|Ellipsis)$/i.test(String(button.getAttribute?.('aria-label') || button.title || accessibleButtonText(button))))
      || buttons.find(button => button.getAttribute?.('aria-haspopup') === 'menu' || button.getAttribute?.('aria-expanded') != null)
      || null
  }

  const officialMobileTarget = domain => {
    if (typeof document.querySelector !== 'function') return null
    if (domain.id === 'me') {
      const semanticTarget = document.querySelector('[data-slot="settings.trigger"] button, button[data-slot="settings.trigger"]')
      if (semanticTarget) return semanticTarget
      const slot = document.querySelector('[data-slot="settings.trigger"], [data-slot="sidebar.settings"]')
      const slotTarget = slot?.matches?.('button,a,[role="button"]')
        ? slot
        : slot?.querySelector?.('button,a,[role="button"]')
      if (slotTarget) return slotTarget
      const slotAncestor = slot?.closest?.('button,a,[role="button"]')
      if (slotAncestor) return slotAncestor
      const sidebar = sidebarNode()
      return [...(sidebar?.querySelectorAll?.('button') || []), ...document.querySelectorAll('button')]
        .find(button => /^(?:设置|Settings)$/i.test(accessibleButtonText(button))) || null
    }
    const semantic = semanticMobileTarget(document, domain)
    if (semantic) return semantic
    if (domain.id === 'agents') {
      const semanticTarget = document.querySelector('[data-slot="agent-teams.trigger"] button, button[data-slot="agent-teams.trigger"]')
      if (semanticTarget) return semanticTarget
      return officialAgentTeamsMenuTarget()
        || [...document.querySelectorAll('[data-slot="conversation"] header button, [data-slot="conversation"] [role="tab"], header [role="tab"]')]
          .find(button => /^(?:代理团队|Agent Teams)(?:\s|$)/i.test(accessibleButtonText(button)))
        || officialMoreViewsTarget()
    }
    if (domain.id === 'tasks') return officialScheduledTaskTarget() || officialMoreViewsTarget()
    return null
  }

  const bridgeNavigationState = bridge => {
    if (!bridge || typeof bridge.getNavigationState !== 'function') return null
    try { return bridge.getNavigationState() || null } catch { return null }
  }

  const bridgeSupportsDomain = (bridge, state, domain) => {
    if (!bridge) return false
    if (typeof bridge.canNavigate === 'function') {
      try { return bridge.canNavigate(domain.route) !== false } catch { return false }
    }
    if (Array.isArray(state?.availableRoutes)) return state.availableRoutes.some(route => String(route) === domain.route || String(route).startsWith(`${domain.route}/`))
    if (state?.domains && Object.prototype.hasOwnProperty.call(state.domains, domain.id)) return state.domains[domain.id] !== false
    return true
  }

  const guardedMobileDomain = domain => domain.id === 'agents' || domain.id === 'tasks' || domain.id === 'me'

  const officialDomainAvailable = domain => {
    if (domain.id === 'conversations') return Boolean(officialMobileTarget(domain) || sidebarNode() || document.querySelector?.('[data-slot="conversation"]'))
    return Boolean(officialMobileTarget(domain))
  }

  let navigationNoticeTimer = null
  const announceNavigationLoading = (shell, domain) => {
    const status = shell?.querySelector?.('[data-harness-mobile-navigation-status]')
    if (!status) return
    clearTimeout(navigationNoticeTimer)
    status.textContent = `正在打开${domain.label}…`
    status.dataset.visible = 'true'
  }

  const announceNavigationUnavailable = (shell, domain) => {
    const status = shell?.querySelector?.('[data-harness-mobile-navigation-status]')
    if (!status) return
    status.textContent = `${domain.label}暂时无法打开：桌面工作台尚未提供完整内容。请稍后重试。`
    status.dataset.visible = 'true'
    clearTimeout(navigationNoticeTimer)
    navigationNoticeTimer = setTimeout(() => {
      delete status.dataset.visible
      status.textContent = ''
    }, 6_000)
  }

  const clearNavigationNotice = shell => {
    const status = shell?.querySelector?.('[data-harness-mobile-navigation-status]')
    if (!status) return
    clearTimeout(navigationNoticeTimer)
    delete status.dataset.visible
    status.textContent = ''
  }

  const officialWorkspaceContent = (workbench, domain) => {
    if (!workbench) return null
    if (domain.id === 'agents') return workbench.querySelector('[data-mobile-slot="agent-teams.canvas"], [aria-labelledby="dat-empty-canvas-title"], #dat-empty-canvas-title, .dat-workspace-main > *, .dat-error[role="alert"]')
    return null
  }

  const officialWorkspaceMounted = (workbench, domain) => {
    if (!workbench || domain.id !== 'agents') return false
    const workspace = workbench.querySelector('.dat-workspace-main')
    const heading = workbench.querySelector('.dat-head, #dat-view-title')
    return Boolean(workspace && heading)
  }

  const waitForOfficialWorkspace = (domain, shell) => new Promise(resolve => {
    let attempts = 0
    let selected = false
    const clickedOpeners = new WeakSet()
    const inspect = () => {
      const workbench = document.querySelector('[data-mobile-slot="agent-teams.workspace"] .dat-shell, .dat-view[data-mobile-slot="agent-teams.workspace"] .dat-shell')
      const target = semanticMobileTarget(workbench, domain)
      if (workbench && String(workbench.textContent || '').trim() && target && accessibleButtonText(target) && !target.disabled && target.getAttribute?.('aria-disabled') !== 'true') {
        const targetSelected = target.getAttribute?.('aria-current') === 'page'
        if (!targetSelected && !selected) {
          selected = true
          target.click()
          setTimeout(inspect, 0)
          return
        }
        if (targetSelected) {
          const content = officialWorkspaceContent(workbench, domain)
          const populated = content && (content.childElementCount > 0 || String(content.textContent || '').trim())
          if (officialWorkspaceMounted(workbench, domain) || populated) {
            root.dataset.harnessMobileAgentDetailOpen = 'true'
            for (const details of workbench.querySelectorAll?.('.dat-overview details[open]') || []) details.open = false
            workbench.scrollTo?.({ top: 0, behavior: 'auto' })
            decorateAgentTeamsWorkbench()
            clearNavigationNotice(shell)
            resolve(true)
            return
          }
        }
      } else if (!workbench) {
        const agentsDomain = mobileDomains.find(item => item.id === 'agents')
        const opener = agentsDomain ? officialMobileTarget(agentsDomain) : null
        if (opener && !clickedOpeners.has(opener) && !opener.disabled && opener.getAttribute?.('aria-disabled') !== 'true') {
          clickedOpeners.add(opener)
          opener.click()
        }
      }
      if (++attempts < 160) setTimeout(inspect, 50)
      else {
        announceNavigationUnavailable(shell, domain)
        resolve(false)
      }
    }
    setTimeout(inspect, 0)
  })

  const officialScheduledTasksContent = () => {
    const view = document.querySelector('[data-conversation-view="desktop-schedules"]')
    const content = view?.querySelector?.('.dds-view[aria-labelledby="dds-title"], #dds-title') || null
    return content && String(content.textContent || '').trim() ? content : null
  }

  const openOfficialScheduledTasks = shell => new Promise(resolve => {
    let attempts = 0
    const clickedTargets = new WeakSet()
    const inspect = () => {
      const content = officialScheduledTasksContent()
      if (content) {
        clearNavigationNotice(shell)
        resolve(true)
        return
      }
      const target = officialScheduledTaskTarget()
      const opener = target || officialMoreViewsTarget()
      if (opener && !clickedTargets.has(opener) && !opener.disabled && opener.getAttribute?.('aria-disabled') !== 'true') {
        clickedTargets.add(opener)
        opener.click()
      }
      if (++attempts < 160) setTimeout(inspect, 50)
      else {
        const domain = mobileDomains.find(item => item.id === 'tasks')
        if (domain) announceNavigationUnavailable(shell, domain)
        resolve(false)
      }
    }
    setTimeout(inspect, 0)
  })

  const openOfficialAgentCanvas = shell => waitForOfficialWorkspace(mobileDomains.find(item => item.id === 'agents'), shell)

  const visibleOfficialSettingsDialog = dialog => {
    if (!visible(dialog)) return false
    const style = getComputedStyle(dialog)
    if (Number(style.opacity || 1) <= 0.01 || style.pointerEvents === 'none') return false
    const rect = dialog.getBoundingClientRect()
    const width = window.innerWidth || document.documentElement?.clientWidth || 0
    const height = window.innerHeight || document.documentElement?.clientHeight || 0
    if (rect.right <= 0 || rect.bottom <= 0 || rect.left >= width || rect.top >= height) return false
    const x = Math.max(0, Math.min(width - 1, rect.left + rect.width / 2))
    const y = Math.max(0, Math.min(height - 1, rect.top + rect.height / 2))
    const hit = document.elementFromPoint?.(x, y)
    return !hit || hit === dialog || Boolean(dialog.contains?.(hit))
  }

  const officialSettingsSurface = () => {
    const dialog = document.querySelector('[data-harness-mobile-settings-dialog="true"]')
    if (dialog) return dialog
    const selectors = [
      '[data-slot="settings.page"]',
      '[data-slot="settings"]',
      '[data-settings-page="true"]',
      'main[data-page="settings"]'
    ]
    const candidates = selectors.flatMap(selector => [...(document.querySelectorAll?.(selector) || [])])
    return candidates.find(surface => {
      const nav = surface.querySelector?.(':scope > nav, nav')
      const content = nav?.nextElementSibling
      return nav && content && (nav.querySelectorAll?.('button').length || 0) >= 3 && String(surface.textContent || '').trim()
    }) || null
  }

  const officialSettingsDialog = () => {
    decorateDialogs()
    const surface = officialSettingsSurface()
    const nav = surface?.querySelector?.(':scope > nav') || surface?.querySelector?.('nav')
    const content = nav?.nextElementSibling
    if (!surface || !nav || !content || (nav.querySelectorAll?.('button').length || 0) < 3 || !String(surface.textContent || '').trim()) return null
    if (!surface.dataset || surface.getAttribute?.('role') === 'dialog' || surface.dataset.harnessMobileSettingsDialog === 'true') {
      return visibleOfficialSettingsDialog(surface) ? surface : null
    }
    // MuMu and newer desktop builds expose settings as a page, not a modal.
    surface.dataset.harnessMobileSettingsDialog = 'true'
    decorateSettingsDialog(surface, nav, content)
    return surface
  }

  const waitForOfficialSettings = (shell, shouldContinue = () => true) => new Promise(resolve => {
    let attempts = 0
    const clickedTargets = new WeakSet()
    const inspect = () => {
      if (!shouldContinue()) {
        resolve(false)
        return
      }
      if (officialSettingsDialog()) {
        clearNavigationNotice(shell)
        resolve(true)
        return
      }
      const domain = mobileDomains.find(item => item.id === 'me')
      const target = domain ? officialMobileTarget(domain) : null
      if (target && !clickedTargets.has(target) && !target.disabled && target.getAttribute?.('aria-disabled') !== 'true') {
        clickedTargets.add(target)
        target.click()
        setTimeout(inspect, 0)
        return
      }
      if (++attempts < 160) setTimeout(inspect, 50)
      else resolve(false)
    }
    setTimeout(inspect, 0)
  })

  const activateOfficialDomain = (domain, shell) => {
    if (domain.id === 'conversations') {
      releaseComposerFocus()
      const semantic = officialMobileTarget(domain)
      if (semantic) semantic.click()
      else if (sidebarNode()) setSidebarExpanded(true)
      else document.querySelector?.('[data-slot="conversation"] [data-conversation-scroll]')?.scrollTo?.({ top: 0, behavior: 'smooth' })
      return true
    }
    if (domain.id === 'agents' || domain.id === 'tasks') {
      releaseComposerFocus()
      if (sidebarExpanded()) setSidebarExpanded(false)
      return domain.id === 'tasks' ? openOfficialScheduledTasks(shell) : openOfficialAgentCanvas(shell)
    }
    if (domain.id === 'me') {
      releaseComposerFocus()
      return waitForOfficialSettings(shell)
    }
    const target = officialMobileTarget(domain)
    if (!target || target.disabled || target.getAttribute?.('aria-disabled') === 'true') {
      announceNavigationUnavailable(shell, domain)
      return false
    }
    releaseComposerFocus()
    if (sidebarExpanded()) setSidebarExpanded(false)
    target.click()
    return true
  }

  const settleMobileDomain = (domain, shell, activation) => {
    const guarded = guardedMobileDomain(domain)
    if (guarded) {
      mobileNavigationState.pendingDomain = domain.id
      announceNavigationLoading(shell, domain)
    }
    Promise.resolve(activation).then(success => {
      if (success) {
        mobileNavigationState.activeDomain = domain.id
        clearNavigationNotice(shell)
      } else {
        announceNavigationUnavailable(shell, domain)
      }
    }).catch(() => announceNavigationUnavailable(shell, domain)).finally(() => {
      if (mobileNavigationState.pendingDomain === domain.id) mobileNavigationState.pendingDomain = ''
      syncMobileAppShell()
    })
  }

  const navigateMobileDomain = (domain, shell) => {
    const navigationRevision = (mobileNavigationState.navigationRevision || 0) + 1
    mobileNavigationState.navigationRevision = navigationRevision
    if (domain.id === 'me') {
      releaseComposerFocus()
      mobileNavigationState.pendingDomain = 'me'
      mobileNavigationState.activeDomain = 'me'
      root.dataset.harnessMobileMyOpening = 'true'
      delete root.dataset.harnessMobileMyDetail
      const myStatus = shell?.querySelector?.('[data-harness-mobile-my-status]')
      if (myStatus) myStatus.textContent = '正在打开桌面设置…'
      clearNavigationNotice(shell)
      syncMobileAppShell()
      const stillOpeningMy = () => mobileNavigationState.activeDomain === 'me' && mobileNavigationState.navigationRevision === navigationRevision
      return Promise.resolve(waitForOfficialSettings(shell, stillOpeningMy)).then(opened => {
        if (!stillOpeningMy()) return false
        if (opened) {
          root.dataset.harnessMobileMyDetail = 'official'
          if (myStatus) myStatus.textContent = ''
          return true
        }
        delete root.dataset.harnessMobileMyDetail
        if (myStatus) myStatus.textContent = '桌面设置暂未就绪；“我的”页面仍可继续使用。'
        return false
      }).catch(() => {
        if (stillOpeningMy()) {
          delete root.dataset.harnessMobileMyDetail
          if (myStatus) myStatus.textContent = '桌面设置暂未就绪；“我的”页面仍可继续使用。'
        }
        return false
      }).finally(() => {
        if (!stillOpeningMy()) return
        delete root.dataset.harnessMobileMyOpening
        if (mobileNavigationState.pendingDomain === 'me') mobileNavigationState.pendingDomain = ''
        syncMobileAppShell()
      })
    }
    delete root.dataset.harnessMobileMyOpening
    delete root.dataset.harnessMobileMyDetail
    if (root.dataset.harnessMobileSettingsOpen === 'true') {
      const dialog = document.querySelector('[data-harness-mobile-settings-dialog="true"]')
      findNativeSettingsClose(dialog)?.click()
    }
    const bridge = mobileNavigationBridge()
    const state = bridgeNavigationState(bridge)
    if (bridgeSupportsDomain(bridge, state, domain)) {
      try {
        const result = bridge.navigate(domain.route)
        const activation = Promise.resolve(result).then(value => {
          if (value === false) return false
          if (domain.id === 'agents') return openOfficialAgentCanvas(shell)
          if (domain.id === 'tasks') return openOfficialScheduledTasks(shell)
          if (domain.id === 'me') return waitForOfficialSettings(shell)
          return true
        })
        settleMobileDomain(domain, shell, activation)
        return
      } catch {
        announceNavigationUnavailable(shell, domain)
        syncMobileNavigation(shell)
        return
      }
    }
    settleMobileDomain(domain, shell, activateOfficialDomain(domain, shell))
  }

  const syncMobileNavigation = shell => {
    const navigation = shell?.querySelector?.('[data-harness-mobile-navigation]')
    if (!navigation) return
    const bridge = mobileNavigationBridge()
    const state = bridgeNavigationState(bridge)
    const reported = state?.domain || domainFromRoute(state?.route || state?.pathname)
    const active = mobileNavigationState.activeDomain === 'me'
      ? 'me'
      : (mobileNavigationState.pendingDomain ? mobileNavigationState.activeDomain : (reported || mobileNavigationState.activeDomain))
    if (!mobileNavigationState.pendingDomain && mobileDomains.some(domain => domain.id === active)) mobileNavigationState.activeDomain = active
    for (const domain of mobileDomains) {
      const button = navigation.querySelector(`[data-harness-mobile-domain="${domain.id}"]`)
      if (!button) continue
      const available = guardedMobileDomain(domain) || bridgeSupportsDomain(bridge, state, domain) || officialDomainAvailable(domain)
      const selected = mobileNavigationState.activeDomain === domain.id
      button.disabled = !available
      button.setAttribute('aria-disabled', available ? 'false' : 'true')
      button.setAttribute('aria-selected', selected ? 'true' : 'false')
      button.setAttribute('aria-label', available ? domain.label : `${domain.label}，当前工作台未提供此入口`)
      button.title = available ? domain.label : '当前工作台未提供此入口'
      if (selected) button.setAttribute('aria-current', 'page')
      else button.removeAttribute('aria-current')
    }
  }

  const installNavigationBridgeSubscription = shell => {
    const sync = () => syncMobileNavigation(document.getElementById('harness-mobile-app-shell'))
    if (!window.__harnessMobileNavigationSubscriptionInstalled) {
      window.__harnessMobileNavigationSubscriptionInstalled = true
      window.addEventListener?.('harness-mobile-navigation-change', sync)
    }
    const bridge = mobileNavigationBridge()
    if (typeof bridge?.subscribe === 'function' && window.__harnessMobileSubscribedNavigationBridge !== bridge) {
      try {
        bridge.subscribe(sync)
        window.__harnessMobileSubscribedNavigationBridge = bridge
      } catch {}
    }
    syncMobileNavigation(shell)
  }

  const renderMobileMenu = shell => {
    const panel = shell?.querySelector?.('[data-harness-mobile-app-menu]')
    if (!panel) return
    panel.textContent = ''
    const sourceSelector = mobileNavigationState.activeDomain === 'conversations'
      ? 'header [role="tab"], [data-harness-mobile-session-log="true"]'
      : '.dat-workspace-nav button'
    const sources = [...document.querySelectorAll(sourceSelector)]
      .filter(source => !source.closest?.('#harness-mobile-app-shell'))
    const labels = new Set()
    for (const source of sources) {
      const label = (source.textContent || source.getAttribute('aria-label') || '').trim()
      if (!label || labels.has(label)) continue
      labels.add(label)
      const button = document.createElement('button')
      button.type = 'button'
      button.dataset.sourceLabel = label
      button.textContent = label
      if (source.getAttribute('aria-selected') === 'true') button.setAttribute('aria-current', 'page')
      button.addEventListener('click', () => {
        source.click()
        panel.hidden = true
      })
      panel.appendChild(button)
    }
  }

  const readAuthoritativeProjects = async () => {
    const WebSocketImpl = typeof WebSocket === 'function' ? WebSocket : globalThis.WebSocket
    if (typeof WebSocketImpl !== 'function') throw new Error('workspace-follow-unavailable')
    const target = new URL('/api/remote.mux', globalThis.location?.href || 'http://127.0.0.1/')
    target.protocol = target.protocol === 'https:' ? 'wss:' : 'ws:'
    const streamId = globalThis.crypto?.randomUUID?.() || `mobile-${Date.now()}-${Math.random().toString(36).slice(2)}`
    const items = await new Promise((resolve, reject) => {
      const socket = new WebSocketImpl(target.toString())
      let settled = false
      const finish = (error, value) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        socket.close?.()
        if (error) reject(error)
        else resolve(value)
      }
      const timer = setTimeout(() => finish(new Error('workspace-follow-timeout')), 5000)
      socket.addEventListener('open', () => socket.send(JSON.stringify({ type: 'open', streamId, endpoint: 'workspace/follow', payload: { args: {} } })), { once: true })
      socket.addEventListener('message', event => {
        let frame
        try { frame = JSON.parse(String(event.data)) } catch { finish(new Error('workspace-follow-invalid')); return }
        if (frame?.streamId !== streamId) return
        if (frame.type !== 'item' || frame.value?.type !== 'baseline' || !Array.isArray(frame.value?.value?.items)) { finish(new Error('workspace-follow-invalid')); return }
        finish(null, frame.value.value.items)
      })
      socket.addEventListener('error', () => finish(new Error('workspace-follow-error')), { once: true })
      socket.addEventListener('close', () => finish(new Error('workspace-follow-closed')), { once: true })
    })
    return items.map(item => {
      if (!item || typeof item.workspaceId !== 'string' || !item.workspaceId || item.workspaceId.length > 512 || typeof item.title !== 'string' || item.title.length > 300) throw new Error('workspace-follow-item-invalid')
      return { workspaceId: item.workspaceId, title: item.title }
    })
  }

  const copyProjectIdentity = async (value, status, successText) => {
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(value)
      else {
        const input = document.createElement('textarea')
        input.value = value
        input.readOnly = true
        input.setAttribute('aria-hidden', 'true')
        input.style.cssText = 'position:fixed;inset:auto auto 0 0;opacity:0;pointer-events:none'
        document.body.appendChild(input)
        input.select()
        input.setSelectionRange?.(0, value.length)
        const copied = document.execCommand?.('copy') === true
        input.remove()
        if (!copied) throw new Error('copy-unavailable')
      }
      status.textContent = successText
      navigator.vibrate?.(10)
    } catch {
      status.textContent = '复制失败，请长按文字复制'
    }
  }

  const openProjectIdentitySheet = async () => {
    document.querySelector('[data-harness-mobile-project-sheet]')?.remove()
    const backdrop = document.createElement('div')
    backdrop.dataset.harnessMobileProjectSheet = 'true'
    backdrop.setAttribute('role', 'presentation')
    const sheet = document.createElement('section')
    sheet.setAttribute('role', 'dialog')
    sheet.setAttribute('aria-modal', 'true')
    sheet.setAttribute('aria-labelledby', 'harness-mobile-project-title')
    const header = document.createElement('header')
    const title = document.createElement('h2')
    title.id = 'harness-mobile-project-title'
    title.textContent = '项目详情'
    const close = document.createElement('button')
    close.type = 'button'
    close.setAttribute('aria-label', '关闭项目详情')
    close.textContent = '×'
    header.append(title, close)
    const list = document.createElement('div')
    list.dataset.harnessMobileProjectIdentityList = 'true'
    const loading = document.createElement('p')
    loading.dataset.harnessMobileProjectStatus = 'true'
    loading.setAttribute('role', 'status')
    loading.textContent = '正在读取项目…'
    list.appendChild(loading)
    sheet.append(header, list)
    backdrop.appendChild(sheet)
    document.body.appendChild(backdrop)
    const dismiss = () => backdrop.remove()
    close.addEventListener('click', dismiss)
    backdrop.addEventListener('click', event => { if (event.target === backdrop) dismiss() })
    close.focus()
    try {
      const projects = await readAuthoritativeProjects()
      list.textContent = ''
      if (!projects.length) {
        const empty = document.createElement('p')
        empty.dataset.harnessMobileProjectStatus = 'true'
        empty.textContent = '还没有项目'
        list.appendChild(empty)
        return
      }
      for (const project of projects) {
        const card = document.createElement('article')
        card.dataset.harnessMobileProjectIdentity = 'true'
        const nameLabel = document.createElement('span')
        nameLabel.textContent = '项目名称'
        const name = document.createElement('strong')
        name.textContent = project.title
        const copyName = document.createElement('button')
        copyName.type = 'button'
        copyName.textContent = '复制名称'
        copyName.setAttribute('aria-label', `复制项目名称：${project.title}`)
        const idLabel = document.createElement('span')
        idLabel.textContent = '项目 ID'
        const id = document.createElement('code')
        id.textContent = project.workspaceId
        const copyId = document.createElement('button')
        copyId.type = 'button'
        copyId.textContent = '复制 ID'
        copyId.setAttribute('aria-label', `复制项目 ID：${project.workspaceId}`)
        const status = document.createElement('p')
        status.setAttribute('role', 'status')
        status.setAttribute('aria-live', 'polite')
        copyName.addEventListener('click', () => copyProjectIdentity(project.title, status, '已复制项目名称'))
        copyId.addEventListener('click', () => copyProjectIdentity(project.workspaceId, status, '已复制项目 ID'))
        card.append(nameLabel, name, copyName, idLabel, id, copyId, status)
        list.appendChild(card)
      }
    } catch {
      loading.textContent = '无法读取项目，请稍后重试'
    }
  }

  const mobileMySettingsMatchers = Object.freeze({
    general: /^(?:General|通用设置?)$/i,
    models: /^(?:Models?|模型|模型路由)$/i,
    plugins: /^(?:Plugins?|插件)$/i,
    mobile: /^(?:Mobile(?: & Remote)?|手机与远程同步|移动与远程|电脑与移动端)$/i
  })

  const openMobileMySettingsEntry = async (shell, entry) => {
    const status = shell?.querySelector?.('[data-harness-mobile-my-status]')
    const matcher = mobileMySettingsMatchers[entry]
    if (!matcher || !status) return false
    status.textContent = '正在打开桌面设置…'
    root.dataset.harnessMobileMyOpening = 'true'
    root.dataset.harnessMobileMyDetail = 'official'
    syncMobileAppShell()
    const restoreSurface = message => {
      delete root.dataset.harnessMobileMyOpening
      delete root.dataset.harnessMobileMyDetail
      status.textContent = message
      syncMobileAppShell()
      return false
    }
    const opened = await waitForOfficialSettings(shell)
    const dialog = opened ? officialSettingsDialog() : null
    if (!dialog) return restoreSurface('桌面设置暂未就绪；“我的”页面仍可继续使用。')
    const target = [...dialog.querySelectorAll('button')]
      .find(button => matcher.test(settingsButtonRawLabel(button)) || matcher.test(accessibleButtonText(button)))
    if (!target) return restoreSurface('桌面端暂未提供此设置入口。')
    delete root.dataset.harnessMobileMyOpening
    status.textContent = ''
    target.click()
    syncMobileAppShell()
    return true
  }

  const installMobileAppShell = () => {
    if (typeof document.createElement !== 'function' || !document.body) return null
    let presentationRoot = document.getElementById('harness-mobile-presentation-root')
    if (!presentationRoot) {
      presentationRoot = document.createElement('div')
      presentationRoot.id = 'harness-mobile-presentation-root'
      presentationRoot.dataset.harnessMobilePresentationRoot = 'true'
      document.body.appendChild(presentationRoot)
    }
    let shell = document.getElementById('harness-mobile-app-shell')
    if (shell) {
      if (shell.parentElement !== presentationRoot) presentationRoot.appendChild(shell)
      return shell
    }
    shell = document.createElement('div')
    shell.id = 'harness-mobile-app-shell'
    const navigationItems = mobileDomains.map(domain => `<button type="button" role="tab" data-harness-mobile-domain="${domain.id}" data-mobile-route="${domain.route}"><span data-harness-mobile-domain-icon>${appIcon(domain.id)}</span><span data-harness-mobile-domain-label>${domain.label}</span></button>`).join('')
    shell.innerHTML = `<header data-harness-mobile-appbar="true"><button type="button" data-harness-mobile-action="menu" data-harness-mobile-home-text="true" aria-label="首页"><span>首页</span></button><div data-harness-mobile-heading><strong>新对话</strong><span>Harness Mobile</span></div><button type="button" data-harness-mobile-action="new" aria-label="新建会话">${appIcon('new')}</button></header><button type="button" data-harness-mobile-conversation-search-proxy aria-label="搜索项目和对话"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"></circle><path d="m16 16 4 4"></path></svg><span>搜索项目和对话</span></button><div data-harness-mobile-conversation-search-box hidden><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"></circle><path d="m16 16 4 4"></path></svg><input type="search" enterkeyhint="search" aria-label="搜索项目和对话" placeholder="搜索项目和对话"><button type="button" aria-label="清除搜索">×</button></div><div data-harness-mobile-conversation-list-title><div><strong>项目与对话</strong><span data-harness-mobile-conversation-count>0 个项目 · 0 个对话</span></div><button type="button" data-harness-mobile-project-details>项目详情</button></div><main data-harness-mobile-my-surface hidden aria-labelledby="harness-mobile-my-title"><section data-harness-mobile-my-intro><span>账户与设置</span><h1 id="harness-mobile-my-title">我的</h1><p>在手机上快速进入常用设置；详细配置仍与桌面端保持一致。</p></section><section data-harness-mobile-my-group aria-labelledby="harness-mobile-my-basics"><h2 id="harness-mobile-my-basics">基础与外观</h2><button type="button" data-harness-mobile-settings-entry="general"><span data-harness-mobile-my-entry-icon aria-hidden="true">${appIcon('me')}</span><span><strong>通用设置</strong><small>语言、外观与会话默认项</small></span><span aria-hidden="true">›</span></button></section><section data-harness-mobile-my-group aria-labelledby="harness-mobile-my-ai"><h2 id="harness-mobile-my-ai">AI 与代理</h2><button type="button" data-harness-mobile-settings-entry="models"><span data-harness-mobile-my-entry-icon aria-hidden="true">${appIcon('agents')}</span><span><strong>模型路由</strong><small>主模型、子代理与提供方目录</small></span><span aria-hidden="true">›</span></button></section><section data-harness-mobile-my-group aria-labelledby="harness-mobile-my-capabilities"><h2 id="harness-mobile-my-capabilities">插件与能力</h2><button type="button" data-harness-mobile-settings-entry="plugins"><span data-harness-mobile-my-entry-icon aria-hidden="true">${appIcon('tasks')}</span><span><strong>插件</strong><small>管理已安装插件与配置</small></span><span aria-hidden="true">›</span></button><button type="button" data-harness-mobile-settings-entry="mobile"><span data-harness-mobile-my-entry-icon aria-hidden="true">${appIcon('conversations')}</span><span><strong>电脑与移动端</strong><small>配对设备、远程线路与连接状态</small></span><span aria-hidden="true">›</span></button></section><p data-harness-mobile-my-status role="status" aria-live="polite"></p></main><button type="button" data-harness-mobile-drawer-scrim aria-label="关闭会话历史"></button><nav data-harness-mobile-navigation role="tablist" aria-label="主要导航">${navigationItems}</nav><p data-harness-mobile-navigation-status role="status" aria-live="polite" aria-atomic="true"></p><div data-harness-mobile-app-menu hidden aria-label="会话功能"></div>`
    const searchProxy = shell.querySelector('[data-harness-mobile-conversation-search-proxy]')
    const searchBox = shell.querySelector('[data-harness-mobile-conversation-search-box]')
    const searchInput = searchBox.querySelector('input')
    const closeSearch = () => {
      mobileConversationFilter = ''
      searchInput.value = ''
      searchInput.blur()
      searchBox.hidden = true
      delete root.dataset.harnessMobileConversationSearch
      searchProxy.setAttribute('aria-expanded', 'false')
      applyMobileConversationFilter()
    }
    searchProxy.addEventListener('click', () => {
      searchBox.hidden = false
      root.dataset.harnessMobileConversationSearch = 'open'
      searchProxy.setAttribute('aria-expanded', 'true')
      requestAnimationFrame(() => searchInput.focus())
    })
    searchInput.addEventListener('input', () => {
      mobileConversationFilter = searchInput.value
      applyMobileConversationFilter()
    })
    searchBox.querySelector('button').addEventListener('click', () => {
      if (searchInput.value) {
        mobileConversationFilter = ''
        searchInput.value = ''
        applyMobileConversationFilter()
        searchInput.focus()
      } else closeSearch()
    })
    shell.querySelector('[data-harness-mobile-project-details]').addEventListener('click', () => {
      releaseComposerFocus()
      openProjectIdentitySheet()
    })
    for (const entry of shell.querySelectorAll('[data-harness-mobile-settings-entry]')) {
      entry.addEventListener('click', () => {
        releaseComposerFocus()
        openMobileMySettingsEntry(shell, entry.dataset.harnessMobileSettingsEntry)
      })
    }
    shell.querySelector('[data-harness-mobile-action="menu"]').addEventListener('click', () => {
      releaseComposerFocus()
      shell.querySelector('[data-harness-mobile-app-menu]').hidden = true
      if (isMobileConversationDetailOpen()) {
        mobileNavigationState.activeDomain = 'conversations'
        setSidebarExpanded(true)
        syncMobileAppShell()
        return
      }
      if (root.dataset.harnessMobileConversationSearch === 'open') closeSearch()
      const conversations = mobileDomains.find(domain => domain.id === 'conversations')
      if (conversations && mobileNavigationState.activeDomain !== 'conversations') navigateMobileDomain(conversations, shell)
      mobileNavigationState.activeDomain = 'conversations'
      setSidebarExpanded(true)
      syncMobileAppShell()
    })
    shell.querySelector('[data-harness-mobile-action="new"]').addEventListener('click', () => {
      releaseComposerFocus()
      if (mobileNavigationState.activeDomain !== 'conversations') {
        const panel = shell.querySelector('[data-harness-mobile-app-menu]')
        renderMobileMenu(shell)
        panel.hidden = !panel.hidden
        return
      }
      if (isMobileConversationDetailOpen()) {
        const panel = shell.querySelector('[data-harness-mobile-app-menu]')
        renderMobileMenu(shell)
        panel.hidden = !panel.hidden
        return
      }
      const button = sidebarNode()?.querySelector('button[aria-label="新建会话"],button[aria-label="New session"]')
      button?.click()
      if (sidebarExpanded()) setSidebarExpanded(false)
      setTimeout(() => {
        const chat = officialChatTarget()
        if (chat && !chat.disabled && chat.getAttribute?.('aria-disabled') !== 'true') chat.click()
      }, 40)
    })
    shell.querySelector('[data-harness-mobile-drawer-scrim]').addEventListener('click', () => {
      releaseComposerFocus()
      setSidebarExpanded(false)
    })
    const mobileMenu = shell.querySelector('[data-harness-mobile-app-menu]')
    const mobileMenuAction = shell.querySelector('[data-harness-mobile-action="new"]')
    document.addEventListener('pointerdown', event => {
      if (mobileMenu.hidden || mobileMenu.contains(event.target) || mobileMenuAction.contains(event.target)) return
      mobileMenu.hidden = true
    }, true)
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && !mobileMenu.hidden) mobileMenu.hidden = true
    })
    for (const domain of mobileDomains) {
      shell.querySelector(`[data-harness-mobile-domain="${domain.id}"]`)?.addEventListener('click', event => {
        const visibleConversation = document.querySelector('[data-harness-mobile-conversation="true"]')
        const detailComposer = visibleConversation?.querySelector?.('[data-composer-card]')
        if (domain.id !== 'conversations' && root.dataset.harnessMobileChatDetail === 'open' && detailComposer && visible(visibleConversation)) {
          event.preventDefault()
          event.stopPropagation()
          return
        }
        mobileMenu.hidden = true
        navigateMobileDomain(domain, shell)
      })
    }
    presentationRoot.appendChild(shell)
    installNavigationBridgeSubscription(shell)
    syncMobileNavigation(shell)
    return shell
  }

  const isMobileConversationDetailOpen = () => {
    if (root.dataset.harnessMobileChatDetail === 'open') return true
    if (mobileNavigationState.activeDomain !== 'conversations' || sidebarExpanded()) return false
    const conversation = document.querySelector('[data-harness-mobile-conversation="true"]')
    return Boolean(conversation?.querySelector?.('[data-composer-card]') && visible(conversation))
  }

  const installMobileBackHandler = () => {
    window.__harnessMobileHandleBack = () => {
      const shell = document.getElementById('harness-mobile-app-shell')
      if (!shell) return false

      const projectSheet = document.querySelector('[data-harness-mobile-project-sheet]')
      if (projectSheet) {
        projectSheet.remove()
        return true
      }

      const settings = document.querySelector('[data-harness-mobile-settings-dialog="true"]')
      if (settings && root.dataset.harnessMobileSettingsOpen === 'true') {
        const action = root.dataset.harnessMobileSettingsView === 'detail'
          ? settings.querySelector('[data-harness-mobile-settings-back="true"]')
          : settings.querySelector('[data-harness-mobile-settings-close="true"]')
        action?.click?.()
        return Boolean(action)
      }

      const suggestionClose = document.querySelector('[data-harness-mobile-composer-suggestion="true"] button[data-action="close"]')
      if (suggestionClose) {
        suggestionClose.click()
        return true
      }

      const appMenu = shell.querySelector('[data-harness-mobile-app-menu]')
      if (appMenu && !appMenu.hidden) {
        appMenu.hidden = true
        return true
      }

      if (root.dataset.harnessMobileConversationSearch === 'open') {
        const box = shell.querySelector('[data-harness-mobile-conversation-search-box]')
        const proxy = shell.querySelector('[data-harness-mobile-conversation-search-proxy]')
        const input = box?.querySelector('input')
        if (input) input.value = ''
        mobileConversationFilter = ''
        applyMobileConversationFilter()
        if (box) box.hidden = true
        proxy?.setAttribute?.('aria-expanded', 'false')
        delete root.dataset.harnessMobileConversationSearch
        return true
      }

      if (root.dataset.harnessMobileAgentDetailOpen === 'true') {
        document.querySelector('[data-harness-mobile-agent-detail-toggle]')?.click?.()
        return true
      }

      const sheet = [...document.querySelectorAll('[role="dialog"][aria-modal="true"], dialog')]
        .find(dialog => dialog.dataset.harnessMobileSettingsDialog !== 'true')
      if (sheet) {
        const close = [...sheet.querySelectorAll('button')].find(button => /^(?:关闭|Close|取消|Cancel|×)$|(?:关闭|Close)/i.test(`${button.getAttribute('aria-label') || ''} ${(button.textContent || '').trim()}`.trim()))
        if (close) {
          close.click()
          return true
        }
      }

      if (isMobileConversationDetailOpen()) {
        mobileNavigationState.activeDomain = 'conversations'
        setSidebarExpanded(true)
        syncMobileAppShell()
        return true
      }

      if (mobileNavigationState.activeDomain !== 'conversations' || !sidebarExpanded()) {
        const conversations = mobileDomains.find(domain => domain.id === 'conversations')
        if (conversations && mobileNavigationState.activeDomain !== 'conversations') navigateMobileDomain(conversations, shell)
        mobileNavigationState.activeDomain = 'conversations'
        setSidebarExpanded(true)
        syncMobileAppShell()
        return true
      }
      return false
    }
  }

  const syncMobileAppShell = () => {
    const shell = installMobileAppShell()
    if (!shell) return
    installMobileBackHandler()
    installNavigationBridgeSubscription(shell)
    if (mobileNavigationState.activeDomain === 'conversations' && !shell.dataset.harnessMobileConversationHomeOpened && sidebarNode() && setSidebarExpanded(true)) {
      shell.dataset.harnessMobileConversationHomeOpened = 'true'
    }
    const drawerOpen = sidebarExpanded()
    const heading = shell.querySelector('[data-harness-mobile-heading]')
    const current = [...document.querySelectorAll('[data-harness-mobile-title-cluster="true"] nav button, header nav button')]
      .filter(button => button.disabled || button.getAttribute('aria-current') === 'page')
      .at(-1)
    const activeDomain = mobileDomains.find(domain => domain.id === mobileNavigationState.activeDomain)
    const conversation = document.querySelector('[data-harness-mobile-conversation="true"]')
    const composer = conversation?.querySelector?.('[data-composer-card]')
    const chatDetail = Boolean(!drawerOpen && activeDomain?.id === 'conversations' && composer && visible(conversation))
    const generating = chatDetail && [...composer.querySelectorAll('button')].some(button => visible(button) && /^(?:Stop|停止)(?:\s|$)/i.test(accessibleButtonText(button)))
    const domainTitle = activeDomain && activeDomain.id !== 'conversations' ? activeDomain.label : ''
    const title = domainTitle || (drawerOpen ? '对话' : ((current?.textContent || '').trim() || (document.querySelector('[data-phase="hero"]') ? '新对话' : 'Harness')))
    const domainSubtitle = activeDomain?.id === 'agents' ? '成员、角色与协作画布' : activeDomain?.id === 'tasks' ? '会话提醒与项目自动化' : activeDomain?.id === 'me' ? '手机设置与桌面配置' : '实时工作区'
    const subtitle = chatDetail ? (generating ? '正在生成' : '桌面端已连接') : (domainTitle ? domainSubtitle : (drawerOpen ? '桌面端已连接' : domainSubtitle))
    if (heading?.firstElementChild && heading.firstElementChild.textContent !== title) heading.firstElementChild.textContent = title
    if (heading?.lastElementChild && heading.lastElementChild.textContent !== subtitle) heading.lastElementChild.textContent = subtitle
    const menuButton = shell.querySelector('[data-harness-mobile-action="menu"]')
    const actionButton = shell.querySelector('[data-harness-mobile-action="new"]')
    const mySurface = shell.querySelector('[data-harness-mobile-my-surface]')
    const conversationsDomain = activeDomain?.id === 'conversations'
    if (mySurface) mySurface.hidden = activeDomain?.id !== 'me' || root.dataset.harnessMobileMyDetail === 'official'
    actionButton.hidden = !conversationsDomain
    if (!conversationsDomain) shell.querySelector('[data-harness-mobile-app-menu]').hidden = true
    const nonConversationDomain = activeDomain?.id && activeDomain.id !== 'conversations'
    const menuIcon = chatDetail ? 'back' : 'home-text'
    const actionIcon = chatDetail ? 'more' : (nonConversationDomain ? 'filter' : 'new')
    if (menuButton.dataset.harnessMobileIcon !== menuIcon) {
      menuButton.dataset.harnessMobileIcon = menuIcon
      if (menuIcon === 'home-text') {
        menuButton.dataset.harnessMobileHomeText = 'true'
        menuButton.innerHTML = '<span>首页</span>'
      } else {
        delete menuButton.dataset.harnessMobileHomeText
        menuButton.innerHTML = appIcon(menuIcon)
      }
    }
    if (actionButton.dataset.harnessMobileIcon !== actionIcon) {
      actionButton.dataset.harnessMobileIcon = actionIcon
      actionButton.innerHTML = appIcon(actionIcon)
    }
    menuButton.setAttribute('aria-label', chatDetail ? '返回对话列表' : '首页')
    actionButton.setAttribute('aria-label', chatDetail ? '更多会话功能' : (nonConversationDomain ? '筛选当前页面' : '新建会话'))
    root.dataset.harnessMobileDomain = activeDomain?.id || 'conversations'
    root.dataset.harnessMobileDrawer = drawerOpen ? 'open' : 'closed'
    if (chatDetail) root.dataset.harnessMobileChatDetail = 'open'
    else delete root.dataset.harnessMobileChatDetail
    syncDrawerAccessibility(shell, drawerOpen)
    syncMobilePresentationIsolation(activeDomain?.id || 'conversations', shell)
    decorateAgentTeamsWorkbench()
    syncMobileNavigation(shell)
  }

  const mobileSettingsCategories = [
    { match: /^(?:General|通用设置?)$/i, zh: ['通用设置', '语言、外观与会话默认项', '基础与外观'], en: ['General', 'Language, appearance and session defaults', 'Basics & appearance'] },
    { match: /^(?:Appearance|外观(?:设置)?)$/i, zh: ['外观', '主题、字号与界面密度', ''], en: ['Appearance', 'Theme, text size and interface density', ''] },
    { match: /^(?:Notifications?|通知(?:与提醒)?)$/i, zh: ['通知与提醒', '任务状态、审批与更新提醒', ''], en: ['Notifications', 'Task, approval and update alerts', ''] },
    { match: /^(?:Models?|模型)$/i, zh: ['模型路由', '主模型、子代理与提供方目录', 'AI 与代理'], en: ['Model routing', 'Main, subagent and provider routes', 'AI & agents'] },
    { match: /^(?:Agent presets?|Agent 预设)$/i, zh: ['代理预设', '默认能力、工具与权限范围', ''], en: ['Agent presets', 'Default capabilities, tools and permissions', ''] },
    { match: /^(?:Agent Teams?|Agent 团队|代理团队)$/i, zh: ['代理团队', '成员、并发与协作策略', ''], en: ['Agent teams', 'Members, concurrency and collaboration', ''] },
    { match: /^(?:Plugins?|插件)$/i, zh: ['插件', '管理已安装插件与配置', '插件与能力'], en: ['Plugins', 'Manage installed plugins and settings', 'Plugins & capabilities'] },
    { match: /^(?:Skills?|General Skills|通用 Skills|技能)$/i, zh: ['Skills', '查看和管理可用技能', ''], en: ['Skills', 'Review and manage available skills', ''] },
    { match: /^(?:DSH Plugin Marketplace|DSH 插件市场)$/i, zh: ['DSH 插件市场', '发现、安装和更新扩展', ''], en: ['DSH Plugin Marketplace', 'Discover, install and update extensions', ''] },
    { match: /^MCP$/i, zh: ['MCP', '服务器、连接状态与工具授权', ''], en: ['MCP', 'Servers, connection status and tool access', ''] },
    { match: /^(?:Mobile(?: & Remote)?|手机与远程同步|移动与远程)$/i, zh: ['电脑与移动端', '配对设备、远程线路与连接状态', '连接与开发'], en: ['Desktop & mobile', 'Paired devices, remote routes and connection state', 'Connections & development'] },
    { match: /^(?:Browser|浏览器)$/i, zh: ['浏览器', '浏览器会话与控制边界', ''], en: ['Browser', 'Browser sessions and control boundaries', ''] },
    { match: /^(?:Scheduled tasks?|Schedules?|定时任务)$/i, zh: ['定时任务', '计划、周期与提醒', ''], en: ['Scheduled tasks', 'Plans, recurrence and reminders', ''] },
    { match: /^(?:Memory|记忆)$/i, zh: ['记忆', '本地连续性与使用边界', ''], en: ['Memory', 'Local continuity and usage boundaries', ''] },
    { match: /^(?:Godot Preview Settings|Godot 预览(?:设置)?)$/i, zh: ['Godot 预览', '连接、设备与画面参数', ''], en: ['Godot Preview', 'Connection, device and display settings', ''] }
  ]

  const settingsButtonRawLabel = button => {
    if (button?.hasAttribute?.('data-hd-theme-nav')) return 'Appearance'
    const label = button?.querySelector?.('[class*="_navLabel"],span')
    const displayed = String(label?.textContent || button?.textContent || '').trim()
    const translated = String(button?.dataset?.harnessMobileSettingsTranslatedLabel || '').trim()
    if (displayed && displayed !== translated) {
      button.dataset.harnessMobileSettingsOriginalLabel = displayed
      return displayed
    }
    return String(button?.dataset?.harnessMobileSettingsOriginalLabel || displayed).trim()
  }

  const settingsCategoryMeta = (button, index = 0) => {
    const raw = settingsButtonRawLabel(button)
    if (button && !button.dataset.harnessMobileSettingsOriginalLabel) button.dataset.harnessMobileSettingsOriginalLabel = raw
    const definition = mobileSettingsCategories.find(item => item.match.test(raw))
    const chinese = true
    const copy = definition?.zh || [raw || '设置', '', '']
    return { raw, title: copy[0], summary: copy[1], group: copy[2], chinese }
  }

  const findNativeSettingsClose = content => [...(content?.querySelectorAll?.('button') || [])]
    .find(button => !button.dataset.harnessMobileSettingsClose && /^(?:关闭|Close|×)$|(?:关闭|Close).*(?:设置|Settings|窗口|window|对话框|dialog)/i.test(`${button.getAttribute('aria-label') || ''} ${button.title || ''} ${(button.textContent || '').trim()}`.trim())) || null

  const setSettingsView = (dialog, view, focus = false) => {
    const nav = dialog?.querySelector?.(':scope > nav[data-harness-mobile-settings-nav="true"]')
    const content = dialog?.querySelector?.(':scope > [data-harness-mobile-settings-content="true"]')
    const toolbar = dialog?.querySelector?.(':scope > [data-harness-mobile-settings-toolbar="true"]')
    if (!nav || !content || !toolbar) return
    const list = view !== 'detail'
    dialog.dataset.harnessMobileSettingsView = list ? 'list' : 'detail'
    root.dataset.harnessMobileSettingsView = list ? 'list' : 'detail'
    nav.inert = !list
    nav.setAttribute('aria-hidden', list ? 'false' : 'true')
    content.inert = list
    content.setAttribute('aria-hidden', list ? 'true' : 'false')
    const back = toolbar.querySelector('[data-harness-mobile-settings-back="true"]')
    if (back) {
      back.hidden = list
      back.style.setProperty('visibility', list ? 'hidden' : 'visible', 'important')
      back.style.setProperty('pointer-events', list ? 'none' : 'auto', 'important')
    }
    const active = nav.querySelector('button[aria-current="true"]') || nav.querySelector('[data-harness-mobile-settings-category="true"]')
    const title = toolbar.querySelector('[data-harness-mobile-settings-title="true"]')
    if (title) {
      const firstMeta = settingsCategoryMeta(nav.querySelector('[data-harness-mobile-settings-category="true"]'), 0)
      title.textContent = list ? (firstMeta.chinese ? '设置' : 'Settings') : settingsCategoryMeta(active).title
    }
    if (!focus) return
    setTimeout(() => {
      if (list) {
        active?.focus?.({ preventScroll: true })
        active?.scrollIntoView?.({ block: 'nearest' })
        return
      }
      content.tabIndex = -1
      content.focus?.({ preventScroll: true })
      content.scrollTop = 0
    }, 40)
  }

  const modelSettingsButton = button => /^(?:Models?|模型)$/i.test(settingsButtonRawLabel(button))

  const modelRouteCard = (title, route, note = '') => {
    const card = document.createElement('section')
    card.className = 'harness-mobile-model-route'
    const heading = document.createElement('h3')
    heading.textContent = title
    const value = document.createElement('strong')
    value.textContent = route?.provider && route?.model ? `${route.provider} / ${route.model}` : '尚未配置'
    card.append(heading, value)
    if (note) {
      const caption = document.createElement('p')
      caption.textContent = note
      card.appendChild(caption)
    }
    return card
  }

  const meterStatusLabel = status => ({
    ready: '可用',
    'auth-required': '需要登录或密钥',
    unavailable: '暂不可用',
    unsupported: '暂不支持',
    stale: '上次结果',
    error: '读取失败'
  })[String(status || '').toLowerCase()] || '状态未知'

  const meterLine = meter => {
    if (typeof meter === 'string') return meter
    if (meter?.kind === 'balance') {
      const total = Number(meter.total)
      return Number.isFinite(total) ? `${meter.currency || ''} ${total}`.trim() : '余额未返回'
    }
    if (meter?.kind === 'usage-window') {
      const remaining = Number(meter.remainingPercent)
      return Number.isFinite(remaining) ? `剩余 ${Math.max(0, Math.min(100, remaining))}%` : '用量未返回'
    }
    if (meter?.kind === 'spending-budget') {
      const used = String(meter.used ?? '').trim()
      const limit = String(meter.limit ?? '').trim()
      return used && limit ? `已用 ${used} / ${limit}` : '消费限额未返回'
    }
    return '额度详情未返回'
  }

  const appendMobileProviderMeters = (panel, meters) => {
    const section = document.createElement('section')
    section.className = 'harness-mobile-model-meters'
    const title = document.createElement('h2')
    title.textContent = '余额与额度'
    const note = document.createElement('p')
    note.textContent = '实时读取自已配对电脑；不在手机保存账户凭据。'
    section.append(title, note)
    const providers = Array.isArray(meters?.providers) ? meters.providers : []
    if (!providers.length) {
      const empty = document.createElement('div')
      empty.className = 'harness-mobile-model-empty'
      empty.textContent = meters?.unavailableReason || '已配对电脑没有返回可显示的余额或额度信息。'
      section.appendChild(empty)
    }
    for (const snapshot of providers) {
      const card = document.createElement('article')
      card.className = 'harness-mobile-model-meter'
      const heading = document.createElement('div')
      const provider = document.createElement('strong')
      provider.textContent = snapshot?.name || snapshot?.id || '模型提供方'
      const status = document.createElement('span')
      status.textContent = meterStatusLabel(snapshot?.status)
      heading.append(provider, status)
      card.appendChild(heading)
      const rows = Array.isArray(snapshot?.meters) ? snapshot.meters : []
      for (const meter of rows) {
        const row = document.createElement('p')
        const value = document.createElement('b')
        value.textContent = meterLine(meter)
        row.appendChild(value)
        card.appendChild(row)
      }
      if (!rows.length || snapshot?.unavailableReason) {
        const message = document.createElement('small')
        message.textContent = String(snapshot?.unavailableReason || '该提供方没有返回可显示的额度明细。')
        card.appendChild(message)
      }
      section.appendChild(card)
    }
    panel.appendChild(section)
  }

  const renderMobileModelRouting = (panel, routing, meters) => {
    panel.replaceChildren()
    panel.setAttribute('aria-busy', 'false')

    const intro = document.createElement('section')
    intro.className = 'harness-mobile-model-intro'
    const title = document.createElement('h2')
    title.textContent = '当前模型路由'
    const description = document.createElement('p')
    description.textContent = '只读显示，来源：已配对电脑。模型凭据和提供方设置仍只在电脑端管理。'
    const badge = document.createElement('span')
    badge.textContent = routing.configured ? '已配置' : '尚未配置'
    intro.append(title, description, badge)
    panel.appendChild(intro)

    const routes = document.createElement('div')
    routes.className = 'harness-mobile-model-routes'
    routes.appendChild(modelRouteCard('主模型', routing.main))
    const subagentNote = routing.subagent?.inheritMain ? '跟随主模型' : '独立子代理路由'
    routes.appendChild(modelRouteCard('子代理', routing.subagent, subagentNote))
    panel.appendChild(routes)
    appendMobileProviderMeters(panel, meters)

    const catalog = document.createElement('section')
    catalog.className = 'harness-mobile-model-catalog'
    const catalogTitle = document.createElement('h2')
    catalogTitle.textContent = '提供方目录'
    const catalogNote = document.createElement('p')
    catalogNote.textContent = '这里只显示电脑端可选目录，不代表凭据或连接状态。'
    catalog.append(catalogTitle, catalogNote)
    if (!routing.providers.length) {
      const empty = document.createElement('div')
      empty.className = 'harness-mobile-model-empty'
      empty.textContent = '已配对电脑暂未返回可显示的提供方。'
      catalog.appendChild(empty)
    }
    for (const provider of routing.providers) {
      const details = document.createElement('details')
      const summary = document.createElement('summary')
      const providerName = document.createElement('span')
      providerName.textContent = provider.name || provider.id
      const count = document.createElement('small')
      count.textContent = `${provider.models.length} 个模型`
      summary.append(providerName, count)
      details.appendChild(summary)
      const identity = document.createElement('p')
      identity.textContent = `Provider ID：${provider.id}`
      details.appendChild(identity)
      const list = document.createElement('ul')
      for (const model of provider.models.slice(0, 24)) {
        const item = document.createElement('li')
        item.textContent = model
        list.appendChild(item)
      }
      if (provider.models.length > 24) {
        const item = document.createElement('li')
        item.textContent = `另有 ${provider.models.length - 24} 个模型，请在电脑端查看完整目录`
        list.appendChild(item)
      }
      if (!provider.models.length) {
        const item = document.createElement('li')
        item.textContent = '没有可显示的模型条目'
        list.appendChild(item)
      }
      details.appendChild(list)
      catalog.appendChild(details)
    }
    panel.appendChild(catalog)

    const footer = document.createElement('p')
    footer.className = 'harness-mobile-model-footnote'
    footer.textContent = '选择当前对话模型请返回输入框；新增提供方、保存 API Key 或探测端点请使用已配对电脑。'
    panel.appendChild(footer)
  }

  const loadMobileModelRouting = async (panel, content) => {
    panel.setAttribute('aria-busy', 'true')
    panel.replaceChildren()
    const loading = document.createElement('div')
    loading.className = 'harness-mobile-model-loading'
    loading.setAttribute('role', 'status')
    loading.textContent = '正在从已配对电脑读取模型配置…'
    panel.appendChild(loading)
    try {
      const meterRequest = fetch('/__harness_mobile__/provider-meters', {
        cache: 'no-store',
        credentials: 'same-origin',
        headers: { Accept: 'application/json' }
      }).then(async response => {
        if (!response.ok) throw new Error(`provider meters ${response.status}`)
        const payload = await response.json()
        return payload?.ok === true && Array.isArray(payload.providers) ? { providers: payload.providers } : { unavailableReason: '电脑端没有返回权威额度数据。', providers: [] }
      }).catch(() => ({ unavailableReason: '当前电脑端版本暂不支持手机读取余额，请更新电脑端后重试。', providers: [] }))
      const [response, meters] = await Promise.all([
        fetch('/__harness_mobile__/model-routing', {
          cache: 'no-store',
          credentials: 'same-origin',
          headers: { Accept: 'application/json' }
        }),
        meterRequest
      ])
      if (!response.ok) throw new Error(`model routing ${response.status}`)
      const payload = await response.json()
      const routing = payload?.ok === true ? payload.routing : null
      if (!routing || !Array.isArray(routing.providers)) throw new Error('invalid model routing response')
      if (!panel.isConnected || content.dataset.harnessMobileModelRouting !== 'true' || panel.dataset.harnessMobileModelEditor === 'true') return
      renderMobileModelRouting(panel, routing, meters)
    } catch {
      if (!panel.isConnected || content.dataset.harnessMobileModelRouting !== 'true' || panel.dataset.harnessMobileModelEditor === 'true') return
      panel.replaceChildren()
      panel.setAttribute('aria-busy', 'false')
      const error = document.createElement('section')
      error.className = 'harness-mobile-model-error'
      error.setAttribute('role', 'alert')
      const title = document.createElement('h2')
      title.textContent = '无法读取模型配置'
      const copy = document.createElement('p')
      copy.textContent = '无法从已配对电脑读取。请确认电脑端 Harness 正在运行，然后重试；模型设置没有被猜测或缓存。'
      const retry = document.createElement('button')
      retry.type = 'button'
      retry.textContent = '重试'
      retry.addEventListener('click', () => loadMobileModelRouting(panel, content))
      error.append(title, copy, retry)
      panel.appendChild(error)
    }
  }

  const decorateMobileModelSettings = (nav, content) => {
    const active = nav?.querySelector?.('button[aria-current="true"]')
    const existing = content?.querySelector?.(':scope > #harness-mobile-model-routing')
    if (!modelSettingsButton(active)) {
      if (content) delete content.dataset.harnessMobileModelRouting
      existing?.remove()
      return
    }
    content.dataset.harnessMobileModelRouting = 'true'
    if (existing) return
    const panel = document.createElement('div')
    panel.id = 'harness-mobile-model-routing'
    panel.setAttribute('aria-label', '手机模型配置视图')
    content.appendChild(panel)
    // The desktop integration owns the live directory, current selection, and save action.
    // It mounts asynchronously after the model nav click, so wait for that one source
    // instead of racing a mobile endpoint and painting a stale/duplicate projection.
    let attempts = 0
    let fallbackStarted = false
    const attachOfficialPanel = () => {
      const officialPanel = content.querySelector('#harness-desktop-model-routing')
      if (officialPanel) {
        officialPanel.dataset.harnessMobileModelEditor = 'true'
        panel.replaceChildren(officialPanel)
        panel.setAttribute('aria-busy', 'false')
        return
      }
      if (!panel.isConnected || content.dataset.harnessMobileModelRouting !== 'true') return
      if (++attempts < 160) {
        setTimeout(attachOfficialPanel, 50)
        return
      }
      if (!fallbackStarted) {
        fallbackStarted = true
        loadMobileModelRouting(panel, content)
      }
      if (++attempts < 320) {
        setTimeout(attachOfficialPanel, 50)
        return
      }
    }
    panel.setAttribute('aria-busy', 'true')
    // Start the authoritative endpoint immediately while watching for the richer editor.
    fallbackStarted = true
    loadMobileModelRouting(panel, content)
    attachOfficialPanel()
  }

  const pluginSettingsButton = button => /^(?:Plugins?|插件)$/i.test(settingsButtonRawLabel(button))

  const renderMobilePlugins = (panel, payload) => {
    panel.replaceChildren()
    panel.setAttribute('aria-busy', 'false')
    const intro = document.createElement('section')
    intro.className = 'harness-mobile-plugin-intro'
    const title = document.createElement('h2')
    title.textContent = '已安装插件'
    const copy = document.createElement('p')
    copy.textContent = '只读显示已配对电脑的真实插件状态；凭据和敏感配置不会发送到手机。'
    intro.append(title, copy)
    panel.appendChild(intro)
    const plugins = Array.isArray(payload?.plugins) ? payload.plugins : []
    if (!plugins.length) {
      const empty = document.createElement('section')
      empty.className = 'harness-mobile-plugin-empty'
      const heading = document.createElement('h3')
      heading.textContent = payload?.unavailableReason ? '暂时无法读取插件配置' : '没有已安装插件'
      const reason = document.createElement('p')
      reason.textContent = payload?.unavailableReason || '已配对电脑返回的权威插件列表为空。'
      empty.append(heading, reason)
      panel.appendChild(empty)
      return
    }
    const list = document.createElement('div')
    list.className = 'harness-mobile-plugin-list'
    for (const plugin of plugins) {
      const card = document.createElement('article')
      card.className = 'harness-mobile-plugin-card'
      const heading = document.createElement('div')
      const name = document.createElement('strong')
      name.textContent = String(plugin?.name || plugin?.id || '未命名插件')
      const state = document.createElement('span')
      state.textContent = plugin?.enabled ? '已启用' : '未启用'
      heading.append(name, state)
      const identity = document.createElement('p')
      identity.textContent = [plugin?.id ? `ID：${plugin.id}` : '', plugin?.version ? `版本：${plugin.version}` : ''].filter(Boolean).join(' · ')
      const config = document.createElement('small')
      config.textContent = plugin?.unavailableReason || (plugin?.configurable ? '有可配置项；敏感值仅在电脑端编辑' : '此插件没有可公开显示的配置项')
      card.append(heading, identity, config)
      list.appendChild(card)
    }
    panel.appendChild(list)
  }

  const loadMobilePlugins = async (panel, content) => {
    panel.setAttribute('aria-busy', 'true')
    panel.innerHTML = '<div class="harness-mobile-plugin-loading" role="status">正在从已配对电脑读取插件配置…</div>'
    try {
      const response = await fetch('/__harness_mobile__/plugins', {
        cache: 'no-store',
        credentials: 'same-origin',
        headers: { Accept: 'application/json' }
      })
      if (!response.ok) throw new Error(`plugins ${response.status}`)
      const payload = await response.json()
      if (payload?.ok !== true || !Array.isArray(payload.plugins)) throw new Error('invalid plugins response')
      if (!panel.isConnected || content.dataset.harnessMobilePluginConfig !== 'true') return
      renderMobilePlugins(panel, payload)
    } catch {
      if (!panel.isConnected || content.dataset.harnessMobilePluginConfig !== 'true') return
      renderMobilePlugins(panel, { plugins: [], unavailableReason: '无法从已配对电脑读取。请确认电脑端已更新并正在运行，然后重试。' })
      const retry = document.createElement('button')
      retry.type = 'button'
      retry.className = 'harness-mobile-plugin-retry'
      retry.textContent = '重试'
      retry.addEventListener('click', () => loadMobilePlugins(panel, content))
      panel.appendChild(retry)
    }
  }

  const decorateMobilePluginSettings = (nav, content) => {
    const active = nav?.querySelector?.('button[aria-current="true"]')
    const existing = content?.querySelector?.(':scope > #harness-mobile-plugin-config')
    if (!pluginSettingsButton(active)) {
      if (content) delete content.dataset.harnessMobilePluginConfig
      existing?.remove()
      return
    }
    content.dataset.harnessMobilePluginConfig = 'true'
    if (existing) return
    const panel = document.createElement('div')
    panel.id = 'harness-mobile-plugin-config'
    panel.setAttribute('aria-label', '手机插件配置只读视图')
    content.appendChild(panel)
    loadMobilePlugins(panel, content)
  }

  const decorateSettingsDialog = (dialog, nav, content) => {
    dialog.dataset.harnessMobileSettingsDialog = 'true'
    delete dialog.dataset.harnessMobileSheet
    nav.dataset.harnessMobileSettingsNav = 'true'
    content.dataset.harnessMobileSettingsContent = 'true'

    const buttons = [...nav.querySelectorAll('button')]
    let profile = nav.querySelector('[data-harness-mobile-profile-card="true"]')
    if (!profile) {
      profile = document.createElement('section')
      profile.dataset.harnessMobileProfileCard = 'true'
      profile.innerHTML = `<span data-harness-mobile-profile-avatar>H</span><div><strong>Harness Mobile</strong><small>桌面端已连接</small><p><span>配对有效</span><span>${mobileCapabilities.controlSettings ? '手机控制可管理' : '移动端设置'}</span></p></div>`
      const list = buttons[0]?.parentElement || nav
      list.insertBefore(profile, buttons[0] || null)
    }
    buttons.forEach((button, index) => {
      const meta = settingsCategoryMeta(button, index)
      button.dataset.harnessMobileSettingsCategory = 'true'
      button.dataset.harnessMobileSettingsSummary = meta.summary
      if (meta.group) button.dataset.harnessMobileSettingsGroup = meta.group
      else delete button.dataset.harnessMobileSettingsGroup
      button.setAttribute('aria-label', meta.summary ? `${meta.title}，${meta.summary}` : meta.title)
      const label = button.querySelector('[class*="_navLabel"],span')
      if (label && label.textContent !== meta.title) label.textContent = meta.title
      button.dataset.harnessMobileSettingsTranslatedLabel = meta.title
      let summary = button.querySelector(':scope > [data-harness-mobile-settings-summary="true"]')
      if (!summary) {
        summary = document.createElement('span')
        summary.dataset.harnessMobileSettingsSummary = 'true'
        button.appendChild(summary)
      }
      if (summary.textContent !== meta.summary) summary.textContent = meta.summary
    })

    let toolbar = dialog.querySelector(':scope > [data-harness-mobile-settings-toolbar="true"]')
    if (!toolbar) {
      toolbar = document.createElement('header')
      toolbar.dataset.harnessMobileSettingsToolbar = 'true'
      toolbar.innerHTML = `<button type="button" data-harness-mobile-settings-back="true" aria-label="返回设置分类"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg></button><h2 data-harness-mobile-settings-title="true">设置</h2><button type="button" data-harness-mobile-settings-close="true" aria-label="关闭设置"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>`
      toolbar.querySelector('[data-harness-mobile-settings-back="true"]').addEventListener('click', () => setSettingsView(dialog, 'list', true))
      toolbar.querySelector('[data-harness-mobile-settings-close="true"]').addEventListener('click', () => findNativeSettingsClose(dialog)?.click())
      dialog.insertBefore(toolbar, nav)
    }

    const nativeClose = findNativeSettingsClose(dialog)
    if (nativeClose) nativeClose.dataset.harnessMobileSettingsNativeClose = 'true'
    const nativeHeader = content.firstElementChild
    if (nativeHeader) {
      const actions = [...nativeHeader.querySelectorAll('button')].filter(button => button !== nativeClose)
      nativeHeader.dataset.harnessMobileSettingsNativeHeader = actions.length ? 'actions' : 'empty'
    }

    if (!nav.dataset.harnessMobileSettingsNavigationInstalled) {
      nav.dataset.harnessMobileSettingsNavigationInstalled = 'true'
      nav.addEventListener('click', event => {
        const button = event.target?.closest?.('button[data-harness-mobile-settings-category="true"]')
        if (!button || !nav.contains(button)) return
        setTimeout(() => setSettingsView(dialog, 'detail', true), 0)
      })
    }

    if (!dialog.dataset.harnessMobileSettingsView) dialog.dataset.harnessMobileSettingsView = 'list'
    setSettingsView(dialog, dialog.dataset.harnessMobileSettingsView)
    decorateMobileModelSettings(nav, content)
    decorateMobilePluginSettings(nav, content)
  }

  let activeMobileDialog = null
  let activeMobileDialogTrigger = null
  const dialogFocusable = dialog => [...(dialog?.querySelectorAll?.('button:not([disabled]),a[href],input:not([disabled]),textarea:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])') || [])]
    .filter(node => !node.hidden && node.getAttribute('aria-hidden') !== 'true' && !node.closest('[inert]'))
  const syncDialogFocus = dialogs => {
    const current = dialogs.find(dialog => visible(dialog)) || null
    if (activeMobileDialog && activeMobileDialog !== current) {
      const trigger = activeMobileDialogTrigger
      activeMobileDialog = null
      activeMobileDialogTrigger = null
      if (trigger?.isConnected) setTimeout(() => trigger.focus?.({ preventScroll: true }), 0)
    }
    if (!current || activeMobileDialog === current) return
    activeMobileDialog = current
    activeMobileDialogTrigger = current.contains(document.activeElement) ? null : document.activeElement
    if (current.dataset.harnessMobileFocusTrap !== 'true') {
      current.dataset.harnessMobileFocusTrap = 'true'
      current.addEventListener('keydown', event => {
        if (event.key !== 'Tab') return
        const focusable = dialogFocusable(current)
        if (!focusable.length) {
          event.preventDefault()
          current.focus?.({ preventScroll: true })
          return
        }
        const first = focusable[0]
        const last = focusable.at(-1)
        if (event.shiftKey && (document.activeElement === first || document.activeElement === current)) {
          event.preventDefault()
          last.focus?.({ preventScroll: true })
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault()
          first.focus?.({ preventScroll: true })
        }
      })
    }
    if (!current.hasAttribute('tabindex')) current.tabIndex = -1
    const target = dialogFocusable(current)[0] || current
    setTimeout(() => target.focus?.({ preventScroll: true }), 0)
  }

  const decorateDialogs = () => {
    let settingsOpen = false
    const modalDialogs = []
    for (const dialog of document.querySelectorAll('[role="dialog"][aria-modal="true"], dialog')) {
      if (dialog.getAttribute('aria-modal') === 'true' || dialog.matches?.('dialog[open]')) modalDialogs.push(dialog)
      const nav = dialog.querySelector(':scope > nav')
      const content = nav?.nextElementSibling
      const buttons = [...(nav?.querySelectorAll?.('button') || [])]
      const settings = dialog.dataset.harnessMobileSettingsDialog === 'true' || Boolean(
        content && buttons.length >= 3 && buttons.some(button => button.getAttribute('aria-current') === 'true')
      )
      if (settings) {
        settingsOpen = true
        delete dialog.dataset.harnessMobileRiskConfirmation
        decorateSettingsDialog(dialog, nav, content)
      } else {
        dialog.dataset.harnessMobileSheet = 'true'
        delete dialog.dataset.harnessMobileSettingsDialog
        const riskConfirmation = Boolean(
          dialog.querySelector('input[type="checkbox"]') &&
          [...dialog.querySelectorAll('button')].some(button => /Full access/i.test(accessibleButtonText(button)))
        )
        if (riskConfirmation) dialog.dataset.harnessMobileRiskConfirmation = 'true'
        else delete dialog.dataset.harnessMobileRiskConfirmation
      }
    }
    if (settingsOpen) root.dataset.harnessMobileSettingsOpen = 'true'
    else {
      delete root.dataset.harnessMobileSettingsOpen
      delete root.dataset.harnessMobileSettingsView
      if (root.dataset.harnessMobileMyOpening !== 'true') delete root.dataset.harnessMobileMyDetail
    }
    syncDialogFocus(modalDialogs)
  }

  const decorateConversationWorkflow = conversation => {
    const flow = [...conversation.querySelectorAll('[data-chat-flow-kind]')]
    if (!flow.length) return
    for (const item of flow) {
      delete item.dataset.harnessMobileWorkflow
      delete item.dataset.harnessMobileWorkflowGroup
      delete item.dataset.harnessMobileWorkflowHidden
    }
    const groups = []
    let pending = []
    for (const item of flow) {
      const kind = item.getAttribute('data-chat-flow-kind')
      if (kind === 'tool-call') {
        pending.push(item)
        continue
      }
      if (kind === 'assistant-step' && (item.textContent || '').trim() && pending.length) {
        groups.push({ state: 'archived', items: pending })
        pending = []
      }
    }
    if (pending.length) {
      const state = conversation.getAttribute('data-phase') === 'active' ? 'live' : 'archived'
      groups.push({ state, items: pending })
    }
    const liveIndex = groups.findIndex(group => group.state === 'live')
    const liveKey = liveIndex >= 0 ? `group-${liveIndex}` : ''
    const validKeys = new Set()
    groups.forEach((group, index) => {
      const key = `group-${index}`
      validKeys.add(key)
      const first = group.items[0]
      const parent = first?.parentElement
      if (!parent) return
      let summary = parent.querySelector(`:scope > [data-harness-mobile-workflow-summary="${key}"]`)
      if (!summary) {
        summary = document.createElement('button')
        summary.type = 'button'
        summary.dataset.harnessMobileWorkflowSummary = key
        summary.dataset.harnessMobileWorkflowExpanded = 'false'
      }
      summary.dataset.harnessMobileWorkflowState = group.state
      summary.textContent = group.state === 'live' ? `正在执行 · ${group.items.length} 个步骤` : `已完成 · ${group.items.length} 个步骤`
      if (summary.nextElementSibling !== first) parent.insertBefore(summary, first)
      const sync = () => {
        const expanded = summary.dataset.harnessMobileWorkflowExpanded === 'true'
        summary.setAttribute('aria-expanded', expanded ? 'true' : 'false')
        group.items.forEach((item, itemIndex) => {
          item.dataset.harnessMobileWorkflow = group.state
          item.dataset.harnessMobileWorkflowGroup = key
          const preview = group.state === 'live' && itemIndex >= Math.max(0, group.items.length - 3)
          item.dataset.harnessMobileWorkflowHidden = expanded || preview ? 'false' : 'true'
        })
      }
      if (summary.dataset.harnessMobileWorkflowBound !== 'true') {
        summary.dataset.harnessMobileWorkflowBound = 'true'
        summary.addEventListener('click', () => {
          summary.dataset.harnessMobileWorkflowExpanded = summary.dataset.harnessMobileWorkflowExpanded === 'true' ? 'false' : 'true'
          decorateConversationWorkflow(conversation)
        })
      }
      sync()
    })
    for (const summary of conversation.querySelectorAll('[data-harness-mobile-workflow-summary]')) {
      const key = summary.dataset.harnessMobileWorkflowSummary || ''
      if (!validKeys.has(key) || (summary.dataset.harnessMobileWorkflowState === 'live' && key !== liveKey)) summary.remove()
    }
  }

  let mobileComposerModelSheet = null
  let mobileComposerModelSource = null
  let mobileComposerModelMenu = null
  let mobileComposerModelProxy = null
  let mobileComposerModelTab = 'model'
  let mobileComposerModelRequest = 0

  const setMobileText = (node, value) => {
    const text = String(value || '')
    if (node && node.textContent !== text) node.textContent = text
  }

  const officialComposerModelTrigger = composer => [...(composer?.querySelectorAll?.('button[aria-haspopup="menu"]') || [])]
    .find(button => /^(?:选择模型|Select model)(?:[，,:]|\s|$)/i.test(accessibleButtonText(button))) || null

  const composerModelState = trigger => {
    const labels = [...(trigger?.querySelectorAll?.(':scope > span') || [])]
      .map(node => String(node.textContent || '').trim())
      .filter(Boolean)
    const title = String(trigger?.title || '').trim()
    const parts = title.split(/\s*·\s*/).filter(Boolean)
    return {
      model: labels[0] || parts[0] || '选择模型',
      effort: labels[1] || parts[1] || '默认'
    }
  }

  const officialComposerModelMenu = trigger => {
    const id = trigger?.getAttribute?.('aria-controls')
    const menu = id ? document.getElementById(id) : null
    if (!menu || !/^(?:模型与推理等级|Model and reasoning effort)$/i.test(String(menu.getAttribute('aria-label') || '').trim())) return null
    menu.dataset.harnessMobileModelSourceMenu = 'true'
    mobileComposerModelMenu = menu
    return menu
  }

  const renderMobileModelMessage = (message, tone = 'loading') => {
    const content = mobileComposerModelSheet?.querySelector?.('[data-harness-mobile-model-content]')
    if (!content) return
    content.replaceChildren()
    const status = document.createElement('p')
    status.dataset.harnessMobileModelStatus = tone
    status.setAttribute('role', tone === 'error' ? 'alert' : 'status')
    status.textContent = message
    content.appendChild(status)
  }

  const syncMobileComposerModelControl = () => {
    const source = mobileComposerModelSource
    const proxy = mobileComposerModelProxy
    if (!source || !proxy) return
    const state = composerModelState(source)
    setMobileText(proxy.querySelector('[data-harness-mobile-model-name]'), state.model)
    setMobileText(proxy.querySelector('[data-harness-mobile-model-effort]'), state.effort)
    proxy.disabled = Boolean(source.disabled)
    proxy.setAttribute('aria-haspopup', 'dialog')
    proxy.setAttribute('aria-controls', 'harness-mobile-model-dialog')
    proxy.setAttribute('aria-expanded', mobileComposerModelSheet && !mobileComposerModelSheet.hidden ? 'true' : 'false')
    proxy.setAttribute('aria-label', `模型 ${state.model}，推理等级 ${state.effort}`)
    proxy.title = `${state.model} · ${state.effort}`
    const sheet = mobileComposerModelSheet
    if (sheet && !sheet.hidden) {
      setMobileText(sheet.querySelector('[data-harness-mobile-model-current="model"]'), state.model)
      setMobileText(sheet.querySelector('[data-harness-mobile-model-current="effort"]'), state.effort)
    }
  }

  const closeMobileComposerModelSheet = ({ restoreFocus = true } = {}) => {
    mobileComposerModelRequest += 1
    const source = mobileComposerModelSource
    if (source?.isConnected && source.getAttribute?.('aria-expanded') === 'true') source.click()
    for (const menu of document.querySelectorAll?.('[data-harness-mobile-model-source-menu="true"]') || []) {
      delete menu.dataset.harnessMobileModelSourceMenu
    }
    mobileComposerModelMenu = null
    if (mobileComposerModelSheet) mobileComposerModelSheet.hidden = true
    delete root.dataset.harnessMobileModelSheetOpen
    syncMobileComposerModelControl()
    if (restoreFocus && mobileComposerModelProxy?.isConnected) mobileComposerModelProxy.focus?.({ preventScroll: true })
  }

  const mobileModelChoice = (sourceOption, kind) => {
    const choice = document.createElement('button')
    choice.type = 'button'
    choice.dataset.harnessMobileModelChoice = kind
    const selected = kind === 'model'
      ? sourceOption.getAttribute('aria-checked') === 'true'
      : sourceOption.getAttribute('aria-pressed') === 'true'
    choice.setAttribute('aria-pressed', selected ? 'true' : 'false')
    if (selected) choice.dataset.selected = 'true'

    const copy = document.createElement('span')
    const label = document.createElement('strong')
    const detail = document.createElement('small')
    if (kind === 'model') {
      const model = String(sourceOption.title || sourceOption.querySelector?.('span')?.textContent || sourceOption.textContent || '').trim()
      const group = sourceOption.closest?.('[role="group"]')
      const headingId = String(group?.getAttribute?.('aria-labelledby') || '')
      const heading = headingId ? document.getElementById(headingId) : null
      const raw = String(sourceOption.textContent || '').trim()
      label.textContent = model || '模型'
      detail.textContent = [String(heading?.textContent || '').trim(), raw.replace(model, '').trim()].filter(Boolean).join(' · ')
    } else {
      const aria = String(sourceOption.getAttribute('aria-label') || '')
      const effort = aria.replace(/^(?:选择推理强度|Select reasoning effort)\s*[：:]\s*/i, '').trim()
      label.textContent = effort || String(sourceOption.textContent || '').trim() || '默认'
      detail.textContent = String(sourceOption.title || '').trim()
    }
    copy.append(label, detail)
    const mark = document.createElement('span')
    mark.dataset.harnessMobileModelChoiceMark = 'true'
    mark.setAttribute('aria-hidden', 'true')
    mark.textContent = selected ? '✓' : '›'
    choice.append(copy, mark)
    choice.addEventListener('click', event => {
      event.preventDefault()
      event.stopPropagation()
      if (!sourceOption.isConnected) {
        renderMobileModelMessage('模型选项已更新，请重新打开后再试。', 'error')
        return
      }
      const before = composerModelState(mobileComposerModelSource)
      const beforeKey = `${before.model}\n${before.effort}`
      const token = ++mobileComposerModelRequest
      choice.disabled = true
      choice.setAttribute('aria-busy', 'true')
      sourceOption.click()
      const waitForSelection = (attempt = 0) => {
        if (token !== mobileComposerModelRequest || mobileComposerModelSheet?.hidden) return
        syncMobileComposerModelControl()
        const current = composerModelState(mobileComposerModelSource)
        const currentKey = `${current.model}\n${current.effort}`
        const accepted = selected || currentKey !== beforeKey || (sourceOption.isConnected && (kind === 'model'
          ? sourceOption.getAttribute('aria-checked') === 'true'
          : sourceOption.getAttribute('aria-pressed') === 'true'))
        if (accepted) {
          closeMobileComposerModelSheet()
          return
        }
        if (attempt < 30) {
          setTimeout(() => waitForSelection(attempt + 1), 100)
          return
        }
        choice.disabled = false
        choice.removeAttribute('aria-busy')
        renderMobileModelMessage('设置未生效，请重试。', 'error')
      }
      setTimeout(() => waitForSelection(), 80)
    })
    return choice
  }

  const renderMobileComposerModelChoices = (menu, kind) => {
    const content = mobileComposerModelSheet?.querySelector?.('[data-harness-mobile-model-content]')
    if (!content) return false
    const options = kind === 'model'
      ? [...menu.querySelectorAll('[role="menuitemradio"]')]
      : [...menu.querySelectorAll('button[aria-label*="选择推理强度"], button[aria-label*="Select reasoning effort"]')]
    if (!options.length) return false
    content.replaceChildren()
    const list = document.createElement('div')
    list.dataset.harnessMobileModelChoices = kind
    list.setAttribute('role', 'list')
    const groups = new Map()
    for (const option of options) {
      const group = kind === 'model' ? option.closest?.('[role="group"]') : null
      const labelledBy = String(group?.getAttribute?.('aria-labelledby') || '')
      const labelledNode = labelledBy ? document.getElementById(labelledBy) : null
      const title = String(labelledNode?.textContent || group?.getAttribute?.('aria-label') || '').replace(/\s+/g, ' ').trim()
      const key = group || '__default__'
      if (!groups.has(key)) groups.set(key, { title: title || (kind === 'model' ? '其他模型' : '推理等级'), options: [] })
      groups.get(key).options.push(option)
    }
    for (const group of groups.values()) {
      const section = document.createElement('section')
      section.dataset.harnessMobileModelProviderGroup = 'true'
      section.setAttribute('data-harness-mobile-model-provider-group', 'true')
      section.setAttribute('role', 'group')
      const heading = document.createElement('h3')
      heading.dataset.harnessMobileModelProviderHeading = 'true'
      heading.setAttribute('data-harness-mobile-model-provider-heading', 'true')
      heading.textContent = `${group.title}（${group.options.length}）`
      section.setAttribute('aria-labelledby', `harness-mobile-model-provider-${groups.size}-${list.children.length}`)
      heading.id = section.getAttribute('aria-labelledby')
      section.appendChild(heading)
      const choices = document.createElement('div')
      choices.dataset.harnessMobileModelChoices = kind
      for (const option of group.options) choices.appendChild(mobileModelChoice(option, kind))
      section.appendChild(choices)
      list.appendChild(section)
    }
    content.appendChild(list)
    return true
  }

  const waitForMobileComposerModelPane = (token, menu, kind, attempt = 0) => {
    if (token !== mobileComposerModelRequest || mobileComposerModelSheet?.hidden) return
    // The official directory keeps the current model visible while an async
    // catalog refresh is still in flight. Rendering that transitional row made
    // the phone sheet look complete with only its first/default choice. Wait for
    // the authoritative menu to clear aria-busy before mirroring its options.
    const busy = menu.getAttribute?.('aria-busy') === 'true'
    if (!busy && renderMobileComposerModelChoices(menu, kind)) return
    const failure = !busy && [...menu.querySelectorAll('div')].find(node => /没有可用|加载失败|No models|failed to load|未提供推理等级|no reasoning effort/i.test(String(node.textContent || '')))
    if (failure) {
      renderMobileModelMessage(String(failure.textContent || '').trim(), 'error')
      return
    }
    if (attempt < 240) {
      setTimeout(() => waitForMobileComposerModelPane(token, officialComposerModelMenu(mobileComposerModelSource) || menu, kind, attempt + 1), 50)
      return
    }
    renderMobileModelMessage(kind === 'model' ? '暂时无法读取可用模型，请稍后重试。' : '当前模型没有可选择的推理等级。', 'error')
  }

  const openMobileComposerModelPane = (kind = mobileComposerModelTab) => {
    const source = mobileComposerModelSource
    if (!source || source.disabled || !mobileComposerModelSheet || mobileComposerModelSheet.hidden) return
    mobileComposerModelTab = kind === 'effort' ? 'effort' : 'model'
    for (const tab of mobileComposerModelSheet.querySelectorAll('[data-harness-mobile-model-tab]')) {
      const selected = tab.dataset.harnessMobileModelTab === mobileComposerModelTab
      tab.setAttribute('aria-selected', selected ? 'true' : 'false')
      tab.tabIndex = selected ? 0 : -1
      if (selected) tab.setAttribute('aria-current', 'page')
      else tab.removeAttribute('aria-current')
    }
    mobileComposerModelSheet.querySelector('[data-harness-mobile-model-content]')?.setAttribute('aria-labelledby', `harness-mobile-model-tab-${mobileComposerModelTab}`)
    renderMobileModelMessage(mobileComposerModelTab === 'model' ? '正在读取可用模型…' : '正在读取推理等级…')
    const token = ++mobileComposerModelRequest
    if (source.getAttribute('aria-expanded') === 'true') source.click()

    const waitForRoot = (attempt = 0) => {
      if (token !== mobileComposerModelRequest || mobileComposerModelSheet.hidden) return
      const menu = officialComposerModelMenu(source)
      if (!menu) {
        if (attempt < 40) setTimeout(() => waitForRoot(attempt + 1), 50)
        else renderMobileModelMessage('模型选择器暂未就绪，请稍后重试。', 'error')
        return
      }
      const rootItem = [...menu.querySelectorAll('button[role="menuitem"]')].find(button => {
        const label = String(button.querySelector('span')?.textContent || '').trim()
        return mobileComposerModelTab === 'model' ? /^(?:模型|Model)$/i.test(label) : /^(?:推理等级|Effort)$/i.test(label)
      })
      if (!rootItem) {
        if (mobileComposerModelTab === 'effort' && !menu.querySelector('button[aria-label*="推理强度"], button[aria-label*="reasoning effort"]')) {
          renderMobileModelMessage('当前模型没有可选择的推理等级。', 'error')
          return
        }
        waitForMobileComposerModelPane(token, menu, mobileComposerModelTab)
        return
      }
      rootItem.click()
      setTimeout(() => waitForMobileComposerModelPane(token, officialComposerModelMenu(source) || menu, mobileComposerModelTab), 0)
    }

    setTimeout(() => {
      if (token !== mobileComposerModelRequest || mobileComposerModelSheet.hidden) return
      source.click()
      waitForRoot()
    }, 16)
  }

  const ensureMobileComposerModelSheet = () => {
    if (mobileComposerModelSheet?.isConnected) return mobileComposerModelSheet
    const sheet = document.createElement('div')
    sheet.dataset.harnessMobileModelSheet = 'true'
    sheet.hidden = true
    sheet.innerHTML = `<button type="button" data-harness-mobile-model-backdrop aria-label="关闭模型选择"></button><section id="harness-mobile-model-dialog" role="dialog" aria-modal="true" aria-labelledby="harness-mobile-model-title" tabindex="-1"><header><div><span>当前会话</span><h2 id="harness-mobile-model-title">模型与推理等级</h2></div><button type="button" data-harness-mobile-model-close aria-label="关闭">×</button></header><div data-harness-mobile-model-summary><span>当前</span><strong data-harness-mobile-model-current="model">选择模型</strong><span aria-hidden="true">·</span><strong data-harness-mobile-model-current="effort">默认</strong></div><div role="tablist" aria-label="模型设置"><button id="harness-mobile-model-tab-model" type="button" role="tab" aria-controls="harness-mobile-model-panel" data-harness-mobile-model-tab="model">模型</button><button id="harness-mobile-model-tab-effort" type="button" role="tab" aria-controls="harness-mobile-model-panel" data-harness-mobile-model-tab="effort">推理等级</button></div><div id="harness-mobile-model-panel" role="tabpanel" aria-live="polite" data-harness-mobile-model-content></div></section>`
    sheet.addEventListener('mousedown', event => event.stopPropagation())
    sheet.querySelector('[data-harness-mobile-model-backdrop]').addEventListener('click', () => closeMobileComposerModelSheet())
    sheet.querySelector('[data-harness-mobile-model-close]').addEventListener('click', () => closeMobileComposerModelSheet())
    const dialog = sheet.querySelector('[role="dialog"]')
    const handle = document.createElement('div')
    handle.dataset.harnessMobileModelHandle = 'true'
    handle.setAttribute('data-harness-mobile-model-handle', 'true')
    handle.setAttribute('aria-hidden', 'true')
    dialog?.insertBefore(handle, dialog.firstChild)
    let dragStartY = null
    let dragOffset = 0
    const clearDrag = () => {
      dragStartY = null
      dragOffset = 0
      sheet.removeAttribute('data-harness-mobile-model-dragging')
      if (dialog) dialog.style.removeProperty('--harness-mobile-model-drag-offset')
    }
    sheet.addEventListener('touchstart', event => {
      const touch = event.touches?.[0]
      if (!touch || !dialog?.contains(event.target) || event.target.closest?.('[data-harness-mobile-model-content]')) return
      dragStartY = touch.clientY
      dragOffset = 0
    }, { passive: true })
    sheet.addEventListener('touchmove', event => {
      if (dragStartY === null) return
      const touch = event.touches?.[0]
      if (!touch) return
      const delta = touch.clientY - dragStartY
      if (delta < 0 && Math.abs(delta) < 12) return
      if (delta > 0) event.preventDefault()
      dragOffset = delta
      sheet.setAttribute('data-harness-mobile-model-dragging', 'true')
      dialog?.style.setProperty('--harness-mobile-model-drag-offset', `${Math.max(-180, Math.min(180, delta))}px`)
    }, { passive: false })
    sheet.addEventListener('touchend', () => {
      if (dragStartY === null) return
      const delta = dragOffset
      clearDrag()
      if (delta >= 72) {
        closeMobileComposerModelSheet()
      } else if (delta <= -48) {
        dialog?.setAttribute('data-harness-mobile-model-expanded', 'true')
      }
    }, { passive: true })
    sheet.addEventListener('touchcancel', clearDrag, { passive: true })
    for (const tab of sheet.querySelectorAll('[data-harness-mobile-model-tab]')) {
      tab.addEventListener('click', () => openMobileComposerModelPane(tab.dataset.harnessMobileModelTab))
    }
    sheet.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        event.preventDefault()
        closeMobileComposerModelSheet()
        return
      }
      if (event.key !== 'Tab') return
      const focusable = [...sheet.querySelectorAll('button:not([disabled]), [tabindex="0"]')].filter(node => node.offsetParent !== null)
      if (!focusable.length) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    })
    document.body.appendChild(sheet)
    mobileComposerModelSheet = sheet
    return sheet
  }

  const openMobileComposerModelSheet = (source, proxy) => {
    if (!source?.isConnected || source.disabled) return
    mobileComposerModelSource = source
    mobileComposerModelProxy = proxy
    const sheet = ensureMobileComposerModelSheet()
    sheet.hidden = false
    root.dataset.harnessMobileModelSheetOpen = 'true'
    syncMobileComposerModelControl()
    openMobileComposerModelPane(mobileComposerModelTab)
    setTimeout(() => sheet.querySelector(`[data-harness-mobile-model-tab="${mobileComposerModelTab}"]`)?.focus?.({ preventScroll: true }), 0)
  }

  const ensureMobileComposerModelControl = composer => {
    const source = officialComposerModelTrigger(composer)
    const existing = composer?.querySelector?.('#harness-mobile-model-button')
    if (!source?.parentElement) {
      existing?.remove?.()
      if (mobileComposerModelSource && !mobileComposerModelSource.isConnected) closeMobileComposerModelSheet({ restoreFocus: false })
      return
    }
    if (mobileComposerModelSource && mobileComposerModelSource !== source && !mobileComposerModelSheet?.hidden) {
      closeMobileComposerModelSheet({ restoreFocus: false })
    }
    source.dataset.harnessMobileModelSourceTrigger = 'true'
    source.parentElement.dataset.harnessMobileModelSeat = 'true'
    let proxy = existing
    if (!proxy) {
      proxy = document.createElement('button')
      proxy.type = 'button'
      proxy.id = 'harness-mobile-model-button'
      proxy.dataset.harnessMobileModelTrigger = 'true'
      proxy.innerHTML = `<span><strong data-harness-mobile-model-name>选择模型</strong><small data-harness-mobile-model-effort>默认</small></span><span aria-hidden="true">⌄</span>`
      proxy.addEventListener('click', () => openMobileComposerModelSheet(proxy.__harnessMobileModelSource, proxy))
    }
    proxy.__harnessMobileModelSource = source
    if (proxy.parentElement !== source.parentElement || proxy.nextElementSibling !== source) source.parentElement.insertBefore(proxy, source)
    const permission = composer.querySelector('[data-harness-mobile-permission-trigger="true"]')
    let toolbar = source.parentElement
    while (toolbar?.parentElement && toolbar !== composer && !toolbar.contains(permission)) toolbar = toolbar.parentElement
    if (toolbar && toolbar !== composer && toolbar.contains(permission)) {
      toolbar.dataset.harnessMobileComposerToolbar = 'true'
      const left = [...toolbar.children].find(child => child.contains(permission))
      const trailing = [...toolbar.children].find(child => child.contains(source))
      if (left) left.dataset.harnessMobileComposerToolbarLeft = 'true'
      if (trailing) trailing.dataset.harnessMobileComposerToolbarTrailing = 'true'
    }
    mobileComposerModelSource = source
    mobileComposerModelProxy = proxy
    syncMobileComposerModelControl()
  }

  // Keep the phone presentation structurally isolated from desktop paint and
  // accessibility, and make the native textarea the only visible text layer.
  const syncMobilePresentationIsolation = (domain, shell) => {
    const settingsVisible = domain === 'me' || root.dataset.harnessMobileMyDetail === 'official'
    const surfaces = [...document.querySelectorAll('.dat-shell, [data-slot="workspace"], [data-slot="agent-teams.workspace"]')]
      .filter(node => !shell?.contains?.(node))
    for (const surface of surfaces) {
      if (surface.dataset.harnessMobilePresentationSurface !== 'true') {
        surface.dataset.harnessMobilePresentationSurface = 'true'
        surface.dataset.harnessMobilePreviousHidden = surface.hidden ? 'true' : 'false'
      }
      const isolate = settingsVisible && !surface.closest?.('[data-harness-mobile-settings-dialog="true"]')
      surface.inert = isolate
      surface.setAttribute('aria-hidden', isolate ? 'true' : 'false')
      surface.hidden = isolate
    }
  }

  const syncMobileComposerTextareaLayout = textarea => {
    if (!textarea || textarea.__harnessMobileSizing) return
    textarea.__harnessMobileSizing = true
    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    const direction = textarea.selectionDirection
    const scrollTop = textarea.scrollTop
    const focused = document.activeElement === textarea
    const lifted = root.dataset.harnessMobileComposerLifted === 'true'
    const viewportHeight = Number(window.visualViewport?.height || window.innerHeight || 0)
    const maximum = Math.max(60, Math.min(lifted ? 120 : 168, viewportHeight * (lifted ? .26 : .30) || 168))
    textarea.style.setProperty('height', 'auto', 'important')
    const height = Math.max(60, Math.min(maximum, Number(textarea.scrollHeight) || 60))
    textarea.style.setProperty('height', `${Math.ceil(height)}px`, 'important')
    const inputScroll = textarea.closest?.('[data-input-scroll]')
    if (inputScroll) inputScroll.style.setProperty('height', `${Math.ceil(height)}px`, 'important')
    if (focused && Number.isInteger(start) && Number.isInteger(end)) {
      try { textarea.setSelectionRange(start, end, direction || 'none') } catch {}
    }
    textarea.scrollTop = scrollTop
    textarea.__harnessMobileSizing = false
  }

  const normalizeMobileComposerLayers = composer => {
    if (!composer) return
    const inputScroll = composer.querySelector('[data-input-scroll]')
    const textarea = composer.querySelector('textarea[data-phase]')
    if (inputScroll) {
      inputScroll.dataset.harnessMobileComposerInput = 'true'
      inputScroll.setAttribute('role', 'group')
      inputScroll.setAttribute('aria-label', '消息正文')
      inputScroll.style.setProperty('isolation', 'isolate', 'important')
    }
    for (const layer of composer.querySelectorAll('[data-input-backdrop], [data-input-mirror]')) {
      layer.dataset.harnessMobileComposerDecoration = 'true'
      layer.inert = true
      layer.setAttribute('aria-hidden', 'true')
      layer.style.setProperty('pointer-events', 'none', 'important')
      layer.style.setProperty('visibility', 'hidden', 'important')
      layer.style.setProperty('opacity', '0', 'important')
      layer.style.setProperty('z-index', '0', 'important')
      layer.style.setProperty('-webkit-text-fill-color', 'transparent', 'important')
    }
    if (textarea) {
      textarea.dataset.harnessMobileComposerTextarea = 'true'
      textarea.inert = false
      textarea.removeAttribute('aria-hidden')
      textarea.setAttribute('role', 'textbox')
      textarea.setAttribute('aria-multiline', 'true')
      textarea.style.setProperty('z-index', '2', 'important')
      textarea.style.setProperty('visibility', 'visible', 'important')
      textarea.style.setProperty('opacity', '1', 'important')
      textarea.style.setProperty('color', 'var(--hm-color-text, #172133)', 'important')
      textarea.style.setProperty('-webkit-text-fill-color', 'var(--hm-color-text, #172133)', 'important')
      textarea.style.setProperty('caret-color', 'var(--hm-color-primary, #4968e8)', 'important')
      textarea.style.setProperty('background', 'transparent', 'important')
      textarea.style.setProperty('text-shadow', 'none', 'important')
      if (!textarea.__harnessMobileLayoutInstalled) {
        textarea.__harnessMobileLayoutInstalled = true
        textarea.addEventListener('input', () => syncMobileComposerTextareaLayout(textarea))
        textarea.addEventListener('compositionstart', () => { textarea.dataset.harnessMobileComposing = 'true' })
        textarea.addEventListener('compositionend', () => {
          delete textarea.dataset.harnessMobileComposing
          syncMobileComposerTextareaLayout(textarea)
        })
      }
      syncMobileComposerTextareaLayout(textarea)
    }
    const toolbar = composer.querySelector('[data-harness-mobile-composer-toolbar="true"]')
    if (toolbar) toolbar.setAttribute('role', 'toolbar')
  }

  const decorateConversation = () => {
    if (typeof document.querySelector !== 'function') return
    const conversation = document.querySelector('[data-phase][data-harness-mobile-conversation], [data-phase]')
    if (!conversation) return
    conversation.dataset.harnessMobileConversation = 'true'
    decorateConversationWorkflow(conversation)
    const header = conversation.querySelector(':scope > header')
    if (header) header.dataset.harnessMobileConversationHeader = 'true'
    const view = conversation.querySelector('[data-conversation-view]')
    if (view) view.dataset.harnessMobileConversationView = 'true'
    // TodoDock and QueueDock already own the authoritative projection and all
    // fold/edit/remove/steer actions. Mobile only marks that official DOM for
    // touch layout; it never creates a second task list or queue.
    for (const panel of conversation.querySelectorAll('[data-testid="todo-panel"]')) {
      panel.dataset.harnessMobileSessionTaskPanel = 'true'
    }
    for (const queue of conversation.querySelectorAll('[data-queue-dock]')) {
      queue.dataset.harnessMobileQueueDock = 'true'
    }
    const composer = conversation.querySelector('[data-composer-card]')
    const input = composer?.querySelector('textarea[data-phase]')
    const inputScroll = composer?.querySelector('[data-input-scroll]')
    if (composer) {
      composer.dataset.harnessMobileComposer = 'orbit'
      const composerFrame = composer.closest?.('[data-composer-seat]') || composer.parentElement
      if (composerFrame) {
        composerFrame.dataset.harnessMobileComposerFrame = 'true'
        composerFrame.dataset.harnessMobileComposerSeat = 'true'
      }
      for (const rail of composer.querySelectorAll('[role="group"], [data-slot*="attachment"], [data-attachments]')) {
        if (rail === inputScroll || rail.contains(input) || !rail.querySelector('img[alt], [data-attachment], [data-file], button[aria-label*="Remove"], button[aria-label*="移除"]')) continue
        rail.dataset.harnessMobileComposerAttachments = 'true'
      }
      for (const button of composer.querySelectorAll('button')) {
        delete button.dataset.harnessMobileComposerAction
        delete button.dataset.harnessMobileComposerTool
        delete button.dataset.harnessMobilePermissionTrigger
        if (button.id === 'harness-mobile-input-button' || button.id === 'harness-mobile-model-button') continue
        // Portal/overlay actions can still be DOM descendants of the composer.
        // They are official menu choices, not toolbar tools to hide on mobile.
        if (button.closest?.('[role="menu"], [role="listbox"]')) continue
        const attachmentRail = button.closest?.('[role="group"]')
        if (attachmentRail?.querySelector?.('img[alt]')) continue
        const label = accessibleButtonText(button)
        if (/^(?:访问模式|Access mode)(?:[，,:]|\s|$)/i.test(label)) {
          // Preserve the official PermissionSelect and its RiskConfirmation.
          // Mobile only gives the trigger a touch-safe seat; it never submits
          // /permission itself or bypasses the Full access acknowledgement.
          button.dataset.harnessMobilePermissionTrigger = 'true'
          for (let container = button.parentElement; container && container !== composer; container = container.parentElement) {
            container.dataset.harnessMobilePermissionContext = 'true'
          }
        } else if (/send message|发送消息|发送|stop generating|停止生成|停止运行/i.test(label)) {
          button.dataset.harnessMobileComposerAction = 'true'
        } else {
          button.dataset.harnessMobileComposerTool = 'true'
        }
      }
      ensureMobileComposerModelControl(composer)
    }
    normalizeMobileComposerLayers(composer)
    if (inputScroll) inputScroll.dataset.harnessMobileComposerInput = 'true'
    if (input) {
      input.dataset.harnessMobileComposerTextarea = 'true'
      if (input.readOnly && input.getAttribute('data-phase') === 'inert' && input.getAttribute('aria-haspopup') === 'menu') {
        // A workspace-trigger composer has no authoritative session yet. Never
        // let a newly selected document inherit the previously viewed session.
        window.__harnessMobileCurrentSessionId = ''
      }
      input.placeholder = '发消息…'
      window.__harnessMobileSyncComposerIntent?.(input)
    }
  }

  let composerStyleRestorations = []
  let containedComposerCard = null
  let containedComposerButton = null
  const containComposerContext = () => {
    if (typeof document.querySelector !== 'function') return
    const card = document.querySelector('[data-composer-card]')
    const button = card?.querySelector('button[aria-haspopup="listbox"]') || null
    if (card === containedComposerCard && button === containedComposerButton) return
    for (const restore of composerStyleRestorations.splice(0)) restore()
    containedComposerCard = card
    containedComposerButton = button
    if (!card || !button || !button.parentElement) return
    const setTemporary = (element, property, value) => {
      const previous = element.style.getPropertyValue(property)
      const priority = element.style.getPropertyPriority(property)
      element.style.setProperty(property, value, 'important')
      composerStyleRestorations.push(() => {
        if (element.style.getPropertyValue(property) !== value || element.style.getPropertyPriority(property) !== 'important') return
        if (previous) element.style.setProperty(property, previous, priority)
        else element.style.removeProperty(property)
      })
    }
    // Only constrain the model/preset listbox that lives inside the composer.
    // Never mutate conversation rows, to-bottom controls or dialog content.
    if (button.closest('[data-conversation-scroll]') && !button.closest('[data-composer-card]')) return
    setTemporary(button.parentElement, 'min-width', '0px')
    setTemporary(button.parentElement, 'max-width', '100%')
    // The command button shares its toolbar with PermissionSelect. Clipping the
    // whole toolbar hides the official access-mode menu after it opens.
    setTemporary(button, 'min-width', '0px')
    setTemporary(button, 'max-width', '100%')
  }

  const installImeSendBridge = () => {
    if (!mobileCapabilities.imeSendBridge) return
    if (window.__harnessMobileImeSendBridge || typeof document.addEventListener !== 'function') return
    window.__harnessMobileImeSendBridge = true
    let composing = false
    let pendingSendTextarea = null
    const stopPresentation = new WeakMap()
    const composerTextarea = target => target?.matches?.('[data-composer-card] textarea') ? target : null
    const actionLabel = button => `${button?.getAttribute?.('aria-label') || ''} ${button?.title || ''}`.trim()
    const stopAsSend = button => button?.dataset?.harnessMobileStopAsSend === 'true'
    const isStop = button => stopAsSend(button) || /stop generating|停止生成|停止运行/i.test(actionLabel(button))
    const restoreStopPresentation = button => {
      const saved = stopPresentation.get(button)
      if (!saved) return
      if (saved.ariaLabel === null) button.removeAttribute('aria-label')
      else button.setAttribute('aria-label', saved.ariaLabel)
      if (saved.title === null) button.removeAttribute('title')
      else button.setAttribute('title', saved.title)
      delete button.dataset.harnessMobileStopAsSend
      stopPresentation.delete(button)
    }
    const presentStopAsSend = button => {
      if (!button || stopAsSend(button)) return
      stopPresentation.set(button, {
        ariaLabel: button.getAttribute('aria-label'),
        title: button.getAttribute('title')
      })
      const language = typeof navigator === 'object' ? navigator.language || '' : ''
      const sendLabel = /^zh\b/i.test(language) ? '发送消息' : 'Send message'
      button.dataset.harnessMobileStopAsSend = 'true'
      button.setAttribute('aria-label', sendLabel)
      button.setAttribute('title', sendLabel)
    }
    const syncStopIntent = textarea => {
      const card = textarea?.closest?.('[data-composer-card]') || document.querySelector('[data-composer-card]')
      const buttons = [...(card?.querySelectorAll?.('button') || [])]
      const hasDraft = Boolean((textarea?.value || '').trim())
      if (!hasDraft) {
        for (const button of buttons) if (stopAsSend(button)) restoreStopPresentation(button)
        pendingSendTextarea = null
        return null
      }
      const stop = buttons.find(button => isStop(button)) || null
      if (stop) presentStopAsSend(stop)
      return stop
    }
    window.__harnessMobileSyncComposerIntent = textarea => syncStopIntent(
      composerTextarea(textarea) || document.querySelector('[data-composer-card] textarea')
    )
    // Busy conversations deliberately keep Stop mounted while the official
    // textarea's Enter handler owns Queue/Steer policy. A dressed-up Stop can
    // therefore never become a real Send button by waiting for DOM replacement.
    // Route the tap through that exact keyboard contract instead — the same path
    // the user confirmed already works from the Android keyboard.
    const dispatchOfficialEnter = textarea => {
      if (!textarea || !(textarea.value || '').trim()) return false
      if (composing) {
        pendingSendTextarea = textarea
        return false
      }
      pendingSendTextarea = null
      textarea.focus?.({ preventScroll: true })
      const keydown = new KeyboardEvent('keydown', {
        key: 'Enter', code: 'Enter', keyCode: 13, which: 13,
        bubbles: true, cancelable: true, composed: true
      })
      textarea.dispatchEvent(keydown)
      return keydown.defaultPrevented
    }
    document.addEventListener('input', event => {
      const textarea = composerTextarea(event.target)
      if (textarea) syncStopIntent(textarea)
    }, true)
    document.addEventListener('compositionstart', event => {
      const textarea = composerTextarea(event.target)
      if (textarea) {
        composing = true
        syncStopIntent(textarea)
      }
    }, true)
    document.addEventListener('compositionend', event => {
      const textarea = composerTextarea(event.target)
      composing = false
      if (!textarea) return
      syncStopIntent(textarea)
      if (pendingSendTextarea === textarea) setTimeout(() => dispatchOfficialEnter(textarea), 0)
    }, true)
    document.addEventListener('click', event => {
      const button = event.target?.closest?.('[data-composer-card] button')
      const textarea = button?.closest?.('[data-composer-card]')?.querySelector?.('textarea')
      if (!button || !textarea) return
      const stop = syncStopIntent(textarea)
      if (button !== stop || !(textarea.value || '').trim()) return
      event.preventDefault()
      event.stopImmediatePropagation()
      dispatchOfficialEnter(textarea)
    }, true)
    window.__harnessMobileSyncComposerIntent()
  }

  const installComposerLift = () => {
    if (window.__harnessMobileComposerLift || typeof document.addEventListener !== 'function') return
    window.__harnessMobileComposerLift = true
    let largestViewportHeight = Number(window.visualViewport?.height || window.innerHeight || 0)
    let scheduled = false
    const composerTextarea = () => document.querySelector('[data-composer-card] textarea[data-phase]')
    const update = () => {
      scheduled = false
      const viewport = window.visualViewport
      const viewportHeight = Number(viewport?.height || window.innerHeight || 0)
      if (document.activeElement !== composerTextarea()) largestViewportHeight = Math.max(largestViewportHeight, viewportHeight)
      const textarea = composerTextarea()
      const focused = Boolean(textarea && document.activeElement === textarea)
      const viewportCovered = largestViewportHeight > 0 && largestViewportHeight - viewportHeight >= Math.max(120, largestViewportHeight * .18)
      const nativeImeHeight = mobileCapabilities.nativeImeInsets
        ? Math.max(0, Number.parseFloat(root.style.getPropertyValue('--harness-mobile-ime-height')) || 0)
        : 0
      // Some hardware-keyboard/emulator combinations report the IME as visible
      // with a zero inset. Treat that as no occlusion so the composer and its
      // toolbar do not jump into an empty, clipped pseudo-keyboard gap.
      const nativeImeOpen = mobileCapabilities.nativeImeInsets && root.dataset.harnessMobileIme === 'open' && nativeImeHeight >= 80
      const lifted = focused && (nativeImeOpen || viewportCovered)
      root.dataset.harnessMobileComposerLifted = String(lifted)
      const layoutHeight = Number(window.innerHeight || viewportHeight)
      const visualOverlay = viewport ? Math.max(0, Math.round(layoutHeight - viewport.height - viewport.offsetTop)) : 0
      const overlay = lifted ? (viewportCovered ? visualOverlay : nativeImeHeight) : 0
      root.style.setProperty('--harness-mobile-ime-overlay', `${overlay}px`)
      syncMobileComposerTextareaLayout(textarea)
      if (!lifted) return
      const reveal = () => {
        const seat = textarea.closest('[data-composer-seat]') || textarea.closest('[data-harness-mobile-composer-frame="true"]')
        seat?.scrollIntoView?.({ block: 'end', inline: 'nearest', behavior: 'smooth' })
        const scroll = textarea.closest('[data-conversation-scroll]')
        if (scroll) scroll.scrollTop = scroll.scrollHeight
      }
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(reveal)
      else setTimeout(reveal, 16)
    }
    const schedule = () => {
      if (scheduled) return
      scheduled = true
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(update)
      else setTimeout(update, 16)
    }
    document.addEventListener('focusin', schedule, true)
    document.addEventListener('focusout', () => setTimeout(schedule, 80), true)
    window.visualViewport?.addEventListener?.('resize', schedule)
    window.visualViewport?.addEventListener?.('scroll', schedule)
    window.addEventListener?.('resize', schedule)
    window.addEventListener?.('harness-mobile-ime-change', schedule)
    schedule()
  }

  const installHistoryRecovery = () => {
    if (window.__harnessMobileFetchInstalled || typeof window.fetch !== 'function') return
    const nativeFetch = window.fetch.bind(window)
    const cache = new Map()
    const inFlight = new Map()
    const STALE_CACHE_MS = 5 * 60_000
    const MAX_CACHE_ENTRIES = 8
    const MAX_HISTORY_ATTEMPTS = 9
    const EARLY_STALE_ATTEMPT = 2
    const SESSION_HISTORY_RECEIPT_EVENT = 'harness-mobile-session-history-receipt'
    const INDEX_CACHE_VERSION = 1
    const INDEX_CACHE_LEGACY_KEY = 'harness.mobile.authoritative-index.v1'
    const pairingIdentity = (() => {
      try {
        const value = String(window.HarnessMobileCacheIdentity || window.HarnessMobilePairingIdentity || window.HarnessMobileControl?.cacheIdentity?.() || '')
        return /^[a-f0-9]{64}$/.test(value) ? value : ''
      } catch {
        return ''
      }
    })()
    const INDEX_CACHE_KEY = pairingIdentity ? `${INDEX_CACHE_LEGACY_KEY}.${pairingIdentity}` : ''
    const INDEX_CACHE_MAX_AGE_MS = 15 * 60_000
    const INDEX_CACHE_MAX_BYTES = 2 * 1024 * 1024
    const INDEX_CACHE_MAX_ENTRIES = 8
    const INDEX_RECOVERY_ATTEMPTS = 4
    const INDEX_REFRESH_EVENT = 'harness-mobile-index-refresh'
    const indexEntries = new Map()
    const indexTemplates = new Map()
    const indexRefreshes = new Map()
    const indexAuthoritativeReady = new Set()
    const indexPending = new Set()
    window.__harnessMobileFetchInstalled = true

    const readPersistedIndexes = () => {
      try {
        const legacyRaw = window.localStorage?.getItem?.(INDEX_CACHE_LEGACY_KEY)
        if (legacyRaw) {
          try {
            const legacy = JSON.parse(legacyRaw)
            if (INDEX_CACHE_KEY && legacy?.pairingIdentity === pairingIdentity && legacyRaw.length <= INDEX_CACHE_MAX_BYTES) {
              window.localStorage?.setItem?.(INDEX_CACHE_KEY, legacyRaw)
            }
          } catch {}
          window.localStorage?.removeItem?.(INDEX_CACHE_LEGACY_KEY)
        }
        if (!INDEX_CACHE_KEY) return
        const raw = window.localStorage?.getItem?.(INDEX_CACHE_KEY)
        if (!raw || raw.length > INDEX_CACHE_MAX_BYTES) return
        const stored = JSON.parse(raw)
        if (stored?.version !== INDEX_CACHE_VERSION || stored?.pairingIdentity !== pairingIdentity || !Array.isArray(stored.entries)) return
        const now = Date.now()
        for (const entry of stored.entries.slice(-INDEX_CACHE_MAX_ENTRIES)) {
          if (!entry || typeof entry.key !== 'string' || !['workspace', 'session'].includes(entry.kind)) continue
          if (!Number.isFinite(entry.savedAt) || now - entry.savedAt < 0 || now - entry.savedAt > INDEX_CACHE_MAX_AGE_MS) continue
          if (!entry.payload || entry.payload?.result?.ok !== true || !Array.isArray(entry.payload?.result?.value?.items)) continue
          indexEntries.set(entry.key, entry)
        }
      } catch {}
    }
    const persistIndexes = () => {
      if (!INDEX_CACHE_KEY) return
      try {
        const entries = [...indexEntries.values()]
          .sort((left, right) => left.savedAt - right.savedAt)
          .slice(-INDEX_CACHE_MAX_ENTRIES)
        const value = JSON.stringify({ version: INDEX_CACHE_VERSION, pairingIdentity, entries })
        if (value.length <= INDEX_CACHE_MAX_BYTES) window.localStorage?.setItem?.(INDEX_CACHE_KEY, value)
      } catch {}
    }
    const validIndexEntry = entry => {
      const age = Date.now() - Number(entry?.savedAt)
      return entry && age >= 0 && age <= INDEX_CACHE_MAX_AGE_MS && entry.payload?.result?.ok === true && Array.isArray(entry.payload?.result?.value?.items)
    }
    const cachedIndexEntry = key => {
      const entry = indexEntries.get(key)
      if (validIndexEntry(entry)) return entry
      if (entry) {
        indexEntries.delete(key)
        persistIndexes()
      }
      return null
    }
    const indexFingerprint = value => {
      try {
        const text = JSON.stringify(value ?? {})
        return text.length <= 8_192 ? text : ''
      } catch {
        return ''
      }
    }
    const indexRequest = async (input, init) => {
      try {
        const request = typeof Request !== 'undefined' && input instanceof Request
          ? input.clone()
          : new Request(input, init)
        if (request.method.toUpperCase() !== 'POST') return null
        const envelope = JSON.parse(await request.clone().text())
        const url = new URL(request.url, window.location?.href || 'https://mobile.invalid')
        const method = envelope?.method
        const kind = method === 'session/list' && url.pathname === '/api/session/list' && envelope?.payload?.args?._request && Object.keys(envelope.payload.args._request).length === 0
          ? 'session'
          : ''
        const fingerprint = kind ? indexFingerprint(envelope.payload) : ''
        if (!kind || !fingerprint || typeof envelope.rpcId !== 'string' || !envelope.rpcId) return null
        return { kind, key: `${kind}:${fingerprint}`, request, envelope }
      } catch {
        return null
      }
    }
    const readIndexPayload = async (response, rpcId) => {
      if (!response?.ok || !/json/i.test(response.headers?.get?.('content-type') || '')) return null
      try {
        const payload = await response.clone().json()
        if (payload?.rpcId !== rpcId || payload?.result?.ok !== true || !Array.isArray(payload?.result?.value?.items)) return null
        const encoded = JSON.stringify(payload)
        return encoded.length <= INDEX_CACHE_MAX_BYTES ? payload : null
      } catch {
        return null
      }
    }
    const cacheIndexPayload = (descriptor, payload) => {
      const entry = { key: descriptor.key, kind: descriptor.kind, savedAt: Date.now(), payload }
      indexEntries.delete(descriptor.key)
      indexEntries.set(descriptor.key, entry)
      while (indexEntries.size > INDEX_CACHE_MAX_ENTRIES) indexEntries.delete(indexEntries.keys().next().value)
      persistIndexes()
      return entry
    }
    window.__harnessMobileApplyNativeSnapshot = snapshot => {
      if (!pairingIdentity || snapshot?.schemaVersion !== 1
        || !Number.isSafeInteger(snapshot?.snapshotEpoch) || !Number.isSafeInteger(snapshot?.revision)
        || typeof snapshot?.cursor !== 'string' || !Array.isArray(snapshot?.workspaces) || !Array.isArray(snapshot?.sessions)) return false
      const savedAt = Date.now()
      for (const [kind, items] of [['workspace', snapshot.workspaces], ['session', snapshot.sessions]]) {
        const descriptor = { kind, key: `${kind}:{}` }
        cacheIndexPayload(descriptor, {
          type: 'server-response', rpcId: `native-${kind}-${snapshot.revision}`,
          result: { ok: true, value: { items } }
        })
        indexPending.add(descriptor.key)
      }
      root.dataset.harnessMobileIndexRecovery = 'native'
      try {
        window.dispatchEvent?.(new CustomEvent(INDEX_REFRESH_EVENT, {
          detail: Object.freeze({ state: 'cache', source: 'native', authoritative: false, savedAt, revision: snapshot.revision })
        }))
      } catch {}
      return true
    }
    const cachedIndexResponse = (descriptor, entry) => {
      const payload = { ...entry.payload, rpcId: descriptor.envelope.rpcId }
      root.dataset.harnessMobileIndexRecovery = descriptor.kind
      try {
        window.dispatchEvent?.(new CustomEvent(INDEX_REFRESH_EVENT, {
          detail: Object.freeze({ kind: descriptor.kind, state: 'cache', authoritative: false, ageMs: Math.max(0, Date.now() - entry.savedAt) })
        }))
      } catch {}
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'content-type': 'application/json', 'x-harness-mobile-index': 'recovering' }
      })
    }
    const projectsVisible = () => [...indexEntries.values()].some(entry => entry.kind === 'workspace' && validIndexEntry(entry) && entry.payload.result.value.items.length > 0)
    const retryIndexRequest = (descriptor, attempt) => {
      if (attempt === 0) return descriptor.request.clone()
      const rpcId = globalThis.crypto?.randomUUID?.() || `mobile-index-${Date.now()}-${attempt}-${Math.random().toString(36).slice(2)}`
      const envelope = { ...descriptor.envelope, rpcId }
      return new Request(descriptor.request.clone(), { body: JSON.stringify(envelope) })
    }
    const announceIndexAuthority = (descriptor, entry) => {
      indexAuthoritativeReady.add(descriptor.key)
      indexPending.delete(descriptor.key)
      if (!indexPending.size) delete root.dataset.harnessMobileIndexRecovery
      try {
        window.dispatchEvent?.(new CustomEvent(INDEX_REFRESH_EVENT, {
          detail: Object.freeze({ kind: descriptor.kind, state: 'authoritative', authoritative: true, itemCount: entry.payload.result.value.items.length })
        }))
      } catch {}
    }
    const refreshIndex = descriptor => {
      if (indexRefreshes.has(descriptor.key)) return indexRefreshes.get(descriptor.key)
      indexTemplates.set(descriptor.key, descriptor)
      indexPending.add(descriptor.key)
      const previous = cachedIndexEntry(descriptor.key)
      const refresh = (async () => {
        let emptyConfirmations = 0
        let lastResponse = null
        for (let attempt = 0; attempt < INDEX_RECOVERY_ATTEMPTS; attempt++) {
          if (attempt > 0 && (document.visibilityState === 'hidden' || window.navigator?.onLine === false)) break
          try {
            const request = retryIndexRequest(descriptor, attempt)
            const requestEnvelope = JSON.parse(await request.clone().text())
            const response = await nativeFetch(request)
            lastResponse = response
            const payload = await readIndexPayload(response, requestEnvelope.rpcId)
            if (payload) {
              const missingVisibleSessions = descriptor.kind === 'session' && payload.result.value.items.length === 0 && projectsVisible() && previous?.payload?.result?.value?.items?.length > 0
              if (missingVisibleSessions && ++emptyConfirmations < 3 && attempt < INDEX_RECOVERY_ATTEMPTS - 1) {
                await new Promise(resolve => setTimeout(resolve, 150 * (attempt + 1)))
                continue
              }
              const entry = cacheIndexPayload(descriptor, { ...payload, rpcId: descriptor.envelope.rpcId })
              announceIndexAuthority(descriptor, entry)
              return { response, entry }
            }
            if (response.status < 500 || response.status > 504) break
          } catch {
            if (window.navigator?.onLine === false) break
          }
          if (attempt < INDEX_RECOVERY_ATTEMPTS - 1) await new Promise(resolve => setTimeout(resolve, 200 * (attempt + 1)))
        }
        indexPending.add(descriptor.key)
        return { response: lastResponse, entry: null }
      })()
      indexRefreshes.set(descriptor.key, refresh)
      refresh.finally(() => { if (indexRefreshes.get(descriptor.key) === refresh) indexRefreshes.delete(descriptor.key) })
      return refresh
    }
    const retryPendingIndexes = () => {
      if (document.visibilityState === 'hidden' || window.navigator?.onLine === false) return
      for (const key of [...indexPending]) {
        const descriptor = indexTemplates.get(key)
        if (descriptor) refreshIndex(descriptor)
      }
    }
    readPersistedIndexes()
    window.addEventListener?.('online', retryPendingIndexes)
    document.addEventListener?.('visibilitychange', retryPendingIndexes)

    const isHistoryFailure = async response => {
      if (response.status >= 500 && response.status <= 504) return true
      if (!response.ok || !/json/i.test(response.headers.get('content-type') || '')) return false
      try {
        const payload = await response.clone().json()
        const error = payload?.result?.ok === false ? payload.result.error : null
        return error?.code === 'internal' && /abort|aborted|中止|取消/i.test(String(error.message || ''))
      } catch {
        return false
      }
    }

    const normalizePromptTimeZone = async (input, init) => {
      let body = typeof init?.body === 'string' ? init.body : null
      let clonedRequest = null
      if (body === null && typeof Request !== 'undefined' && input instanceof Request) {
        try {
          clonedRequest = input.clone()
          body = await clonedRequest.clone().text()
        } catch {
          return { input, init }
        }
      }
      if (!body) return { input, init }
      try {
        const requestPayload = JSON.parse(body)
        const timeZone = requestPayload?.payload?.clientTimeZone
        if (serverAcceptsTimeZone(timeZone)) return { input, init }
        requestPayload.payload.clientTimeZone = 'UTC'
        const normalizedBody = JSON.stringify(requestPayload)
        if (typeof init?.body === 'string') return { input, init: { ...init, body: normalizedBody } }
        if (clonedRequest) return { input: new Request(clonedRequest, { body: normalizedBody }), init: undefined }
      } catch {}
      return { input, init }
    }
    const requestSignal = (input, init) => init?.signal || (typeof Request !== 'undefined' && input instanceof Request ? input.signal : null)
    const attemptSignal = (callerSignal, timeoutMs) => {
      if (typeof AbortSignal?.timeout !== 'function') return callerSignal || undefined
      const timeout = AbortSignal.timeout(timeoutMs)
      if (!callerSignal || typeof AbortSignal.any !== 'function') return callerSignal || timeout
      return AbortSignal.any([callerSignal, timeout])
    }
    const historyKey = async (input, init) => {
      try {
        const request = typeof Request !== 'undefined' && input instanceof Request
          ? input.clone()
          : new Request(input, init)
        const method = request.method.toUpperCase()
        const body = method === 'GET' || method === 'HEAD' ? '' : await request.clone().text()
        return `${method}:${request.url}:${body}`
      } catch {
        return `${init?.method || 'GET'}:${typeof input === 'string' ? input : input?.url || ''}`
      }
    }
    const validHistorySessionId = value => typeof value === 'string' && value.length > 0 && value.length <= 256 ? value : ''
    const mobileSessionBridge = () => {
      const bridge = window.HarnessMobileControl
      return bridge && typeof bridge.rememberSession === 'function' && typeof bridge.restoreSession === 'function' ? bridge : null
    }
    const rememberMobileSession = sessionId => {
      try { mobileSessionBridge()?.rememberSession(validHistorySessionId(sessionId)) } catch {}
    }
    const restoredMobileSessionId = () => {
      try { return validHistorySessionId(mobileSessionBridge()?.restoreSession()) } catch { return '' }
    }
    let restoreSessionInFlight = ''
    const applyOfficialSessionContext = detail => {
      if (detail?.authoritative !== true || detail?.source !== 'conversation.input.dock') return
      const sessionId = validHistorySessionId(detail.sessionId)
      if (sessionId) {
        window.__harnessMobileCurrentSessionId = sessionId
        window.__harnessMobileCurrentSessionSource = 'conversation.input.dock'
        restoreSessionInFlight = ''
        rememberMobileSession(sessionId)
        return
      }
      const previousSessionId = validHistorySessionId(detail.previousSessionId)
      if (window.__harnessMobileCurrentSessionSource !== 'conversation.input.dock') return
      if (previousSessionId && window.__harnessMobileCurrentSessionId !== previousSessionId) return
      window.__harnessMobileCurrentSessionId = ''
      window.__harnessMobileCurrentSessionSource = ''
      restoreSessionInFlight = ''
      rememberMobileSession('')
    }
    const officialComposerSessionId = () => {
      const card = document.querySelector?.('[data-composer-card]')
      if (!card) return ''
      const candidates = new Set()
      let node = card
      for (let nodeDepth = 0; node && nodeDepth < 10; nodeDepth++, node = node.parentElement) {
        for (const key of Object.getOwnPropertyNames(node)) {
          if (!key.startsWith('__reactFiber$')) continue
          let fiber = node[key]
          for (let fiberDepth = 0; fiber && fiberDepth < 80; fiberDepth++, fiber = fiber.return) {
            const props = fiber.memoizedProps
            const officialRoot = props && typeof props.useSession === 'function' && typeof props.useInput === 'function' && typeof props.renderSlot === 'function' && props.SessionProvider
            const sessionId = officialRoot ? validHistorySessionId(props.sessionId) : ''
            if (sessionId) candidates.add(sessionId)
          }
        }
      }
      return candidates.size === 1 ? [...candidates][0] : ''
    }
    const officialSessionRowId = row => {
      const candidates = new Set()
      for (const key of Object.getOwnPropertyNames(row || {})) {
        if (!key.startsWith('__reactFiber$')) continue
        let fiber = row[key]
        for (let fiberDepth = 0; fiber && fiberDepth < 12; fiberDepth++, fiber = fiber.return) {
          const props = fiber.memoizedProps
          const sessionId = validHistorySessionId(props?.node?.id)
          const officialRow = sessionId && fiber.key === sessionId && typeof props.onOpen === 'function' && typeof props.onRename === 'function' && typeof props.onArchive === 'function'
          if (officialRow) candidates.add(sessionId)
        }
      }
      return candidates.size === 1 ? [...candidates][0] : ''
    }
    const syncOfficialComposerSession = () => {
      if (window.__harnessMobileCurrentSessionSource === 'conversation.input.dock') return
      const sessionId = officialComposerSessionId()
      if (sessionId) {
        window.__harnessMobileCurrentSessionId = sessionId
        window.__harnessMobileCurrentSessionSource = 'conversation.snapshot'
        rememberMobileSession(sessionId)
      } else if (window.__harnessMobileCurrentSessionSource === 'conversation.snapshot') {
        window.__harnessMobileCurrentSessionId = ''
        window.__harnessMobileCurrentSessionSource = ''
        rememberMobileSession('')
      }
    }
    const hasOfficialConversationSession = () => window.__harnessMobileCurrentSessionSource === 'conversation.input.dock' || window.__harnessMobileCurrentSessionSource === 'conversation.snapshot'
    const restoreOfficialSession = () => {
      if (hasOfficialConversationSession()) return false
      const sessionId = restoredMobileSessionId()
      if (!sessionId || restoreSessionInFlight === sessionId) return false
      const matches = [...(document.querySelectorAll?.('[data-harness-mobile-session-row="true"]') || [])].filter(row => officialSessionRowId(row) === sessionId)
      if (matches.length !== 1) return false
      restoreSessionInFlight = sessionId
      matches[0].click()
      return true
    }
    window.addEventListener?.('harness-mobile-session-context', event => applyOfficialSessionContext(event?.detail))
    applyOfficialSessionContext(window.__harnessMobileOfficialSessionContext)
    try {
      const sessionObserver = new MutationObserver(() => {
        syncOfficialComposerSession()
        restoreOfficialSession()
      })
      sessionObserver.observe(document.documentElement, { childList: true, subtree: true })
    } catch {}
    syncOfficialComposerSession()
    restoreOfficialSession()
    const requestHistorySessionId = async (input, init) => {
      try {
        const request = typeof Request !== 'undefined' && input instanceof Request
          ? input.clone()
          : new Request(input, init)
        if (request.method === 'GET' || request.method === 'HEAD') return ''
        const payload = JSON.parse(await request.clone().text())
        return validHistorySessionId(payload?.sessionId || payload?.payload?.sessionId)
      } catch {
        return ''
      }
    }
    const responseHistorySessionId = async response => {
      if (!response.ok || !/json/i.test(response.headers.get('content-type') || '')) return ''
      try {
        const payload = await response.clone().json()
        if (payload?.result?.ok !== true) return ''
        const value = payload.result.value
        return validHistorySessionId(value?.sessionId || value?.session?.sessionId || value?.session?.id)
      } catch {
        return ''
      }
    }
    const acknowledgeFreshSessionHistory = async (response, requestedSessionId) => {
      if (!requestedSessionId || typeof window.dispatchEvent !== 'function' || typeof CustomEvent !== 'function') return
      const loadedSessionId = await responseHistorySessionId(response)
      if (!loadedSessionId || loadedSessionId !== requestedSessionId) return
      if (hasOfficialConversationSession() && window.__harnessMobileCurrentSessionId !== loadedSessionId) return
      if (!hasOfficialConversationSession()) {
        window.__harnessMobileCurrentSessionId = loadedSessionId
        window.__harnessMobileCurrentSessionSource = 'session.history'
      }
      const detail = Object.freeze({ sessionId: loadedSessionId, authoritative: true, latestLoaded: true })
      window.dispatchEvent(new CustomEvent(SESSION_HISTORY_RECEIPT_EVENT, { detail }))
    }
    const cachedResponse = (key, maxAge) => {
      const entry = cache.get(key)
      if (!entry) return null
      const age = Date.now() - entry.savedAt
      if (age > maxAge) {
        if (age > STALE_CACHE_MS) cache.delete(key)
        return null
      }
      cache.delete(key)
      cache.set(key, entry)
      return entry.response.clone()
    }
    const remember = (key, response) => {
      cache.delete(key)
      cache.set(key, { savedAt: Date.now(), response: response.clone() })
      while (cache.size > MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value)
    }

    window.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input?.url || ''
      const isPrompt = /\/api\/session\.prompt(?:[/?#]|$)/i.test(url)
      if (isPrompt) {
        const normalized = await normalizePromptTimeZone(input, init)
        return nativeFetch(normalized.input, normalized.init)
      }
      const descriptor = await indexRequest(input, init)
      if (descriptor) {
        indexTemplates.set(descriptor.key, descriptor)
        const cached = cachedIndexEntry(descriptor.key)
        if (cached && !indexAuthoritativeReady.has(descriptor.key)) {
          refreshIndex(descriptor)
          return cachedIndexResponse(descriptor, cached)
        }
        if (cached && indexAuthoritativeReady.delete(descriptor.key)) {
          return new Response(JSON.stringify({ ...cached.payload, rpcId: descriptor.envelope.rpcId }), {
            status: 200,
            headers: { 'content-type': 'application/json', 'x-harness-mobile-index': 'authoritative' }
          })
        }
        const refreshed = await refreshIndex(descriptor)
        if (refreshed.entry) {
          indexAuthoritativeReady.delete(descriptor.key)
          return new Response(JSON.stringify({ ...refreshed.entry.payload, rpcId: descriptor.envelope.rpcId }), {
            status: 200,
            headers: { 'content-type': 'application/json', 'x-harness-mobile-index': 'authoritative' }
          })
        }
        const fallback = cachedIndexEntry(descriptor.key)
        if (fallback) return cachedIndexResponse(descriptor, fallback)
        if (refreshed.response) return refreshed.response
        throw new Error('项目与会话索引暂时不可用')
      }
      const isSessionHistory = /\/api\/session\.history(?:[/?#]|$)/i.test(url)
      const isSubagentHistory = /\/api\/subagent\.history(?:[/?#]|$)/i.test(url)
      if (!isSessionHistory && !isSubagentHistory) return nativeFetch(input, init)

      const requestedSessionId = isSessionHistory ? await requestHistorySessionId(input, init) : ''
      if (requestedSessionId && requestedSessionId !== window.__harnessMobileCurrentSessionId && !hasOfficialConversationSession()) {
        window.__harnessMobileCurrentSessionId = ''
        window.__harnessMobileCurrentSessionSource = ''
      }
      const key = await historyKey(input, init)
      // Never replay a successful history snapshot merely because it is fresh.
      // Android's system picker backgrounds the WebView; a cached blank baseline
      // can otherwise hide the just-sent user turn while the session is running.
      if (inFlight.has(key)) return (await inFlight.get(key)).clone()

      const callerSignal = requestSignal(input, init)
      const replayInput = typeof Request !== 'undefined' && input instanceof Request ? input.clone() : input
      const request = (async () => {
        let lastError = null
        let lastResponse = null
        let staleFallbackAllowed = false
        for (let attempt = 0; attempt < MAX_HISTORY_ATTEMPTS; attempt++) {
          try {
            const attemptInit = { ...(init || {}), signal: attemptSignal(callerSignal, attempt === 0 ? 8_000 : 12_000) }
            if (attemptInit.signal === undefined) delete attemptInit.signal
            const requestInput = attempt === 0
              ? input
              : typeof Request !== 'undefined' && replayInput instanceof Request
                ? replayInput.clone()
                : replayInput
            const response = await nativeFetch(requestInput, attemptInit)
            lastResponse = response
            if (!await isHistoryFailure(response)) {
              if (isSessionHistory) await acknowledgeFreshSessionHistory(response, requestedSessionId)
              remember(key, response)
              return response
            }
            staleFallbackAllowed = response.status >= 500 && response.status <= 504
            if (staleFallbackAllowed && attempt === EARLY_STALE_ATTEMPT) {
              const stale = cachedResponse(key, STALE_CACHE_MS)
              if (stale) return stale
            }
            if (callerSignal?.aborted || document.visibilityState === 'hidden' || attempt === MAX_HISTORY_ATTEMPTS - 1) break
          } catch (error) {
            lastError = error
            const retryable = /abort|failed|network|timeout/i.test(String(error?.message || error))
            staleFallbackAllowed = retryable && !callerSignal?.aborted && document.visibilityState !== 'hidden'
            if (staleFallbackAllowed && attempt === EARLY_STALE_ATTEMPT) {
              const stale = cachedResponse(key, STALE_CACHE_MS)
              if (stale) return stale
            }
            if (!retryable || callerSignal?.aborted || document.visibilityState === 'hidden' || attempt === MAX_HISTORY_ATTEMPTS - 1) break
          }
          const backoff = Math.min(5_000, 300 * (2 ** attempt)) + Math.round(Math.random() * 120)
          await new Promise(resolve => setTimeout(resolve, backoff))
        }
        const stale = staleFallbackAllowed ? cachedResponse(key, STALE_CACHE_MS) : null
        if (stale) return stale
        if (lastError) throw lastError
        if (lastResponse) return lastResponse
        throw new Error('历史记录重试未能完成')
      })()
      inFlight.set(key, request)
      try { return (await request).clone() }
      finally { if (inFlight.get(key) === request) inFlight.delete(key) }
    }
  }

  const installDocumentUploadBridge = () => {
    if (window.__harnessMobileDocumentUploadInstalled) return
    window.__harnessMobileDocumentUploadInstalled = true
    const MAX_DOCUMENT_BYTES = 50 * 1024 * 1024
    const validSessionId = value => typeof value === 'string' && /^[A-Za-z0-9._:-]{1,256}$/.test(value)
    const validUploadedFile = value => {
      const path = value?.path
      return typeof path === 'string' && path.startsWith('uploads/') && path.length <= 512 && !path.includes('..') && !path.includes('\\') && !path.includes('\0')
    }
    const writeComposerDraft = next => {
      const textarea = document.querySelector('[data-composer-card] textarea[data-phase]')
      if (!textarea || textarea.disabled || textarea.readOnly) return false
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
      if (setter) setter.call(textarea, next)
      else textarea.value = next
      textarea.setSelectionRange?.(next.length, next.length)
      textarea.dispatchEvent(new Event('input', { bubbles: true }))
      textarea.focus?.({ preventScroll: true })
      window.__harnessMobileSyncComposerIntent?.(textarea)
      return true
    }
    const appendDocumentReferences = files => {
      const textarea = document.querySelector('[data-composer-card] textarea[data-phase]')
      if (!textarea || textarea.disabled || textarea.readOnly) return false
      const references = files.map(file => `@${file.path}`).join(' ')
      const current = textarea.value || ''
      const separator = current && !/\s$/u.test(current) ? '\n' : ''
      return writeComposerDraft(`${current}${separator}请查看文件：${references}\n`)
    }
    const renderDocumentPreviews = files => {
      const card = document.querySelector('[data-composer-card]')
      if (!card) return
      let rail = card.querySelector('[data-harness-mobile-document-rail="true"]')
      if (!rail) {
        rail = document.createElement('section')
        rail.dataset.harnessMobileDocumentRail = 'true'
        rail.setAttribute('role', 'group')
        rail.setAttribute('aria-label', '待发送文件')
        const input = card.querySelector('[data-input-scroll]')
        card.insertBefore(rail, input || card.firstChild)
      }
      for (const file of files) {
        if (rail.querySelector(`[data-harness-mobile-document-path="${CSS.escape(file.path)}"]`)) continue
        const chip = document.createElement('article')
        chip.dataset.harnessMobileDocumentPath = file.path
        const copy = document.createElement('span')
        const name = document.createElement('strong')
        name.textContent = file.name || file.path.slice('uploads/'.length)
        const meta = document.createElement('small')
        meta.textContent = `${Math.max(0, Number(file.size) || 0).toLocaleString()} 字节 · 已上传`
        copy.append(name, meta)
        const remove = document.createElement('button')
        remove.type = 'button'
        remove.textContent = '移除预览'
        remove.setAttribute('aria-label', `移除文件预览 ${name.textContent}`)
        remove.addEventListener('click', () => {
          const textarea = document.querySelector('[data-composer-card] textarea[data-phase]')
          if (textarea && !textarea.disabled && !textarea.readOnly) {
            const reference = `@${file.path}`
            const next = String(textarea.value || '').replace(reference, '').replace(/请查看文件：(?=\s*(?:\n|$))/u, '').replace(/[ \t]+\n/gu, '\n').replace(/\n{3,}/gu, '\n\n').replace(/\s+$/u, '')
            writeComposerDraft(next)
          }
          chip.remove()
          if (!rail.childElementCount) rail.remove()
        })
        chip.append(copy, remove)
        rail.appendChild(chip)
      }
    }
    window.__harnessMobileReceiveDocuments = async (selected, reportState) => {
      const files = [...(selected || [])].slice(0, 20)
      const report = typeof reportState === 'function' ? reportState : () => {}
      const sessionId = window.__harnessMobileCurrentSessionId
      if (!validSessionId(sessionId)) {
        report('error', files.length, '会话仍在加载，请稍后重试')
        return false
      }
      if (!files.length) return false
      report('pending', files.length, `正在上传 ${files.length} 个文件…`)
      const uploaded = []
      let failed = 0
      for (const file of files) {
        if (!file || file.size <= 0 || file.size > MAX_DOCUMENT_BYTES) {
          failed++
          continue
        }
        try {
          const response = await fetch(`/__harness_mobile__/documents/upload?sessionId=${encodeURIComponent(sessionId)}&name=${encodeURIComponent(file.name || 'document')}`, {
            method: 'POST',
            credentials: 'same-origin',
            cache: 'no-store',
            headers: {
              'X-Harness-Mobile-Request': 'document-upload',
              'Content-Type': 'application/octet-stream'
            },
            body: file
          })
          if (response.status !== 201) throw new Error(`upload ${response.status}`)
          const payload = await response.json()
          if (payload?.ok !== true || !validUploadedFile(payload.file)) throw new Error('invalid upload response')
          uploaded.push(payload.file)
        } catch (error) {
          console.warn('Harness Mobile document upload failed', error)
          failed++
        }
      }
      if (uploaded.length) {
        renderDocumentPreviews(uploaded)
        if (!appendDocumentReferences(uploaded)) {
          report('error', failed + uploaded.length, '文件已上传，但当前输入框不可用')
          return false
        }
      }
      if (failed) {
        report('error', failed, uploaded.length ? `已添加 ${uploaded.length} 个文件，${failed} 个失败` : '文件没有上传成功，请重试')
        return false
      }
      report('success', uploaded.length, `已添加 ${uploaded.length} 个文件`)
      return uploaded.length === files.length
    }
  }

  const installThemeBridge = () => {
    if (window.__harnessMobileThemeBridgeLoading || window.__HARNESS_DESKTOP_THEME_INSTALLED__) return
    window.__harnessMobileThemeBridgeLoading = true
    fetch('/__harness_mobile__/theme.js', { credentials: 'same-origin' })
      .then(response => {
        if (!response.ok) throw new Error(`theme bridge ${response.status}`)
        return response.text()
      })
      .then(source => (0, eval)(source))
      .catch(() => { window.__harnessMobileThemeBridgeLoading = false })
  }

  const installScreenshotSuggestion = () => {
    if (!mobileCapabilities.screenshotSuggestion) return
    if (window.__harnessMobileScreenshotSuggestion || typeof window.addEventListener !== 'function') return
    window.__harnessMobileScreenshotSuggestion = true
    let dismissTimer = 0
    const photoPicker = () => document.getElementById('harness-mobile-photo-button') || document.getElementById('harness-mobile-photo-input')
    const composerSeat = () => document.querySelector('[data-composer-card]')?.closest?.('[data-composer-seat]') || null
    const anchorAboveComposer = chip => {
      const seat = composerSeat()
      if (!seat) return false
      if (chip.parentElement !== seat || chip !== seat.firstElementChild) seat.insertBefore(chip, seat.firstChild)
      return true
    }
    const dismiss = () => {
      clearTimeout(dismissTimer)
      dismissTimer = 0
      const chip = document.getElementById('harness-mobile-screenshot-suggestion')
      if (!chip) return
      chip.dataset.visible = 'false'
      setTimeout(() => {
        if (chip.dataset.visible === 'false') chip.remove()
      }, 220)
    }
    const show = () => {
      let chip = document.getElementById('harness-mobile-screenshot-suggestion')
      if (!chip) {
        if (!composerSeat()) return
        chip = document.createElement('aside')
        chip.id = 'harness-mobile-screenshot-suggestion'
        chip.dataset.harnessMobileComposerSuggestion = 'true'
        chip.setAttribute('role', 'status')
        chip.setAttribute('aria-live', 'polite')
        chip.setAttribute('aria-label', '刚刚截了图。应用没有读取图片；请从系统照片选择器选择。')
        const copy = document.createElement('div')
        const title = document.createElement('strong')
        title.textContent = '刚刚截了图'
        const note = document.createElement('span')
        note.textContent = '未读取图片，请从系统照片选择器选择'
        copy.append(title, note)
        const add = document.createElement('button')
        add.type = 'button'
        add.dataset.action = 'add'
        add.textContent = '选择'
        add.setAttribute('aria-label', '打开系统照片选择器选择刚刚的截图')
        add.addEventListener('click', () => {
          const photo = photoPicker()
          if (!photo || photo.disabled) return
          dismiss()
          photo.click()
        })
        const close = document.createElement('button')
        close.type = 'button'
        close.dataset.action = 'close'
        close.textContent = '×'
        close.setAttribute('aria-label', '关闭截图提示')
        close.addEventListener('click', dismiss)
        chip.append(copy, add, close)
      }
      if (!anchorAboveComposer(chip)) {
        chip.remove()
        return
      }
      const photo = photoPicker()
      const add = chip.querySelector('button[data-action="add"]')
      if (add) {
        add.disabled = !photo || photo.disabled
        add.setAttribute('aria-disabled', add.disabled ? 'true' : 'false')
      }
      chip.dataset.visible = 'true'
      clearTimeout(dismissTimer)
      dismissTimer = setTimeout(dismiss, 6_000)
    }
    window.addEventListener('harness-mobile-screen-captured', show)
  }

  const shortStableRef = value => {
    const text = String(value || '').trim()
    return text ? `…${text.slice(-8)}` : '未提供'
  }

  const officialAgentSessionId = workbench => {
    const explicit = workbench?.closest?.('.dat-view')?.getAttribute?.('data-harness-mobile-session-id')
      || workbench?.querySelector?.('[data-harness-mobile-session-id]')?.getAttribute?.('data-harness-mobile-session-id')
    if (explicit) return explicit
    try {
      const entries = performance.getEntriesByType('resource')
      for (let index = entries.length - 1; index >= 0; index -= 1) {
        const url = new URL(entries[index].name, location.href)
        if (!/^\/api\/agent-teams\/(?:state|events)$/i.test(url.pathname)) continue
        const sessionId = url.searchParams.get('sessionId')
        if (sessionId) return sessionId
      }
    } catch {}
    return ''
  }

  const boundedContextLabel = (node, fallback) => {
    if (!node) return fallback
    const clone = node.cloneNode(true)
    for (const child of clone.querySelectorAll('button,svg,[data-harness-mobile-session-row="true"],[data-harness-mobile-navigation-chrome="true"]')) child.remove()
    const text = String(clone.textContent || '').replace(/\s+/g, ' ').trim()
    return text ? text.slice(0, 80) : fallback
  }

  const officialSourceContext = () => {
    const rows = [...document.querySelectorAll('[role="treeitem"]')]
    const sessionRow = document.querySelector('[data-harness-mobile-session-row="true"][aria-selected="true"]')
      || rows.find(row => row.dataset.harnessMobileSessionRow === 'true' && row.getAttribute('aria-current') === 'page')
      || null
    let projectRow = sessionRow?.closest?.('[data-harness-mobile-project-row="true"]') || null
    if (!projectRow && sessionRow) {
      for (let index = rows.indexOf(sessionRow) - 1; index >= 0; index -= 1) {
        if (rows[index].dataset?.harnessMobileProjectRow === 'true') {
          projectRow = rows[index]
          break
        }
      }
    }
    return {
      sessionRow,
      projectLabel: boundedContextLabel(projectRow, '未分组'),
      sessionLabel: boundedContextLabel(sessionRow, '当前会话')
    }
  }

  const ensureMobileContextScope = (workbench, sessionId) => {
    let scope = workbench.querySelector(':scope > [data-harness-mobile-context-scope]')
    if (!scope) {
      scope = document.createElement('section')
      scope.dataset.harnessMobileContextScope = 'agent-team'
      scope.innerHTML = '<small>团队来源</small><div><span data-harness-mobile-project-context></span><span data-harness-mobile-session-context></span></div><p>团队属于来源会话，不会因项目名称相同而合并。要查看其他团队，请先回首页选择对应项目中的会话，再进入代理团队。</p><button type="button" data-harness-mobile-switch-context>选择其他项目或会话</button>'
      workbench.insertBefore(scope, workbench.querySelector('.dat-head') || workbench.firstElementChild)
      scope.querySelector('[data-harness-mobile-switch-context]')?.addEventListener('click', () => {
        document.querySelector('[data-harness-mobile-domain="conversations"]')?.click()
        setTimeout(() => {
          setSidebarExpanded(true)
          syncMobileAppShell()
          const source = officialSourceContext().sessionRow
          source?.scrollIntoView?.({ block: 'center' })
          source?.focus?.({ preventScroll: true })
        }, 80)
      })
    }
    const context = officialSourceContext()
    scope.dataset.harnessMobileSourceSessionId = sessionId || ''
    const project = scope.querySelector('[data-harness-mobile-project-context]')
    const session = scope.querySelector('[data-harness-mobile-session-context]')
    if (project) project.textContent = `所属项目 · ${context.projectLabel}`
    if (session) session.textContent = sessionId ? `来源会话 · ${context.sessionLabel}` : '来源会话 · 等待权威标识'
    scope.setAttribute('aria-label', sessionId ? `团队来源，${context.projectLabel}，${context.sessionLabel}，标识 ${shortStableRef(sessionId)}` : '团队来源等待权威会话标识')
    return scope
  }

  const decorateAgentTeamsWorkbench = () => {
    const workbench = document.querySelector?.('.dat-shell')
    if (!workbench) return
    workbench.dataset.harnessMobileAgentWorkbench = 'true'
    const sessionId = officialAgentSessionId(workbench)
    ensureMobileContextScope(workbench, sessionId)
    if (workbench.dataset.harnessMobileTeamNavigationInstalled !== 'true') {
      workbench.dataset.harnessMobileTeamNavigationInstalled = 'true'
      workbench.addEventListener('click', event => {
        if (!event.target?.closest?.('.dat-team-choice')) return
        root.dataset.harnessMobileAgentDetailOpen = 'true'
        setTimeout(decorateAgentTeamsWorkbench, 0)
      })
    }
    const projectForm = workbench.querySelector('.dat-project-tasks-form')
    if (projectForm) {
      projectForm.dataset.harnessMobileProjectTaskForm = 'true'
      let createToggle = projectForm.parentElement?.querySelector(':scope > [data-harness-mobile-project-task-toggle]')
      if (!createToggle) {
        createToggle = document.createElement('button')
        createToggle.type = 'button'
        createToggle.dataset.harnessMobileProjectTaskToggle = 'true'
        projectForm.parentElement?.insertBefore(createToggle, projectForm)
        createToggle.addEventListener('click', () => {
          root.dataset.harnessMobileProjectTaskCreate = root.dataset.harnessMobileProjectTaskCreate === 'true' ? 'false' : 'true'
          decorateAgentTeamsWorkbench()
        })
      }
      if (!root.dataset.harnessMobileProjectTaskCreate) root.dataset.harnessMobileProjectTaskCreate = 'false'
      const creating = root.dataset.harnessMobileProjectTaskCreate === 'true'
      createToggle.textContent = creating ? '取消新建' : '新建项目任务'
      createToggle.setAttribute('aria-expanded', creating ? 'true' : 'false')
    }

    const workspace = workbench.querySelector('.dat-workspace-main')
    const overview = workspace?.querySelector('.dat-overview')
    const detail = workspace?.querySelector('.dat-workspace-view')
    if (!workspace || !overview || !detail) return
    detail.dataset.harnessMobileAgentDetail = 'true'
    let toggle = workspace.querySelector(':scope > [data-harness-mobile-agent-detail-toggle]')
    if (!toggle) {
      toggle = document.createElement('button')
      toggle.type = 'button'
      toggle.dataset.harnessMobileAgentDetailToggle = 'true'
      workspace.insertBefore(toggle, detail)
      toggle.addEventListener('click', () => {
        root.dataset.harnessMobileAgentDetailOpen = root.dataset.harnessMobileAgentDetailOpen === 'true' ? 'false' : 'true'
        decorateAgentTeamsWorkbench()
      })
    }
    if (!root.dataset.harnessMobileAgentDetailOpen) root.dataset.harnessMobileAgentDetailOpen = 'false'
    const open = root.dataset.harnessMobileAgentDetailOpen === 'true'
    toggle.textContent = open ? '收起团队详情' : '查看团队详情'
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false')

  }

  const installControlSettingsEntry = () => {
    if (!mobileCapabilities.controlSettings) return
    if (typeof document.querySelector !== 'function') return
    const dialog = document.querySelector('[role="dialog"][aria-modal="true"]')
    if (!dialog) return
    const general = [...dialog.querySelectorAll('nav button')].find(button => /通用设置|General/i.test(button.textContent || ''))
    if (!general || general.getAttribute('aria-current') !== 'true') return
    const slot = dialog.querySelector('[data-slot="settings.general.item"]')
    const content = dialog.querySelector(':scope > nav + div')
    const options = content?.lastElementChild
    const section = slot?.parentElement || options?.firstElementChild || options
    if (!section || section.querySelector('#harness-mobile-control-row')) return
    const row = document.createElement('div')
    row.id = 'harness-mobile-control-row'
    row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:14px;border-bottom:1px solid var(--dsw-alias-border-l2);padding:16px 0;color:var(--dsw-alias-label-primary)'
    const state = window.HarnessMobileControl?.status?.() || 'disabled'
    row.innerHTML = `<div style="min-width:0"><div style="font-size:14px;line-height:22px">手机控制</div><div style="margin-top:4px;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px">${state === 'ready' ? '已授权并开启，可随时立即停止' : '权限向导、总开关与安全确认'}</div></div><button type="button" style="box-sizing:border-box;flex:none;min-width:48px;min-height:48px;border:0;border-radius:17px;padding:6px 14px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-module-platform);font:inherit;font-size:13px">管理</button>`
    row.querySelector('button').addEventListener('click', () => window.HarnessMobileControl?.openSettings?.())
    section.appendChild(row)
  }

  const decorateDocumentReferences = () => {
    const bridge = window.HarnessMobileControl
    if (!bridge || typeof bridge.openDocument !== 'function') return
    const sessionId = typeof window.__harnessMobileCurrentSessionId === 'string' ? window.__harnessMobileCurrentSessionId : ''
    if (!/^[A-Za-z0-9._:-]{1,256}$/.test(sessionId)) return
    const extensionPattern = /\.(?:docx?|pdf|rtf|odt|xlsx?|csv|pptx?|md|txt|html?)$/i
    const mimeTypes = {
      doc: 'application/msword',
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      pdf: 'application/pdf',
      rtf: 'application/rtf',
      odt: 'application/vnd.oasis.opendocument.text',
      xls: 'application/vnd.ms-excel',
      xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      csv: 'text/csv',
      ppt: 'application/vnd.ms-powerpoint',
      pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      md: 'text/markdown',
      txt: 'text/plain',
      html: 'text/html',
      htm: 'text/html'
    }
    const documentReference = value => {
      let path = String(value || '').trim().replace(/^["'“”‘’]|["'“”‘’]$/g, '')
      if (!path || path.length > 512 || /[\r\n\0]/.test(path)) return null
      path = path.replace(/\\/g, '/')
      const name = path.split('/').filter(Boolean).pop() || ''
      if (!extensionPattern.test(name)) return null
      const relativePath = /^(?:[A-Za-z]:\/|\/)/.test(path) ? name : path
      const extension = name.split('.').pop().toLowerCase()
      return { path: relativePath, name, mimeType: mimeTypes[extension] || 'application/octet-stream' }
    }
    for (const code of document.querySelectorAll('[data-harness-mobile-conversation="true"] code:not([data-harness-mobile-document-reference])')) {
      if (code.closest?.('[data-composer-card],pre')) continue
      const reference = documentReference(code.textContent)
      if (!reference) continue
      code.dataset.harnessMobileDocumentReference = 'true'
      code.tabIndex = 0
      code.setAttribute('role', 'button')
      code.setAttribute('aria-label', `打开文档 ${reference.name}`)
      code.title = `打开文档 ${reference.name}`
      const open = event => {
        if (event.type === 'keydown' && event.key !== 'Enter' && event.key !== ' ') return
        if (event.type === 'click' && String(window.getSelection?.() || '')) return
        event.preventDefault()
        event.stopPropagation()
        const contentUrl = new URL(`/api/desktop-files/content?sessionId=${encodeURIComponent(sessionId)}&path=${encodeURIComponent(reference.path)}`, window.location.href).toString()
        bridge.openDocument(contentUrl, reference.name, reference.mimeType)
      }
      code.addEventListener('click', open)
      code.addEventListener('keydown', open)
    }
  }

  const decorateAccessibilitySemantics = () => {
    const shell = document.getElementById?.('harness-mobile-app-shell') || document.querySelector?.('#harness-mobile-app-shell')
    const appbar = shell?.querySelector?.('[data-harness-mobile-appbar="true"]')
    const heading = shell?.querySelector?.('[data-harness-mobile-heading] strong')
    if (appbar && heading) {
      if (!heading.id) heading.id = 'harness-mobile-current-title'
      heading.setAttribute('role', 'heading')
      heading.setAttribute('aria-level', '1')
      appbar.setAttribute('role', 'banner')
      appbar.setAttribute('aria-labelledby', heading.id)
    }
    const navigation = shell?.querySelector?.('[data-harness-mobile-navigation]')
    if (navigation) navigation.setAttribute('aria-label', '主要导航')

    const sidebar = sidebarNode()
    const tree = sidebar?.querySelector?.('[role="tree"]')
    if (tree) tree.setAttribute('aria-label', '项目与对话列表')
    for (const row of sidebar?.querySelectorAll?.('[data-harness-mobile-session-row="true"]') || []) {
      if (!row.getAttribute('aria-label')) {
        const label = String(row.textContent || '').replace(/\s+/g, ' ').trim()
        if (label) row.setAttribute('aria-label', label)
      }
    }

    const conversation = document.querySelector?.('[data-harness-mobile-conversation="true"]') || null
    const messageRegion = conversation?.querySelector?.('[data-conversation-scroll], [data-conversation-view]')
    if (messageRegion) {
      messageRegion.setAttribute('role', 'log')
      messageRegion.setAttribute('aria-label', '消息')
      messageRegion.setAttribute('aria-live', 'polite')
      messageRegion.setAttribute('aria-relevant', 'additions text')
    }
    const composer = conversation?.querySelector?.('[data-composer-card]')
    if (composer) {
      composer.setAttribute('role', 'region')
      composer.setAttribute('aria-label', '消息编辑器')
    }
    const textarea = composer?.querySelector?.('textarea[data-phase]')
    if (textarea && !textarea.getAttribute('aria-label')) textarea.setAttribute('aria-label', '消息')
    for (const button of composer?.querySelectorAll?.('[data-harness-mobile-composer-action="true"]') || []) {
      const label = accessibleButtonText(button)
      if (/stop generating|停止生成|停止运行/i.test(label)) button.setAttribute('aria-label', '停止生成')
      else if (/send message|发送消息|发送/i.test(label)) button.setAttribute('aria-label', '发送消息')
    }
  }

  const mount = () => {
    dismissOfficialNotice()
    decorateHeader()
    decorateSessions()
    applyMobileConversationFilter()
    decorateConversationHome()
    translateStableLabels()
    decorateAgentTeamsWorkbench()
    decorateDialogs()
    decorateConversation()
    decorateAccessibilitySemantics()
    decorateDocumentReferences()
    containComposerContext()
    if (mobileCapabilities.imeSendBridge) installImeSendBridge()
    installComposerLift()
    installSidebarAutoClose()
    syncMobileAppShell()
    installHistoryRecovery()
    installDocumentUploadBridge()
    installThemeBridge()
    if (mobileCapabilities.screenshotSuggestion) installScreenshotSuggestion()
    if (mobileCapabilities.controlSettings) installControlSettingsEntry()
  }

  mount()
  if (!window.__harnessMobileUiObserver) {
    let scheduled = false
    const scheduleMount = () => {
      if (scheduled || document.visibilityState === 'hidden') return
      scheduled = true
      const run = () => {
        scheduled = false
        mount()
      }
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run)
      else setTimeout(run, 16)
    }
    const structuralSelector = '[data-composer-card],[data-testid="todo-panel"],[data-queue-dock],[data-slot="sidebar"],.dat-shell,[role="dialog"],dialog,[role="menu"],[role="listbox"],header'
    const needsMount = record => {
      const target = record.target?.nodeType === Node.ELEMENT_NODE ? record.target : record.target?.parentElement
      if (target?.closest?.(structuralSelector)) return true
      for (const node of [...record.addedNodes, ...record.removedNodes]) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue
        if (node.matches?.('[data-chat-flow-kind]')) return true
        if (node.matches?.(structuralSelector) || node.querySelector?.(structuralSelector)) return true
      }
      // Streaming tokens and newly appended message text live entirely inside
      // the conversation view. They already inherit CSS and must never trigger
      // a whole-document scan/layout pass for every chunk.
      return !target?.closest?.('[data-conversation-view]')
    }
    window.__harnessMobileUiObserver = new MutationObserver(records => {
      if (records.some(needsMount)) scheduleMount()
    })
    window.__harnessMobileUiObserver.observe(root, { childList: true, subtree: true })
    document.addEventListener?.('visibilitychange', () => {
      if (document.visibilityState === 'visible') scheduleMount()
    })
  }
})()
