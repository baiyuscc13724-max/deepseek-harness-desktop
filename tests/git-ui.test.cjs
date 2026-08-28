const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { readFile } = require('node:fs/promises')

const root = path.resolve(__dirname, '..')
const source = file => readFile(path.join(root, file), 'utf8')

test('desktop Git status UI is wired through fixed IPC methods', async () => {
  const [renderer, preload, main] = await Promise.all([
    source('renderer/app.js'), source('electron/preload.cjs'), source('electron/main.cjs')
  ])
  for (const marker of ['Git 与仓库连接', '显示 Git 详情', '内置 MinGit', 'Git Credential Manager', 'Windows ssh-agent', '安装内置 Git', '连接 GitHub', 'Harness 不读取或显示密码、Token、Cookie、验证码或 SSH 私钥']) {
    assert.ok(renderer.includes(marker), `missing Git status UI marker: ${marker}`)
  }
  for (const api of ['getGitRuntimeStatus', 'refreshGitRuntimeStatus', 'prepareGitRuntime', 'openGitAuthentication']) assert.ok(preload.includes(api), `preload missing ${api}`)
  for (const channel of ['gitRuntime:status', 'gitRuntime:refresh', 'gitRuntime:prepare', 'gitRuntime:authenticate']) {
    assert.ok(preload.includes(channel), `preload missing ${channel}`)
    assert.ok(main.includes(channel), `main missing ${channel}`)
  }
  assert.match(main, /gitRuntime:authenticate[\s\S]{0,180}assertDesktopShellSender\(event\)/u)
  assert.ok(renderer.includes("'authenticate-github'"))
  assert.ok(renderer.includes("'prepare-git-runtime'"))
  assert.ok(renderer.includes("api.openGitAuthentication('github')"))
  assert.match(renderer, /target\.hostname === 'authenticate-github'\) \{\s*if \(gitRuntimeState\.authenticating\) return/u)
  assert.match(renderer, /等待浏览器授权/u)
  assert.match(renderer, /GCM 拉起默认浏览器，并通过短期本机回调完成登录/u)
  assert.doesNotMatch(renderer, /不使用临时 127\.0\.0\.1 回调/u)
  assert.match(renderer, /GitHub 授权完成，连接状态已自动刷新/u)
  assert.match(renderer, /const status = await api\.refreshGitRuntimeStatus\(\)/u)
  assert.match(renderer, /class="hd-git-disclosure"[^>]+aria-expanded="false"[^>]+data-hd-git-toggle/u)
  assert.match(renderer, /class="hd-git-switch"[^>]+role="switch"[^>]+aria-checked="false"[^>]+aria-readonly="true"[^>]+data-hd-git-status-switch/u)
  assert.match(renderer, /class="hd-git-details" data-hd-git-details hidden[\s\S]*?data-hd-git-refresh[\s\S]*?data-hd-git-auth/u)
  assert.match(renderer, /github\.connected \? '重新连接 GitHub' : '连接 GitHub'/u)
  assert.match(renderer, /data-hd-git-refresh[^\n]+request\('refresh-git-runtime'\)/u)
  assert.match(renderer, /querySelector\('\[data-hd-git-auth\]'\)[\s\S]{0,220}?request\(state\.preparation\?\.canPrepare \? 'prepare-git-runtime' : 'authenticate-github'\)/u)
  assert.match(renderer, /const connected = github\.connected === true[\s\S]{0,320}statusSwitch\.setAttribute\('aria-checked', String\(connected\)\)/u)
  assert.match(renderer, /getAttribute\('aria-expanded'\) !== 'true'/u)
  assert.match(renderer, /querySelector\('\[data-hd-git-details\]'\)\.hidden = !expanded/u)
  assert.doesNotMatch(renderer, /hd-git-switch[^\n>]+aria-pressed|data-hd-git-status-switch[^\n]{0,240}aria-expanded/u)
})

