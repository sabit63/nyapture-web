import assert from 'node:assert/strict'
import test from 'node:test'

import {
  beginForegroundSearchRequest,
  cancelSearchRequest,
  createSearchRequestLifecycleState,
  finishSearchRequest,
  isCurrentSearchRequest,
  requestBackgroundSearchRequest,
  resetSearchRequestLifecycle,
} from '../src/features/search/search-request-lifecycle'

test('a resync during foreground loading is coalesced until foreground completion', () => {
  let state = createSearchRequestLifecycleState()
  const foreground = beginForegroundSearchRequest(state)
  state = foreground.state

  const firstResync = requestBackgroundSearchRequest(state)
  state = firstResync.state
  const secondResync = requestBackgroundSearchRequest(state)
  state = secondResync.state

  assert.equal(firstResync.queued, true)
  assert.equal(firstResync.token, null)
  assert.equal(secondResync.queued, true)
  assert.equal(secondResync.token, null)
  assert.equal(state.active?.kind, 'foreground')
  assert.equal(state.backgroundPending, true)

  const finished = finishSearchRequest(state, foreground.token)
  assert.equal(finished.accepted, true)
  assert.equal(finished.startPendingBackground, true)
  assert.equal(finished.state.active, null)

  const background = requestBackgroundSearchRequest(finished.state)
  assert.equal(background.queued, false)
  assert.equal(background.token?.kind, 'background')
})

test('a resync during background loading is coalesced into one follow-up request', () => {
  let state = createSearchRequestLifecycleState()
  const background = requestBackgroundSearchRequest(state)
  state = background.state
  assert.ok(background.token)

  const queued = requestBackgroundSearchRequest(state)
  state = queued.state
  assert.equal(queued.queued, true)
  assert.equal(queued.token, null)

  const finished = finishSearchRequest(state, background.token)
  assert.equal(finished.accepted, true)
  assert.equal(finished.startPendingBackground, true)
  const followUp = requestBackgroundSearchRequest(finished.state)
  assert.equal(followUp.token?.kind, 'background')
})

test('foreground takes priority over background and leaves its buffered resync pending', () => {
  let state = createSearchRequestLifecycleState()
  const background = requestBackgroundSearchRequest(state)
  state = background.state
  assert.ok(background.token)
  state = requestBackgroundSearchRequest(state).state

  const foreground = beginForegroundSearchRequest(state)
  state = foreground.state
  assert.deepEqual(foreground.superseded, background.token)
  assert.equal(state.active?.id, foreground.token.id)
  assert.equal(state.active?.kind, 'foreground')
  assert.equal(state.backgroundPending, true)
  assert.equal(isCurrentSearchRequest(state, background.token), false)

  const staleBackgroundFinish = finishSearchRequest(state, background.token)
  assert.equal(staleBackgroundFinish.accepted, false)
  assert.equal(staleBackgroundFinish.state.active?.id, foreground.token.id)

  const foregroundFinish = finishSearchRequest(state, foreground.token)
  assert.equal(foregroundFinish.startPendingBackground, true)
})

test('stale cancellation does not affect the current request and reset clears pending work', () => {
  let state = createSearchRequestLifecycleState()
  const first = beginForegroundSearchRequest(state)
  const second = beginForegroundSearchRequest(first.state)
  state = second.state

  state = cancelSearchRequest(state, first.token)
  assert.equal(state.active?.id, second.token.id)
  assert.equal(isCurrentSearchRequest(state, second.token), true)

  state = resetSearchRequestLifecycle(state)
  assert.equal(state.active, null)
  assert.equal(state.backgroundPending, false)
})
