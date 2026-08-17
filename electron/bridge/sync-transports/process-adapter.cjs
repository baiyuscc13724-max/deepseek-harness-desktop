const { EventEmitter } = require('node:events')
const { spawn } = require('node:child_process')
const { existsSync } = require('node:fs')

function delay(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds))
}

class ProcessTransportAdapter extends EventEmitter {
  constructor({ id, binary, buildArguments, buildPairingConfig, prepareBinary = null, readyDelay = 1400, readyPattern = null, readyTimeout = 15000 }) {
    super()
    this.id = id
    this.binary = binary
    this.buildArguments = buildArguments
    this.buildPairingConfig = buildPairingConfig
    this.prepareBinary = prepareBinary
    this.readyDelay = readyDelay
    this.readyPattern = readyPattern
    this.readyTimeout = readyTimeout
    this.process = null
    this.lastContext = null
    this.detail = '组件尚未准备'
    this.lastError = null
  }

  async prepare() {
    if (typeof this.prepareBinary !== 'function') return this.available() ? this.binary : null
    this.detail = '正在准备网络组件…'
    this.lastError = null
    this.emit('state', this.state())
    try {
      this.binary = await this.prepareBinary(progress => {
        const received = Number(progress?.received || 0)
        const total = Number(progress?.total || 0)
        const percent = total > 0 ? Math.min(100, Math.round(received / total * 100)) : null
        this.detail = percent === null ? '正在下载网络组件…' : `正在下载网络组件… ${percent}%`
        this.emit('state', this.state())
      })
      if (!this.available()) throw new Error('网络组件准备完成后仍无法读取。')
      this.detail = '网络组件已就绪'
      this.emit('state', this.state())
      return this.binary
    } catch (error) {
      this.lastError = error.message
      this.detail = '网络组件准备失败'
      this.emit('state', this.state())
      throw error
    }
  }

  available() {
    return Boolean(this.binary && existsSync(this.binary))
  }

  state() {
    return {
      id: this.id,
      available: this.available(),
      status: this.process && !this.process.killed ? 'connected' : this.available() ? 'ready' : 'unavailable',
      detail: this.detail,
      error: this.lastError
    }
  }

  async start(context) {
    if (this.process && !this.process.killed) return this.state()
    if (this.prepareBinary || !this.available()) await this.prepare()
    if (!this.available()) throw new Error('网络核心尚未准备')
    this.lastContext = context
    this.lastError = null
    this.detail = '正在建立安全通道…'
    const child = spawn(this.binary, this.buildArguments(context), {
      cwd: context.stateDir,
      env: { ...process.env, NO_COLOR: '1' },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    this.process = child
    let stderr = ''
    let readyResolve = null
    let readyReject = null
    const ready = this.readyPattern
      ? new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject })
      : delay(this.readyDelay)
    const capture = chunk => {
      stderr = `${stderr}${chunk}`.slice(-12000)
      if (this.readyPattern?.test(stderr)) readyResolve?.()
    }
    child.stdout?.on('data', capture)
    child.stderr?.on('data', capture)
    child.once('exit', (code, signal) => {
      const expected = this.process !== child || child.killed
      if (this.process === child) this.process = null
      if (expected) return
      this.lastError = stderr.trim() || `进程退出（${code ?? signal ?? 'unknown'}）`
      this.detail = '连接已断开'
      readyReject?.(new Error(this.lastError))
      this.emit('disconnect', new Error(this.lastError))
    })
    child.once('error', error => {
      this.lastError = error.message
      this.detail = '组件启动失败'
      readyReject?.(error)
    })
    try {
      await (this.readyPattern
        ? Promise.race([
            ready,
            delay(this.readyTimeout).then(() => { throw new Error('远程中继连接超时') })
          ])
        : ready)
    } catch (error) {
      child.kill()
      throw new Error(this.lastError || error.message)
    }
    if (!this.process || this.process.exitCode !== null) {
      throw new Error(this.lastError || stderr.trim() || '网络核心启动后立即退出')
    }
    this.detail = '安全通道已连接'
    this.emit('state', this.state())
    return this.state()
  }

  pairingConfig() {
    if (!this.lastContext || !this.process || this.process.killed) return null
    return this.buildPairingConfig?.(this.lastContext) || null
  }

  async stop() {
    const child = this.process
    this.process = null
    this.lastContext = null
    if (!child || child.killed) return
    child.kill()
    await Promise.race([
      new Promise(resolve => child.once('exit', resolve)),
      delay(1200).then(() => { if (child.exitCode === null) child.kill('SIGKILL') })
    ])
    this.detail = this.available() ? '待命' : '组件尚未准备'
    this.emit('state', this.state())
  }
}

module.exports = { ProcessTransportAdapter }
