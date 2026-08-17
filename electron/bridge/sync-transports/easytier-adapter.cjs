const path = require('node:path')
const { ProcessTransportAdapter } = require('./process-adapter.cjs')
const { createConnectBridge, selectHttpProxy } = require('../tcp-connect-bridge.cjs')

const DEFAULT_RELAY = 'tcp://us01.225284.xyz:11010'

function resolveEasyTierBinary({ resourcesPath, componentRoot, developmentRoot }) {
  const name = process.platform === 'win32' ? 'easytier-core.exe' : 'easytier-core'
  const candidates = [
    componentRoot && path.join(componentRoot, 'easytier', name),
    resourcesPath && path.join(resourcesPath, 'network', 'easytier', name),
    developmentRoot && path.join(developmentRoot, 'third_party', 'network', 'easytier', name)
  ].filter(Boolean)
  return candidates.find(candidate => require('node:fs').existsSync(candidate)) || candidates[0] || ''
}

function createEasyTierAdapter(options) {
  const relay = new URL(options.relay || DEFAULT_RELAY)
  let bridge = null
  class EasyTierAdapter extends ProcessTransportAdapter {
    async start(context) {
      if (this.process && !this.process.killed) return super.start(context)
      let corePeer = relay.toString()
      const rules = typeof options.resolveProxy === 'function'
        ? await options.resolveProxy(`https://${relay.hostname}/`).catch(() => 'DIRECT')
        : 'DIRECT'
      const proxy = selectHttpProxy(rules)
      if (proxy) {
        bridge = await createConnectBridge({ proxy, targetHost: relay.hostname, targetPort: Number(relay.port) })
        corePeer = `tcp://${bridge.host}:${bridge.port}`
      }
      try {
        return await super.start({ ...context, corePeer, pairingPeer: relay.toString() })
      } catch (error) {
        await bridge?.close().catch(() => {})
        bridge = null
        throw error
      }
    }

    async stop() {
      await super.stop()
      await bridge?.close().catch(() => {})
      bridge = null
    }
  }

  return new EasyTierAdapter({
    id: 'easytier',
    binary: resolveEasyTierBinary(options),
    prepareBinary: options.ensureBinary || null,
    buildArguments: context => {
      const { mesh } = context
      return [
        '--hostname', 'Harness-Desktop',
        '--network-name', mesh.networkName,
        '--network-secret', mesh.networkSecret,
        '--ipv4', mesh.desktopAddress,
        '--no-tun',
        '--use-smoltcp',
        // Follow the operating system's active route (including an existing
        // user VPN) instead of binding to a guessed physical adapter.
        '--bind-device', 'false',
        '--disable-ipv6',
        // EasyTier uses <real-cidr>-><mapped-cidr>. Export the loopback-only
        // workbench through a dedicated virtual service address.
        '--proxy-networks', `127.0.0.1/32->${mesh.serviceAddress}/32`,
        '--peers', context.corePeer,
        '--latency-first',
        '--console-log-level', 'warn',
        '--file-log-level', 'off'
      ]
    },
    buildPairingConfig: context => {
      const { mesh, port } = context
      return {
        id: 'easytier',
        origin: `http://${mesh.serviceAddress}:${port}`,
        networkName: mesh.networkName,
        networkSecret: mesh.networkSecret,
        desktopAddress: mesh.desktopAddress,
        serviceAddress: mesh.serviceAddress,
        peer: context.pairingPeer,
        secureMode: false
      }
    },
    readyPattern: /reconn result:\s*Some\(Ok\(/,
    readyTimeout: 18000
  })
}

module.exports = { createEasyTierAdapter, resolveEasyTierBinary, DEFAULT_RELAY }
