import z from "@deepseek-ai/schemastery";
import { LlmError, isAgentLoopRequest } from "@deepseek-ai/dsh-llm";

const name = "model-admission";
const inject = ["agents", "llm", "sessions"];

const DEFAULT_MAX_ACTIVE = 8;
const DEFAULT_MAX_QUEUED = 32;
const DEFAULT_MAX_QUEUED_PER_ROOT = 8;
const DEFAULT_WAIT_MS = 30_000;
const MAX_ACTIVE_LIMIT = 64;
const MAX_QUEUED_LIMIT = 4_096;
const MAX_QUEUED_PER_ROOT_LIMIT = 512;
const MAX_WAIT_MS_LIMIT = 600_000;
const MAX_ROOT_KEY_LENGTH = 256;

const ERROR_CODES = Object.freeze({
  cancelled: "MODEL_ADMISSION_CANCELLED",
  closed: "MODEL_ADMISSION_CLOSED",
  queueFull: "MODEL_ADMISSION_QUEUE_FULL",
  timeout: "MODEL_ADMISSION_TIMEOUT",
});

const Config = z.object({
  maxActive: z.number().step(1).min(1).max(MAX_ACTIVE_LIMIT).default(DEFAULT_MAX_ACTIVE),
  maxQueued: z.number().step(1).min(1).max(MAX_QUEUED_LIMIT).default(DEFAULT_MAX_QUEUED),
  maxQueuedPerRoot: z.number().step(1).min(1).max(MAX_QUEUED_PER_ROOT_LIMIT).default(DEFAULT_MAX_QUEUED_PER_ROOT),
  waitMs: z.number().step(1).min(1).max(MAX_WAIT_MS_LIMIT).default(DEFAULT_WAIT_MS),
});

function boundedPositiveSafeInteger(value, field, fallback, maximum) {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < 1 || resolved > maximum) {
    throw new TypeError(`${field} must be a positive safe integer no greater than ${maximum}`);
  }
  return resolved;
}

function resolveConfig(config = {}) {
  const resolved = {
    maxActive: boundedPositiveSafeInteger(config.maxActive, "maxActive", DEFAULT_MAX_ACTIVE, MAX_ACTIVE_LIMIT),
    maxQueued: boundedPositiveSafeInteger(config.maxQueued, "maxQueued", DEFAULT_MAX_QUEUED, MAX_QUEUED_LIMIT),
    maxQueuedPerRoot: boundedPositiveSafeInteger(config.maxQueuedPerRoot, "maxQueuedPerRoot", DEFAULT_MAX_QUEUED_PER_ROOT, MAX_QUEUED_PER_ROOT_LIMIT),
    waitMs: boundedPositiveSafeInteger(config.waitMs, "waitMs", DEFAULT_WAIT_MS, MAX_WAIT_MS_LIMIT),
  };
  if (resolved.maxQueuedPerRoot > resolved.maxQueued) {
    throw new TypeError("maxQueuedPerRoot must not exceed maxQueued");
  }
  return Object.freeze(resolved);
}

function admissionError(message, code, cause) {
  return new LlmError(message, code, cause === undefined ? undefined : { cause });
}

function cancellationError(cause) {
  return admissionError("Model request was cancelled before it started.", ERROR_CODES.cancelled, cause);
}

function assertRootKey(rootKey) {
  if (typeof rootKey !== "string" || rootKey.length === 0 || rootKey.length > MAX_ROOT_KEY_LENGTH) {
    throw new TypeError(`rootKey must be a non-empty string no longer than ${MAX_ROOT_KEY_LENGTH} characters`);
  }
  return rootKey;
}

