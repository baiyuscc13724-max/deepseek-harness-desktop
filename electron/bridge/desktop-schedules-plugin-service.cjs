const { mkdir, readFile, rename, rm, writeFile } = require('node:fs/promises')
const path = require('node:path')
const YAML = require('yaml')

const SCHEDULE_ID = 'schedule'
const SCHEDULE_PACKAGE = '@deepseek-ai/dsh-schedule'
const PLUGIN_ID = 'desktop-schedules'
const PLUGIN_PACKAGE = 'dsh-desktop-schedules'

async function text(file, fallback = '') {
  return readFile(file, 'utf8').catch(error => {
    if (error.code === 'ENOENT') return fallback
    throw error
  })
}

async function atomicWrite(file, content) {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 })
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`
  await writeFile(temporary, content, { encoding: 'utf8', mode: 0o600 })
  await rename(temporary, file)
}

async function ensurePatchEntries(file) {
  const document = YAML.parseDocument(await text(file, '[]\n'))
  if (document.errors.length) throw new Error(`DSH Web 配置补丁无法解析：${document.errors[0].message}`)
  const rows = document.toJS()
  if (rows != null && !Array.isArray(rows)) throw new Error('DSH Web 配置补丁必须是顶层数组。')
  const retained = []
  let hasOfficialSchedule = false
  let changed = false
  for (const row of rows || []) {
    if (!Array.isArray(row?.insert)) {
      retained.push(row)
      continue
    }
    const insert = row.insert.filter(item => {
      const desktopOwned = item?.id === PLUGIN_ID || item?.name === PLUGIN_PACKAGE
      if (desktopOwned) changed = true
      return !desktopOwned
    })
    if (insert.some(item => item?.id === SCHEDULE_ID || item?.name === SCHEDULE_PACKAGE)) hasOfficialSchedule = true
    if (insert.length > 0) retained.push({ ...row, insert })
    else if (Object.keys(row).some(key => key !== 'insert')) retained.push({ ...row, insert })
    else if (row.insert.length > 0) changed = true
  }
  if (!hasOfficialSchedule) {
    retained.push({ insert: [{ id: SCHEDULE_ID, name: SCHEDULE_PACKAGE }] })
    changed = true
  }
  if (!changed) return false
  document.contents = document.createNode(retained)
  document.contents.flow = false
  await atomicWrite(file, String(document))
  return true
}

async function ensureDesktopSchedulesPlugin({ dshHome }) {
  const profile = path.join(path.resolve(dshHome), 'profiles', 'web')
  const destination = path.join(profile, 'node_modules', PLUGIN_PACKAGE)
  await rm(destination, { recursive: true, force: true })
  const patchChanged = await ensurePatchEntries(path.join(profile, 'cordis.patch.yml'))
  return { destination, patchChanged, version: null, disabled: true, replacement: SCHEDULE_PACKAGE }
}

module.exports = {
  SCHEDULE_ID,
  SCHEDULE_PACKAGE,
  PLUGIN_ID,
  PLUGIN_PACKAGE,
  ensureDesktopSchedulesPlugin,
  ensurePatchEntries
}
