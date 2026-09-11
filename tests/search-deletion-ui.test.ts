import assert from 'node:assert/strict'
import { it } from 'node:test'
import { useRef, useState } from 'react'

import type { ApiBookCardModel } from '../src/api'
import { useSearchController } from '../src/features/search/useSearchController'
import { useSearchOperations } from '../src/features/search/useSearchOperations'
import { useSearchResults } from '../src/features/search/useSearchResults'
import { bookDownloadHubClient, type BookDownloadHubListener } from '../src/realtime/book-download-hub'
import { act, deferred, installHookDom, renderHook } from './helpers/react-hook'

const book: ApiBookCardModel = {
  groupId: 'group-1',
  bookId: 'book-1',
  apiGroupId: 'group-1',
  apiBookId: 'book-1',
  url: 'https://example.invalid/book-1',
  title: 'Fixture book',
  captions: {},
  totalPage: 1,
  tagSet: {},
  uploadedTime: '2026-09-06T00:00:00Z',
  pageUrls: [],
  status: 'Downloaded',
  tags: [],
  cover: 'violet',
}

for (const isWebSearch of [false, true]) {
  it(`bulk refresh updates selected ${isWebSearch ? 'online' : 'library'} books and online download skips completed books`, async () => {
    const dom = installHookDom()
    const started: string[] = []
    globalThis.fetch = async (input, init) => {
      if (new URL(String(input)).pathname === '/api/download/start') {
        started.push(JSON.parse(String(init?.body)).url)
        return Response.json({ success: true })
      }
      const refreshed = { ...book, title: 'Refreshed', status: 'Cancel' }
      return Response.json({ success: true, book: refreshed, books: [refreshed] })
    }
    const hook = await renderHook(() => {
      const results = useSearchResults()
      const operations = useSearchOperations({
        ...results, isWebSearch, apiRevision: 0, routeKey: '/search',
        searchResultsRef: results.stateRef, setSelectMode: () => {}, notify: () => {},
      })
      return { ...results, ...operations }
    }, undefined)
    try {
      const second = { ...book, bookId: 'second', apiBookId: 'second', url: 'https://example.invalid/second' }
      await act(async () => {
        const setBooks = isWebSearch ? hook.current.updateWebSearchResultBooks : hook.current.setLibrarySearchBooks
        setBooks([{ ...book, status: isWebSearch ? 'WebBookInPage' : 'Cancel' }, second])
        hook.current.setSelected(['group-1\u0000book-1'])
      })
      await act(async () => { await hook.current.refreshSelectedBooks() })
      const books = isWebSearch ? hook.current.webSearchResultBooks : hook.current.librarySearchBooks
      assert.equal(books[0].title, 'Refreshed')
      assert.equal(typeof books[0].thumbnailReloadKey, 'string')
      assert.match(String(books[0].thumbnailReloadKey), /^refresh:/)
      assert.equal(books[1].title, book.title)
      assert.deepEqual(hook.current.selected, [])
      if (isWebSearch) {
        await act(async () => { hook.current.setSelected(['group-1\u0000book-1', 'group-1\u0000second']) })
        assert.equal(hook.current.downloadableSelectedCount, 1)
        await act(async () => { await hook.current.downloadSelectedBooks() })
        assert.deepEqual(started, [book.url])
        assert.deepEqual(hook.current.selected, ['group-1\u0000second'])
      }
    } finally { await hook.unmount(); dom.cleanup() }
  })
}

