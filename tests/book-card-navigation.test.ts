import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { it } from 'node:test'
import * as React from 'react'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'

import type { ApiBookCardModel } from '../src/api'
import { installHookDom } from './helpers/react-hook'

registerHooks({
  load(url, context, nextLoad) {
    if (url.endsWith('.css')) {
      return { format: 'module', source: '', shortCircuit: true }
    }
    return nextLoad(url, context)
  },
})
Object.defineProperty(globalThis, 'React', { configurable: true, value: React })

const book: ApiBookCardModel = {
  groupId: 'group-1',
  bookId: 'book-1',
  apiGroupId: 'group-1',
  apiBookId: 'book-1',
  url: 'https://example.invalid/book-1',
  title: 'Fixture book',
  captions: {},
  totalPage: 3,
  tagSet: {},
  uploadedTime: '2026-09-06T00:00:00Z',
  pageUrls: [],
  status: 'Downloaded',
  tags: [],
  cover: 'violet',
}

it('keeps the loaded thumbnail when selection mode changes retry visibility', async (t) => {
  const { Thumbnail } = await import('../src/components/Thumbnail')
  const dom = installHookDom()
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  let requests = 0
  const revoked: string[] = []
  t.mock.method(URL, 'createObjectURL', () => `blob:thumbnail-${requests}`)
  t.mock.method(URL, 'revokeObjectURL', (url: string) => { revoked.push(url) })
  const load = async () => { requests++; return new Blob(['image']) }
  const render = async (selectMode: boolean, reloadKey = 0) => {
    await act(async () => {
      root.render(createElement(Thumbnail, {
        alt: 'Fixture', load, reloadKey, retryOnError: !selectMode,
        loadingPolicy: { mode: 'page', viewports: 3 }, linkHref: '/book',
      }))
    })
  }
  try {
    await render(false)
    const image = container.querySelector('img')!
    assert.ok(image)
    await act(async () => { image.dispatchEvent(new dom.window.Event('load')) })
    for (const selectMode of [true, false]) {
      await render(selectMode)
      assert.equal(requests, 1)
      assert.equal(container.querySelector('img'), image)
      assert.ok(container.querySelector('.is-loaded'))
      assert.equal(container.querySelector('.book-cover__skeleton'), null)
      assert.deepEqual(revoked, [])
    }
    await render(false, 1)
    assert.equal(requests, 2)
    assert.deepEqual(revoked, ['blob:thumbnail-1'])
    assert.notEqual(container.querySelector('img'), image)
  } finally {
    await act(async () => { root.unmount() })
    container.remove()
    dom.cleanup()
  }
})

it('removes every thumbnail action during shredding and restores actions after cancellation', async () => {
  const { BookCard } = await import('../src/components/BookCard')
  const dom = installHookDom('http://localhost/search')
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  let downloads = 0
  const props = {
    book: { ...book, thumbnailUrl: 'https://example.invalid/cover.jpg', status: 'Shredding' as const },
    selectMode: false, selected: false, onToggle: () => {}, onTagSearch: () => {},
    onOpen: () => {}, onRefresh: () => {}, onDelete: () => {},
    onDownload: () => { downloads++ },
    extraActions: createElement('a', { href: 'https://example.invalid/source' }, '配信元'),
  }
  try {
    for (const selectMode of [false, true]) {
      await act(async () => { root.render(createElement(BookCard, { ...props, selectMode })) })
      assert.equal(container.querySelector('.book-cover button, .book-cover a'), null)
      assert.equal(container.querySelector('.card-actions'), null)
    }
    await act(async () => { root.render(createElement(BookCard, { ...props, book: { ...book, status: 'Cancel' } })) })
    const download = container.querySelector<HTMLButtonElement>('[aria-label="Fixture bookをダウンロード"]')
    assert.ok(download)
    await act(async () => { download.click() })
    assert.equal(downloads, 1)
  } finally {
    await act(async () => { root.unmount() })
    container.remove()
    dom.cleanup()
  }
})

