import { randomUUID } from 'node:crypto'
import * as basicCompaction from '@deepseek-ai/dsh-compaction-basic'

const BasicCompactionEngine = basicCompaction.BasicCompactionEngine || basicCompaction.default
if (typeof BasicCompactionEngine !== 'function' || typeof BasicCompactionEngine.prototype?.summarize !== 'function') {
  throw new Error('当前官方 DSH 压缩服务与 Harness Desktop 压缩插件不兼容，请更新 Desktop 插件。')
}

const CONTEXT_WINDOW_EXCEEDED_CODE = 'CONTEXT_WINDOW_EXCEEDED'
const SUMMARY_SHRINK_RETRIES = 3
const SUMMARY_SHRINK_RATIO = 0.24
const DESKTOP_COMPACTION_POLICY_VERSION = 1
const CONTEXT_RECOVERY_GUIDANCE = '上下文压缩在多次安全缩减后仍无法完成。请执行 /compact focus on 当前任务；若仍失败，请新建会话并只带检查点摘要。'
const CODEX_OVERLOAD_MAX_RETRIES = 5
const CODEX_OVERLOAD_INITIAL_DELAY_MS = 1_000
const CODEX_OVERLOAD_MAX_DELAY_MS = 16_000
const CODEX_OVERLOAD_POLICY_KEY = JSON.stringify([
  'desktop-codex-overload',
  CODEX_OVERLOAD_MAX_RETRIES,
  CODEX_OVERLOAD_INITIAL_DELAY_MS,
  CODEX_OVERLOAD_MAX_DELAY_MS
])
const CODEX_OVERLOAD_GUIDANCE = 'OpenAI Codex 连续过载，已完成 5 次有界重试；当前会话已保留。请稍后在本会话中重试；若仍失败，请切换其他可用模型或检查 OpenAI 服务状态。'

const DEFAULT_MODEL_POLICIES = Object.freeze([
  Object.freeze({
    provider: 'openai-codex',
    model: 'gpt-5.6-sol',
    thresholdRatio: 0.68,
    retainRatio: 0.1,
    compactionRetries: 2,
    maxOverflowRetries: 3
  })
])

const DEFAULT_ENGINE_CONFIG = Object.freeze({
  thresholdRatio: 0.72,
  retainRatio: 0.12,
  maxTokens: 8192,
  compactionRetries: 2,
  maxOverflowRetries: 3,
  auto: true
})

function modelPolicyKey(policy) {
  return `${String(policy?.provider || '')}\u0000${String(policy?.model || '')}`
}

function mergeModelPolicies(configured = []) {
  const policies = new Map((Array.isArray(configured) ? configured : []).map(policy => [modelPolicyKey(policy), { ...policy }]))
  for (const policy of DEFAULT_MODEL_POLICIES) {
    const key = modelPolicyKey(policy)
    const current = policies.get(key) || {}
    policies.set(key, {
      ...current,
      ...policy,
      thresholdRatio: Math.min(Number(current.thresholdRatio) || policy.thresholdRatio, policy.thresholdRatio),
      retainRatio: Math.min(Number(current.retainRatio) || policy.retainRatio, policy.retainRatio)
    })
  }
  return [...policies.values()]
}

function desktopEngineConfig(config = {}) {
  const source = config && typeof config === 'object' && !Array.isArray(config) ? config : {}
  const result = {
    ...source,
    ...DEFAULT_ENGINE_CONFIG,
    thresholdRatio: Math.min(Number(source.thresholdRatio) || DEFAULT_ENGINE_CONFIG.thresholdRatio, DEFAULT_ENGINE_CONFIG.thresholdRatio),
    retainRatio: Math.min(Number(source.retainRatio) || DEFAULT_ENGINE_CONFIG.retainRatio, DEFAULT_ENGINE_CONFIG.retainRatio),
    modelPolicies: mergeModelPolicies(source.modelPolicies)
  }
  delete result.retainTokens
  return result
}

function isContextOverflowError(error) {
  if (error?.code === CONTEXT_WINDOW_EXCEEDED_CODE) return true
  const message = error instanceof Error ? error.message : String(error || '')
  return /context (?:window|length|overflow)|prompt (?:is )?too long|maximum context|model token limit|input length.+exceeds/iu.test(message)
}

function isCodexOverloadFailure({ provider, failure } = {}) {
  if (provider !== 'openai-codex' || failure?.code !== 'PI_AI_ERROR') return false
  const message = String(failure.message || '')
  if (/(?:\bAUTH\b|\bCreditsError\b)/iu.test(message)) return false
  return /\boverloaded\b|try again later/iu.test(message)
}

function codexOverloadDelay(retry) {
  const exponent = Math.max(0, Math.min(Number(retry) - 1, CODEX_OVERLOAD_MAX_RETRIES - 1))
  return Math.min(CODEX_OVERLOAD_INITIAL_DELAY_MS * 2 ** exponent, CODEX_OVERLOAD_MAX_DELAY_MS)
}

