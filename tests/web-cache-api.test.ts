import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import { ApiError } from '../src/api/client'
import {
  cancelCacheSync,
  deleteCacheBook,
  enqueueCacheBook,
  getCacheBook,
  getCacheConfig,
  getCacheStatus,
  loadCacheThumbnail,
  resetCacheConfig,
  runCacheSync,
  saveCacheConfig,
  searchCache,
  testCacheSite,
  validateCacheConfig,
} from '../src/api/web-cache'

type FetchInput = Parameters<typeof fetch>[1]

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

const setFetch = (handler: (input: RequestInfo | URL, init?: FetchInput) => Promise<Response>) => {
  globalThis.fetch = handler as typeof fetch
}

const jsonResponse = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status,
  headers: { 'Content-Type': 'application/json' },
})

describe('Web Book Cache candidate API', () => {
  it('posts direct search responses and returns them unchanged', async () => {
    let requestUrl = ''
    let requestInit: FetchInput | undefined
    setFetch(async (input, init) => {
      requestUrl = String(input)
      requestInit = init
      return jsonResponse({ success: true, books: [{ groupId: 'g', bookId: 'b', tags: [{ type: 'Artists', name: 'artist', count: 3, displayName: '作家' }] }], totalPage: 1 })
    })

    const response = await searchCache({ keyword: 'foo', groupIds: ['g'], page: 2, limit: 50 })

    assert.equal(response.books?.[0]?.bookId, 'b')
    assert.deepEqual(response.books?.[0]?.tags, [{ type: 'Artists', name: 'artist', count: 3, displayName: '作家' }])
    assert.equal(new URL(requestUrl).pathname, '/api/web-cache/search')
    assert.equal(requestInit?.method, 'POST')
    assert.deepEqual(JSON.parse(String(requestInit?.body)), {
      keyword: 'foo',
      groupIds: ['g'],
      page: 2,
      limit: 50,
    })
  })

  it('unwraps detail responses and escapes each path segment', async () => {
    let requestUrl = ''
    setFetch(async (input) => {
      requestUrl = String(input)
      return jsonResponse({ success: true, data: { groupId: 'group/1', bookId: 'book 1', tags: [{ type: 'Groups', name: 'group', count: 0, displayName: 'サークル' }] } })
    })

    const book = await getCacheBook('group/1', 'book 1')

    assert.equal(book.groupId, 'group/1')
    assert.deepEqual(book.tags, [{ type: 'Groups', name: 'group', count: 0, displayName: 'サークル' }])
    assert.equal(new URL(requestUrl).pathname, '/api/web-cache/group%2F1/book%201')
  })

  it('uses POST for enqueue and DELETE for cache removal', async () => {
    const requests: { pathname: string; method: string }[] = []
    setFetch(async (input, init) => {
      const url = new URL(String(input))
      requests.push({ pathname: url.pathname, method: init?.method ?? 'GET' })
      return jsonResponse({ success: true })
    })

    await enqueueCacheBook('g/1', 'b 1')
    await deleteCacheBook('g/1', 'b 1')

    assert.deepEqual(requests, [
      { pathname: '/api/web-cache/g%2F1/b%201/download', method: 'POST' },
      { pathname: '/api/web-cache/g%2F1/b%201', method: 'DELETE' },
    ])
  })

  it('requests thumbnails as image blobs with escaped identifiers', async () => {
    let requestUrl = ''
    let accept = ''
    setFetch(async (input, init) => {
      requestUrl = String(input)
      accept = new Headers(init?.headers).get('Accept') ?? ''
      return new Response('image-bytes', { status: 200, headers: { 'Content-Type': 'image/png' } })
    })

    const blob = await loadCacheThumbnail('group/1', 'book 1')

    assert.equal(blob.type, 'image/png')
    assert.equal(accept, 'image/*')
    assert.equal(new URL(requestUrl).pathname, '/api/web-cache/group%2F1/book%201/thumbnail')
  })

  it('unwraps management envelopes and sends documented bodies', async () => {
    const requests: { pathname: string; method: string; body?: unknown }[] = []
    setFetch(async (input, init) => {
      const url = new URL(String(input))
      requests.push({
        pathname: url.pathname,
        method: init?.method ?? 'GET',
        body: init?.body === undefined ? undefined : JSON.parse(String(init.body)),
      })
      if (url.pathname.endsWith('/config')) {
        return jsonResponse({ success: true, data: { config: { enabled: true }, hasRuntimeOverride: true } })
      }
      if (url.pathname.endsWith('/validate')) return jsonResponse({ success: true, data: { isValid: true, errors: [] } })
      if (url.pathname.endsWith('/status')) return jsonResponse({ success: true, data: { isRunning: false } })
      if (url.pathname.endsWith('/sync/run')) return jsonResponse({ success: true, data: { started: true } })
      return jsonResponse({ success: true })
    })

    const config = {
      enabled: true,
      intervalMinutes: 60,
      initialLookbackDays: 7,
      maxPagesPerRun: 10,
      maxDetailsPerRun: 100,
      sites: [],
      autoDownload: {
        enabled: false,
        conditionMode: 'All',
        maxPageCount: 100,
        maxAutoDownloadsPerRun: 10,
        maxAutoDownloadsPerDay: 100,
        minFreeDiskGb: 1,
        allowedGroupIds: [],
        excludedTags: [],
      },
    }
    assert.deepEqual(await getCacheConfig(), { config: { enabled: true }, hasRuntimeOverride: true })
    assert.deepEqual(await validateCacheConfig(config), { isValid: true, errors: [] })
    assert.deepEqual(await saveCacheConfig(config), { config: { enabled: true }, hasRuntimeOverride: true })
    assert.deepEqual(await getCacheStatus(), { isRunning: false })
    assert.deepEqual(await runCacheSync({ groupId: undefined, force: true }), { started: true })
    await resetCacheConfig()
    await cancelCacheSync()

    assert.deepEqual(requests.map(({ pathname, method }) => ({ pathname, method })), [
      { pathname: '/api/dashboard/web-cache/config', method: 'GET' },
      { pathname: '/api/dashboard/web-cache/config/validate', method: 'POST' },
      { pathname: '/api/dashboard/web-cache/config', method: 'PATCH' },
      { pathname: '/api/dashboard/web-cache/status', method: 'GET' },
      { pathname: '/api/dashboard/web-cache/sync/run', method: 'POST' },
      { pathname: '/api/dashboard/web-cache/config/reset', method: 'POST' },
      { pathname: '/api/dashboard/web-cache/sync/cancel', method: 'POST' },
    ])
    assert.deepEqual(requests[1]?.body, config)
    assert.deepEqual(requests[2]?.body, config)
    assert.deepEqual(requests[4]?.body, { groupId: null, force: true })
  })

  it('treats direct, envelope, and nested application failures as errors', async () => {
    setFetch(async (input) => {
      const pathname = new URL(String(input)).pathname
      if (pathname.endsWith('/search')) return jsonResponse({ success: false, message: 'search failed' })
      return jsonResponse({ success: true, data: { success: false, message: 'site failed' } })
    })

    await assert.rejects(searchCache({}), (error: unknown) => (
      error instanceof ApiError && error.message === 'search failed'
    ))
    await assert.rejects(testCacheSite('group/1'), (error: unknown) => (
      error instanceof ApiError && error.message === 'site failed'
    ))
  })
})

it('preserves validation messages on an HTTP 200 application failure', async () => {
  setFetch(async () => jsonResponse({ success: false, message: 'invalid settings', data: { errors: ['first error', 'second error'] } }))
  await assert.rejects(getCacheConfig(), (error: unknown) => {
    assert.ok(error instanceof ApiError)
    assert.equal(error.message, 'invalid settings')
    assert.deepEqual(error.validationErrors, ['first error', 'second error'])
    return true
  })
})
