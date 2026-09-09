import assert from 'node:assert/strict'
import { it } from 'node:test'
import type { FormEvent } from 'react'
import { useSearchController } from '../src/features/search/useSearchController'
import { act, installHookDom, renderHook } from './helpers/react-hook'

it('composed search controller synchronizes URL state, execution, selection and refresh', async () => {
  const dom = installHookDom('http://localhost/search?q=sample')
  const requests: { texts?: string[]; page?: number }[] = []
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as { texts?: string[]; page?: number }
    requests.push(body)
    return new Response(JSON.stringify({
      success: true,
      books: [{ groupId: 'fixture', bookId: 'book', title: `page ${body.page}`, totalPage: 1 }],
      totalPage: 5,
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
    notify: () => {},
  }), undefined)
  try {
    assert.equal(hook.current.searchState, 'success')
    assert.equal(hook.current.criteria.text, 'sample')
    await act(async () => { hook.current.toggleSelection('selected') })
    assert.deepEqual(hook.current.selected, ['selected'])
    await act(async () => { hook.current.setResultPage(3) })
    assert.equal(hook.current.resultPage, 3)
    assert.equal(new URL(dom.window.location.href).searchParams.get('page'), '3')
    assert.deepEqual(hook.current.selected, [])
    assert.equal(hook.current.searchState, 'success')
    assert.equal(requests.at(-1)?.page, 3)
    await act(async () => { hook.current.applyBookTitleChange('fixture', 'book', 'edited title') })
    assert.equal(hook.current.searchResultBooks[0]?.title, 'edited title')
    const count = requests.length
    await act(async () => { hook.current.refresh() })
    assert.equal(requests.length, count + 1)
    assert.equal(requests.at(-1)?.page, 3)
  } finally {
    await hook.unmount()
    dom.cleanup()
  }
})

it('reading navigation preserves continuous mode but tag searches start in the grid', async () => {
  const dom = installHookDom('http://localhost/search?q=sample&page=1&view=continuous&gid=fixture&id=book')
  globalThis.fetch = async () => new Response(JSON.stringify({
    success: true,
    books: [{
      groupId: 'fixture',
      bookId: 'book',
      title: 'Fixture',
      totalPage: 3,
      status: 'Downloaded',
    }],
    totalPage: 5,
  }), { headers: { 'Content-Type': 'application/json' } })
  const hook = await renderHook(() => useSearchController({
    isWebSearch: false,
    isLibrarySearch: true,
    isMissingTagSearch: false,
    isBookViewer: false,
    apiRevision: 0,
    displaySettings: { thumbnailColumns: 5, colorTheme: 'default' },
    hubConnectionState: 'idle',
    notify: () => {},
  }), undefined)

  try {
    assert.equal(hook.current.searchView, 'continuous')
    assert.deepEqual(hook.current.continuousStart, { groupId: 'fixture', bookId: 'book' })

    await act(async () => { hook.current.goToResultPage(2) })
    let params = new URL(dom.window.location.href).searchParams
    assert.equal(params.get('view'), 'continuous')
    assert.equal(params.get('page'), '2')
    assert.equal(params.has('gid'), false)
    assert.equal(params.has('id'), false)

    const continuousHref = hook.current.getContinuousViewHref(hook.current.searchResultBooks[0])
    const continuousUrl = new URL(continuousHref)
    assert.equal(continuousUrl.searchParams.get('q'), 'sample')
    assert.equal(continuousUrl.searchParams.get('page'), '2')
    await act(async () => { hook.current.enterContinuousView(hook.current.searchResultBooks[0]) })
    assert.equal(dom.window.location.href, continuousHref)
    params = new URL(dom.window.location.href).searchParams
    assert.equal(params.get('gid'), 'fixture')
    assert.equal(params.get('id'), 'book')

    const tagHref = hook.current.getTagSearchHref({ type: 'Artists', name: 'artist' })
    assert.equal(new URL(tagHref).searchParams.has('view'), false)
    assert.equal(new URL(tagHref).searchParams.has('gid'), false)
    await act(async () => { hook.current.searchByTag({ type: 'Artists', name: 'artist' }) })
    assert.equal(dom.window.location.href, tagHref)
    params = new URL(dom.window.location.href).searchParams
    assert.equal(params.has('view'), false)
    assert.equal(params.has('gid'), false)
    assert.equal(params.has('id'), false)

    await act(async () => { hook.current.exitContinuousView() })
    params = new URL(dom.window.location.href).searchParams
    assert.equal(params.has('view'), false)
    assert.equal(params.has('gid'), false)
    assert.equal(params.has('id'), false)
  } finally {
    await hook.unmount()
    dom.cleanup()
  }
})

