'use strict'

const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const ROOT = path.resolve(__dirname, '..')
const CHAT_FILE = path.join(ROOT, 'node_modules', '@deepseek-ai', 'dsh-client-ui-chat', 'lib', 'client.js')

class FakeClock {
  constructor() {
    this.now = 0
    this.frame = 0
    this.nextId = 1
    this.frames = new Map()
    this.timers = new Map()
  }

  requestFrame(callback) {
    const id = this.nextId++
    this.frames.set(id, callback)
    return id
  }

  cancelFrame(id) {
    this.frames.delete(id)
  }

  setTimer(callback, delay) {
    const id = this.nextId++
    this.timers.set(id, { at: this.now + delay, callback })
    return id
  }

  clearTimer(id) {
    this.timers.delete(id)
  }

  runFrame() {
    this.frame += 1
    const callbacks = [...this.frames.values()]
    this.frames.clear()
    for (const callback of callbacks) callback()
  }

  advance(ms) {
    this.now += ms
    const due = [...this.timers.entries()]
      .filter(([, timer]) => timer.at <= this.now)
      .sort((left, right) => left[1].at - right[1].at || left[0] - right[0])
    if (due.length > 0) this.frame += 1
    for (const [id, timer] of due) {
      if (!this.timers.delete(id)) continue
      timer.callback()
    }
  }
}

function longRows(count = 64) {
  return Array.from({ length: count }, (_, index) => ({
    key: `node-${index}`,
    height: 28 + index % 7 * 3
  }))
}

function rowTop(rows, key) {
  let top = 0
  for (const row of rows) {
    if (row.key === key) return top
    top += row.height
  }
  throw new Error(`missing row ${key}`)
}

class ScrollSession {
  constructor({ rows, record = { saved: null }, clock = new FakeClock(), clientHeight = 320 }) {
    this.rows = rows
    this.record = record
    this.clock = clock
    this.clientHeight = clientHeight
    this.scrollTop = 0
    this.observedTop = 0
    this.following = record.saved === null
    this.pending = false
    this.intentReads = new Map()
    this.semanticReads = new Map()
    this.layoutWrites = new Map()
    this.bottomWrites = 0
    this.applySaved()
    this.resetBudget()
    this.ready = this.initializeMachine()
  }

  get scrollHeight() {
    return this.rows.reduce((sum, row) => sum + row.height, 0)
  }

  get floor() {
    return Math.max(0, this.scrollHeight - this.clientHeight)
  }

  bump(map) {
    map.set(this.clock.frame, (map.get(this.clock.frame) || 0) + 1)
  }

  resetBudget() {
    this.intentReads.clear()
    this.semanticReads.clear()
    this.layoutWrites.clear()
    this.bottomWrites = 0
  }

  applySaved() {
    if (this.record.saved === null) {
      this.scrollTop = this.floor
      this.following = true
    } else {
      this.scrollTop = rowTop(this.rows, this.record.saved.anchorKey) - this.record.saved.anchorTop
      this.following = false
    }
    this.observedTop = this.scrollTop
  }

  currentAnchor() {
    let top = 0
    for (const row of this.rows) {
      if (top + row.height > this.scrollTop) {
        return {
          anchorKey: row.key,
          anchorTop: top - this.scrollTop,
          scrollTop: this.scrollTop
        }
      }
      top += row.height
    }
    const row = this.rows.at(-1)
    return row === undefined ? null : {
      anchorKey: row.key,
      anchorTop: top - row.height - this.scrollTop,
      scrollTop: this.scrollTop
    }
  }

  initializeMachine() {
    return import('../scripts/patch-official-runtime.mjs').then(({ createChatScrollIntentMachine, deriveChatScrollIntent }) => {
      this.deriveChatScrollIntent = deriveChatScrollIntent
      this.machine = createChatScrollIntentMachine({
        commitIntent: () => this.commitIntent(),
        sample: () => this.sampleAnchor(),
        setPending: pending => {
          this.pending = pending
        },
        requestFrame: callback => this.clock.requestFrame(callback),
        cancelFrame: frame => this.clock.cancelFrame(frame),
        setTimer: (callback, delay) => this.clock.setTimer(callback, delay),
        clearTimer: timer => this.clock.clearTimer(timer),
        sampleInterval: 500
      })
      return this
    })
  }

  commitIntent() {
    this.bump(this.intentReads)
    const intent = this.deriveChatScrollIntent(
      this.scrollTop,
      this.scrollHeight,
      this.clientHeight,
      this.observedTop,
      this.following
    )
    this.observedTop = intent.scrollTop
    this.following = intent.following
    if (intent.following) this.record.saved = null
    return intent
  }

  sampleAnchor() {
    this.bump(this.semanticReads)
    const intent = this.commitIntent()
    if (!intent.following) {
      const position = this.currentAnchor()
      if (position !== null) this.record.saved = position
    }
  }

