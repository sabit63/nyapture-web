import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import { ApiClient, ApiError } from '../src/api/client'
import { getBookPageBlob } from '../src/api/endpoints'

type FetchInput = Parameters<typeof fetch>[1]

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

const setFetch = (handler: (input: RequestInfo | URL, init?: FetchInput) => Promise<Response>) => {
  globalThis.fetch = handler as typeof fetch
}

const waitFor = async (predicate: () => boolean) => {
  while (!predicate()) {
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
  }
}

const abortLike = () => ({ name: 'AbortError', message: 'aborted' })

describe('ApiClient body lifecycle', () => {
  it('rejects an already-aborted caller without starting fetch', async () => {
    const client = new ApiClient({ apiUrl: 'http://localhost:5270' })
    const caller = new AbortController()
    let fetchStarted = false
    setFetch(async () => {
      fetchStarted = true
      return new Response('{}')
    })
    caller.abort()

    await assert.rejects(
      client.requestJson('/pre-aborted', { signal: caller.signal }),
      (error: unknown) => error instanceof ApiError && error.category === 'unknown',
    )
    assert.equal(fetchStarted, false)
  })

  it('consumes JSON, text, and blob responses before resolving', async () => {
    const client = new ApiClient({ apiUrl: 'http://localhost:5270' })
    const responses = [
      new Response(JSON.stringify({ value: 42 }), { status: 200 }),
      new Response('plain text', { status: 200 }),
      new Response('image bytes', { status: 200, headers: { 'Content-Type': 'image/png' } }),
    ]
    let responseIndex = 0
    setFetch(async () => responses[responseIndex++])

    assert.deepEqual(await client.requestJson<{ value: number }>('/json'), { value: 42 })
    assert.equal(await client.requestText('/text'), 'plain text')
    assert.equal((await client.requestBlob('/blob')).type, 'image/png')
  })

  it('reads HTTP error bodies and preserves status/category', async () => {
    const client = new ApiClient({ apiUrl: 'http://localhost:5270' })
    setFetch(async () => new Response(JSON.stringify({ error: 'missing page' }), {
      status: 404,
      statusText: 'Not Found',
      headers: { 'Content-Type': 'application/json' },
    }))

    await assert.rejects(
      client.requestBlob('/blob'),
      (error: unknown) => {
        assert.ok(error instanceof ApiError)
        assert.equal(error.status, 404)
        assert.equal(error.category, 'notFound')
        assert.equal(error.message, 'missing page')
        return true
      },
    )
  })

  it('classifies caller abort while the response body is pending', async () => {
    const client = new ApiClient({ apiUrl: 'http://localhost:5270' })
    const caller = new AbortController()
    let internalSignal: AbortSignal | undefined
    let readerStarted = false
    setFetch(async (_input, init) => {
      internalSignal = init?.signal
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        text: () => {
          readerStarted = true
          return new Promise<string>((_resolve, reject) => {
            internalSignal?.addEventListener('abort', () => reject(abortLike()), { once: true })
          })
        },
      } as unknown as Response
    })

    const pending = client.requestJson('/pending', { signal: caller.signal })
    await waitFor(() => readerStarted)
    caller.abort()

    await assert.rejects(
      pending,
      (error: unknown) => {
        assert.ok(error instanceof ApiError)
        assert.equal(error.category, 'unknown')
        assert.equal(error.status, undefined)
        return true
      },
    )
    assert.equal(internalSignal?.aborted, true)
  })

  it('classifies timeout while the response body is pending', async () => {
    const client = new ApiClient({ apiUrl: 'http://localhost:5270' })
    let internalSignal: AbortSignal | undefined
    setFetch(async (_input, init) => {
      internalSignal = init?.signal
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        text: () => new Promise<string>(() => undefined),
      } as unknown as Response
    })

    await assert.rejects(
      client.requestJson('/timeout', { timeoutSeconds: 1 }),
      (error: unknown) => {
        assert.ok(error instanceof ApiError)
        assert.equal(error.category, 'timeout')
        return true
      },
    )
    assert.equal(internalSignal?.aborted, true)
  })

  it('keeps the first abort source when caller abort follows timeout', async () => {
    const client = new ApiClient({ apiUrl: 'http://localhost:5270' })
    const caller = new AbortController()
    setFetch(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: () => new Promise<string>(() => undefined),
    } as unknown as Response))

    const pending = client.requestText('/timeout-first', {
      signal: caller.signal,
      timeoutSeconds: 1,
    })
    const rejection = assert.rejects(
      pending,
      (error: unknown) => {
        assert.ok(error instanceof ApiError)
        assert.equal(error.category, 'timeout')
        return true
      },
    )
    await new Promise<void>((resolve) => setTimeout(resolve, 1_050))
    caller.abort()
    await rejection
  })

  it('cleans the timer and caller listener after successful body consumption', async () => {
    const client = new ApiClient({ apiUrl: 'http://localhost:5270' })
    const caller = new AbortController()
    let internalSignal: AbortSignal | undefined
    setFetch(async (_input, init) => {
      internalSignal = init?.signal
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    })

    await client.requestJson('/cleanup', { signal: caller.signal, timeoutSeconds: 1 })
    caller.abort()
    assert.equal(internalSignal?.aborted, false)
    await new Promise<void>((resolve) => setTimeout(resolve, 1_050))
    assert.equal(internalSignal?.aborted, false)
  })
})

describe('getBookPageBlob query contract', () => {
  it('encodes image format and fallback_to_original while retaining defaults', async () => {
    let requestUrl = ''
    setFetch(async (input) => {
      requestUrl = String(input)
      return new Response('image bytes', { status: 200 })
    })

    await getBookPageBlob({
      groupId: 'group/1',
      bookId: 'book 1',
      page: 3,
      width: 1024,
      format: 'webp',
      fallbackToOriginal: false,
    })
    const query = new URL(requestUrl).searchParams
    assert.equal(query.get('groupId'), 'group/1')
    assert.equal(query.get('bookId'), 'book 1')
    assert.equal(query.get('page'), '3')
    assert.equal(query.get('width'), '1024')
    assert.equal(query.get('format'), 'webp')
    assert.equal(query.get('fallback_to_original'), 'false')
    assert.equal(query.get('strategy'), 'balanced')

    await getBookPageBlob({ groupId: 'group', bookId: 'book', page: 1 })
    assert.equal(new URL(requestUrl).searchParams.get('fallback_to_original'), 'true')
  })
})
