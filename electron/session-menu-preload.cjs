const { contextBridge, ipcRenderer } = require('electron')

// Detached session windows do not need the full guest preload (which also owns
// main-window drag behavior). They do need the same narrowly validated Host
// authorization entry point because Agent Teams settings are reachable there.
const AGENT_TEAMS_AUTOPILOT_SETTING_KEYS = Object.freeze(['enabled', 'maxMembers', 'maxActiveTurns', 'autopilotEnabled', 'autopilotMaxAdditionalRounds'])
const AGENT_TEAMS_AUTOPILOT_SCOPE_KEYS = Object.freeze(['rootSessionId', 'projectKey', 'goalId', 'teamId', 'pauseEpoch', 'teamScopeHash'])
function exactOwnKeys(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}
function safeAgentTeamsAutopilotScope(value) {
  if (!exactOwnKeys(value, AGENT_TEAMS_AUTOPILOT_SCOPE_KEYS)) return null
  for (const key of ['rootSessionId', 'goalId', 'teamId']) if (typeof value[key] !== 'string' || !value[key] || value[key].length > 256 || value[key].trim() !== value[key]) return null
  if (typeof value.projectKey !== 'string' || !/^[a-f0-9]{64}$/u.test(value.projectKey) || typeof value.teamScopeHash !== 'string' || !/^[a-f0-9]{64}$/u.test(value.teamScopeHash)) return null
  if (!Number.isSafeInteger(value.pauseEpoch) || value.pauseEpoch < 0) return null
  return Object.freeze(Object.fromEntries(AGENT_TEAMS_AUTOPILOT_SCOPE_KEYS.map(key => [key, value[key]])))
}
function safeAgentTeamsAutopilotSettings(value) {
  const hasScope = Boolean(value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, 'hostAuthorization'))
  const keys = ['action', 'sessionId', ...AGENT_TEAMS_AUTOPILOT_SETTING_KEYS, ...(hasScope ? ['hostAuthorization'] : [])]
  if (!exactOwnKeys(value, keys) || value.action !== 'settings') return null
  if (typeof value.sessionId !== 'string' || !value.sessionId || value.sessionId.length > 256 || value.sessionId.trim() !== value.sessionId) return null
  if (typeof value.enabled !== 'boolean' || typeof value.autopilotEnabled !== 'boolean') return null
  if (!Number.isSafeInteger(value.maxMembers) || value.maxMembers < 1 || value.maxMembers > 8) return null
  if (!Number.isSafeInteger(value.maxActiveTurns) || value.maxActiveTurns < 1 || value.maxActiveTurns > 8) return null
  if (!Number.isSafeInteger(value.autopilotMaxAdditionalRounds) || value.autopilotMaxAdditionalRounds < 1 || value.autopilotMaxAdditionalRounds > 200) return null
  const scope = hasScope ? safeAgentTeamsAutopilotScope(value.hostAuthorization) : null
  if (hasScope && scope === null || scope !== null && scope.rootSessionId !== value.sessionId) return null
  return Object.freeze({ action: 'settings', sessionId: value.sessionId, ...Object.fromEntries(AGENT_TEAMS_AUTOPILOT_SETTING_KEYS.map(key => [key, value[key]])), ...(scope === null ? {} : { hostAuthorization: scope }) })
}
async function authorizeAgentTeamsAutopilotSettings(value) {
  if (globalThis.navigator?.userActivation?.isActive !== true) throw new Error('请直接点击“保存设置”以授权本次自动接力设置。')
  const request = safeAgentTeamsAutopilotSettings(value)
  if (!request) throw new Error('代理团队自动接力设置无效。')
  return ipcRenderer.invoke('agentTeams:authorizeAutopilotSettings', request)
}
function safeSessionMenuIds(value) {
  const ids = []
  const seen = new Set()
  for (const candidate of Array.isArray(value) ? value : []) {
    if (typeof candidate !== 'string' || !candidate || candidate.length > 256 || candidate.trim() !== candidate || seen.has(candidate)) continue
    seen.add(candidate)
    ids.push(candidate)
    if (ids.length >= 1000) break
  }
  return Object.freeze(ids)
}

function safeSessionMenuState(value) {
  return Object.freeze({
    pinned: safeSessionMenuIds(value?.pinned),
    unread: safeSessionMenuIds(value?.unread)
  })
}

function safeSessionMenuFlag(value) {
  const sessionId = typeof value?.sessionId === 'string' ? value.sessionId : ''
  const flag = value?.flag === 'pinned' || value?.flag === 'unread' ? value.flag : ''
  if (!sessionId || sessionId.length > 256 || sessionId.trim() !== sessionId || !flag || typeof value?.enabled !== 'boolean') return null
  return Object.freeze({ sessionId, flag, enabled: value.enabled })
}

async function syncSessionMenuState(value) {
  return safeSessionMenuState(await ipcRenderer.invoke('sessionMenu:sync', safeSessionMenuState(value)))
}

async function setSessionMenuFlag(value) {
  const request = safeSessionMenuFlag(value)
  if (!request) return null
  return safeSessionMenuState(await ipcRenderer.invoke('sessionMenu:setFlag', request))
}

contextBridge.exposeInMainWorld('harnessDesktopGuest', Object.freeze({
  syncSessionMenuState,
  setSessionMenuFlag,
  authorizeAgentTeamsAutopilotSettings
}))
