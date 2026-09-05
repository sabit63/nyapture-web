import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'

import { configureApi, getApiSettings } from '../src/api/client'
import { deleteBook, deleteBookPhysical } from '../src/api/endpoints'

type FetchInput = Parameters<typeof fetch>[1]

const originalFetch = globalThis.fetch
const originalApiSettings = getApiSettings()

afterEach(() => {
  globalThis.fetch = originalFetch
  configureApi(originalApiSettings)
})

describe('physical book deletion endpoint', () => {
  it('sends remove=true and preserves the asynchronous job response', async () => {
    configureApi({ ...originalApiSettings, editKey: 'edit-key' })
    let requestUrl = ''
    let requestInit: FetchInput | undefined
    globalThis.fetch = (async (input, init) => {
      requestUrl = String(input)
      requestInit = init
      return new Response(JSON.stringify({
        success: true,
        data: { jobId: 'job-1', status: 'Pending', disposition: 'Physical' },
      }), { status: 202 })
    }) as typeof fetch

    const result = await deleteBookPhysical('group/1', 'book 日本語/1')

    assert.equal(result.success, true)
    assert.equal(result.data?.jobId, 'job-1')
    assert.equal(result.data?.disposition, 'Physical')
    const url = new URL(requestUrl)
    assert.equal(url.pathname, `/api/book/${encodeURIComponent('group/1')}/${encodeURIComponent('book 日本語/1')}`)
    assert.equal(url.searchParams.get('remove'), 'true')
    assert.equal(requestInit?.method, 'DELETE')
    assert.equal(requestInit?.headers instanceof Headers
      ? requestInit.headers.get('X-Edit-Api-Key')
      : new Headers(requestInit?.headers).get('X-Edit-Api-Key'), 'edit-key')
  })

  it('keeps the legacy descriptor as an explicit physical-delete alias', () => {
    assert.equal(deleteBook, deleteBookPhysical)
  })
})
