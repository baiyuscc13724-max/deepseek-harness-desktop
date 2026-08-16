const { existsSync, readFileSync } = require('node:fs')
const path = require('node:path')
const { createRequire } = require('node:module')

const requireFromHere = createRequire(__filename)

function physicalUnpackedPath(resolvedPath) {
  const marker = `${path.sep}app.asar${path.sep}`
  if (!resolvedPath.includes(marker)) return resolvedPath
  const unpacked = resolvedPath.replace(marker, `${path.sep}app.asar.unpacked${path.sep}`)
  return existsSync(unpacked) ? unpacked : resolvedPath
}

function resolvePackageBin(packageName, preferredBin, options = {}) {
  const packageJsonPath = options.nodeModulesRoot
    ? path.join(options.nodeModulesRoot, ...packageName.split('/'), 'package.json')
    : physicalUnpackedPath(requireFromHere.resolve(`${packageName}/package.json`))
  const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf8'))
  let bin = pkg.bin
  if (typeof bin === 'object' && bin) {
    bin = (preferredBin && bin[preferredBin]) || Object.values(bin)[0]
  }
  if (typeof bin !== 'string' || !bin) {
    throw new Error(`${packageName} does not expose a usable CLI bin.`)
  }
  const cli = path.resolve(path.dirname(packageJsonPath), bin)
  if (!existsSync(cli)) throw new Error(`Resolved CLI does not exist: ${cli}`)
  return { cli, pkg, packageJsonPath }
}

function resolveDshBin(options = {}) {
  const explicitCommand = process.env.HARNESS_DESKTOP_DSH_COMMAND
  if (explicitCommand) {
    return {
      command: explicitCommand,
      argsPrefix: parseArgsEnv(process.env.HARNESS_DESKTOP_DSH_ARGS),
      env: {},
      source: 'env',
      version: 'external'
    }
  }

  try {
    const { cli, pkg } = resolvePackageBin('@deepseek-ai/dsh', 'dsh', options)
    return {
      command: process.execPath,
      // The official Web profile enables cordis-plugin-hmr, which needs Node's
      // internal module hooks even when Electron is running as Node.
      argsPrefix: ['--expose-internals', cli],
      env: { ELECTRON_RUN_AS_NODE: '1' },
      source: 'bundled',
      version: pkg.version || 'unknown'
    }
  } catch (error) {
    const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx'
    return {
      command: npx,
      argsPrefix: ['-y', '@deepseek-ai/dsh'],
      env: {},
      source: 'npx-fallback',
      version: 'unresolved',
      error: String(error)
    }
  }
}

function parseArgsEnv(value) {
  if (!value || !String(value).trim()) return []
  const text = String(value).trim()
  try {
    const parsed = JSON.parse(text)
    if (Array.isArray(parsed) && parsed.every(item => typeof item === 'string')) return parsed
  } catch {}
  return text.split(/\s+/).filter(Boolean)
}

module.exports = {
  physicalUnpackedPath,
  resolveDshBin,
  resolvePackageBin,
  parseArgsEnv
}
