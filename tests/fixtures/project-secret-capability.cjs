const { createCipheriv, createDecipheriv, randomBytes } = require('node:crypto')

const PURPOSES = new Set([
  'agent-teams/device/v1',
  'agent-teams/pending-join/v1',
  'agent-teams/lan-authority/v1'
])
const PROJECT_BINDING = /^project_[A-Za-z0-9_-]{20,64}$/u

function aadFor(purpose, binding) {
  if (!PURPOSES.has(purpose)) throw new Error(`unexpected project secret purpose: ${purpose}`)
  if (!PROJECT_BINDING.test(binding)) throw new Error('unexpected project secret binding')
  return Buffer.from(`${purpose}\0${binding}`, 'utf8')
}

function createProjectSecretCapability() {
  const key = randomBytes(32)
  return Object.freeze({
    available: true,
    async protect(plaintext, { purpose, binding } = {}) {
      if (!Buffer.isBuffer(plaintext)) throw new TypeError('project secret plaintext must be a Buffer')
      const nonce = randomBytes(12)
      const cipher = createCipheriv('aes-256-gcm', key, nonce)
      cipher.setAAD(aadFor(purpose, binding))
      const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
      return Buffer.concat([nonce, cipher.getAuthTag(), ciphertext]).toString('base64')
    },
    async unprotect(sealed, { purpose, binding } = {}) {
      if (typeof sealed !== 'string' || sealed.length === 0) throw new TypeError('sealed project secret must be a non-empty string')
      const payload = Buffer.from(sealed, 'base64')
      if (payload.length < 29) throw new Error('sealed project secret is truncated')
      const decipher = createDecipheriv('aes-256-gcm', key, payload.subarray(0, 12))
      decipher.setAAD(aadFor(purpose, binding))
      decipher.setAuthTag(payload.subarray(12, 28))
      return Buffer.concat([decipher.update(payload.subarray(28)), decipher.final()])
    }
  })
}

module.exports = { createProjectSecretCapability }
