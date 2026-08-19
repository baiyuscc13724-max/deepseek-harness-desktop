const { access } = require('node:fs/promises')

function samePointer(left, right) {
  if (!left || !right || left.releaseVersion !== right.releaseVersion) return false
  if (left.components.length !== right.components.length) return false
  const normalize = pointer => [...pointer.components]
    .map(component => `${component.id}:${component.version}:${component.sha256}:${component.directory}`)
    .sort()
  return normalize(left).every((value, index) => value === normalize(right)[index])
}

async function verifyActiveComponentsPresent(store, pointer, accessImpl = access) {
  if (!pointer?.components?.length) throw new Error('活动组件指针为空。')
  for (const component of pointer.components) await accessImpl(store.componentPath(component))
  return true
}

async function rollbackUnhealthyActivation(store, error) {
  await store.requireRollback(error)
  const state = await store.rollback()
  return { action: 'rolled-back', state, pointer: await store.pointer(), error: String(error?.message || error) }
}

async function prepareComponentActivation({ store, accessImpl = access }) {
  const state = await store.get()
  const pointer = await store.pointer()
  if (state.phase !== 'awaiting-health') return { action: 'use-current', state, pointer }
  if (!samePointer(state.active, pointer)) {
    return rollbackUnhealthyActivation(store, new Error('活动组件指针与更新状态不一致。'))
  }
  const health = await store.beginHealthCheck()
  if (health.action === 'rollback') {
    return rollbackUnhealthyActivation(store, new Error('上一次组件版本未完成健康确认。'))
  }
  try {
    await verifyActiveComponentsPresent(store, pointer, accessImpl)
    return { action: 'health-check-required', state: health.state, pointer }
  } catch (error) {
    return rollbackUnhealthyActivation(store, error)
  }
}

async function confirmComponentActivation(store) {
  const state = await store.get()
  if (state.phase !== 'awaiting-health') return { confirmed: false, state }
  const confirmed = await store.confirmHealthy()
  return { confirmed: true, state: confirmed }
}

module.exports = {
  confirmComponentActivation,
  prepareComponentActivation,
  rollbackUnhealthyActivation,
  samePointer,
  verifyActiveComponentsPresent
}
