import assert from 'node:assert/strict'
import test from 'node:test'
import { useState } from 'react'

import { act, deferred, installHookDom, renderHook } from './helpers/react-hook'
import { mapEBookToCard } from '../src/api/books'
import type { ApiBookCardModel } from '../src/api'
import type { BookDownloadHubListener } from '../src/realtime/book-download-hub'
import { bookDownloadHubClient } from '../src/realtime/book-download-hub'
import type { BookDownloadStatus, SearchCriteria } from '../src/models'
import { emptyCriteria } from '../src/features/search/search-utils'
import {
  applyBufferedSearchStatusesToSnapshot,
  shouldApplySearchStatusImmediately,
  shouldReconcileSearchStatus,
  useSearchExecution,
} from '../src/features/search/useSearchExecution'

const flushPromises = async () => {
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
}

const responseFor = (title: string) => new Response(JSON.stringify({
  success: true,
  books: [{
    groupId: 'group-1',
    bookId: 'book-1',
    url: 'https://hitomi.la/galleries/book-1.html',
    title,
    totalPage: 2,
    status: 'Downloading',
  }],
  totalPage: 1,
}), {
  status: 200,
  headers: { 'Content-Type': 'application/json' },
})

const makeStatus = (overrides: Partial<BookDownloadStatus> = {}): BookDownloadStatus => ({
  book: {
    groupId: 'group-1',
    bookId: 'book-1',
    url: 'https://hitomi.la/galleries/book-1.html',
    totalPage: 2,
    status: 'Downloading',
  },
  executionState: 'Completed',
  lastUpdated: '2026-09-05T00:00:00.000Z',
  ...overrides,
})

type ExecutionProps = {
  apiRevision: number
  isWebSearch?: boolean
  isMissingTagSearch?: boolean
  isStatusSearch?: boolean
  criteria?: SearchCriteria
}

const EMPTY_CRITERIA = emptyCriteria()

const mountExecution = (initialProps: ExecutionProps) => renderHook((props: ExecutionProps) => {
  const [libraryBooks, setLibraryBooks] = useState<ApiBookCardModel[]>([])
  const [webBooks, setWebBooks] = useState<ApiBookCardModel[]>([])
  const execution = useSearchExecution({
    isWebSearch: props.isWebSearch ?? false,
    isLibrarySearch: !props.isWebSearch,
    isMissingTagSearch: props.isMissingTagSearch ?? false,
    isStatusSearch: props.isStatusSearch ?? false,
    apiRevision: props.apiRevision,
    criteria: props.criteria ?? EMPTY_CRITERIA,
    hitomiAppend: 'Normal',
    resultPage: 1,
    sortType: 'uploaded',
    sortDirection: 'desc',
    routeStateSynchronized: true,
    setLibrarySearchBooks: setLibraryBooks,
    updateWebSearchResultBooks: setWebBooks,
  })
  return { ...execution, libraryBooks, webBooks }
}, initialProps)

test('search treats HTTP 200 with no results as success and retains other error statuses', async () => {
  const dom = installHookDom('http://localhost/search')
  const originalFetch = globalThis.fetch
  try {
    for (const mode of [
      {},
      { isWebSearch: true },
      { isMissingTagSearch: true, criteria: { ...EMPTY_CRITERIA, missingTagTypes: ['Artists'] as const } },
      { isStatusSearch: true, criteria: { ...EMPTY_CRITERIA, statuses: ['Downloading'] as const } },
    ]) {
      for (const status of [200, 202, 500]) {
        globalThis.fetch = async () => new Response(JSON.stringify({ success: false, message: 'private details' }), { status })
        const mounted = await mountExecution({ apiRevision: 1, ...mode } as ExecutionProps)
        try {
          await act(flushPromises)
          assert.equal(mounted.current.searchState, status === 200 ? 'success' : 'error')
          assert.equal(mounted.current.searchError, status === 200 ? '' : `APIサーバーでエラーが発生しました。 (StatusCode: ${status})`)
          assert.deepEqual(mounted.current.libraryBooks, [])
          assert.deepEqual(mounted.current.webBooks, [])
        } finally {
          await mounted.unmount()
        }
      }
    }
  } finally {
    globalThis.fetch = originalFetch
    dom.cleanup()
  }
})

