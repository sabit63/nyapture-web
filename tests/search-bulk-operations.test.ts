import assert from 'node:assert/strict'
import { it } from 'node:test'
import { createElement, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { mapEBookToCard } from '../src/api/books'
import { getBookIdentityKey } from '../src/features/library/book-deletion'
import { useSearchOperations } from '../src/features/search/useSearchOperations'
import { useSearchResults } from '../src/features/search/useSearchResults'
import { act, deferred, installHookDom, renderHook } from './helpers/react-hook'

const books = Array.from({ length: 5 }, (_, index) => mapEBookToCard({
  groupId: 'g', bookId: String(index), title: `Book ${index}`, status: 'Cancel',
  url: `https://example.test/${index}`,
}))
type Scope = { routeKey: string; apiRevision: number }
const scope: Scope = { routeKey: '/search', apiRevision: 0 }

for (const isWebSearch of [false, true]) {
  it(`bulk refresh rejects colliding IDs and leaves no old ${isWebSearch ? 'web' : 'library'} cards after paging`, async (t) => {
    const dom = installHookDom()
    const errors = t.mock.method(console, 'error', () => {})
    const messages: string[] = []
    const makeBook = (id: string) => mapEBookToCard({
      groupId: 'g', bookId: id, title: id, url: `https://example.test/${id}`, status: 'Downloaded',
    })
    globalThis.fetch = async () => Response.json({ success: true, book: makeBook('shared') })
    const resultKey = isWebSearch ? 'webSearchResultBooks' : 'librarySearchBooks'
    const setSelectMode = () => {}
    const notify = (message: string) => { messages.push(message) }
    const useProbe = () => {
      const results = useSearchResults()
      const operations = useSearchOperations({
        ...results, ...scope, isWebSearch, searchResultsRef: results.stateRef, setSelectMode, notify,
      })
      return { ...results, ...operations }
    }
    let current!: ReturnType<typeof useProbe>
    function Probe() {
      current = useProbe()
      // Match the result grid's identity keys so duplicate-key DOM remnants are observable.
      return createElement('ul', null, current[resultKey].map((book) => (
        createElement('li', { key: getBookIdentityKey(book) }, book.title)
      )))
    }
    const container = document.body.appendChild(document.createElement('div'))
    const root = createRoot(container)
    const setBooks = (next: ReturnType<typeof makeBook>[]) => {
      if (isWebSearch) current.updateWebSearchResultBooks(next)
      else current.setLibrarySearchBooks(next)
    }
    try {
      await act(async () => { root.render(createElement(Probe)) })
      await act(async () => {
        const initial = ['A', 'B', 'C'].map(makeBook)
        setBooks(initial)
        current.setSelected(initial.map(getBookIdentityKey))
      })
      await act(async () => { await current.refreshSelectedBooks() })
      assert.deepEqual(current[resultKey].map((book) => book.bookId), ['shared', 'B', 'C'])
      assert.deepEqual(current.selected, ['g\u0000B', 'g\u0000C'])
      assert.deepEqual([...current.failedBookKeys], ['g\u0000B', 'g\u0000C'])
      assert.match(messages[0], /1件を読み込みました、2件は失敗しました/)
      await act(async () => { setBooks(['D', 'E', 'F'].map(makeBook)) })
      assert.deepEqual([...container.querySelectorAll('li')].map((item) => item.textContent), ['D', 'E', 'F'])
      assert.equal(errors.mock.calls.length, 0)
    } finally {
      await act(async () => { root.unmount() })
      errors.mock.restore()
      dom.cleanup()
    }
  })
}

async function setup() {
  const dom = installHookDom()
  const requests: { gate: ReturnType<typeof deferred<Response>>; signal: AbortSignal; index: number }[] = []
  const messages: string[] = []
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as string | { url: string }
    const url = typeof body === 'string' ? body : body.url
    const gate = deferred<Response>()
    requests.push({ gate, signal: init!.signal!, index: Number(new URL(url).pathname.slice(1)) })
    // Deliberately ignore abort here to exercise rejection of late responses.
    return gate.promise
  }
  const hook = await renderHook((props: Scope) => {
    const [selectMode, setSelectMode] = useState(true)
    const results = useSearchResults()
    const operations = useSearchOperations({
      ...results, ...props, isWebSearch: true, searchResultsRef: results.stateRef,
      setSelectMode, notify: (message) => messages.push(message),
    })
    return { ...results, ...operations, selectMode }
  }, scope)
  await act(async () => {
    hook.current.updateWebSearchResultBooks(books)
    hook.current.setSelected(books.map(getBookIdentityKey))
  })
  const finish = (request: typeof requests[number], failed = false) => request.gate.resolve(failed
    ? new Response('failed', { status: 500 })
    : Response.json({ success: true, book: {
      ...books[request.index], title: 'Refreshed', bookId: `refreshed-${request.index}`,
    } }))
  return { dom, hook, requests, messages, finish }
}