test('Git connection status paints independently from the collapsed details disclosure', async () => {
  const renderer = await source('renderer/app.js')
  const start = renderer.indexOf('  const paintGit = () => {')
  const end = renderer.indexOf('  const mountGit = section => {', start)
  assert.ok(start >= 0 && end > start)

  const elements = Object.fromEntries(['summary', 'version', 'gcm', 'ssh', 'refresh', 'auth'].map(name => [name, { disabled: false, textContent: '' }]))
  const statusSwitch = {
    attributes: {},
    title: '',
    setAttribute(name, value) { this.attributes[name] = value }
  }
  const details = { hidden: true }
  const selectors = {
    '[data-hd-git-summary]': elements.summary,
    '[data-hd-git-version]': elements.version,
    '[data-hd-gcm-status]': elements.gcm,
    '[data-hd-ssh-status]': elements.ssh,
    '[data-hd-git-refresh]': elements.refresh,
    '[data-hd-git-auth]': elements.auth,
    '[data-hd-git-status-switch]': statusSwitch,
    '[data-hd-git-details]': details
  }
  const row = { querySelector: selector => selectors[selector] || null }
  const window = { __HARNESS_DESKTOP_GIT_STATE__: {
    git: { available: true, source: 'bundled', version: '2.53.0' },
    gcm: { available: true, version: '2.7.0' },
    github: { connected: true, accountCount: 1 },
    sshAgent: { available: true, clientAvailable: true, running: false },
    preparation: { canPrepare: false }
  } }
  const document = { querySelector: selector => selector === '#harness-desktop-git-row' ? row : null }
  const paintGit = Function('window', 'document', 'setText', `${renderer.slice(start, end)}\nreturn paintGit`)(window, document, (node, value) => { node.textContent = value })

  paintGit()
  assert.equal(statusSwitch.attributes['aria-checked'], 'true')
  assert.equal(statusSwitch.attributes['aria-label'], 'GitHub 已连接')
  assert.equal(statusSwitch.title, 'GitHub 已连接')
  assert.equal(elements.auth.textContent, '重新连接 GitHub')
  assert.equal(elements.auth.disabled, false)
  assert.equal(elements.refresh.disabled, false)
  assert.equal(details.hidden, true, 'painting a connected state must not expand details')

  window.__HARNESS_DESKTOP_GIT_STATE__.github.connected = false
  paintGit()
  assert.equal(statusSwitch.attributes['aria-checked'], 'false')
  assert.equal(statusSwitch.attributes['aria-label'], 'GitHub 未连接')
  assert.equal(elements.auth.textContent, '连接 GitHub')
  assert.equal(elements.auth.disabled, false)
  assert.equal(details.hidden, true)

  window.__HARNESS_DESKTOP_GIT_STATE__.git.available = false
  window.__HARNESS_DESKTOP_GIT_STATE__.gcm.available = false
  window.__HARNESS_DESKTOP_GIT_STATE__.preparation.canPrepare = true
  paintGit()
  assert.equal(statusSwitch.attributes['aria-checked'], 'false')
  assert.equal(elements.auth.textContent, '安装内置 Git')
  assert.equal(elements.auth.disabled, false)
  assert.equal(details.hidden, true)
})

test('Git renderer boundary publishes only normalized status and never requests secrets', async () => {
  const renderer = await source('renderer/app.js')
  assert.ok(renderer.includes('__HARNESS_DESKTOP_GIT_STATE__'))
  assert.ok(renderer.includes('__HARNESS_DESKTOP_RENDER_GIT__'))
  assert.doesNotMatch(renderer, /credential\s+(?:fill|get)|cmdkey|CredRead|privateKey|accessToken|refreshToken/u)
  assert.doesNotMatch(renderer, /<input[^>]+(?:password|token|cookie)/iu)
})

test('Windows package paths always prepare and include the verified Git resource tree', async () => {
  const [pkgText, releaseBuild, storeBuild, storeConfig] = await Promise.all([
    source('package.json'), source('scripts/build-release.mjs'), source('scripts/build-store-msix.mjs'), source('build/electron-builder.store.yml')
  ])
  const pkg = JSON.parse(pkgText)
  assert.equal(pkg.scripts['prepare:git'], 'node scripts/prepare-bundled-git.mjs')
  assert.ok(pkg.build.win.extraResources.some(entry => entry.from === 'third_party/mingit' && entry.to === 'third_party/mingit'))
  assert.ok(releaseBuild.includes("run(process.execPath, ['scripts/prepare-bundled-git.mjs'])"))
  assert.ok(storeBuild.includes("run(process.execPath, ['scripts/prepare-bundled-git.mjs'])"))
  assert.match(storeConfig, /from: third_party\/mingit[\s\S]+to: third_party\/mingit/u)
})
