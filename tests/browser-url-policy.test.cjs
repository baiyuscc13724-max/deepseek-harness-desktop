const assert = require('node:assert/strict')
const test = require('node:test')

const {
  BLOCKED_SCHEMES,
  MAX_URL_LENGTH,
  canonicalOrigin,
  checkModelNavigation,
  checkUserNavigation,
  classifyNavigation,
  hostPublicInfo,
  isPrivateIpv4,
  normalizeUrl,
  originOf,
  sameOrigin
} = require('../electron/bridge/browser-url-policy.cjs')

test('URL 规范化：小写化、默认端口去除、点段折叠、origin 提取', () => {
  assert.equal(normalizeUrl('HTTPS://EXAMPLE.COM:443/a/../b?q=1#f'), 'https://example.com/b?q=1#f')
  assert.equal(normalizeUrl('http://Example.com:80/'), 'http://example.com/')
  assert.equal(normalizeUrl('https://example.com:8443/x'), 'https://example.com:8443/x')
  assert.equal(canonicalOrigin('https://example.com'), 'https://example.com')
  assert.equal(canonicalOrigin('https://EXAMPLE.com:443'), 'https://example.com')
  assert.equal(canonicalOrigin('http://example.com:8080'), 'http://example.com:8080')
  assert.equal(originOf('https://例子.测试/路径'), 'https://xn--fsqu00a.xn--0zwm56d')
  assert.equal(originOf('not a url'), null)
  assert.equal(sameOrigin('https://a.com/x', 'https://A.com/y'), true)
  assert.equal(sameOrigin('https://a.com', 'https://b.com'), false)
})

test('用户导航档：仅 http/https，其余协议一律拒绝', () => {
  for (const bad of [
    'file:///C:/secret.txt',
    'data:text/html,<script>1</script>',
    'javascript:alert(1)',
    'chrome://settings',
    'devtools://devtools',
    'about:blank',
    'blob:https://example.com/id',
    'ws://example.com/socket',
    'wss://example.com/socket',
    'ftp://example.com/file',
    'mailto:a@b.c',
    'tel:12345',
    'harness-desktop://open-local?x=1',
    'chrome-extension://abc/'
  ]) {
    const nav = classifyNavigation(bad)
    assert.equal(nav.allowed, false, `${bad} 应当被拒绝`)
    assert.equal(nav.reason, 'scheme-blocked')
  }
  assert.ok(BLOCKED_SCHEMES.has('file:') && BLOCKED_SCHEMES.has('data:') && BLOCKED_SCHEMES.has('javascript:'))
  assert.ok(BLOCKED_SCHEMES.has('chrome:') && BLOCKED_SCHEMES.has('devtools:'))
})

test('用户导航档：内嵌凭据、畸形、过长的地址拒绝', () => {
  assert.equal(classifyNavigation('https://user:pass@example.com').reason, 'credentials')
  assert.equal(classifyNavigation('https://example.com/%ZZ').reason, 'parse-error')
  assert.equal(classifyNavigation('').reason, 'empty')
  assert.equal(classifyNavigation('   ').reason, 'empty')
  assert.equal(classifyNavigation(`https://e.com/${'a'.repeat(9000)}`).reason, 'too-long')
  assert.equal(classifyNavigation('https://exa\nmple.com').reason, 'parse-error')
  assert.throws(() => checkUserNavigation('file:///etc/passwd'), error => error.code === 'scheme-blocked')
  assert.throws(() => checkUserNavigation('https://u:p@example.com'), error => error.code === 'credentials')
  const nav = checkUserNavigation('https://example.com/a')
  assert.equal(nav.allowed, true)
  assert.equal(nav.origin, 'https://example.com')
})

test('rel 相对地址必须显式 base，否则拒绝', () => {
  assert.equal(classifyNavigation('/path').reason, 'parse-error')
  const nav = classifyNavigation('/path?q=1', { base: 'https://example.com/index.html' })
  assert.equal(nav.allowed, true)
  assert.equal(nav.normalized, 'https://example.com/path?q=1')
  assert.equal(nav.origin, 'https://example.com')
})

