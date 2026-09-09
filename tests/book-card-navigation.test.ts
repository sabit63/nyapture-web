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
    await act(async () => { root.render(createElement(BookCard, { ...props, selectMode: false })) })
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
  globalThis.fetch = async (input) => {
    const path = new URL(String(input)).pathname
    if (path === '/api/web-cache/search') return new Response(JSON.stringify({
      books: ['saved', 'standby', 'candidate'].map((id) => ({ groupId: 'g', bookId: id, title: id, totalPage: 3 })), totalPage: 1,
    }))
    if (path === '/api/download/status-all') return new Response(JSON.stringify({
      saved: { book: { groupId: 'g', bookId: 'saved', totalPage: 3, status: 'Downloaded' }, executionState: 'Completed' },
      standby: { book: { groupId: 'g', bookId: 'standby', totalPage: 3, status: 'Standby' } },
    }))
    if (path.includes('config')) return new Response(JSON.stringify({ config: { sites: [] } }))
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
