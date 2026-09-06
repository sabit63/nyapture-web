import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { ApiError } from '../src/api/client'
import {
  createBookDeletionRunner,
  deleteBooksWithConcurrency,
  type BookDeletionRunnerDependencies,
} from '../src/features/library/book-deletion'
import type { BookDeletionJob, BookDeletionJobStatus } from '../src/models'
import { deferred } from './helpers/react-hook'

const target = (id = 'book-1') => ({ apiGroupId: 'group-1', apiBookId: id })

const deletionJob = (status: BookDeletionJobStatus): BookDeletionJob => ({
  jobId: 'job-1',
  groupId: 'group-1',
  bookId: 'book-1',
  disposition: 'Physical',
  status,
  createdAtUtc: '2026-09-06T00:00:00Z',
  startedAtUtc: null,
  completedAtUtc: null,
  failureMessage: null,
  statusUrl: '/api/book/deletion-jobs/job-1',
})

const createDependencies = (
  overrides: Partial<BookDeletionRunnerDependencies> = {},
): BookDeletionRunnerDependencies => ({
  enqueue: async () => ({
    body: { success: true, data: deletionJob('Pending') },
    status: 202,
  }),
  getJob: async () => ({ success: true, data: deletionJob('Succeeded') }),
  getBook: async () => ({ success: true, books: [] }),
  wait: async () => undefined,
  now: () => 0,
  ...overrides,
})

describe('book deletion runner', () => {
  it('retries transient enqueue failures three times using Retry-After then 2/4 second backoff', async () => {
    let enqueueCalls = 0
    const waits: number[] = []
    const runner = createBookDeletionRunner(createDependencies({
      enqueue: async () => {
        enqueueCalls += 1
        if (enqueueCalls === 1) throw new ApiError('full', { status: 503, retryAfterSeconds: 3 })
        if (enqueueCalls === 2) throw new ApiError('timeout', { category: 'timeout' })
        if (enqueueCalls === 3) throw new ApiError('server', { status: 500 })
        return { body: { success: true, data: deletionJob('Succeeded') }, status: 202 }
      },
      wait: async (delayMs) => { waits.push(delayMs) },
    }))

    assert.deepEqual(await runner(target()), { status: 'succeeded' })
    assert.equal(enqueueCalls, 4)
    assert.deepEqual(waits, [3000, 2000, 4000])
  })

  it('fails after the fourth enqueue attempt without contacting a real API', async () => {
    let enqueueCalls = 0
    const waits: number[] = []
    const runner = createBookDeletionRunner(createDependencies({
      enqueue: async () => {
        enqueueCalls += 1
        throw new ApiError('offline', { category: 'offline' })
      },
      wait: async (delayMs) => { waits.push(delayMs) },
    }))

    assert.equal((await runner(target())).status, 'failed')
    assert.equal(enqueueCalls, 4)
    assert.deepEqual(waits, [1000, 2000, 4000])
  })

  it('honors initial Retry-After and slows polling after thirty seconds', async () => {
    let now = 0
    let polls = 0
    const waits: number[] = []
    const runner = createBookDeletionRunner(createDependencies({
      enqueue: async () => ({
        body: { success: true, data: deletionJob('Pending') },
        status: 202,
        retryAfterSeconds: 2,
      }),
      getJob: async () => {
        polls += 1
        return { success: true, data: deletionJob(polls > 30 ? 'Succeeded' : 'Running') }
      },
      wait: async (delayMs) => {
        waits.push(delayMs)
        now += delayMs
      },
      now: () => now,
    }))

    assert.deepEqual(await runner(target()), { status: 'succeeded' })
    assert.equal(waits[0], 2000)
    assert.ok(waits.includes(5000))
    assert.equal(waits.at(-1), 5000)
  })

  it('reconciles a missing job as success when the Book is also missing', async () => {
    let bookChecks = 0
    const runner = createBookDeletionRunner(createDependencies({
      getJob: async () => { throw new ApiError('missing job', { status: 404 }) },
      getBook: async () => {
        bookChecks += 1
        throw new ApiError('missing book', { status: 404 })
      },
    }))

    assert.deepEqual(await runner(target()), { status: 'succeeded' })
    assert.equal(bookChecks, 1)
  })

  it('reconciles a missing job as failure when the Book remains', async () => {
    const runner = createBookDeletionRunner(createDependencies({
      getJob: async () => { throw new ApiError('missing job', { status: 404 }) },
      getBook: async () => ({ success: true, books: [{ groupId: 'group-1', bookId: 'book-1' }] }),
    }))

    const result = await runner(target())
    assert.equal(result.status, 'failed')
    assert.match(result.message ?? '', /Bookが残っています/)
  })
})

it('limits a deletion batch to three active items and settles each item immediately', async () => {
  const gates = Array.from({ length: 5 }, () => deferred<void>())
  const started: number[] = []
  const settled: number[] = []
  let active = 0
  let maximumActive = 0
  const books = gates.map((_, index) => target(`book-${index}`))

  const batch = deleteBooksWithConcurrency(books, {
    concurrency: 99,
    deleteOne: async (_book, _signal) => {
      const index = started.length
      started.push(index)
      active += 1
      maximumActive = Math.max(maximumActive, active)
      await gates[index].promise
      active -= 1
      return { status: 'succeeded' }
    },
    onSettled: (_book, _outcome, index) => { settled.push(index) },
  })

  await Promise.resolve()
  assert.deepEqual(started, [0, 1, 2])
  gates[1].resolve()
  await new Promise<void>((resolve) => setImmediate(resolve))
  assert.deepEqual(settled, [1])
  assert.equal(started.length, 4)

  gates[0].resolve()
  gates[2].resolve()
  await new Promise<void>((resolve) => setImmediate(resolve))
  gates[3].resolve()
  gates[4].resolve()

  assert.equal((await batch).length, 5)
  assert.equal(maximumActive, 3)
  assert.equal(settled.length, 5)
})
