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
  for (const marker of ['Git 与仓库连接', '内置 MinGit', 'Git Credential Manager', 'Windows ssh-agent', '安装内置 Git', '连接 GitHub', 'Harness 不读取或显示密码、Token、Cookie、验证码或 SSH 私钥']) {
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
