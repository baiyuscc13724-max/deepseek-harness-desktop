const net = require('node:net')

function parseHostPort(value) {
  const text = String(value || '').trim()
  const ipv6 = /^\[([^\]]+)]:(\d+)$/.exec(text)
  if (ipv6) return { host: ipv6[1], port: Number(ipv6[2]) }
  const separator = text.lastIndexOf(':')
  if (separator <= 0) return null
  const port = Number(text.slice(separator + 1))
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null
  return { host: text.slice(0, separator), port }
}

function selectHttpProxy(value) {
  for (const entry of String(value || '').split(';')) {
    const match = /^\s*(PROXY|HTTPS?)\s+(.+?)\s*$/i.exec(entry)
    if (!match) continue
    const address = parseHostPort(match[2])
    if (address) return address
  }
  return null
}

function createConnectBridge({ proxy, targetHost, targetPort, connectTimeout = 10000 }) {
  if (!proxy?.host || !proxy?.port) throw new Error('HTTP proxy address is invalid.')
  if (!targetHost || !Number.isInteger(targetPort)) throw new Error('Relay target is invalid.')
  const sockets = new Set()
  const server = net.createServer(client => {
    sockets.add(client)
    const upstream = net.connect(proxy.port, proxy.host)
    sockets.add(upstream)
    let response = Buffer.alloc(0)
    const timer = setTimeout(() => fail(new Error('代理连接超时')), connectTimeout)
    const cleanup = () => {
      clearTimeout(timer)
      sockets.delete(client)
      sockets.delete(upstream)
    }
    const fail = error => {
      cleanup()
      client.destroy(error)
      upstream.destroy()
    }
    client.once('close', cleanup)
    upstream.once('close', cleanup)
    client.once('error', () => upstream.destroy())
    upstream.once('error', fail)
    upstream.once('connect', () => upstream.write(
      `CONNECT ${targetHost}:${targetPort} HTTP/1.1\r\n` +
      `Host: ${targetHost}:${targetPort}\r\n` +
      'Proxy-Connection: keep-alive\r\n\r\n'
    ))
    const inspect = chunk => {
      response = Buffer.concat([response, chunk])
      if (response.length > 16 * 1024) return fail(new Error('代理响应异常'))
      const boundary = response.indexOf('\r\n\r\n')
      if (boundary < 0) return
      upstream.off('data', inspect)
      const status = response.subarray(0, boundary).toString('latin1').split('\r\n')[0]
      if (!/^HTTP\/1\.[01] 200\b/.test(status)) return fail(new Error(`代理拒绝连接：${status}`))
      clearTimeout(timer)
      const rest = response.subarray(boundary + 4)
      if (rest.length) client.write(rest)
      client.pipe(upstream)
      upstream.pipe(client)
    }
    upstream.on('data', inspect)
  })

  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      const address = server.address()
      resolve({
        host: '127.0.0.1',
        port: address.port,
        close: async () => {
          for (const socket of sockets) socket.destroy()
          await new Promise(done => server.close(done))
        }
      })
    })
  })
}

module.exports = { createConnectBridge, parseHostPort, selectHttpProxy }
