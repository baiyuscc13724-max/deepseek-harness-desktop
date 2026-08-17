const { readFileSync, writeFileSync } = require('node:fs')
const path = require('node:path')

function argument(name, fallback = null) {
  const index = process.argv.indexOf(name)
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback
}

function main() {
  const readyFile = path.resolve(argument('--ready-file'))
  const profileFile = path.resolve(argument('--profile-file'))
  const servicePort = Number(argument('--service-port'))
  const urlFile = path.resolve(argument('--url-file'))
  const ready = JSON.parse(readFileSync(readyFile, 'utf8'))
  const profile = JSON.parse(readFileSync(profileFile, 'utf8'))
  const source = new URL(ready.appUrl)
  const payload = JSON.parse(Buffer.from(source.searchParams.get('payload'), 'base64url').toString('utf8'))
  payload.transports = [{
    id: 'easytier',
    origin: `http://${profile.mesh.serviceAddress}:${servicePort}`,
    networkName: profile.mesh.networkName,
    networkSecret: profile.mesh.networkSecret,
    desktopAddress: profile.mesh.desktopAddress,
    serviceAddress: profile.mesh.serviceAddress,
    peer: 'tcp://us01.225284.xyz:11010',
    secureMode: false
  }]
  const appUrl = `harnessmobile://pair?payload=${encodeURIComponent(Buffer.from(JSON.stringify(payload)).toString('base64url'))}`
  writeFileSync(urlFile, appUrl, { encoding: 'utf8', mode: 0o600 })
  process.stdout.write('ANDROID_REMOTE_PAIRING_PROFILE_READY\n')
}

try { main() }
catch (error) {
  console.error(error.message)
  process.exitCode = 1
}
