import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import { ApiClient, ApiError, requestJsonResponse } from '../src/api/client'
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
      internalSignal = init?.signal ?? undefined
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
      internalSignal = init?.signal ?? undefined
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
      internalSignal = init?.signal ?? undefined
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    })

    await client.requestJson('/cleanup', { signal: caller.signal, timeoutSeconds: 1 })
    caller.abort()
    assert.equal(internalSignal?.aborted, false)
    await new Promise<void>((resolve) => setTimeout(resolve, 1_050))
    assert.equal(internalSignal?.aborted, false)
  })
})

describe('ApiClient JSON response metadata', () => {
  it('returns the parsed body, status, Retry-After, and Location', async () => {
    const client = new ApiClient({ apiUrl: 'http://localhost:5270' })
    setFetch(async () => new Response(JSON.stringify({ jobId: 'job-1' }), {
      status: 202,
      headers: {
        Location: '/api/book/deletion-jobs/job-1',
        'Retry-After': '3',
      },
    }))

    const result = await client.requestJsonResponse<{ jobId: string }>('/api/book/1/2', { method: 'DELETE' })
    assert.deepEqual(result, {
      body: { jobId: 'job-1' },
      status: 202,
      retryAfterSeconds: 3,
      location: '/api/book/deletion-jobs/job-1',
    })
  })

  it('exposes Retry-After on HTTP errors through ApiError', async () => {
    const client = new ApiClient({ apiUrl: 'http://localhost:5270' })
    setFetch(async () => new Response(JSON.stringify({ error: 'queue full' }), {
      status: 503,
      headers: { 'Retry-After': '8' },
    }))

    await assert.rejects(
      client.requestJsonResponse('/api/book/1/2', { method: 'DELETE' }),
      (error: unknown) => {
        assert.ok(error instanceof ApiError)
        assert.equal(error.status, 503)
        assert.equal(error.category, 'server')
        assert.equal(error.retryAfterSeconds, 8)
        return true
      },
    )
  })

  it('clamps integer Retry-After values and omits invalid values', async () => {
    const client = new ApiClient({ apiUrl: 'http://localhost:5270' })
    const responses = [
      new Response('{}', { status: 202, headers: { 'Retry-After': '0' } }),
      new Response('{}', { status: 202, headers: { 'Retry-After': '120' } }),
      new Response('{}', { status: 202, headers: { 'Retry-After': '1.5' } }),
      new Response('{}', { status: 202, headers: { 'Retry-After': 'Wed, 21 Oct 2015 07:28:00 GMT' } }),
      new Response('{}', { status: 202, headers: { 'Retry-After': '  ' } }),
    ]
    let responseIndex = 0
    setFetch(async () => responses[responseIndex++])

    assert.equal((await client.requestJsonResponse('/job/0')).retryAfterSeconds, 1)
    assert.equal((await client.requestJsonResponse('/job/60')).retryAfterSeconds, 60)
    assert.equal((await client.requestJsonResponse('/job/fraction')).retryAfterSeconds, undefined)
    assert.equal((await client.requestJsonResponse('/job/date')).retryAfterSeconds, undefined)
    assert.equal((await client.requestJsonResponse('/job/blank')).retryAfterSeconds, undefined)
  })

  it('keeps requestJson returning only the parsed body and supports the wrapper', async () => {
    const responses = [
      new Response(JSON.stringify({ value: 1 }), {
        status: 202,
        headers: { Location: '/job/1', 'Retry-After': '4' },
      }),
      new Response(JSON.stringify({ value: 2 }), {
        status: 202,
        headers: { Location: '/job/2', 'Retry-After': '5' },
      }),
    ]
    let responseIndex = 0
    setFetch(async () => responses[responseIndex++])
    const client = new ApiClient({ apiUrl: 'http://localhost:5270' })

    assert.deepEqual(await client.requestJson<{ value: number }>('/body-only'), { value: 1 })
    assert.deepEqual(await requestJsonResponse<{ value: number }>('/metadata', undefined, {
      apiUrl: 'http://localhost:5270',
    }), {
      body: { value: 2 },
      status: 202,
      retryAfterSeconds: 5,
      location: '/job/2',
    })
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
    assert.equal(new URL(requestUrl).searchParams.has('width'), false)
  })
})

it('retains only sanitized string validation messages from HTTP errors', async () => {
  const client = new ApiClient({ apiUrl: 'http://localhost:5270', apiKey: 'cache-secret-value', editKey: 'cache-edit-secret' })
  setFetch(async () => new Response(JSON.stringify({
    success: false,
    data: { errors: ['invalid cache-secret-value', 'invalid cache-edit-secret', { secret: 'must not retain' }] },
  }), { status: 400 }))
  await assert.rejects(client.requestJson('/api/dashboard/web-cache/config'), (error: unknown) => {
    assert.ok(error instanceof ApiError)
    assert.equal(error.status, 400)
    assert.equal(error.validationErrors?.length, 2)
    assert.ok(error.validationErrors?.every((message) => !message.includes('cache-secret-value') && !message.includes('cache-edit-secret')))
    assert.ok(!JSON.stringify(error).includes('must not retain'))
    return true
  })
})
