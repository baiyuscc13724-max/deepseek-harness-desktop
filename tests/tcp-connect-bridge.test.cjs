const test = require('node:test')
const assert = require('node:assert/strict')
const net = require('node:net')

const {
  createConnectBridge,
  parseHostPort,
  selectHttpProxy
} = require('../electron/bridge/tcp-connect-bridge.cjs')

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      resolve(server.address())
    })
  })
}

function close(server) {
  return new Promise(resolve => server.close(resolve))
}

test('proxy rules select the first supported HTTP CONNECT proxy', () => {
  assert.deepEqual(parseHostPort('127.0.0.1:7897'), { host: '127.0.0.1', port: 7897 })
  assert.deepEqual(parseHostPort('[::1]:8080'), { host: '::1', port: 8080 })
  assert.equal(parseHostPort('invalid'), null)
  assert.deepEqual(
    selectHttpProxy('SOCKS5 127.0.0.1:1080; PROXY 127.0.0.1:7897; DIRECT'),
    { host: '127.0.0.1', port: 7897 }
  )
  assert.equal(selectHttpProxy('DIRECT'), null)
})

test('CONNECT bridge carries a bidirectional TCP stream through the selected proxy', async t => {
  const target = net.createServer(socket => socket.pipe(socket))
  const targetAddress = await listen(target)
  t.after(() => close(target))

  const proxy = net.createServer(client => {
    let request = Buffer.alloc(0)
    const readHeader = chunk => {
      request = Buffer.concat([request, chunk])
      const boundary = request.indexOf('\r\n\r\n')
      if (boundary < 0) return
      client.off('data', readHeader)
      const firstLine = request.subarray(0, boundary).toString('latin1').split('\r\n')[0]
      const match = /^CONNECT ([^:]+):(\d+) HTTP\/1\.1$/.exec(firstLine)
      assert.ok(match)
      const upstream = net.connect(Number(match[2]), match[1], () => {
        client.write('HTTP/1.1 200 Connection established\r\n\r\n')
        const rest = request.subarray(boundary + 4)
        if (rest.length) upstream.write(rest)
        client.pipe(upstream)
        upstream.pipe(client)
      })
      upstream.on('error', error => client.destroy(error))
    }
    client.on('data', readHeader)
  })
  const proxyAddress = await listen(proxy)
  t.after(() => close(proxy))

  const bridge = await createConnectBridge({
    proxy: { host: '127.0.0.1', port: proxyAddress.port },
    targetHost: '127.0.0.1',
    targetPort: targetAddress.port
  })
  t.after(() => bridge.close())

  const echoed = await new Promise((resolve, reject) => {
    const client = net.connect(bridge.port, bridge.host, () => client.write('harness-mobile-sync'))
    client.once('data', chunk => {
      resolve(chunk.toString())
      client.destroy()
    })
    client.once('error', reject)
  })
  assert.equal(echoed, 'harness-mobile-sync')
})