for (const bulk of [false, true]) {
  it(`${bulk ? 'bulk' : 'single'} start responses preserve queued notifications and block duplicate requests`, async (t) => {
    const dom = installHookDom('http://localhost/search')
    const listeners = new Set<BookDownloadHubListener>()
    t.mock.method(bookDownloadHubClient, 'subscribe', (listener: BookDownloadHubListener) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    })
    const started = deferred<Response>()
    let requests = 0
    globalThis.fetch = async (input) => {
      if (new URL(String(input)).pathname === '/api/download/start') {
        requests++
        return started.promise
      }
      return Response.json({ success: true, books: [{ ...book, status: 'Cancel' }], totalPage: 1 })
    }
    const hook = await renderHook(() => useSearchController({
      isWebSearch: false, isLibrarySearch: true, isMissingTagSearch: false, isBookViewer: false,
      apiRevision: 0, displaySettings: { thumbnailColumns: 5, colorTheme: 'default' },
      hubConnectionState: 'idle', notify: () => {},
    }), undefined)
    try {
      await act(async () => { hook.current.selectAllVisibleBooks() })
      const download = () => bulk ? hook.current.downloadSelectedBooks()
        : hook.current.downloadWebBook(hook.current.visibleBooks[0])
      let run!: Promise<void>
      await act(async () => { run = download() })
      await act(async () => { await download() })
      assert.equal(requests, 1)
      assert.equal(hook.current.visibleBooks[0].status, 'Cancel')
      await act(async () => {
        for (const listener of listeners) listener.onStatus?.('statusUpdate', {
          book: { ...book, status: 'Downloading' }, executionState: 'Queued',
          lastUpdated: '2026-09-10T00:00:00Z',
        })
        await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()))
      })
      assert.equal(hook.current.visibleBooks[0].status, 'Standby')
      await act(async () => { started.resolve(Response.json({ success: true })); await run })
      assert.equal(hook.current.visibleBooks[0].status, 'Standby')
      await act(async () => { await download() })
      assert.equal(requests, 1)
    } finally {
      await hook.unmount()
      assert.equal(listeners.size, 0)
      dom.cleanup()
    }
  })
}

it('web detail status follows hub notifications instead of the start response', async (t) => {
  const dom = installHookDom()
  const listeners = new Set<BookDownloadHubListener>()
  t.mock.method(bookDownloadHubClient, 'subscribe', (listener: BookDownloadHubListener) => {
    listeners.add(listener)
    return () => { listeners.delete(listener) }
  })
  const started = deferred<Response>()
  globalThis.fetch = async (input) => new URL(String(input)).pathname === '/api/download/start'
    ? started.promise : Response.json({ success: true, book: { ...book, status: 'WebBook' } })
  const candidate = { ...book, apiGroupId: undefined, apiBookId: undefined, status: 'WebBook' as const }
  const hook = await renderHook(() => useSearchOperations({
    isWebSearch: true, apiRevision: 0, routeKey: '/web', librarySearchBooks: [], webSearchResultBooks: [], selected: [],
    searchResultsRef: { current: { librarySearchBooks: [], webSearchResultBooks: [], selected: [] } },
    setLibrarySearchBooks: () => {}, setSelected: () => {}, setSelectMode: () => {},
    updateWebSearchResultBooks: () => {}, replaceWebSearchBook: () => {}, replaceWebSearchBooks: () => {}, notify: () => {},
  }), undefined)
  try {
    await act(async () => { hook.current.openWebBookDetail(candidate) })
    assert.equal(hook.current.webDetailBook?.status, 'WebBook')
    let run!: Promise<void>
    await act(async () => { run = hook.current.downloadWebBook(hook.current.webDetailBook!) })
    await act(async () => {
      for (const listener of listeners) listener.onQueuedDownloads?.([{
        book: { ...book, status: 'Downloading' }, executionState: 'Queued', lastUpdated: '2026-09-10T00:00:00Z',
      }])
    })
    assert.equal(hook.current.webDetailBook?.status, 'Standby')
    await act(async () => { started.resolve(Response.json({ success: true })); await run })
    assert.equal(hook.current.webDetailBook?.status, 'Standby')
    await act(async () => {
      for (const listener of listeners) listener.onStatus?.('started', {
        book: { ...book, status: 'Standby' }, executionState: 'Running', lastUpdated: '2026-09-10T00:00:01Z',
      })
    })
    assert.equal(hook.current.webDetailBook?.status, 'Downloading')
  } finally { await hook.unmount(); dom.cleanup() }
})

it('refreshes and downloads a cancelled library book through the card operations', async () => {
  const dom = installHookDom('http://localhost/search')
  const paths: string[] = []
  globalThis.fetch = async (input) => {
    const path = new URL(String(input)).pathname
    paths.push(path)
    return new Response(JSON.stringify(path === '/api/download/start' ? { success: true } : {
      success: true, books: [{ ...book, status: 'Cancel', title: path === '/api/book/group-1/book-1' ? 'Refreshed book' : book.title }], totalPage: 1,
    }), { headers: { 'Content-Type': 'application/json' } })
  }
  const hook = await renderHook(() => useSearchController({
    isWebSearch: false, isLibrarySearch: true, isMissingTagSearch: false, isBookViewer: false,
    apiRevision: 0, displaySettings: { thumbnailColumns: 5, colorTheme: 'default' },
    hubConnectionState: 'idle', notify: () => {},
  }), undefined)
  try {
    assert.equal(hook.current.visibleBooks[0]?.status, 'Cancel')
    await act(async () => { await hook.current.refreshWebBook(hook.current.visibleBooks[0]) })
    assert.equal(hook.current.visibleBooks[0]?.title, 'Refreshed book')
    await act(async () => { await hook.current.downloadWebBook(hook.current.visibleBooks[0]) })
    assert.equal(hook.current.visibleBooks[0]?.status, 'Cancel')
    assert.ok(paths.includes('/api/book/group-1/book-1'))
    assert.ok(paths.includes('/api/download/start'))
  } finally {
    await hook.unmount()
    dom.cleanup()
  }
})

