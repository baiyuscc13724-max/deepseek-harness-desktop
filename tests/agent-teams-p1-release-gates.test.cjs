const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const root = path.resolve(__dirname, '..')
const gates = [
  {
    name: 'accepted-completed adopt',
    file: 'tests/agent-teams-planning-contract.test.cjs',
    pattern: 'accepted completed tasks retain the accepting owner epoch across same-project adoption'
  },
  {
    name: 'authorization exact parameters, expiry, and replay',
    file: 'tests/agent-teams-planning-contract.test.cjs',
    pattern: 'resolve_unknown consumes a short-lived Host receipt bound to exact turn, effect attempt, outcome, epoch, revision, and canonical parameters'
  },
  {
    name: 'Host native bridge confirmation and restart replay',
    file: 'tests/agent-teams-authorization-service.test.cjs',
    pattern: 'native Host confirmation issues one exact short-lived receipt and persists single consumption across restart'
  },
  {
    name: 'Host dual-instance serialization',
    file: 'tests/agent-teams-authorization-service.test.cjs',
    pattern: 'two Host service instances serialize through a wx lock and only one confirms the same authorization id'
  },
  {
    name: 'Host authorization capacity',
    file: 'tests/agent-teams-authorization-service.test.cjs',
    pattern: 'authorization capacity fails closed without evicting old ids and restart preserves replay denial'
  },
  {
    name: 'Host cancellation and argument replacement fail closed',
    file: 'tests/agent-teams-authorization-service.test.cjs',
    pattern: 'cancel, timeout, schema replacement, forged capability, and service errors fail closed without leaking details'
  },
  {
    name: 'secure-channel restart replay',
    file: 'tests/project-secure-channel.test.cjs',
    pattern: 'authenticated packets have durable crash-consistent receipts shared across channel instances'
  },
  {
    name: 'secure-channel replay capacity',
    file: 'tests/project-secure-channel.test.cjs',
    pattern: 'durable replay capacity fails closed, then expired receipts are pruned without crossing authority epochs'
  },
  {
    name: 'same-dedupe dual-instance race',
    file: 'tests/collaboration-service.test.cjs',
    pattern: 'same dedupe key is admitted once across isolated service instances and becomes eligible after TTL'
  },
  {
    name: 'project-entry secret persistence scan',
    file: 'tests/project-entry-service.test.cjs',
    pattern: 'two paired desktops automatically establish a real LAN mTLS and E2EE connection without exposing PEM fields'
  }
]

test('Agent Teams P1 release-blocking matrix dynamically executes every security and durability gate', { skip: process.env.HARNESS_AGENT_TEAMS_P1_RELEASE_GATES !== '1', timeout: 180_000 }, async t => {
  for (const gate of gates) {
    await t.test(gate.name, () => {
      const childEnv = { ...process.env, HARNESS_AGENT_TEAMS_P1_CHILD: '1' }
      delete childEnv.NODE_TEST_CONTEXT
      const result = spawnSync(process.execPath, ['--test', `--test-name-pattern=${gate.pattern}`, gate.file], {
        cwd: root,
        encoding: 'utf8',
        env: childEnv,
        timeout: 60_000
      })
      const diagnostic = `${result.stdout || ''}\n${result.stderr || ''}`
      assert.equal(result.error, undefined, diagnostic)
      assert.equal(result.status, 0, diagnostic)
      assert.match(result.stdout, /(?:# |ℹ )pass 1(?:\r?\n|$)/u, `Gate did not execute exactly one passing dynamic test: ${gate.name}\n${diagnostic}`)
      assert.doesNotMatch(result.stdout, /(?:# |ℹ )fail [1-9]/u, diagnostic)
    })
  }
})