  readerScroll(top) {
    this.scrollTop = Math.max(0, Math.min(top, this.floor))
    this.machine.scroll()
  }

  scrollEnd() {
    this.machine.scrollEnd()
  }

  settleSample() {
    this.clock.runFrame()
    this.clock.advance(500)
  }

  writeBottom() {
    this.bump(this.layoutWrites)
    this.bottomWrites += 1
    this.scrollTop = this.floor
    this.observedTop = this.scrollTop
    this.following = true
    this.record.saved = null
  }

  reflow(key, delta) {
    const row = this.rows.find(candidate => candidate.key === key)
    assert.ok(row, `missing reflow row ${key}`)
    row.height += delta
    if (this.following) this.writeBottom()
  }

  resize(clientHeight) {
    this.clientHeight = clientHeight
    if (this.following) this.writeBottom()
  }

  dispose() {
    this.machine.dispose()
  }
}

async function session(options) {
  const value = new ScrollSession(options)
  await value.ready
  return value
}

test('matrix 1: more than fifty nodes retain a sampled semantic reader anchor', async () => {
  const rows = longRows(72)
  const record = { saved: null }
  const view = await session({ rows, record })
  const targetTop = rowTop(rows, 'node-37') + 9
  view.readerScroll(targetTop)
  assert.equal(view.following, false, 'reader intent commits on the scroll event')
  assert.equal(record.saved, null, 'heavy semantic work remains deferred')
  view.settleSample()
  assert.equal(record.saved.anchorKey, 'node-37')
  assert.equal(record.saved.anchorTop, -9)
  assert.equal(view.pending, false)
})

test('matrix 2: card, Goal, and tool-result reflow follows only a follower', async () => {
  const followerRows = longRows(60)
  const follower = await session({ rows: followerRows })
  for (const [key, delta] of [['node-8', 140], ['node-18', 220], ['node-31', 180]]) {
    follower.clock.runFrame()
    follower.reflow(key, delta)
    assert.equal(follower.scrollTop, follower.floor)
    assert.equal(follower.record.saved, null)
  }
  assert.equal(follower.bottomWrites, 3)

  const readerRows = longRows(60)
  const readerRecord = { saved: null }
  const reader = await session({ rows: readerRows, record: readerRecord })
  reader.readerScroll(rowTop(readerRows, 'node-24') + 5)
  assert.equal(reader.following, false)
  for (const [key, delta] of [['node-4', 140], ['node-11', 220], ['node-41', 180]]) reader.reflow(key, delta)
  assert.equal(reader.bottomWrites, 0, 'pending sampling must not turn reader reflow into follow')
  reader.settleSample()
  assert.notEqual(readerRecord.saved, null)
})

test('matrix 3: a sub-16ms session switch flushes the old DOM reader anchor', async () => {
  const rows = longRows(68)
  const record = { saved: null }
  const oldView = await session({ rows, record })
  oldView.readerScroll(rowTop(rows, 'node-29') + 7)
  assert.equal(oldView.clock.now, 0)
  assert.equal(oldView.pending, true)
  oldView.dispose()
  assert.equal(oldView.pending, false)
  assert.equal(record.saved.anchorKey, 'node-29')
  assert.equal(record.saved.anchorTop, -7)
  assert.equal(oldView.clock.timers.size, 0)
  assert.equal(oldView.clock.frames.size, 0)
  const restored = await session({ rows, record, clock: oldView.clock })
  assert.equal(restored.currentAnchor().anchorKey, 'node-29')
  assert.ok(Math.abs(restored.currentAnchor().anchorTop + 7) <= 1)
})

test('matrix 4: twenty A/B alternations keep independent session anchors stable', async () => {
  const rowsBySession = {
    A: longRows(64),
    B: longRows(67).map((row, index) => ({ ...row, height: row.height + index % 3 }))
  }
  const records = { A: { saved: null }, B: { saved: null } }
  const expected = {}
  for (let index = 0; index < 20; index += 1) {
    for (const name of ['A', 'B']) {
      const view = await session({ rows: rowsBySession[name], record: records[name] })
      if (expected[name] === undefined) {
        const key = name === 'A' ? 'node-21' : 'node-33'
        const offset = name === 'A' ? 4 : 11
        view.readerScroll(rowTop(rowsBySession[name], key) + offset)
        view.dispose()
        expected[name] = { anchorKey: key, anchorTop: -offset }
      } else {
        const current = view.currentAnchor()
        assert.equal(current.anchorKey, expected[name].anchorKey, `${name} anchor identity drifted on alternation ${index}`)
        assert.ok(Math.abs(current.anchorTop - expected[name].anchorTop) <= 1, `${name} anchor offset drifted on alternation ${index}`)
        view.dispose()
      }
    }
  }
})

