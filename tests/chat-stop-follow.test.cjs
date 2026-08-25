const test = require('node:test')
const assert = require('node:assert/strict')

test('chat stop follow survives delayed settlement until the reader scrolls away', async () => {
  const { createChatStopFollowState, reduceChatStopFollowState } = await import('../scripts/chat-stop-follow.mjs')
  let state = createChatStopFollowState(true, true)

  state = reduceChatStopFollowState(state, { type: 'reader', moved: false, following: false })
  assert.deepEqual(state, { running: true, runningFollow: true, settling: false }, 'layout-driven scroll changes do not impersonate the reader')

  state = reduceChatStopFollowState(state, { type: 'render', running: false, following: false })
  assert.deepEqual(state, { running: false, runningFollow: true, settling: true }, 'the pre-stop follow intent survives the first shrinking commit')

  state = reduceChatStopFollowState(state, { type: 'render', running: false, following: false })
  assert.equal(state.settling, true, 'later interrupted/tool settlement commits remain pinned')
  state = reduceChatStopFollowState(state, { type: 'reader', moved: false, following: false })
  assert.equal(state.settling, true, 'ResizeObserver and scroll clamping cannot clear the latch')

  state = reduceChatStopFollowState(state, { type: 'reader', moved: true, following: false })
  assert.equal(state.settling, false, 'an intentional reader scroll immediately releases follow-through')
})

test('chat stop follow preserves an intentionally scrolled reading position', async () => {
  const { createChatStopFollowState, reduceChatStopFollowState } = await import('../scripts/chat-stop-follow.mjs')
  let state = createChatStopFollowState(true, true)

  state = reduceChatStopFollowState(state, { type: 'reader', moved: true, following: false })
  assert.equal(state.runningFollow, false)
  state = reduceChatStopFollowState(state, { type: 'render', running: false, following: false })
  assert.equal(state.settling, false, 'stopping must not snap a reader who moved away from the bottom')
})

test('a new run can reacquire bottom follow before it is interrupted', async () => {
  const { createChatStopFollowState, reduceChatStopFollowState } = await import('../scripts/chat-stop-follow.mjs')
  let state = createChatStopFollowState(false, false)

  state = reduceChatStopFollowState(state, { type: 'render', running: true, following: false })
  assert.deepEqual(state, { running: true, runningFollow: false, settling: false })
  state = reduceChatStopFollowState(state, { type: 'pin' })
  assert.equal(state.runningFollow, true, 'sending/appending at the tip records explicit follow intent')
  state = reduceChatStopFollowState(state, { type: 'render', running: false, following: false })
  assert.equal(state.settling, true)
})
