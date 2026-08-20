import { createHash, createPrivateKey, createPublicKey } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
function argument(name) {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 ? String(process.argv[index + 1] || '').trim() : ''
}

const keyFile = argument('key-file')
const keyId = argument('key-id')
if (!keyFile || !keyId) throw new Error('--key-file and --key-id are required.')
const sources = JSON.parse(await readFile(path.join(root, 'component-update-sources.json'), 'utf8'))
const trustedPem = String(sources.trustedKeys?.[keyId] || '').trim()
if (!sources.enabled || !trustedPem) throw new Error(`Production trust root does not contain ${keyId}.`)
const privateKey = createPrivateKey(await readFile(path.resolve(keyFile), 'utf8'))
if (privateKey.type !== 'private' || privateKey.asymmetricKeyType !== 'ed25519') throw new Error('Signing key must be an Ed25519 private key.')
const publicPem = createPublicKey(privateKey).export({ type: 'spki', format: 'pem' }).trim()
if (publicPem !== trustedPem) throw new Error('Signing private key does not match the embedded production trust root.')
const fingerprint = createHash('sha256').update(createPublicKey(privateKey).export({ type: 'spki', format: 'der' })).digest('hex')
console.log(JSON.stringify({ ok: true, keyId, fingerprint }, null, 2))
