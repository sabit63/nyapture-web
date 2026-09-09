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
