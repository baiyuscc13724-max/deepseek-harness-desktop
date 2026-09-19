'use strict'

const { createHash } = require('node:crypto')
const { gunzipSync } = require('node:zlib')

function fingerprint(value) {
  return createHash('sha256').update(String(value)).digest('hex')
}

function syntheticOauth({ account = 'synthetic-account', expires = Date.now() + 60_000 } = {}) {
  const payload = Buffer.from(JSON.stringify({
    exp: Math.floor(expires / 1000),
    'https://api.openai.com/auth': { chatgpt_account_id: account }
  })).toString('base64url')
  return {
    credential: {
      kind: 'grant',
      payload: { type: 'oauth', access: `synthetic.${payload}.signature`, refresh: 'synthetic-refresh', expires }
    },
    accessFingerprint: fingerprint(`Bearer synthetic.${payload}.signature`)
  }
}

function successfulChatCompletion(model = 'synthetic-model') {
  const first = { id: 'synthetic', object: 'chat.completion.chunk', created: 1, model, choices: [{ index: 0, delta: { role: 'assistant', content: 'ok' }, finish_reason: null }] }
  const last = { id: 'synthetic', object: 'chat.completion.chunk', created: 1, model, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }
  return new Response(`data: ${JSON.stringify(first)}\n\ndata: ${JSON.stringify(last)}\n\ndata: [DONE]\n\n`, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' }
  })
}

async function createProductionAdapterHarness(config, { refs = new Map(), records = new Map(), moduleUrl, responseStatus = 401, responseErrorMessage = 'synthetic transport refusal', transportThrowMessage } = {}) {
  const { apply } = await import(moduleUrl || '../../node_modules/@deepseek-ai/dsh-llm-pi-ai/lib/index.js')
  const requests = []
  const logs = []
  let adapter
  let section
  let discovery
  let directory = []
  const resolvedRefs = []
  const credentials = {
    async resolve(ref) {
      resolvedRefs.push(String(ref))
      const value = refs.get(String(ref))
      return value === undefined ? undefined : { value, source: 'synthetic' }
    },
    async readRecord(key) { return records.get(String(key)) },
    async listRecords() {
      return [...records].map(([key, record]) => ({ key, kind: record.kind }))
    },
    async modifyRecord(key, mutate) {
      const normalized = String(key)
      const next = await mutate(records.get(normalized))
      if (next !== undefined) records.set(normalized, next)
      return records.get(normalized)
    },
    async deleteRecord(key) { records.delete(String(key)) }
  }
  const ctx = {
    get(name) { return name === 'credentials' ? credentials : undefined },
    llm: {
      registerConfigurableProviders(entries) { directory = entries; return { replace(next) { directory = next } } },
      registerModelDiscovery(_namespace, callback) { discovery = callback }, 
      registerAdapter(_routes, value) { adapter = value; return { replace() {} } }
    },
    inject(dependencies, callback) {
      if (dependencies.includes('settings')) callback({ settings: { installSection(_ctx, _ns, _schema, _config, options) { section = options } } })
    },
    logger: {
      warn(value) { logs.push({ level: 'warn', text: String(value?.message || value) }) },
      error(value) { logs.push({ level: 'error', text: String(value?.message || value) }) }
    },
    on() {}
  }
  apply(ctx, config)

  async function withTransport(operation) {
    const previous = globalThis.fetch
    globalThis.fetch = async (url, options = {}) => {
      if (transportThrowMessage !== undefined) throw new Error(transportThrowMessage)
      const headers = new Headers(options.headers)
      const encodedBody = options.body
      const bodyText = typeof encodedBody === 'string'
        ? encodedBody
        : encodedBody instanceof Uint8Array && headers.get('content-encoding') === 'gzip'
          ? gunzipSync(encodedBody).toString('utf8')
          : ''
      const body = bodyText.length > 0 ? JSON.parse(bodyText) : {}
      requests.push({
        url: String(url),
        method: String(options.method || 'GET'),
        authFingerprint: headers.has('authorization') ? fingerprint(headers.get('authorization')) : undefined,
        headerFingerprints: Object.fromEntries([...headers].map(([name, value]) => [name, fingerprint(value)])),
        redirect: options.redirect,
        hasAccountId: headers.has('chatgpt-account-id'),
        accountIdLength: headers.get('chatgpt-account-id')?.length || 0,
        model: body.model || body.model_slug
      })
      if (String(url).endsWith('/models')) return new Response(JSON.stringify({ data: [{ id: 'synthetic-discovered-model' }] }), { status: 200, headers: { 'content-type': 'application/json' } })
      if (String(url).includes('/chat/completions')) return successfulChatCompletion(body.model)
      return new Response(JSON.stringify({ error: { message: responseErrorMessage } }), { status: responseStatus, headers: { 'content-type': 'application/json' } })
    }
    try {
      return await operation()
    } finally {
      globalThis.fetch = previous
    }
  }

  async function stream(options) {
    const chunks = []
    await withTransport(async () => {
      for await (const chunk of adapter.stream(options)) chunks.push(chunk)
    })
    return chunks
  }

  async function preparedStream(prepared, options) {
    const chunks = []
    await withTransport(async () => {
      for await (const chunk of prepared.stream(options)) chunks.push(chunk)
    })
    return chunks
  }

  return {
    adapter,
    credentials,
    refs,
    records,
    requests,
    logs,
    section: () => section,
    directory: () => directory,
    resolvedRefs,
    discover: (request) => withTransport(() => discovery(request)),
    parallelPreparedStreams: (calls) => withTransport(() => Promise.all(calls.map(async ({ prepared, options }) => {
      const chunks = []
      for await (const chunk of prepared.stream(options)) chunks.push(chunk)
      return chunks
    }))),
    stream,
    preparedStream
  }
}

function textRequest(provider, model) {
  return { provider, model, messages: [{ role: 'user', content: [{ type: 'text', text: 'synthetic request' }] }] }
}

function finishFailure(chunks) {
  const finish = chunks.findLast((chunk) => chunk.type === 'finish')
  return finish?.reason?.kind === 'error' ? finish.reason.failure : undefined
}

module.exports = { createProductionAdapterHarness, fingerprint, finishFailure, syntheticOauth, textRequest }
