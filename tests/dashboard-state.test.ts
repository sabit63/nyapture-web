import assert from 'node:assert/strict'
import test from 'node:test'
import { ApiError } from '../src/api/client'
import {
  cacheClearStateLabel,
  cacheClearStateTone,
  isCacheClearConflict,
  mergeDashboardLogs,
} from '../src/features/dashboard/dashboard-state'
import { resolveDashboardRoute } from '../src/features/dashboard/dashboard-routes'

test('dashboard routes use DataStore while preserving the legacy MongoDB entry', () => {
  assert.equal(resolveDashboardRoute('/dashboard/datastore?tab=resources'), 'datastore')
  assert.equal(resolveDashboardRoute('/dashboard/mongodb#legacy'), 'mongodb')
  assert.equal(resolveDashboardRoute('/dashboard/unknown'), 'home')
})

test('cache clear states have stable user-facing labels and tones', () => {
  assert.equal(cacheClearStateLabel('Running'), 'Running')
  assert.equal(cacheClearStateLabel('Completed'), 'Completed')
  assert.equal(cacheClearStateLabel('Failed'), 'Failed')
  assert.equal(cacheClearStateLabel('Idle'), 'Idle')
  assert.equal(cacheClearStateTone('Running'), 'info')
  assert.equal(cacheClearStateTone('Completed'), 'success')
  assert.equal(cacheClearStateTone('Failed'), 'danger')
})

test('409 cache-clear errors are distinguished from other API failures', () => {
  assert.equal(isCacheClearConflict(new ApiError('already running', { status: 409 })), true)
  assert.equal(isCacheClearConflict(new ApiError('server failure', { status: 500 })), false)
  assert.equal(isCacheClearConflict(new Error('already running')), false)
})

test('incremental dashboard logs deduplicate sequences and retain the latest 500 entries', () => {
  const current = { latestSequence: 2, entries: [{ sequence: 1, message: 'one' }, { sequence: 2, message: 'old' }] }
  const incoming = { latestSequence: 3, entries: [{ sequence: 2, message: 'new' }, { sequence: 3, message: 'three' }] }

  const merged = mergeDashboardLogs(current, incoming)

  assert.deepEqual(merged.entries, [
    { sequence: 1, message: 'one' },
    { sequence: 2, message: 'new' },
    { sequence: 3, message: 'three' },
  ])
  assert.equal(merged.latestSequence, 3)
})