function createModelAdmission(config = {}) {
  const settings = resolveConfig(config);
  let active = 0;
  let queued = 0;
  let closed = false;
  const queues = new Map();
  const rootRing = [];

  const removeRootFromRing = (rootKey) => {
    const index = rootRing.indexOf(rootKey);
    if (index >= 0) rootRing.splice(index, 1);
  };

  const cleanupWaiter = (waiter) => {
    if (waiter.timer !== undefined) clearTimeout(waiter.timer);
    waiter.signal?.removeEventListener?.("abort", waiter.onAbort);
  };

  const rejectWaiter = (waiter, error) => {
    if (waiter.settled) return;
    waiter.settled = true;
    cleanupWaiter(waiter);
    waiter.reject(error);
  };

  const detachWaiter = (waiter) => {
    if (waiter.settled) return false;
    const rootQueue = queues.get(waiter.rootKey);
    const index = rootQueue?.indexOf(waiter) ?? -1;
    if (index < 0) return false;
    rootQueue.splice(index, 1);
    queued -= 1;
    if (rootQueue.length === 0) {
      queues.delete(waiter.rootKey);
      removeRootFromRing(waiter.rootKey);
    }
    return true;
  };

  const releaseSlot = () => {
    let released = false;
    return () => {
      if (released) return false;
      released = true;
      active -= 1;
      pump();
      return true;
    };
  };

  const grant = (waiter) => {
    if (waiter.settled) return;
    waiter.settled = true;
    cleanupWaiter(waiter);
    active += 1;
    waiter.resolve(releaseSlot());
  };

  function pump() {
    while (!closed && active < settings.maxActive && rootRing.length > 0) {
      const rootKey = rootRing.shift();
      const rootQueue = queues.get(rootKey);
      if (rootQueue === undefined || rootQueue.length === 0) {
        queues.delete(rootKey);
        continue;
      }
      const waiter = rootQueue.shift();
      queued -= 1;
      if (rootQueue.length === 0) queues.delete(rootKey);
      else rootRing.push(rootKey);
      grant(waiter);
    }
  }

  function acquire(rootKey, signal) {
    assertRootKey(rootKey);
    if (closed) {
      return Promise.reject(admissionError("Model request scheduling is unavailable because the service is stopping.", ERROR_CODES.closed));
    }
    if (signal?.aborted) return Promise.reject(cancellationError(signal.reason));
    if (active < settings.maxActive && rootRing.length === 0) {
      active += 1;
      return Promise.resolve(releaseSlot());
    }
    const rootQueue = queues.get(rootKey) ?? [];
    if (queued >= settings.maxQueued || rootQueue.length >= settings.maxQueuedPerRoot) {
      return Promise.reject(admissionError("Too many model requests are waiting. Try again shortly.", ERROR_CODES.queueFull));
    }
    return new Promise((resolve, reject) => {
      // Deliberately retain only scheduling metadata. The LLM request, messages,
      // tools, system prompt, and provider body never enter this queue.
      const waiter = {
        rootKey,
        signal,
        resolve,
        reject,
        settled: false,
        timer: undefined,
        onAbort: undefined,
      };
      waiter.onAbort = () => {
        if (!detachWaiter(waiter)) return;
        rejectWaiter(waiter, cancellationError(signal?.reason));
        pump();
      };
      waiter.timer = setTimeout(() => {
        if (!detachWaiter(waiter)) return;
        rejectWaiter(waiter, admissionError("The model request waited too long for a free slot. Try again.", ERROR_CODES.timeout));
        pump();
      }, settings.waitMs);
      waiter.timer.unref?.();
      signal?.addEventListener?.("abort", waiter.onAbort, { once: true });
      rootQueue.push(waiter);
      queued += 1;
      if (!queues.has(rootKey)) {
        queues.set(rootKey, rootQueue);
        rootRing.push(rootKey);
      }
      pump();
    });
  }

  function close() {
    if (closed) return;
    closed = true;
    const error = admissionError("Model request was stopped because scheduling is shutting down.", ERROR_CODES.closed);
    for (const rootQueue of queues.values()) {
      for (const waiter of rootQueue) rejectWaiter(waiter, error);
    }
    queues.clear();
    rootRing.length = 0;
    queued = 0;
  }

  function snapshot() {
    return Object.freeze({
      active,
      queued,
      rootCount: queues.size,
      closed,
      ...settings,
    });
  }

  return Object.freeze({ acquire, close, snapshot });
}

function resolveRootKey(ctx, sessionId) {
  let lookupKey = sessionId;
  let currentKey = assertRootKey(String(sessionId));
  const path = [];
  const positions = new Map();
  while (true) {
    const session = ctx.sessions.get(lookupKey);
    const key = session === undefined ? currentKey : assertRootKey(String(session.id ?? currentKey));
    const cycleStart = positions.get(key);
    if (cycleStart !== undefined) {
      const cycle = path.slice(cycleStart);
      return cycle.reduce((smallest, candidate) => candidate < smallest ? candidate : smallest);
    }
    positions.set(key, path.length);
    path.push(key);
    if (session === undefined) return key;
    const parentSession = session.header?.parentSession;
    if (typeof parentSession !== "string" || parentSession.length === 0) return key;
    currentKey = assertRootKey(parentSession);
    lookupKey = parentSession;
  }
}

function admittedStream(admission, rootKey, signal, next) {
  return (async function* () {
    const release = await admission.acquire(rootKey, signal);
    try {
      if (signal?.aborted) throw cancellationError(signal.reason);
      yield* next();
    } finally {
      release();
    }
  })();
}

function apply(ctx, config = {}, internals = {}) {
  const admission = internals.admission ?? createModelAdmission(config);
  ctx.effect(() => () => admission.close(), "model-admission lifecycle");
  ctx.on("llm/stream", (options, next) => {
    if (!isAgentLoopRequest(options) || options.sessionId === undefined) return next();
    const rootKey = resolveRootKey(ctx, options.sessionId);
    return admittedStream(admission, rootKey, options.signal, next);
  }, { global: true });
}

export {
  Config,
  DEFAULT_MAX_ACTIVE,
  DEFAULT_MAX_QUEUED,
  DEFAULT_MAX_QUEUED_PER_ROOT,
  DEFAULT_WAIT_MS,
  ERROR_CODES,
  MAX_ACTIVE_LIMIT,
  MAX_QUEUED_LIMIT,
  MAX_QUEUED_PER_ROOT_LIMIT,
  MAX_ROOT_KEY_LENGTH,
  MAX_WAIT_MS_LIMIT,
  admittedStream,
  apply,
  createModelAdmission,
  inject,
  name,
  resolveConfig,
  resolveRootKey,
};
