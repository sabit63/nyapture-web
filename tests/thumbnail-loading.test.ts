import assert from 'node:assert/strict'
import test from 'node:test'

import {
  getThumbnailObserverRootMargin,
  ThumbnailLifecycle,
} from '../src/components/thumbnail-loading.ts'

test('page thumbnails defer until first entry and retain their request after leaving', () => {
  const lifecycle = new ThumbnailLifecycle({ mode: 'page', viewports: 3 })

  assert.equal(lifecycle.snapshot().phase, 'deferred')
  assert.equal(lifecycle.snapshot().requestGeneration, null)

  const firstEntry = lifecycle.enter()
  assert.deepEqual(firstEntry.effects, ['stopRetry', 'start'])
  assert.ok(firstEntry.token)
  const firstToken = firstEntry.token
  assert.equal(lifecycle.isCurrent(firstToken), true)

  lifecycle.markLoaded(firstToken)
  const afterLeave = lifecycle.leave()
  assert.deepEqual(afterLeave.effects, [])
  assert.equal(afterLeave.state.phase, 'loaded')
  assert.equal(afterLeave.state.inRange, true)

  const secondEntry = lifecycle.enter()
  assert.deepEqual(secondEntry.effects, [])
  assert.equal(lifecycle.snapshot().generation, firstToken.generation)
})

test('range thumbnails release on exit and get a fresh generation on re-entry', () => {
  const lifecycle = new ThumbnailLifecycle({ mode: 'range', viewports: 4 })
  const firstEntry = lifecycle.enter()
  assert.ok(firstEntry.token)
  const firstToken = firstEntry.token

  lifecycle.markLoaded(firstToken)
  const leave = lifecycle.leave()
  assert.deepEqual(leave.effects, ['abort', 'stopRetry', 'release'])
  assert.equal(leave.state.phase, 'deferred')
  assert.equal(leave.state.inRange, false)
  assert.equal(lifecycle.isCurrent(firstToken), false)

  const reEntry = lifecycle.enter()
  assert.ok(reEntry.token)
  const secondToken = reEntry.token
  assert.ok(secondToken.generation > firstToken.generation)
  assert.equal(lifecycle.isCurrent(firstToken), false)
  assert.equal(lifecycle.isCurrent(secondToken), true)
})

test('stale request events cannot change a later range request', () => {
  const lifecycle = new ThumbnailLifecycle({ mode: 'range' })
  const firstEntry = lifecycle.enter()
  assert.ok(firstEntry.token)
  const firstToken = firstEntry.token

  lifecycle.leave()
  const secondEntry = lifecycle.enter()
  assert.ok(secondEntry.token)
  const secondToken = secondEntry.token

  assert.deepEqual(lifecycle.markLoaded(firstToken).effects, [])
  assert.equal(lifecycle.snapshot().phase, 'loading')
  assert.equal(lifecycle.isCurrent(firstToken), false)

  lifecycle.markLoaded(secondToken)
  assert.equal(lifecycle.snapshot().phase, 'loaded')
})

test('immediate remains the default and observer distance is converted to pixels', () => {
  const lifecycle = new ThumbnailLifecycle()
  const entry = lifecycle.enter()

  assert.deepEqual(entry.effects, ['stopRetry', 'start'])
  assert.equal(entry.state.mode, 'immediate')
  assert.equal(getThumbnailObserverRootMargin(800, 3), '2400px 0px')
  assert.equal(getThumbnailObserverRootMargin(601.5, 4), '2406px 0px')
})