for (const operation of ['downloadSelectedBooks', 'refreshSelectedBooks', 'downloadWebBook', 'refreshWebBook'] as const) {
  it(`${operation} highlights failures for five seconds and resets the timer on another failure`, async (t) => {
    const { dom, hook, requests, finish } = await setup()
    t.mock.timers.enable({ apis: ['setTimeout'] })
    try {
      await act(async () => { hook.current.setSelected([getBookIdentityKey(books[0])]) })
      const fail = async () => {
        let run!: Promise<void>
        await act(async () => { run = hook.current[operation](books[0]) })
        await act(async () => { finish(requests.at(-1)!, true); await run })
      }
      await fail()
      assert.deepEqual([...hook.current.failedBookKeys], [getBookIdentityKey(books[0])])
      await act(async () => { t.mock.timers.tick(4000) })
      await fail()
      await act(async () => { t.mock.timers.tick(1000) })
      assert.equal(hook.current.failedBookKeys.size, 1)
      await act(async () => { t.mock.timers.tick(4000) })
      assert.equal(hook.current.failedBookKeys.size, 0)
      await fail()
      await hook.rerender({ ...scope, routeKey: '/search?page=2' })
      assert.equal(hook.current.failedBookKeys.size, 0)
      await act(async () => { t.mock.timers.tick(5000) })
      assert.equal(hook.current.failedBookKeys.size, 0)
    } finally { await hook.unmount(); t.mock.timers.reset(); dom.cleanup() }
  })
}

for (const operation of ['downloadSelectedBooks', 'refreshSelectedBooks'] as const) {
  it(`${operation} runs three at a time, settles incrementally and excludes other bulk runs`, async () => {
    const { dom, hook, requests, messages, finish } = await setup()
    try {
      let run!: Promise<void>
      assert.equal(hook.current.selectMode, true)
      await act(async () => { run = hook.current[operation]() })
      assert.equal(hook.current.selectMode, false)
      assert.equal(requests.length, 3)
      assert.equal(hook.current.bulkOperationPending, true)
      assert.equal(hook.current.bulkRefreshPending, operation === 'refreshSelectedBooks')
      await act(async () => {
        await hook.current.downloadSelectedBooks()
        await hook.current.refreshSelectedBooks()
      })
      assert.equal(requests.length, 3)
      await act(async () => { finish(requests[1]) })
      assert.equal(requests.length, 4)
      assert.equal(hook.current.bulkOperationPending, true)
      assert.equal(hook.current.selected.includes(getBookIdentityKey(books[1])), false)
      assert.equal(hook.current.selected.length, 4)
      if (operation === 'refreshSelectedBooks') {
        assert.equal(hook.current.webSearchResultBooks[1].title, 'Refreshed')
        assert.equal(hook.current.webSearchResultBooks[1].bookId, 'refreshed-1')
        assert.equal(hook.current.webSearchResultBooks[0].title, 'Book 0')
      }
      await act(async () => { finish(requests[0], true) })
      assert.equal(requests.length, 5)
      assert.ok(hook.current.selected.includes(getBookIdentityKey(books[0])))
      await act(async () => { requests.slice(2).forEach((request) => finish(request)); await run })
      assert.equal(hook.current.bulkOperationPending, false)
      assert.deepEqual(hook.current.selected, [getBookIdentityKey(books[0])])
      assert.equal(messages.length, 1)
      assert.match(messages[0], /4件.*1件は失敗/)
    } finally { await hook.unmount(); dom.cleanup() }
  })

  for (const change of ['route', 'api', 'unmount'] as const) {
    it(`${operation} aborts on ${change} and ignores late results without starting queued books`, async () => {
      const { dom, hook, requests, messages, finish } = await setup()
      let unmounted = false
      try {
        let run!: Promise<void>
        await act(async () => { run = hook.current[operation]() })
        assert.equal(requests.length, 3)
        if (change === 'unmount') {
          await hook.unmount()
          unmounted = true
        } else {
          await hook.rerender(change === 'route' ? { ...scope, routeKey: '/search?page=2' } : { ...scope, apiRevision: 1 })
          assert.equal(hook.current.bulkOperationPending, false)
        }
        assert.ok(requests.every((request) => request.signal.aborted))
        await act(async () => { requests.forEach((request) => finish(request)); await run })
        assert.equal(requests.length, 3)
        assert.deepEqual(messages, [])
        if (!unmounted) {
          assert.deepEqual(hook.current.webSearchResultBooks, books)
          assert.deepEqual(hook.current.selected, books.map(getBookIdentityKey))
        }
      } finally { if (!unmounted) await hook.unmount(); dom.cleanup() }
    })
  }
}
