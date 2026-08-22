'use strict'

const { existsSync } = require('node:fs')
const { mkdtemp, readFile, readdir, rm } = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { validateAndVerifyDesktopReleaseManifest } = require('../electron/bridge/desktop-release-contract.cjs')
const { downloadWithFallback, checksumWithFallback } = require('../electron/bridge/update-download-service.cjs')
const { parseChecksumFile } = require('../electron/bridge/update-service.cjs')

function argument(name, fallback = '') {
  const exact = process.argv.indexOf(`--${name}`)
  if (exact >= 0) return process.argv[exact + 1] ?? fallback
  const prefix = `--${name}=`
  const joined = process.argv.find(value => value.startsWith(prefix))
  return joined ? joined.slice(prefix.length) : fallback
}

function assetDescriptor(asset) {
  return {
    urls: [
      ...(Array.isArray(asset?.mirror_urls) ? asset.mirror_urls : []),
      asset?.browser_download_url
    ].map(value => String(value || '').trim()).filter(Boolean)
  }
}

function selectWindowsUpdateAssets(release, version) {
  const names = {
    installer: `Harness-Desktop-${version}-win-x64.exe`,
    checksum: 'SHA256SUMS.txt'
  }
  const assets = new Map((release?.assets || []).map(asset => [asset.name, asset]))
  const installer = assets.get(names.installer)
  const checksum = assets.get(names.checksum)
  if (!installer || !checksum) throw new Error('Signed release manifest is missing the Windows installer or checksum asset.')
  if (!Number.isSafeInteger(installer.size) || installer.size <= 0 || !/^[0-9a-f]{64}$/u.test(String(installer.sha256 || ''))) {
    throw new Error('Signed Windows installer metadata is incomplete.')
  }
  return { installer, checksum, names }
}

function runProcess(file, args, label, timeout = 10 * 60 * 1000) {
  const result = spawnSync(file, args, { stdio: 'inherit', windowsHide: true, timeout, shell: false })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${label} exited with code ${result.status}.`)
}

async function waitForRemoval(target, attempts = 30) {
  for (let index = 0; index < attempts && existsSync(target); index += 1) {
    await new Promise(resolve => setTimeout(resolve, 500))
  }
  if (existsSync(target)) throw new Error('Uninstaller left the temporary installation directory behind.')
}

async function loadVerifiedRelease(root, version) {
  const [document, sources] = await Promise.all([
    readFile(path.join(root, 'release-manifest.json'), 'utf8').then(JSON.parse),
    readFile(path.join(root, 'release-update-sources.json'), 'utf8').then(JSON.parse)
  ])
  const releases = validateAndVerifyDesktopReleaseManifest(document, sources.trustedKeys)
  if (releases.length !== 1 || releases[0].tag_name !== `v${version}` || releases[0].draft !== false) {
    throw new Error('Local signed manifest is not the exact public release under test.')
  }
  return releases[0]
}

async function run() {
  if (process.platform !== 'win32' || !process.versions.electron) throw new Error('The public update gate requires Electron on Windows.')
  const { app, net } = require('electron')
  await app.whenReady()

  const root = path.resolve(__dirname, '..')
  const version = String(argument('version')).replace(/^v/u, '')
  if (!/^\d+\.\d+\.\d+$/u.test(version)) throw new Error('A stable --version is required.')
  const release = await loadVerifiedRelease(root, version)
  const { installer, checksum, names } = selectWindowsUpdateAssets(release, version)
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), `harness-public-update-${version}-`))
  const installerPath = path.join(temporaryRoot, names.installer)
  const installRoot = path.join(temporaryRoot, 'installed')
  const profileRoot = path.join(temporaryRoot, 'profile')
  const reportPath = path.join(temporaryRoot, 'installed-selftest.json')
  try {
    const fetchImpl = (url, options) => net.fetch(url, options)
    const checksumResult = await checksumWithFallback({
      asset: assetDescriptor(checksum),
      fileName: names.installer,
      fetchImpl,
      parseChecksum: parseChecksumFile,
      userAgent: `Harness-Desktop-${version}-Public-Update-Gate`
    })
    if (checksumResult.hash.toLowerCase() !== installer.sha256) throw new Error('Public checksum does not match the signed manifest.')

    const download = await downloadWithFallback({
      asset: assetDescriptor(installer),
      destination: installerPath,
      expectedSize: installer.size,
      expectedHash: installer.sha256,
      fetchImpl,
      idleTimeoutMs: 60_000,
      userAgent: `Harness-Desktop-${version}-Public-Update-Gate`
    })

    runProcess(installerPath, ['/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', `/DIR=${installRoot}`], 'Downloaded installer')
    const installedExe = path.join(installRoot, 'Harness Desktop.exe')
    const installedAsar = path.join(installRoot, 'resources', 'app.asar')
    if (!existsSync(installedExe) || !existsSync(installedAsar)) throw new Error('Downloaded installer did not create the expected application files.')
    runProcess(installedExe, ['--self-test', `--self-test-output=${reportPath}`, `--user-data-dir=${profileRoot}`, `--harness-user-data-dir=${profileRoot}`], 'Installed self-test')
    const report = JSON.parse(await readFile(reportPath, 'utf8'))
    if (!report.ok || report.product?.version !== version) throw new Error('Installed self-test failed or reported the wrong version.')

    const uninstaller = (await readdir(installRoot, { withFileTypes: true }))
      .find(entry => entry.isFile() && /^unins.*\.exe$/iu.test(entry.name))
    if (!uninstaller) throw new Error('Installed uninstaller is missing.')
    runProcess(path.join(installRoot, uninstaller.name), ['/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART'], 'Windows uninstaller')
    await waitForRemoval(installRoot)

    return {
      ok: true,
      version,
      electron: process.versions.electron,
      checksumSource: checksumResult.source,
      installerSource: download.source,
      bytes: download.size,
      sha256: download.sha256,
      installedSelfTest: true,
      uninstalled: true
    }
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true })
  }
}

module.exports = { assetDescriptor, selectWindowsUpdateAssets }

if (require.main === module) {
  run().then(result => {
    console.log(JSON.stringify(result, null, 2))
    require('electron').app.exit(0)
  }).catch(error => {
    console.error(error?.stack || error)
    require('electron').app.exit(1)
  })
}
