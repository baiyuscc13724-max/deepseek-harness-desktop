'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const android = path.join(root, 'mobile', 'android', 'app', 'src', 'main')
const read = (...parts) => fs.readFileSync(path.join(android, ...parts), 'utf8')

const activity = read('java', 'io', 'harnessdesktop', 'mobile', 'MainActivity.java')
const documentViewer = read('java', 'io', 'harnessdesktop', 'mobile', 'MobileDocumentViewer.java')
const adapter = read('java', 'io', 'harnessdesktop', 'mobile', 'MobileUiAdapter.java')
const proxy = read('java', 'io', 'harnessdesktop', 'mobile', 'HarnessWebProxy.java')
const manifest = read('AndroidManifest.xml')
const filePaths = read('res', 'xml', 'mobile_file_paths.xml')
const mobileRuntime = read('assets', 'mobile-runtime.js')
const mobileCss = read('assets', 'mobile-compat.css')

function extractJavaStringConstant(source, name) {
  const start = source.indexOf(`String ${name} =`)
  assert.notEqual(start, -1, `${name} constant must exist`)
  const tail = source.slice(start)
  const terminator = tail.search(/;\r?\n/u)
  assert.notEqual(terminator, -1, `${name} constant must terminate on its declaration line`)
  const expression = tail.slice(0, terminator)
  return [...expression.matchAll(/"((?:\\.|[^"\\])*)"/g)]
    .map(match => JSON.parse(`"${match[1]}"`))
    .join('')
}

test('Java string extraction is independent of checkout line endings', () => {
  const source = 'String SAMPLE =\r\n    "const mobile = true;";\r\nString NEXT = "ignored";\r\n'
  assert.equal(extractJavaStringConstant(source, 'SAMPLE'), 'const mobile = true;')
})

test('injected composer input script is valid JavaScript', () => {
  const script = extractJavaStringConstant(adapter, 'FILE_ENTRY_JS')
  assert.doesNotThrow(() => new Function(script))
})

test('native input bridge follows official contenteditable state and inserts speech through the editor path', () => {
  const script = extractJavaStringConstant(adapter, 'FILE_ENTRY_JS')
  const preludeStart = script.indexOf('var currentCard=')
  const preludeEnd = script.indexOf('var copyFile=', preludeStart)
  const speechStart = script.indexOf('window.__harnessMobileReceiveSpeech=')
  const speechEnd = script.indexOf('var syncState=', speechStart)
  assert.ok(preludeStart >= 0 && preludeEnd > preludeStart && speechStart >= 0 && speechEnd > speechStart)
  const source = `${script.slice(preludeStart, preludeEnd)}${script.slice(speechStart, speechEnd)}`
  assert.match(source, /\[data-composer-input\]\[data-phase\],textarea\[data-phase\]/u)
  assert.match(source, /document\.execCommand\('insertText',false,text\)/u)
  assert.doesNotMatch(source, /textContent\s*=/u, 'Lexical content must not be mutated behind the official editor state')

  const attributes = new Map([['data-phase', 'active'], ['contenteditable', 'true']])
  const selectionNode = {}
  let focused = 0
  const editor = {
    tagName: 'DIV',
    disabled: false,
    getAttribute: name => attributes.get(name) ?? null,
    focus: () => { focused += 1 },
    contains: node => node === selectionNode
  }
  const card = { querySelector: selector => selector === '[data-composer-input][data-phase],textarea[data-phase]' ? editor : null }
  const insertions = []
  const documentMock = {
    querySelector: selector => selector.includes('[data-composer-card]') ? card : null,
    execCommand: (command, _ui, value) => { insertions.push({ command, value }); return true }
  }
  const windowMock = { getSelection: () => ({ anchorNode: selectionNode }) }
  const receiveSpeech = new Function('window', 'document', 'HTMLTextAreaElement', 'Event', 'InputEvent', `${source}; return window.__harnessMobileReceiveSpeech`) ( // eslint-disable-line no-new-func
    windowMock, documentMock, class {}, class {}, class {}
  )
  receiveSpeech('排队后的下一条')
  assert.equal(focused, 1)
  assert.deepEqual(insertions, [{ command: 'insertText', value: '排队后的下一条' }])

  attributes.set('contenteditable', 'false')
  receiveSpeech('不应插入')
  assert.equal(insertions.length, 1)
})

