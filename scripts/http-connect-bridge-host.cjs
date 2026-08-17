const { writeFileSync } = require('node:fs')
const path = require('node:path')

const { createConnectBridge, parseHostPort } = require('../electron/bridge/tcp-connect-bridge.cjs')

function argument(name, fallback = null) {
  const index = process.argv.indexOf(name)
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback
}

async function main() {
  const proxy = parseHostPort(argument('--proxy'))
  const target = parseHostPort(argument('--target'))
  const readyFile = argument('--ready-file')
  if (!proxy || !target) throw new Error('Both --proxy and --target must be host:port values.')
  const bridge = await createConnectBridge({ proxy, targetHost: target.host, targetPort: target.port })
  if (readyFile) writeFileSync(path.resolve(readyFile), `${JSON.stringify({ host: bridge.host, port: bridge.port })}\n`, 'utf8')
  process.stdout.write('HTTP_CONNECT_BRIDGE_READY\n')
  const shutdown = async () => {
    await bridge.close().catch(() => {})
    process.exit(0)
  }
  process.once('SIGINT', shutdown)
  process.once('SIGTERM', shutdown)
}

main().catch(error => {
  console.error(error.stack || error.message)
  process.exitCode = 1
})
