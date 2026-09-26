import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { it } from 'node:test'
import * as React from 'react'
import { createElement, type FormEvent } from 'react'
import { createRoot } from 'react-dom/client'
import { navigationGroups } from '../src/app/navigation'
import { navigate } from '../src/app/client-router'
import type { BookGroupedSearchRequest, EBookGroup } from '../src/models'
import type { DisplaySettings } from '../src/api'
import { createGroupBooksUrl, emptyCriteria } from '../src/features/search/search-utils'
import { useSearchController } from '../src/features/search/useSearchController'
import { act, deferred, installHookDom, renderHook } from './helpers/react-hook'

const options = {
  isWebSearch: false, isLibrarySearch: true, isMissingTagSearch: false, isGroupedSearch: true,
  isBookViewer: false, apiRevision: 0,
  displaySettings: { thumbnailColumns: 5 as const, colorTheme: 'default' as const, searchLimit: 20 as const },
  hubConnectionState: 'idle' as const, notify: () => {},
}
const book = (bookId: string) => ({ groupId: 'g', bookId, title: bookId, totalPage: 2, pageUrls: null, status: 'Downloaded' as const })
const groups: EBookGroup[] = [
  { keyTagValue: 'a & b', keyTagDisplayName: '作者A', totalBooksCount: 24, books: ['Z', 'A', 'B', 'C', 'D'].map(book) },
  { keyTagValue: null, keyTagDisplayName: '未所属', totalBooksCount: 3, books: [book('Z')] },
]
const response = (items = groups, status = 200) => new Response(JSON.stringify({
  success: status === 200, groups: items, totalPage: 3,
}), { status, headers: { 'Content-Type': 'application/json' } })

it('places Groups below Random and drills into a group with the agreed AND/OR and unassigned filters', () => {
  const items = navigationGroups[0].items
  assert.equal(items[items.findIndex((item) => item.href === '/search/random') + 1].href, '/search/grouped')
  const criteria = { ...emptyCriteria(), text: 'cat', tags: [{ type: 'Tags' as const, name: 'old' }], dateFrom: '2026-01-01', pagesMin: '10' }
  const and = createGroupBooksUrl(criteria, 'Artists', 'a & b', 'http://localhost')
  assert.equal(and.pathname, '/search')
  assert.deepEqual(and.searchParams.getAll('tag'), ['Tags:old', 'Artists:a & b'])
  const or = createGroupBooksUrl({ ...criteria, tagMode: 'or' }, 'Artists', 'a & b', 'http://localhost')
  assert.deepEqual(or.searchParams.getAll('tag'), ['Artists:a & b'])
  assert.equal(or.searchParams.get('tagMode'), null)
  for (const key of ['q', 'dateFrom', 'pagesMin']) assert.equal(or.searchParams.get(key), and.searchParams.get(key))
  const missing = createGroupBooksUrl(criteria, 'Artists', null, 'http://localhost')
  assert.equal(missing.pathname, '/search/missing-tags')
  assert.deepEqual(missing.searchParams.getAll('missingTagType'), ['Artists'])
  assert.deepEqual(missing.searchParams.getAll('tag'), ['Tags:old'])
  assert.equal(criteria.tags.length, 1)
})

