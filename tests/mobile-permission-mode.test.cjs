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

test('permission trigger is touch safe and Android/iOS resources stay identical', () => {
  assert.match(androidCss, /\[data-harness-mobile-permission-trigger="true"\][^{]*\{[^}]*min-width:\s*44px !important;[^}]*min-height:\s*44px !important;[^}]*display:\s*inline-flex !important;/su)
  assert.match(androidCss, /\[data-harness-mobile-composer-tool="true"\][^{]*\{[^}]*display:\s*none !important;/su)
  assert.equal(androidRuntime, iosRuntime)
  assert.equal(androidCss, iosCss)
})