it('keeps disabled status actions visible and replaces them with selection in selection mode', async () => {
  const { BookCard } = await import('../src/components/BookCard')
  const dom = installHookDom('http://localhost/search')
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  const props = {
    book: { ...book, status: 'Cancel' as const },
    selectMode: false, selected: false, onToggle: () => {}, onTagSearch: () => {},
  }
  const downloadSelector = '[aria-label="Fixture bookをダウンロード"]'
  try {
    await act(async () => { root.render(createElement(BookCard, props)) })
    assert.equal(container.querySelector<HTMLButtonElement>(downloadSelector)?.disabled, true)
    await act(async () => { root.render(createElement(BookCard, { ...props, onDownload: () => {}, downloadDisabled: true })) })
    assert.equal(container.querySelector<HTMLButtonElement>(downloadSelector)?.disabled, true)
    await act(async () => { root.render(createElement(BookCard, { ...props, onDownload: () => {}, selectMode: true })) })
    assert.ok(container.querySelector('.card-select'))
    assert.equal(container.querySelector('.card-actions'), null)
  } finally {
    await act(async () => { root.unmount() })
    container.remove()
    dom.cleanup()
  }
})

it('uses the status action matrix and shows selection except during shredding', async () => {
  const { BookCard } = await import('../src/components/BookCard')
  const dom = installHookDom('http://localhost/search')
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  const cases = [
    ['Unknown', ['再読み込み', 'ダウンロード', '削除']],
    ['Standby', ['再読み込み', 'ダウンロード', '削除']],
    ['Cancel', ['再読み込み', 'ダウンロード', '削除']],
    ['DownloadError', ['再読み込み', 'ダウンロード', '削除']],
    ['SaveError', ['再読み込み', 'ダウンロード', '削除']],
    ['ShortPage', ['再読み込み', 'ダウンロード', '削除']],
    ['Deleted', ['再読み込み', 'ダウンロード', '削除']],
    ['WebBook', ['再読み込み', 'ダウンロード']],
    ['WebBookInPage', ['再読み込み', 'ダウンロード']],
    ['Downloading', ['削除']], ['Downloaded', ['再読み込み']], ['Shredding', []],
  ] as const
  try {
    for (const [status, expected] of cases) {
      for (const selectMode of [false, true]) {
        for (const handler of [undefined, () => {}]) {
          await act(async () => { root.render(createElement(BookCard, {
            book: { ...book, status }, selectMode, selected: false,
            onToggle: () => {}, onTagSearch: () => {},
            onRefresh: handler, onDownload: handler, onDelete: handler,
          })) })
          const statusLabels = {
            Unknown: '状態不明', Standby: '待機中', Downloaded: 'ダウンロード済み', Downloading: 'DL',
            Cancel: 'キャンセル', DownloadError: '取得失敗', SaveError: '保存失敗', ShortPage: 'ページ不足',
            Shredding: '削除中', Deleted: '削除済み', WebBook: '未保存', WebBookInPage: '検索候補',
          }
          assert.equal(container.querySelector('.book-cover [data-book-status]')?.textContent, `状態: ${statusLabels[status]}`)
          const labels = [...container.querySelectorAll('.card-action')].map((button) => button.getAttribute('aria-label'))
          assert.deepEqual(labels, selectMode ? [] : expected.map((label) => `Fixture bookを${label}`), `${status}, select=${selectMode}`)
          const selection = container.querySelector<HTMLButtonElement>('.card-select')
          assert.equal(Boolean(selection), selectMode && status !== 'Shredding')
          if (selection) assert.equal(selection.disabled, status === 'Downloading')
        }
      }
    }
  } finally {
    await act(async () => { root.unmount() })
    container.remove()
    dom.cleanup()
  }
})

