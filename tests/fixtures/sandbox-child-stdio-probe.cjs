const childProcess = require('node:child_process')

const cases = [
  'ignore',
  'inherit',
  ['ignore', 'pipe', 'inherit'],
  ['ignore', 'inherit', 'pipe'],
  ['pipe', 'inherit', 'inherit']
]

for (const stdio of cases) {
  try {
    const result = childProcess.spawnSync('cmd', ['/c', 'echo', 'ok'], { stdio })
    console.log(JSON.stringify({ stdio, status: result.status, error: result.error?.code ?? null }))
  } catch (error) {
    console.log(JSON.stringify({ stdio, threw: error.code ?? null, message: error.message }))
  }
}
