'use strict'

function ok(value = {}) {
  return { result: { ok: true, value } }
}

function failed(message) {
  return { result: { ok: false, error: { message, code: 'fixture-failure' } } }
}

function createCredentialHarness({ user = {}, base = {}, failDescribe = false, failUnset = false, failMutateAt = [] } = {}) {
  const profile = { user: structuredClone(user), base: structuredClone(base) }
  const secrets = new Map()
  const calls = { describe: [], set: [], unset: [], mutate: [] }
  const audit = []
  let environmentSecretReads = 0

  const api = {
    credentials: {
      async describe({ refs }) {
        calls.describe.push({ refs: [...refs] })
        audit.push({ operation: 'credentials.describe', refs: [...refs] })
        if (failDescribe) return failed('credential status unavailable')
        // Metadata only: this interface deliberately has no environment-secret value field.
        return ok({ credentials: Object.fromEntries(refs.map((ref) => [ref, { configured: true, writable: !ref.startsWith('ENV_') }])) })
      },
      async set({ ref, value }) {
        calls.set.push({ ref, value })
        audit.push({ operation: 'credentials.set', ref })
        secrets.set(ref, value)
        return ok()
      },
      async unset({ ref }) {
        calls.unset.push({ ref })
        audit.push({ operation: 'credentials.unset', ref })
        if (failUnset) return failed('credential unset failed')
        secrets.delete(ref)
        return ok()
      }
    },
    settings: {
      async mutate({ ops }) {
        const attempt = calls.mutate.length + 1
        calls.mutate.push(structuredClone(ops))
        audit.push({ operation: 'settings.mutate', ops: structuredClone(ops) })
        if (failMutateAt.includes(attempt)) return failed(`settings mutate ${attempt} failed`)
        for (const op of ops) {
          const key = op.path.at(-1)
          if (op.op === 'set') profile.user[key] = op.value
          else if (op.op === 'unset') delete profile.user[key]
        }
        return ok({ user: structuredClone(profile.user), revision: attempt })
      }
    }
  }

  function snapshot(outcome = 'ok') {
    return {
      outcome,
      provider: { ...profile.base, ...profile.user },
      user: structuredClone(profile.user),
      credentialRefs: [...secrets.keys()],
      audit: structuredClone(audit),
      environmentSecretReads
    }
  }

  async function apply(plan, { credentialOnly = false } = {}) {
    if (plan.error) throw new Error(plan.error)
    const ops = []
    if (plan.profile.op === 'set' && profile.user.apiKeyEnv !== plan.profile.ref) ops.push({ op: 'set', path: ['apiKeyEnv'], value: plan.profile.ref })
    if (plan.profile.op === 'unset' && Object.hasOwn(profile.user, 'apiKeyEnv')) ops.push({ op: 'unset', path: ['apiKeyEnv'] })
    const settingsOps = credentialOnly ? ops.filter((op) => op.path.at(-1) === 'apiKeyEnv') : ops
    if (settingsOps.length > 0) {
      const mutation = await api.settings.mutate({ ops: settingsOps })
      if (!mutation.result.ok) return snapshot('settings-failed')
    }
    if (plan.credential.op === 'set') {
      const stored = await api.credentials.set({ ref: plan.credential.ref, value: plan.credential.value })
      if (!stored.result.ok) return snapshot('credential-set-failed')
    }
    if (plan.credential.op === 'unset') {
      const removed = await api.credentials.unset({ ref: plan.credential.ref })
      if (!removed.result.ok) {
        const rebound = await api.settings.mutate({ ops: [{ op: 'set', path: ['apiKeyEnv'], value: plan.credential.ref }] })
        return snapshot(rebound.result.ok ? 'restore-compensated' : 'restore-compensation-failed')
      }
    }
    return snapshot()
  }

  return { api, apply, calls, secrets, profile, audit, get environmentSecretReads() { return environmentSecretReads } }
}

module.exports = { createCredentialHarness }