it('refreshes downloaded library books through the Web API and displays added tags', async () => {
  const dom = installHookDom('http://localhost/search')
  const requests: string[] = []
  const saved = { ...book, tagSet: { Artists: ['existing'] } }
  globalThis.fetch = async (input, init) => {
    const path = new URL(String(input)).pathname
    requests.push(path)
    if (path === '/api/web/book') {
      assert.equal(init?.method, 'POST')
      assert.equal(JSON.parse(String(init?.body)), book.url)
      return Response.json({ success: true, book: { ...saved, tagSet: { Artists: ['existing', 'added'] } } })
    }
    return Response.json({ success: true, books: [saved], totalPage: 1 })
  }
  const hook = await renderHook(() => useSearchController({
    isWebSearch: false, isLibrarySearch: true, isMissingTagSearch: false, isBookViewer: false,
    apiRevision: 0, displaySettings: { thumbnailColumns: 5, colorTheme: 'default' },
    hubConnectionState: 'idle', notify: () => {},
  }), undefined)
  try {
    await act(async () => { await hook.current.refreshWebBook(hook.current.visibleBooks[0]) })
    assert.equal(hook.current.visibleBooks[0].status, 'Downloaded')
    assert.deepEqual(hook.current.visibleBooks[0].tags.map((tag) => tag.name), ['existing', 'added'])
    assert.ok(requests.includes('/api/web/book'))
    assert.ok(!requests.includes('/api/book/group-1/book-1'))
  } finally {
    await hook.unmount()
    dom.cleanup()
  }
})

type HarnessProps = {
  apiRevision: number
  routeKey: string
  notify: (message: string, tone?: 'success' | 'warning' | 'error') => void
}

const useDeletionHarness = ({ apiRevision, routeKey, notify }: HarnessProps) => {
  const [libraryBooks, setLibraryBooks] = useState<ApiBookCardModel[]>([book])
  const [webBooks, setWebBooks] = useState<ApiBookCardModel[]>([])
  const [selected, setSelected] = useState(['group-1\u0000book-1'])
  const [selectMode, setSelectMode] = useState(true)
  const searchResultsRef = useRef({
    librarySearchBooks: libraryBooks,
    webSearchResultBooks: webBooks,
    selected,
  })
  searchResultsRef.current = {
    librarySearchBooks: libraryBooks,
    webSearchResultBooks: webBooks,
    selected,
  }
  const operations = useSearchOperations({
    isWebSearch: false,
    apiRevision,
    routeKey,
    librarySearchBooks: libraryBooks,
    webSearchResultBooks: webBooks,
    selected,
    searchResultsRef,
    setLibrarySearchBooks: setLibraryBooks,
    setSelected,
    setSelectMode,
    updateWebSearchResultBooks: setWebBooks,
    replaceWebSearchBook: () => undefined,
    replaceWebSearchBooks: () => undefined,
    notify,
  })
  return { ...operations, libraryBooks, selected, selectMode }
}

