import assert from 'node:assert/strict'
import test from 'node:test'

import {
  applyContinuousSearchParams,
  filterReadableBooks,
  getMountedWindowIndices,
  isReadableBook,
  parseSearchStartIdentity,
  parseSearchViewMode,
  parseSearchViewState,
  removeContinuousSearchParams,
  resolveContinuousStart,
  resolveHorizontalSwipe,
  resolveHorizontalWheelSwipe,
  type SearchContinuousBook,
} from '../src/features/search/search-continuous-utils'

const readable = (overrides: Partial<SearchContinuousBook> = {}): SearchContinuousBook => ({
  status: 'Downloaded',
  apiGroupId: 'group-1',
  apiBookId: 'book-1',
  totalPage: 3,
  ...overrides,
})

test('library continuous URLs parse mode and a trimmed complete start identity', () => {
  const params = new URLSearchParams('view=continuous&gid=+group-1+&id=book-1')

  assert.equal(parseSearchViewMode(params, true), 'continuous')
  assert.deepEqual(parseSearchStartIdentity(params, true), {
    groupId: 'group-1',
    bookId: 'book-1',
  })
  assert.deepEqual(parseSearchViewState(params, true), {
    view: 'continuous',
    start: { groupId: 'group-1', bookId: 'book-1' },
  })
})

test('continuous mode and its identity are ignored outside library search', () => {
  const params = new URLSearchParams('view=continuous&gid=group-1&id=book-1')

  assert.equal(parseSearchViewMode(params, false), 'grid')
  assert.equal(parseSearchStartIdentity(params, false), null)
  assert.deepEqual(parseSearchViewState(params, false), { view: 'grid', start: null })
})

test('unknown, missing, and malformed view values fall back to grid', () => {
  for (const value of [undefined, '', 'grid', 'reader', 'Continuous', 'continuous ']) {
    const params = new URLSearchParams()
    if (value !== undefined) params.set('view', value)
    assert.equal(parseSearchViewMode(params, true), 'grid', value ?? 'missing')
    assert.equal(parseSearchStartIdentity(params, true), null)
  }
})

test('partial or blank start identities are ignored even in continuous mode', () => {
  for (const query of [
    'view=continuous',
    'view=continuous&gid=group-1',
    'view=continuous&id=book-1',
    'view=continuous&gid=+&id=book-1',
    'view=continuous&gid=group-1&id=+',
  ]) {
    const params = new URLSearchParams(query)
    assert.equal(parseSearchStartIdentity(params, true), null, query)
  }
})

test('applying continuous params clones the URL, preserves other params, and replaces identity', () => {
  const original = new URL('https://example.test/search?q=cats&view=grid&gid=old-group&id=old-book')
  const next = applyContinuousSearchParams(original, { groupId: ' group-2 ', bookId: ' book-2 ' })

  assert.equal(original.search, '?q=cats&view=grid&gid=old-group&id=old-book')
  assert.equal(next.searchParams.get('q'), 'cats')
  assert.equal(next.searchParams.get('view'), 'continuous')
  assert.equal(next.searchParams.get('gid'), 'group-2')
  assert.equal(next.searchParams.get('id'), 'book-2')
})

test('applying without a complete identity clears stale gid/id while keeping continuous mode', () => {
  const original = new URL('https://example.test/search?view=grid&gid=old-group&id=old-book')

  for (const identity of [undefined, null, { groupId: 'group-1', bookId: '' }]) {
    const next = applyContinuousSearchParams(original, identity)
    assert.equal(next.searchParams.get('view'), 'continuous')
    assert.equal(next.searchParams.has('gid'), false)
    assert.equal(next.searchParams.has('id'), false)
  }
})

test('removing continuous params clones URL and leaves unrelated state intact', () => {
  const original = new URL('https://example.test/search?q=cats&view=continuous&gid=group-1&id=book-1')
  const next = removeContinuousSearchParams(original)

  assert.equal(original.searchParams.get('view'), 'continuous')
  assert.equal(next.href, 'https://example.test/search?q=cats')
})

test('readable-book predicate accepts only downloaded books with valid IDs and page bounds', () => {
  const accepted = [
    readable(),
    readable({ totalPage: 1 }),
    readable({ totalPage: 10_000 }),
    readable({ apiGroupId: ' group-1 ', apiBookId: ' book-1 ' }),
  ]
  accepted.forEach((book) => assert.equal(isReadableBook(book), true))

  const rejected: SearchContinuousBook[] = [
    readable({ status: 'Downloading' }),
    readable({ status: 'Unknown' }),
    readable({ apiGroupId: undefined }),
    readable({ apiGroupId: '   ' }),
    readable({ apiBookId: undefined }),
    readable({ apiBookId: '  ' }),
    readable({ totalPage: 0 }),
    readable({ totalPage: -1 }),
    readable({ totalPage: 10_001 }),
    readable({ totalPage: 1.5 }),
    readable({ totalPage: Number.NaN }),
    readable({ totalPage: Number.POSITIVE_INFINITY }),
  ]
  rejected.forEach((book) => assert.equal(isReadableBook(book), false))
})

