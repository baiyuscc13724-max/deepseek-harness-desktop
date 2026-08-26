import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const INPUT_TRIGGER_ORIGINAL = 'if (ch !== "/") continue;'
const INPUT_TRIGGER_PATCHED = 'if (ch !== "/" && ch !== "$") continue;'
const SKILL_GESTURE_ORIGINAL = 'const SKILL_GESTURE = /(^|\\s)\\/([a-z0-9]+(?:-[a-z0-9]+)*)(?=\\s|$)/g;'
const SKILL_GESTURE_PATCHED = 'const SKILL_GESTURE = /(^|\\s)[\\/$]([a-z0-9]+(?:-[a-z0-9]+)*)(?=\\s|$)/g;'

export function patchCodexInputTriggerSource(source) {
  if (source.includes(INPUT_TRIGGER_PATCHED)) return { source, changed: false }
  if (!source.includes(INPUT_TRIGGER_ORIGINAL)) {
    throw new Error('Pinned DSH input-trigger detector changed; refusing an unsafe Codex parity patch.')
  }
  return { source: source.replace(INPUT_TRIGGER_ORIGINAL, INPUT_TRIGGER_PATCHED), changed: true }
}

export function patchCodexSkillGestureSource(source) {
  if (source.includes(SKILL_GESTURE_PATCHED)) return { source, changed: false }
  if (!source.includes(SKILL_GESTURE_ORIGINAL)) {
    throw new Error('Pinned DSH skill gesture grammar changed; refusing an unsafe Codex parity patch.')
  }
  return { source: source.replace(SKILL_GESTURE_ORIGINAL, SKILL_GESTURE_PATCHED), changed: true }
}

async function patchFile(file, transform) {
  const source = await readFile(file, 'utf8')
  const patched = transform(source)
  if (patched.changed) await writeFile(file, patched.source, 'utf8')
  return patched.changed
}

export async function patchCodexParityRuntime(nodeModulesRoot) {
  const root = path.resolve(nodeModulesRoot)
  const inputTriggerFile = path.join(root, '@deepseek-ai', 'dsh-client-ui-input-trigger', 'lib', 'client.js')
  const toolSkillFile = path.join(root, '@deepseek-ai', 'dsh-tool-skill', 'lib', 'index.js')
  const [inputTriggerChanged, skillGestureChanged] = await Promise.all([
    patchFile(inputTriggerFile, patchCodexInputTriggerSource),
    patchFile(toolSkillFile, patchCodexSkillGestureSource)
  ])
  return { inputTriggerChanged, skillGestureChanged, changed: inputTriggerChanged || skillGestureChanged }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const defaultRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'node_modules')
  const result = await patchCodexParityRuntime(process.argv[2] || defaultRoot)
  process.stdout.write(result.changed
    ? 'Patched Codex-style $ skill discovery and invocation.\n'
    : 'Codex-style $ skill discovery and invocation already applied.\n')
}
