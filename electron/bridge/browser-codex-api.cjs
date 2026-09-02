'use strict'

const { randomUUID } = require('node:crypto')

// Fixed, Playwright-style locator operations for the built-in browser. Callers
// provide data only: no evaluate/script/function payload is accepted or run.
const PLAYWRIGHT_OPERATIONS = Object.freeze([
  'domSnapshot', 'count', 'isVisible', 'isEnabled', 'innerText', 'textContent',
  'getAttribute', 'click', 'dblclick', 'fill', 'press', 'pressSequentially',
  'selectOption', 'setChecked'
])
const PLAYWRIGHT_OPERATION_SET = new Set(PLAYWRIGHT_OPERATIONS)
const SELECTOR_KINDS = new Set(['css', 'role', 'text'])
const READ_OPERATIONS = new Set(['domSnapshot', 'count', 'isVisible', 'isEnabled', 'innerText', 'textContent', 'getAttribute'])
const TEXT_OPERATIONS = new Set(['fill', 'pressSequentially', 'selectOption'])
const SAFE_KEYS = new Set([
  'Escape', 'Tab', 'Enter', 'Space', 'Backspace', 'Delete', 'Insert',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown',
  'Home', 'End'
])
const SAFE_ROLES = new Set([
  'button', 'checkbox', 'combobox', 'heading', 'img', 'link', 'listbox',
  'listitem', 'radio', 'slider', 'table', 'textbox'
])
// Attribute selectors and arbitrary data-* reads are intentionally absent.
// Together with the safe CSS grammar below, this removes the count/getAttribute
// oracle that could otherwise probe hidden credentials one character at a time.
const SAFE_ATTRIBUTE = /^(?:id|class|title|alt|name|type|role|target|rel|placeholder|tabindex|disabled|readonly|required|multiple|selected|checked|aria-(?:atomic|busy|checked|current|disabled|expanded|haspopup|hidden|invalid|live|modal|multiline|multiselectable|orientation|pressed|readonly|required|selected|sort))$/i
const SENSITIVE_LOCATOR = /(?:pass(?:word|wd)?|pwd|secret|token|csrf|xsrf|session(?:id)?|cookie|authorization|bearer|credential|otp|captcha|verification|验证码|api[_-]?key|银行卡|card.?number|cvv|cvc|账号|帐号|账户|用户名|邮箱|bank|payment|payee|支付|付款|login|e-?mail|user(?:name|[_-]?id))/i
const MAX_SELECTOR_LENGTH = 2000
const MAX_NAME_LENGTH = 500
const MAX_TEXT_LENGTH = 4000
const MAX_SNAPSHOT_NODES = 200
const PLAYWRIGHT_WORLD_ID = 1004
const PLAYWRIGHT_BINDING_ATTRIBUTE = 'data-hd-playwright-binding'
const PAGE_ERROR_CODES = new Set([
  'browser-playwright-binding-changed', 'browser-playwright-binding-stale',
  'browser-playwright-download-required', 'browser-playwright-element-disabled',
  'browser-playwright-element-not-actionable', 'browser-playwright-element-not-found',
  'browser-playwright-frame-inaccessible', 'browser-playwright-frame-not-found',
  'browser-playwright-frame-transformed', 'browser-playwright-option-not-found',
  'browser-playwright-option-out-of-range', 'browser-playwright-selector-invalid',
  'browser-playwright-strict-mode', 'browser-playwright-target-invalid',
  'browser-playwright-upload-required', 'browser-playwright-element-readonly'
])

