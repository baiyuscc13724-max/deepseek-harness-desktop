'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { MAX_UNIX_SOCKET_PATH_BYTES, createLocalIpcEndpoint } = require('../electron/bridge/local-ipc-endpoint.cjs')

const NONCE = 'ab'.repeat(12)

test('local IPC endpoint falls back to short /tmp path before Darwin sockaddr overflow', () => {
  const endpoint = createLocalIpcEndpoint('ata', {
    platform: 'darwin',
    temporaryDirectory: `/var/folders/${'long-segment/'.repeat(20)}T`,
    pid: 4321,
    nonce: NONCE
  })
  assert.equal(endpoint, `/tmp/dsh-ata-4321-${NONCE}.sock`)
  assert.ok(Buffer.byteLength(endpoint, 'utf8') <= MAX_UNIX_SOCKET_PATH_BYTES)
})

test('local IPC endpoint keeps short Unix roots and creates bounded Windows named pipes', () => {
  const unix = createLocalIpcEndpoint('ats', { platform: 'linux', temporaryDirectory: '/safe/tmp', pid: 7, nonce: NONCE })
  assert.equal(unix, path.posix.join('/safe/tmp', `dsh-ats-7-${NONCE}.sock`))
  assert.ok(Buffer.byteLength(unix, 'utf8') <= MAX_UNIX_SOCKET_PATH_BYTES)
  assert.equal(createLocalIpcEndpoint('ats', { platform: 'win32', windowsKind: 'agent-teams-secret', pid: 7, nonce: NONCE }), `\\\\.\\pipe\\dsh-agent-teams-secret-7-${NONCE}.sock`)
})
