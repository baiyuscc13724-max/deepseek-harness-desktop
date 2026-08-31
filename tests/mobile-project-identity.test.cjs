'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const runtimePath = path.join(root, 'mobile', 'android', 'app', 'src', 'main', 'assets', 'mobile-runtime.js')
const cssPath = path.join(root, 'mobile', 'android', 'app', 'src', 'main', 'assets', 'mobile-compat.css')
const runtime = fs.readFileSync(runtimePath, 'utf8')
const css = fs.readFileSync(cssPath, 'utf8')
const iosRuntime = fs.readFileSync(path.join(root, 'mobile', 'ios', 'HarnessMobile', 'Resources', 'mobile-runtime.js'), 'utf8')
const iosCss = fs.readFileSync(path.join(root, 'mobile', 'ios', 'HarnessMobile', 'Resources', 'mobile-compat.css'), 'utf8')

function extractProjectFunctions() {
  const start = runtime.indexOf('  const readAuthoritativeProjects = async () => {')
  const end = runtime.indexOf('  const openProjectIdentitySheet = async () => {', start)
  assert.ok(start >= 0 && end > start)
  const source = runtime.slice(start, end)
  return new Function('WebSocket', 'navigator', 'document', `${source}\nreturn { readAuthoritativeProjects, copyProjectIdentity }`) // eslint-disable-line no-new-func
}

test('project details consume the authoritative workspace/follow baseline', async () => {
  let url, opened
  class FakeWebSocket {
    constructor(value) { url = value; this.listeners = new Map(); queueMicrotask(() => this.emit('open', {})) }
    addEventListener(type, listener) { this.listeners.set(type, listener) }
    emit(type, event) { this.listeners.get(type)?.(event) }
    send(raw) {
      opened = JSON.parse(raw)
      queueMicrotask(() => this.emit('message', { data: JSON.stringify({ type: 'item', streamId: opened.streamId, value: { type: 'baseline', value: { items: [{ workspaceId: 'workspace-official-123', title: '权威项目名', path: 'D:/must-not-render', sessionIds: [] }], archivedSessionIds: [] } } }) }))
    }
    close() {}
  }
  const api = extractProjectFunctions()(FakeWebSocket, {}, {})
  const projects = await api.readAuthoritativeProjects()
  assert.match(url, /^ws:\/\/127\.0\.0\.1\/api\/remote\.mux$/u)
  assert.deepEqual(opened, { type: 'open', streamId: opened.streamId, endpoint: 'workspace/follow', payload: { args: {} } })
  assert.deepEqual(projects, [{ workspaceId: 'workspace-official-123', title: '权威项目名' }])
  assert.equal('path' in projects[0], false)
})

test('project identity has explicit copy controls, feedback, and no inferred identifiers', () => {
  assert.match(runtime, /data-harness-mobile-project-details>项目详情<\/button>/u)
  assert.match(runtime, /copyName\.textContent = '复制名称'/u)
  assert.match(runtime, /copyId\.textContent = '复制 ID'/u)
  assert.match(runtime, /已复制项目名称/u)
  assert.match(runtime, /已复制项目 ID/u)
  assert.doesNotMatch(runtime, /workspaceId\s*=\s*project\.title|workspaceId\s*=\s*.*path/u)
})

test('message and project text are selectable while actions remain touch safe', () => {
  assert.match(css, /\[data-chat-flow-kind\][^]*-webkit-user-select:\s*text !important;/u)
  assert.match(css, /\[data-harness-mobile-project-identity="true"\] strong,[^]*user-select:\s*text !important;/u)
  assert.match(css, /\[data-harness-mobile-project-identity="true"\] button[^]*min-height:\s*48px;/u)
  assert.equal(runtime, iosRuntime)
  assert.equal(css, iosCss)
})
