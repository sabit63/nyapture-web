import assert from 'node:assert/strict'
import test from 'node:test'
import type { BookDownloadStatus } from '../src/models'
import {
  createEmptyDownloadProjection,
  forgetDownloadAttempt,
  projectDownloadSnapshot,
  reduceDownloadStatus,
  sortDownloads,
  type DownloadSort,
  type DownloadProjection,
} from '../src/features/downloads/download-state'

const makeStatus = (
  executionState: BookDownloadStatus['executionState'],
  currentPage: number,
  lastUpdated?: string,
  overrides: Partial<BookDownloadStatus> = {},
): BookDownloadStatus => ({
  book: {
    groupId: 'group-1',
    bookId: 'book-1',
    url: 'https://example.test/books/book-1',
    title: 'Example book',
    totalPage: 10,
  },
  executionState,
  currentPage,
  completedPages: currentPage,
  lastUpdated,
  ...overrides,
})

const project = (status: BookDownloadStatus): DownloadProjection => (
  projectDownloadSnapshot(createEmptyDownloadProjection(), { current: status }, { authoritative: true })
)

test('running downloads stay first and stable while only other downloads follow the selected sort', () => {
  const base = project(makeStatus('Running', 2)).downloads[0]!
  const downloads = [
    { ...base, id: 'queued', status: 'queued' as const, title: 'B', priority: 0, progress: 90, addedAt: '2026-09-03' },
    { ...base, id: 'running-first', title: 'Z', priority: 2, progress: 1, addedAt: '2026-09-01' },
    { ...base, id: 'paused', status: 'paused' as const, title: 'A', priority: 1, progress: 80, addedAt: '2026-09-04' },
    { ...base, id: 'running-second', title: 'A', priority: 0, progress: 99, addedAt: '2026-09-05' },
  ]
  const original = downloads.map(({ id }) => id)
  const expected: Record<DownloadSort, string[]> = {
    priority: ['queued', 'paused'],
    progress: ['queued', 'paused'],
    added: ['paused', 'queued'],
    title: ['paused', 'queued'],
  }
  for (const sort of Object.keys(expected) as DownloadSort[]) {
    assert.deepEqual(sortDownloads(downloads, sort).map(({ id }) => id), [
      'running-first', 'running-second', ...expected[sort],
    ])
  }
  assert.deepEqual(downloads.map(({ id }) => id), original)
})

test('snapshot projection is repeatable and never mutates the input record or maps', () => {
  const statuses = {
    current: makeStatus('Running', 2, '2026-09-05T00:00:00.000Z'),
  }
  const before = JSON.stringify(statuses)

  const first = projectDownloadSnapshot(createEmptyDownloadProjection(), statuses, { authoritative: true })
  const second = projectDownloadSnapshot(createEmptyDownloadProjection(), statuses, { authoritative: true })

  assert.equal(JSON.stringify(statuses), before)
  assert.deepEqual(second.downloads, first.downloads)
  assert.deepEqual([...second.statuses.entries()], [...first.statuses.entries()])
  assert.deepEqual([...second.terminalDownloads.entries()], [...first.terminalDownloads.entries()])
  assert.notEqual(first.statuses, second.statuses)
  assert.notEqual(first.terminalDownloads, second.terminalDownloads)
})

test('duplicate snapshot entries use timestamp/page ordering regardless of input order', () => {
  const older = makeStatus('Running', 2, '2026-09-05T00:00:00.000Z')
  const newer = makeStatus('Running', 5, '2026-09-05T00:01:00.000Z')
  const projection = projectDownloadSnapshot(
    createEmptyDownloadProjection(),
    { newer, older },
    { authoritative: true },
  )

  assert.equal(projection.downloads[0]?.completedPages, 5)
  assert.equal(projection.statuses.get('group-1/book-1')?.currentPage, 5)
})

