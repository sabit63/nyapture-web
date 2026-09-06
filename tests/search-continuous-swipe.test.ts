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
