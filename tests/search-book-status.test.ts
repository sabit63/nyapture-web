import assert from 'node:assert/strict'
import test from 'node:test'

import { mapEBookToCard } from '../src/api/books'
import type { BookDownloadStatus } from '../src/models'
import {
  applySearchBookDownloadStatus,
  getApiBookIdentityKey,
  normalizeSearchBookDownloadStatus,
} from '../src/realtime/search-book-status'

const updatedAt = '2026-09-05T00:00:00.000Z'

const makeCard = (status: 'Downloading' | 'Downloaded' = 'Downloading') => ({
  ...mapEBookToCard({
    groupId: 'group-1',
    bookId: 'book-1',
    url: 'https://hitomi.la/galleries/book-1.html',
    title: 'Test book',
    totalPage: 12,
    status,
  }, { context: 'hitomi' }),
  status,
  thumbnailRequest: {
    method: 'GET' as const,
    path: '/api/web/book/thumbnail',
    query: {},
  },
  thumbnailReloadKey: 'initial',
})

const makeStatus = (overrides: Partial<BookDownloadStatus> = {}): BookDownloadStatus => ({
  book: {
    groupId: 'group-1',
    bookId: 'book-1',
    url: 'https://hitomi.la/galleries/book-1.html',
    totalPage: 12,
    status: 'Downloading',
  },
  executionState: 'Running',
  lastUpdated: updatedAt,
  ...overrides,
})

test('completion normalizes stale embedded Downloading state and reloads the thumbnail', () => {
  const card = makeCard()
  const result = applySearchBookDownloadStatus(
    [card],
    makeStatus({ executionState: 'Completed' }),
    new Map(),
  )

  assert.equal(result.accepted, true)
  assert.equal(result.changed, true)
  assert.equal(result.books[0].status, 'Downloaded')
  assert.equal(result.books[0].thumbnailRequest?.path, '/api/book/page')
  assert.equal(result.books[0].thumbnailReloadKey, `downloaded:${updatedAt}`)
})

test('a completed hub event is normalized even when executionState is missing or stale', () => {
  const stale = makeStatus({ executionState: 'Running' })
  const normalized = normalizeSearchBookDownloadStatus(stale, true)

  assert.equal(normalized.executionState, 'Completed')
  assert.equal(normalized.book?.status, 'Downloaded')
  assert.equal(normalized.book?.groupId, stale.book?.groupId)
  assert.equal(normalized.book?.bookId, stale.book?.bookId)
})

test('completion with the same timestamp as progress is accepted', () => {
  const card = makeCard()
  const versions = new Map<string, number>()
  const progress = applySearchBookDownloadStatus([card], makeStatus(), versions)
  const completion = applySearchBookDownloadStatus(progress.books, makeStatus({ executionState: 'Completed' }), versions)

  assert.equal(progress.accepted, true)
  assert.equal(completion.accepted, true)
  assert.equal(completion.books[0].status, 'Downloaded')
})

test('a same-timestamp nonterminal status cannot regress a downloaded card', () => {
  const card = makeCard('Downloaded')
  const key = getApiBookIdentityKey(card)
  assert.ok(key)
  const versions = new Map([[key, Date.parse(updatedAt)]])
  const result = applySearchBookDownloadStatus(
    [card],
    makeStatus({ executionState: 'Running' }),
    versions,
  )

  assert.equal(result.accepted, false)
  assert.equal(result.changed, false)
  assert.equal(result.books[0], card)
  assert.equal(result.books[0].status, 'Downloaded')
})

test('a later completion updates an existing downloaded card reload key', () => {
  const card = makeCard('Downloaded')
  const nextUpdatedAt = '2026-09-05T00:01:00.000Z'
  const key = getApiBookIdentityKey(card)
  assert.ok(key)
  const versions = new Map([[key, Date.parse(updatedAt)]])
  const result = applySearchBookDownloadStatus(
    [card],
    makeStatus({ executionState: 'Completed', lastUpdated: nextUpdatedAt }),
    versions,
  )

  assert.equal(result.accepted, true)
  assert.equal(result.changed, true)
  assert.equal(result.books[0].status, 'Downloaded')
  assert.equal(result.books[0].thumbnailReloadKey, `downloaded:${nextUpdatedAt}`)
})