for (const pathname of ['/search', '/search/missing-tags', '/book/viewer']) {
  it(`tag href matches left-click navigation from ${pathname}`, async () => {
    const dom = installHookDom(`http://localhost${pathname}?missingTagType=Artists&missingTagType=Groups`)
    globalThis.fetch = async () => new Response(JSON.stringify({ success: true, books: [], totalPage: 1 }))
    const hook = await renderHook(() => useSearchController({
      isWebSearch: false,
      isLibrarySearch: pathname === '/search',
      isMissingTagSearch: pathname === '/search/missing-tags',
      isBookViewer: pathname === '/book/viewer',
      apiRevision: 0,
      displaySettings: { thumbnailColumns: 5, colorTheme: 'default' },
      hubConnectionState: 'idle',
      notify: () => {},
    }), undefined)
    try {
      const tag = { type: 'Groups', name: 'raw/日本語 &?#', displayName: '表示名' } as const
      const originalHref = dom.window.location.href
      const href = hook.current.getTagSearchHref(tag)
      assert.equal(dom.window.location.href, originalHref)
      const url = new URL(href)
      assert.equal(url.pathname, pathname === '/search/missing-tags' ? pathname : '/search')
      assert.equal(url.searchParams.get('tag'), `Groups:${tag.name}`)
      assert.equal(url.searchParams.get('page'), '1')
      assert.deepEqual(url.searchParams.getAll('missingTagType'), pathname === '/search/missing-tags' ? ['Artists', 'Groups'] : [])
      await act(async () => { hook.current.searchByTag(tag) })
      assert.equal(dom.window.location.href, href)
    } finally {
      await hook.unmount()
      dom.cleanup()
    }
  })
}


for (const action of ['query', 'advanced', 'sort', 'direction', 'group'] as const) {
  it(`returns to grid on ${action} while refresh preserves the reading URL`, async () => {
    const dom = installHookDom('http://localhost/search?q=sample&page=3&view=continuous&gid=fixture&id=book')
    const originalFetch = globalThis.fetch
    globalThis.fetch = async () => new Response(JSON.stringify({ success: true, books: [], totalPage: 5 }))
    const hook = await renderHook(() => useSearchController({
      isWebSearch: false, isLibrarySearch: true, isMissingTagSearch: false,
      isBookViewer: false, apiRevision: 0,
      displaySettings: { thumbnailColumns: 5, colorTheme: 'default' },
      hubConnectionState: 'idle', notify: () => {},
    }), undefined)
    try {
      const readingHref = dom.window.location.href
      await act(async () => { hook.current.refresh() })
      assert.equal(dom.window.location.href, readingHref)
      assert.equal(hook.current.searchView, 'continuous')
      const event = { preventDefault() {} } as FormEvent<HTMLFormElement>
      if (action === 'query') {
        await act(async () => { hook.current.setQuery('new query') })
        await act(async () => { hook.current.submitSearch(event) })
      } else if (action === 'advanced') {
        await act(async () => { hook.current.setDraftCriteria((current) => ({ ...current, pagesMin: '20' })) })
        await act(async () => { hook.current.applyAdvancedSearch(event, () => true) })
      } else if (action === 'sort') {
        await act(async () => { hook.current.setSortType('title') })
      } else if (action === 'direction') {
        await act(async () => { hook.current.setSortDirection('asc') })
      } else {
        const tag = { type: 'Groups', name: 'group' } as const
        const href = hook.current.getTagSearchHref(tag)
        assert.equal(new URL(href).searchParams.has('view'), false)
        await act(async () => { hook.current.searchByTag(tag) })
        assert.equal(dom.window.location.href, href)
      }
      const params = new URL(dom.window.location.href).searchParams
      assert.equal(hook.current.searchView, 'grid')
      for (const key of ['view', 'gid', 'id']) assert.equal(params.has(key), false)
      assert.equal(params.get('page'), '1')
    } finally {
      await hook.unmount()
      globalThis.fetch = originalFetch
      dom.cleanup()
    }
  })
}