test('公网判定：本机/内网/链路本地/文档网段拒绝，公网放行', () => {
  assert.deepEqual(hostPublicInfo('example.com'), { public: true, reason: null })
  assert.equal(hostPublicInfo('localhost').public, false)
  assert.equal(hostPublicInfo('intranet.corp').public, false) // .internal 后缀
  assert.equal(hostPublicInfo('nas').public, false) // 单标签主机名
  assert.equal(hostPublicInfo('127.0.0.1').public, false)
  assert.equal(hostPublicInfo('10.1.2.3').public, false)
  assert.equal(hostPublicInfo('172.16.0.1').public, false)
  assert.equal(hostPublicInfo('172.31.255.254').public, false)
  assert.equal(hostPublicInfo('172.32.0.1').public, true)
  assert.equal(hostPublicInfo('192.168.1.1').public, false)
  assert.equal(hostPublicInfo('169.254.1.1').public, false)
  assert.equal(hostPublicInfo('100.64.0.1').public, false)
  assert.equal(hostPublicInfo('8.8.8.8').public, true)
  assert.equal(hostPublicInfo('2130706433').public, false) // 127.0.0.1 整数形态
  assert.equal(hostPublicInfo('[::1]').public, false)
  assert.equal(hostPublicInfo('::1').public, false)
  assert.equal(hostPublicInfo('fc00::1').public, false)
  assert.equal(hostPublicInfo('fe80::1').public, false)
  assert.equal(hostPublicInfo('2001:db8::1').public, false)
  assert.equal(hostPublicInfo('::ffff:127.0.0.1').public, false)
  assert.equal(hostPublicInfo('2606:4700:4700::1111').public, true)
  assert.equal(isPrivateIpv4('192.168.0.1'), true)
  assert.equal(isPrivateIpv4('93.184.216.34'), false)
})

test('模型导航档：公网 + origin 已授权双重要求，比用户档更严', () => {
  const authorized = new Set(['https://example.com', 'https://docs.example.com'])
  const ok = checkModelNavigation('https://example.com/page', { authorizedOrigins: authorized })
  assert.equal(ok.normalized, 'https://example.com/page')
  assert.equal(ok.origin, 'https://example.com')

  // 公网但未授权 → 拒绝 origin-not-authorized
  assert.throws(
    () => checkModelNavigation('https://other-site.com', { authorizedOrigins: authorized }),
    error => error.code === 'origin-not-authorized'
  )
  // 已授权但内网 → 拒绝 non-public-network
  assert.throws(
    () => checkModelNavigation('https://127.0.0.1/login', { authorizedOrigins: authorized }),
    error => error.code === 'private-network-not-authorized'
  )
  assert.throws(
    () => checkModelNavigation('http://10.0.0.5/admin', { authorizedOrigins: new Set(['http://10.0.0.5']) }),
    error => error.code === 'private-network-not-authorized'
  )
  assert.throws(
    () => checkModelNavigation('https://localhost/app', { authorizedOrigins: new Set(['https://localhost']) }),
    error => error.code === 'private-network-not-authorized'
  )
  const local = checkModelNavigation('http://localhost:3000/app', {
    authorizedOrigins: new Set(['http://localhost:3000']),
    authorizedPrivateOrigins: new Set(['http://localhost:3000'])
  })
  assert.equal(local.origin, 'http://localhost:3000')
  assert.equal(local.privateNetwork, true)
  assert.throws(
    () => checkModelNavigation('http://localhost:3001/app', {
      authorizedOrigins: new Set(['http://localhost:3000']),
      authorizedPrivateOrigins: new Set(['http://localhost:3000'])
    }),
    error => error.code === 'private-network-not-authorized'
  )
  // 已授权但协议不符（用户档规则同样适用于模型档）
  assert.throws(
    () => checkModelNavigation('file:///etc/passwd', { authorizedOrigins: authorized }),
    error => error.code === 'scheme-blocked'
  )
  // 用户可访问的内网地址，模型档拒绝 —— 体现「模型访问另有更严策略」
  assert.equal(checkUserNavigation('http://192.168.1.1/router').allowed, true)
})

test('MAX_URL_LENGTH 常量导出且为正', () => {
  assert.ok(MAX_URL_LENGTH > 0)
  assert.equal(typeof MAX_URL_LENGTH, 'number')
})