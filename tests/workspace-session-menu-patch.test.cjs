const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const root = path.resolve(__dirname, '..')

async function sessionMenuPatch() {
  return import(pathToFileURL(path.join(root, 'scripts/workspace-session-menu-patch.mjs')).href)
}

function installedPatchFixture() {
  return [
    'let react = require("react");',
    '\t\tconst HD_SESSION_MENU_STATE_KEY = "harness.desktop.session-menu.v1";',
    '\t\tfunction oldSessionMenuImplementation() {}',
    '\t\t//#endregion',
    '\t\tfunction renderCollapsedGroup(group) {',
    '\t\t\treturn sessionMenuOrder(expandedSessionGroups.includes(group.key) ? group.sessions : group.sessions.slice(0, COLLAPSED_SESSION_LIMIT)).map((node) => {',
    '\t\t\t\treturn node;',
    '\t\t\t});',
    '\t\t}',
    '\t\tif (typeof document !== "undefined") {',
    '\t\t\tconst sessionMenuStyle = document.createElement("style");',
    '\t\t\tsessionMenuStyle.textContent = ".old{}";',
    '\t\t}',
    ''
  ].join('\n')
}

test('collapsed session groups order every row before limiting while expanded groups retain every row', async () => {
  const { patchWorkspaceSessionMenuSource } = await sessionMenuPatch()
  const first = patchWorkspaceSessionMenuSource(installedPatchFixture())

  assert.equal(first.changed, true)
  assert.match(first.source, /sessionMenuGroupRows\(group\.sessions, expandedSessionGroups\.includes\(group\.key\), COLLAPSED_SESSION_LIMIT\)\.map/u)
  assert.doesNotMatch(first.source, /sessionMenuOrder\(expandedSessionGroups\.includes\(group\.key\) \? group\.sessions : group\.sessions\.slice/u)

  const helperStart = first.source.indexOf('\t\tlet hdSessionMenuDesktopState')
  const helperEnd = first.source.indexOf('\t\tfunction desktopSessionMenuNavigate', helperStart)
  assert.ok(helperStart >= 0 && helperEnd > helperStart, 'patched session ordering helpers should be present')
  const helperSource = first.source.slice(helperStart, helperEnd)
  const localStorage = {
    getItem: () => JSON.stringify({ pinned: ['old-pinned'], unread: [] }),
    setItem: () => {}
  }
  const { sessionMenuGroupRows } = new Function(
    'localStorage',
    'react',
    'CustomEvent',
    'window',
    `const HD_SESSION_MENU_STATE_KEY = "harness.desktop.session-menu.v1";\nconst HD_SESSION_MENU_EVENT = "harness-desktop-session-menu-change";\n${helperSource}\nreturn { sessionMenuGroupRows };`
  )(localStorage, {}, class {}, {})

  const original = [
    ...Array.from({ length: 10 }, (_, index) => ({ id: `new-${index}` })),
    { id: 'old-pinned' }
  ]
  const collapsed = sessionMenuGroupRows(original, false, 5)
  assert.deepEqual(collapsed.map(row => row.id), ['old-pinned', 'new-0', 'new-1', 'new-2', 'new-3'])
  assert.equal(collapsed.length, 5)

  const expanded = sessionMenuGroupRows(original, true, 5)
  assert.deepEqual(expanded.map(row => row.id), ['old-pinned', ...original.slice(0, -1).map(row => row.id)])
  assert.equal(expanded.length, original.length)
  assert.equal(original.at(-1).id, 'old-pinned', 'ordering must not mutate the source group')

  const second = patchWorkspaceSessionMenuSource(first.source)
  assert.equal(second.changed, false)
  assert.equal(second.source, first.source)
})

test('desktop session-menu bridge restores pins after the renderer origin changes', async () => {
  const { patchWorkspaceSessionMenuSource } = await sessionMenuPatch()
  const patched = patchWorkspaceSessionMenuSource(installedPatchFixture()).source
  const helperStart = patched.indexOf('\t\tlet hdSessionMenuDesktopState')
  const helperEnd = patched.indexOf('\t\tfunction desktopSessionMenuNavigate', helperStart)
  const helperSource = patched.slice(helperStart, helperEnd)
  assert.ok(helperStart >= 0 && helperEnd > helperStart)

  const createStorage = () => {
    const values = new Map()
    return {
      getItem: key => values.has(key) ? values.get(key) : null,
      setItem: (key, value) => values.set(key, String(value))
    }
  }
  let initialized = false
  let desktopState = { pinned: [], unread: [] }
  const copyState = () => ({ pinned: [...desktopState.pinned], unread: [...desktopState.unread] })
  const bridge = {
    async syncSessionMenuState(localState) {
      if (!initialized) {
        desktopState = { pinned: [...localState.pinned], unread: [...localState.unread] }
        initialized = true
      }
      return copyState()
    },
    async setSessionMenuFlag({ sessionId, flag, enabled }) {
      desktopState[flag] = enabled
        ? [sessionId, ...desktopState[flag].filter(id => id !== sessionId)]
        : desktopState[flag].filter(id => id !== sessionId)
      return copyState()
    }
  }
  function compileHelpers(localStorage) {
    const window = {
      harnessDesktopGuest: bridge,
      dispatchEvent: () => true,
      addEventListener: () => {},
      removeEventListener: () => {}
    }
    return new Function(
      'localStorage',
      'react',
      'CustomEvent',
      'window',
      `const HD_SESSION_MENU_STATE_KEY = "harness.desktop.session-menu.v1";\nconst HD_SESSION_MENU_EVENT = "harness-desktop-session-menu-change";\n${helperSource}\nreturn { readSessionMenuState, syncDesktopSessionMenuState, setSessionMenuFlag, sessionMenuGroupRows };`
    )(localStorage, {}, class {}, window)
  }

  const firstOriginStorage = createStorage()
  const firstOrigin = compileHelpers(firstOriginStorage)
  await firstOrigin.syncDesktopSessionMenuState()
  firstOrigin.setSessionMenuFlag('survives-restart', 'pinned', true)
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(desktopState.pinned, ['survives-restart'])

  const secondOriginStorage = createStorage()
  const secondOrigin = compileHelpers(secondOriginStorage)
  assert.deepEqual(secondOrigin.readSessionMenuState().pinned, [], 'a different runtime port starts with empty origin-local storage')
  await secondOrigin.syncDesktopSessionMenuState()
  assert.deepEqual(secondOrigin.readSessionMenuState().pinned, ['survives-restart'])
  const ordered = secondOrigin.sessionMenuGroupRows([{ id: 'other' }, { id: 'survives-restart' }], true, 5)
  assert.deepEqual(ordered.map(row => row.id), ['survives-restart', 'other'])
})