function cancellableDelay(delayMs, signal) {
  if (signal.aborted) return Promise.resolve(false)
  return new Promise(resolve => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve(true)
    }, delayMs)
    function onAbort() {
      clearTimeout(timer)
      resolve(false)
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

async function recoverCodexOverload(payload, next, ctx, internals = {}) {
  const { agent, turn, step, provider, failure, signal } = payload
  if (!isCodexOverloadFailure(payload)) return next()
  if (signal.aborted) return undefined

  const prior = agent.session.events.findLast(event => event.type === 'llm/retry'
    && event.data.turn === turn
    && event.data.step === step
    && event.data.provider === provider
    && event.data.policyKey === CODEX_OVERLOAD_POLICY_KEY)
  const previousRetry = prior?.data.retry ?? 0
  if (previousRetry >= CODEX_OVERLOAD_MAX_RETRIES) {
    ctx.logger.error(CODEX_OVERLOAD_GUIDANCE)
    return next()
  }

  const retry = previousRetry + 1
  const retryId = prior?.data.retryId ?? (internals.createRetryId ?? randomUUID)()
  const delayMs = codexOverloadDelay(retry)
  agent.session.append('llm/retry', {
    retryId,
    turn,
    step,
    provider,
    mode: 'normal',
    policyKey: CODEX_OVERLOAD_POLICY_KEY,
    retry,
    maxRetries: CODEX_OVERLOAD_MAX_RETRIES,
    delayMs,
    failure
  })
  const waited = await (internals.delay ?? cancellableDelay)(delayMs, signal)
  if (!waited || signal.aborted) return undefined
  agent.session.append('llm/retry-started', { retryId, turn, step, retry })
  return { kind: 'retry' }
}

function blockCallIds(message, type, key) {
  const ids = []
  for (const block of Array.isArray(message?.content) ? message.content : []) {
    if (block?.type === type && typeof block[key] === 'string' && block[key]) ids.push(block[key])
  }
  return ids
}

function toolPairsBalanced(messages) {
  const calls = new Set()
  const results = new Set()
  for (const message of messages) {
    for (const id of blockCallIds(message, 'tool-call', 'id')) calls.add(id)
    for (const id of blockCallIds(message, 'tool-result', 'toolCallId')) results.add(id)
  }
  for (const id of calls) if (!results.has(id)) return false
  for (const id of results) if (!calls.has(id)) return false
  return true
}

function isSafeRestartMessage(message) {
  return message?.role === 'user' && message?.source?.kind !== 'tool'
}

function shrinkCompactionInput(input, ratio = SUMMARY_SHRINK_RATIO) {
  const messages = Array.isArray(input?.messages) ? input.messages : []
  if (messages.length < 2) return null
  const firstCandidate = Math.max(1, Math.ceil(messages.length * ratio))
  for (let index = firstCandidate; index < messages.length; index += 1) {
    if (!isSafeRestartMessage(messages[index])) continue
    const retained = messages.slice(index)
    if (!toolPairsBalanced(retained)) continue
    return { ...input, messages: retained }
  }
  return null
}

class DesktopCompactionEngine extends BasicCompactionEngine {
  constructor(ctx, config = {}) {
    super(ctx, desktopEngineConfig(config))
    ctx.on('agent/request-error', (payload, next) => recoverCodexOverload(payload, next, ctx))
    ctx.on('agent/request-error', ({ failure, signal }, next) => {
      if (!signal.aborted && failure?.code === CONTEXT_WINDOW_EXCEEDED_CODE) ctx.logger.error(CONTEXT_RECOVERY_GUIDANCE)
      return next()
    })
  }

  async summarize(input, agent, signal) {
    let candidate = input
    let overflow
    for (let attempt = 0; attempt <= SUMMARY_SHRINK_RETRIES; attempt += 1) {
      try {
        return await super.summarize(candidate, agent, signal)
      } catch (error) {
        if (!isContextOverflowError(error) || signal?.aborted) throw error
        overflow = error
        if (attempt >= SUMMARY_SHRINK_RETRIES) break
        const reduced = shrinkCompactionInput(candidate)
        if (reduced === null || reduced.messages.length >= candidate.messages.length) break
        candidate = reduced
        this.ctx.logger.warn(`desktop compaction summary overflow; retrying with ${candidate.messages.length} balanced messages`)
      }
    }
    const error = new Error(CONTEXT_RECOVERY_GUIDANCE, { cause: overflow })
    error.code = CONTEXT_WINDOW_EXCEEDED_CODE
    throw error
  }
}

export {
  CODEX_OVERLOAD_GUIDANCE,
  CODEX_OVERLOAD_MAX_RETRIES,
  CODEX_OVERLOAD_POLICY_KEY,
  CONTEXT_RECOVERY_GUIDANCE,
  DEFAULT_ENGINE_CONFIG,
  DEFAULT_MODEL_POLICIES,
  DESKTOP_COMPACTION_POLICY_VERSION,
  DesktopCompactionEngine,
  SUMMARY_SHRINK_RETRIES,
  cancellableDelay,
  codexOverloadDelay,
  desktopEngineConfig,
  isCodexOverloadFailure,
  isContextOverflowError,
  recoverCodexOverload,
  shrinkCompactionInput,
  toolPairsBalanced
}
export default DesktopCompactionEngine
