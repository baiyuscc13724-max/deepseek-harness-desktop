import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const main = await readFile(path.join(root, 'electron/main.cjs'), 'utf8')
const workflow = await readFile(path.join(root, '.github/workflows/release.yml'), 'utf8')
const service = await readFile(path.join(root, 'electron/bridge/self-test-service.cjs'), 'utf8')

for (const contract of ['--self-test', 'runPackagedSelfTest', 'HARNESS_DESKTOP_SELFTEST']) {
  if (!main.includes(contract)) throw new Error(`Packaged self-test main-process contract missing: ${contract}`)
}
for (const contract of ['rendererEntry', 'bundledHarness', 'runtimeWebBoot', 'runtimeWebBootable', "'web', '--port', '0'", 'nodeRuntime', 'userData', 'webCompatibility']) {
  if (!service.includes(contract)) throw new Error(`Packaged self-test service contract missing: ${contract}`)
}
if (!workflow.includes('Run packaged Windows self-test')) throw new Error('Release workflow must execute the unpacked Windows app self-test before artifact upload.')
if (!workflow.includes('--self-test')) throw new Error('Release workflow does not invoke --self-test.')
console.log('Packaged self-test contract passed.')
