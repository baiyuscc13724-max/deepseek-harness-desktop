const test = require('node:test')
const assert = require('node:assert/strict')

const { detectHighRisk, redact, PATTERN_TYPES } = require('../electron/bridge/memory-censor.cjs')

function only(types, ...expected) {
  assert.deepEqual(types.slice().sort(), [...expected].sort())
}

test('password 类高风险文本可被识别', () => {
  only(detectHighRisk('登录密码是 Abc12345'), 'password')
  only(detectHighRisk('password=sup3rSecret!'), 'password')
  only(detectHighRisk('口令：123456'), 'password')
  only(detectHighRisk('passwd : hunter2hunter2'), 'password')
})

test('API key 类高风险文本可被识别', () => {
  only(detectHighRisk('api_key = BK-cf8f1d4f3a4b5c6d7e8f9a0b'), 'api-key')
  only(detectHighRisk('secret_key: mySecretValue123456'), 'api-key')
  only(detectHighRisk('调用了 sk-fake0key1test2abc3def4'), 'api-key')
})

test('token 类高风险文本可被识别', () => {
  only(detectHighRisk('access_token = Lv8abc123def456ghi789'), 'token')
  only(detectHighRisk('session_token: supervisorTokenAbc123'), 'token')
  only(detectHighRisk('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signature'), 'token')
  only(detectHighRisk('github token: ghp_fake12345678901234567890'), 'token')
})

test('Cookie 与 Authorization 高风险文本可被识别', () => {
  only(detectHighRisk('Cookie: sessionid=abc123xyz; Path=/'), 'cookie')
  only(detectHighRisk('session_id=abc123xyz'), 'cookie')
  only(detectHighRisk('Authorization: Bearer abcdefghijklmnop'), 'authorization')
  only(detectHighRisk('authorization: Basic dXNlcjpwYXNzd29yZA=='), 'authorization')
})

test('银行卡号通过 Luhn 校验后识别，普通长数字不误报', () => {
  only(detectHighRisk('我的卡号是 4111 1111 1111 1111'), 'bank-card')
  only(detectHighRisk('5555555555554444'), 'bank-card')
  assert.deepEqual(detectHighRisk('项目时间戳 20240101120000'), [])
  assert.deepEqual(detectHighRisk('电话 13800138000 已备注'), [])
})

test('验证码类高风险文本可被识别（中英文）', () => {
  only(detectHighRisk('验证码是 482913，请勿泄露'), 'verification-code')
  only(detectHighRisk('您的验证码：482913'), 'verification-code')
  only(detectHighRisk('Your verification code is 482913'), 'verification-code')
  only(detectHighRisk('otp: 123456'), 'verification-code')
})

test('普通说明文本不误报', () => {
  assert.deepEqual(detectHighRisk('今天气温 28 度，明天 35 度'), [])
  assert.deepEqual(detectHighRisk('用户喜欢大熊猫和竹子'), [])
  assert.deepEqual(detectHighRisk('备份地址 https://example.com/path/123456 正常'), [])
  assert.deepEqual(detectHighRisk('password is required to be strong'), [])
  assert.deepEqual(detectHighRisk(''), [])
  assert.deepEqual(detectHighRisk(null), [])
})

test('redact 脱敏后原文完全消失并给出类型', () => {
  const result = redact('登录密码=sup3rSecret! 密钥为Abc12345')
  assert.ok(!result.text.includes('sup3rSecret'))
  assert.ok(!result.text.includes('Abc12345'))
  assert.ok(result.text.includes('[REDACTED:password]'))
  assert.ok(result.text.includes('[REDACTED:secret]'))
  assert.ok(result.types.includes('password'))
  assert.ok(result.types.includes('secret'))
})

test('redact 对普通文本原样返回', () => {
  const result = redact('普通备忘内容')
  assert.equal(result.text, '普通备忘内容')
  assert.deepEqual(result.types, [])
})

test('redact 覆盖银行卡与验证码', () => {
  const result = redact('卡号 4111 1111 1111 1111，验证码 482913')
  assert.ok(!result.text.includes('4111'))
  assert.ok(!result.text.includes('482913'))
  assert.ok(result.text.includes('[REDACTED:bank-card]'))
  assert.ok(result.text.includes('[REDACTED:verification-code]'))
})

test('PATTERN_TYPES 提供稳定类型清单', () => {
  assert.ok(Array.isArray(PATTERN_TYPES))
  for (const type of ['password', 'api-key', 'token', 'cookie', 'authorization', 'bank-card', 'verification-code']) {
    assert.ok(PATTERN_TYPES.includes(type), `missing ${type}`)
  }
})