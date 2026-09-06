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
        coverOpenAriaLabel: 'Fixture bookから連続閲覧',
      }))
    })

    const coverButton = container.querySelector<HTMLButtonElement>('.book-cover__open-button')
    const titleLink = container.querySelector<HTMLAnchorElement>('.book-card__title-row a')
    assert.ok(coverButton)
    assert.ok(titleLink)
    assert.equal(coverButton.getAttribute('aria-label'), 'Fixture bookから連続閲覧')
    assert.equal(titleLink.getAttribute('href'), '/book/viewer?id=book-1&gid=group-1')

    await act(async () => {
      coverButton.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
    })
    assert.equal(coverOpenCount, 1)
    assert.equal(dom.window.location.pathname, '/search')
  } finally {
    await act(async () => { root.unmount() })
    container.remove()
    dom.cleanup()
  }
})
