const assert = require('node:assert/strict')
const test = require('node:test')
const os = require('node:os')
const path = require('node:path')
const { mkdir, mkdtemp, readFile, rm, writeFile } = require('node:fs/promises')

const INPUT_ORIGINAL = 'if (ch !== "/") continue;'
const SKILL_ORIGINAL = 'const SKILL_GESTURE = /(^|\\s)\\/([a-z0-9]+(?:-[a-z0-9]+)*)(?=\\s|$)/g;'

test('Codex parity runtime patch adds idempotent $ detection and skill gestures', async () => {
  const {
    patchCodexInputTriggerSource,
    patchCodexSkillGestureSource
  } = await import('../scripts/codex-parity-runtime-patch.mjs')

  const input = patchCodexInputTriggerSource(`before\n${INPUT_ORIGINAL}\nafter`)
  assert.equal(input.changed, true)
  assert.match(input.source, /ch !== "\/" && ch !== "\$"/u)
  assert.equal(patchCodexInputTriggerSource(input.source).changed, false)

  const skill = patchCodexSkillGestureSource(`before\n${SKILL_ORIGINAL}\nafter`)
  assert.equal(skill.changed, true)
  assert.match(skill.source, /SKILL_GESTURE = \/\(\^\|\\s\)\[\\\/\$\]/u)
  assert.equal(patchCodexSkillGestureSource(skill.source).changed, false)

  assert.throws(() => patchCodexInputTriggerSource('drifted'), /detector changed/u)
  assert.throws(() => patchCodexSkillGestureSource('drifted'), /grammar changed/u)
})

test('Codex parity runtime patch updates an extracted component runtime atomically per file', async () => {
  const { patchCodexParityRuntime } = await import('../scripts/codex-parity-runtime-patch.mjs')
  const root = await mkdtemp(path.join(os.tmpdir(), 'codex-parity-runtime-'))
  try {
    const inputFile = path.join(root, '@deepseek-ai', 'dsh-client-ui-input-trigger', 'lib', 'client.js')
    const skillFile = path.join(root, '@deepseek-ai', 'dsh-tool-skill', 'lib', 'index.js')
    await mkdir(path.dirname(inputFile), { recursive: true })
    await mkdir(path.dirname(skillFile), { recursive: true })
    await writeFile(inputFile, INPUT_ORIGINAL, 'utf8')
    await writeFile(skillFile, SKILL_ORIGINAL, 'utf8')

    assert.deepEqual(await patchCodexParityRuntime(root), {
      inputTriggerChanged: true,
      skillGestureChanged: true,
      changed: true
    })
    assert.match(await readFile(inputFile, 'utf8'), /ch !== "\$"/u)
    assert.match(await readFile(skillFile, 'utf8'), /\[\\\/\$\]/u)
    assert.deepEqual(await patchCodexParityRuntime(root), {
      inputTriggerChanged: false,
      skillGestureChanged: false,
      changed: false
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
