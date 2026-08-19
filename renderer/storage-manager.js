(() => {
  const api = window.desktopHarness
  const button = document.querySelector('#storageQuickButton')
  const overlay = document.querySelector('#storageOverlay')
  if (!api || !button || !overlay) return

  const closeButton = document.querySelector('#closeStorage')
  const refreshButton = document.querySelector('#refreshStorage')
  const total = document.querySelector('#storageTotal')
  const rootLabel = document.querySelector('#storageRootLabel')
  const categories = document.querySelector('#storageCategories')
  const oldRuntimes = document.querySelector('#storageOldRuntimes')
  const caches = document.querySelector('#storageCaches')
  const oldTemp = document.querySelector('#storageOldTemp')
  const tempDays = document.querySelector('#storageTempDays')
  const previewButton = document.querySelector('#previewStorageCleanup')
  const previewPanel = document.querySelector('#storagePreview')
  const previewSummary = document.querySelector('#storagePreviewSummary')
  const previewList = document.querySelector('#storagePreviewList')
  const confirm = document.querySelector('#storageConfirm')
  const applyButton = document.querySelector('#applyStorageCleanup')
  const message = document.querySelector('#storageMessage')

  const categoryLabels = Object.freeze({
    runtime: '运行时',
    'dsh-home': 'Harness 数据',
    temp: '临时文件',
    workspace: '工作区'
  })
  let scanState = null
  let activePreview = null

  function formatBytes(value) {
    const bytes = Number(value) || 0
    if (bytes < 1024) return `${bytes} B`
    const units = ['KiB', 'MiB', 'GiB', 'TiB']
    let size = bytes / 1024
    let unit = units[0]
    for (let index = 1; index < units.length && size >= 1024; index += 1) {
      size /= 1024
      unit = units[index]
    }
    return `${size.toFixed(size >= 100 ? 0 : size >= 10 ? 1 : 2)} ${unit}`
  }

  function setMessage(text, error = false) {
    message.textContent = text || ''
    message.classList.toggle('is-error', error)
  }

  function resetPreview() {
    activePreview = null
    confirm.checked = false
    applyButton.disabled = true
    previewPanel.classList.add('hidden')
    previewList.replaceChildren()
  }

  function renderScan(report, status = {}) {
    scanState = report
    const list = Object.entries(report.categories || {})
    const bytes = list.reduce((sum, [, category]) => sum + (Number(category.size) || 0), 0)
    total.textContent = formatBytes(bytes)
    const automatic = status.automaticCache
    const lastRun = automatic?.lastRun
    rootLabel.textContent = automatic?.enabled
      ? `HarnessData 本地数据 · 应用缓存自动维护${lastRun?.ok ? ` · 上次释放 ${formatBytes(lastRun.freedBytes)}` : ''} · 受保护数据永不自动清理`
      : 'HarnessData 本地数据 · 受保护数据不会自动清理'
    categories.replaceChildren(...list.map(([kind, category]) => {
      const card = document.createElement('div')
      card.className = 'storage-category'
      const name = document.createElement('strong')
      name.textContent = categoryLabels[kind] || kind
      const size = document.createElement('span')
      size.textContent = category.exists ? formatBytes(category.size) : '尚未创建'
      const count = document.createElement('span')
      count.textContent = category.exists ? `${category.entryCount || 0} 个顶层项目` : '0 个项目'
      card.append(name, size, count)
      return card
    }))
  }

  async function scan() {
    refreshButton.disabled = true
    total.textContent = '正在扫描…'
    setMessage('扫描只读取目录大小，不会修改任何数据。')
    try {
      const [report, status] = await Promise.all([api.scanStorage(), api.getStorageStatus()])
      renderScan(report, status)
      setMessage('扫描完成；只有超过 7 天的应用自有缓存会后台维护，其他删除仍需预览和确认。')
    } catch (error) {
      setMessage(error.message || String(error), true)
      total.textContent = '扫描失败'
    } finally {
      refreshButton.disabled = false
    }
  }

  function selectedTempEntries() {
    if (!oldTemp.checked || !scanState) return []
    const ageMs = Number(tempDays.value) * 24 * 60 * 60 * 1000
    return (scanState.categories?.temp?.entries || [])
      .filter(entry => !entry.suspicious && Number(entry.ageMs) >= ageMs)
      .map(entry => entry.name)
  }

  function renderPreview(plan) {
    activePreview = plan
    previewPanel.classList.remove('hidden')
    previewSummary.textContent = `${plan.summary.candidates} 项 · ${formatBytes(plan.summary.freedBytes)}`
    previewList.replaceChildren(...plan.deletions.map(item => {
      const row = document.createElement('li')
      const label = document.createElement('span')
      label.textContent = item.kind === 'runtime-old' ? `旧运行时：${item.name}` : item.kind === 'cache' ? `缓存：${item.name}` : `临时项：${item.name}`
      const size = document.createElement('strong')
      size.textContent = formatBytes(item.size)
      row.append(label, size)
      return row
    }))
    if (plan.deletions.length === 0) {
      const empty = document.createElement('li')
      empty.textContent = '当前选择范围内没有可安全清理的项目。'
      previewList.append(empty)
    }
    confirm.checked = false
    confirm.disabled = plan.deletions.length === 0
    applyButton.disabled = true
  }

  async function previewCleanup() {
    previewButton.disabled = true
    resetPreview()
    setMessage('正在生成只读清理预览…')
    try {
      const plan = await api.previewStorageCleanup({
        includeOldRuntimes: oldRuntimes.checked,
        includeCaches: caches.checked,
        tempAgeDays: Number(tempDays.value),
        tempEntries: selectedTempEntries()
      })
      renderPreview(plan)
      setMessage('请逐项检查预览；只有勾选确认后才会执行。')
    } catch (error) {
      setMessage(error.message || String(error), true)
    } finally {
      previewButton.disabled = false
    }
  }

  async function applyCleanup() {
    if (!activePreview || !confirm.checked) return
    applyButton.disabled = true
    confirm.disabled = true
    setMessage('正在执行已确认的清理计划…')
    try {
      const result = await api.applyStorageCleanup({ previewId: activePreview.previewId, confirmed: true })
      const applied = (result.applied || []).filter(item => item.applied).length
      resetPreview()
      await scan()
      setMessage(`清理完成：${applied} 项，预计释放 ${formatBytes(result.summary.freedBytes)}。`)
    } catch (error) {
      setMessage(error.message || String(error), true)
      confirm.disabled = false
      applyButton.disabled = !confirm.checked
    }
  }

  function open() {
    overlay.classList.remove('hidden')
    overlay.setAttribute('aria-hidden', 'false')
    button.setAttribute('aria-expanded', 'true')
    resetPreview()
    closeButton.focus()
    scan()
  }

  function close() {
    overlay.classList.add('hidden')
    overlay.setAttribute('aria-hidden', 'true')
    button.setAttribute('aria-expanded', 'false')
    resetPreview()
    button.focus()
  }

  button.addEventListener('click', open)
  closeButton.addEventListener('click', close)
  refreshButton.addEventListener('click', () => { resetPreview(); scan() })
  previewButton.addEventListener('click', previewCleanup)
  confirm.addEventListener('change', () => { applyButton.disabled = !activePreview || !confirm.checked })
  applyButton.addEventListener('click', applyCleanup)
  overlay.addEventListener('click', event => { if (event.target === overlay) close() })
  for (const control of [oldRuntimes, caches, oldTemp, tempDays]) control.addEventListener('change', resetPreview)
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !overlay.classList.contains('hidden')) close()
  })
  api.onOpenDataManager?.(target => {
    if (target === 'storage') open()
  })

  window.harnessDesktopStorageManager = Object.freeze({ formatBytes, open, close })
})()
