import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { addMirrorsToManifest } from './mirror-manifest-lib.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function argument(name) {
  const prefix = `--${name}=`
  const value = process.argv.find(item => item.startsWith(prefix))
  return value ? value.slice(prefix.length).trim() : ''
}

const input = path.resolve(root, argument('input') || 'release-manifest.json')
const output = path.resolve(root, argument('output') || 'dist/release-manifest.mirror.json')
const releases = JSON.parse(await readFile(input, 'utf8'))
const configArgument = argument('config') || String(process.env.HARNESS_DESKTOP_MIRROR_CONFIG || '').trim()
const defaultLocalConfig = path.join(root, 'release-mirrors.local.json')
const configPath = configArgument ? path.resolve(root, configArgument) : await access(defaultLocalConfig).then(() => defaultLocalConfig).catch(() => '')
let definitions = configPath ? JSON.parse(await readFile(configPath, 'utf8')) : { mirrors: [] }
if (Array.isArray(definitions)) definitions = { mirrors: definitions }

const environmentMirrors = [
  ['cnb', process.env.HARNESS_DESKTOP_CNB_URL_TEMPLATE, 10]
].filter(([, template]) => String(template || '').trim()).map(([id, urlTemplate, priority]) => ({ id, urlTemplate, priority }))
definitions.mirrors = [...environmentMirrors, ...(Array.isArray(definitions.mirrors) ? definitions.mirrors : [])]

const baseValue = argument('base') || String(process.env.HARNESS_DESKTOP_MIRROR_BASE_URL || '').trim()
if (baseValue) {
  const baseUrl = new URL(baseValue.endsWith('/') ? baseValue : `${baseValue}/`)
  definitions.mirrors.unshift({ id: 'legacy-base', priority: 1, urlTemplate: `${baseUrl.toString()}{fileEncoded}` })
}

const result = addMirrorsToManifest(releases, definitions)

await mkdir(path.dirname(output), { recursive: true })
await writeFile(output, `${JSON.stringify(result, null, 2)}\n`, 'utf8')
console.log(`Mirror manifest written: ${output} (${definitions.mirrors.length} configured source(s))`)