it('uses grouped requests, preserves server ordering and conditions, and resets group pagination on changes', async () => {
  const dom = installHookDom('http://localhost/search/grouped?q=cat&tag=Tags:old&tagMode=or&groupBy=Parodies&groupSort=BookCount&page=2&direction=asc')
  const requests: BookGroupedSearchRequest[] = []
  globalThis.fetch = async (input, init) => {
    assert.equal(new URL(String(input)).pathname, '/api/book/search/grouped')
    requests.push(JSON.parse(String(init?.body)))
    return response()
  }
  const hook = await renderHook((displaySettings: DisplaySettings) => useSearchController({ ...options, displaySettings }), options.displaySettings as DisplaySettings)
  try {
    const request = requests.at(-1)!
    assert.equal(request.keyTagType, 'Parodies')
    assert.equal(request.groupSortType, 'BookCount')
    assert.equal(request.page, 2)
    assert.equal(request.groupsPerPage, 20)
    assert.equal(request.booksPerGroup, 4)
    assert.equal(request.isAscending, true)
    assert.equal(request.filter?.includePageUrls, false)
    assert.equal(request.filter?.isAnd, false)
    assert.deepEqual(request.filter?.texts, ['cat'])
    assert.deepEqual(request.filter?.tagSet, { Tags: ['old'] })
    assert.deepEqual(hook.current.visibleBooks.map((item) => item.bookId), ['Z', 'A', 'B', 'C'])
    assert.ok(hook.current.searchGroups.every((group) => group.bookKeys.length <= 4))
    assert.equal(hook.current.searchGroups.length, 2)
    assert.equal(hook.current.totalResultPages, 3)
    await act(async () => { hook.current.changeGrouping('Groups', 'TagName') })
    assert.equal(requests.at(-1)?.page, 1)
    assert.equal(requests.at(-1)?.keyTagType, 'Groups')
    assert.equal(requests.at(-1)?.groupSortType, 'TagName')
    await act(async () => { hook.current.setQuery('dog') })
    await act(async () => { hook.current.submitSearch({ preventDefault() {} } as FormEvent) })
    assert.equal(dom.window.location.pathname, '/search/grouped')
    assert.equal(requests.at(-1)?.keyTagType, 'Groups')
    assert.deepEqual(requests.at(-1)?.filter?.texts, ['dog'])
    assert.deepEqual(requests.at(-1)?.filter?.tagSet, { Tags: ['old'] })
    await act(async () => { hook.current.openAdvancedSearch() })
    await act(async () => { hook.current.setDraftCriteria({ ...hook.current.draftCriteria, pagesMin: '10' }) })
    await act(async () => { hook.current.applyAdvancedSearch({ preventDefault() {} } as FormEvent<HTMLFormElement>, () => true) })
    assert.equal(requests.at(-1)?.groupSortType, 'TagName')
    assert.equal(requests.at(-1)?.filter?.lowerPageCount, 10)
    await act(async () => { hook.current.goToResultPage(3) })
    assert.equal(requests.at(-1)?.page, 3)
    const beforeRefresh = requests.length
    await act(async () => { hook.current.refresh() })
    assert.equal(requests.length, beforeRefresh + 1)
    await act(async () => { navigate('/search/grouped?groupBy=invalid&groupSort=invalid') })
    assert.equal(requests.at(-1)?.keyTagType, 'Artists')
    assert.equal(requests.at(-1)?.groupSortType, 'LatestBook')
    const beforeColumnChanges = requests.length
    await hook.rerender({ ...options.displaySettings, thumbnailColumns: 2 })
    assert.equal(requests.at(-1)?.booksPerGroup, 4)
    await hook.rerender({ ...options.displaySettings, thumbnailColumns: 2, autoThumbnailColumns: true })
    assert.equal(requests.at(-1)?.booksPerGroup, 4)
    await hook.rerender({ ...options.displaySettings, thumbnailColumns: 2, autoThumbnailColumns: false })
    assert.equal(requests.at(-1)?.booksPerGroup, 4)
    assert.equal(requests.length, beforeColumnChanges)
    for (const searchLimit of [50, 100] as const) {
      await hook.rerender({ ...options.displaySettings, searchLimit })
      assert.equal(requests.at(-1)?.groupsPerPage, 20)
      assert.equal(requests.at(-1)?.booksPerGroup, 4)
      assert.equal(requests.length, beforeColumnChanges)
    }
  } finally {
    await hook.unmount()
    dom.cleanup()
  }
})

