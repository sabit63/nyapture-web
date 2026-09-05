export type SearchRequestKind = 'foreground' | 'background'

export type SearchRequestToken = Readonly<{
  id: number
  kind: SearchRequestKind
}>

export type SearchRequestLifecycleState = Readonly<{
  nextId: number
  active: SearchRequestToken | null
  backgroundPending: boolean
}>

export type SearchRequestBeginResult = Readonly<{
  state: SearchRequestLifecycleState
  token: SearchRequestToken
  superseded: SearchRequestToken | null
}>

export type SearchRequestBackgroundResult = Readonly<{
  state: SearchRequestLifecycleState
  token: SearchRequestToken | null
  queued: boolean
}>

export type SearchRequestFinishResult = Readonly<{
  state: SearchRequestLifecycleState
  accepted: boolean
  startPendingBackground: boolean
}>

export const createSearchRequestLifecycleState = (): SearchRequestLifecycleState => ({
  nextId: 0,
  active: null,
  backgroundPending: false,
})

export const beginForegroundSearchRequest = (
  state: SearchRequestLifecycleState,
): SearchRequestBeginResult => {
  const token: SearchRequestToken = { id: state.nextId + 1, kind: 'foreground' }
  return {
    state: {
      nextId: token.id,
      active: token,
      backgroundPending: state.backgroundPending,
    },
    token,
    superseded: state.active,
  }
}

export const requestBackgroundSearchRequest = (
  state: SearchRequestLifecycleState,
): SearchRequestBackgroundResult => {
  if (state.active) {
    return {
      state: { ...state, backgroundPending: true },
      token: null,
      queued: true,
    }
  }

  const token: SearchRequestToken = { id: state.nextId + 1, kind: 'background' }
  return {
    state: {
      nextId: token.id,
      active: token,
      backgroundPending: false,
    },
    token,
    queued: false,
  }
}

export const finishSearchRequest = (
  state: SearchRequestLifecycleState,
  token: SearchRequestToken,
): SearchRequestFinishResult => {
  if (state.active?.id !== token.id) {
    return {
      state,
      accepted: false,
      startPendingBackground: false,
    }
  }

  return {
    state: {
      ...state,
      active: null,
      backgroundPending: false,
    },
    accepted: true,
    startPendingBackground: state.backgroundPending,
  }
}

export const cancelSearchRequest = (
  state: SearchRequestLifecycleState,
  token: SearchRequestToken,
): SearchRequestLifecycleState => (
  state.active?.id === token.id ? { ...state, active: null } : state
)

export const resetSearchRequestLifecycle = (
  state: SearchRequestLifecycleState,
): SearchRequestLifecycleState => ({
  ...state,
  active: null,
  backgroundPending: false,
})

export const isCurrentSearchRequest = (
  state: SearchRequestLifecycleState,
  token: SearchRequestToken,
) => state.active?.id === token.id
