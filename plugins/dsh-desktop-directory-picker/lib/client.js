window.__ModuleLoader__.load({
  id: 'dsh-desktop-directory-picker',
  factory: require => {
    const module = { exports: {} }
    const exports = module.exports
    const React = require('react')
    const BRIDGE_KEY = '__HARNESS_DESKTOP_DIRECTORY_PICKER__'

    function pickerBridge() {
      if (window[BRIDGE_KEY]) return window[BRIDGE_KEY]
      const pending = new Map()
      const bridge = {
        pending,
        request() {
          const id = crypto.randomUUID()
          const api = window.harnessDesktopGuest
          if (!api || typeof api.chooseWorkspaceDirectory !== 'function') {
            return Promise.reject(new Error('Harness Desktop 工作区选择窗口不可用。'))
          }
          const promise = new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
              pending.delete(id)
              reject(new Error('工作区选择窗口等待超时，请重试。'))
            }, 180000)
            pending.set(id, { resolve, reject, timer })
          })
          api.chooseWorkspaceDirectory().then(
            value => bridge.settle(id, value, ''),
            error => bridge.settle(id, null, error?.message || String(error))
          )
          return promise
        },
        settle(id, value, error) {
          const entry = pending.get(String(id || ''))
          if (!entry) return false
          pending.delete(String(id))
          clearTimeout(entry.timer)
          if (error) entry.reject(new Error(String(error)))
          else entry.resolve(value == null ? null : String(value))
          return true
        }
      }
      Object.defineProperty(window, BRIDGE_KEY, { value: bridge, configurable: false, enumerable: false, writable: false })
      return bridge
    }

    function DesktopDirectoryFlow(props) {
      const armed = React.useRef(false)
      const outcome = React.useRef(props)
      outcome.current = props
      const alive = React.useRef(true)
      React.useEffect(() => {
        alive.current = true
        return () => { alive.current = false }
      }, [])
      React.useEffect(() => {
        if (!props.open) {
          armed.current = false
          return
        }
        if (armed.current) return
        armed.current = true
        pickerBridge().request().then(selectedPath => {
          if (!alive.current) return
          if (selectedPath === null) outcome.current.onCancel()
          else outcome.current.onPicked(selectedPath)
        }, error => {
          if (alive.current) outcome.current.onError(error instanceof Error ? error.message : String(error))
        })
      }, [props.open])
      return null
    }

    const name = 'desktop-directory-picker'
    const inject = ['slots']
    function apply(ctx) {
      ctx.slots.inject('conversation.hero.workspace.directoryFlow', () => ctx.slots.inject('sidebar.workspaces.directoryFlow', function* () {
        yield ctx.slots.register({
          name: 'conversation.hero.workspace.directoryFlow',
          id: 'harness-desktop-native-picker',
          priority: -100
        }, DesktopDirectoryFlow)
        yield ctx.slots.register({
          name: 'sidebar.workspaces.directoryFlow',
          id: 'harness-desktop-native-picker',
          priority: -100
        }, DesktopDirectoryFlow)
      }))
    }

    exports.apply = apply
    exports.inject = inject
    exports.name = name
    return module.exports
  }
})
