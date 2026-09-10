import assert from 'node:assert/strict'
import { it } from 'node:test'
import { registerHooks } from 'node:module'
import * as React from 'react'
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { FormEvent } from 'react'
import { NYA_BOOK_STATUSES } from '../src/models'
import type { BookSearchFilter, NyaBookStatus } from '../src/models'
import { buildBookSearchFilter } from '../src/api/books'
import { createSearchUrlForDestination, parseCriteriaForRoute, validateCriteria } from '../src/features/search/search-utils'
import { useSearchController } from '../src/features/search/useSearchController'
import { act, deferred, installHookDom, renderHook } from './helpers/react-hook'

const options = {
  isWebSearch: false, isLibrarySearch: true, isMissingTagSearch: false, isStatusSearch: true,
  isBookViewer: false, apiRevision: 0,
  displaySettings: { thumbnailColumns: 5 as const, colorTheme: 'default' as const },
  hubConnectionState: 'idle' as const, notify: () => {},
}
const response = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } })
const submit = { preventDefault() {} } as FormEvent<HTMLFormElement>

it('defaults to all statuses except Downloaded and round trips explicit and invalid selections', () => {
  const defaults = parseCriteriaForRoute(new URLSearchParams(), false, false, true)
  assert.deepEqual(defaults.statuses, NYA_BOOK_STATUSES.filter((status) => status !== 'Downloaded'))
  const criteria = parseCriteriaForRoute(new URLSearchParams('status=Downloaded&status=Cancel&status=Cancel&status=invalid'), false, false, true)
  assert.deepEqual(criteria.statuses, ['Downloaded', 'Cancel'])
  const url = createSearchUrlForDestination(criteria, { destination: 'status', origin: 'https://example.test' })
  assert.equal(url.pathname, '/search/status')
  assert.deepEqual(buildBookSearchFilter(parseCriteriaForRoute(url.searchParams, false, false, true), 'uploaded', 'desc').status, ['Downloaded', 'Cancel'])
  assert.equal(parseCriteriaForRoute(url.searchParams, false).statuses, undefined)
  assert.equal(parseCriteriaForRoute(url.searchParams, true).statuses, undefined)
  for (const parameter of ['status=', 'status=invalid']) {
    const empty = parseCriteriaForRoute(new URLSearchParams(parameter), false, false, true)
    assert.deepEqual(empty.statuses, [])
    assert.ok(validateCriteria(empty, false, true).statuses)
    const emptyUrl = createSearchUrlForDestination(empty, { destination: 'status', origin: 'https://example.test' })
    assert.deepEqual(parseCriteriaForRoute(emptyUrl.searchParams, false, false, true).statuses, [])
  }
})

it('commits status selections, preserves them in pagination and advanced search, and blocks empty searches', async () => {
  const dom = installHookDom('http://localhost/search/status')
  const requests: BookSearchFilter[] = []
  globalThis.fetch = async (_url, init) => {
    requests.push(JSON.parse(String(init?.body)))
    return response({ success: true, books: [], totalPage: 5 })
  }
  const hook = await renderHook(() => useSearchController(options), undefined)
  try {
    assert.deepEqual(requests[0].status, NYA_BOOK_STATUSES.filter((status) => status !== 'Downloaded'))
    const initialRequests = requests.length
    await act(async () => { hook.current.setDraftStatuses(['Cancel']); hook.current.setQuery('sample') })
    assert.equal(requests.length, initialRequests)
    await act(async () => { hook.current.submitSearch(submit) })
    assert.deepEqual(requests.at(-1)?.status, ['Cancel'])
    assert.deepEqual(requests.at(-1)?.texts, ['sample'])
    await act(async () => { hook.current.goToResultPage(2) })
    assert.equal(requests.at(-1)?.page, 2)
    assert.deepEqual(requests.at(-1)?.status, ['Cancel'])
    await act(async () => { hook.current.setDraftStatuses(['DownloadError']) })
    await act(async () => { hook.current.openAdvancedSearch() })
    assert.deepEqual(hook.current.draftCriteria.statuses, ['DownloadError'])
    await act(async () => { hook.current.applyAdvancedSearch(submit, () => true) })
    assert.deepEqual(requests.at(-1)?.status, ['DownloadError'])
    assert.equal(requests.at(-1)?.page, 1)
    assert.deepEqual(hook.current.draftStatuses, ['DownloadError'])
    await act(async () => { hook.current.setDraftStatuses([]) })
    const count = requests.length
    await act(async () => { hook.current.submitSearch(submit) })
    assert.ok(hook.current.statusesError)
    assert.equal(requests.length, count)
    assert.deepEqual(new URL(hook.current.getTagSearchHref({ type: 'Artists', name: 'artist' })).searchParams.getAll('status'), ['DownloadError'])
  } finally {
    await hook.unmount()
    dom.cleanup()
  }
})