function apiError(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

function asUnknownOutcome(error) {
  if (error?.code === 'browser-outcome-unknown') return error
  const wrapped = apiError('browser-outcome-unknown', '受信任浏览器输入已经开始，但执行结果无法可靠确认；必须先重新观察页面再决定后续动作。')
  if (error?.code) wrapped.originalCode = String(error.code)
  if (error instanceof Error) wrapped.cause = error
  return wrapped
}

function boundedString(value, field, maximum, { required = false } = {}) {
  const text = value == null ? '' : String(value)
  if (required && !text) throw apiError('browser-playwright-parameter-required', `${field} 不能为空。`)
  if (text.length > maximum || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(text)) {
    throw apiError('browser-playwright-parameter-invalid', `${field} 无效或超过长度上限。`)
  }
  return text
}

function isSafeCssSelector(value) {
  const selector = String(value || '').trim()
  if (!selector || selector.length > MAX_SELECTOR_LENGTH) return false
  // No attributes, pseudo classes/elements, selector lists, sibling
  // combinators, escapes or quoted strings. Those constructs can encode a
  // hidden-value oracle even when the returned result is only a count.
  if (/[^A-Za-z0-9_.*#.\-\s>]/u.test(selector)) return false
  const tokens = selector.replace(/>/g, ' > ').trim().split(/\s+/u)
  if (tokens.length > 64 || tokens[0] === '>' || tokens.at(-1) === '>') return false
  let previousWasChild = false
  for (const token of tokens) {
    if (token === '>') {
      if (previousWasChild) return false
      previousWasChild = true
      continue
    }
    previousWasChild = false
    if (!/^(?:(?:[A-Za-z][A-Za-z0-9_-]*|\*)?(?:[#.][A-Za-z_][A-Za-z0-9_-]*)+|(?:[A-Za-z][A-Za-z0-9_-]*|\*))$/u.test(token)) return false
  }
  return !previousWasChild
}

function assertSafeLocatorValue(value, field) {
  if (value && SENSITIVE_LOCATOR.test(String(value))) {
    throw apiError('browser-playwright-sensitive-locator', `${field} 涉及账号、凭据或其他敏感页面状态，禁止探测。`)
  }
}

function normalizePlaywrightParameters(parameters = {}) {
  if (!parameters || typeof parameters !== 'object' || Array.isArray(parameters)) {
    throw apiError('browser-playwright-parameter-invalid', 'playwright 参数必须是对象。')
  }
  for (const forbidden of ['script', 'javascript', 'evaluate', 'expression', 'command', 'shell']) {
    if (Object.prototype.hasOwnProperty.call(parameters, forbidden)) {
      throw apiError('browser-playwright-script-forbidden', 'playwright 接口禁止任意脚本、表达式或命令。')
    }
  }
  const operation = boundedString(parameters.operation, 'operation', 40, { required: true })
  if (!PLAYWRIGHT_OPERATION_SET.has(operation)) throw apiError('browser-playwright-operation-unsupported', '不支持的 playwright 固定操作。')
  const selectorKind = boundedString(parameters.selector_kind || 'css', 'selector_kind', 10)
  if (!SELECTOR_KINDS.has(selectorKind)) throw apiError('browser-playwright-selector-kind-invalid', 'selector_kind 仅支持 css、role 或 text。')
  const selector = boundedString(parameters.selector, 'selector', MAX_SELECTOR_LENGTH, { required: operation !== 'domSnapshot' })
  const name = boundedString(parameters.name, 'name', MAX_NAME_LENGTH)
  const frameSelector = boundedString(parameters.frame_selector, 'frame_selector', MAX_SELECTOR_LENGTH)
  const attribute = boundedString(parameters.attribute, 'attribute', 160, { required: operation === 'getAttribute' })
  const text = boundedString(parameters.text, 'text', operation === 'pressSequentially' ? 500 : MAX_TEXT_LENGTH, { required: operation === 'fill' || operation === 'pressSequentially' })
  const value = boundedString(parameters.value, 'value', MAX_TEXT_LENGTH, { required: operation === 'selectOption' })
  const key = boundedString(parameters.key, 'key', 80, { required: operation === 'press' })
  const confirmationId = boundedString(parameters.confirmation_id, 'confirmation_id', 200)
  if (selector) {
    if (selectorKind === 'css' && !isSafeCssSelector(selector)) {
      throw apiError('browser-playwright-selector-unsafe', 'CSS selector 仅支持标签、id、class、后代和直接子级；禁止属性、伪类、转义和 selector 列表。')
    }
    if (selectorKind === 'role' && !SAFE_ROLES.has(selector.toLowerCase())) {
      throw apiError('browser-playwright-role-unsupported', 'role 定位仅支持固定的可访问角色。')
    }
    assertSafeLocatorValue(selector, 'selector')
  }
  if (frameSelector) {
    if (!isSafeCssSelector(frameSelector)) throw apiError('browser-playwright-selector-unsafe', 'frame_selector 仅支持安全 CSS 标签、id、class 与层级。')
    assertSafeLocatorValue(frameSelector, 'frame_selector')
  }
  assertSafeLocatorValue(name, 'name')
  if (operation === 'press' && !SAFE_KEYS.has(key)) throw apiError('browser-playwright-key-unsupported', 'press 仅支持固定的安全按键，不支持快捷键或任意文本。')
  if (operation === 'getAttribute' && (!SAFE_ATTRIBUTE.test(attribute) || SENSITIVE_LOCATOR.test(attribute))) {
    throw apiError('browser-playwright-attribute-forbidden', '该属性可能暴露表单值、脚本、URL 凭据或敏感页面状态，禁止读取。')
  }
  if (operation === 'setChecked' && typeof parameters.checked !== 'boolean') {
    throw apiError('browser-playwright-parameter-required', 'setChecked 必须提供布尔 checked。')
  }
  const timeoutNumber = Number(parameters.timeout_ms)
  const timeoutMs = Number.isFinite(timeoutNumber) ? Math.max(0, Math.min(10_000, Math.floor(timeoutNumber))) : 1000
  return { operation, selector, selectorKind, name, frameSelector, attribute, text, value, key, checked: parameters.checked === true, timeoutMs, confirmationId }
}

// This function is serialized into a dedicated Electron isolated world. Its
// only input is normalized JSON data produced above. The isolated-world Map
// keeps an exact Element object between preflight and act; page scripts cannot
// see or replace that binding.
async function fixedLocatorPageFunction(input) {
  const BINDINGS_KEY = '__HARNESS_FIXED_PLAYWRIGHT_BINDINGS_V1__'
  const normalize = value => String(value == null ? '' : value).replace(/\s+/g, ' ').trim()
  const rendered = element => {
    if (element?.nodeType !== 1 || !element.isConnected) return false
    const view = element.ownerDocument?.defaultView
    if (!view) return false
    const rect = element.getBoundingClientRect()
    const style = view.getComputedStyle(element)
    return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden' && style.pointerEvents !== 'none' && Number(style.opacity || 1) > 0
  }
  const implicitRole = element => {
    const explicit = normalize(element.getAttribute('role')).toLowerCase()
    if (explicit) return explicit.split(/\s+/)[0]
    const tag = element.tagName.toLowerCase()
    const type = normalize(element.type).toLowerCase()
    if (tag === 'a' && element.hasAttribute('href')) return 'link'
    if (tag === 'button' || (tag === 'input' && ['button', 'submit', 'reset', 'image'].includes(type))) return 'button'
    if (tag === 'select') return element.multiple ? 'listbox' : 'combobox'
    if (tag === 'textarea' || (tag === 'input' && !['checkbox', 'radio', 'range', 'file', 'hidden'].includes(type))) return 'textbox'
    if (tag === 'input' && ['checkbox', 'radio', 'range'].includes(type)) return type
    if (/^h[1-6]$/.test(tag)) return 'heading'
    if (tag === 'img') return 'img'
    if (tag === 'li') return 'listitem'
    if (tag === 'table') return 'table'
    return ''
  }
  const accessibleName = element => {
    const labelledBy = normalize(element.getAttribute('aria-labelledby')).split(/\s+/).filter(Boolean).map(id => element.ownerDocument.getElementById(id)?.innerText || '').join(' ')
    const labels = element.labels ? [...element.labels].map(label => label.innerText || '').join(' ') : ''
    return normalize(element.getAttribute('aria-label') || labelledBy || labels || element.getAttribute('alt') || element.getAttribute('title') || element.placeholder || element.innerText || element.textContent || '').slice(0, 500)
  }
  const fieldMetadata = element => {
    const form = element.form || element.closest?.('form') || null
    const submit = Boolean(element.type === 'submit' || element.type === 'image' || element.matches?.('button:not([type]),button[type="submit"],input[type="submit"],input[type="image"]'))
    return {
      tag: element.tagName.toLowerCase(), type: String(element.type || ''), name: String(element.name || ''), id: String(element.id || ''),
      role: implicitRole(element), autocomplete: String(element.autocomplete || ''), ariaLabel: String(element.getAttribute('aria-label') || ''),
      label: accessibleName(element), selector: input.selector, baseUrl: location.origin,
      text: normalize(element.innerText || element.textContent || '').slice(0, 1000), href: String(element.href || ''),
      formAction: form ? String((submit ? element.formAction : '') || form.action || '') : '', download: Boolean(element.hasAttribute('download')), submit,
      disabled: Boolean(element.matches?.(':disabled') || element.disabled || element.getAttribute('aria-disabled') === 'true'), readOnly: Boolean(element.readOnly || element.getAttribute('aria-readonly') === 'true')
    }
  }
  const fingerprint = field => JSON.stringify({
    tag: field.tag, type: field.type, name: field.name, id: field.id, role: field.role,
    autocomplete: field.autocomplete, ariaLabel: field.ariaLabel, label: field.label,
    text: field.text, href: field.href, formAction: field.formAction, download: field.download,
    submit: field.submit, disabled: field.disabled, readOnly: field.readOnly
  })
  const bindingStore = () => {
    let store = globalThis[BINDINGS_KEY]
    if (!(store instanceof Map)) {
      store = new Map()
      Object.defineProperty(globalThis, BINDINGS_KEY, { value: store, writable: false, configurable: false, enumerable: false })
    }
    return store
  }
  const targetDocument = () => {
    if (!input.frameSelector) return document
    let frame
    try { frame = document.querySelector(input.frameSelector) } catch { throw Object.assign(new Error('frame_selector 不是有效的 CSS 选择器。'), { code: 'browser-playwright-selector-invalid' }) }
    if (!frame || !/^(?:iframe|frame)$/i.test(frame.tagName)) throw Object.assign(new Error('frame_selector 未匹配到 frame/iframe。'), { code: 'browser-playwright-frame-not-found' })
    try {
      if (!frame.contentDocument) throw new Error('unavailable')
      return frame.contentDocument
    } catch { throw Object.assign(new Error('目标 frame 不可访问；跨来源 frame 不允许旁路来源边界。'), { code: 'browser-playwright-frame-inaccessible' }) }
  }
  const locate = root => {
    let candidates
    try {
      if (input.selectorKind === 'css') candidates = [...root.querySelectorAll(input.selector)]
      else candidates = [...root.querySelectorAll('*')].filter(element => {
        if (!rendered(element)) return false
        if (input.selectorKind === 'role') return implicitRole(element) === input.selector.toLowerCase() && (!input.name || accessibleName(element) === input.name)
        return normalize(element.innerText || element.textContent || '') === normalize(input.selector) && (!input.name || accessibleName(element) === input.name)
      })
    } catch { throw Object.assign(new Error('selector 不是有效的定位器。'), { code: 'browser-playwright-selector-invalid' }) }
    return candidates
  }
  const trustedPointForElement = element => {
    const rect = element.getBoundingClientRect()
    let x = rect.left + rect.width / 2
    let y = rect.top + rect.height / 2
    let currentView = element.ownerDocument.defaultView
    let hit = element.ownerDocument.elementFromPoint(x, y)
    if (!hit || (hit !== element && !element.contains(hit))) throw Object.assign(new Error('目标元素被其他内容遮挡，无法接收受信任输入。'), { code: 'browser-playwright-element-not-actionable' })
    while (currentView && currentView !== currentView.top) {
      let frame
      try { frame = currentView.frameElement } catch { frame = null }
      if (!frame || !rendered(frame)) throw Object.assign(new Error('目标 frame 不可见或不可交互。'), { code: 'browser-playwright-element-not-actionable' })
      const frameRect = frame.getBoundingClientRect()
      const frameStyle = frame.ownerDocument.defaultView?.getComputedStyle(frame)
      // Transformed/scaled frames do not have a single safe coordinate mapping
      // between the child viewport and top-level trusted CDP input.
      if ((frameStyle?.transform && frameStyle.transform !== 'none') || Math.abs(frameRect.width - frame.offsetWidth) > 0.75 || Math.abs(frameRect.height - frame.offsetHeight) > 0.75) {
        throw Object.assign(new Error('目标 frame 使用了不安全的坐标变换。'), { code: 'browser-playwright-frame-transformed' })
      }
      x += frameRect.left + frame.clientLeft
      y += frameRect.top + frame.clientTop
      const parentDocument = frame.ownerDocument
      hit = parentDocument.elementFromPoint(x, y)
      if (hit !== frame) throw Object.assign(new Error('目标 frame 被其他内容遮挡，无法接收受信任输入。'), { code: 'browser-playwright-element-not-actionable' })
      currentView = parentDocument.defaultView
    }
    if (![x, y].every(Number.isFinite)) throw Object.assign(new Error('目标元素布局坐标无效。'), { code: 'browser-playwright-element-not-actionable' })
    return { x, y }
  }
  const validateActionTarget = (element, field, { hitTest = false } = {}) => {
    if (!rendered(element)) throw Object.assign(new Error('目标元素不可见或不可交互。'), { code: 'browser-playwright-element-not-actionable' })
    if (element.closest?.('[inert]')) throw Object.assign(new Error('目标元素位于 inert 区域，无法接收受信任输入。'), { code: 'browser-playwright-element-not-actionable' })
    if (field.disabled) throw Object.assign(new Error('目标元素当前不可用。'), { code: 'browser-playwright-element-disabled' })
    if (field.type.toLowerCase() === 'file') throw Object.assign(new Error('文件选择控件必须使用受确认的 upload 动作。'), { code: 'browser-playwright-upload-required' })
    if (field.download) throw Object.assign(new Error('下载链接必须使用受确认的 download 动作。'), { code: 'browser-playwright-download-required' })
    if (['fill', 'pressSequentially'].includes(input.operation)) {
      if (!['input', 'textarea'].includes(field.tag) && !element.isContentEditable) throw Object.assign(new Error(`${input.operation} 仅适用于可编辑元素。`), { code: 'browser-playwright-target-invalid' })
      if (field.readOnly) throw Object.assign(new Error('目标编辑控件为只读。'), { code: 'browser-playwright-element-readonly' })
    }
    if (input.operation === 'selectOption' && field.tag !== 'select') throw Object.assign(new Error('selectOption 仅适用于 select。'), { code: 'browser-playwright-target-invalid' })
    if (input.operation === 'setChecked' && (field.tag !== 'input' || !['checkbox', 'radio'].includes(field.type.toLowerCase()))) throw Object.assign(new Error('setChecked 仅适用于 checkbox 或 radio。'), { code: 'browser-playwright-target-invalid' })
    if (input.operation === 'setChecked' && !['preflight', 'bind'].includes(input.phase) && field.type.toLowerCase() === 'radio' && input.checked !== true) throw Object.assign(new Error('radio 不能通过受信任点击取消选中。'), { code: 'browser-playwright-target-invalid' })
    return hitTest ? trustedPointForElement(element) : null
  }
  const store = bindingStore()
  if (input.phase === 'unmark') {
    const binding = store.get(input.bindingId)
    if (binding?.element?.getAttribute?.(input.bindingAttribute) === input.bindingId) binding.element.removeAttribute(input.bindingAttribute)
    return { unmarked: true }
  }
  if (input.phase === 'cleanup') {
    const binding = store.get(input.bindingId)
    if (binding?.element?.getAttribute?.(input.bindingAttribute) === input.bindingId) binding.element.removeAttribute(input.bindingAttribute)
    store.delete(input.bindingId)
    return { cleaned: true }
  }
  if (input.phase === 'bind' || input.phase === 'prepare' || input.phase === 'verify') {
    const binding = store.get(input.bindingId)
    if (!binding?.element?.isConnected) throw Object.assign(new Error('预检绑定的元素已失效。'), { code: 'browser-playwright-binding-stale' })
    const field = fieldMetadata(binding.element)
    if (fingerprint(field) !== binding.fingerprint) throw Object.assign(new Error('预检后目标元素发生变化，已阻止操作。'), { code: 'browser-playwright-binding-changed' })
    const actionPoint = validateActionTarget(binding.element, field, { hitTest: input.phase === 'verify' })
    if (input.phase === 'bind' || input.phase === 'prepare') binding.element.setAttribute(input.bindingAttribute, input.bindingId)
    if (binding.element.getAttribute(input.bindingAttribute) !== input.bindingId) throw Object.assign(new Error('精确节点绑定标记已变化。'), { code: 'browser-playwright-binding-changed' })
    const matches = binding.element.ownerDocument.querySelectorAll(`[${input.bindingAttribute}="${input.bindingId}"]`)
    if (matches.length !== 1 || matches[0] !== binding.element) throw Object.assign(new Error('精确节点绑定不唯一。'), { code: 'browser-playwright-binding-changed' })
    let targetIndex = -1
    let selectedValue
    let currentSelectedValue
    if (input.operation === 'selectOption' && input.phase !== 'bind') {
      const options = [...binding.element.options]
      targetIndex = options.findIndex(item => item.value === input.value || normalize(item.text) === normalize(input.value))
      if (targetIndex < 0) throw Object.assign(new Error('指定的下拉选项不存在。'), { code: 'browser-playwright-option-not-found' })
      if (targetIndex > 500) throw Object.assign(new Error('下拉选项目标超出安全操作范围。'), { code: 'browser-playwright-option-out-of-range' })
      selectedValue = options[targetIndex].value
      currentSelectedValue = binding.element.value
    }
    const editableValue = binding.element.isContentEditable ? String(binding.element.textContent || '') : String(binding.element.value || '')
    return {
      field, targetIndex, selectedValue, currentSelectedValue,
      checked: Boolean(binding.element.checked),
      editableMatches: editableValue === input.text,
      editableEndsWith: editableValue.endsWith(input.text),
      actionPoint,
      bindingVerified: true
    }
  }

  const root = targetDocument()
  if (input.operation === 'domSnapshot') {
    const sensitive = /(?:pass(?:word|wd)?|pwd|secret|token|csrf|xsrf|session(?:id)?|cookie|authorization|bearer|credential|otp|captcha|verification|验证码|api[_-]?key|银行卡|card.?number|cvv|cvc|账号|帐号|账户|用户名|邮箱|bank|payment|payee|支付|付款|login|e-?mail|user(?:name|[_-]?id))/i
    const candidates = root.querySelectorAll('h1,h2,h3,h4,h5,h6,a,button,input,textarea,select,[role],p,li,table')
    const nodes = []
    let truncated = false
    for (const element of candidates) {
      if (!rendered(element) || sensitive.test([element.type, element.name, element.id, element.autocomplete, element.getAttribute('aria-label'), element.placeholder].filter(Boolean).join(' '))) continue
      const name = accessibleName(element)
      const nodeText = normalize(String(element.innerText || element.textContent || '').slice(0, 1000)).slice(0, 500)
      if (sensitive.test(`${name} ${nodeText}`)) continue
      if (nodes.length >= 200) { truncated = true; break }
      nodes.push({ tag: element.tagName.toLowerCase(), role: implicitRole(element), name, text: nodeText, visible: true, enabled: !Boolean(element.matches?.(':disabled') || element.disabled || element.getAttribute('aria-disabled') === 'true') })
    }
    const text = nodes.map(node => `${node.role || node.tag} ${node.name} ${node.text}`).join('\n')
    return { snapshot: { title: String(document.title || '').slice(0, 500), nodes, count: nodes.length, truncated }, text, field: { tag: 'document', selector: input.frameSelector || '', baseUrl: location.origin } }
  }

  if (input.operation === 'count' && input.selectorKind === 'css') {
    try {
      return { count: root.querySelectorAll(input.selector).length, text: '', field: { tag: 'document', selector: input.selector, baseUrl: location.origin } }
    } catch { throw Object.assign(new Error('selector 不是有效的定位器。'), { code: 'browser-playwright-selector-invalid' }) }
  }

  const deadline = Date.now() + input.timeoutMs
  let matches = []
  do {
    matches = locate(root)
    if (matches.length || input.operation === 'count' || Date.now() >= deadline) break
    await new Promise(resolve => setTimeout(resolve, 50))
  } while (true)
  if (input.operation === 'count') return { count: matches.length, text: '', field: { tag: 'document', selector: input.selector, baseUrl: location.origin } }
  if (!matches.length) throw Object.assign(new Error('定位器在超时前未匹配到元素。'), { code: 'browser-playwright-element-not-found' })
  if (matches.length !== 1) throw Object.assign(new Error(`定位器匹配到 ${matches.length} 个元素；该操作要求唯一目标。`), { code: 'browser-playwright-strict-mode' })
  const element = matches[0]
  const field = fieldMetadata(element)
  if (input.operation === 'isVisible') return { visible: rendered(element), text: '', field }
  if (input.operation === 'isEnabled') return { enabled: !field.disabled, text: '', field }
  if (['innerText', 'textContent', 'getAttribute'].includes(input.operation) && !rendered(element)) throw Object.assign(new Error('隐藏元素的内容或属性禁止读取。'), { code: 'browser-playwright-element-not-actionable' })
  if (input.operation === 'innerText') { const text = String(element.innerText || ''); return { value: text, text, field } }
  if (input.operation === 'textContent') { const text = String(element.textContent || ''); return { value: text, text, field } }
  if (input.operation === 'getAttribute') { const value = element.getAttribute(input.attribute); return { value, text: value == null ? '' : String(value), field } }
  validateActionTarget(element, field)
  store.set(input.bindingId, { element, fingerprint: fingerprint(field) })
  return { field, text: '' }
}

function assertSafeFieldMetadata(field = {}) {
  const haystack = [field.type, field.name, field.id, field.role, field.autocomplete, field.ariaLabel, field.label, field.selector, field.text].filter(Boolean).join(' ')
  if (SENSITIVE_LOCATOR.test(haystack)) throw apiError('browser-playwright-sensitive-field', '目标元素涉及账号、凭据或其他敏感页面状态，禁止操作。')
}

function effectiveModelAction(operation, field, normalized) {
  if (READ_OPERATIONS.has(operation)) return 'read'
  if (TEXT_OPERATIONS.has(operation)) return 'type'
  if (operation === 'press') return field?.submit || (normalized.key === 'Enter' && field?.tag === 'input' && field?.formAction) ? 'submit' : 'click'
  if (operation === 'setChecked') return 'click'
  const description = `${field?.text || ''} ${field?.label || ''} ${field?.ariaLabel || ''}`
  return field?.submit || /(?:submit|publish|delete|remove|发送|提交|发布|删除|移除)/i.test(description) ? 'submit' : 'click'
}

function modelPayload(operation, normalized, field, raw) {
  if (READ_OPERATIONS.has(operation)) return raw.text ? { text: raw.text } : {}
  if (operation === 'fill' || operation === 'pressSequentially') return { text: normalized.text }
  if (operation === 'selectOption') return { text: normalized.value }
  if (operation === 'press') {
    const navigatesTo = normalized.key === 'Enter'
      ? field.href || field.formAction || ''
      : normalized.key === 'Space' && field.submit
        ? field.formAction || ''
        : ''
    return { actionText: `press ${normalized.key}`, ...(navigatesTo ? { navigatesTo } : {}) }
  }
  const navigatesTo = field.href || (field.submit ? field.formAction : '') || ''
  return navigatesTo ? { navigatesTo } : {}
}

function cdpKeyDescriptor(keyName) {
  const key = keyName === 'Space' ? ' ' : keyName
  const virtualKeyCode = {
    Backspace: 8, Tab: 9, Enter: 13, Escape: 27, Space: 32,
    PageUp: 33, PageDown: 34, End: 35, Home: 36,
    ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40,
    Insert: 45, Delete: 46
  }[keyName]
  return { key, code: keyName, ...(virtualKeyCode ? { windowsVirtualKeyCode: virtualKeyCode } : {}) }
}

async function resolveBoundBackendNode(debuggerClient, bindingId, assertCurrent) {
  assertCurrent()
  await debuggerClient.sendCommand('DOM.enable')
  assertCurrent()
  await debuggerClient.sendCommand('DOM.getDocument', { depth: 0, pierce: true })
  assertCurrent()
  const search = await debuggerClient.sendCommand('DOM.performSearch', {
    query: `[${PLAYWRIGHT_BINDING_ATTRIBUTE}="${bindingId}"]`,
    includeUserAgentShadowDOM: true
  })
  const searchId = search?.searchId
  try {
    assertCurrent()
    if (!searchId || search.resultCount !== 1) throw apiError('browser-playwright-binding-changed', 'CDP 未能解析唯一的精确节点绑定。')
    const found = await debuggerClient.sendCommand('DOM.getSearchResults', { searchId, fromIndex: 0, toIndex: 1 })
    assertCurrent()
    const nodeId = found?.nodeIds?.[0]
    if (!nodeId || found.nodeIds.length !== 1) throw apiError('browser-playwright-binding-changed', 'CDP 精确节点搜索结果无效。')
    const described = await debuggerClient.sendCommand('DOM.describeNode', { nodeId, depth: 0, pierce: true })
    assertCurrent()
    if (!described?.node?.backendNodeId) throw apiError('browser-playwright-binding-changed', 'CDP 精确节点缺少稳定身份。')
    return described.node.backendNodeId
  } finally {
    if (searchId) await debuggerClient.sendCommand('DOM.discardSearchResults', { searchId }).catch(() => {})
  }
}

function assertActionableBox(model) {
  const quad = model?.content || model?.border
  if (!Array.isArray(quad) || quad.length < 8) throw apiError('browser-playwright-element-not-actionable', '目标元素没有可交互的布局区域。')
  const xs = [quad[0], quad[2], quad[4], quad[6]].map(Number)
  const ys = [quad[1], quad[3], quad[5], quad[7]].map(Number)
  if (![...xs, ...ys].every(Number.isFinite) || Math.max(...xs) <= Math.min(...xs) || Math.max(...ys) <= Math.min(...ys)) {
    throw apiError('browser-playwright-element-not-actionable', '目标元素布局坐标无效。')
  }
}

async function runTrustedCdpAction({ webContents, normalized, bindingId, backendNodeId: expectedBackendNodeId, assertCurrent, verifyBinding, onInputStarted = () => {} }) {
  const debuggerClient = webContents.debugger
  if (!debuggerClient?.isAttached?.()) throw apiError('browser-input-unavailable', '受信任 CDP 输入通道当前不可用。')
  let inputStarted = false
  const startInput = () => {
    if (inputStarted) return
    inputStarted = true
    onInputStarted()
  }
  const send = async (method, parameters = {}, { startsInput = false } = {}) => {
    assertCurrent()
    if (startsInput) startInput()
    const result = await debuggerClient.sendCommand(method, parameters)
    assertCurrent()
    return result
  }
  const key = async (name, modifiers = 0) => {
    const descriptor = cdpKeyDescriptor(name)
    await send('Input.dispatchKeyEvent', { type: 'keyDown', ...descriptor, ...(modifiers ? { modifiers } : {}) }, { startsInput: true })
    await send('Input.dispatchKeyEvent', { type: 'keyUp', ...descriptor, ...(modifiers ? { modifiers } : {}) })
  }
  const click = async (clickCount, shouldDispatch = () => true) => {
    const model = await send('DOM.getBoxModel', { backendNodeId })
    assertActionableBox(model?.model)
    const verified = await verifyBinding()
    if (!shouldDispatch(verified)) return verified
    const { x, y } = verified.actionPoint || {}
    if (![x, y].every(Number.isFinite)) throw apiError('browser-playwright-element-not-actionable', '目标元素缺少已验证的顶层视口坐标。')
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }, { startsInput: true })
    const afterMove = await verifyBinding()
    const moved = afterMove.actionPoint || {}
    if (![moved.x, moved.y].every(Number.isFinite) || Math.abs(moved.x - x) > 0.75 || Math.abs(moved.y - y) > 0.75) {
      throw apiError('browser-playwright-binding-changed', '鼠标移动后目标元素的位置或可操作状态发生变化。')
    }
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount })
    const afterPress = await verifyBinding()
    const next = afterPress.actionPoint || {}
    if (![next.x, next.y].every(Number.isFinite) || Math.abs(next.x - x) > 0.75 || Math.abs(next.y - y) > 0.75) {
      throw apiError('browser-playwright-binding-changed', '鼠标按下后目标元素的位置或可操作状态发生变化。')
    }
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount })
    return afterPress
  }
  const backendNodeId = await resolveBoundBackendNode(debuggerClient, bindingId, assertCurrent)
  if (String(backendNodeId) !== String(expectedBackendNodeId)) throw apiError('browser-playwright-binding-changed', '策略判定后的精确节点身份发生变化。')
  try {
    await send('DOM.scrollIntoViewIfNeeded', { backendNodeId })
    let finalPlan = null
    if (normalized.operation === 'click') await click(1)
    else if (normalized.operation === 'dblclick') { await click(1); await click(2) }
    else if (normalized.operation === 'setChecked') {
      await click(1, verified => Boolean(verified.checked) !== normalized.checked)
      finalPlan = await verifyBinding()
      if (Boolean(finalPlan.checked) !== normalized.checked) throw apiError('browser-playwright-result-mismatch', 'checkbox/radio 未达到请求的选中状态。')
    } else {
      await verifyBinding()
      await send('DOM.focus', { backendNodeId }, { startsInput: true })
      let verified = await verifyBinding()
      if (normalized.operation === 'fill') {
        const selectAllModifier = process.platform === 'darwin' ? 4 : 2
        await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: selectAllModifier })
        await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: selectAllModifier })
        await key('Backspace')
        await send('Input.insertText', { text: normalized.text })
        verified = await verifyBinding()
        if (!verified.editableMatches) throw apiError('browser-playwright-result-mismatch', '编辑控件未达到请求的文本状态。')
      } else if (normalized.operation === 'pressSequentially') {
        for (const character of normalized.text) {
          await send('Input.insertText', { text: character })
        }
        verified = await verifyBinding()
        if (!verified.editableEndsWith) throw apiError('browser-playwright-result-mismatch', '逐字输入未达到请求的文本状态。')
      } else if (normalized.operation === 'press') await key(normalized.key)
      else if (normalized.operation === 'selectOption') {
        await key('Home')
        verified = await verifyBinding()
        let steps = 0
        while (verified.currentSelectedValue !== verified.selectedValue && steps < 500) {
          await key('ArrowDown')
          verified = await verifyBinding()
          steps += 1
        }
        if (verified.currentSelectedValue !== verified.selectedValue) throw apiError('browser-playwright-result-mismatch', 'select 未达到请求的选项状态。')
      } else throw apiError('browser-playwright-operation-unsupported', '固定受信任输入操作未实现。')
      finalPlan = verified
    }
    return {
      acted: true,
      ...(normalized.operation === 'selectOption' ? { selectedValue: finalPlan.selectedValue } : {}),
      ...(normalized.operation === 'setChecked' ? { checked: normalized.checked } : {}),
      inputDispatched: inputStarted
    }
  } catch (error) {
    throw inputStarted ? asUnknownOutcome(error) : error
  }
}

