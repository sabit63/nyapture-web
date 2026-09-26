import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { it } from 'node:test'
import * as React from 'react'
import { createElement, type FormEvent } from 'react'
import { createRoot } from 'react-dom/client'
import { navigationGroups, isNavigationItemActive } from '../src/app/navigation'
import type { BookSearchFilter } from '../src/models'
import { bookDownloadHubClient, type BookDownloadHubListener } from '../src/realtime/book-download-hub'
import { createSearchUrlForDestination, emptyCriteria } from '../src/features/search/search-utils'
import { useSearchController } from '../src/features/search/useSearchController'
import { act, deferred, installHookDom, renderHook } from './helpers/react-hook'

const options = {
  isWebSearch: false, isLibrarySearch: true, isMissingTagSearch: false, isRandomSearch: true,
  isBookViewer: false, apiRevision: 0,
  displaySettings: { thumbnailColumns: 5 as const, colorTheme: 'default' as const, searchLimit: 20 as const },
  hubConnectionState: 'idle' as const, notify: () => {},
}
const response = (books: unknown[] = [], status = 200) => new Response(JSON.stringify({
  success: status === 200, books, tags: [], totalCount: books.length, totalPage: books.length ? 1 : 0,
}), { status, headers: { 'Content-Type': 'application/json' } })
const book = (bookId: string) => ({
  groupId: 'g', bookId, title: bookId, totalPage: 2, pageUrls: null, status: 'Downloaded',
})

it('places Random immediately below Search and keeps filter URLs without sorting or pagination', () => {
  const items = navigationGroups[0].items
  const index = items.findIndex((item) => item.href === '/search')
  assert.equal(items[index + 1].label, 'ランダム')
  assert.equal(items[index + 1].href, '/search/random')
  assert.equal(isNavigationItemActive(items[index + 1], '/search/random'), true)
  assert.equal(isNavigationItemActive(items[index], '/search/random'), false)
  const url = createSearchUrlForDestination({
    ...emptyCriteria(), text: 'cat', tags: [{ type: 'Artists', name: 'a & b' }], tagMode: 'or', pagesMin: '2',
  }, { destination: 'random', origin: 'https://example.test', sortType: 'title', sortDirection: 'asc' })
  assert.equal(url.pathname, '/search/random')
  assert.equal(url.searchParams.get('q'), 'cat')
  assert.equal(url.searchParams.get('tag'), 'Artists:a & b')
  assert.equal(url.searchParams.get('tagMode'), 'or')
  assert.equal(url.searchParams.get('pagesMin'), '2')
  for (const key of ['page', 'sort', 'direction']) assert.equal(url.searchParams.has(key), false)
})

