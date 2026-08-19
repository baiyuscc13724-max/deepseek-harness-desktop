const path = require('node:path')
const { mkdir, readFile, rename, rm, writeFile } = require('node:fs/promises')
const { randomBytes } = require('node:crypto')
const { COMPONENT_STATE_SCHEMA_VERSION, normalizeHash, normalizeVersion } = require('./component-update-contract.cjs')

const UPDATE_PHASES = new Set(['idle', 'staging', 'ready', 'applying', 'awaiting-health', 'rollback-required', 'failed'])

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function defaultState() {
  return {
    schemaVersion: COMPONENT_STATE_SCHEMA_VERSION,
    revision: 0,
    phase: 'idle',
    active: null,
    lastKnownGood: null,
    pending: null,
    failure: null
  }
}

function safeComponentId(value) {
  const id = String(value || '').trim()
  if (!/^[a-z][a-z0-9-]{1,31}$/.test(id)) throw new Error('组件 ID 无效。')
  return id
}

function normalizeComponentRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('组件状态无效。')
  const id = safeComponentId(value.id)
  const version = normalizeVersion(value.version, `组件 ${id} 版本`)
  const sha256 = normalizeHash(value.sha256, `组件 ${id} SHA-256`)
  const directory = String(value.directory || '').trim()
  if (directory !== componentDirectoryName({ id, version, sha256 })) throw new Error(`组件 ${id} 的目录不符合内容寻址规则。`)
  return { id, version, sha256, directory }
}

function normalizeReleasePointer(value) {
  if (value === null || value === undefined) return null
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('组件发布指针无效。')
  const releaseVersion = normalizeVersion(value.releaseVersion, '组件发布版本')
  if (!Array.isArray(value.components) || value.components.length === 0 || value.components.length > 16) throw new Error('组件发布指针缺少组件。')
  const components = value.components.map(normalizeComponentRecord)
  if (new Set(components.map(component => component.id)).size !== components.length) throw new Error('组件发布指针包含重复组件。')
  return { releaseVersion, components }
}

function normalizePending(value) {
  if (value === null || value === undefined) return null
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('待处理组件状态无效。')
  const release = normalizeReleasePointer(value)
  const stagedAt = new Date(value.stagedAt)
  const attempts = Number(value.attempts || 0)
  const healthAttempts = Number(value.healthAttempts || 0)
  const activatedAt = value.activatedAt ? new Date(value.activatedAt) : null
  if (Number.isNaN(stagedAt.getTime()) || !Number.isSafeInteger(attempts) || attempts < 0 || attempts > 10) throw new Error('待处理组件元数据无效。')
  if (!Number.isSafeInteger(healthAttempts) || healthAttempts < 0 || healthAttempts > 3 || (activatedAt && Number.isNaN(activatedAt.getTime()))) throw new Error('待处理组件健康检查元数据无效。')
  return {
    ...release,
    stagedAt: stagedAt.toISOString(),
    attempts,
    healthAttempts,
    ...(activatedAt ? { activatedAt: activatedAt.toISOString() } : {})
  }
}

function normalizeFailure(value) {
  if (value === null || value === undefined) return null
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('更新失败状态无效。')
  const at = new Date(value.at)
  if (Number.isNaN(at.getTime())) throw new Error('更新失败时间无效。')
  return {
    code: String(value.code || 'UNKNOWN').slice(0, 80),
    message: String(value.message || '').slice(0, 1000),
    at: at.toISOString(),
    ...(value.releaseVersion ? { releaseVersion: normalizeVersion(value.releaseVersion, '失败发布版本') } : {})
  }
}

function normalizeState(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return defaultState()
  if (value.schemaVersion !== COMPONENT_STATE_SCHEMA_VERSION) return defaultState()
  const phase = UPDATE_PHASES.has(value.phase) ? value.phase : 'failed'
  const revision = Number(value.revision || 0)
  if (!Number.isSafeInteger(revision) || revision < 0) return defaultState()
  try {
    return {
      schemaVersion: COMPONENT_STATE_SCHEMA_VERSION,
      revision,
      phase,
      active: normalizeReleasePointer(value.active),
      lastKnownGood: normalizeReleasePointer(value.lastKnownGood),
      pending: normalizePending(value.pending),
      failure: normalizeFailure(value.failure)
    }
  } catch {
    return defaultState()
  }
}

function componentDirectoryName({ id, version, sha256 }) {
  return `${safeComponentId(id)}-${normalizeVersion(version)}-${normalizeHash(sha256).slice(0, 16)}`
}

