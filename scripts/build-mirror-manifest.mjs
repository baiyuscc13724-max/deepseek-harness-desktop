import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function argument(name) {
  const prefix = `--${name}=`
  const value = process.argv.find(item => item.startsWith(prefix))
  return value ? value.slice(prefix.length).trim() : ''
}

const baseValue = argument('base') || String(process.env.HARNESS_DESKTOP_MIRROR_BASE_URL || '').trim()
if (!baseValue) throw new Error('请通过 --base=https://.../ 或 HARNESS_DESKTOP_MIRROR_BASE_URL 指定国内下载目录。')
const baseUrl = new URL(baseValue.endsWith('/') ? baseValue : `${baseValue}/`)
if (baseUrl.protocol !== 'https:') throw new Error('国内镜像下载目录必须使用 HTTPS。')

const input = path.resolve(root, argument('input') || 'release-manifest.json')
const output = path.resolve(root, argument('output') || 'dist/release-manifest.mirror.json')
const releases = JSON.parse(await readFile(input, 'utf8'))
const list = Array.isArray(releases) ? releases : [releases]

for (const release of list) {
  if (!Array.isArray(release?.assets)) continue
  for (const asset of release.assets) {
    const name = String(asset?.name || '').trim()
    if (!name) continue
    const mirror = new URL(encodeURIComponent(name), baseUrl).toString()
    asset.mirror_urls = [...new Set([mirror, ...(Array.isArray(asset.mirror_urls) ? asset.mirror_urls : [])])]
  }
}

await mkdir(path.dirname(output), { recursive: true })
await writeFile(output, `${JSON.stringify(Array.isArray(releases) ? list : list[0], null, 2)}\n`, 'utf8')
console.log(`Mirror manifest written: ${output}`)