it('renders shelves without a visible grouping label and supports reload, errors, empty results and viewer links', async () => {
  const hooks = registerHooks({ load(url, context, nextLoad) {
    return url.endsWith('.css') ? { format: 'module', source: '', shortCircuit: true } : nextLoad(url, context)
  } })
  const previousReact = Object.getOwnPropertyDescriptor(globalThis, 'React')
  Object.defineProperty(globalThis, 'React', { configurable: true, value: React })
  const { SearchPage } = await import('../src/features/search/SearchPage')
  const dom = installHookDom('http://localhost/search/grouped')
  const pending = deferred<Response>()
  const groupResponse = async (count: number) => response(groups.map((group) => ({ ...group, books: group.books?.slice(0, count) })))
  let nextResponse = groupResponse
  globalThis.fetch = async (input, init) => new URL(String(input)).pathname === '/api/book/search/grouped'
    ? nextResponse((JSON.parse(String(init?.body)) as BookGroupedSearchRequest).booksPerGroup!) : new Response(new Blob())
  function Page({ settings }: { settings: DisplaySettings }) {
    return createElement(SearchPage, { controller: useSearchController({ ...options, displaySettings: settings }) })
  }
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  try {
    await act(async () => { root.render(createElement(Page, { settings: options.displaySettings })) })
    assert.equal(document.title, 'グループ | Nyapture')
    assert.equal(container.querySelector('h1')?.textContent, 'グループ')
    assert.equal(container.querySelector('.selection-toggle, .selection-toolbar, .selection-count'), null)
    assert.equal(container.querySelector<HTMLSelectElement>('[aria-label="グループ化するタグの種類"]')?.value, 'Artists')
    assert.doesNotMatch(container.textContent ?? '', /まとめ方|すべて見る|全て見る/)
    assert.equal(container.querySelectorAll('.book-shelf').length, 2)
    assert.equal(container.querySelector<HTMLElement>('.grouped-bookshelves')?.style.getPropertyValue('--thumbnail-columns'), '5')
    assert.equal(container.querySelector('.book-shelf')?.querySelectorAll('.book-card').length, 4)
    assert.equal(container.querySelector('.book-shelf h2 .tag-chip__label')?.textContent, '作者A')
    assert.match(container.querySelector('.book-shelf h2 .tag-chip__count')?.textContent ?? '', /24/)
    assert.match(container.querySelector('.book-cover a')?.getAttribute('href') ?? '', /book\/viewer/)
    await act(async () => { root.render(createElement(Page, { settings: { ...options.displaySettings, thumbnailColumns: 2 } })) })
    assert.equal(container.querySelector<HTMLElement>('.grouped-bookshelves')?.style.getPropertyValue('--thumbnail-columns'), '2')
    assert.equal(container.querySelector('.book-shelf')?.querySelectorAll('.book-card').length, 4)
    assert.equal(container.querySelector<HTMLElement>('.book-shelf .book-grid')?.style.getPropertyValue('--thumbnail-columns'), '2')
    assert.ok(container.querySelector('[aria-label="2ページへ移動"]'))
    const reload = container.querySelector<HTMLButtonElement>('[aria-label="結果を更新"]')!
    nextResponse = () => pending.promise
    await act(async () => { reload.click() })
    assert.equal(reload.disabled, true)
    assert.ok(container.querySelector('.grouped-bookshelves')?.hasAttribute('inert'))
    await act(async () => { pending.resolve(response([], 503)) })
    assert.match(container.querySelector('[role="alert"]')?.textContent ?? '', /検索結果を取得できませんでした/)
    assert.equal(container.querySelector('.book-shelf'), null)
    assert.equal(reload.disabled, false)
    nextResponse = async () => response([])
    await act(async () => { reload.click() })
    assert.match(container.textContent ?? '', /条件に一致する本がありません/)
    assert.equal(container.querySelector('.pagination'), null)
    nextResponse = groupResponse
    await act(async () => { reload.click() })
    await act(async () => { container.querySelector<HTMLButtonElement>('.book-shelf h2 button')!.click() })
    assert.equal(dom.window.location.pathname, '/search')
    assert.deepEqual(new URL(dom.window.location.href).searchParams.getAll('tag'), ['Artists:a & b'])
  } finally {
    await act(async () => { root.unmount() })
    container.remove()
    dom.cleanup()
    hooks.deregister()
    if (previousReact) Object.defineProperty(globalThis, 'React', previousReact)
    else Reflect.deleteProperty(globalThis, 'React')
  }
})
