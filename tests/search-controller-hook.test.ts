import assert from 'node:assert/strict'
import { it } from 'node:test'
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

it('continuous reader navigation preserves its mode and resets stale start identities', async () => {
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

    await act(async () => { hook.current.enterContinuousView(hook.current.searchResultBooks[0]) })
    params = new URL(dom.window.location.href).searchParams
    assert.equal(params.get('gid'), 'fixture')
    assert.equal(params.get('id'), 'book')

    await act(async () => { hook.current.searchByTag({ type: 'Artists', name: 'artist' }) })
    params = new URL(dom.window.location.href).searchParams
    assert.equal(params.get('view'), 'continuous')
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
