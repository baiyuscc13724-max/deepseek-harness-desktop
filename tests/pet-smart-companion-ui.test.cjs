const assert = require('node:assert/strict')
const test = require('node:test')
const { readFile } = require('node:fs/promises')
const path = require('node:path')

const root = path.resolve(__dirname, '..')

test('pet panel exposes relationship, vitality, proactive controls and the privacy boundary', async () => {
  const [html, source, styles] = await Promise.all([
    readFile(path.join(root, 'renderer', 'index.html'), 'utf8'),
    readFile(path.join(root, 'renderer', 'app.js'), 'utf8'),
    readFile(path.join(root, 'renderer', 'styles.css'), 'utf8')
  ])
  for (const id of ['petBondTitle', 'petBondLevel', 'petBondProgress', 'petBondSummary', 'petEnergy', 'petMood', 'petProactive', 'petCompanionStyle']) {
    assert.match(html, new RegExp(`id="${id}"`, 'u'))
    assert.ok(source.includes(`#${id}`), `renderer wiring missing for ${id}`)
  }
  assert.match(html, /会话标识、模型\/Token 用量/u)
  assert.match(html, /不读取对话正文、屏幕或文件/u)
  assert.match(source, /companionStyle: petCompanionStyle\.value/u)
  assert.match(source, /proactive: petProactive\.checked/u)
  assert.match(styles, /\.pet-bond-card/u)
  assert.match(styles, /\.pet-vitals/u)
})

test('pet window renders each structured companion cue once', async () => {
  const source = await readFile(path.join(root, 'renderer', 'pet', 'pet.js'), 'utf8')
  assert.match(source, /lastCompanionCueId/u)
  assert.match(source, /cue\.id !== lastCompanionCueId/u)
  assert.match(source, /showSpeech\(cue\.message/u)
  assert.match(source, /Math\.min\(8000, Math\.max\(1200/u)
})

test('clicking the pet opens the actionable task instead of recording a social tap', async () => {
  const source = await readFile(path.join(root, 'renderer', 'pet', 'pet.js'), 'utf8')
  assert.match(source, /\['needs-input', 'blocked'\]\.includes\(state\?\.status\)/u)
  assert.match(source, /api\.focusMain\(state\.focusSessionId\)/u)
})
