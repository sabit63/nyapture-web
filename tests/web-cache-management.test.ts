import assert from 'node:assert/strict'
import test from 'node:test'

import type { WebBookCacheConfigDto } from '../src/models/web-cache'
import {
  canSaveWebCacheConfig,
  cloneWebCacheConfig,
  createCacheSyncRequest,
  getValidationMessagesFromError,
  isCurrentCacheRequest,
  shouldPollCacheStatus,
  startSerialCachePolling,
  validateWebCacheDraft,
} from '../src/features/web-cache/management-state'

const validConfig = (): WebBookCacheConfigDto => cloneWebCacheConfig({
  enabled: true,
  intervalMinutes: 30,
  initialLookbackDays: 7,
  maxPagesPerRun: 20,
  maxDetailsPerRun: 100,
  sites: [{
    groupId: 'alpha',
    enabled: true,
    startUrl: 'https://example.test/start',
    intervalMinutes: null,
    maxPagesPerRun: null,
    maxDetailsPerRun: null,
    domainIntervalMilliseconds: 250,
  }],
  autoDownload: {
    enabled: true,
    conditionMode: 'All',
    maxPageCount: 200,
    maxAutoDownloadsPerRun: 10,
    maxAutoDownloadsPerDay: 50,
    minFreeDiskGb: 20,
    allowedGroupIds: ['alpha'],
    excludedTags: ['sample'],
  },
})

test('editable config copies nested sites and auto-download arrays', () => {
  const original = validConfig()
  const copy = cloneWebCacheConfig(original)

  copy.sites[0].groupId = 'changed'
  copy.autoDownload.allowedGroupIds.push('beta')
  copy.autoDownload.excludedTags[0] = 'edited'

  assert.equal(original.sites[0].groupId, 'alpha')
  assert.deepEqual(original.autoDownload.allowedGroupIds, ['alpha'])
  assert.deepEqual(original.autoDownload.excludedTags, ['sample'])
})

test('draft validation reports local field errors before save', () => {
  const invalid = validConfig()
  invalid.intervalMinutes = 0
  invalid.sites[0].groupId = ''
  invalid.sites.push({ ...invalid.sites[0], startUrl: '', enabled: true })
  invalid.autoDownload.conditionMode = 'Unknown'
  invalid.autoDownload.minFreeDiskGb = -1

  const issues = validateWebCacheDraft(invalid)
  const paths = issues.map((entry) => entry.path)

  assert.ok(paths.includes('intervalMinutes'))
  assert.ok(paths.includes('sites.0.groupId'))
  assert.ok(paths.includes('sites.1.startUrl'))
  assert.ok(paths.includes('autoDownload.conditionMode'))
  assert.ok(paths.includes('autoDownload.minFreeDiskGb'))
  assert.equal(canSaveWebCacheConfig(invalid, false, false), true)
  assert.equal(canSaveWebCacheConfig(invalid, true, false), false)
  assert.equal(canSaveWebCacheConfig(invalid, false, true), false)
})

test('polling follows running state', () => {
  assert.equal(shouldPollCacheStatus({ isRunning: true }), true)
  assert.equal(shouldPollCacheStatus({ isRunning: false }), false)
  assert.equal(shouldPollCacheStatus(null), false)
  assert.equal(shouldPollCacheStatus(undefined), false)
})

test('serial polling waits for delayed loads and does not schedule after stop', async () => {
  const scheduled: Array<{ callback: () => void; delay: number }> = []
  const cancelled: number[] = []
  let resolveLoad: (() => void) | undefined
  let loadCount = 0
  const stop = startSerialCachePolling(
    () => {
      loadCount += 1
      return new Promise<void>((resolve) => { resolveLoad = resolve })
    },
    (callback, delay) => {
      scheduled.push({ callback, delay })
      return scheduled.length
    },
    (timer) => { cancelled.push(timer) },
  )

  assert.deepEqual(scheduled.map(({ delay }) => delay), [2000])
  const first = scheduled.shift()
  assert.ok(first)
  first.callback()
  assert.equal(loadCount, 1)
  assert.equal(scheduled.length, 0)

  stop()
  resolveLoad?.()
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
  assert.equal(scheduled.length, 0)
  assert.deepEqual(cancelled, [1])
})

test('sync request trims a group id and represents all sites as null', () => {
  assert.deepEqual(createCacheSyncRequest('  alpha  ', true), { groupId: 'alpha', force: true })
  assert.deepEqual(createCacheSyncRequest('   ', false), { groupId: null, force: false })
})

test('stale cache responses are rejected by revision and request id', () => {
  assert.equal(isCurrentCacheRequest(3, 3, 7, 7), true)
  assert.equal(isCurrentCacheRequest(2, 3, 7, 7), false)
  assert.equal(isCurrentCacheRequest(3, 3, 6, 7), false)
})

test('validation errors are limited to sanitized string messages', () => {
  assert.deepEqual(getValidationMessagesFromError({ validationErrors: ['one', '', 4, ' two '] }), ['one', ' two '])
  assert.deepEqual(getValidationMessagesFromError({ validationErrors: 'one' }), [])
  assert.deepEqual(getValidationMessagesFromError(new Error('no details')), [])
})
