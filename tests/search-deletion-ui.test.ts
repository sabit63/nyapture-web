import assert from 'node:assert/strict'
import { it } from 'node:test'
import { useRef, useState } from 'react'

import type { ApiBookCardModel } from '../src/api'
import { useSearchController } from '../src/features/search/useSearchController'
import { useSearchOperations } from '../src/features/search/useSearchOperations'
import { act, installHookDom, renderHook } from './helpers/react-hook'

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

type HarnessProps = {
  apiRevision: number
  routeKey: string
  notify: (message: string, tone?: 'success' | 'warning' | 'error') => void
}

const useDeletionHarness = ({ apiRevision, routeKey, notify }: HarnessProps) => {
  const [libraryBooks, setLibraryBooks] = useState<ApiBookCardModel[]>([book])
  const [webBooks, setWebBooks] = useState<ApiBookCardModel[]>([])
  const [selected, setSelected] = useState(['group-1\u0000book-1'])
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
    updateWebSearchResultBooks: setWebBooks,
    replaceWebSearchBook: () => undefined,
    replaceWebSearchBooks: () => undefined,
    notify,
  })
  return { ...operations, libraryBooks, selected }
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
    await act(async () => { hook.current.deleteLibraryBook(book) })
    assert.equal(hook.current.deleteDialogOpen, true)

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
