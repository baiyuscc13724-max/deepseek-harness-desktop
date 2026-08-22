(() => {
  const api = window.desktopHarness
  const button = document.querySelector('#memoryQuickButton')
  const overlay = document.querySelector('#memoryOverlay')
  if (!api || !button || !overlay) return

  // ---- UI ↔ 后端契约（Schema v2，向后兼容；后端见 electron/bridge/memory-service.cjs）----
  // 条目可选字段（v1 无这些字段时为 undefined，界面一律回退默认值）：
  //   status       生命周期：candidate | active | stale | superseded | conflict | archived
  //                缺省视为 active；读取端兼容 lifecycle / lifecycleStatus / state 别名。
  //   scopeType    作用域类型：personal | project | team | task（别名 scope）
  //   scopeRef     作用域引用
  //   sourceType   来源类型：manual | session | goal | task | file | import
  //   sourceRef    来源引用；v1 的 sourceSessionId 仍作为来源显示。
  //   revision     修订版本，正整数；缺省 1。
  //   verifiedAt   验证时间；expiresAt 过期时间；pinned 置顶；supersedesId 关联条目。
  // 写入统一走 api.updateMemory(id, patch)：
  //   生命周期变更 → { status: 'active' | 'archived' }（批准候选 / 停用归档 / 重新启用；
  //                   stale/superseded/conflict 由后端置位）
  //   never recall → { recallPolicy: 'never' | 'auto' }（v1 已原生支持）
  //   编辑纠错     → { title, content, tags }
  // listMemories / searchMemories 过滤选项：{ status, scopeType }（v1 忽略未知键是安全的；
  //   本页同时在客户端对整页结果做过滤兜底，保证 v1 下筛选仍正确）。
  // status().counts 可选扩展：candidates/active/stale…；缺省回退 entries。
  // 保持默认私有（拒绝敏感内容、记忆库显式开启）、安全删除与可访问性不变。

  const MEMORY_STATUS = Object.freeze({
    CANDIDATE: 'candidate',
    ACTIVE: 'active',
    STALE: 'stale',
    SUPERSEDED: 'superseded',
    CONFLICT: 'conflict',
    ARCHIVED: 'archived'
  })
  const MEMORY_STATUS_VALUES = new Set(Object.values(MEMORY_STATUS))
  const STATUS_LABELS = Object.freeze({
    candidate: '待批准候选',
    active: '有效',
    stale: '已过期',
    superseded: '已替代',
    conflict: '冲突',
    archived: '已停用'
  })
  const STATUS_MESSAGES = Object.freeze({
    active: '该记忆已重新启用并参与自动召回。',
    archived: '已停用（归档）该记忆；不再参与自动召回。',
    stale: '该记忆已标记为过期。',
    superseded: '该记忆已标记为替代。',
    conflict: '该记忆已标记为冲突。'
  })
  const SCOPE_LABELS = Object.freeze({
    personal: '个人',
    project: '项目',
    team: '团队',
    task: '任务'
  })
  const SOURCE_LABELS = Object.freeze({
    manual: '手动',
    session: '会话',
    goal: '目标',
    task: '任务',
    file: '文件',
    import: '导入'
  })
  const STATUS_PATCH_KEY = 'status'
  const MAX_PAGE_SIZE = 200
  const MAX_LOAD_ENTRIES = 1000 // v1 默认 maxEntries=1000，分页遍历上界

  const closeButton = document.querySelector('#closeMemory')
  const statusTitle = document.querySelector('#memoryStatusTitle')
  const statusDetail = document.querySelector('#memoryStatusDetail')
  const enableToggle = document.querySelector('#memoryEnableToggle')
  const enabledContent = document.querySelector('#memoryEnabledContent')
  const sensitivity = document.querySelector('#memorySensitivity')
  const autoRecall = document.querySelector('#memoryAutoRecall')
  const autoCapture = document.querySelector('#memoryAutoCapture')
  const titleInput = document.querySelector('#memoryTitleInput')
  const contentInput = document.querySelector('#memoryContentInput')
  const tagsInput = document.querySelector('#memoryTagsInput')
  const addButton = document.querySelector('#memoryAdd')
  const searchInput = document.querySelector('#memorySearchInput')
  const searchButton = document.querySelector('#memorySearch')
  const refreshButton = document.querySelector('#memoryRefresh')
  const stateFilter = document.querySelector('#memoryStateFilter')
  const scopeFilter = document.querySelector('#memoryScopeFilter')
  const results = document.querySelector('#memoryResults')
  const exportButton = document.querySelector('#memoryExport')
  const deleteAllConfirm = document.querySelector('#memoryDeleteAllConfirm')
  const deleteExports = document.querySelector('#memoryDeleteExports')
  const deleteAllButton = document.querySelector('#memoryDeleteAll')
  const message = document.querySelector('#memoryMessage')
  let state = null
  let activeStatus = 'all'
  let activeScope = 'all'
  const cardEntries = new WeakMap()

  function setMessage(text, error = false) {
    message.textContent = text || ''
    message.classList.toggle('is-error', error)
  }

  function formatTime(value) {
    if (!value) return '—'
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString()
  }

  /** 向后兼容读取生命周期字段；v1 条目（无字段）一律视为 active。 */
  function statusOf(entry) {
    const value = entry.status ?? entry.lifecycle ?? entry.lifecycleStatus ?? entry.state
    return MEMORY_STATUS_VALUES.has(value) ? value : MEMORY_STATUS.ACTIVE
  }

  function scopeTypeOf(entry) {
    const value = entry.scopeType ?? entry.scope
    return typeof value === 'string' && value.trim() ? value.trim() : null
  }

  function scopeLabelOf(entry) {
    const type = scopeTypeOf(entry)
    if (!type) return null
    const label = SCOPE_LABELS[type] || type
    const ref = typeof entry.scopeRef === 'string' && entry.scopeRef.trim() ? entry.scopeRef.trim() : ''
    return ref ? `${label}（${ref}）` : label
  }

  function sourceOf(entry) {
    const type = entry.sourceType
    const ref = typeof entry.sourceRef === 'string' && entry.sourceRef.trim() ? entry.sourceRef.trim() : null
    const session = typeof entry.sourceSessionId === 'string' && entry.sourceSessionId.trim() ? entry.sourceSessionId.trim() : null
    if (type && SOURCE_LABELS[type]) return [SOURCE_LABELS[type], ref || session].filter(Boolean).join(' ')
    return ref || session || '本机'
  }

  function revisionOf(entry) {
    const value = Number(entry.revision)
    return Number.isInteger(value) && value > 0 ? value : 1
  }

  function renderStatus(next) {
    state = next
    const enabled = next.enabled === true
    const counts = next.counts || {}
    const perState = [
      ['candidates', '候选'],
      ['active', '有效'],
      ['stale', '过期'],
      ['superseded', '替代'],
      ['conflict', '冲突'],
      ['archived', '停用']
    ].filter(([key]) => Number(counts[key]) > 0)
    statusTitle.textContent = enabled
      ? perState.length
        ? `已保存 ${counts.entries ?? 0} 条本地记忆（${perState.map(([key, label]) => `${label} ${counts[key]}`).join(' · ')}）`
        : `已保存 ${counts.entries ?? 0} 条本地记忆`
      : '本地记忆未开启'
    let detail = `${next.fts5 ? 'FTS5 本地全文搜索' : '本地兼容搜索'} · ${next.secureDelete ? '安全删除已启用' : '安全删除不可用'} · 数据库位于 HarnessData/memory`
    if (enabled && Number(counts.candidates ?? 0) > 0) {
      detail += `。有 ${counts.candidates} 条候选记忆等待审核，批准后才会参与自动召回`
    }
    statusDetail.textContent = enabled ? detail : '已停用；数据库会保留但不会读取或写入，可在下方全部删除。'
    enableToggle.textContent = enabled ? '关闭本地记忆' : '开启本地记忆'
    enabledContent.classList.toggle('hidden', !enabled)
    sensitivity.value = (next.preferences?.sensitivityMode ?? next.limits?.sensitivityMode ?? 'reject') === 'redact' ? 'redact' : 'reject'
    autoRecall.checked = next.preferences?.autoRecall === true
    autoCapture.checked = next.preferences?.autoCapture === true
    if (!enabled) results.replaceChildren()
  }

  function actionButton(container, label, variant, onClick) {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.dataset.action = variant
    btn.textContent = label
    btn.addEventListener('click', async () => {
      btn.disabled = true
      try {
        await onClick()
      } catch (error) {
        setMessage(error.message || String(error), true)
        btn.disabled = false
      }
    })
    container.append(btn)
    return btn
  }

  function renderEntryCard(entry, matchInfo = false) {
    const status = statusOf(entry)
    const card = document.createElement('article')
    card.className = `memory-result is-${status}`
    card.dataset.memoryId = entry.id
    cardEntries.set(card, entry)

    const header = document.createElement('header')
    const titleWrap = document.createElement('div')
    titleWrap.className = 'memory-result-title'
    const title = document.createElement('strong')
    title.textContent = entry.title || entry.kind || '未命名记忆'
    titleWrap.append(title)
    const badge = document.createElement('span')
    badge.className = `memory-badge is-${status}`
    badge.textContent = STATUS_LABELS[status] || status
    titleWrap.append(badge)
    if (entry.recallPolicy === 'never') {
      const never = document.createElement('span')
      never.className = 'memory-badge is-never'
      never.textContent = '永不召回'
      titleWrap.append(never)
    }
    if (entry.pinned === true) {
      const pinned = document.createElement('span')
      pinned.className = 'memory-badge is-pinned'
      pinned.textContent = '置顶'
      titleWrap.append(pinned)
    }
    const actions = document.createElement('div')
    actions.className = 'memory-result-actions'
    if (status === MEMORY_STATUS.CANDIDATE) {
      actionButton(actions, '批准候选', 'approve', () => setStatus(entry.id, status, MEMORY_STATUS.ACTIVE))
    } else if (status === MEMORY_STATUS.ACTIVE) {
      actionButton(actions, '停用', 'disable', () => setStatus(entry.id, status, MEMORY_STATUS.ARCHIVED))
    } else if (status === MEMORY_STATUS.STALE || status === MEMORY_STATUS.SUPERSEDED || status === MEMORY_STATUS.CONFLICT || status === MEMORY_STATUS.ARCHIVED) {
      actionButton(actions, '重新启用', 'reuse', () => setStatus(entry.id, status, MEMORY_STATUS.ACTIVE))
    }
    if (entry.recallPolicy === 'never') {
      actionButton(actions, '恢复召回', 'recall', () => setRecallPolicy(entry.id, 'auto'))
    } else {
      actionButton(actions, '不再召回', 'recall', () => setRecallPolicy(entry.id, 'never'))
    }
    actionButton(actions, '编辑', 'edit', () => startEdit(card, entry))
    actionButton(actions, '删除', 'danger', () => removeEntry(entry.id))
    header.append(titleWrap, actions)

    const content = document.createElement('p')
    content.className = 'memory-result-content'
    content.textContent = entry.content

    const meta = document.createElement('small')
    const parts = [`更新于 ${formatTime(entry.updatedAt)}`, `来源 ${sourceOf(entry)}`, `v${revisionOf(entry)}`]
    const scope = scopeLabelOf(entry)
    if (scope) parts.push(`作用域 ${scope}`)
    parts.push(entry.verifiedAt ? `验证于 ${formatTime(entry.verifiedAt)}` : '未验证')
    if (entry.expiresAt) parts.push(`过期于 ${formatTime(entry.expiresAt)}`)
    if (entry.supersedesId) parts.push(`关联 ${entry.supersedesId}`)
    const tags = Array.isArray(entry.tags) && entry.tags.length ? ` · ${entry.tags.join('、')}` : ''
    const matched = matchInfo && entry.matched?.length ? ` · 命中：${entry.matched.join('、')}` : ''
    meta.textContent = `${parts.join(' · ')}${tags}${matched}`
    card.append(header, content, meta)
    return card
  }

  function renderEntries(entries, matchInfo = false) {
    results.replaceChildren()
    if (!entries.length) {
      const empty = document.createElement('p')
      empty.textContent = matchInfo ? '没有匹配的本地记忆。' : '没有符合条件的本地记忆。'
      results.append(empty)
      return
    }
    for (const entry of entries) results.append(renderEntryCard(entry, matchInfo))
  }

  function startEdit(card, entry) {
    if (card.querySelector('.memory-edit-form')) return
    const form = document.createElement('form')
    form.className = 'memory-edit-form'
    form.setAttribute('aria-label', '编辑记忆纠错')
    const titleInputEl = document.createElement('input')
    titleInputEl.type = 'text'
    titleInputEl.maxLength = 200
    titleInputEl.placeholder = '标题（可选）'
    titleInputEl.value = entry.title || ''
    const contentArea = document.createElement('textarea')
    contentArea.maxLength = 20000
    contentArea.rows = 4
    contentArea.placeholder = '记忆内容'
    contentArea.value = entry.content
    const tagsField = document.createElement('input')
    tagsField.type = 'text'
    tagsField.maxLength = 300
    tagsField.placeholder = '标签，用逗号分隔'
    tagsField.value = Array.isArray(entry.tags) ? entry.tags.join('、') : ''
    const row = document.createElement('div')
    const saveBtn = document.createElement('button')
    saveBtn.type = 'submit'
    saveBtn.className = 'primary'
    saveBtn.textContent = '保存'
    const cancelBtn = document.createElement('button')
    cancelBtn.type = 'button'
    cancelBtn.textContent = '取消'
    row.append(saveBtn, cancelBtn)
    form.append(titleInputEl, contentArea, tagsField, row)
    form.addEventListener('submit', async event => {
      event.preventDefault()
      const nextTitle = titleInputEl.value.trim()
      const nextContent = contentArea.value.trim()
      if (!nextContent) return setMessage('记忆内容不能为空。', true)
      saveBtn.disabled = true
      try {
        await api.updateMemory(entry.id, {
          title: nextTitle,
          content: nextContent,
          tags: tagsField.value.split(/[,，]/u).map(value => value.trim()).filter(Boolean)
        })
        setMessage('已保存纠错后的记忆。')
        await loadAll()
      } catch (error) {
        setMessage(error.code === 'HIGH_RISK_REJECTED' ? '检测到密码、令牌、Cookie、银行卡或验证码，已拒绝保存。' : (error.message || String(error)), true)
        saveBtn.disabled = false
      }
    })
    cancelBtn.addEventListener('click', () => cancelEdit(card))
    const contentEl = card.querySelector('.memory-result-content')
    contentEl.replaceWith(form)
    titleInputEl.focus()
  }

  function cancelEdit(card) {
    const entry = cardEntries.get(card)
    if (!entry) return
    card.replaceWith(renderEntryCard(entry, false))
  }

  async function setStatus(id, from, target) {
    const result = await api.updateMemory(id, { [STATUS_PATCH_KEY]: target })
    const applied = statusOf(result) === target
    setMessage(applied
      ? (from === MEMORY_STATUS.CANDIDATE && target === MEMORY_STATUS.ACTIVE
          ? '已批准候选记忆；现在正常参与自动召回。'
          : (STATUS_MESSAGES[target] || `已更新为「${STATUS_LABELS[target]}」。`))
      : `已请求${STATUS_LABELS[target]}；当前记忆服务尚未支持该状态字段，升级后生效。`)
    await loadAll()
  }

  async function setRecallPolicy(id, policy) {
    await api.updateMemory(id, { recallPolicy: policy })
    setMessage(policy === 'never' ? '已设为永不召回；该记忆不会出现在自动召回结果中。' : '已恢复自动召回。')
    await loadAll()
  }

  async function removeEntry(id) {
    await api.deleteMemory(id)
    setMessage('已删除该条本地记忆。')
    await loadAll()
  }

  /** 分页遍历全部条目（上限 MAX_LOAD_ENTRIES），并把 status/scopeType 过滤选项传给后端供 v2 服务端过滤。 */
  async function fetchAllEntries() {
    const collected = []
    const options = { page: 1, pageSize: MAX_PAGE_SIZE }
    if (activeStatus !== 'all') options.status = activeStatus
    if (activeScope !== 'all') options.scopeType = activeScope
    let page = 1
    for (;;) {
      const response = await api.listMemories({ ...options, page })
      const entries = Array.isArray(response.entries) ? response.entries : []
      collected.push(...entries)
      const total = Math.max(collected.length, Number(response.total ?? 0))
      const pages = Number(response.pages ?? Math.ceil(total / MAX_PAGE_SIZE))
      if (!entries.length || collected.length >= total || collected.length >= MAX_LOAD_ENTRIES || page >= pages) break
      page += 1
    }
    return collected
  }

  /** 客户端过滤兜底：v1 后端忽略 status/scopeType 键，此处保证筛选在任意版本下都生效。 */
  function filterEntries(entries) {
    let out = entries
    if (activeStatus !== 'all') out = out.filter(entry => statusOf(entry) === activeStatus)
    if (activeScope !== 'all') out = out.filter(entry => scopeTypeOf(entry) === activeScope)
    return out
  }

  function populateScopeOptions(entries) {
    const scopes = new Set()
    for (const entry of entries) {
      const scope = scopeTypeOf(entry)
      if (scope) scopes.add(scope)
    }
    const values = [...scopes].sort((a, b) => a.localeCompare(b))
    const current = scopeFilter.value
    scopeFilter.replaceChildren()
    const all = document.createElement('option')
    all.value = 'all'
    all.textContent = '全部作用域'
    scopeFilter.append(all)
    for (const value of values) {
      const option = document.createElement('option')
      option.value = value
      option.textContent = SCOPE_LABELS[value] || value
      scopeFilter.append(option)
    }
    scopeFilter.value = values.includes(current) ? current : 'all'
    if (scopeFilter.value !== current) activeScope = scopeFilter.value
  }

  async function refreshStatus() {
    renderStatus(await api.getMemoryStatus())
  }

  async function loadAll() {
    if (!state?.enabled) return
    try {
      const entries = await fetchAllEntries()
      if (activeScope === 'all') populateScopeOptions(entries)
      renderEntries(filterEntries(entries))
      await refreshStatus()
    } catch (error) {
      setMessage(error.message || String(error), true)
    }
  }

  async function open() {
    overlay.classList.remove('hidden')
    overlay.setAttribute('aria-hidden', 'false')
    button.setAttribute('aria-expanded', 'true')
    closeButton.focus()
    deleteAllConfirm.checked = false
    deleteExports.checked = false
    deleteAllButton.disabled = true
    stateFilter.value = 'all'
    scopeFilter.value = 'all'
    activeStatus = 'all'
    activeScope = 'all'
    setMessage('')
    try {
      await refreshStatus()
      if (state.enabled) await loadAll()
    } catch (error) {
      setMessage(error.message || String(error), true)
    }
  }

  function close() {
    overlay.classList.add('hidden')
    overlay.setAttribute('aria-hidden', 'true')
    button.setAttribute('aria-expanded', 'false')
    button.focus()
  }

  async function toggleEnabled() {
    enableToggle.disabled = true
    setMessage(state?.enabled ? '正在关闭本地记忆…' : '正在创建本地记忆数据库…')
    try {
      renderStatus(await api.setMemoryEnabled(!state?.enabled))
      if (state.enabled) await loadAll()
      setMessage(state.enabled ? '本地记忆已开启；后台仅保存稳定偏好与项目约束，敏感内容会拒绝或脱敏。' : '本地记忆已关闭，现有数据库保留但不会读取或写入。')
    } catch (error) {
      setMessage(error.message || String(error), true)
    } finally {
      enableToggle.disabled = false
    }
  }

  async function savePreferences() {
    try {
      renderStatus(await api.setMemoryPreferences({ sensitivityMode: sensitivity.value, autoRecall: autoRecall.checked, autoCapture: autoCapture.checked }))
      setMessage('记忆隐私偏好已保存。')
    } catch (error) {
      setMessage(error.message || String(error), true)
    }
  }

  async function addMemory() {
    const content = contentInput.value.trim()
    if (!content) return setMessage('请输入要保存的记忆内容。', true)
    addButton.disabled = true
    try {
      await api.addMemory({
        kind: 'preference',
        title: titleInput.value.trim(),
        content,
        tags: tagsInput.value.split(/[,，]/u).map(value => value.trim()).filter(Boolean),
        sensitivity: 0,
        recallPolicy: 'auto'
      })
      titleInput.value = ''
      contentInput.value = ''
      tagsInput.value = ''
      await loadAll()
      setMessage('已保存到本地记忆。')
    } catch (error) {
      setMessage(error.code === 'HIGH_RISK_REJECTED' ? '检测到密码、令牌、Cookie、银行卡或验证码，已拒绝保存。' : (error.message || String(error)), true)
    } finally {
      addButton.disabled = false
    }
  }

  async function search() {
    const query = searchInput.value.trim()
    if (!query) return loadAll()
    searchButton.disabled = true
    try {
      const options = { maxResults: 50 }
      if (activeStatus !== 'all') options.status = activeStatus
      if (activeScope !== 'all') options.scopeType = activeScope
      const response = await api.searchMemories(query, options)
      const hits = filterEntries(Array.isArray(response.hits) ? response.hits : [])
      renderEntries(hits, true)
      setMessage(`找到 ${hits.length} 条；使用${response.source === 'like' ? '本地兼容搜索' : '本地全文搜索'}。`)
    } catch (error) {
      setMessage(error.message || String(error), true)
    } finally {
      searchButton.disabled = false
    }
  }

  button.addEventListener('click', open)
  closeButton.addEventListener('click', close)
  overlay.addEventListener('click', event => { if (event.target === overlay) close() })
  enableToggle.addEventListener('click', toggleEnabled)
  sensitivity.addEventListener('change', savePreferences)
  autoRecall.addEventListener('change', savePreferences)
  autoCapture.addEventListener('change', savePreferences)
  addButton.addEventListener('click', addMemory)
  searchButton.addEventListener('click', search)
  searchInput.addEventListener('keydown', event => { if (event.key === 'Enter') search() })
  refreshButton.addEventListener('click', loadAll)
  stateFilter.addEventListener('change', () => {
    activeStatus = stateFilter.value
    loadAll()
  })
  scopeFilter.addEventListener('change', () => {
    activeScope = scopeFilter.value
    loadAll()
  })
  exportButton.addEventListener('click', async () => {
    exportButton.disabled = true
    try {
      const exported = await api.exportMemories()
      setMessage(`已导出 ${exported.count} 条记忆到 HarnessData/memory-exports。`)
    } catch (error) { setMessage(error.message || String(error), true) }
    finally { exportButton.disabled = false }
  })
  deleteAllConfirm.addEventListener('change', () => { deleteAllButton.disabled = !deleteAllConfirm.checked })
  deleteAllButton.addEventListener('click', async () => {
    if (!deleteAllConfirm.checked) return
    deleteAllButton.disabled = true
    try {
      const response = await api.deleteAllMemories({ confirmed: true, deleteExports: deleteExports.checked })
      deleteAllConfirm.checked = false
      deleteExports.checked = false
      await loadAll()
      setMessage(`已安全擦除 ${response.deleted} 条本地记忆并清空审计元数据；删除 ${response.deletedExports || 0} 个导出副本。`)
    } catch (error) {
      setMessage(error.message || String(error), true)
      deleteAllButton.disabled = !deleteAllConfirm.checked
    }
  })
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || overlay.classList.contains('hidden')) return
    const activeEdit = results.querySelector('.memory-edit-form')
    if (activeEdit) {
      const card = activeEdit.closest('.memory-result')
      if (card) cancelEdit(card)
      return
    }
    close()
  })
  api.onOpenDataManager?.(target => {
    if (target === 'memory') open()
  })

  window.harnessDesktopMemoryManager = Object.freeze({ open, close })
})()