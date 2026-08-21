const net = require('node:net')
const pipePath = `\\\\.\\pipe\\dsh-sandbox-probe-${process.pid}-${Date.now()}`
const server = net.createServer(socket => {
  socket.end('pipe-ok')
})
server.once('error', fail('listen'))
server.listen(pipePath, () => {
  console.log(JSON.stringify({ operation: 'listen', ok: true }))
  const client = net.connect(pipePath)
  client.once('error', fail('connect'))
  client.once('data', data => console.log(JSON.stringify({ operation: 'connect', data: data.toString() })))
  client.once('close', () => server.close())
})

function fail(operation) {
  return error => {
    console.error(JSON.stringify({ operation, code: error.code, message: error.message }))
    process.exitCode = 1
    server.close()
  }
}