it('does not issue an unfiltered request for an invalid status URL', async () => {
  const dom = installHookDom('http://localhost/search/status?status=invalid')
  let calls = 0
  globalThis.fetch = async () => { calls++; return response({ success: true, books: [] }) }
  const hook = await renderHook(() => useSearchController(options), undefined)
  try {
    assert.equal(calls, 0)
    assert.equal(hook.current.searchState, 'idle')
    assert.ok(hook.current.statusesError)
  } finally { await hook.unmount(); dom.cleanup() }
})

it('bulk download skips ineligible books, prevents duplicate runs, preserves failures, and supports bulk deletion', async () => {
  const dom = installHookDom('http://localhost/search/status')
  const statuses: NyaBookStatus[] = ['Cancel', 'DownloadError', 'Downloaded', 'Downloading', 'Standby', 'Shredding', 'SaveError']
  const books = statuses.map((status, i) => ({ groupId: 'g', bookId: String(i), title: String(i), status, totalPage: 1, url: i === 6 ? '' : `https://example.test/${i}` }))
  const started: string[] = []
  const first = deferred<Response>()
  const messages: string[] = []
  globalThis.fetch = async (url, init) => {
    if (String(url).includes('/api/download/start')) {
      const body = JSON.parse(String(init?.body)) as { url: string }
      started.push(body.url)
      if (body.url.endsWith('/0')) return first.promise
      return new Response('failed', { status: 500 })
    }
    return response({ success: true, books, totalPage: 1 })
  }
  const hook = await renderHook(() => useSearchController({ ...options, notify: (message) => messages.push(message) }), undefined)
  try {
    await act(async () => { hook.current.toggleSelectMode(); hook.current.selectAllVisibleBooks() })
    assert.equal(hook.current.downloadableSelectedCount, 2)
    let run!: Promise<void>
    await act(async () => { run = hook.current.downloadSelectedLibraryBooks() })
    assert.equal(hook.current.bulkDownloadPending, true)
    await act(async () => { await hook.current.downloadSelectedLibraryBooks() })
    assert.equal(started.length, 1)
    await act(async () => { first.resolve(response({ success: true })); await run })
    assert.deepEqual(started, ['https://example.test/0', 'https://example.test/1'])
    assert.equal(hook.current.bulkDownloadPending, false)
    assert.equal(hook.current.visibleBooks[0].status, 'Downloading')
    assert.equal(hook.current.selected.includes('g\u00000'), false)
    assert.equal(hook.current.selected.includes('g\u00001'), true)
    assert.match(messages.at(-1)!, /1件のダウンロード.*1件は失敗/)
    await act(async () => { hook.current.deleteSelectedLibraryBooks() })
    assert.equal(hook.current.deleteDialogOpen, true)
    assert.equal(hook.current.deleteDialogBooks.length, 6)
  } finally { await hook.unmount(); dom.cleanup() }
})

it('renders the status checkboxes and enables both bulk actions in selection mode', async () => {
  const hooks = registerHooks({ load(url, context, nextLoad) {
    return url.endsWith('.css') ? { format: 'module', source: '', shortCircuit: true } : nextLoad(url, context)
  } })
  const previousReact = Object.getOwnPropertyDescriptor(globalThis, 'React')
  Object.defineProperty(globalThis, 'React', { configurable: true, value: React })
  const { SearchPage } = await import('../src/features/search/SearchPage')
  const dom = installHookDom('http://localhost/search/status')
  dom.window.scrollTo = () => undefined
  dom.window.HTMLDialogElement.prototype.close = function () { this.removeAttribute('open') }
  globalThis.fetch = async () => response({ success: true, books: [{
    groupId: 'g', bookId: '1', title: 'Fixture', status: 'Cancel', totalPage: 1, url: 'https://example.test/1',
  }], totalPage: 1 })
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
    assert.equal(container.querySelector('h1')?.textContent, 'ステータス検索')
    const checks = Array.from(container.querySelectorAll<HTMLInputElement>('fieldset[aria-label="BookStatus"] input'))
    assert.equal(checks.length, NYA_BOOK_STATUSES.length)
    assert.equal(checks.filter((input) => !input.checked).length, 1)
    assert.equal(checks.find((input) => !input.checked)?.parentElement?.textContent, 'ダウンロード済み')
    await act(async () => { controller.toggleSelectMode(); controller.selectAllVisibleBooks() })
    for (const label of ['選択を削除', '選択をダウンロード']) {
      const button = container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)
      assert.ok(button)
      assert.equal(button.disabled, false)
      assert.equal(button.closest('.selection-toolbar-reveal')?.getAttribute('data-open'), 'true')
    }
  } finally {
    await act(async () => { root.unmount() })
    container.remove()
    dom.cleanup()
    hooks.deregister()
    if (previousReact) Object.defineProperty(globalThis, 'React', previousReact)
    else Reflect.deleteProperty(globalThis, 'React')
  }
})
