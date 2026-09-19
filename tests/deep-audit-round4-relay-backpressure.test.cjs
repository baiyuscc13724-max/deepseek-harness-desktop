'use strict'
// Round-4 gap closure: the relay's outbound backpressure boundary (4 MiB per connection / 64 MiB global,
// close code 4429) was previously only READ from source and never exercised. `sendBounded` is exported, so
// it can be driven with fake sockets: no network, no ports, no product instance is touched.
const test = require('node:test')
const assert = require('node:assert/strict')
const WebSocket = require('ws')
const relay = require('../services/wss-relay/server.cjs')

const { sendBounded, MAX_CONNECTION_BUFFERED_BYTES, MAX_GLOBAL_BUFFERED_BYTES } = relay

function fakeSocket(bufferedAmount = 0) {
  const state = { sent: [], closed: [], terminated: 0 }
  return {
    readyState: WebSocket.OPEN,
    bufferedAmount,
    state,
    send(data, options, callback) {
      state.sent.push({ bytes: Buffer.isBuffer(data) ? data.length : Buffer.byteLength(String(data)), binary: Boolean(options && options.binary) })
      if (typeof callback === 'function') callback()
    },
    close(code, reason) { state.closed.push({ code, reason }) },
    terminate() { state.terminated += 1 }
  }
}

test('the published bounds are the documented ones', () => {
  assert.equal(MAX_CONNECTION_BUFFERED_BYTES, 4 * 1024 * 1024)
  assert.equal(MAX_GLOBAL_BUFFERED_BYTES, 64 * 1024 * 1024)
})

test('a payload that fits inside the per-connection bound is queued, not closed', () => {
  const destination = fakeSocket(0)
  const accepted = sendBounded({ clients: [destination], destination, source: destination, data: Buffer.alloc(1024) })
  assert.equal(accepted, true)
  assert.equal(destination.state.sent.length, 1)
  assert.equal(destination.state.sent[0].bytes, 1024)
  assert.deepEqual(destination.state.closed, [])
})

test('the per-connection bound is inclusive: buffered + bytes exactly at the limit is still accepted', () => {
  const destination = fakeSocket(MAX_CONNECTION_BUFFERED_BYTES - 1024)
  const accepted = sendBounded({ clients: [destination], destination, source: destination, data: Buffer.alloc(1024) })
  assert.equal(accepted, true)
  assert.equal(destination.state.sent.length, 1)
  assert.deepEqual(destination.state.closed, [])
})

test('one byte past the per-connection bound closes with 4429 and never queues the payload', () => {
  const source = fakeSocket(0)
  const destination = fakeSocket(MAX_CONNECTION_BUFFERED_BYTES - 1023)
  const accepted = sendBounded({ clients: [destination], destination, source, data: Buffer.alloc(1024) })
  assert.equal(accepted, false)
  assert.equal(destination.state.sent.length, 0, 'an over-bound payload must not be queued')
  assert.equal(destination.state.closed.length, 1)
  assert.equal(destination.state.closed[0].code, 4429)
  assert.match(String(destination.state.closed[0].reason), /backpressure/)
  assert.equal(source.state.closed.length, 1, 'the source is closed too by default when it is a different socket')
  assert.equal(source.state.closed[0].code, 4429)
})

test('closeSourceOnFailure:false leaves the source open', () => {
  const source = fakeSocket(0)
  const destination = fakeSocket(MAX_CONNECTION_BUFFERED_BYTES)
  const accepted = sendBounded({ clients: [destination], destination, source, data: Buffer.alloc(1), closeSourceOnFailure: false })
  assert.equal(accepted, false)
  assert.equal(destination.state.closed.length, 1)
  assert.equal(source.state.closed.length, 0)
})

test('the global bound closes the destination even when this connection is small', () => {
  const other = fakeSocket(MAX_GLOBAL_BUFFERED_BYTES - 10)
  const destination = fakeSocket(0)
  const accepted = sendBounded({ clients: [other, destination], destination, source: destination, data: Buffer.alloc(64) })
  assert.equal(accepted, false)
  assert.equal(destination.state.sent.length, 0)
  assert.equal(destination.state.closed.length, 1)
  assert.equal(destination.state.closed[0].code, 4429)
})

test('a destination that is not open is never queued and never closed', () => {
  const destination = fakeSocket(0)
  destination.readyState = WebSocket.CLOSED
  const accepted = sendBounded({ clients: [destination], destination, source: destination, data: Buffer.alloc(64) })
  assert.equal(accepted, false)
  assert.equal(destination.state.sent.length, 0)
  assert.equal(destination.state.closed.length, 0)
})

test('a negative or non-numeric bufferedAmount is treated as zero, not as an overflow', () => {
  for (const value of [-1, Number.NaN, undefined, null]) {
    const destination = fakeSocket(value)
    const accepted = sendBounded({ clients: [destination], destination, source: destination, data: Buffer.alloc(1024) })
    assert.equal(accepted, true, `bufferedAmount ${String(value)} must not trigger a close`)
    assert.equal(destination.state.sent.length, 1)
  }
})
