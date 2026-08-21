const path = require('node:path')
const { access, mkdir, rename, rm } = require('node:fs/promises')
const { setTimeout: delay } = require('node:timers/promises')
const { downloadWithFallback } = require('./update-download-service.cjs')
const { extractAndVerifyZip, verifyExtractedComponent } = require('./component-update-archive.cjs')
const { createComponentUpdatePlan, validateAndVerifyManifest } = require('./component-update-contract.cjs')
const { componentDirectoryName } = require('./component-update-store.cjs')
const { compareVersions } = require('./update-service.cjs')

// Reconcile the latest component check plan against the store's active pointer
// (the components actually installed/active). After a component update has been
// applied and confirmed, the pointer already carries the target versions, yet a
// stale in-memory last-check still reports mode "components". Without this guard
// the renderer keeps showing "update available" even though the running
// components are already the latest. Returns a display-safe last-check record.
function effectiveComponentLastCheck(checkResult, pointer, storeState) {
  if (!checkResult) return null
  const plan = checkResult.plan || {}
  const manifest = checkResult.manifest || {}
  const releaseVersion = manifest.releaseVersion || ''
  const components = Array.isArray(plan.components) ? plan.components : []
  const mode = plan.mode

  if (mode !== 'components') {
    return { source: checkResult.source || '', releaseVersion, mode, components: [], totalSize: plan.totalSize || 0 }
  }

  // A staged/ready/in-flight update is genuinely actionable; keep it visible.
  const pendingPhase = Boolean(storeState?.phase) && !['idle', 'failed'].includes(storeState.phase)
  if (pendingPhase) {
    return {
      source: checkResult.source || '',
      releaseVersion,
      mode,
      components: components.map(component => ({ id: component.id, version: component.version, size: component.size || 0 })),
      totalSize: plan.totalSize || 0
    }
  }

  // Otherwise compare against active versions: if every planned component is
  // already active at the same version, there is nothing left to update.
  const active = new Map((Array.isArray(pointer?.components) ? pointer.components : []).map(component => [component.id, component]))
  const allActive = components.length > 0 && components.every(component => {
    const installed = active.get(component.id)
    return installed && compareVersions(component.version, installed.version) === 0
  })
  if (allActive) {
    return { source: checkResult.source || '', releaseVersion, mode: 'none', components: [], totalSize: 0 }
  }

  return {
    source: checkResult.source || '',
    releaseVersion,
    mode,
    components: components.map(component => ({ id: component.id, version: component.version, size: component.size || 0 })),
    totalSize: plan.totalSize || 0
  }
}

function safeManifestUrl(value) {
  const url = new URL(String(value || '').trim())
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) throw new Error('组件更新清单必须使用无凭据、无片段的 HTTPS 地址。')
  return url.toString()
}

async function fetchVerifiedManifestWithFallback({ urls, fetchJson, trustedKeys, now }) {
  if (typeof fetchJson !== 'function') throw new Error('组件更新清单下载器不可用。')
  const sources = [...new Set((Array.isArray(urls) ? urls : [urls]).map(safeManifestUrl))]
  if (!sources.length) throw new Error('没有配置组件更新清单地址。')
  const failures = []
  for (const source of sources) {
    try {
      const payload = await fetchJson(source)
      return { manifest: validateAndVerifyManifest(payload, trustedKeys, { now }), source }
    } catch (error) {
      failures.push(`${new URL(source).hostname}: ${error.message}`)
    }
  }
  throw new Error(`所有组件更新清单源均不可用：${failures.join('；')}`)
}

function currentComponentMap(pointer, baseline = {}) {
  const current = { ...baseline }
  for (const component of pointer?.components || []) current[component.id] = component
  return current
}

async function exists(file, accessImpl = access) {
  try { await accessImpl(file); return true } catch { return false }
}

async function commitImmutableComponent({ source, destination, descriptor, renameImpl = rename, rmImpl = rm, verifyImpl = verifyExtractedComponent }) {
  if (await exists(destination)) {
    await verifyImpl(destination, descriptor)
    await rmImpl(source, { recursive: true, force: true })
    return { reused: true, destination }
  }
  let lastError
  for (const wait of [0, 100, 300, 700]) {
    if (wait) await delay(wait)
    try {
      await mkdir(path.dirname(destination), { recursive: true })
      await renameImpl(source, destination)
      await verifyImpl(destination, descriptor)
      return { reused: false, destination }
    } catch (error) {
      lastError = error
      if (await exists(destination)) {
        await verifyImpl(destination, descriptor)
        await rmImpl(source, { recursive: true, force: true })
        return { reused: true, destination }
      }
    }
  }
  throw lastError
}

