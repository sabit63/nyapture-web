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

const book = (id: string, title: string): ApiBookCardModel => ({
  groupId: 'group-1',
  bookId: id,
  apiGroupId: 'group-1',
  apiBookId: id,
  url: `https://example.invalid/${id}`,
  title,
  captions: {},
  totalPage: 1,
  tagSet: {},
  uploadedTime: '2026-09-06T00:00:00Z',
  pageUrls: [],
  status: 'Downloaded',
  tags: [],
  cover: 'violet',
})

it('changes books for deliberate touch, mouse, and trackpad gestures outside controls', async () => {
  const { SearchContinuousReader } = await import('../src/features/search/SearchContinuousReader')
  const dom = installHookDom('http://localhost/search?view=continuous')
  const originalIntersectionObserver = Object.getOwnPropertyDescriptor(globalThis, 'IntersectionObserver')
  class NoopIntersectionObserver {
    readonly root = null
    readonly rootMargin = '0px'
    readonly thresholds: number[] = []
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() { return [] }
  }
  Object.defineProperty(globalThis, 'IntersectionObserver', {
    configurable: true,
    value: NoopIntersectionObserver,
  })
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  const books = [book('book-1', 'First'), book('book-2', 'Second')]
  const jumps: ApiBookCardModel[] = []

  const dispatchPointer = (
    target: Element,
    type: string,
    x: number,
    y: number,
    pointerType = 'touch',
  ) => {
    const event = new dom.window.MouseEvent(type, { bubbles: true, clientX: x, clientY: y })
    Object.defineProperties(event, {
      pointerId: { value: 1 },
      pointerType: { value: pointerType },
      isPrimary: { value: true },
    })
    target.dispatchEvent(event)
  }

  try {
    await act(async () => {
      root.render(createElement(SearchContinuousReader, {
        books,
        startIndex: 0,
        resultPage: 1,
        totalResultPages: 1,
        isLoading: false,
        onActiveBookChange: () => undefined,
        onBookJump: (nextBook: ApiBookCardModel) => jumps.push(nextBook),
        onResultPageChange: () => undefined,
        onTagSearch: () => undefined,
      }))
    })

    const pages = container.querySelector('.continuous-reader__pages')
    const progressButton = container.querySelector('.continuous-reader__progress')
    const navigatorRows = container.querySelectorAll<HTMLButtonElement>('.continuous-reader__navigator-body li > button')
    assert.ok(pages)
    assert.ok(progressButton)
    assert.equal(navigatorRows.length, 2)
    assert.equal(navigatorRows[0].children.length, 4)
    assert.ok(navigatorRows[0].children[0].classList.contains('continuous-reader__navigator-number'))
    assert.ok(navigatorRows[0].children[1].classList.contains('continuous-reader__navigator-thumbnail'))
    assert.equal(navigatorRows[0].children[2].tagName, 'STRONG')
    assert.equal(navigatorRows[0].children[2].textContent, 'First')
    assert.equal(navigatorRows[0].children[3].tagName, 'SMALL')
    assert.equal(navigatorRows[0].children[3].textContent, '1P')
    assert.equal(navigatorRows[0].getAttribute('aria-current'), 'true')
    assert.equal(navigatorRows[0].querySelector('.continuous-reader__navigator-thumbnail button'), null)

    await act(async () => {
      dispatchPointer(pages, 'pointerdown', 220, 100)
      dispatchPointer(pages, 'pointerup', 210, 210)
    })
    assert.equal(jumps.length, 0)

    await act(async () => {
      dispatchPointer(progressButton, 'pointerdown', 220, 100)
      dispatchPointer(progressButton, 'pointerup', 100, 105)
    })
    assert.equal(jumps.length, 0)

    await act(async () => {
      dispatchPointer(pages, 'pointerdown', 220, 100)
      dispatchPointer(pages, 'pointerup', 100, 105)
    })
    assert.equal(jumps.length, 1)
    assert.equal(jumps[0], books[1])

    await act(async () => {
      dispatchPointer(pages, 'pointerdown', 220, 100, 'mouse')
      dispatchPointer(pages, 'pointerup', 100, 105, 'mouse')
    })
    assert.equal(jumps.length, 2)
    assert.equal(jumps[1], books[1])

    await act(async () => {
      root.render(createElement(SearchContinuousReader, {
        books,
        startIndex: 1,
        resultPage: 1,
        totalResultPages: 1,
        isLoading: false,
        onActiveBookChange: () => undefined,
        onBookJump: (nextBook: ApiBookCardModel) => jumps.push(nextBook),
        onResultPageChange: () => undefined,
        onTagSearch: () => undefined,
      }))
    })
    const secondPages = container.querySelector('.continuous-reader__pages')
    assert.ok(secondPages)

    await act(async () => {
      secondPages.dispatchEvent(new dom.window.WheelEvent('wheel', {
        bubbles: true,
        cancelable: true,
        deltaX: -100,
        deltaY: 5,
      }))
    })
    assert.equal(jumps.length, 3)
    assert.equal(jumps[2], books[0])

    await act(async () => {
      secondPages.dispatchEvent(new dom.window.WheelEvent('wheel', {
        bubbles: true,
        cancelable: true,
        deltaX: -120,
        deltaY: 2,
      }))
    })
    assert.equal(jumps.length, 3)

    await act(async () => {
      progressButton.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
    })
    const updatedRows = container.querySelectorAll<HTMLButtonElement>('.continuous-reader__navigator-body li > button')
    assert.equal(updatedRows[1].getAttribute('aria-current'), 'true')
    await act(async () => {
      updatedRows[0].dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
    })
    assert.equal(jumps.length, 4)
    assert.equal(jumps[3], books[0])
  } finally {
    await act(async () => { root.unmount() })
    container.remove()
    if (originalIntersectionObserver) {
      Object.defineProperty(globalThis, 'IntersectionObserver', originalIntersectionObserver)
    } else {
      Reflect.deleteProperty(globalThis, 'IntersectionObserver')
    }
    dom.cleanup()
  }
})

