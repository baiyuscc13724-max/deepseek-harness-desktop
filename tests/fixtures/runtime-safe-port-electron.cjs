const { app, session } = require('electron')
const http = require('node:http')
const assert = require('node:assert/strict')
const { allocateRuntimePort } = require('../../electron/bridge/runtime-port.cjs')

app.whenReady().then(async () => {
  const browser = session.fromPartition('runtime-safe-port-regression')
  await browser.setProxy({ mode: 'direct' })
  await assert.rejects(browser.fetch('http://127.0.0.1:6666/'), /ERR_UNSAFE_PORT/)
  const port = await allocateRuntimePort()
  const server = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('runtime-port-ok') })
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve) })
    const response = await browser.fetch(`http://127.0.0.1:${port}/`)
    assert.equal(response.status, 200)
    assert.equal(await response.text(), 'runtime-port-ok')
    console.log('PASS: Chromium rejects service port 6666 and accepts the allocated runtime port')
  } finally { await new Promise(resolve => server.close(resolve)) }
  app.exit(0)
}).catch(error => { console.error(error); app.exit(1) })
