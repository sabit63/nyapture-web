import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import { configureApi, getApiSettings } from '../src/api/client'
import { addBookTags, removeBookTags } from '../src/api/book-tags'

type FetchInput = Parameters<typeof fetch>[1]

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

describe('book tag endpoints', () => {
  it('encodes book identifiers and sends the edit-authenticated POST body', async () => {
    configureApi({ ...originalApiSettings, editKey: 'edit-key' })
    let requestUrl = ''
    let requestInit: FetchInput | undefined
    globalThis.fetch = (async (input, init) => {
      requestUrl = String(input)
      requestInit = init
      return jsonResponse({ success: true })
    }) as typeof fetch

    assert.deepEqual(await addBookTags('group/1', 'book 日本語/1', 'Artists', ['a', 'b']), { success: true })
    assert.equal(
      new URL(requestUrl).pathname,
      `/api/book/${encodeURIComponent('group/1')}/${encodeURIComponent('book 日本語/1')}/tags`,
    )
    assert.equal(requestInit?.method, 'POST')
    assert.equal(new Headers(requestInit?.headers).get('X-Edit-Api-Key'), 'edit-key')
    assert.deepEqual(JSON.parse(String(requestInit?.body)), { tagType: 'Artists', tags: ['a', 'b'] })
  })

  it('uses DELETE with the same body and edit authentication', async () => {
    configureApi({ ...originalApiSettings, editKey: 'edit-key' })
    let requestInit: FetchInput | undefined
    globalThis.fetch = (async (_input, init) => {
      requestInit = init
      return jsonResponse({ success: true })
    }) as typeof fetch

    assert.deepEqual(await removeBookTags('group', 'book', 'Tags', ['tag']), { success: true })
    assert.equal(requestInit?.method, 'DELETE')
    assert.equal(new Headers(requestInit?.headers).get('X-Edit-Api-Key'), 'edit-key')
    assert.deepEqual(JSON.parse(String(requestInit?.body)), { tagType: 'Tags', tags: ['tag'] })
  })
})
