import assert from 'node:assert/strict'
import test from 'node:test'

import {
  BookPageLoader,
  compareBookPageQueueCandidates,
  getBookPageQueueLane,
  getBookPageRequestWidth,
  getBookPageRetryDelayMs,
  isRetryableBookPageError,
} from '../src/features/viewer/book-page-loading.ts'

const flushPromises = async () => {
  for (let index = 0; index < 8; index += 1) await Promise.resolve()
}

const deferred = <T>() => {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

test('request width is DPR-aware, bucketed, and capped', () => {
  assert.equal(getBookPageRequestWidth(0, 2), 1024)
  assert.equal(getBookPageRequestWidth(320, 1), 640)
  assert.equal(getBookPageRequestWidth(390, 2), 1024)
  assert.equal(getBookPageRequestWidth(760, 2), 1600)
  assert.equal(getBookPageRequestWidth(900, 3), 1600)
})

test('retry rules include ambiguous 404 and transient failures only', () => {
  for (const status of [404, 408, 429, 500, 503, 599]) {
    assert.equal(isRetryableBookPageError({ status }), true, `status ${status}`)
  }
  for (const status of [400, 401, 403, 409, 422]) {
    assert.equal(isRetryableBookPageError({ status }), false, `status ${status}`)
  }
  for (const category of ['timeout', 'offline', 'server']) {
    assert.equal(isRetryableBookPageError({ category }), true, category)
  }
  assert.equal(isRetryableBookPageError({ name: 'AbortError', category: 'server' }), false)
  assert.equal(isRetryableBookPageError(new Error('decode failed')), false)
})

test('retry delays use two exponential steps with bounded jitter', () => {
  assert.equal(getBookPageRetryDelayMs(1, () => 0), 500)
  assert.equal(getBookPageRetryDelayMs(1, () => 1), 750)
  assert.equal(getBookPageRetryDelayMs(2, () => 0), 1000)
  assert.equal(getBookPageRetryDelayMs(2, () => 1), 1250)
  assert.equal(getBookPageRetryDelayMs(99, () => 0), 1000)
})

test('queue priority is deterministic across lanes and distance', () => {
  const candidates = [
    { pageNumber: 8, kind: 'upgrade', visible: false, hasDisplayedAsset: true, currentPage: 5, enqueueSequence: 1 },
    { pageNumber: 4, kind: 'automaticRetry', visible: false, hasDisplayedAsset: false, currentPage: 5, enqueueSequence: 2 },
    { pageNumber: 7, kind: 'initial', visible: false, hasDisplayedAsset: false, currentPage: 5, enqueueSequence: 3 },
    { pageNumber: 6, kind: 'initial', visible: true, hasDisplayedAsset: false, currentPage: 5, enqueueSequence: 4 },
    { pageNumber: 9, kind: 'manualRetry', visible: true, hasDisplayedAsset: false, currentPage: 5, enqueueSequence: 5 },
    { pageNumber: 5, kind: 'upgrade', visible: true, hasDisplayedAsset: true, currentPage: 5, enqueueSequence: 6 },
    { pageNumber: 10, kind: 'automaticRetry', visible: true, hasDisplayedAsset: true, currentPage: 5, enqueueSequence: 7 },
  ] as const

  assert.deepEqual(
    [...candidates].sort(compareBookPageQueueCandidates).map((candidate) => candidate.pageNumber),
    [9, 6, 7, 4, 10, 5, 8],
  )
  assert.deepEqual(candidates.map(getBookPageQueueLane), [5, 3, 2, 1, 0, 4, 3])
})

test('four-request cap includes an aborted request until its promise settles', async () => {
  const requests: Array<ReturnType<typeof deferred<Blob>> & { pageNumber: number; signal: AbortSignal }> = []
  const loader = new BookPageLoader({
    totalPages: 6,
    loadPage: (pageNumber, _width, signal) => {
      const request = { ...deferred<Blob>(), pageNumber, signal }
      requests.push(request)
      return request.promise
    },
    createObjectUrl: () => 'unused',
    revokeObjectUrl: () => undefined,
  })
  loader.setRequestWidth(640)
  for (let pageNumber = 1; pageNumber <= 6; pageNumber += 1) {
    loader.setRetentionRange(pageNumber, true)
    loader.setLoadRange(pageNumber, true)
  }
  await flushPromises()

  assert.equal(loader.getActiveCount(), 4)
  assert.equal(requests.length, 4)
  loader.setLoadRange(1, false)
  loader.setRetentionRange(1, false)
  assert.equal(requests[0].signal.aborted, true)
  assert.equal(loader.getActiveCount(), 4)
  assert.equal(requests.length, 4)

  requests[0].reject(new DOMException('aborted', 'AbortError'))
  await flushPromises()
  assert.equal(loader.getActiveCount(), 4)
  assert.equal(requests.length, 5)
  loader.dispose()
})

test('404 retries are per-page, delayed, and stop after two attempts', async () => {
  let now = 0
  const timers: Array<{ callback: () => void; delayMs: number; cleared: boolean }> = []
  const requests: Array<ReturnType<typeof deferred<Blob>>> = []
  const loader = new BookPageLoader({
    totalPages: 1,
    loadPage: () => {
      const request = deferred<Blob>()
      requests.push(request)
      return request.promise
    },
    now: () => now,
    random: () => 0,
    setTimer: (callback, delayMs) => {
      const timer = { callback, delayMs, cleared: false }
      timers.push(timer)
      return timer
    },
    clearTimer: (timer) => {
      (timer as (typeof timers)[number]).cleared = true
    },
    createObjectUrl: () => 'unused',
    revokeObjectUrl: () => undefined,
  })
  loader.setRequestWidth(640)
  loader.setRetentionRange(1, true)
  loader.setLoadRange(1, true)
  await flushPromises()

  requests[0].reject({ status: 404 })
  await flushPromises()
  assert.equal(loader.getSnapshot(1).phase, 'retryWaiting')
  assert.equal(timers.at(-1)?.delayMs, 500)

  now = 500
  timers.at(-1)?.callback()
  await flushPromises()
  assert.equal(requests.length, 2)
  requests[1].reject({ status: 404 })
  await flushPromises()
  assert.equal(timers.at(-1)?.delayMs, 1000)

  now = 1500
  timers.at(-1)?.callback()
  await flushPromises()
  assert.equal(requests.length, 3)
  requests[2].reject({ status: 404 })
  await flushPromises()
  assert.equal(loader.getSnapshot(1).phase, 'error')
  loader.dispose()
})

test('retry delay preserves its remaining time outside the load range', async () => {
  let now = 0
  const timers: Array<{ callback: () => void; delayMs: number; cleared: boolean }> = []
  const requests: Array<ReturnType<typeof deferred<Blob>>> = []
  const loader = new BookPageLoader({
    totalPages: 1,
    loadPage: () => {
      const request = deferred<Blob>()
      requests.push(request)
      return request.promise
    },
    now: () => now,
    random: () => 0,
    setTimer: (callback, delayMs) => {
      const timer = { callback, delayMs, cleared: false }
      timers.push(timer)
      return timer
    },
    clearTimer: (timer) => {
      (timer as (typeof timers)[number]).cleared = true
    },
    createObjectUrl: () => 'unused',
    revokeObjectUrl: () => undefined,
  })
  loader.setRequestWidth(640)
  loader.setRetentionRange(1, true)
  loader.setLoadRange(1, true)
  await flushPromises()
  requests[0].reject({ status: 503 })
  await flushPromises()

  const pendingTimer = timers.at(-1)
  now = 200
  loader.setLoadRange(1, false)
  assert.equal(pendingTimer?.cleared, true)
  now = 1000
  pendingTimer?.callback()
  await flushPromises()
  assert.equal(requests.length, 1)

  loader.setLoadRange(1, true)
  await flushPromises()
  assert.equal(requests.length, 1)
  assert.equal(timers.at(-1)?.delayMs, 300)
  now = 1300
  timers.at(-1)?.callback()
  await flushPromises()
  assert.equal(requests.length, 2)
  loader.dispose()
})

test('multiple retrying pages share a single live wake timer', async () => {
  const timers: Array<{ callback: () => void; delayMs: number; cleared: boolean }> = []
  const requests: Array<ReturnType<typeof deferred<Blob>>> = []
  const loader = new BookPageLoader({
    totalPages: 2,
    loadPage: () => {
      const request = deferred<Blob>()
      requests.push(request)
      return request.promise
    },
    now: () => 0,
    random: () => 0,
    setTimer: (callback, delayMs) => {
      const timer = { callback, delayMs, cleared: false }
      timers.push(timer)
      return timer
    },
    clearTimer: (timer) => {
      (timer as (typeof timers)[number]).cleared = true
    },
    createObjectUrl: () => 'unused',
    revokeObjectUrl: () => undefined,
  })
  loader.setRequestWidth(640)
  for (let pageNumber = 1; pageNumber <= 2; pageNumber += 1) {
    loader.setRetentionRange(pageNumber, true)
    loader.setLoadRange(pageNumber, true)
  }
  await flushPromises()
  requests.forEach((request) => request.reject({ status: 503 }))
  await flushPromises()

  assert.equal(timers.filter((timer) => !timer.cleared).length, 1)
  assert.equal(timers.find((timer) => !timer.cleared)?.delayMs, 500)
  loader.dispose()
})

test('resolution upgrades retain the displayed image and revoke only replaced blobs', async () => {
  const requests: Array<ReturnType<typeof deferred<Blob>>> = []
  const revoked: string[] = []
  let nextUrl = 0
  const loader = new BookPageLoader({
    totalPages: 1,
    loadPage: () => {
      const request = deferred<Blob>()
      requests.push(request)
      return request.promise
    },
    createObjectUrl: () => `blob:upgrade-${++nextUrl}`,
    revokeObjectUrl: (url) => revoked.push(url),
  })
  loader.setRequestWidth(640)
  loader.setRetentionRange(1, true)
  loader.setLoadRange(1, true)
  await flushPromises()
  requests[0].resolve(new Blob(['small']))
  await flushPromises()
  const firstCandidate = loader.getSnapshot(1)
  loader.candidateLoaded(1, firstCandidate.candidateGeneration!, firstCandidate.candidateUrl!, 640, 896)
  assert.equal(loader.getSnapshot(1).displayedUrl, 'blob:upgrade-1')

  loader.setRequestWidth(1024)
  await flushPromises()
  assert.equal(loader.getSnapshot(1).displayedUrl, 'blob:upgrade-1')
  assert.equal(loader.getSnapshot(1).isUpgrading, true)
  requests[1].reject({ status: 403 })
  await flushPromises()
  assert.equal(loader.getSnapshot(1).displayedUrl, 'blob:upgrade-1')
  assert.equal(loader.getSnapshot(1).isUpgrading, false)
  assert.deepEqual(revoked, [])

  loader.setRequestWidth(1600)
  await flushPromises()
  requests[2].resolve(new Blob(['large']))
  await flushPromises()
  const secondCandidate = loader.getSnapshot(1)
  assert.equal(secondCandidate.displayedUrl, 'blob:upgrade-1')
  assert.equal(secondCandidate.candidateUrl, 'blob:upgrade-2')
  loader.candidateLoaded(1, secondCandidate.candidateGeneration!, secondCandidate.candidateUrl!, 1024, 1434)
  assert.equal(loader.getSnapshot(1).displayedUrl, 'blob:upgrade-2')
  assert.deepEqual(revoked, ['blob:upgrade-1'])

  loader.dispose()
  assert.deepEqual(revoked, ['blob:upgrade-1', 'blob:upgrade-2'])
})

test('stale candidate generations cannot replace a newer candidate', async () => {
  const requests: Array<ReturnType<typeof deferred<Blob>>> = []
  const revoked: string[] = []
  let nextUrl = 0
  const loader = new BookPageLoader({
    totalPages: 1,
    loadPage: () => {
      const request = deferred<Blob>()
      requests.push(request)
      return request.promise
    },
    createObjectUrl: () => `blob:generation-${++nextUrl}`,
    revokeObjectUrl: (url) => revoked.push(url),
  })
  loader.setRequestWidth(640)
  loader.setRetentionRange(1, true)
  loader.setLoadRange(1, true)
  await flushPromises()
  requests[0].resolve(new Blob(['old']))
  await flushPromises()
  const staleCandidate = loader.getSnapshot(1)

  loader.setLoadRange(1, false)
  loader.setRetentionRange(1, false)
  assert.deepEqual(revoked, ['blob:generation-1'])
  loader.setRetentionRange(1, true)
  loader.setLoadRange(1, true)
  await flushPromises()
  requests[1].resolve(new Blob(['new']))
  await flushPromises()
  const currentCandidate = loader.getSnapshot(1)

  loader.candidateLoaded(1, staleCandidate.candidateGeneration!, staleCandidate.candidateUrl!, 640, 896)
  assert.equal(loader.getSnapshot(1).candidateUrl, currentCandidate.candidateUrl)
  assert.deepEqual(revoked, ['blob:generation-1'])
  loader.candidateLoaded(1, currentCandidate.candidateGeneration!, currentCandidate.candidateUrl!, 640, 896)
  assert.equal(loader.getSnapshot(1).displayedUrl, 'blob:generation-2')
  loader.dispose()
  assert.deepEqual(revoked, ['blob:generation-1', 'blob:generation-2'])
})

test('snapshot identity and object URL ownership remain stable', async () => {
  const request = deferred<Blob>()
  const revoked: string[] = []
  let nextUrl = 0
  const loader = new BookPageLoader({
    totalPages: 1,
    loadPage: () => request.promise,
    createObjectUrl: () => `blob:test-${++nextUrl}`,
    revokeObjectUrl: (url) => revoked.push(url),
  })
  const initial = loader.getSnapshot(1)
  assert.equal(loader.getSnapshot(1), initial)

  loader.setRequestWidth(640)
  loader.setRetentionRange(1, true)
  loader.setLoadRange(1, true)
  const loading = loader.getSnapshot(1)
  assert.notEqual(loading, initial)
  assert.equal(loader.getSnapshot(1), loading)

  request.resolve(new Blob(['image']))
  await flushPromises()
  const decoding = loader.getSnapshot(1)
  assert.equal(decoding.phase, 'decoding')
  assert.equal(decoding.candidateUrl, 'blob:test-1')
  loader.candidateLoaded(1, decoding.candidateGeneration!, decoding.candidateUrl!, 1200, 1800)
  assert.equal(loader.getSnapshot(1).phase, 'loaded')
  assert.equal(loader.getSnapshot(1).aspectRatio, 2 / 3)
  loader.candidateLoaded(1, decoding.candidateGeneration!, decoding.candidateUrl!, 1200, 1800)
  assert.deepEqual(revoked, [])

  loader.setLoadRange(1, false)
  loader.setRetentionRange(1, false)
  assert.deepEqual(revoked, ['blob:test-1'])
  loader.dispose()
  assert.deepEqual(revoked, ['blob:test-1'])
})

test('development remount keeps the loader alive and final detach disposes it', async () => {
  const requests: Array<ReturnType<typeof deferred<Blob>> & { signal: AbortSignal }> = []
  const loader = new BookPageLoader({
    totalPages: 1,
    loadPage: (_pageNumber, _width, signal) => {
      const request = { ...deferred<Blob>(), signal }
      requests.push(request)
      return request.promise
    },
    createObjectUrl: () => 'unused',
    revokeObjectUrl: () => undefined,
  })
  const detachFirstMount = loader.attach()
  detachFirstMount()
  const detachSecondMount = loader.attach()
  await flushPromises()
  loader.setRequestWidth(640)
  loader.setRetentionRange(1, true)
  loader.setLoadRange(1, true)
  await flushPromises()
  assert.equal(requests.length, 1)

  detachSecondMount()
  await flushPromises()
  assert.equal(requests[0].signal.aborted, true)
  assert.equal(loader.getActiveCount(), 1)
  requests[0].reject(new DOMException('aborted', 'AbortError'))
  await flushPromises()
  assert.equal(loader.getActiveCount(), 0)
})
