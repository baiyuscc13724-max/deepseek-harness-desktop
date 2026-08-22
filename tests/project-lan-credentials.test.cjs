const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { X509Certificate } = require('node:crypto')
const { pathToFileURL } = require('node:url')

const credentialsUrl = pathToFileURL(path.resolve(__dirname, '..', 'plugins', 'dsh-agent-teams', 'lib', 'project-lan-credentials.js')).href

test('LAN server certificates rotate for a new private address while the project CA and client trust stay stable', async () => {
  const { createProjectLanAuthorityCredentials, createProjectLanClientCredentials, refreshProjectLanServerCredentials } = await import(`${credentialsUrl}?test=${Date.now()}-${Math.random()}`)
  const now = Date.now()
  const initial = await createProjectLanAuthorityCredentials({ projectRef: 'project_rotation_test', hosts: ['127.0.0.1'], now })
  const rotated = await refreshProjectLanServerCredentials(initial, { hosts: ['127.0.0.1', '10.24.8.7'], now: now + 1000 })

  assert.equal(rotated.caCert, initial.caCert)
  assert.equal(rotated.caPrivateKey, initial.caPrivateKey)
  assert.notEqual(rotated.serverCert, initial.serverCert)
  assert.deepEqual(rotated.hosts, ['127.0.0.1', '10.24.8.7'])
  assert.match(new X509Certificate(rotated.serverCert).subjectAltName, /IP Address:10\.24\.8\.7/u)

  const client = await createProjectLanClientCredentials(rotated, { deviceRef: 'device_rotation_test', now: now + 2000 })
  const ca = new X509Certificate(rotated.caCert)
  assert.equal(new X509Certificate(rotated.serverCert).verify(ca.publicKey), true)
  assert.equal(new X509Certificate(client.cert).verify(ca.publicKey), true)
})