it('keeps the sampled order during reading and reconnects, and redraws explicitly with the current filters', async () => {
  const dom = installHookDom('http://localhost/search/random?q=cat&tag=Artists:a&tagMode=or&page=9&sort=title&direction=asc')
  const requests: BookSearchFilter[] = []
  globalThis.fetch = async (input, init) => {
    assert.equal(new URL(String(input)).pathname, '/api/book/search/random')
    requests.push(JSON.parse(String(init?.body)))
    return response([book('Z'), book('A')])
  }
  const originalSubscribe = bookDownloadHubClient.subscribe
  let listener: BookDownloadHubListener | undefined
  bookDownloadHubClient.subscribe = (value) => { listener = value; return () => {} }
  const hook = await renderHook(() => useSearchController(options), undefined)
  try {
    assert.deepEqual(requests[0].texts, ['cat'])
    assert.deepEqual(requests[0].tagSet, { Artists: ['a'] })
    assert.equal(requests[0].isAnd, false)
    assert.equal(requests[0].includePageUrls, false)
    assert.equal(requests[0].limit, 20)
    assert.equal(hook.current.resultPage, 1)
    assert.equal(hook.current.totalResultPages, 1)
    assert.deepEqual(hook.current.visibleBooks.map((item) => item.bookId), ['Z', 'A'])
    const initialCalls = requests.length
    await act(async () => { hook.current.enterContinuousView(hook.current.visibleBooks[1]) })
    assert.equal(hook.current.searchView, 'continuous')
    assert.equal(hook.current.continuousStart?.bookId, 'A')
    await act(async () => { hook.current.exitContinuousView(); listener?.onResyncRequested?.() })
    assert.equal(requests.length, initialCalls)
    await act(async () => { hook.current.toggleSelection('g\u0000Z') })
    await act(async () => { hook.current.refresh() })
    assert.equal(requests.length, initialCalls + 1)
    assert.deepEqual(hook.current.selected, [])
    assert.deepEqual(requests.at(-1), requests[0])
    await act(async () => { hook.current.openAdvancedSearch() })
    await act(async () => { hook.current.setDraftCriteria({ ...hook.current.draftCriteria, pagesMin: '10' }) })
    await act(async () => { hook.current.applyAdvancedSearch({ preventDefault() {} } as FormEvent<HTMLFormElement>, () => true) })
    assert.equal(dom.window.location.pathname, '/search/random')
    assert.equal(requests.at(-1)?.lowerPageCount, 10)
    assert.deepEqual(requests.at(-1)?.tagSet, { Artists: ['a'] })
  } finally {
    await hook.unmount()
    bookDownloadHubClient.subscribe = originalSubscribe
    dom.cleanup()
  }
})

it('renders Random with the shared reload button, empty results and errors without sort or pagination controls', async () => {
  const hooks = registerHooks({ load(url, context, nextLoad) {
    return url.endsWith('.css') ? { format: 'module', source: '', shortCircuit: true } : nextLoad(url, context)
  } })
  const previousReact = Object.getOwnPropertyDescriptor(globalThis, 'React')
  Object.defineProperty(globalThis, 'React', { configurable: true, value: React })
  const { SearchPage } = await import('../src/features/search/SearchPage')
  const dom = installHookDom('http://localhost/search/random')
  dom.window.scrollTo = () => undefined
  const pending = deferred<Response>()
  let calls = 0
  globalThis.fetch = async () => { calls++; return calls === 1 ? response() : pending.promise }
  let controller!: ReturnType<typeof useSearchController>
  function Page() {
    controller = useSearchController(options)
    return createElement(SearchPage, { controller })
  }
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  try {
    await act(async () => { root.render(createElement(Page)) })
    assert.equal(document.title, 'ランダム | Nyapture')
    assert.equal(container.querySelector('h1')?.textContent, 'ランダム')
    assert.doesNotMatch(container.textContent ?? '', /ダウンロード済み.*最大20冊|再抽選/)
    assert.match(container.textContent ?? '', /条件に一致する本がありません/)
    assert.equal(container.querySelector('.sort-control, .sort-direction-toggle, .pagination'), null)
    const redraw = container.querySelector<HTMLButtonElement>('button[aria-label="結果を更新"]')
    assert.ok(redraw)
    await act(async () => { redraw.click() })
    assert.equal(redraw.disabled, true)
    await act(async () => { pending.resolve(response([], 503)) })
    assert.match(container.querySelector('[role="alert"]')?.textContent ?? '', /検索結果を取得できませんでした/)
    assert.equal(redraw.disabled, false)
    assert.equal(calls, 2)
    globalThis.fetch = async (input) => new URL(String(input)).pathname === '/api/book/search/random'
      ? response([book('readable')]) : new Response(new Blob())
    await act(async () => { redraw.click() })
    await act(async () => { controller.enterContinuousView() })
    assert.ok(container.querySelector('.continuous-reader__book'))
    assert.equal(container.querySelector('[aria-label="検索結果の前後ページ"]'), null)
  } finally {
    await act(async () => { root.unmount() })
    container.remove()
    dom.cleanup()
    hooks.deregister()
    if (previousReact) Object.defineProperty(globalThis, 'React', previousReact)
    else Reflect.deleteProperty(globalThis, 'React')
  }
})
