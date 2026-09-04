'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const androidRuntime = fs.readFileSync(path.join(root, 'mobile', 'android', 'app', 'src', 'main', 'assets', 'mobile-runtime.js'), 'utf8')
const iosRuntime = fs.readFileSync(path.join(root, 'mobile', 'ios', 'HarnessMobile', 'Resources', 'mobile-runtime.js'), 'utf8')
const androidCss = fs.readFileSync(path.join(root, 'mobile', 'android', 'app', 'src', 'main', 'assets', 'mobile-compat.css'), 'utf8')
const iosCss = fs.readFileSync(path.join(root, 'mobile', 'ios', 'HarnessMobile', 'Resources', 'mobile-compat.css'), 'utf8')
const official = fs.readFileSync(path.join(root, 'node_modules', '@deepseek-ai', 'dsh-client-ui-conversation', 'lib', 'client.js'), 'utf8')

test('official Full access remains guarded by explicit acknowledgement and confirmation', () => {
  assert.match(official, /const FULL_ACCESS = "danger-full-access"/u)
  assert.match(official, /if \(id === FULL_ACCESS\) \{[^]*setConfirmation\(id\)/u)
  assert.match(official, /if \(locked \|\| !acknowledged \|\| confirmation === null\) return/u)
  assert.match(official, /RiskConfirmation/u)
  assert.match(official, /command\(`\/permission \$\{id\}`\)/u)
})

test('mobile exposes the official access-mode trigger without issuing permission commands', () => {
  const start = androidRuntime.indexOf("for (const button of composer.querySelectorAll('button'))")
  const end = androidRuntime.indexOf('    if (inputScroll)', start)
  assert.ok(start >= 0 && end > start)
  const decoration = androidRuntime.slice(start, end)
  assert.match(decoration, /访问模式\|Access mode/u)
  assert.match(decoration, /button\.dataset\.harnessMobilePermissionTrigger = 'true'/u)
  assert.match(decoration, /Preserve the official PermissionSelect and its RiskConfirmation/u)
  assert.doesNotMatch(androidRuntime, /\/permission danger-full-access|command\(`\/permission/u)
})

test('composer decoration preserves the official permission control as an interactive trigger', () => {
  const start = androidRuntime.indexOf('  const decorateConversation = () => {')
  const end = androidRuntime.indexOf('  let composerStyleRestorations = []', start)
  assert.ok(start >= 0 && end > start)
  const source = androidRuntime.slice(start, end)
  const permissionContext = { dataset: {}, parentElement: null }
  const permission = { dataset: {}, id: '', title: '', textContent: 'Full access', parentElement: permissionContext, getAttribute: name => name === 'aria-label' ? 'Access mode: Full access' : '' }
  const send = { dataset: {}, id: '', title: '', textContent: '', getAttribute: name => name === 'aria-label' ? 'Send message' : '' }
  const tool = { dataset: {}, id: '', title: '', textContent: '', getAttribute: name => name === 'aria-label' ? 'Attach files' : '' }
  const menuItem = { dataset: {}, id: '', title: '', textContent: 'Workspace Write', getAttribute: () => '', closest: selector => selector.includes('[role="menu"]') ? {} : null }
  const attachmentRail = { querySelector: selector => selector === 'img[alt]' ? {} : null }
  const thumbnail = { dataset: { harnessMobileComposerTool: 'true' }, id: '', title: '', textContent: '', getAttribute: () => '', closest: selector => selector === '[role="group"]' ? attachmentRail : null }
  const composer = {
    dataset: {},
    parentElement: { dataset: {} },
    querySelector: () => null,
    querySelectorAll: selector => selector === 'button' ? [permission, send, tool, menuItem, thumbnail] : []
  }
  permissionContext.parentElement = composer
  const conversation = {
    dataset: {},
    querySelector(selector) { return selector === '[data-composer-card]' ? composer : null },
    querySelectorAll: () => []
  }
  const document = { querySelector: () => conversation }
  const decorate = new Function('document', 'window', 'decorateConversationWorkflow', 'accessibleButtonText', 'ensureMobileComposerModelControl', 'normalizeMobileComposerLayers', 'composerInput', `${source}\nreturn decorateConversation`) // eslint-disable-line no-new-func
    (document, {}, () => {}, button => String(button.getAttribute('aria-label') || button.title || button.textContent || '').trim(), () => {}, () => {}, scope => scope?.querySelector?.('[data-composer-input][data-phase], textarea[data-phase]') || null)
  decorate()
  assert.equal(permission.dataset.harnessMobilePermissionTrigger, 'true')
  assert.equal(permission.dataset.harnessMobileComposerTool, undefined)
  assert.equal(permissionContext.dataset.harnessMobilePermissionContext, 'true', 'permission ancestors must allow the official menu to escape composer clipping')
  assert.equal(send.dataset.harnessMobileComposerAction, 'true')
  assert.equal(tool.dataset.harnessMobileComposerTool, 'true')
  assert.equal(menuItem.dataset.harnessMobileComposerTool, undefined, 'official permission choices inside the menu must remain visible')
  assert.equal(thumbnail.dataset.harnessMobileComposerTool, undefined, 'official attachment previews and their controls must remain visible')
})

test('Full access risk confirmation keeps its acknowledgement readable and touch safe', () => {
  assert.match(androidRuntime, /dialog\.querySelector\('input\[type="checkbox"\]'\)[^]*\/Full access\/i\.test\(accessibleButtonText\(button\)\)[^]*harnessMobileRiskConfirmation = 'true'/u)
  assert.match(androidCss, /\[role="dialog"\]\s+input:not\(\[type="checkbox"\]\):not\(\[type="radio"\]\)/u, 'generic dialog fields must not stretch checkbox and radio controls')
  assert.match(androidCss, /data-harness-mobile-risk-confirmation="true"\]\s*>\s*div:first-child\s*>\s*div:nth-child\(2\)\s*>\s*label\s*\{[^}]*min-height:\s*44px !important;[^}]*grid-template-columns:\s*20px minmax\(0, 1fr\) !important;/su)
  assert.match(androidCss, /data-harness-mobile-risk-confirmation="true"\]\s+input\[type="checkbox"\]\s*\{[^}]*width:\s*18px !important;[^}]*height:\s*18px !important;/su)
  assert.match(androidCss, /data-harness-mobile-risk-confirmation="true"\]\s*>\s*div:last-child\s*>\s*button\s*\{[^}]*min-height:\s*44px !important;/su)
})

test('permission trigger is touch safe and Android/iOS resources stay identical', () => {
  assert.match(official, /@container \(width<=460px\)\{[^}]*trigger:has\([^}]*triggerLabel\{display:none\}/u, 'official narrow-container behavior hides the label unless mobile overrides it')
  assert.match(official, /onClick: \(\) => \{\s*setOpen\(!open\)/u, 'the official trigger must remain the menu owner')
  assert.match(androidCss, /\[data-harness-mobile-permission-trigger="true"\][^{]*\{[^}]*min-width:\s*44px !important;[^}]*min-height:\s*44px !important;[^}]*display:\s*inline-flex !important;/su)
  assert.match(androidCss, /\[data-harness-mobile-permission-trigger="true"\]\s*>\s*span:not\(\[aria-hidden="true"\]\)[^{]*\{[^}]*display:\s*inline !important;/su, 'mobile must override the official narrow-container rule that hides the access-mode label')
  assert.match(androidCss, /\[data-harness-mobile-permission-context="true"\][^{]*\{[^}]*overflow:\s*visible !important;/su, 'official permission menu ancestors must not clip the expanded choices')
  assert.match(androidCss, /\[data-harness-mobile-composer-toolbar-left="true"\][^{]*\{[^}]*overflow:\s*visible !important;/su, 'the shared access/model toolbar seat must let the official permission menu escape')
  assert.doesNotMatch(androidCss, /\[data-harness-mobile-composer-toolbar-left="true"\][^{]*\{[^}]*overflow:\s*hidden !important;/su, 'the model toolbar layout must never reintroduce permission-menu clipping')
  assert.match(androidCss, /data-harness-mobile-chat-detail="open"\]\s+\[role="menu"\]:not\(#harness-mobile-input-menu\)[^{]*\{[^}]*z-index:\s*980 !important;/su, 'official portal menus must stay above the mobile composer and navigation layers')
  assert.doesNotMatch(androidCss, /data-harness-mobile-chat-detail="open"\]\s+\[role="menu"\]\s*\{/su, 'the mobile plus menu keeps its own higher stacking contract')
  assert.match(androidCss, /\[data-harness-mobile-composer-tool="true"\][^{]*\{[^}]*display:\s*none !important;/su)
  assert.doesNotMatch(androidRuntime, /setTemporary\(button\.parentElement, 'overflow', 'hidden'\)/u, 'command-button containment must not clip the adjacent official permission menu')
  assert.equal(androidRuntime, iosRuntime)
  assert.equal(androidCss, iosCss)
})