it('uses the cover callback without replacing the title viewer link', async () => {
  const { BookCard } = await import('../src/components/BookCard')
  const dom = installHookDom('http://localhost/search?q=fixture')
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  let coverOpenCount = 0

  try {
    await act(async () => {
      root.render(createElement(BookCard, {
        book,
        selectMode: false,
        selected: false,
        onToggle: () => undefined,
        onTagSearch: () => undefined,
        onCoverOpen: () => { coverOpenCount += 1 },
        coverHref: '/search?q=fixture&view=continuous&gid=group-1&id=book-1',
        coverOpenAriaLabel: 'Fixture bookから連続閲覧',
      }))
    })

    const coverButton = container.querySelector<HTMLAnchorElement>('a.book-cover__link')
    const titleLink = container.querySelector<HTMLAnchorElement>('.book-card__title-row a')
    assert.ok(coverButton)
    assert.ok(titleLink)
    assert.equal(container.querySelector('.book-cover__open-button'), null)
    assert.equal(new URL(coverButton.href).searchParams.get('view'), 'continuous')
    assert.equal(coverButton.getAttribute('aria-label'), 'Fixture bookから連続閲覧')
    assert.equal(titleLink.getAttribute('href'), '/book/viewer?id=book-1&gid=group-1')

    for (const [name, options] of [
      ['auxclick', { button: 1 }], ['click', { ctrlKey: true }], ['click', { metaKey: true }],
    ] as const) {
      let prevented: boolean | undefined
      document.addEventListener(name, (event) => { prevented = event.defaultPrevented; event.preventDefault() }, { once: true })
      await act(async () => { coverButton.dispatchEvent(new dom.window.MouseEvent(name, { ...options, bubbles: true, cancelable: true })) })
      assert.equal(prevented, false)
      assert.equal(coverOpenCount, 0)
    }
    await act(async () => { coverButton.click() })
    assert.equal(coverOpenCount, 1)
    assert.equal(dom.window.location.pathname, '/search')
  } finally {
    await act(async () => { root.unmount() })
    container.remove()
    dom.cleanup()
  }
})

it('thumbnail selection and card actions do not follow the viewer link', async () => {
  const { BookCard } = await import('../src/components/BookCard')
  const dom = installHookDom('http://localhost/search')
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  let toggled = 0
  let downloaded = 0
  const props = { book: { ...book, status: 'Standby' as const }, selectMode: true, selected: false,
    onToggle: () => { toggled++ }, onTagSearch: () => {}, onDownload: () => { downloaded++ } }
  try {
    await act(async () => { root.render(createElement(BookCard, props)) })
    const link = container.querySelector<HTMLAnchorElement>('a.book-cover__link')!
    await act(async () => { link.click() })
    assert.equal(toggled, 1)
    assert.equal(dom.window.location.pathname, '/search')
    const selection = container.querySelector<HTMLButtonElement>('.card-select')!
    assert.equal(selection.querySelector('svg'), null)
    assert.equal(selection.getAttribute('aria-pressed'), 'false')
    await act(async () => { selection.click() })
    assert.equal(toggled, 2)
    await act(async () => { root.render(createElement(BookCard, { ...props, selected: true })) })
    assert.equal(selection.getAttribute('aria-pressed'), 'true')
    assert.ok(selection.querySelector('svg'))
    assert.equal(selection.getAttribute('aria-label'), 'Fixture bookを選択解除')
    await act(async () => { selection.click() })
    assert.equal(toggled, 3)
    for (const disabled of [{ actionsDisabled: true }, { openDisabled: true }]) {
      await act(async () => { root.render(createElement(BookCard, { ...props, ...disabled })) })
      assert.equal(selection.disabled, true)
      await act(async () => { selection.click() })
      assert.equal(toggled, 3)
    }
    await act(async () => { root.render(createElement(BookCard, { ...props, selectMode: false })) })
    assert.equal(container.querySelector('.card-select'), null)
    const download = container.querySelector<HTMLButtonElement>('[aria-label="Fixture bookをダウンロード"]')!
    assert.ok(download)
    assert.equal(download.closest('a'), null)
    await act(async () => { download.click() })
    assert.equal(downloaded, 1)
    assert.equal(dom.window.location.pathname, '/search')
  } finally {
    await act(async () => { root.unmount() })
    container.remove()
    dom.cleanup()
  }
})

