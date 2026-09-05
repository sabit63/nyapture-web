import assert from 'node:assert/strict'
import test from 'node:test'
import {
  canStartDownloadReconciliation,
  createDownloadPollingState,
  finishDownloadReconciliation,
  requestDownloadReconciliation,
  setDownloadPollingActive,
  setDownloadPollingVisible,
  startDownloadReconciliation,
} from '../src/features/downloads/download-polling'

test('reconciliation requests coalesce and do not start while hidden', () => {
  const active = setDownloadPollingActive(createDownloadPollingState(), true)
  const requested = requestDownloadReconciliation(requestDownloadReconciliation(active))
  assert.equal(requested.requested, true)
  assert.equal(canStartDownloadReconciliation(requested), true)

  const hidden = setDownloadPollingVisible(requested, false)
  const blocked = startDownloadReconciliation(hidden)
  assert.equal(blocked.started, false)
  assert.equal(blocked.state.requested, true)
  assert.equal(blocked.state.inFlight, false)
})

test('visible reconciliation starts immediately and preserves a request queued in flight', () => {
  const initial = setDownloadPollingActive(createDownloadPollingState(), true)
  const started = startDownloadReconciliation(setDownloadPollingVisible(initial, true))
  assert.equal(started.started, true)
  assert.equal(started.state.requested, false)
  assert.equal(started.state.inFlight, true)

  const queued = requestDownloadReconciliation(started.state)
  assert.equal(startDownloadReconciliation(queued).started, false)
  const finished = finishDownloadReconciliation(queued)
  assert.equal(finished.inFlight, false)
  assert.equal(finished.requested, true)
  assert.equal(startDownloadReconciliation(finished).started, true)
})

test('a requested reconciliation can start after terminal-only projection', () => {
  const requested = requestDownloadReconciliation(createDownloadPollingState())
  assert.equal(canStartDownloadReconciliation(requested), true)
  const started = startDownloadReconciliation(requested)
  assert.equal(started.started, true)
  assert.equal(started.state.active, false)
  assert.equal(started.state.requested, false)
})
