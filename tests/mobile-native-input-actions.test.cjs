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
  const end = source.indexOf(';\n', start)
  const expression = source.slice(start, end)
  return [...expression.matchAll(/"((?:\\.|[^"\\])*)"/g)]
    .map(match => JSON.parse(`"${match[1]}"`))
    .join('')
}

test('injected composer input script is valid JavaScript', () => {
  const script = extractJavaStringConstant(adapter, 'FILE_ENTRY_JS')
  assert.doesNotThrow(() => new Function(script))
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

test('composer actions use a temporary thumb-friendly four-tile panel', () => {
  assert.match(adapter, /if\(textarea\)textarea\.blur\(\)/)
  assert.match(mobileCss, /#harness-mobile-input-menu\s*\{[^}]*position: fixed !important;/s)
  assert.match(mobileCss, /grid-template-columns: repeat\(4, minmax\(0, 1fr\)\) !important;/)
  assert.match(mobileCss, /#harness-mobile-input-menu\[hidden\]\s*\{\s*display: none !important;/s)
  assert.match(mobileCss, /min-height: 82px !important;/)
})

test('gallery and files retain user-initiated system picker flows', () => {
  assert.match(activity, /ActivityResultContracts\.PickVisualMedia/)
  assert.match(activity, /Intent\.ACTION_OPEN_DOCUMENT/)
  assert.match(adapter, /photoInput\.click\(\)/)
  assert.match(adapter, /fileInput\.click\(\)/)
  assert.match(adapter, /new DataTransfer\(\)/)
  assert.match(adapter, /ClipboardEvent\('paste'/)
  assert.match(adapter, /DragEvent\('drop'/)
})

test('camera capture uses a bounded FileProvider URI and always cleans temporary files', () => {
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

test('existing screen capture observation and WebView state-preserving resume remain intact', () => {
  assert.match(activity, /registerScreenCaptureCallback/)
  assert.match(activity, /harness-mobile-screen-captured/)
  assert.match(activity, /webView\.onResume\(\)/)
  assert.match(activity, /webView\.resumeTimers\(\)/)
  const onResume = activity.slice(activity.indexOf('protected void onResume()'), activity.indexOf('private void checkMobileAppUpdate()'))
  assert.doesNotMatch(onResume, /\.reload\(\)/)
})

test('LAN proxy prefers a non-VPN socket but falls back to Android system routing', () => {
  assert.match(proxy, /capabilities\.hasTransport\(NetworkCapabilities\.TRANSPORT_VPN\)/)
  assert.match(proxy, /Socket networkBound = createNetworkBoundLanSocket\(\)/)
  assert.match(proxy, /return connectSocket\(new Socket\(\), route, timeout\)/)
  assert.match(proxy, /does not create or replace a VPN/)
  const connect = proxy.slice(proxy.indexOf('private Socket connect(PairingProfile.Route route)'), proxy.indexOf('static Socket connectThroughSocks5'))
  assert.ok(connect.indexOf('createNetworkBoundLanSocket()') < connect.indexOf('connectSocket(new Socket(), route, timeout)'))
})