it('Web Cache changes persisted results to viewer links while retaining candidate detail buttons', async () => {
  const { WebCachePage } = await import('../src/features/web-cache/WebCachePage')
  const dom = installHookDom('http://localhost/web-cache')
  dom.window.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', '') }
  dom.window.HTMLDialogElement.prototype.close = function () { this.removeAttribute('open') }
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  globalThis.fetch = async (input, init) => {
    const path = new URL(String(input)).pathname
    if (path === '/api/web-cache/search') return new Response(JSON.stringify({
      books: ['saved', 'standby', 'candidate'].map((id) => ({ groupId: 'g', bookId: id, title: id, totalPage: 3, url: `https://example.invalid/${id}` })), totalPage: 1,
    }))
    if (path === '/api/web/book') {
      assert.equal(init?.method, 'POST')
      assert.equal(JSON.parse(String(init?.body)), 'https://example.invalid/saved')
      return Response.json({ success: true, book: {
        groupId: 'g', bookId: 'saved', title: 'saved', status: 'Downloaded', totalPage: 3,
        tagSet: { Artists: ['existing', 'added'] },
      } })
    }
    if (path === '/api/download/status-all') return new Response(JSON.stringify({
      saved: { book: { groupId: 'g', bookId: 'saved', totalPage: 3, status: 'Downloaded' }, executionState: 'Completed' },
      standby: { book: { groupId: 'g', bookId: 'standby', totalPage: 3, status: 'Standby' } },
    }))
    if (path.includes('config')) return new Response(JSON.stringify({ config: { sites: [] } }))
    if (path === '/api/web-cache/g/standby') return new Response(JSON.stringify({
      success: true, data: { groupId: 'g', bookId: 'standby', title: 'refreshed standby', totalPage: 3 },
    }))
    const response = new Response(null)
    response.blob = async () => new Blob(['fixture'], { type: 'image/png' })
    return response
  }
  try {
    await act(async () => { root.render(createElement(WebCachePage, {
      apiRevision: 0, displaySettings: { thumbnailColumns: 5, colorTheme: 'default' },
      notify: () => {}, onTagSearchDestinationRequest: () => {},
    })) })
    await act(async () => { await new Promise<void>((resolve) => dom.window.requestAnimationFrame(() => resolve())) })
    for (const id of ['saved', 'standby']) {
      const card = container.querySelector(`[data-book-id="${id}"]`)!
      assert.ok(card)
      const link = card.querySelector<HTMLAnchorElement>('a.book-cover__link')
      assert.ok(link)
      assert.equal(new URL(link.href).pathname, '/book/viewer')
      assert.equal(new URL(link.href).searchParams.get('id'), id)
      assert.equal(card.querySelector('.book-cover__open-button'), null)
    }
    const candidate = container.querySelector('[data-book-id="candidate"]')!
    assert.ok(candidate.querySelector('button.book-cover__open-button'))
    assert.equal(candidate.querySelector('a.book-cover__link'), null)
    assert.ok(candidate.querySelector('[aria-label="candidateを再読み込み"]'))
    assert.equal(candidate.querySelector('[aria-label="candidateを削除"]'), null)
    const refresh = container.querySelector<HTMLButtonElement>('[aria-label="standbyを再読み込み"]')!
    assert.ok(refresh)
    await act(async () => { refresh.click() })
    const refreshed = container.querySelector('[data-book-id="standby"]')!
    assert.equal(refreshed.getAttribute('data-book-status'), 'Standby')
    assert.ok(refreshed.textContent?.includes('refreshed standby'))
    const savedRefresh = container.querySelector<HTMLButtonElement>('[aria-label="savedを再読み込み"]')!
    assert.ok(savedRefresh)
    await act(async () => { savedRefresh.click() })
    const saved = container.querySelector('[data-book-id="saved"]')!
    assert.equal(saved.getAttribute('data-book-status'), 'Downloaded')
    assert.ok(saved.textContent?.includes('existing'))
    assert.ok(saved.textContent?.includes('added'))
    await act(async () => { saved.querySelector<HTMLButtonElement>('[aria-label="savedを再読み込み"]')!.click() })
    assert.equal(saved.querySelectorAll('.tag-chip').length, 2)
  } finally {
    await act(async () => { root.unmount() })
    container.remove()
    dom.cleanup()
  }
})

