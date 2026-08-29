const test = require('node:test')
const assert = require('node:assert/strict')
const os = require('node:os')
const path = require('node:path')
const { mkdtemp, rm } = require('node:fs/promises')
const { pathToFileURL } = require('node:url')

const pluginFile = path.resolve(__dirname, '..', 'plugins', 'dsh-agent-teams', 'lib', 'index.js')

function testContext(promptSections, cleanups) {
  return {
    logger: { info() {}, warn() {}, error() {} },
    get() { return undefined },
    tools: { register() { return () => {} } },
    systemPrompt: {
      section(section) {
        promptSections.push(section)
        return () => {}
      }
    },
    webServer: { register() { return () => {} } },
    effect(setup) {
      const cleanup = setup()
      if (typeof cleanup === 'function') cleanups.push(cleanup)
    },
    on() { return () => {} }
  }
}

async function injectedTeamPrompt() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-teams-real-roles-'))
  const previousHome = process.env.DSH_HOME
  const promptSections = []
  const cleanups = []
  process.env.DSH_HOME = root
  try {
    const mod = await import(`${pathToFileURL(pluginFile).href}?real-roles=${Date.now()}-${Math.random()}`)
    mod.apply(testContext(promptSections, cleanups), { enabled: true, maxMembers: 4, maxActiveTurns: 4 })
    const section = promptSections.find(candidate => candidate.name === 'tool:agent-teams')
    assert.ok(section, 'the Agent Teams contract must be registered in the real system-prompt channel')
    assert.equal(typeof section.text, 'function')
    return section.text({})
  } finally {
    await Promise.allSettled(cleanups.reverse().map(cleanup => cleanup()))
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
    await rm(root, { recursive: true, force: true })
  }
}

test('injected prompt guides lead coordination but is not the Host behavior guarantee', async () => {
  // These assertions protect model guidance only. Host enforcement against false
  // completion is exercised through state transitions in the domain/runtime suites.
  const prompt = await injectedTeamPrompt()

  assert.match(prompt, /Once an Agent Team is established for the current goal, the root lead defaults to coordination only/u)
  assert.match(prompt, /must not personally implement, research, design, test, or otherwise substitute for a core professional deliverable/u)
  assert.match(prompt, /create or restructure the relevant durable task and assign or expand the visible team instead of absorbing that work/u)
  assert.match(prompt, /root may make only minimal glue changes required to integrate accepted member outputs/u)
})

test('injected team contract assigns substantive outputs to real member roles, not decorative headcount', async () => {
  const prompt = await injectedTeamPrompt()

  assert.match(prompt, /durable tasks and member roles must collectively cover the substantive outputs required to satisfy the user's goal/u)
  assert.match(prompt, /each with a real deliverable and observable acceptance criteria/u)
  assert.match(prompt, /Never create decorative, token, or review-only members while leaving the core professional output to the root lead/u)
  assert.match(prompt, /root\/lead's own work or coordination does not count as the second workstream/u)
})

test('injected team contract completes durable member work before lead integration', async () => {
  const prompt = await injectedTeamPrompt()
  const completeBeforeReport = prompt.indexOf('members must explicitly complete finished tasks before their final report')
  const acceptMemberDeliverables = prompt.indexOf('review and accept member deliverables')
  const finalIntegration = prompt.indexOf('then perform final integration and user-facing synthesis')

  assert.ok(completeBeforeReport >= 0, 'member completion must be part of the injected durable-task contract')
  assert.ok(acceptMemberDeliverables >= 0, 'the lead must review actual member deliverables')
  assert.ok(finalIntegration > acceptMemberDeliverables, 'lead integration must follow acceptance of member deliverables')
  assert.match(prompt, /A report or successful subagent turn is not completion evidence/u)
})
