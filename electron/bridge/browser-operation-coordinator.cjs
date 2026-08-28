const DEFAULT_BROWSER_OPERATION_TIMEOUT_MS = 8_000

function coordinatorError(code, message, statusCode = 0) {
  const error = new Error(message)
  error.code = code
  if (statusCode > 0) error.statusCode = statusCode
  return error
}

function runBrowserOperation(execute, {
  signal = null,
  timeoutMs = DEFAULT_BROWSER_OPERATION_TIMEOUT_MS,
  timeoutCode = 'browser-operation-timeout',
  timeoutMessage = '浏览器操作等待底层响应超时。'
} = {}) {
  if (typeof execute !== 'function') throw new TypeError('runBrowserOperation requires an execute function')
  if (signal?.aborted) return Promise.reject(coordinatorError('browser-action-cancelled', '浏览器模型操作已取消。', 499))
  const boundedTimeout = Math.max(1, Math.min(60_000, Math.floor(Number(timeoutMs) || DEFAULT_BROWSER_OPERATION_TIMEOUT_MS)))
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (callback, value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener?.('abort', onAbort)
      callback(value)
    }
    const onAbort = () => finish(reject, coordinatorError('browser-action-cancelled', '浏览器模型操作已取消。', 499))
    const timer = setTimeout(
      () => finish(reject, coordinatorError(timeoutCode, timeoutMessage, 504)),
      boundedTimeout
    )
    signal?.addEventListener?.('abort', onAbort, { once: true })
    Promise.resolve()
      .then(execute)
      .then(value => finish(resolve, value), error => finish(reject, error))
  })
}

class BrowserOperationCoordinator {
  constructor() {
    this.generation = 0
    this.modelGeneration = 0
    this.resetting = false
  }

  ticket() {
    if (this.resetting) throw coordinatorError('profile-resetting', '独立浏览器 Profile 正在重置，请稍后重试。')
    return this.generation
  }

  modelTicket(signal = null) {
    if (this.resetting) throw coordinatorError('profile-resetting', '独立浏览器 Profile 正在重置，请稍后重试。')
    if (signal?.aborted) throw coordinatorError('browser-action-cancelled', '浏览器模型操作已取消。')
    return {
      profileGeneration: this.generation,
      modelGeneration: this.modelGeneration,
      signal
    }
  }

  assert(ticket) {
    const modelTicket = ticket && typeof ticket === 'object'
      && Number.isInteger(ticket.profileGeneration)
      && Number.isInteger(ticket.modelGeneration)
    const profileGeneration = modelTicket ? ticket.profileGeneration : ticket
    if (this.resetting || profileGeneration !== this.generation) {
      throw coordinatorError('profile-resetting', '浏览器操作已被 Profile 重置取消。')
    }
    if (modelTicket && (ticket.modelGeneration !== this.modelGeneration || ticket.signal?.aborted)) {
      throw coordinatorError('browser-action-cancelled', '浏览器模型操作已取消。')
    }
    return true
  }

  cancelModelActions() {
    this.modelGeneration += 1
    return this.modelGeneration
  }

  beginReset() {
    if (this.resetting) throw coordinatorError('profile-resetting', '独立浏览器 Profile 正在重置，请勿重复操作。')
    this.resetting = true
    this.generation += 1
    return this.generation
  }

  finishReset(resetGeneration) {
    if (!this.resetting || resetGeneration !== this.generation) {
      throw coordinatorError('reset-generation-mismatch', '浏览器 Profile 重置状态不一致。')
    }
    this.resetting = false
    this.generation += 1
    return this.generation
  }

  snapshot() {
    return { resetting: this.resetting, generation: this.generation, modelGeneration: this.modelGeneration }
  }
}

module.exports = { BrowserOperationCoordinator, DEFAULT_BROWSER_OPERATION_TIMEOUT_MS, runBrowserOperation }
