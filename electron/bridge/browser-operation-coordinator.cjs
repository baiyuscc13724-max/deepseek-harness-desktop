function coordinatorError(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

class BrowserOperationCoordinator {
  constructor() {
    this.generation = 0
    this.resetting = false
  }

  ticket() {
    if (this.resetting) throw coordinatorError('profile-resetting', '独立浏览器 Profile 正在重置，请稍后重试。')
    return this.generation
  }

  assert(ticket) {
    if (this.resetting || ticket !== this.generation) {
      throw coordinatorError('profile-resetting', '浏览器操作已被 Profile 重置取消。')
    }
    return true
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
    return { resetting: this.resetting, generation: this.generation }
  }
}

module.exports = { BrowserOperationCoordinator }