it('keeps unrelated cards idle while opening details and tag actions', async () => {
  const { SearchPage } = await import('../src/features/search/SearchPage')
  const { useSearchController } = await import('../src/features/search/useSearchController')
  const dom = installHookDom('http://localhost/search')
  dom.window.scrollTo = () => undefined
  dom.window.HTMLDialogElement.prototype.close = function () { this.removeAttribute('open') }
  globalThis.fetch = async () => new Response(JSON.stringify({ success: true,
    books: [book, { ...book, bookId: 'book-2', apiBookId: 'book-2' }], totalPage: 1,
  }), { headers: { 'Content-Type': 'application/json' } })
  const options = {
    isWebSearch: false, isLibrarySearch: true, isMissingTagSearch: false,
    isBookViewer: false, apiRevision: 0,
    displaySettings: { thumbnailColumns: 5 as const, colorTheme: 'default' as const },
    hubConnectionState: 'idle' as const, notify: () => {},
  }
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
    assert.equal(container.querySelectorAll('.book-card').length, 2)
    await act(async () => { controller.applyBookTagChange({ ...controller.visibleBooks[0], tags: [{ type: 'Artists', name: 'fixture' }] }) })
    const otherBook = controller.visibleBooks[1]
    const tags = otherBook.tags
    let reads = 0
    Object.defineProperty(otherBook, 'tags', { configurable: true, get() { reads++; return tags } })
    const trigger = container.querySelector<HTMLButtonElement>('.tag-overflow')!
    assert.ok(trigger)
    await act(async () => { trigger.click() })
    assert.ok(container.querySelector('#book-viewer-details[open]'))
    assert.equal(reads, 0, 'details must not render or filter other cards')
    await act(async () => { controller.openTagSearchDestination({ type: 'Artists', name: 'fixture' }, trigger) })
    assert.equal(controller.tagSearchDestinationDialogOpen, true)
    assert.equal(reads, 0, 'tag actions must not render or filter other cards')
    await act(async () => { controller.toggleSelection('group-1:book-2') })
    assert.ok(reads > 0, 'result changes still render the grid')
  } finally {
    await act(async () => { root.unmount() })
    container.remove()
    dom.cleanup()
  }
})

it('mounts tag contents on demand and supports reopening', async () => {
  const { BookCard } = await import('../src/components/BookCard')
  const dom = installHookDom()
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  try {
    await act(async () => { root.render(createElement(BookCard, {
      book: { ...book, tags: [{ type: 'Artists', name: 'fixture' }] },
      selectMode: false, selected: false, onToggle: () => {}, onTagSearch: () => {},
    })) })
    const trigger = container.querySelector<HTMLButtonElement>('.tag-overflow')!
    assert.equal(container.querySelector('.tags-dialog__panel'), null)
    for (let index = 0; index < 2; index++) {
      await act(async () => { trigger.click() })
      assert.equal(container.querySelectorAll('.tags-dialog__chips .tag-chip').length, 1)
      const close = container.querySelector<HTMLButtonElement>('.tags-dialog__header button')!
      await act(async () => { close.click() })
      assert.equal(container.querySelector('.tags-dialog__panel'), null)
    }
  } finally {
    await act(async () => { root.unmount() })
    container.remove()
    dom.cleanup()
  }
})