test('new-session image and document wait for the official workspace before intake', async () => {
  const script = extractJavaStringConstant(adapter, 'FILE_ENTRY_JS')
  const documentListeners = new Map()
  const makeNode = tagName => {
    const listeners = new Map()
    const node = {
      tagName,
      id: '',
      dataset: {},
      style: {},
      children: [],
      parentElement: null,
      hidden: false,
      disabled: false,
      readOnly: false,
      value: '',
      setAttribute(name, value) { node[name] = String(value) },
      getAttribute(name) { return node[name] ?? null },
      removeAttribute(name) { delete node[name] },
      appendChild(child) { child.parentElement = node; node.children.push(child); return child },
      removeChild(child) { node.children = node.children.filter(item => item !== child); child.parentElement = null },
      addEventListener(type, listener) { (listeners.get(type) || listeners.set(type, []).get(type)).push(listener) },
      dispatchEvent(event) { for (const listener of listeners.get(event.type) || []) listener(event); return !event.defaultPrevented },
      querySelector() { return null },
      querySelectorAll() { return [] },
      contains(target) { return target === node || node.children.includes(target) },
      click() { node.dispatchEvent(new FakeEvent('click')) },
      blur() {},
      focus() {}
    }
    return node
  }
  class FakeEvent {
    constructor(type, init = {}) { this.type = type; Object.assign(this, init); this.defaultPrevented = false }
    preventDefault() { if (this.cancelable) this.defaultPrevented = true }
    stopPropagation() { this.propagationStopped = true }
  }
  class FakeCustomEvent extends FakeEvent {
    constructor(type, init = {}) { super(type, init); this.detail = init.detail }
  }
  class FakeFile {
    constructor(parts, name, options = {}) {
      this.parts = parts
      this.name = name
      this.type = options.type || ''
      this.lastModified = options.lastModified || 0
      this.size = parts.reduce((sum, part) => sum + (part.byteLength || part.length || 0), 0)
    }
  }
  class FakeFileReader {
    readAsArrayBuffer(file) {
      this.result = file.bytes
      queueMicrotask(() => this.onload?.())
    }
  }
  class FakeMutationObserver { observe() {}; disconnect() {} }
  const body = makeNode('body')
  const card = makeNode('section')
  const textarea = makeNode('textarea')
  textarea.readOnly = true
  textarea.dataset.phase = 'inert'
  textarea['data-phase'] = 'inert'
  textarea['aria-haspopup'] = 'menu'
  textarea.closest = selector => selector === '[data-composer-card]' ? card : null
  let workspaceRequests = 0
  card.click = () => {
    workspaceRequests++
    textarea.readOnly = false
    textarea.dataset.phase = 'active'
    textarea['data-phase'] = 'active'
    queueMicrotask(() => {
      windowMock.__harnessMobileCurrentSessionId = `session-${workspaceRequests}`
      windowMock.dispatchEvent(new FakeCustomEvent('harness-mobile-session-history-receipt', {
        detail: { sessionId: windowMock.__harnessMobileCurrentSessionId }
      }))
    })
  }
  const railImages = []
  card.querySelector = selector => selector === '[data-composer-input][data-phase],textarea[data-phase]' ? textarea : null
  card.querySelectorAll = selector => selector === '[role="group"] img[alt]' ? railImages : []
  const findById = (node, id) => {
    if (node.id === id) return node
    for (const child of node.children) {
      const match = findById(child, id)
      if (match) return match
    }
    return null
  }
  const documentMock = {
    body,
    documentElement: body,
    createElement: makeNode,
    getElementById: id => findById(body, id) || findById(card, id),
    querySelector: selector => {
      if (selector === '[data-composer-card]') return card
      if (selector === '[data-composer-card] textarea[data-phase]') return textarea
      return null
    },
    addEventListener(type, listener) { (documentListeners.get(type) || documentListeners.set(type, []).get(type)).push(listener) },
    dispatchEvent(event) { for (const listener of documentListeners.get(event.type) || []) listener(event); return !event.defaultPrevented }
  }
  let acceptImageDrops = true
  documentMock.addEventListener('drop', event => {
    if (!acceptImageDrops || !event.dataTransfer?.types?.includes('Files')) return
    for (const file of event.dataTransfer.files) {
      railImages.push({ getAttribute: name => name === 'alt' ? file.name : null })
    }
  })
  const windowListeners = new Map()
  const receivedDocuments = []
  const windowMock = {
    innerWidth: 390,
    __harnessMobileCurrentSessionId: 'stale-session',
    dispatchEvent(event) { for (const listener of windowListeners.get(event.type) || []) listener(event); return !event.defaultPrevented },
    addEventListener(type, listener) { (windowListeners.get(type) || windowListeners.set(type, []).get(type)).push(listener) },
    removeEventListener(type, listener) {
      const listeners = windowListeners.get(type) || []
      const index = listeners.indexOf(listener)
      if (index >= 0) listeners.splice(index, 1)
    },
    __harnessMobileReceiveDocuments(files) {
      receivedDocuments.push(...files.map(file => ({ name: file.name, sessionId: windowMock.__harnessMobileCurrentSessionId })))
      return true
    }
  }
  const timers = new Map()
  let nextTimer = 0
  const setTimeoutMock = (callback, delay = 0) => { const id = ++nextTimer; timers.set(id, { callback, delay }); return id }
  const clearTimeoutMock = id => timers.delete(id)
  const bridge = { open() {} }
  new Function('window', 'document', 'HarnessMobileInputs', 'FileReader', 'File', 'Event', 'CustomEvent', 'MutationObserver', 'setTimeout', 'clearTimeout', 'setInterval', 'HTMLTextAreaElement', 'fetch', script)(
    windowMock, documentMock, bridge, FakeFileReader, FakeFile, FakeEvent, FakeCustomEvent,
    FakeMutationObserver, setTimeoutMock, clearTimeoutMock, () => 1, class {}, async () => new Response()
  )
  const plus = documentMock.getElementById('harness-mobile-input-button')
  const menu = documentMock.getElementById('harness-mobile-input-menu')
  assert.ok(plus)
  assert.equal(plus.disabled, false, 'the new-session workspace trigger must keep attachment intake available')
  plus.click()
  assert.equal(menu.hidden, false, 'tapping plus must open the native input choices')
  assert.equal(plus['aria-expanded'], 'true')
  plus.click()
  assert.equal(menu.hidden, true)
  const input = documentMock.getElementById('harness-mobile-photo-input')
  assert.ok(input)
  input.files = [{ name: 'phone-photo.png', type: 'image/png', lastModified: 1, bytes: new Uint8Array([1, 2, 3]) }]
  input.dispatchEvent(new FakeEvent('change'))
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(workspaceRequests, 1)
  assert.equal(railImages.length, 1)
  assert.equal(railImages[0].getAttribute('alt'), 'phone-photo.png')
  assert.equal(windowMock.__harnessMobileAttachmentState?.phase, 'success')
  assert.equal(windowMock.__harnessMobileAttachmentState?.count, 1)

  textarea.readOnly = true
  textarea.dataset.phase = 'inert'
  textarea['data-phase'] = 'inert'
  windowMock.__harnessMobileCurrentSessionId = 'stale-session'
  const fileInput = documentMock.getElementById('harness-mobile-file-input')
  assert.ok(fileInput)
  fileInput.files = [
    { name: 'workspace-photo.png', type: 'image/png', lastModified: 2, bytes: new Uint8Array([4, 5, 6]) },
    { name: 'brief.pdf', type: 'application/pdf', lastModified: 3, bytes: new Uint8Array([7, 8, 9]) }
  ]
  fileInput.dispatchEvent(new FakeEvent('change'))
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(workspaceRequests, 2, 'a mixed selection must open the workspace picker only once')
  assert.equal(railImages.at(-1).getAttribute('alt'), 'workspace-photo.png')
  assert.deepEqual(receivedDocuments, [{ name: 'brief.pdf', sessionId: 'session-2' }], 'documents must not upload into the stale session')

  acceptImageDrops = false
  const railCountBeforeRejectedDrop = railImages.length
  input.files = [{ name: 'not-accepted.png', type: 'image/png', lastModified: 4, bytes: new Uint8Array([10]) }]
  input.dispatchEvent(new FakeEvent('change'))
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(windowMock.__harnessMobileAttachmentState?.phase, 'pending')
  const rejectionTimer = [...timers.values()].find(timer => timer.delay === 8000)
  assert.ok(rejectionTimer, 'the exact injected JS must wait for official rail acceptance')
  rejectionTimer.callback()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(railImages.length, railCountBeforeRejectedDrop)
  assert.equal(windowMock.__harnessMobileAttachmentState?.phase, 'error', 'dispatching drop alone must never report success')
})

