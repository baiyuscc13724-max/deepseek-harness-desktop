const assert = require('node:assert/strict')
const { mkdtemp, mkdir, writeFile, stat, rm } = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const {
  blocksDirectOpen,
  normalizeLocalTarget,
  openLocalTarget
} = require('../electron/bridge/local-target-service.cjs')

test('normalizes Windows, file URL, Chinese and source-location targets', () => {
  assert.deepEqual(normalizeLocalTarget('`D:\\项目 空间\\src\\app.js:42:7`'), {
    path: 'D:\\项目 空间\\src\\app.js', line: 42, column: 7
  })
  assert.deepEqual(normalizeLocalTarget('harness-desktop://open-local?path=D%3A%255C%25E9%25A1%25B9%25E7%259B%25AE%255CREADME.md%2523L12'), {
    path: 'D:\\项目\\README.md', line: 12, column: null
  })
  const fileUrlPath = normalizeLocalTarget('file:///D:/Project/My%20File.txt').path
  assert.equal(fileUrlPath, process.platform === 'win32' ? 'D:\\Project\\My File.txt' : '/D:/Project/My File.txt')
  assert.throws(() => normalizeLocalTarget('../relative/project'), /绝对/)
  assert.throws(() => normalizeLocalTarget('https://example.com'), /绝对/)
})

test('opens directories and documents but never executes authored launchable files', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hd-local-target-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const project = path.join(root, '项目 空间')
  const document = path.join(project, 'README.md')
  const executable = path.join(project, 'setup.exe')
  const macApp = path.join(project, 'Unsafe.app')
  await mkdir(project)
  await mkdir(macApp)
  await writeFile(document, '# project')
  await writeFile(executable, 'not executable')
  const opened = []
  const revealed = []
  const options = {
    statImpl: stat,
    openPath: async value => { opened.push(value); return '' },
    showItemInFolder: value => revealed.push(value)
  }

  assert.equal((await openLocalTarget(project, options)).action, 'open-directory')
  assert.equal((await openLocalTarget(`${document}:12`, options)).action, 'open-file')
  assert.equal((await openLocalTarget(executable, options)).action, 'reveal-blocked-executable')
  assert.equal((await openLocalTarget(macApp, options)).action, 'reveal-blocked-executable')
  assert.deepEqual(opened, [project, document])
  assert.deepEqual(revealed, [executable, macApp])
  assert.equal(blocksDirectOpen('script.ps1'), true)
  assert.equal(blocksDirectOpen('source.ts'), false)
})

test('reveal opens a file location and missing targets fail clearly', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hd-local-reveal-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const file = path.join(root, '说明.txt')
  await writeFile(file, 'ok')
  const revealed = []
  const result = await openLocalTarget(file, {
    reveal: true,
    statImpl: stat,
    openPath: async () => '',
    showItemInFolder: value => revealed.push(value)
  })
  assert.equal(result.action, 'reveal')
  assert.deepEqual(revealed, [file])
  await assert.rejects(openLocalTarget(path.join(root, 'missing.txt'), {
    statImpl: stat,
    openPath: async () => '',
    showItemInFolder: () => {}
  }), /路径不存在/)
})
