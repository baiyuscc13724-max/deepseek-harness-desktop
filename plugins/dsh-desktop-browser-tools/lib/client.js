window.__ModuleLoader__.load({
  id: 'dsh-desktop-browser-tools',
  factory: (require) => {
    const module = { exports: {} }

    // Codex 风格输入入口：@ 应用候选 / $ 技能候选。
    // inputTriggers（dsh-client-ui-input-trigger）目前只硬编码检测 '/' 与 '@'；
    // '$' 检测与服务端手势补丁由 Harness Desktop 宿主侧另行处理，本插件只注册 source。
    // @ onPick 保留 "@name "，$ onPick 保留 "$name "，从不自动发送。
    const APPS = [
      { name: 'browser', description: 'Web browsing, forms and content extraction' },
      { name: 'computer-use', description: 'Unlimited desktop window control' },
      { name: 'default-templates', description: 'Default templates for documents, spreadsheets and presentations' },
      { name: 'deep-research', description: 'Multi-phase web research with citations' },
      { name: 'plugin-management', description: 'Install, enable and configure plugins' },
      { name: 'documents', description: 'Create and edit rich documents' },
      { name: 'pdf', description: 'Read, create and verify PDF files' },
      { name: 'spreadsheets', description: 'Create and edit spreadsheets' },
      { name: 'presentations', description: 'Create and edit slide decks' },
      { name: 'template-creator', description: 'Create reusable templates from reference content' },
      { name: 'sites', description: 'Build and publish websites' },
      { name: 'visualize', description: 'Render data as charts and interactive HTML' }
    ]
    const STATIC_SKILLS = [
      { name: 'default-templates', description: 'Start from a default template pack' },
      { name: 'deep-research', description: 'Multi-phase web research with citations' },
      { name: 'template-creator', description: 'Author reusable templates' }
    ]

    function apply(ctx) {
      const inputTriggers = ctx.get('inputTriggers')
      const skillsApi = ctx.remote.skills
      const fetches = new Map()
      const lexiconListeners = new Map()
      const notifyLexicon = (sessionId) => {
        for (const listener of [...(lexiconListeners.get(sessionId) || [])]) {
          try { listener() } catch (error) { console.error('[desktop-browser-tools] lexicon listener failed:', error) }
        }
      }
      // 按会话缓存已安装技能清单；settled 后通知 lexicon 订阅者（官方 ui-skill 同款）。
      const fetchCatalog = (sessionId) => {
        const existing = fetches.get(sessionId)
        if (existing) return existing.promise
        const abort = new AbortController()
        const promise = (async () => {
          const result = await skillsApi.list({ sessionId }, abort.signal)
          if (!result.ok) throw new Error(`skill.list failed: ${result.error.code}: ${result.error.message}`)
          return result.value.skills
        })()
        const entry = { promise, abort }
        fetches.set(sessionId, entry)
        promise.then((skills) => {
          entry.settled = skills
          notifyLexicon(sessionId)
        }, () => {
          if (fetches.get(sessionId) === entry) fetches.delete(sessionId)
        })
        return promise
      }
      const invalidate = (key) => {
        const entry = fetches.get(key)
        if (!entry) return
        fetches.delete(key)
        entry.abort.abort()
        notifyLexicon(key)
      }
      const clearAll = () => {
        for (const key of [...fetches.keys()]) invalidate(key)
      }

      // @ 应用候选：静态清单，本地能力 + OpenAI 插件风格应用。
      const appsSource = {
        trigger: '@',
        name: 'apps',
        order: 1,
        candidates(session, { query }) {
          return APPS.filter((app) => app.name.startsWith(query)).map((app) => ({ name: app.name, description: app.description }))
        },
        lexicon() {
          return APPS.map((app) => app.name)
        },
        onPick({ candidate }) {
          return { text: `@${candidate.name} ` }
        }
      }

      // $ 技能候选：静态技能 + 已安装技能（remote.skills），去重合并。
      const skillsSource = {
        trigger: '$',
        name: 'skills',
        order: 1,
        async candidates(session, { query, signal }) {
          let dynamic = []
          try { dynamic = await fetchCatalog(session.sessionId) } catch { dynamic = [] }
          if (signal.aborted) return []
          const descriptions = new Map(dynamic.map((skill) => [skill.name, skill.description]))
          const names = [...new Set([...STATIC_SKILLS.map((skill) => skill.name), ...descriptions.keys()])]
          return names.filter((name) => name.startsWith(query)).map((name) => ({
            name,
            description: descriptions.get(name) || STATIC_SKILLS.find((skill) => skill.name === name)?.description
          }))
        },
        warm(session) {
          fetchCatalog(session.sessionId).catch(() => {})
        },
        lexicon(session) {
          const settled = fetches.get(session.sessionId)?.settled
          return [...STATIC_SKILLS.map((skill) => skill.name), ...(settled ? settled.map((skill) => skill.name) : [])]
        },
        subscribeLexicon(session, listener) {
          const key = session.sessionId
          const listeners = lexiconListeners.get(key) || new Set()
          listeners.add(listener)
          lexiconListeners.set(key, listeners)
          return () => {
            listeners.delete(listener)
            if (listeners.size === 0) lexiconListeners.delete(key)
          }
        },
        onPick({ candidate }) {
          return { text: `$${candidate.name} ` }
        }
      }

      ctx.effect(() => {
        const unregisterApps = inputTriggers.registerSource(appsSource)
        const unregisterSkills = inputTriggers.registerSource(skillsSource)
        return () => {
          unregisterApps()
          unregisterSkills()
          clearAll()
        }
      }, 'desktop-browser-tools: @ apps and $ skills input sources')

      ctx.remote.$on('agent-preset/selected', invalidate)
      ctx.on('connection/reset', clearAll)
    }

    module.exports = { apply, inject: ['inputTriggers', 'remote', 'remote.skills'] }
    return module.exports
  }
})
