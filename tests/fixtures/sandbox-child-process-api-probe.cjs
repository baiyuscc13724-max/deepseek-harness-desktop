const childProcess = require('node:child_process')

function report(api, error) {
  console.log(JSON.stringify({
    api,
    ok: error == null,
    error: error?.code ?? null,
    ...(error == null ? {} : { message: error.message })
  }))
}

function sync(api, call) {
  try {
    call()
    report(api)
  } catch (error) {
    report(api, error)
  }
}

function spawnAsync() {
  return new Promise(resolve => {
    try {
      const child = childProcess.spawn('cmd', ['/c', 'echo', 'ok'])
      child.once('error', error => { report('spawn', error); resolve() })
      child.once('close', code => {
        if (code === 0) { report('spawn'); resolve() }
      })
    } catch (error) {
      report('spawn', error)
      resolve()
    }
  })
}

function callbackAsync(api, start) {
  return new Promise(resolve => {
    try {
      start(error => {
        report(api, error)
        resolve()
      })
    } catch (error) {
      report(api, error)
      resolve()
    }
  })
}

sync('spawnSync', () => {
  const result = childProcess.spawnSync('cmd', ['/c', 'echo', 'ok'])
  if (result.error) throw result.error
})
sync('execFileSync', () => childProcess.execFileSync('cmd', ['/c', 'echo', 'ok']))
sync('execSync', () => childProcess.execSync('echo ok'))

;(async () => {
  await spawnAsync()
  await callbackAsync('execFile', done => childProcess.execFile('cmd', ['/c', 'echo', 'ok'], done))
  await callbackAsync('exec', done => childProcess.exec('echo ok', done))
})()