test('execution aborts the prior request on API revision change and ignores its stale response', async () => {
  const dom = installHookDom('http://localhost/search')
  const originalFetch = globalThis.fetch
  const requests: { signal: AbortSignal; response: ReturnType<typeof deferred<Response>> }[] = []
  globalThis.fetch = (async (_input, init) => {
    const response = deferred<Response>()
    requests.push({ signal: init?.signal as AbortSignal, response })
    return response.promise
  }) as typeof fetch

  const mounted = await mountExecution({ apiRevision: 1 })
  try {
    assert.equal(requests.length, 1)
    await mounted.rerender({ apiRevision: 2 })
    assert.equal(requests.length, 2)
    assert.equal(requests[0].signal.aborted, true)

    requests[0].response.resolve(responseFor('stale'))
    requests[1].response.resolve(responseFor('fresh'))
    await act(flushPromises)

    assert.equal(mounted.current.libraryBooks[0]?.title, 'fresh')
    assert.equal(mounted.current.searchResultGeneration, 1)
    assert.equal(mounted.current.searchState, 'success')
  } finally {
    await mounted.unmount()
    globalThis.fetch = originalFetch
    dom.cleanup()
  }
})

test('execution buffers realtime completion into the current snapshot and unsubscribes on unmount', async () => {
  const dom = installHookDom('http://localhost/search')
  const originalFetch = globalThis.fetch
  const request = deferred<Response>()
  globalThis.fetch = (async () => request.promise) as typeof fetch
  const client = bookDownloadHubClient as unknown as {
    subscribe: (listener: BookDownloadHubListener) => () => void
  }
  const originalSubscribe = client.subscribe
  const listeners: BookDownloadHubListener[] = []
  client.subscribe = (listener) => {
    listeners.push(listener)
    return () => {
      const index = listeners.indexOf(listener)
      if (index >= 0) listeners.splice(index, 1)
    }
  }

  const mounted = await mountExecution({ apiRevision: 3 })
  try {
    assert.equal(listeners.length, 1)
    listeners[0].onStatus?.('completed', makeStatus())
    request.resolve(responseFor('buffered'))
    await act(flushPromises)

    assert.equal(mounted.current.libraryBooks[0]?.status, 'Downloaded')
    assert.equal(mounted.current.libraryBooks[0]?.title, 'buffered')
    assert.equal(mounted.current.searchResultGeneration, 1)
  } finally {
    await mounted.unmount()
    assert.equal(listeners.length, 0)
    client.subscribe = originalSubscribe
    globalThis.fetch = originalFetch
    dom.cleanup()
  }
})

test('execution coalesces resync requests raised while a foreground request is pending', async () => {
  const dom = installHookDom('http://localhost/search')
  const originalFetch = globalThis.fetch
  const requests: { signal: AbortSignal; response: ReturnType<typeof deferred<Response>> }[] = []
  globalThis.fetch = (async (_input, init) => {
    const response = deferred<Response>()
    requests.push({ signal: init?.signal as AbortSignal, response })
    return response.promise
  }) as typeof fetch

  const client = bookDownloadHubClient as unknown as {
    subscribe: (listener: BookDownloadHubListener) => () => void
  }
  const originalSubscribe = client.subscribe
  const listeners: BookDownloadHubListener[] = []
  client.subscribe = (listener) => {
    listeners.push(listener)
    return () => {
      const index = listeners.indexOf(listener)
      if (index >= 0) listeners.splice(index, 1)
    }
  }

  const mounted = await mountExecution({ apiRevision: 4 })
  try {
    assert.equal(requests.length, 1)
    assert.equal(listeners.length, 1)

    listeners[0].onResyncRequested?.()
    listeners[0].onResyncRequested?.()
    requests[0].response.resolve(responseFor('foreground'))
    for (let attempt = 0; attempt < 4 && requests.length < 2; attempt += 1) {
      await act(flushPromises)
    }

    assert.equal(requests.length, 2)
    requests[1].response.resolve(responseFor('background'))
    await act(flushPromises)
    await act(flushPromises)

    assert.equal(mounted.current.libraryBooks[0]?.title, 'background')
    assert.equal(mounted.current.searchResultGeneration, 2)
  } finally {
    await mounted.unmount()
    client.subscribe = originalSubscribe
    globalThis.fetch = originalFetch
    dom.cleanup()
  }
})

