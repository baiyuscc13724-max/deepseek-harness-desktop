const { mkdtemp, mkdir, rm, writeFile, symlink } = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')

// 构造一个真实的 HarnessData 目录树（runtime / dsh-home / temp / workspace）。
async function buildHarnessData({ version = '1.0.23', platform = 'win32', arch = 'x64', tempAgeMs = 0 } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'harness-data-fixture-'))
  const runDir = path.join(root, 'runtime')
  const homeDir = path.join(root, 'dsh-home')
  const tempDir = path.join(root, 'temp')
  const wsDir = path.join(root, 'workspace')

  // 当前 runtime + 一个旧 runtime。
  await mkdir(path.join(runDir, `${version}-${platform}-${arch}`), { recursive: true })
  await mkdir(path.join(runDir, '1.0.20-win32-x64'), { recursive: true })
  await writeFile(path.join(runDir, `${version}-${platform}-${arch}`, 'marker.txt'), 'current')
  await writeFile(path.join(runDir, '1.0.20-win32-x64', 'marker.txt'), 'old')

  // dsh-home：受保护子树 + marketplace 缓存。
  await mkdir(path.join(homeDir, 'sessions'), { recursive: true })
  await mkdir(path.join(homeDir, 'attachments'), { recursive: true })
  await writeFile(path.join(homeDir, 'sessions', 's1.json'), '{"keep":true}')
  await writeFile(path.join(homeDir, 'attachments', 'a1.bin'), 'attachment-data')
  await mkdir(path.join(homeDir, 'marketplace', 'cache'), { recursive: true })
  await writeFile(path.join(homeDir, 'marketplace', 'cache', 'cache.db'), 'cache-bytes')
  await writeFile(path.join(homeDir, 'marketplace', 'settings.json'), '{"keep":true}')

  // temp：若干过期/新鲜条目。
  await mkdir(path.join(tempDir, 'dsh-spill-OLD1'), { recursive: true })
  await mkdir(path.join(tempDir, 'dsh-spill-old2'), { recursive: true })
  await writeFile(path.join(tempDir, 'dsh-spill-OLD1', 'x'), 'temp-data')
  await mkdir(path.join(tempDir, 'fresh'), { recursive: true })

  await mkdir(wsDir, { recursive: true })

  return { root, runDir, homeDir, tempDir, wsDir }
}

async function destroyHarnessData(root) {
  await rm(root, { recursive: true, force: true })
}

async function addSymlinkEscape(root, homeDir) {
  // 在 dsh-home 下放置一个指向根目录之外的符号链接目录。
  const outside = await mkdtemp(path.join(os.tmpdir(), 'harness-outside-'))
  await writeFile(path.join(outside, 'secret.txt'), 'outside-content')
  const linkTarget = path.join(homeDir, 'sneaky-link')
  try {
    await symlink(outside, linkTarget, 'junction')
    return { linkTarget, outside }
  } catch {
    // 某些环境不允许创建符号链接。
    return null
  }
}

module.exports = { addSymlinkEscape, buildHarnessData, destroyHarnessData }
