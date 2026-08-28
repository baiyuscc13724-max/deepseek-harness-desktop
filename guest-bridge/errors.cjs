'use strict'

class GuestBridgeError extends Error {
  constructor(code, message, details) {
    super(message)
    this.name = 'GuestBridgeError'
    this.code = code
    if (details !== undefined) this.details = details
  }
}

function fail(code, message, details) {
  throw new GuestBridgeError(code, message, details)
}

module.exports = { GuestBridgeError, fail }
