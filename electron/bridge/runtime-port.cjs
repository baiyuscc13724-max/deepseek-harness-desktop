const { createServer } = require('node:net')
const { randomInt } = require('node:crypto')

// Use the dynamic/private range, above Chromium's restricted service ports.
// Do not disable Chromium's unsafe-port protection or delegate selection to DSH
// (--port 0 can select a service port which Node accepts but Chromium rejects).
const MIN_RUNTIME_PORT = 49152
const MAX_RUNTIME_PORT = 65535

async function allocateRuntimePort({ createServerImpl = createServer, randomIntImpl = randomInt, maxAttempts = 32 } = {}) {
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 128) throw new TypeError('Invalid port allocation attempt limit')
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const port = randomIntImpl(MIN_RUNTIME_PORT, MAX_RUNTIME_PORT + 1)
    if (!Number.isInteger(port) || port < MIN_RUNTIME_PORT || port > MAX_RUNTIME_PORT) throw new TypeError('Unsafe runtime port candidate')
    const available = await new Promise((resolve, reject) => {
      const server = createServerImpl()
      server.once('error', error => {
        if (['EADDRINUSE', 'EACCES'].includes(error.code)) resolve(false)
        else reject(error)
      })
      server.listen({ host: '127.0.0.1', port, exclusive: true }, () => {
        server.close(error => error ? reject(error) : resolve(true))
      })
    })
    // Release before child bind. Another process may win that race; the runtime's
    // normal startup error/retry path must handle it, never attach to that process.
    if (available) return port
  }
  throw new Error('No available browser-safe local runtime port; please retry')
}

module.exports = { allocateRuntimePort, MIN_RUNTIME_PORT, MAX_RUNTIME_PORT }
