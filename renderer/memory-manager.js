(() => {
  const api = window.desktopHarness
  const button = document.querySelector('#memoryQuickButton')
  const overlay = document.querySelector('#memoryOverlay')
  if (!api || !button || !overlay) return

  const closeButton = document.querySelector('#closeMemory')
  const statusTitle = document.querySelector('#memoryStatusTitle')
  const statusDetail = document.querySelector('#memoryStatusDetail')
  const enableToggle = document.querySelector('#memoryEnableToggle')
  const enabledContent = document.querySelector('#memoryEnabledContent')
  const sensitivity = document.querySelector('#memorySensitivity')
  const autoRecall = document.querySelector('#memoryAutoRecall')
  const titleInput = document.querySelector('#memoryTitleInput')
  const contentInput = document.querySelector('#memoryContentInput')
  const tagsInput = document.querySelector('#memoryTagsInput')
  const addButton = document.querySelector('#memoryAdd')
  const searchInput = document.querySelector('#memorySearchInput')
  const searchButton = document.querySelector('#memorySearch')
  const refreshButton = document.querySelector('#memoryRefresh')
  const results = document.querySelector('#memoryResults')
  const exportButton = document.querySelector('#memoryExport')
  const deleteAllConfirm = document.querySelector('#memoryDeleteAllConfirm')
  const deleteExports = document.querySelector('#memoryDeleteExports')
  const deleteAllButton = document.querySelector('#memoryDeleteAll')
  const message = document.querySelector('#memoryMessage')
  let state = null

  function setMessage(text, error = false) {
    message.textContent = text || ''
    message.classList.toggle('is-error', error)
  }

  function renderStatus(next) {
    state = next
    const enabled = next.enabled === true
    statusTitle.textContent = enabled ? `已保存 ${next.counts?.entries || 0} 条本地记忆` : '本地记忆未开启'
    statusDetail.textContent = enabled
      ? `${next.fts5 ? 'FTS5 本地全文搜索' : '本地兼容搜索'} · ${next.secureDelete ? '安全删除已启用' : '安全删除不可用'} · 数据库位于 HarnessData/memory`
      : '开启前不会创建数据库或写入数据。'
    enableToggle.textContent = enabled ? '关闭本地记忆' : '开启本地记忆'
    enabledContent.classList.toggle('hidden', !enabled)
    sensitivity.value = next.preferences?.sensitivityMode === 'redact' ? 'redact' : 'reject'
    autoRecall.checked = next.preferences?.autoRecall === true
    if (!enabled) results.replaceChildren()
  }

  function renderEntries(entries, matchInfo = false) {
    results.replaceChildren()
    if (!entries.length) {
      const empty = document.createElement('p')
      empty.textContent = '没有匹配的本地记忆。'
      results.append(empty)
      return
    }
    for (const entry of entries) {
      const card = document.createElement('article')
      card.className = 'memory-result'
      const header = document.createElement('header')
      const title = document.createElement('strong')
      title.textContent = entry.title || entry.kind || '未命名记忆'
      const remove = document.createElement('button')
      remove.type = 'button'
      remove.textContent = '删除'
      remove.addEventListener('click', async () => {
        remove.disabled = true
        try {
          await api.deleteMemory(entry.id)
          setMessage('已删除该条本地记忆。')
          await loadAll()
        } catch (error) {
          setMessage(error.message || String(error), true)
          remove.disabled = false
        }
      })
      header.append(title, remove)
      const content = document.createElement('p')
      content.textContent = entry.content
      const meta = document.createElement('small')
      const tags = Array.isArray(entry.tags) && entry.tags.length ? ` · ${entry.tags.join('、')}` : ''
      const matched = matchInfo && entry.matched?.length ? ` · 命中：${entry.matched.join('、')}` : ''
      meta.textContent = `${new Date(entry.updatedAt).toLocaleString()}${tags}${matched}`
      card.append(header, content, meta)
      results.append(card)
    }
  }

  async function refreshStatus() {
    renderStatus(await api.getMemoryStatus())
  }

  async function loadAll() {
    if (!state?.enabled) return
    const page = await api.listMemories({ page: 1, pageSize: 100 })
    renderEntries(page.entries)
    await refreshStatus()
  }

  async function open() {
    overlay.classList.remove('hidden')
    overlay.setAttribute('aria-hidden', 'false')
    button.setAttribute('aria-expanded', 'true')
    closeButton.focus()
    deleteAllConfirm.checked = false
    deleteExports.checked = false
    deleteAllButton.disabled = true
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
      setMessage(state.enabled ? '本地记忆已开启。只有你主动保存的内容才会写入。' : '本地记忆已关闭，现有数据库保留但不会读取或写入。')
    } catch (error) {
      setMessage(error.message || String(error), true)
    } finally {
      enableToggle.disabled = false
    }
  }

  async function savePreferences() {
    try {
      renderStatus(await api.setMemoryPreferences({ sensitivityMode: sensitivity.value, autoRecall: autoRecall.checked }))
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
      const response = await api.searchMemories(query, { maxResults: 50 })
      renderEntries(response.hits, true)
      setMessage(`找到 ${response.total} 条；使用${response.source === 'like' ? '本地兼容搜索' : '本地全文搜索'}。`)
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
  addButton.addEventListener('click', addMemory)
  searchButton.addEventListener('click', search)
  searchInput.addEventListener('keydown', event => { if (event.key === 'Enter') search() })
  refreshButton.addEventListener('click', loadAll)
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
    if (event.key === 'Escape' && !overlay.classList.contains('hidden')) close()
  })

  window.harnessDesktopMemoryManager = Object.freeze({ open, close })
})()