test('same-timestamp status changes are accepted while exact duplicates are harmless', () => {
  const running = makeStatus('Running', 3, '2026-09-05T00:00:00.000Z')
  const failed = makeStatus('Failed', 3, '2026-09-05T00:00:00.000Z', { errorMessage: 'failed' })
  const runningProjection = project(running)
  const failedProjection = projectDownloadSnapshot(runningProjection, { current: failed })

  assert.equal(failedProjection.downloads[0]?.status, 'failed')
  assert.equal(failedProjection.downloads[0]?.errorMessage, 'failed')
  const duplicate = projectDownloadSnapshot(failedProjection, { current: failed })
  assert.deepEqual(duplicate.downloads, failedProjection.downloads)
})

test('reverse realtime progress and delayed progress after completion are rejected', () => {
  const running = makeStatus('Running', 4, '2026-09-05T00:04:00.000Z')
  const completed = makeStatus('Completed', 10, '2026-09-05T00:10:00.000Z')
  const lateProgress = makeStatus('Running', 4, '2026-09-05T00:04:00.000Z')

  const runningProjection = project(running)
  const reverse = reduceDownloadStatus(runningProjection, makeStatus('Running', 2, '2026-09-05T00:02:00.000Z'))
  assert.equal(reverse.accepted, false)
  assert.equal(reverse.projection.downloads[0]?.completedPages, 4)

  const completedProjection = reduceDownloadStatus(runningProjection, completed).projection
  const delayed = reduceDownloadStatus(completedProjection, lateProgress)
  assert.equal(delayed.accepted, false)
  assert.equal(delayed.projection.downloads.length, 0)
})

test('missing-timestamp regressive terminal events request one REST reconciliation', () => {
  const runningProjection = project(makeStatus('Running', 8, '2026-09-05T00:08:00.000Z'))
  const first = reduceDownloadStatus(runningProjection, makeStatus('Failed', 1))
  const second = reduceDownloadStatus(runningProjection, makeStatus('Failed', 1))

  assert.equal(first.accepted, false)
  assert.equal(first.needsReconciliation, true)
  assert.equal(second.needsReconciliation, true)
  assert.equal(first.projection.downloads[0]?.status, 'running')
})

test('timestamp-less progress after a terminal event waits for REST unless retry cleared the attempt', () => {
  const completedProjection = project(makeStatus('Completed', 10, '2026-09-05T00:10:00.000Z'))
  const delayedProgress = reduceDownloadStatus(completedProjection, makeStatus('Running', 0))

  assert.equal(delayedProgress.accepted, false)
  assert.equal(delayedProgress.needsReconciliation, true)
  assert.equal(delayedProgress.projection.downloads.length, 0)

  const retried = reduceDownloadStatus(
    forgetDownloadAttempt(completedProjection, 'group-1/book-1'),
    makeStatus('Queued', 0),
  )
  assert.equal(retried.accepted, true)
  assert.equal(retried.needsReconciliation, false)
  assert.equal(retried.projection.downloads[0]?.status, 'queued')
})

test('authoritative snapshots remove omitted terminal entries so retry can create a fresh attempt', () => {
  const failedProjection = project(makeStatus('Failed', 10, '2026-09-05T00:10:00.000Z'))
  assert.equal(failedProjection.downloads[0]?.status, 'failed')

  const authoritativeEmpty = projectDownloadSnapshot(
    failedProjection,
    {},
    { authoritative: true },
  )
  assert.equal(authoritativeEmpty.downloads.length, 0)
  assert.equal(authoritativeEmpty.statuses.size, 0)
  assert.equal(authoritativeEmpty.terminalDownloads.size, 0)

  const forgotten = forgetDownloadAttempt(failedProjection, 'group-1/book-1')
  const retried = reduceDownloadStatus(forgotten, makeStatus('Queued', 0))
  assert.equal(retried.accepted, true)
  assert.equal(retried.projection.downloads[0]?.status, 'queued')
})
