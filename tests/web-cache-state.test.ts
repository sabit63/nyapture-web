import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  buildCacheSearchRequest,
  parseCacheSearch,
  serializeCacheSearch,
  splitCacheIds,
  validateCacheSearch,
  type CacheSearchState,
} from '../src/features/web-cache/search-state'

const state: CacheSearchState = {
  q: '  cats & dogs  ',
  groupIds: ['group/1', 'group 2'],
  bookIds: ['book-1', 'book-2'],
  from: '2024-01-02',
  to: '2024-01-03',
  maxPages: '12',
  page: 3,
  asc: true,
}

describe('Web Book Cache search state', () => {
  it('splits free-form IDs and removes empty duplicate values', () => {
    assert.deepEqual(splitCacheIds(' group/1, group/1\n group 2, book-1 '), [
      'group/1',
      'group 2',
      'book-1',
    ])
  })

  it('round-trips query parameters, including repeated IDs', () => {
    const query = serializeCacheSearch(state)
    const restored = parseCacheSearch(query)

    assert.equal(query.startsWith('?'), true)
    assert.deepEqual(restored, { ...state, q: state.q.trim() })
  })

  it('uses local date boundaries and the fixed server page size', () => {
    const request = buildCacheSearchRequest(state)
    const lower = new Date(2024, 0, 2, 0, 0, 0, 0).toISOString()
    const upper = new Date(2024, 0, 3, 23, 59, 59, 999).toISOString()

    assert.deepEqual(request, {
      keyword: 'cats & dogs',
      groupIds: ['group/1', 'group 2'],
      bookIds: ['book-1', 'book-2'],
      lowerUploadedTime: lower,
      upperUploadedTime: upper,
      maxPageCount: 12,
      page: 3,
      limit: 50,
      isAsc: true,
    })
  })

  it('keeps null date bounds and opaque ID order when building requests', () => {
    const request = buildCacheSearchRequest({
      ...state, from: '', to: '2024-02-30',
      groupIds: ['', ' a ', 'b', ' a ', 'a'], bookIds: ['x', '', 'x', 'y'],
    })
    assert.equal(request.lowerUploadedTime, null)
    assert.equal(request.upperUploadedTime, null)
    assert.deepEqual(request.groupIds, [' a ', 'b', 'a'])
    assert.deepEqual(request.bookIds, ['x', 'y'])
  })

  it('resets malformed URL values to defaults', () => {
    const parsed = parseCacheSearch('?from=2024-02-30&to=nope&maxPages=0&page=-2&asc=1&groupId=&groupId=group%2Cwith%2Ccommas&bookId=a%20b&bookId=b')

    assert.deepEqual(parsed, {
      q: '',
      groupIds: ['group,with,commas'],
      bookIds: ['a b', 'b'],
      from: '',
      to: '',
      maxPages: '',
      page: 1,
      asc: false,
    })

    assert.equal(parseCacheSearch('?from=2024-02-04&to=2024-02-03').from, '')
    assert.equal(parseCacheSearch('?from=2024-02-04&to=2024-02-03').to, '')
  })

  it('reports invalid dates, reversed ranges, and non-positive page limits', () => {
    assert.match(validateCacheSearch({ ...state, from: '2024-02-30' }) ?? '', /有効な日付/)
    assert.match(validateCacheSearch({ ...state, from: '2024-02-04', to: '2024-02-03' }) ?? '', /開始日は終了日以前/)
    assert.match(validateCacheSearch({ ...state, maxPages: '0' }) ?? '', /1以上の整数/)
    assert.equal(validateCacheSearch(state), null)
  })
})
