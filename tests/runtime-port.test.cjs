const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { readFile } = require('node:fs/promises')
const path = require('node:path')
const { allocateRuntimePort, MIN_RUNTIME_PORT, MAX_RUNTIME_PORT } = require('../electron/bridge/runtime-port.cjs')

function fakeServers(errors, seen) {
  return () => {
    const server = new EventEmitter()
    server.listen = (options, ready) => {
      seen.push(options)
      const code = errors.shift()
      queueMicrotask(() => code ? server.emit('error', Object.assign(new Error(code), { code })) : ready())
    }
    server.close = callback => { seen.push('closed'); callback() }
    return server
  }
}

test('runtime uses a browser-safe high port and closes its probe before returning', async () => {
  const seen = []
  const port = await allocateRuntimePort({ createServerImpl: fakeServers([], seen), randomIntImpl: (min, max) => { assert.equal(min, 49152); assert.equal(max, 65536); return 55000 } })
  assert.equal(port, 55000)
  assert.deepEqual(seen, [{ host: '127.0.0.1', port: 55000, exclusive: true }, 'closed'])
})

test('occupied and denied ports retry with a bounded attempt count', async () => {
  const seen = []
  let candidate = MIN_RUNTIME_PORT
  assert.equal(await allocateRuntimePort({ createServerImpl: fakeServers(['EADDRINUSE', 'EACCES'], seen), randomIntImpl: () => candidate++, maxAttempts: 3 }), MIN_RUNTIME_PORT + 2)
  await assert.rejects(allocateRuntimePort({ createServerImpl: fakeServers(['EADDRINUSE', 'EADDRINUSE'], []), maxAttempts: 2 }), /No available browser-safe/)
  await assert.rejects(allocateRuntimePort({ createServerImpl: fakeServers(['EMFILE'], []) }), /EMFILE/)
})

test('unsafe candidates and unbounded retries are rejected before binding', async () => {
  for (const port of [0, 6666, 10080, 49151, 65536, NaN]) {
    await assert.rejects(allocateRuntimePort({ randomIntImpl: () => port, createServerImpl: () => { throw new Error('must not bind') } }), /Unsafe runtime port/)
  }
  await assert.rejects(allocateRuntimePort({ maxAttempts: Infinity }), /attempt limit/)
})

test('real loopback allocation returns a safe port', async () => {
  const port = await allocateRuntimePort()
  assert.ok(port >= MIN_RUNTIME_PORT && port <= MAX_RUNTIME_PORT)
})

test('desktop and packaged startup self-test pass the selected port to DSH', async () => {
  for (const relative of ['electron/main.cjs', 'electron/bridge/self-test-service.cjs']) {
    const source = await readFile(path.resolve(__dirname, '..', relative), 'utf8')
    assert.match(source, /const runtimePort = await allocateRuntimePort\(\)/)
    assert.match(source, /'web', '--port', String\(runtimePort\), '--no-open'/)
    assert.doesNotMatch(source, /'web', '--port', '0'/)
    assert.doesNotMatch(source, /appendSwitch\(['"]explicitly-allowed-ports/)
  }
})
