const test = require('node:test')
const assert = require('node:assert/strict')

const {
  DECISIONS,
  MAX_TARGET_LENGTH,
  isLocalhost,
  routeBrowserLink,
  sanitizeTarget
} = require('../electron/bridge/browser-link-router.cjs')

function route(target, overrides = {}) {
  return routeBrowserLink({
    target,
    source: 'user',
    intent: 'navigation',
    userChoice: 'default',
    ...overrides
  })
}

test('decision matrix keeps ordinary HTTPS documents, search, repositories and model links isolated', () => {
  const matrix = [
    ['https://example.com/guide', 'user', 'document', 'document-isolated'],
    ['https://www.google.com/search?q=harness', 'user', 'search', 'search-isolated'],
    ['https://github.com/deepseek-ai', 'app', 'repository', 'repository-isolated'],
    ['https://docs.example.com/model', 'model', 'navigation', 'model-navigation-isolated']
  ]
  for (const [target, source, intent, reason] of matrix) {
    assert.deepEqual(route(target, { source, intent }), {
      target,
      decision: DECISIONS.EMBEDDED,
      reason
    })
  }
})

test('OAuth, GCM, SSO, downloads and installers always use the system browser', () => {
  for (const intent of ['oauth', 'gcm', 'sso', 'download', 'installer']) {
    const answer = route('https://accounts.example.com/continue', {
      intent,
      userChoice: 'embedded'
    })
    assert.equal(answer.decision, DECISIONS.SYSTEM)
    assert.equal(answer.reason, `${intent}-requires-system`)
  }
  const inferredInstaller = route('https://releases.example.com/Harness%20Setup.MSIX?channel=stable')
  assert.equal(inferredInstaller.decision, DECISIONS.SYSTEM)
  assert.equal(inferredInstaller.reason, 'installer-target-requires-system')
})

test('explicit system-browser selection overrides normal routing but not safety checks', () => {
  assert.deepEqual(route('https://example.com/docs', { userChoice: 'system' }), {
    target: 'https://example.com/docs',
    decision: DECISIONS.SYSTEM,
    reason: 'user-selected-system-browser'
  })
  assert.deepEqual(route('javascript:alert(1)', { userChoice: 'system' }), {
    target: null,
    decision: DECISIONS.REJECT,
    reason: 'dangerous-protocol'
  })
})

test('allowlisted external application protocols require explicit external-app intent', () => {
  for (const target of [
    'mailto:team@example.com?subject=Hello',
    'tel:+12025550123',
    'vscode://file/C:/project/readme.md',
    'github-desktop://openRepo/https://github.com/acme/project'
  ]) {
    const answer = route(target, { intent: 'external-app' })
    assert.equal(answer.decision, DECISIONS.SYSTEM, target)
    assert.equal(answer.reason, 'external-application-protocol')
  }
  assert.equal(route('vscode://file/C:/secret').reason, 'external-protocol-intent-required')
  assert.equal(route('unknown-helper://open/x', { intent: 'external-app' }).reason, 'unsupported-protocol')
})

test('localhost is embedded only with explicit user approval or a development context', () => {
  for (const target of ['http://localhost:3000/app', 'http://127.0.0.1:5173/', 'http://[::1]:8080/']) {
    assert.equal(route(target).decision, DECISIONS.SYSTEM, target)
    assert.equal(route(target, { source: 'model' }).decision, DECISIONS.SYSTEM, target)
    assert.equal(route(target, { userChoice: 'embedded' }).decision, DECISIONS.EMBEDDED, target)
    assert.equal(route(target, { source: 'developer', intent: 'development' }).decision, DECISIONS.EMBEDDED, target)
  }
  assert.equal(route('http://dev.localhost:3000/', { source: 'developer' }).decision, DECISIONS.EMBEDDED)
  assert.equal(isLocalhost('localhost'), true)
  assert.equal(isLocalhost('[::1]'), true)
  assert.equal(isLocalhost('example.com'), false)
})

test('credential URLs and dangerous protocols are rejected with no target', () => {
  const matrix = [
    ['https://user:password@example.com/private', 'credential-url'],
    ['http://token@example.com/', 'credential-url'],
    ['javascript:alert(1)', 'dangerous-protocol'],
    ['data:text/html,<h1>owned</h1>', 'dangerous-protocol'],
    ['file:///C:/secret.txt', 'dangerous-protocol'],
    ['chrome://settings', 'dangerous-protocol'],
    ['devtools://devtools/bundled/inspector.html', 'dangerous-protocol'],
    ['blob:https://example.com/id', 'dangerous-protocol'],
    ['ws://example.com/socket', 'dangerous-protocol']
  ]
  for (const [target, reason] of matrix) {
    assert.deepEqual(route(target, { intent: 'external-app', userChoice: 'system' }), {
      target: null,
      decision: DECISIONS.REJECT,
      reason
    })
  }
})

test('target sanitization uses WHATWG canonical form and rejects malformed or excessive input', () => {
  assert.deepEqual(sanitizeTarget('HTTPS://EXAMPLE.COM:443/a/../docs?q=1#top'), {
    target: 'https://example.com/docs?q=1#top',
    protocol: 'https:',
    hostname: 'example.com',
    external: false
  })
  for (const [target, reason] of [
    ['', 'invalid-target'],
    ['not a URL', 'malformed-target'],
    ['https://exa\nmple.com', 'malformed-target'],
    ['https://example.com/%ZZ', 'malformed-target'],
    [`https://example.com/${'x'.repeat(MAX_TARGET_LENGTH)}`, 'target-too-long']
  ]) {
    assert.equal(route(target).reason, reason)
    assert.equal(route(target).target, null)
  }
})

test('routing requires the complete structured source, intent and userChoice context', () => {
  for (const input of [
    null,
    'https://example.com',
    { target: 'https://example.com', intent: 'navigation', userChoice: 'default' },
    { target: 'https://example.com', source: 'model', userChoice: 'default' },
    { target: 'https://example.com', source: 'model', intent: 'navigation' },
    { target: 'https://example.com', source: 'unknown', intent: 'navigation', userChoice: 'default' },
    { target: 'https://example.com', source: 'user', intent: 'navigation', userChoice: 'maybe' }
  ]) {
    assert.equal(routeBrowserLink(input).decision, DECISIONS.REJECT)
    assert.equal(routeBrowserLink(input).target, null)
  }
})
