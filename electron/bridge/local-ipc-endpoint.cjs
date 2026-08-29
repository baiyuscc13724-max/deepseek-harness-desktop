'use strict'

const os = require('node:os')
const path = require('node:path')
const { randomBytes } = require('node:crypto')

// Darwin's sockaddr_un.sun_path is only 104 bytes including its terminator.
// Keep a small margin so UTF-8 paths and future suffixes cannot cross it.
const MAX_UNIX_SOCKET_PATH_BYTES = 100

function createLocalIpcEndpoint(kind, options = {}) {
  if (typeof kind !== 'string' || !/^[a-z0-9]{1,8}$/u.test(kind)) throw new TypeError('IPC endpoint kind is invalid')
  const platform = options.platform || process.platform
  const pid = options.pid ?? process.pid
  const nonce = options.nonce || randomBytes(12).toString('hex')
  if (!Number.isSafeInteger(pid) || pid <= 0 || typeof nonce !== 'string' || !/^[a-f0-9]{24}$/u.test(nonce)) throw new TypeError('IPC endpoint identity is invalid')
  const name = `dsh-${kind}-${pid}-${nonce}.sock`
  if (platform === 'win32') {
    const windowsKind = options.windowsKind || kind
    if (typeof windowsKind !== 'string' || !/^[a-z0-9-]{1,48}$/u.test(windowsKind)) throw new TypeError('Windows IPC endpoint kind is invalid')
    return `\\\\.\\pipe\\dsh-${windowsKind}-${pid}-${nonce}.sock`
  }
  const preferred = path.posix.join(options.temporaryDirectory || os.tmpdir(), name)
  if (Buffer.byteLength(preferred, 'utf8') <= MAX_UNIX_SOCKET_PATH_BYTES) return preferred
  const fallback = path.posix.join('/tmp', name)
  if (Buffer.byteLength(fallback, 'utf8') > MAX_UNIX_SOCKET_PATH_BYTES) throw new Error('IPC endpoint exceeds the Unix socket path limit')
  return fallback
}

module.exports = { MAX_UNIX_SOCKET_PATH_BYTES, createLocalIpcEndpoint }