async function runBrowserPlaywrightOperation({ webContents, parameters = {}, origin, tabId, securityPolicy, confirmationId, assertCurrent = () => {}, markAction = () => {}, beginInput = () => () => {}, surfaceConfirmation = async decision => decision, sanitizeText = value => String(value == null ? '' : value) } = {}) {
  if (!webContents || typeof webContents.executeJavaScriptInIsolatedWorld !== 'function' || !securityPolicy || typeof securityPolicy.modelAction !== 'function') {
    throw apiError('browser-playwright-integration-invalid', 'playwright 浏览器内核未正确接入独立执行世界。')
  }
  const normalized = normalizePlaywrightParameters(parameters)
  const effectiveConfirmationId = confirmationId == null || confirmationId === '' ? normalized.confirmationId : boundedString(confirmationId, 'confirmation_id', 200)
  const { confirmationId: _confirmationId, ...pageParameters } = normalized
  const readOnly = READ_OPERATIONS.has(normalized.operation)
  const bindingId = readOnly ? '' : randomUUID()
  const executeFixed = async phase => {
    // Text/value/key/checked are withheld from the untrusted renderer until the
    // host ActionGate has allowed the action. Preflight and backend-node binding
    // need only the normalized locator and operation shape.
    const gatedActionData = phase === 'prepare' || phase === 'verify'
      ? pageParameters
      : { ...pageParameters, text: '', value: '', key: '', checked: false }
    const input = { ...gatedActionData, phase, bindingId, bindingAttribute: PLAYWRIGHT_BINDING_ATTRIBUTE }
    const code = `(async()=>{try{return {protocol:'harness-fixed-playwright-v1',ok:true,value:await (${fixedLocatorPageFunction.toString()})(${JSON.stringify(input)})}}catch(error){return {protocol:'harness-fixed-playwright-v1',ok:false,error:{code:String(error?.code||''),message:String(error?.message||'')}}}})()`
    const envelope = await webContents.executeJavaScriptInIsolatedWorld(PLAYWRIGHT_WORLD_ID, [{ code }], false)
    if (!envelope || envelope.protocol !== 'harness-fixed-playwright-v1' || typeof envelope.ok !== 'boolean') {
      throw apiError('browser-playwright-isolated-world-invalid', '独立执行世界返回了无效协议结果。')
    }
    if (!envelope.ok) {
      const code = PAGE_ERROR_CODES.has(envelope.error?.code) ? envelope.error.code : 'browser-playwright-page-error'
      const message = code === 'browser-playwright-page-error'
        ? '页面 DOM 在受限操作期间返回异常。'
        : boundedString(envelope.error?.message, 'page_error', 1000) || '受限页面操作失败。'
      throw apiError(code, message)
    }
    return envelope.value
  }
  let bindingAllocated = false
  let trustedInputStarted = false
  try {
    assertCurrent()
    let raw = await executeFixed(readOnly ? 'read' : 'preflight')
    bindingAllocated = !readOnly
    assertCurrent()
    const field = raw?.field || { tag: 'document', selector: normalized.selector, baseUrl: origin }
    field.baseUrl = origin
    assertSafeFieldMetadata(field)
    const description = `${field.text || ''} ${field.label || ''} ${field.ariaLabel || ''}`
    if (!readOnly && /(?:purchase|pay|buy|checkout|bank|card|付款|支付|购买|结账|银行|银行卡)/i.test(description)) {
      throw apiError('financial-action-blocked', '模型永久禁止执行支付、购买或银行相关操作，请由用户亲自操作。')
    }
    const action = effectiveModelAction(normalized.operation, field, normalized)
    const payload = modelPayload(normalized.operation, normalized, field, raw || {})
    let backendNodeId = null
    if (!readOnly) {
      if (!webContents.debugger?.isAttached?.()) throw apiError('browser-input-unavailable', '受信任 CDP 输入通道当前不可用。')
      await executeFixed('bind')
      backendNodeId = await resolveBoundBackendNode(webContents.debugger, bindingId, assertCurrent)
      field.backendNodeId = String(backendNodeId)
      await executeFixed('unmark')
    }
    const decision = await securityPolicy.modelAction({ action, tabId, declaredOrigin: origin, field, payload, confirmationId: effectiveConfirmationId || undefined })
    if (!decision.allowed) return surfaceConfirmation(decision)
    assertCurrent()
    if (!readOnly) {
      markAction(`playwright:${normalized.operation}`)
      await executeFixed('prepare')
      const verifyBinding = () => executeFixed('verify')
      const finishInput = beginInput(`playwright:${normalized.operation}`)
      let actionError = null
      try {
        raw = await runTrustedCdpAction({
          webContents, normalized, bindingId, backendNodeId, assertCurrent, verifyBinding,
          onInputStarted: () => { trustedInputStarted = true }
        })
        assertCurrent()
      } catch (error) {
        actionError = error
      } finally {
        try { finishInput?.() } catch (error) { if (!actionError) actionError = error }
      }
      if (actionError) throw actionError
    }
    const result = { operation: normalized.operation, selectorKind: normalized.selectorKind, selector: normalized.selector, frameSelector: normalized.frameSelector || null }
    if (normalized.operation === 'domSnapshot') {
      result.snapshot = {
        ...raw.snapshot,
        title: sanitizeText(raw.snapshot?.title, 500),
        nodes: (raw.snapshot?.nodes || []).map(node => ({ ...node, name: sanitizeText(node.name, 500), text: sanitizeText(node.text, 500) }))
      }
    } else if (normalized.operation === 'count') result.count = raw.count
    else if (normalized.operation === 'isVisible') result.visible = raw.visible
    else if (normalized.operation === 'isEnabled') result.enabled = raw.enabled
    else if (['innerText', 'textContent', 'getAttribute'].includes(normalized.operation)) result.value = raw.value == null ? null : sanitizeText(raw.value, normalized.operation === 'getAttribute' ? 2000 : 12000)
    else Object.assign(result, { acted: true, ...(raw.selectedValue !== undefined ? { value: sanitizeText(raw.selectedValue, 500) } : {}), ...(raw.checked !== undefined ? { checked: raw.checked } : {}) })
    return result
  } catch (error) {
    throw trustedInputStarted ? asUnknownOutcome(error) : error
  } finally {
    if (bindingAllocated) {
      try {
        await executeFixed('cleanup')
      } catch (error) {
        if (trustedInputStarted) throw asUnknownOutcome(error)
      }
    }
  }
}

module.exports = {
  MAX_SNAPSHOT_NODES,
  PLAYWRIGHT_OPERATIONS,
  PLAYWRIGHT_WORLD_ID,
  READ_OPERATIONS,
  isSafeCssSelector,
  normalizePlaywrightParameters,
  runBrowserPlaywrightOperation
}
