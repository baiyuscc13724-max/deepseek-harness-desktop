import { appendFile, readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

const repo = 'deepseek-ai/deepseek-harness'

export function selectRuntimeNpmTag(pinned) {
  return typeof pinned === 'string' && /^\d+\.\d+\.\d+-alpha(?:[.-][0-9A-Za-z-]+)*$/u.test(pinned) ? 'alpha' : 'latest'
}

export function selectRuntimeNpmVersion(pinned, npmMetadata) {
  return npmMetadata?.['dist-tags']?.[selectRuntimeNpmTag(pinned)] || null
}

async function json(url, headers = {}) {
  const response = await fetch(url, { headers: { 'User-Agent': 'harness-desktop-upstream-check', ...headers } })
  if (!response.ok) throw new Error(`${url} -> HTTP ${response.status}`)
  return response.json()
}

export async function upstreamStatus() {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  const pinned = pkg.dependencies?.['@deepseek-ai/dsh'] || null
  const [commit, npmMetadata] = await Promise.all([
    json(`https://api.github.com/repos/${repo}/commits/master`, { Accept: 'application/vnd.github+json' }),
    json('https://registry.npmjs.org/@deepseek-ai%2Fdsh')
  ])
  const latestNpm = selectRuntimeNpmVersion(pinned, npmMetadata)
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
    await appendFile(process.env.GITHUB_OUTPUT, `pinned=${pinned || ''}\nlatest=${latestNpm || ''}\nupdate_available=${updateAvailable}\n`)
  }
  return report
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await upstreamStatus()
