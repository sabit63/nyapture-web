import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import { configureApi, getApiSettings } from '../src/api/client'
import { BookTagSaveError, getBookTagChanges, normalizeDraftTags, saveBookTagChanges, tagKey } from '../src/features/viewer/book-tag-editing'
import type { BookTag } from '../src/models'

const originalFetch = globalThis.fetch
const originalApiSettings = getApiSettings()

afterEach(() => {
  globalThis.fetch = originalFetch
  configureApi(originalApiSettings)
})

const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json' },
})

const bookResponse = (tagSet: Record<string, string[]>, success = true) => jsonResponse({
  success,
  books: [{ groupId: 'g', bookId: 'b', title: 'Book', totalPage: 1, tagSet }],
})

const tag = (type: BookTag['type'], name: string, metadata: Partial<BookTag> = {}): BookTag => ({
  type,
  name,
  ...metadata,
})

describe('book tag editing', () => {
  it('creates stable keys and trims, drops, and deduplicates draft tags', () => {
    const first = tag('Artists', '  Alice  ', { displayName: '作家', count: 4 })
    const duplicate = tag('Artists', 'Alice', { displayName: '重複', count: 1 })
    const normalized = normalizeDraftTags([first, tag('Tags', '   '), duplicate, tag('Groups', 'Circle')])

    assert.equal(tagKey({ type: 'Artists', name: 'Alice' }), 'Artists\u0000Alice')
    assert.deepEqual(normalized, [
      tag('Artists', 'Alice', { displayName: '作家', count: 4 }),
      tag('Groups', 'Circle'),
    ])
  })

  it('diffs in tag type order while preserving add and remove order', () => {
    const baseline = [tag('Tags', 'old-1'), tag('Artists', 'artist'), tag('Tags', 'old-2')]
    const draft = [tag('Tags', 'new-1'), tag('Artists', 'artist'), tag('Tags', 'new-2')]

    assert.deepEqual(getBookTagChanges(baseline, draft), [
      { type: 'Artists', add: [], remove: [] },
      { type: 'Tags', add: ['new-1', 'new-2'], remove: ['old-1', 'old-2'] },
    ].filter((change) => change.add.length || change.remove.length))
  })

  it('runs all additions in order, then removals, and fetches final state', async () => {
    configureApi({ ...originalApiSettings, editKey: 'edit-key' })
    const requests: Array<{ method: string; path: string; body?: unknown }> = []
    globalThis.fetch = (async (input, init) => {
      const url = new URL(String(input))
      const body = init?.body === undefined ? undefined : JSON.parse(String(init.body))
      requests.push({ method: init?.method ?? 'GET', path: url.pathname, body })
      if (init?.method === 'GET') return bookResponse({ Artists: ['artist'], Groups: ['circle'], Tags: ['new'] })
      return jsonResponse({ success: true })
    }) as typeof fetch

    const result = await saveBookTagChanges(
      'g',
      'b',
      [tag('Tags', 'old')],
      [tag('Groups', 'circle'), tag('Artists', 'artist'), tag('Tags', 'new')],
    )

    assert.deepEqual(requests.map(({ method, body }) => ({ method, body })), [
      { method: 'POST', body: { tagType: 'Artists', tags: ['artist'] } },
      { method: 'POST', body: { tagType: 'Groups', tags: ['circle'] } },
      { method: 'POST', body: { tagType: 'Tags', tags: ['new'] } },
      { method: 'DELETE', body: { tagType: 'Tags', tags: ['old'] } },
      { method: 'GET', body: undefined },
    ])
    assert.deepEqual(result.tags.map(({ type, name }) => ({ type, name })), [
      { type: 'Artists', name: 'artist' },
      { type: 'Groups', name: 'circle' },
      { type: 'Tags', name: 'new' },
    ])
  })

  it('returns latest state after a partial mutation failure for rebasing', async () => {
    configureApi({ ...originalApiSettings, editKey: 'edit-key' })
    const requests: string[] = []
    let postCount = 0
    globalThis.fetch = (async (input, init) => {
      const method = init?.method ?? 'GET'
      requests.push(method)
      if (method === 'POST') {
        postCount += 1
        return postCount === 1 ? jsonResponse({ success: true }) : jsonResponse({ success: false, message: 'second failed' })
      }
      return bookResponse({ Artists: ['first'] })
    }) as typeof fetch

    await assert.rejects(
      saveBookTagChanges('g', 'b', [], [tag('Artists', 'first'), tag('Groups', 'second')]),
      (error: unknown) => {
        assert.ok(error instanceof BookTagSaveError)
        assert.equal(error.message, 'second failed')
        assert.deepEqual(error.latestBook?.tags.map(({ name }) => name), ['first'])
      return true
      },
    )
    assert.deepEqual(requests, ['POST', 'POST', 'GET'])
  })

  it('does not issue a recovery fetch after an aborted mutation', async () => {
    configureApi({ ...originalApiSettings, editKey: 'edit-key' })
    const caller = new AbortController()
    let requestCount = 0
    globalThis.fetch = (async () => {
      requestCount += 1
      caller.abort()
      throw new Error('aborted')
    }) as typeof fetch

    await assert.rejects(
      saveBookTagChanges('g', 'b', [], [tag('Artists', 'artist')], caller.signal),
      (error: unknown) => error instanceof BookTagSaveError,
    )
    assert.equal(requestCount, 1)
  })

  it('keeps latestBook undefined when recovery fetch fails and wraps final fetch failures', async () => {
    configureApi({ ...originalApiSettings, editKey: 'edit-key' })
    let requestCount = 0
    globalThis.fetch = (async (_input, init) => {
      requestCount += 1
      if (init?.method === 'POST') return jsonResponse({ success: true })
      return jsonResponse({ success: false, message: 'state unavailable' })
    }) as typeof fetch

    await assert.rejects(
      saveBookTagChanges('g', 'b', [], [tag('Artists', 'artist')]),
      (error: unknown) => {
        assert.ok(error instanceof BookTagSaveError)
        assert.equal(error.latestBook, undefined)
        assert.match(error.message, /state unavailable/)
        assert.ok(error.cause instanceof Error)
        return true
      },
    )
    assert.equal(requestCount, 3)
  })

  it('retries from recovered state and sends only the remaining diff', async () => {
    configureApi({ ...originalApiSettings, editKey: 'edit-key' })
    let firstSave = true
    const requests: Array<{ method: string; body?: { tagType?: string; tags?: string[] } }> = []
    globalThis.fetch = (async (_input, init) => {
      const method = init?.method ?? 'GET'
      const body = init?.body === undefined ? undefined : JSON.parse(String(init.body))
      requests.push({ method, body })
      if (method === 'POST' && firstSave) {
        firstSave = false
        return jsonResponse({ success: false, message: 'partial' })
      }
      return method === 'GET' ? bookResponse({ Artists: ['first'] }) : jsonResponse({ success: true })
    }) as typeof fetch

    const baseline = [tag('Artists', 'first')]
    const draft = [tag('Artists', 'first'), tag('Artists', 'second')]
    await assert.rejects(saveBookTagChanges('g', 'b', [], draft), BookTagSaveError)
    await saveBookTagChanges('g', 'b', baseline, draft)

    assert.deepEqual(requests.map(({ method, body }) => ({ method, body })), [
      { method: 'POST', body: { tagType: 'Artists', tags: ['first', 'second'] } },
      { method: 'GET', body: undefined },
      { method: 'POST', body: { tagType: 'Artists', tags: ['second'] } },
      { method: 'GET', body: undefined },
    ])
  })
})
