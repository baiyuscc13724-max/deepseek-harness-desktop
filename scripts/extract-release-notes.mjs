import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const version = String(process.argv[2] || '').trim().replace(/^v/i, '')
const output = path.resolve(process.argv[3] || path.join(root, 'release-notes.md'))
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) throw new Error(`Invalid release version: ${version}`)

const changelog = await readFile(path.join(root, 'CHANGELOG.md'), 'utf8')
const heading = `## ${version}`
const start = changelog.indexOf(heading)
if (start < 0) throw new Error(`CHANGELOG.md does not contain ${heading}`)
const bodyStart = start + heading.length
const nextHeading = changelog.indexOf('\n## ', bodyStart)
const notes = changelog.slice(bodyStart, nextHeading < 0 ? undefined : nextHeading).trim()
if (!notes) throw new Error(`Release notes are empty for ${version}`)

await writeFile(output, `# Harness Desktop ${version}\n\n${notes}\n`, 'utf8')
console.log(`Wrote release notes for ${version} to ${output}`)
