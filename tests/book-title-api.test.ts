import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import { configureApi, getApiSettings } from '../src/api/client'
import { updateBookTitle } from '../src/api/endpoints'

type FetchInput = Parameters<typeof fetch>[1]

const originalFetch = globalThis.fetch
const originalApiSettings = getApiSettings()

afterEach(() => {
  globalThis.fetch = originalFetch
  configureApi(originalApiSettings)
})

describe('book title endpoint', () => {
  it('patches an encoded book path with the title and edit authentication', async () => {
    configureApi({ ...originalApiSettings, editKey: 'edit-key' })
    let requestUrl = ''
    let requestInit: FetchInput | undefined
    globalThis.fetch = (async (input, init) => {
      requestUrl = String(input)
      requestInit = init
      return new Response(JSON.stringify({ success: true }), { status: 200 })
    }) as typeof fetch

    const result = await updateBookTitle('group/1', 'book 日本語/1', '新しいタイトル')

    assert.deepEqual(result, { success: true })
    assert.equal(
      new URL(requestUrl).pathname,
      `/api/book/${encodeURIComponent('group/1')}/${encodeURIComponent('book 日本語/1')}/title`,
    )
    assert.equal(requestInit?.method, 'PATCH')
    assert.equal(requestInit?.headers instanceof Headers
      ? requestInit.headers.get('X-Edit-Api-Key')
      : new Headers(requestInit?.headers).get('X-Edit-Api-Key'), 'edit-key')
    assert.deepEqual(JSON.parse(String(requestInit?.body)), { title: '新しいタイトル' })
  })
})