async function atomicWriteJson(file, value, { mkdirImpl = mkdir, writeFileImpl = writeFile, renameImpl = rename } = {}) {
  await mkdirImpl(path.dirname(file), { recursive: true })
  const temporary = `${file}.${process.pid}.${Date.now()}.${randomBytes(4).toString('hex')}.tmp`
  await writeFileImpl(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  await renameImpl(temporary, file)
}

class ComponentUpdateStore {
  constructor(root, options = {}) {
    const resolved = path.resolve(String(root || ''))
    if (!path.isAbsolute(resolved)) throw new Error('组件更新目录必须是绝对路径。')
    this.root = resolved
    this.stateFile = path.join(resolved, 'state.json')
    this.pointerFile = path.join(resolved, 'current.json')
    this.readFile = options.readFileImpl || readFile
    this.atomicWrite = options.atomicWriteImpl || atomicWriteJson
    this.rm = options.rmImpl || rm
  }

  componentPath(record) {
    const normalized = normalizeComponentRecord(record)
    return path.join(this.root, 'components', normalized.id, normalized.directory)
  }

  stagingPath(releaseVersion) {
    return path.join(this.root, 'staging', normalizeVersion(releaseVersion))
  }

  async get() {
    try { return normalizeState(JSON.parse(await this.readFile(this.stateFile, 'utf8'))) }
    catch { return defaultState() }
  }

  async pointer() {
    try { return normalizeReleasePointer(JSON.parse(await this.readFile(this.pointerFile, 'utf8'))) }
    catch { return null }
  }

  async writeState(next, expectedRevision) {
    const current = await this.get()
    if (expectedRevision !== undefined && current.revision !== expectedRevision) throw new Error('组件更新状态已被其他进程修改。')
    const normalized = normalizeState({ ...next, schemaVersion: COMPONENT_STATE_SCHEMA_VERSION, revision: current.revision + 1 })
    await this.atomicWrite(this.stateFile, normalized)
    return clone(normalized)
  }

  async beginStaging(plan, now = new Date()) {
    if (plan?.mode !== 'components' || !Array.isArray(plan.components) || plan.components.length === 0) throw new Error('没有可暂存的组件更新。')
    const current = await this.get()
    if (!['idle', 'failed'].includes(current.phase)) throw new Error(`当前更新阶段不允许开始暂存：${current.phase}`)
    const components = (plan.desiredComponents || plan.components).map(component => normalizeComponentRecord({
      id: component.id,
      version: component.version,
      sha256: component.sha256,
      directory: componentDirectoryName(component)
    }))
    return this.writeState({
      ...current,
      phase: 'staging',
      pending: {
        releaseVersion: normalizeVersion(plan.releaseVersion, '待更新发布版本'),
        components,
        stagedAt: now.toISOString(),
        attempts: 0,
        healthAttempts: 0
      },
      failure: null
    }, current.revision)
  }

  async markFailed(error, now = new Date()) {
    const current = await this.get()
    const releaseVersion = current.pending?.releaseVersion
    return this.writeState({
      ...current,
      phase: 'failed',
      pending: null,
      failure: {
        code: String(error?.code || 'COMPONENT_UPDATE_FAILED'),
        message: String(error?.message || error || '组件更新失败。'),
        at: now.toISOString(),
        ...(releaseVersion ? { releaseVersion } : {})
      }
    }, current.revision)
  }

  async markReady() {
    const current = await this.get()
    if (current.phase !== 'staging' || !current.pending) throw new Error('只有完成暂存的更新可以标记为就绪。')
    return this.writeState({ ...current, phase: 'ready' }, current.revision)
  }

  async markApplying() {
    const current = await this.get()
    if (current.phase !== 'ready' || !current.pending) throw new Error('只有就绪更新可以开始应用。')
    return this.writeState({
      ...current,
      phase: 'applying',
      pending: { ...current.pending, attempts: current.pending.attempts + 1 }
    }, current.revision)
  }

  async activatePending(now = new Date()) {
    const current = await this.get()
    if (current.phase !== 'applying' || !current.pending) throw new Error('没有正在应用的组件更新。')
    const active = { releaseVersion: current.pending.releaseVersion, components: current.pending.components }
    await this.atomicWrite(this.pointerFile, active)
    return this.writeState({
      ...current,
      phase: 'awaiting-health',
      lastKnownGood: current.active || current.lastKnownGood,
      active,
      pending: { ...current.pending, activatedAt: now.toISOString(), healthAttempts: 0 }
    }, current.revision)
  }

  async beginHealthCheck() {
    const current = await this.get()
    if (current.phase !== 'awaiting-health' || !current.pending || !current.active) return { action: 'none', state: current }
    if (current.pending.healthAttempts > 0) return { action: 'rollback', state: current }
    const state = await this.writeState({
      ...current,
      pending: { ...current.pending, healthAttempts: current.pending.healthAttempts + 1 }
    }, current.revision)
    return { action: 'check', state }
  }

  async confirmHealthy() {
    const current = await this.get()
    if (current.phase !== 'awaiting-health' || !current.active) throw new Error('当前没有等待健康确认的更新。')
    return this.writeState({
      ...current,
      phase: 'idle',
      lastKnownGood: current.active,
      pending: null,
      failure: null
    }, current.revision)
  }

  async requireRollback(error, now = new Date()) {
    const current = await this.get()
    if (!current.pending) throw new Error('没有可回滚的更新。')
    return this.writeState({
      ...current,
      phase: 'rollback-required',
      failure: {
        code: String(error?.code || 'HEALTH_CHECK_FAILED'),
        message: String(error?.message || error || '组件更新健康检查失败。'),
        at: now.toISOString(),
        releaseVersion: current.pending.releaseVersion
      }
    }, current.revision)
  }

  async rollback() {
    const current = await this.get()
    if (current.phase !== 'rollback-required' || !current.lastKnownGood) throw new Error('没有可用的上一健康版本。')
    await this.atomicWrite(this.pointerFile, current.lastKnownGood)
    return this.writeState({
      ...current,
      phase: 'failed',
      active: current.lastKnownGood,
      pending: null
    }, current.revision)
  }

  async discardStaging(releaseVersion) {
    await this.rm(this.stagingPath(releaseVersion), { recursive: true, force: true })
  }
}

module.exports = {
  ComponentUpdateStore,
  UPDATE_PHASES,
  atomicWriteJson,
  componentDirectoryName,
  defaultState,
  normalizeComponentRecord,
  normalizeReleasePointer,
  normalizeState
}
