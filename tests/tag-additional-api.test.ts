import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import {
  configureApi,
  getApiSettings,
} from '../src/api/client'
import {
  getTagAdditionalName,
  upsertTagAdditionalNames,
} from '../src/api/endpoints'

type FetchInput = Parameters<typeof fetch>[1]

const originalFetch = globalThis.fetch
const originalApiSettings = getApiSettings()

afterEach(() => {
  globalThis.fetch = originalFetch
  configureApi(originalApiSettings)
})

const setFetch = (handler: (input: RequestInfo | URL, init?: FetchInput) => Promise<Response>) => {
  globalThis.fetch = handler as typeof fetch
}

describe('tag additional name endpoints', () => {
  it('encodes both GET path segments and forwards the caller signal', async () => {
    let requestUrl = ''
    let fetchStarted = false
    const caller = new AbortController()
    setFetch(async (input) => {
      fetchStarted = true
      requestUrl = String(input)
      return new Response(JSON.stringify({
        name: 'artist/name',
        tagType: 'Artists',
        primaryAdditionalName: '作者名',
      }), { status: 200 })
    })

    const result = await getTagAdditionalName('Artists', 'artist name/日本語', caller.signal)

    assert.deepEqual(result, {
      name: 'artist/name',
      tagType: 'Artists',
      primaryAdditionalName: '作者名',
    })
    assert.equal(
      new URL(requestUrl).pathname,
      `/api/tag-additional/${encodeURIComponent('Artists')}/${encodeURIComponent('artist name/日本語')}`,
    )

    caller.abort()
    assert.equal(fetchStarted, true)
  })

  it('does not start GET when the caller signal is already aborted', async () => {
    let fetchStarted = false
    const caller = new AbortController()
    caller.abort()
    setFetch(async () => {
      fetchStarted = true
      return new Response('{}', { status: 200 })
    })

    await assert.rejects(getTagAdditionalName('Tags', 'name', caller.signal))
    assert.equal(fetchStarted, false)
  })

  it('posts the request array with edit authentication', async () => {
    configureApi({ ...originalApiSettings, editKey: 'edit-key' })
    let requestUrl = ''
    let requestInit: FetchInput | undefined
    const requests = [
      {
        name: 'artist name/日本語',
        tagType: 'Artists' as const,
        primaryAdditionalName: '作者名',
        status: 'Approved' as const,
        source: 'Manual' as const,
        candidates: ['作者名'],
      },
    ]
    setFetch(async (input, init) => {
      requestUrl = String(input)
      requestInit = init
      return new Response(JSON.stringify({ created: 0, updated: 1 }), { status: 200 })
    })

    const result = await upsertTagAdditionalNames(requests)

    assert.deepEqual(result, { created: 0, updated: 1 })
    assert.equal(new URL(requestUrl).pathname, '/api/tag-additional')
    assert.equal(requestInit?.method, 'POST')
    assert.equal(requestInit?.headers instanceof Headers
      ? requestInit.headers.get('X-Edit-Api-Key')
      : new Headers(requestInit?.headers).get('X-Edit-Api-Key'), 'edit-key')
    assert.deepEqual(JSON.parse(String(requestInit?.body)), requests)
  })
})