test('filterReadableBooks preserves order and returns only readable books', () => {
  const books = [
    readable({ apiBookId: 'first' }),
    readable({ status: 'Downloading', apiBookId: 'skip-status' }),
    readable({ totalPage: 10_001, apiBookId: 'skip-pages' }),
    readable({ apiBookId: 'last' }),
  ]

  assert.deepEqual(filterReadableBooks(books).map((book) => book.apiBookId), ['first', 'last'])
})

test('resolveContinuousStart filters the sequence and starts at a matching readable identity', () => {
  const books = [
    readable({ apiGroupId: 'g-1', apiBookId: 'b-1' }),
    readable({ status: 'Downloading', apiGroupId: 'g-1', apiBookId: 'not-readable' }),
    readable({ apiGroupId: 'g-2', apiBookId: 'b-2' }),
  ]
  const result = resolveContinuousStart(books, { groupId: 'g-2', bookId: 'b-2' })

  assert.deepEqual(result.sequence.map((book) => book.apiBookId), ['b-1', 'b-2'])
  assert.equal(result.startIndex, 1)
})

test('resolveContinuousStart falls back to the first readable book for absent, malformed, or missing identities', () => {
  const books = [
    readable({ apiGroupId: 'g-1', apiBookId: 'b-1' }),
    readable({ apiGroupId: 'g-2', apiBookId: 'b-2' }),
  ]

  for (const identity of [
    undefined,
    null,
    { groupId: '', bookId: 'b-2' },
    { groupId: 'g-2', bookId: 'missing' },
  ]) {
    assert.equal(resolveContinuousStart(books, identity).startIndex, 0)
  }
})

test('resolveContinuousStart reports no start for an empty readable sequence', () => {
  const result = resolveContinuousStart([
    readable({ status: 'Downloading' }),
    readable({ totalPage: 0 }),
  ], { groupId: 'g-1', bookId: 'b-1' })

  assert.deepEqual(result, { sequence: [], startIndex: -1 })
})

test('mounted window contains current neighbors and clamps/deduplicates at sequence edges', () => {
  assert.deepEqual(getMountedWindowIndices(2, 5), [1, 2, 3])
  assert.deepEqual(getMountedWindowIndices(0, 5), [0, 1])
  assert.deepEqual(getMountedWindowIndices(4, 5), [3, 4])
  assert.deepEqual(getMountedWindowIndices(-4, 2), [0, 1])
  assert.deepEqual(getMountedWindowIndices(99, 2), [0, 1])
  assert.deepEqual(getMountedWindowIndices(Number.NaN, 2), [0, 1])
  assert.deepEqual(getMountedWindowIndices(0, 1), [0])
})

test('mounted window handles empty, non-positive, and non-integer sequence lengths safely', () => {
  for (const length of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.deepEqual(getMountedWindowIndices(0, length), [], String(length))
  }
  assert.deepEqual(getMountedWindowIndices(1.9, 5), [0, 1, 2])
})

test('horizontal swipe maps left to next and right to previous', () => {
  assert.equal(resolveHorizontalSwipe({ startX: 200, startY: 100, endX: 100, endY: 108 }), 'next')
  assert.equal(resolveHorizontalSwipe({ startX: 100, startY: 100, endX: 200, endY: 92 }), 'previous')
})

test('horizontal swipe ignores short, vertical, ambiguous, and invalid movement', () => {
  assert.equal(resolveHorizontalSwipe({ startX: 100, startY: 100, endX: 50, endY: 100 }), null)
  assert.equal(resolveHorizontalSwipe({ startX: 100, startY: 100, endX: 110, endY: 200 }), null)
  assert.equal(resolveHorizontalSwipe({ startX: 100, startY: 100, endX: 160, endY: 150 }), null)
  assert.equal(resolveHorizontalSwipe({ startX: Number.NaN, startY: 100, endX: 0, endY: 100 }), null)
})

test('trackpad horizontal scroll maps positive to next and negative to previous', () => {
  assert.equal(resolveHorizontalWheelSwipe(100, 8), 'next')
  assert.equal(resolveHorizontalWheelSwipe(-100, -8), 'previous')
})

test('trackpad swipe ignores short, vertical, ambiguous, and invalid deltas', () => {
  assert.equal(resolveHorizontalWheelSwipe(70, 0), null)
  assert.equal(resolveHorizontalWheelSwipe(20, 100), null)
  assert.equal(resolveHorizontalWheelSwipe(100, 80), null)
  assert.equal(resolveHorizontalWheelSwipe(Number.NaN, 0), null)
})
