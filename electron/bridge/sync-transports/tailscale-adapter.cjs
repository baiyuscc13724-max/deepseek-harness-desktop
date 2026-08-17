const path = require('node:path')
const { ProcessTransportAdapter } = require('./process-adapter.cjs')

function resolveTailscaleBridge({ resourcesPath, componentRoot, developmentRoot }) {
  const name = process.platform === 'win32' ? 'harness-tailscale-bridge.exe' : 'harness-tailscale-bridge'
  const candidates = [
    componentRoot && path.join(componentRoot, 'tailscale', name),
    resourcesPath && path.join(resourcesPath, 'network', 'tailscale', name),
    developmentRoot && path.join(developmentRoot, 'third_party', 'network', 'tailscale', name)
  ].filter(Boolean)
  return candidates.find(candidate => require('node:fs').existsSync(candidate)) || candidates[0] || ''
}

function createTailscaleAdapter(options) {
  return new ProcessTransportAdapter({
    id: 'tailscale',
    binary: resolveTailscaleBridge(options),
    readyDelay: 2200,
    buildArguments: ({ port, stateDir }) => [
      '--state-dir', path.join(stateDir, 'tailscale'),
      '--hostname', 'harness-desktop',
      '--target', `http://127.0.0.1:${port}`
    ],
    buildPairingConfig: context => context.tailscaleOrigin
      ? { id: 'tailscale', origin: context.tailscaleOrigin }
      : null
  })
}

module.exports = { createTailscaleAdapter, resolveTailscaleBridge }