class ComponentUpdateService {
  constructor({
    store,
    manifestUrls,
    trustedKeys,
    bootstrapVersion,
    fetchJson,
    fetchImpl,
    AdmZipImpl,
    platform = process.platform,
    arch = process.arch,
    baselineComponents = {},
    downloadImpl = downloadWithFallback,
    extractImpl = extractAndVerifyZip,
    commitImpl = commitImmutableComponent
  }) {
    if (!store) throw new Error('ComponentUpdateService requires a store.')
    this.store = store
    this.manifestUrls = manifestUrls
    this.trustedKeys = trustedKeys
    this.bootstrapVersion = bootstrapVersion
    this.fetchJson = fetchJson
    this.fetchImpl = fetchImpl
    this.AdmZipImpl = AdmZipImpl
    this.platform = platform
    this.arch = arch
    this.baselineComponents = baselineComponents
    this.downloadImpl = downloadImpl
    this.extractImpl = extractImpl
    this.commitImpl = commitImpl
    this.activeStage = null
  }

  async check({ now = Date.now() } = {}) {
    const { manifest, source } = await fetchVerifiedManifestWithFallback({
      urls: this.manifestUrls,
      fetchJson: this.fetchJson,
      trustedKeys: this.trustedKeys,
      now
    })
    const pointer = await this.store.pointer()
    const current = currentComponentMap(pointer, this.baselineComponents)
    const plan = createComponentUpdatePlan({
      manifest,
      current,
      bootstrapVersion: this.bootstrapVersion,
      platform: this.platform,
      arch: this.arch
    })
    return { manifest, source, plan, current }
  }

  async stage(checkResult, onProgress) {
    if (this.activeStage) return this.activeStage
    this.activeStage = this.#stage(checkResult, onProgress).finally(() => { this.activeStage = null })
    return this.activeStage
  }

  async #stage(checkResult, onProgress) {
    const plan = checkResult?.plan
    if (plan?.mode !== 'components') throw new Error('当前更新计划不是组件更新。')
    await this.store.beginStaging(plan)
    const stagingRoot = this.store.stagingPath(plan.releaseVersion)
    await rm(stagingRoot, { recursive: true, force: true })
    await mkdir(stagingRoot, { recursive: true })
    try {
      for (let index = 0; index < plan.components.length; index += 1) {
        const descriptor = plan.components[index]
        const directory = componentDirectoryName(descriptor)
        const archivePath = path.join(stagingRoot, `${descriptor.id}.zip`)
        const unpackedPath = path.join(stagingRoot, `${directory}.unpacked`)
        onProgress?.({ phase: 'download', component: descriptor.id, index, totalComponents: plan.components.length, received: 0, total: descriptor.size })
        await this.downloadImpl({
          asset: { urls: descriptor.urls },
          destination: archivePath,
          expectedSize: descriptor.size,
          expectedHash: descriptor.sha256,
          fetchImpl: this.fetchImpl,
          maxBytes: descriptor.size,
          onProgress: progress => onProgress?.({ ...progress, phase: 'download', component: descriptor.id, index, totalComponents: plan.components.length })
        })
        onProgress?.({ phase: 'verify', component: descriptor.id, index, totalComponents: plan.components.length })
        await rm(unpackedPath, { recursive: true, force: true })
        await this.extractImpl({
          archivePath,
          destination: unpackedPath,
          descriptor,
          AdmZipImpl: this.AdmZipImpl
        })
        const destination = this.store.componentPath({ id: descriptor.id, version: descriptor.version, sha256: descriptor.sha256, directory })
        onProgress?.({ phase: 'commit', component: descriptor.id, index, totalComponents: plan.components.length })
        await this.commitImpl({ source: unpackedPath, destination, descriptor })
        await rm(archivePath, { force: true })
      }
      await rm(stagingRoot, { recursive: true, force: true })
      const state = await this.store.markReady()
      onProgress?.({ phase: 'ready', releaseVersion: plan.releaseVersion, totalComponents: plan.components.length })
      return { state, plan }
    } catch (error) {
      await rm(stagingRoot, { recursive: true, force: true }).catch(() => {})
      await this.store.markFailed(error).catch(() => {})
      throw error
    }
  }
}

module.exports = {
  ComponentUpdateService,
  commitImmutableComponent,
  currentComponentMap,
  effectiveComponentLastCheck,
  fetchVerifiedManifestWithFallback,
  safeManifestUrl
}