it('closes immediately, marks deletion pending, and keeps monitoring across route changes', async () => {
  const dom = installHookDom('http://localhost/search')
  const notices: string[] = []
  let requests = 0
  globalThis.fetch = async () => {
    requests += 1
    return new Response(JSON.stringify({
      success: true,
      data: {
        jobId: 'job-1',
        status: 'Pending',
      },
    }), {
      status: 202,
      headers: { 'Content-Type': 'application/json', 'Retry-After': '60' },
    })
  }
  const props: HarnessProps = {
    apiRevision: 0,
    routeKey: '/search',
    notify: (message) => { notices.push(message) },
  }
  const hook = await renderHook(useDeletionHarness, props)
  try {
    await act(async () => { hook.current.deleteSelectedLibraryBooks() })
    assert.equal(hook.current.deleteDialogOpen, true)
    assert.equal(hook.current.selectMode, true)
    await act(async () => { hook.current.requestDeleteDialogClose('close-button') })
    assert.equal(hook.current.selectMode, true)
    assert.deepEqual(hook.current.selected, ['group-1\u0000book-1'])
    await act(async () => { hook.current.deleteSelectedLibraryBooks() })

    const closeReasons: string[] = []
    await act(async () => {
      await hook.current.confirmDeleteLibraryBooks((reason) => {
        closeReasons.push(reason)
        return hook.current.requestDeleteDialogClose(reason)
      })
    })

    assert.deepEqual(closeReasons, ['submit'])
    assert.equal(hook.current.deleteDialogOpen, false)
    assert.equal(hook.current.pendingDeletionKeys.has('group-1\u0000book-1'), true)
    assert.deepEqual(hook.current.selected, [])
    assert.equal(hook.current.selectMode, false)
    assert.equal(hook.current.libraryBooks[0]?.status, 'Downloaded')
    assert.deepEqual(notices, ['1件の削除を開始しました'])
    assert.equal(requests, 1)

    await hook.rerender({ ...props, routeKey: '/dashboard' })
    assert.equal(hook.current.pendingDeletionKeys.has('group-1\u0000book-1'), true)

    await hook.rerender({ ...props, apiRevision: 1, routeKey: '/dashboard' })
    assert.equal(hook.current.pendingDeletionKeys.size, 0)
  } finally {
    await hook.unmount()
    dom.cleanup()
  }
})

it('removes each successful library card and emits one final summary using mocked fetch', async () => {
  const dom = installHookDom('http://localhost/search')
  const notices: { message: string; tone?: string }[] = []
  globalThis.fetch = async () => new Response(JSON.stringify({
    success: true,
    data: {
      jobId: 'job-1',
      status: 'Succeeded',
    },
  }), { status: 202, headers: { 'Content-Type': 'application/json' } })
  const hook = await renderHook(useDeletionHarness, {
    apiRevision: 0,
    routeKey: '/search',
    notify: (message, tone) => { notices.push({ message, tone }) },
  })
  try {
    await act(async () => { hook.current.deleteLibraryBook(book) })
    await act(async () => {
      await hook.current.confirmDeleteLibraryBooks((reason) => {
        return hook.current.requestDeleteDialogClose(reason)
      })
      await new Promise<void>((resolve) => setImmediate(resolve))
    })

    assert.deepEqual(hook.current.libraryBooks, [])
    assert.equal(hook.current.pendingDeletionKeys.size, 0)
    assert.deepEqual(notices, [
      { message: '1件の削除を開始しました', tone: undefined },
      { message: '1件を削除', tone: 'success' },
    ])
  } finally {
    await hook.unmount()
    dom.cleanup()
  }
})

it('projects a pending deletion as Shredding in the visible search results', async () => {
  const dom = installHookDom('http://localhost/search')
  globalThis.fetch = async (_input, init) => {
    if ((init?.method ?? 'GET') === 'DELETE') {
      return new Response(JSON.stringify({
        success: true,
        data: { jobId: 'job-1', status: 'Pending' },
      }), {
        status: 202,
        headers: { 'Content-Type': 'application/json', 'Retry-After': '60' },
      })
    }
    return new Response(JSON.stringify({
      success: true,
      books: [{
        groupId: 'group-1',
        bookId: 'book-1',
        title: 'Fixture book',
        totalPage: 1,
        status: 'Downloaded',
      }],
      totalPage: 1,
    }), { headers: { 'Content-Type': 'application/json' } })
  }
  const hook = await renderHook(() => useSearchController({
    isWebSearch: false,
    isLibrarySearch: true,
    isMissingTagSearch: false,
    isBookViewer: false,
    apiRevision: 0,
    displaySettings: { thumbnailColumns: 5, colorTheme: 'default' },
    hubConnectionState: 'idle',
    notify: () => undefined,
  }), undefined)
  try {
    const targetBook = hook.current.visibleBooks[0]
    assert.equal(targetBook?.status, 'Downloaded')
    await act(async () => { hook.current.deleteLibraryBook(targetBook) })
    await act(async () => {
      await hook.current.confirmDeleteLibraryBooks((reason) => {
        return hook.current.requestDeleteDialogClose(reason)
      })
    })

    assert.equal(hook.current.visibleBooks[0]?.status, 'Shredding')
  } finally {
    await hook.unmount()
    dom.cleanup()
  }
})
