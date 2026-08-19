import { createCipheriv, createHash, generateKeyPairSync, randomBytes } from 'node:crypto'
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

function argument(name) {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 ? process.argv[index + 1] : ''
}

async function absent(file) {
  try {
    await readFile(file)
    throw new Error(`Refusing to overwrite existing signing material: ${file}`)
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
}

const privateDir = path.resolve(argument('private-dir') || '')
const backupDir = path.resolve(argument('backup-dir') || '')
const recoveryDir = path.resolve(argument('recovery-dir') || '')
if (!argument('private-dir') || !argument('backup-dir') || !argument('recovery-dir')) {
  throw new Error('Usage: node scripts/create-component-signing-key.mjs --private-dir <dir> --backup-dir <dir> --recovery-dir <dir>')
}
if (new Set([privateDir, backupDir, recoveryDir]).size !== 3) {
  throw new Error('Private key, encrypted backup, and recovery key directories must be separate.')
}

const privateFile = path.join(privateDir, 'component-production-ed25519-private.pem')
const publicFile = path.join(privateDir, 'component-production-ed25519-public.pem')
const metadataFile = path.join(privateDir, 'component-production-key.json')
const backupFile = path.join(backupDir, 'component-production-ed25519-private.encrypted.json')
const recoveryFile = path.join(recoveryDir, 'component-production-recovery-key.txt')
for (const file of [privateFile, publicFile, metadataFile, backupFile, recoveryFile]) await absent(file)
for (const directory of [privateDir, backupDir, recoveryDir]) await mkdir(directory, { recursive: true, mode: 0o700 })

const { privateKey, publicKey } = generateKeyPairSync('ed25519')
const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' })
const publicPem = publicKey.export({ type: 'spki', format: 'pem' })
const publicDer = publicKey.export({ type: 'spki', format: 'der' })
const fingerprint = createHash('sha256').update(publicDer).digest('hex')
const keyId = `harness-components-${fingerprint.slice(0, 16)}`
const recoveryKey = randomBytes(32)
const iv = randomBytes(12)
const cipher = createCipheriv('aes-256-gcm', recoveryKey, iv)
const ciphertext = Buffer.concat([cipher.update(Buffer.from(privatePem, 'utf8')), cipher.final()])
const authTag = cipher.getAuthTag()
const createdAt = new Date().toISOString()

await writeFile(privateFile, privatePem, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
await writeFile(publicFile, publicPem, { encoding: 'utf8', mode: 0o644, flag: 'wx' })
await writeFile(metadataFile, `${JSON.stringify({ schemaVersion: 1, keyId, algorithm: 'Ed25519', fingerprintSha256: fingerprint, createdAt }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
await writeFile(backupFile, `${JSON.stringify({ schemaVersion: 1, keyId, algorithm: 'Ed25519+A256GCM', createdAt, iv: iv.toString('base64'), authTag: authTag.toString('base64'), ciphertext: ciphertext.toString('base64') }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
await writeFile(recoveryFile, `${recoveryKey.toString('base64url')}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
for (const file of [privateFile, metadataFile, backupFile, recoveryFile]) await chmod(file, 0o600).catch(() => {})

console.log(JSON.stringify({ ok: true, keyId, fingerprintSha256: fingerprint, privateFile, publicFile, metadataFile, encryptedBackupFile: backupFile, recoveryKeyFile: recoveryFile }, null, 2))