test('composer plus menu exposes exactly the four native input choices', () => {
  for (const label of ['相册', '拍摄', '语音输入', '文件']) {
    assert.match(adapter, new RegExp(`addItem\\('${label}'`))
  }
  assert.equal((adapter.match(/addItem\('/g) || []).length, 4)
  assert.match(adapter, /aria-haspopup','menu'/)
  assert.match(adapter, /aria-expanded','false'/)
  assert.match(adapter, /setAttribute\('role','menuitem'\)/)
  assert.match(adapter, /var currentCard=function\(\).*data-phase/u, 'attachment state must follow the active mobile composer rather than the first stale card')
  assert.match(adapter, /var mount=function\(\).*currentCard\(\).*staleEntry/u, 'a composer remount must move the plus entry to the current card')
  assert.match(adapter, /var syncOrMount=function\(\).*card\.contains\(button\)/u, 'an old connected plus button must not block mounting in a new conversation')
})

test('composer attachment entry follows the active card across official remounts', () => {
  const script = extractJavaStringConstant(adapter, 'FILE_ENTRY_JS')
  const currentCardSource = script.match(/var currentCard=(function\(\)\{.*?\});var currentTextarea/u)?.[1]
  const syncSource = script.match(/var syncOrMount=(function\(\)\{.*?\});var affectsEntry/u)?.[1]
  assert.ok(currentCardSource)
  assert.ok(syncSource)

  const active = { id: 'active' }
  const mobile = { id: 'mobile' }
  const fallback = { id: 'fallback' }
  const choices = new Map([
    ['[data-phase="active"] [data-composer-card]', active],
    ['[data-harness-mobile-conversation="true"] [data-composer-card]', mobile],
    ['[data-composer-card]', fallback]
  ])
  const currentCard = new Function('document', `var currentCard=${currentCardSource}; return currentCard`)({ querySelector: selector => choices.get(selector) || null }) // eslint-disable-line no-new-func
  assert.equal(currentCard(), active)
  choices.set('[data-phase="active"] [data-composer-card]', null)
  assert.equal(currentCard(), mobile)

  const staleButton = {}
  let mountCalls = 0
  let syncCalls = 0
  let ownsButton = false
  const current = { contains: node => ownsButton && node === staleButton }
  const syncOrMount = new Function('currentCard', 'document', 'syncState', 'mount', `var syncOrMount=${syncSource}; return syncOrMount`)(
    () => current,
    { getElementById: () => staleButton },
    () => { syncCalls += 1 },
    () => { mountCalls += 1 }
  ) // eslint-disable-line no-new-func
  syncOrMount()
  assert.equal(mountCalls, 1, 'a stale connected plus entry must be replaced')
  assert.equal(syncCalls, 0)
  ownsButton = true
  syncOrMount()
  assert.equal(syncCalls, 1, 'the current card keeps and refreshes its own plus entry')
})

test('picker URI images survive an active contenteditable composer remount and enter the official rail in order', async () => {
  const script = extractJavaStringConstant(adapter, 'FILE_ENTRY_JS')
  const documentListeners = new Map()
  const windowListeners = new Map()
  const observers = []
  const timers = new Map()
  let nextTimer = 0

  const findNode = (node, predicate) => {
    if (predicate(node)) return node
    for (const child of node.children || []) {
      const found = findNode(child, predicate)
      if (found) return found
    }
    return null
  }
  const makeNode = tagName => {
    const listeners = new Map()
    const attributes = new Map()
    const node = {
      nodeType: 1,
      tagName: String(tagName).toUpperCase(),
      id: '',
      style: {},
      children: [],
      parentElement: null,
      hidden: false,
      disabled: false,
      value: '',
      setAttribute(name, value) {
        const text = String(value)
        attributes.set(name, text)
        if (name === 'id') node.id = text
      },
      getAttribute(name) { return name === 'id' ? node.id || null : attributes.get(name) ?? null },
      appendChild(child) { child.parentElement = node; node.children.push(child); return child },
      insertBefore(child, before) {
        child.parentElement = node
        const index = node.children.indexOf(before)
        if (index < 0) node.children.push(child)
        else node.children.splice(index, 0, child)
        return child
      },
      removeChild(child) {
        node.children = node.children.filter(item => item !== child)
        child.parentElement = null
        return child
      },
      addEventListener(type, listener) { (listeners.get(type) || listeners.set(type, []).get(type)).push(listener) },
      dispatchEvent(event) {
        if (!event.target) event.target = node
        for (const listener of listeners.get(event.type) || []) listener(event)
        return !event.defaultPrevented
      },
      querySelector(selector) {
        if (selector === '[role=menuitem]') return findNode(node, candidate => candidate !== node && candidate.getAttribute?.('role') === 'menuitem')
        return null
      },
      querySelectorAll() { return [] },
      contains(target) { return target === node || node.children.some(child => child.contains?.(target)) },
      matches(selector) {
        if (selector === '[data-composer-card]') return node.getAttribute('data-composer-card') !== null
        if (selector.includes('[data-composer-input][data-phase]')) return node.getAttribute('data-composer-input') !== null && node.getAttribute('data-phase') !== null
        return false
      },
      closest(selector) {
        for (let current = node; current; current = current.parentElement) {
          if (current.matches?.(selector)) return current
        }
        return null
      },
      click() { node.dispatchEvent(new FakeEvent('click')) },
      blur() {},
      focus() {}
    }
    return node
  }
  const makeComposer = label => {
    const card = makeNode('section')
    card.setAttribute('data-composer-card', 'true')
    card.label = label
    const editor = makeNode('div')
    editor.setAttribute('data-composer-input', 'true')
    editor.setAttribute('data-phase', 'active')
    editor.setAttribute('contenteditable', 'true')
    let blurCount = 0
    editor.blur = () => { blurCount += 1 }
    card.appendChild(editor)
    const rail = []
    const inheritedQuery = card.querySelector.bind(card)
    card.querySelector = selector => {
      if (selector === '[data-composer-input][data-phase],textarea[data-phase]') return editor
      if (selector === '[aria-haspopup="listbox"]') return null
      return inheritedQuery(selector)
    }
    card.querySelectorAll = selector => selector === '[role="group"] img[alt]' ? rail : []
    return { card, editor, rail, blurCount: () => blurCount }
  }
  class FakeEvent {
    constructor(type, init = {}) { this.type = type; Object.assign(this, init); this.defaultPrevented = false }
    preventDefault() { if (this.cancelable) this.defaultPrevented = true }
    stopPropagation() { this.propagationStopped = true }
  }
  class FakeCustomEvent extends FakeEvent {
    constructor(type, init = {}) { super(type, init); this.detail = init.detail }
  }
  class FakeFile {
    constructor(parts, name, options = {}) {
      const part = parts[0]
      const bytes = part instanceof ArrayBuffer
        ? new Uint8Array(part.slice(0))
        : part instanceof Uint8Array
          ? part.slice()
          : new Uint8Array()
      this.bytes = bytes
      this.name = name
      this.type = options.type || ''
      this.lastModified = options.lastModified || 0
      this.size = bytes.byteLength
    }
  }
  class FakeFileReader {
    readAsArrayBuffer(file) {
      try {
        const bytes = file.bytes
        this.result = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
        queueMicrotask(() => this.onload?.())
      } catch (error) {
        this.error = error
        queueMicrotask(() => this.onerror?.())
      }
    }
  }
  class FakeMutationObserver {
    constructor(callback) { this.callback = callback; this.connected = false; observers.push(this) }
    observe(target, options) { this.target = target; this.options = options; this.connected = true }
    disconnect() { this.connected = false }
  }
  const notifyMutation = records => {
    for (const observer of observers.filter(candidate => candidate.connected)) {
      const relevant = records.filter(record => record.target === observer.target || (observer.options?.subtree && observer.target.contains?.(record.target)))
      if (relevant.length) observer.callback(relevant)
    }
  }

  const body = makeNode('body')
  const stale = makeComposer('stale-first-global-card')
  stale.rail.push({ getAttribute: name => name === 'alt' ? 'uri-one.png' : null })
  body.appendChild(stale.card)
  let active = makeComposer('active-before-picker')
  body.appendChild(active.card)
  const byId = id => findNode(body, node => node.id === id)
  const documentMock = {
    body,
    documentElement: body,
    createElement: makeNode,
    getElementById: byId,
    querySelector(selector) {
      if (selector === '[data-phase="active"] [data-composer-card]') return active.card
      if (selector === '[data-harness-mobile-conversation="true"] [data-composer-card]') return active.card
      if (selector === '[data-composer-card]') return stale.card
      return null
    },
    addEventListener(type, listener) { (documentListeners.get(type) || documentListeners.set(type, []).get(type)).push(listener) },
    dispatchEvent(event) {
      if (!event.target) event.target = documentMock
      for (const listener of documentListeners.get(event.type) || []) listener(event)
      return !event.defaultPrevented
    }
  }
  const officialBatches = []
  documentMock.addEventListener('drop', event => {
    const transfer = event.dataTransfer
    if (!transfer || !transfer.types.includes('Files')) return
    event.preventDefault()
    const files = [...transfer.files]
    officialBatches.push({ composer: active.card.label, files })
    queueMicrotask(() => {
      const beforeIntakeRemount = active
      body.removeChild(beforeIntakeRemount.card)
      active = makeComposer('active-during-official-intake')
      for (const file of files) active.rail.push({ getAttribute: name => name === 'alt' ? file.name : null })
      body.appendChild(active.card)
      notifyMutation([{
        type: 'childList',
        target: body,
        addedNodes: [active.card],
        removedNodes: [beforeIntakeRemount.card]
      }])
    })
  })
  const windowMock = {
    innerWidth: 390,
    dispatchEvent(event) { for (const listener of windowListeners.get(event.type) || []) listener(event); return !event.defaultPrevented },
    addEventListener(type, listener) { (windowListeners.get(type) || windowListeners.set(type, []).get(type)).push(listener) },
    removeEventListener(type, listener) {
      const listeners = windowListeners.get(type) || []
      const index = listeners.indexOf(listener)
      if (index >= 0) listeners.splice(index, 1)
    }
  }
  const setTimeoutMock = (callback, delay = 0) => { const id = ++nextTimer; timers.set(id, { callback, delay }); return id }
  const clearTimeoutMock = id => timers.delete(id)
  new Function('window', 'document', 'HarnessMobileInputs', 'FileReader', 'File', 'Event', 'CustomEvent', 'MutationObserver', 'setTimeout', 'clearTimeout', 'setInterval', 'HTMLTextAreaElement', 'InputEvent', 'fetch', script)( // eslint-disable-line no-new-func
    windowMock, documentMock, {}, FakeFileReader, FakeFile, FakeEvent, FakeCustomEvent,
    FakeMutationObserver, setTimeoutMock, clearTimeoutMock, () => 1, class {}, class {}, async () => new Response()
  )

  const firstPlus = byId('harness-mobile-input-button')
  const firstMenu = byId('harness-mobile-input-menu')
  const pickerInput = byId('harness-mobile-photo-input')
  assert.ok(firstPlus && firstMenu && pickerInput)
  assert.equal(active.card.contains(firstPlus), true, 'plus must mount in the active contenteditable composer')
  assert.equal(stale.card.contains(firstPlus), false, 'the first stale global composer must never own the plus')
  assert.equal(firstMenu.parentElement, body, 'the picker menu must escape composer clipping')
  let pickerClicks = 0
  pickerInput.addEventListener('click', () => { pickerClicks += 1 })
  firstPlus.click()
  assert.equal(active.blurCount(), 1, 'opening the picker menu releases editor focus before Android launches a system surface')
  const gallery = firstMenu.children.find(item => item.getAttribute('aria-label') === '相册')
  assert.ok(gallery)
  gallery.click()
  assert.equal(pickerClicks, 1, 'the visible gallery action must launch the stable hidden input')

  const beforeRemount = active
  body.removeChild(beforeRemount.card)
  active = makeComposer('active-after-picker-remount')
  body.appendChild(active.card)
  windowMock.__harnessMobileInputEntryObserver.callback([{
    type: 'childList',
    target: body,
    addedNodes: [active.card],
    removedNodes: [beforeRemount.card]
  }])
  assert.equal(byId('harness-mobile-photo-input'), pickerInput, 'the WebView chooser callback anchor must survive the composer remount')
  assert.equal(pickerInput.parentElement, body, 'the picker-owned input must stay connected while URI grants are live')
  assert.equal(active.card.contains(byId('harness-mobile-input-button')), true, 'the visible plus must move to the remounted active composer')
  assert.notEqual(byId('harness-mobile-input-menu'), firstMenu, 'the body-level menu must be replaced with the active composer closure')

  let grantLive = true
  const uriFile = (name, values, lastModified) => ({
    name,
    type: 'image/png',
    lastModified,
    get bytes() {
      if (!grantLive) throw new Error('temporary content URI grant expired')
      return Uint8Array.from(values)
    }
  })
  const selected = [
    uriFile('uri-one.png', [1, 2, 3], 11),
    uriFile('uri-two.png', [4, 5, 6, 7], 12)
  ]
  pickerInput.files = selected
  pickerInput.dispatchEvent(new FakeEvent('change'))
  grantLive = false
  await new Promise(resolve => setImmediate(resolve))

  assert.equal(officialBatches.length, 1, 'one picker selection must issue one official document-level drop batch')
  assert.equal(officialBatches[0].composer, 'active-after-picker-remount')
  assert.equal(active.card.label, 'active-during-official-intake', 'rail acceptance must follow an official intake remount instead of the dispatched-to card')
  assert.equal(active.card.contains(byId('harness-mobile-input-button')), true, 'the visible plus must also follow the intake remount')
  assert.equal(byId('harness-mobile-photo-input'), pickerInput, 'the stable picker input must survive every composer remount')
  assert.deepEqual(officialBatches[0].files.map(file => file.name), ['uri-one.png', 'uri-two.png'], 'Photo Picker order must be preserved')
  assert.deepEqual(officialBatches[0].files.map(file => [...file.bytes]), [[1, 2, 3], [4, 5, 6, 7]], 'official intake must receive page-owned bytes after the URI grant expires')
  assert.notEqual(officialBatches[0].files[0], selected[0])
  assert.notEqual(officialBatches[0].files[1], selected[1])
  assert.deepEqual(active.rail.map(image => image.getAttribute('alt')), ['uri-one.png', 'uri-two.png'])
  assert.deepEqual(stale.rail.map(image => image.getAttribute('alt')), ['uri-one.png'], 'the first stale composer rail must remain untouched')
  assert.equal(windowMock.__harnessMobileAttachmentState?.phase, 'success', 'success requires the active official rail to render the whole batch')
  assert.equal(windowMock.__harnessMobileAttachmentState?.count, 2)
  assert.equal(pickerInput.value, '')
  assert.equal([...timers.values()].some(timer => timer.delay === 8000), false, 'active rail acceptance must settle without a guessed delivery delay')
  assert.ok(observers.some(observer => observer.target === body && observer.options?.attributeFilter?.includes('alt')), 'rail acceptance must observe the document root so a second remount remains visible')
})

test('composer frame stays inside its padded parent during focus and IME lift', () => {
  assert.match(mobileCss, /\[data-harness-mobile-composer-frame="true"\]\s*\{[^}]*width:\s*100% !important;[^}]*max-width:\s*100% !important;[^}]*min-width:\s*0 !important;/su)
  const frameRule = mobileCss.slice(mobileCss.indexOf('[data-harness-mobile-composer-frame="true"]'), mobileCss.indexOf('[data-composer-card]', mobileCss.indexOf('[data-harness-mobile-composer-frame="true"]')))
  assert.doesNotMatch(frameRule, /100vw/u, 'the frame must use its actual parent width instead of overflowing the viewport gutter')
})

test('composer reference style keeps a generous writing surface above one touch-safe toolbar', () => {
  assert.match(mobileCss, /display: flex !important;[^}]*flex-direction: column !important;[^}]*gap: 4px !important;/s)
  assert.match(mobileCss, /min-height: 132px !important;/)
  assert.match(mobileCss, /border-radius: 12px !important;/)
  assert.match(mobileCss, /#harness-mobile-input-button\s*\{[^}]*background: transparent !important;/s)
  assert.match(mobileCss, /\[data-harness-mobile-composer-action="true"\][^]*min-width: 48px !important;/s)
})

test('conversation images show their complete intrinsic frame before optional original-image zoom', () => {
  const imageRules = mobileCss.slice(mobileCss.indexOf('/* Conversation images must show'))
  assert.match(imageRules, /\[data-harness-mobile-conversation="true"\]/)
  assert.doesNotMatch(imageRules, /data-harness-mobile-chat-detail/, 'image fitting must also apply while the conversation drawer state settles')
  assert.match(imageRules, /\[data-slot="conversation\.message\.images"\]\s*\{[^}]*width: min\(calc\(100vw - 48px\), 420px\) !important;[^}]*max-width: 100% !important;/s)
  assert.match(imageRules, /grid-template-columns: repeat\(2, minmax\(0, 1fr\)\) !important;/)
  assert.match(imageRules, /button\[data-variant\]\s*\{[^}]*height: auto !important;[^}]*max-height: none !important;/s)
  assert.match(imageRules, /button\[data-variant\] img\s*\{[^}]*width: 100% !important;[^}]*height: auto !important;[^}]*object-fit: contain !important;/s)
  assert.doesNotMatch(imageRules, /object-fit: cover !important;/)
})

