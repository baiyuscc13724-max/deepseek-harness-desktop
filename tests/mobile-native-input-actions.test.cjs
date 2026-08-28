'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const android = path.join(root, 'mobile', 'android', 'app', 'src', 'main')
const read = (...parts) => fs.readFileSync(path.join(android, ...parts), 'utf8')

const activity = read('java', 'io', 'harnessdesktop', 'mobile', 'MainActivity.java')
const adapter = read('java', 'io', 'harnessdesktop', 'mobile', 'MobileUiAdapter.java')
const proxy = read('java', 'io', 'harnessdesktop', 'mobile', 'HarnessWebProxy.java')
const manifest = read('AndroidManifest.xml')
const filePaths = read('res', 'xml', 'mobile_file_paths.xml')
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
  card.querySelector = selector => selector === 'textarea[data-phase]' ? textarea : null
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
  assert.match(mobileCss, /\[data-harness-mobile-composer-action="true"\]\s*\{[^}]*min-width: 54px !important;/s)
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
  assert.doesNotMatch(onResume, /\.reload\(\)|\.loadUrl\(|\.stopLoading\(\)|mobileUiAdapter\.inject/)
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