it('opens recommendations for the active continuous book, isolates gestures, and resets on book change', async () => {
  const { SearchContinuousReader } = await import('../src/features/search/SearchContinuousReader')
  const dom = installHookDom('http://localhost/search?view=continuous')
  dom.window.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', '') }
  dom.window.HTMLDialogElement.prototype.close = function () { this.removeAttribute('open') }
  dom.window.scrollTo = () => undefined
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  const books = [book('book-1', 'First'), book('book-2', 'Second')]
  const requests: string[] = []
  const tags: string[] = []
  let jumps = 0
  globalThis.fetch = async (input) => {
    const url = new URL(String(input))
    if (!url.pathname.endsWith('/recommendations')) return new Response(new Blob(), { status: 200 })
    requests.push(url.pathname)
    return new Response(JSON.stringify({ status: 'success', items: url.searchParams.get('targetType') === 'Artist'
      ? [{ key: { entityType: 'Artist', tagName: 'artist-name' }, entity: { totalBookCount: 2 } }] : [] }))
  }
  const render = async (startIndex: number, isLoading = false) => {
    await act(async () => { root.render(createElement(SearchContinuousReader, {
      books, startIndex, isLoading, resultPage: 1, totalResultPages: 1,
      onActiveBookChange: () => undefined, onBookJump: () => { jumps++ },
      onResultPageChange: () => undefined, onTagSearch: (tag) => tags.push(`${tag.type}:${tag.name}`),
    })) })
  }
  const click = async (selector: string) => {
    const target = container.querySelector<HTMLButtonElement>(selector)
    assert.ok(target)
    await act(async () => { target.click() })
  }
  try {
    await render(0)
    assert.equal(requests.length, 0)
    await click('[aria-label="関連候補を開く"]')
    assert.deepEqual(requests, ['/api/book/group-1/book-1/recommendations'])
    const panel = container.querySelector('.recommendations__content')!
    await act(async () => {
      for (const [type, x] of [['pointerdown', 220], ['pointerup', 100]] as const) {
        const event = new dom.window.MouseEvent(type, { bubbles: true, clientX: x, clientY: 100 })
        Object.defineProperties(event, { pointerId: { value: 1 }, pointerType: { value: 'touch' }, isPrimary: { value: true } })
        panel.dispatchEvent(event)
      }
      panel.dispatchEvent(new dom.window.WheelEvent('wheel', { bubbles: true, deltaX: 150, deltaY: 0 }))
    })
    assert.equal(jumps, 0)
    await click('[role="tab"]:nth-child(2)')
    await click('.recommendations__card--entity')
    assert.deepEqual(tags, ['Artists:artist-name'])
    assert.equal(container.querySelector('.recommendations')?.hasAttribute('open'), false)
    await click('[aria-label="関連候補を開く"]')
    assert.equal(container.querySelector('[role="tab"][aria-selected="true"]')?.textContent, '作者')
    assert.equal(requests.length, 2)
    await render(1)
    assert.equal(container.querySelector('.recommendations')?.hasAttribute('open'), false)
    await click('[aria-label="関連候補を開く"]')
    assert.equal(requests.at(-1), '/api/book/group-1/book-2/recommendations')
    assert.equal(container.querySelector('[role="tab"][aria-selected="true"]')?.textContent, '作品')
    await render(1, true)
    assert.equal(container.querySelector('.recommendations'), null)
    assert.equal(document.documentElement.style.overflow, '')
  } finally {
    await act(async () => { root.unmount() })
    container.remove()
    dom.cleanup()
  }
})