test('composer actions use a body-level touch-safe four-tile panel', () => {
  assert.match(adapter, /if\(textarea\)textarea\.blur\(\)/)
  assert.match(adapter, /\(document\.body\|\|document\.documentElement\)\.appendChild\(menu\)/, 'the fixed panel must escape transformed or clipped composer ancestors on real WebViews')
  assert.doesNotMatch(adapter, /wrapper\.appendChild\(menu\)/)
  assert.match(adapter, /!entry\.contains\(event\.target\)&&!menu\.contains\(event\.target\)/, 'portaling the panel must not make its own taps look like outside clicks')
  assert.match(adapter, /staleMenu&&staleMenu\.parentElement/, 'composer remounts must remove an orphaned body-level panel')
  assert.match(mobileCss, /#harness-mobile-input-menu:not\(\[hidden\]\)\s*\{[^}]*position: fixed !important;[^}]*left: 12px !important;[^}]*bottom: calc\(74px \+ env\(safe-area-inset-bottom\)\) !important;/s, 'the later visible-state rule must match the old selector specificity so its fixed viewport geometry wins')
  assert.match(mobileCss, /#harness-mobile-input-menu:not\(\[hidden\]\)\s*\{[^}]*grid-template-columns: repeat\(4, minmax\(0, 1fr\)\) !important;/s)
  assert.match(mobileCss, /#harness-mobile-input-menu\[hidden\]\s*\{\s*display: none !important;/s)
  assert.match(mobileCss, /min-height: 82px !important;/)
})

test('picker URIs keep temporary read grants through confirmed official attachment intake', () => {
  assert.match(activity, /ActivityResultContracts\.PickVisualMedia/)
  assert.match(activity, /new ActivityResultContracts\.PickMultipleVisualMedia\(MAX_PICKED_IMAGES\)/)
  assert.match(activity, /Intent\.ACTION_OPEN_DOCUMENT/)
  assert.match(activity, /Intent\.FLAG_GRANT_READ_URI_PERMISSION/)
  assert.match(activity, /Intent\.EXTRA_ALLOW_MULTIPLE, multiple/)
  assert.match(activity, /setAllowContentAccess\(true\)/)
  assert.doesNotMatch(activity, /takePersistableUriPermission/)
  assert.match(adapter, /photoInput\.click\(\)/)
  assert.match(adapter, /fileInput\.click\(\)/)
  assert.match(adapter, /reader\.readAsArrayBuffer\(file\)/)
  assert.match(adapter, /new File\(\[reader\.result\]/)

  // The attachment plugin owns a document-level drop listener. Use the exact
  // standard fields it reads without assuming DataTransfer is constructible,
  // and never dispatch a delayed paste fallback that could duplicate images.
  assert.match(adapter, /files:files,items:files\.map/)
  assert.match(adapter, /types:\['Files'\]/)
  assert.doesNotMatch(adapter, /new DataTransfer\(\)|typeof DataTransfer/)
  assert.match(adapter, /new Event\('drop'/)
  assert.match(adapter, /Object\.defineProperty\(drop,'dataTransfer'/)
  assert.match(adapter, /document\.dispatchEvent\(drop\)/)
  assert.doesNotMatch(adapter, /new Event\('paste'|clipboardData|dispatchPaste/)

  // Event dispatch itself is not acceptance. React must render every selected
  // filename in the official attachment rail within a bounded observation window.
  assert.match(adapter, /var waitForRail=/)
  assert.match(adapter, /new MutationObserver\(check\)/)
  assert.match(adapter, /querySelectorAll\('\[role=\\"group\\"\] img\[alt\]'\)/)
  assert.match(adapter, /waitForRail\(files,before,8000\)/)
  assert.doesNotMatch(adapter, /dispatchEvent\([^)]*\)\s*\?\s*/)
  assert.match(adapter, /__harnessMobileAttachmentState/)
  assert.match(adapter, /harness-mobile-attachment-state/)
  assert.match(adapter, /setAttachmentState\('error'/)
  assert.match(adapter, /var images=\[\];var documents=\[\]/)
  assert.match(adapter, /typeof window\.__harnessMobileReceiveDocuments==='function'/)
  assert.match(adapter, /当前电脑端还不能接收文档/)
  assert.doesNotMatch(manifest, /android\.permission\.(?:READ_MEDIA_IMAGES|READ_MEDIA_VIDEO|READ_EXTERNAL_STORAGE|WRITE_EXTERNAL_STORAGE)/)
})

test('system and edge back use the fixed runtime protocol without double dispatch', () => {
  assert.match(activity, /MOBILE_BACK_SCRIPT = "window\.__harnessMobileHandleBack\(\)"/)
  assert.match(activity, /webView\.evaluateJavascript\(MOBILE_BACK_SCRIPT, value -> \{/)
  assert.match(activity, /if \(!mobileBackDeclined\(value\)\) return;/)
  assert.match(activity, /if \(webView\.canGoBack\(\)\) webView\.goBack\(\);/)
  assert.match(activity, /return "false"\.equals\(javascriptResult\);/)
  assert.match(activity, /registerOnBackInvokedCallback\(OnBackInvokedDispatcher\.PRIORITY_OVERLAY, callback\)/)
  assert.doesNotMatch(activity, /WORKBENCH_PRIORITY/, 'Android lint must see the allowed callback priority constant at the call site')
  assert.match(activity, /boolean shouldRegister = started && !imeVisible/)
  assert.match(activity, /api33BackDispatcher\.setImeVisible\(nextImeVisible\)/)
  assert.match(activity, /unregisterOnBackInvokedCallback/)
  assert.match(activity, /Build\.VERSION\.SDK_INT < Build\.VERSION_CODES\.TIRAMISU/)
  assert.doesNotMatch(activity, /OnBackInvokedDispatcher\.PRIORITY_DEFAULT/)
  assert.doesNotMatch(activity, /const layers=|dispatchEvent\(new KeyboardEvent\('keydown'/)
})

test('camera capture requests the targeted permission, uses FileProvider, and cleans temporary files', () => {
  assert.match(activity, /ActivityResultContracts\.RequestPermission\(\)/)
  assert.match(activity, /ContextCompat\.checkSelfPermission\(this, Manifest\.permission\.CAMERA\)/)
  assert.match(activity, /composerCameraPermission\.launch\(Manifest\.permission\.CAMERA\)/)
  assert.match(manifest, /android:name="\.MobileInputFileProvider"[^]*android:authorities="\$\{applicationId\}\.mobile-inputs"/u)
  assert.match(activity, /MediaStore\.ACTION_IMAGE_CAPTURE/)
  assert.match(activity, /getPackageName\(\) \+ "\.mobile-inputs"/)
  assert.match(activity, /MediaStore\.EXTRA_OUTPUT/)
  assert.match(activity, /MAX_CAPTURE_BYTES = 12L \* 1024L \* 1024L/)
  assert.match(activity, /finally \{\s*if \(captured != null\) captured\.delete\(\);\s*\}/)
  assert.match(activity, /cleanupPendingCameraFile\(\)/)
  assert.match(manifest, /android:authorities="\$\{applicationId\}\.mobile-inputs"/)
  assert.match(filePaths, /<cache-path name="mobile_input_capture" path="mobile-input\/" \/>/)
})

test('message document references open through an authenticated cache-only native handoff', () => {
  assert.match(mobileRuntime, /data-harness-mobile-document-reference/)
  assert.match(mobileRuntime, /\/api\/desktop-files\/content\?sessionId=/)
  assert.match(mobileRuntime, /bridge\.openDocument\(contentUrl, reference\.name, reference\.mimeType\)/)
  assert.match(mobileCss, /data-harness-mobile-document-reference="true"[^]*min-height: 44px/u)
  assert.match(activity, /@JavascriptInterface public void openDocument\(String url, String name, String mimeType\)/)
  assert.match(documentViewer, /sameOrigin\(current, target\)/)
  assert.match(documentViewer, /allowedPath\(target\.getPath\(\)\)/)
  assert.match(documentViewer, /localProxyUrl\(target\)\.openConnection\(\)/)
  assert.match(documentViewer, /encodedAuthority\("127\.0\.0\.1:" \+ effectivePort\(target\)\)/, 'native downloads must reuse the already-validated local mobile proxy without DNS dependence')
  assert.match(documentViewer, /MAX_DOCUMENT_BYTES = 100L \* 1024L \* 1024L/)
  assert.match(documentViewer, /Intent\.ACTION_VIEW/)
  assert.match(documentViewer, /FLAG_GRANT_READ_URI_PERMISSION/)
  assert.match(filePaths, /<cache-path name="mobile_document_preview" path="mobile-documents\/" \/>/)
  assert.doesNotMatch(manifest, /android\.permission\.(?:READ_MEDIA_IMAGES|READ_MEDIA_VIDEO|READ_EXTERNAL_STORAGE|WRITE_EXTERNAL_STORAGE)/)
})

test('speech delegates to the system recognizer and preserves system language settings', () => {
  assert.match(activity, /RecognizerIntent\.ACTION_RECOGNIZE_SPEECH/)
  assert.match(activity, /RecognizerIntent\.LANGUAGE_MODEL_FREE_FORM/)
  assert.doesNotMatch(activity, /RecognizerIntent\.EXTRA_LANGUAGE\s*,/)
  assert.doesNotMatch(manifest, /android\.permission\.RECORD_AUDIO/)
  assert.match(adapter, /__harnessMobileReceiveSpeech/)
  assert.match(adapter, /HTMLTextAreaElement\.prototype,'value'/)
  assert.match(adapter, /new Event\('input',\{bubbles:true\}\)/)
})

test('native JS bridge admits fixed actions on the UI thread with JSON-safe callbacks', () => {
  assert.match(activity, /if \(!"capture"\.equals\(action\) && !"speech"\.equals\(action\)\) return;/)
  assert.match(activity, /runOnUiThread\(\(\) -> \{/)
  assert.match(activity, /JSONObject\.quote\(value\)/)
  assert.match(activity, /if \(!"__harnessMobileReceiveCapture"\.equals\(fixedCallback\) && !"__harnessMobileReceiveSpeech"\.equals\(fixedCallback\)\) return;/)
  assert.doesNotMatch(manifest, /android\.permission\.RECORD_AUDIO/)
})

test('native session bridge retains only an authoritative session reference across process recreation', () => {
  assert.match(activity, /SAVED_SESSION = "saved_session"/)
  assert.match(activity, /safeSessionReference\(String value\)/)
  assert.match(activity, /@JavascriptInterface public void rememberSession\(String sessionId\)/)
  assert.match(activity, /@JavascriptInterface public String restoreSession\(\)/)
  assert.match(activity, /editor\.remove\(SAVED_SESSION\)/)
})

test('existing screen capture observation and WebView state-preserving resume remain intact', () => {
  assert.match(activity, /registerScreenCaptureCallback/)
  assert.match(activity, /harness-mobile-screen-captured/)
  assert.match(activity, /webView\.onResume\(\)/)
  assert.match(activity, /webView\.resumeTimers\(\)/)
  const onResume = activity.slice(activity.indexOf('protected void onResume()'), activity.indexOf('private void checkMobileAppUpdate()'))
  assert.doesNotMatch(onResume, /\.reload\(\)|\.loadUrl\(|\.stopLoading\(\)/)
  assert.match(onResume, /mobileUiAdapter\.inject\(webView\)/, 'resume may retry the idempotent bootstrap without replacing the document')
  assert.doesNotMatch(onResume, /dispatchEvent\(new Event\('(online|focus)'\)\)/)
  assert.match(onResume, /不得伪造 online\/focus/)
})

test('LAN proxy prefers a non-VPN socket but falls back to Android system routing', () => {
  assert.match(proxy, /capabilities\.hasTransport\(NetworkCapabilities\.TRANSPORT_VPN\)/)
  assert.match(proxy, /Socket networkBound = createNetworkBoundLanSocket\(\)/)
  assert.match(proxy, /return connectSocket\(new Socket\(\), route, timeout\)/)
  assert.match(proxy, /does not create or replace a VPN/)
  const connect = proxy.slice(proxy.indexOf('private Socket connect(PairingProfile.Route route)'), proxy.indexOf('static Socket connectThroughSocks5'))
  assert.ok(connect.indexOf('createNetworkBoundLanSocket()') < connect.indexOf('connectSocket(new Socket(), route, timeout)'))
})
