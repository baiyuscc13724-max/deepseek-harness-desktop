import { readFile } from 'node:fs/promises'

const repo = 'deepseek-ai/deepseek-harness'
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
const pinned = pkg.dependencies?.['@deepseek-ai/dsh'] || null

async function json(url, headers = {}) {
  const response = await fetch(url, { headers: { 'User-Agent': 'harness-desktop-upstream-check', ...headers } })
  if (!response.ok) throw new Error(`${url} -> HTTP ${response.status}`)
  return response.json()
}

const [commit, npmMeta] = await Promise.all([
  json(`https://api.github.com/repos/${repo}/commits/master`, { Accept: 'application/vnd.github+json' }),
  json('https://registry.npmjs.org/@deepseek-ai%2Fdsh/latest')
])

const latestNpm = npmMeta.version || null
const updateAvailable = Boolean(pinned && latestNpm && pinned !== latestNpm)

const report = {
  repository: repo,
  branch: 'master',
  upstreamCommit: {
    sha: commit.sha,
    date: commit.commit?.committer?.date,
    message: commit.commit?.message?.split('\n')[0]
  },
  runtimePackage: {
    package: '@deepseek-ai/dsh',
    pinned,
    latest: latestNpm,
    updateAvailable
  }
}

console.log(JSON.stringify(report, null, 2))

if (process.env.GITHUB_OUTPUT) {
  const { appendFile } = await import('node:fs/promises')
  await appendFile(process.env.GITHUB_OUTPUT, `pinned=${pinned || ''}\nlatest=${latestNpm || ''}\nupdate_available=${updateAvailable}\n`)
}
