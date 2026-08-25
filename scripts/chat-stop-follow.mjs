export function createChatStopFollowState(running, following = true) {
  return {
    running: running === true,
    runningFollow: following === true,
    settling: false
  }
}

export function reduceChatStopFollowState(state, event) {
  if (event?.type === 'render') {
    const running = event.running === true
    if (running) {
      if (state.running) return state.settling ? { ...state, settling: false } : state
      return {
        running: true,
        runningFollow: event.following === true,
        settling: false
      }
    }
    if (!state.running) return state
    return {
      running: false,
      runningFollow: state.runningFollow,
      settling: state.runningFollow
    }
  }

  if (event?.type === 'reader') {
    if (event.moved !== true) return state
    const following = event.following === true
    if (state.running) {
      return state.runningFollow === following ? state : { ...state, runningFollow: following }
    }
    return state.settling && !following ? { ...state, settling: false } : state
  }

  if (event?.type === 'pin' && state.running && !state.runningFollow) {
    return { ...state, runningFollow: true }
  }

  return state
}