test('execution ignores a stale response after the search condition changes while pending', async () => {
  const dom = installHookDom('http://localhost/search')
  const originalFetch = globalThis.fetch
  const requests: { signal: AbortSignal; response: ReturnType<typeof deferred<Response>> }[] = []
  globalThis.fetch = (async (_input, init) => {
    const response = deferred<Response>()
    requests.push({ signal: init?.signal as AbortSignal, response })
    return response.promise
  }) as typeof fetch

  const firstCriteria = { ...EMPTY_CRITERIA, text: 'first' }
  const secondCriteria = { ...EMPTY_CRITERIA, text: 'second' }
  const mounted = await mountExecution({ apiRevision: 5, criteria: firstCriteria })
  try {
    assert.equal(requests.length, 1)
    await mounted.rerender({ apiRevision: 5, criteria: secondCriteria })
    assert.equal(requests.length, 2)
    assert.equal(requests[0].signal.aborted, true)

    requests[0].response.resolve(responseFor('stale'))
    requests[1].response.resolve(responseFor('fresh'))
    await act(flushPromises)
    await act(flushPromises)

    assert.equal(mounted.current.libraryBooks[0]?.title, 'fresh')
    assert.equal(mounted.current.searchResultGeneration, 1)
    assert.equal(mounted.current.searchState, 'success')
  } finally {
    await mounted.unmount()
    globalThis.fetch = originalFetch
    dom.cleanup()
  }
})

test('execution boundary exposes realtime ordering and snapshot projection rules without a network call', () => {
  const status = makeStatus({ executionState: 'Running', lastUpdated: undefined })
  assert.equal(shouldReconcileSearchStatus('progress', status), true)
  assert.equal(shouldApplySearchStatusImmediately('completed', status), true)

  const card = mapEBookToCard({
    groupId: 'group-1',
    bookId: 'book-1',
    url: 'https://hitomi.la/galleries/book-1.html',
    title: 'snapshot',
    totalPage: 2,
    status: 'Downloading',
  }, { context: 'library' })
  const projected = applyBufferedSearchStatusesToSnapshot(
    [card],
    [{ kind: 'completed', status: makeStatus() }],
    new Map(),
  )
  assert.equal(projected[0].status, 'Downloaded')
})


test('web results finish before optional tags and stale enrichment cannot replace new tags', async () => {
  const dom = installHookDom('http://localhost/search')
  const originalFetch = globalThis.fetch
  const requests: { response: ReturnType<typeof deferred<Response>> }[] = []
  globalThis.fetch = (async () => {
    const response = deferred<Response>()
    requests.push({ response })
    return response.promise
  }) as typeof fetch
  const criteria = { ...emptyCriteria(), tags: [{ type: 'Artists' as const, name: 'artist' }] }
  const mounted = await mountExecution({ apiRevision: 1, isWebSearch: true, criteria })
  const json = (value: unknown) => new Response(JSON.stringify(value), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  })
  try {
    assert.equal(mounted.current.searchLoaderVisible, true)
    requests[0].response.resolve(json({ success: true, onlineBookPage: { books: [] }, tags: [] }))
    await act(flushPromises)
    assert.equal(requests.length, 2)
    assert.equal(mounted.current.searchState, 'success')
    assert.equal(mounted.current.searchLoaderVisible, false)
    await mounted.rerender({ apiRevision: 2, isWebSearch: true, criteria })
    requests[2].response.resolve(json({
      success: true, onlineBookPage: { books: [] },
      tags: [{ type: 'Artists', name: 'artist', displayName: 'Current' }],
    }))
    await act(flushPromises)
    requests[1].response.resolve(json({ status: 'Approved', primaryAdditionalName: 'Stale' }))
    await act(flushPromises)
    assert.equal(mounted.current.searchResponseTags[0]?.displayName, 'Current')
  } finally {
    await mounted.unmount()
    globalThis.fetch = originalFetch
    dom.cleanup()
  }
})