test('matrix 5: late hydration follows a synced follower and never swallows a synced reader', async () => {
  const followerRows = longRows(58)
  const follower = await session({ rows: followerRows })
  follower.readerScroll(follower.floor)
  assert.equal(follower.pending, true)
  assert.equal(follower.following, true)
  follower.reflow('node-57', 500)
  assert.equal(follower.scrollTop, follower.floor, 'pending semantic sampling cannot suppress ResizeObserver follow')
  assert.equal(follower.record.saved, null)

  const readerRows = longRows(58)
  const reader = await session({ rows: readerRows })
  reader.readerScroll(rowTop(readerRows, 'node-20') + 3)
  assert.equal(reader.pending, true)
  assert.equal(reader.following, false)
  const before = reader.scrollTop
  reader.reflow('node-2', 500)
  assert.equal(reader.scrollTop, before, 'late hydration cannot snap an active reader to bottom')
  assert.equal(reader.bottomWrites, 0)
})

test('matrix 6: semantic restoration holds reader anchor error to one pixel after mixed reflow', async () => {
  const rows = longRows(70)
  const record = { saved: null }
  const reader = await session({ rows, record })
  reader.readerScroll(rowTop(rows, 'node-40') + 6.4)
  reader.settleSample()
  const expected = { ...record.saved }
  reader.dispose()
  rows.find(row => row.key === 'node-3').height += 137.25
  rows.find(row => row.key === 'node-15').height += 211.5
  rows.find(row => row.key === 'node-27').height += 89.75
  const restored = await session({ rows, record })
  const current = restored.currentAnchor()
  assert.equal(current.anchorKey, expected.anchorKey)
  assert.ok(Math.abs(current.anchorTop - expected.anchorTop) <= 1, `anchor error ${Math.abs(current.anchorTop - expected.anchorTop)}px`)
})

test('matrix 7: resize and zoom preserve the 25px follow threshold and reader semantics', async () => {
  const { deriveChatScrollIntent } = await import('../scripts/patch-official-runtime.mjs')
  assert.equal(deriveChatScrollIntent(675, 1000, 300, 650, false).following, true, 'exactly 25px follows')
  assert.equal(deriveChatScrollIntent(674.99, 1000, 300, 650, true).following, false, 'more than 25px is reader intent')

  const follower = await session({ rows: longRows(62), clientHeight: 320 })
  follower.clock.runFrame()
  follower.resize(240)
  assert.equal(follower.scrollTop, follower.floor)
  assert.equal(follower.record.saved, null)

  const rows = longRows(62)
  const record = { saved: null }
  const reader = await session({ rows, record, clientHeight: 320 })
  reader.readerScroll(rowTop(rows, 'node-34') + 8)
  reader.settleSample()
  reader.dispose()
  for (const row of rows) row.height *= 1.25
  const zoomed = await session({ rows, record, clientHeight: 256 })
  const current = zoomed.currentAnchor()
  assert.equal(current.anchorKey, record.saved.anchorKey)
  assert.ok(Math.abs(current.anchorTop - record.saved.anchorTop) <= 1)
  assert.equal(zoomed.following, false)
})

test('matrix 8: scroll work stays frame-bounded and never writes bottom for a reader unconditionally', async () => {
  const rows = longRows(66)
  const reader = await session({ rows })
  const base = rowTop(rows, 'node-26')
  for (let offset = 0; offset < 12; offset += 1) reader.readerScroll(base + offset)
  assert.equal(reader.intentReads.get(0), 1, 'same-frame scroll events share one cheap intent commit')
  assert.equal(reader.bottomWrites, 0)
  reader.clock.runFrame()
  for (let offset = 12; offset < 24; offset += 1) reader.readerScroll(base + offset)
  assert.equal(reader.intentReads.get(1), 1, 'the next frame gets exactly one cheap intent commit')
  reader.clock.runFrame()
  reader.clock.advance(500)
  assert.ok([...reader.intentReads.values()].every(count => count <= 1))
  assert.ok([...reader.semanticReads.values()].every(count => count <= 1))
  assert.ok([...reader.layoutWrites.values()].every(count => count <= 1))
  assert.equal(reader.bottomWrites, 0)

  const {
    patchAlpha5ChatScrollSource,
    restoreAlpha5ChatScrollSource
  } = await import('../scripts/patch-official-runtime.mjs')
  const installed = readFileSync(CHAT_FILE, 'utf8')
  const patched = patchAlpha5ChatScrollSource(restoreAlpha5ChatScrollSource(installed)).source
  assert.match(patched, /if \(intent\.following\) \{\s*anchorRef\.current = null;\s*chatScroll\.save\(null\);/u)
  assert.match(patched, /if \(local !== null && atBottomRef\.current\) \{\s*const el = scrollerOf\(local\);\s*el\.scrollTop = el\.scrollHeight;/u)
  assert.doesNotMatch(patched, /Pending means only that the semantic anchor is deferred;[\s\S]{0,180}if \(scrollSamplePendingRef\.current\) return;/u)
  assert.doesNotMatch(patched, /Reader\/follower intent is already current;[\s\S]{0,180}if \(scrollSamplePendingRef\.current\) return;/u)
})
