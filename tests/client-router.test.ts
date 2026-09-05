import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createRouterHistoryState,
  readRouterHistoryMetadata,
  resolvePendingScrollRestoration,
  routerConstants,
  runScheduledScrollSave,
  shouldInterceptNavigationClick,
  shouldUseRouterHistoryBack,
  updateRouterScrollState,
} from '../src/app/client-router'
import { createSearchUrlForDestination } from '../src/features/search/search-utils'
import type { SearchCriteria } from '../src/models'

const currentHref = 'https://nyapture.example/search?q=cat&page=2'
const currentOrigin = 'https://nyapture.example'

test('intercepts only an unmodified same-origin primary navigation', () => {
  assert.equal(shouldInterceptNavigationClick({
    button: 0,
    href: '/dashboard',
    currentHref,
    currentOrigin,
  }), true)
  assert.equal(shouldInterceptNavigationClick({
    button: 1,
    href: '/dashboard',
    currentHref,
    currentOrigin,
  }), false)
  assert.equal(shouldInterceptNavigationClick({
    button: 0,
    ctrlKey: true,
    href: '/dashboard',
    currentHref,
    currentOrigin,
  }), false)
  assert.equal(shouldInterceptNavigationClick({
    button: 0,
    target: '_blank',
    href: '/dashboard',
    currentHref,
    currentOrigin,
  }), false)
  assert.equal(shouldInterceptNavigationClick({
    button: 0,
    download: true,
    href: '/download/book.zip',
    currentHref,
    currentOrigin,
  }), false)
  assert.equal(shouldInterceptNavigationClick({
    button: 0,
    href: 'https://other.example/dashboard',
    currentHref,
    currentOrigin,
  }), false)
})

test('leaves same-document hash navigation to the browser', () => {
  assert.equal(shouldInterceptNavigationClick({
    button: 0,
    href: '/search?q=cat&page=2#results-region',
    currentHref,
    currentOrigin,
  }), false)
  assert.equal(shouldInterceptNavigationClick({
    button: 0,
    href: '/search?q=cat&page=2',
    currentHref,
    currentOrigin,
  }), false)
})

test('namespaced history metadata preserves unrelated state and scroll position', () => {
  const initial = createRouterHistoryState({ application: 'state' }, 'nyapture-router-12', 230)
  assert.deepEqual(readRouterHistoryMetadata(initial), {
    namespace: routerConstants.namespace,
    entryId: 'nyapture-router-12',
    scrollY: 230,
  })
  const updated = updateRouterScrollState(initial, 640)
  assert.deepEqual(updated?.application, 'state')
  assert.deepEqual(readRouterHistoryMetadata(updated), {
    namespace: routerConstants.namespace,
    entryId: 'nyapture-router-12',
    scrollY: 640,
  })
  assert.equal(readRouterHistoryMetadata({ __nyapture_router__: { entryId: 'other', scrollY: 1 } }), null)
})

test('viewer back uses history only for a router-owned predecessor', () => {
  const directViewer = createRouterHistoryState({}, 'nyapture-router-20', 0)
  const routedViewer = createRouterHistoryState({}, 'nyapture-router-21', 0, 'nyapture-router-19')
  assert.equal(shouldUseRouterHistoryBack(directViewer, 3), false)
  assert.equal(shouldUseRouterHistoryBack(routedViewer, 3), true)
  assert.equal(shouldUseRouterHistoryBack(routedViewer, 1), false)
})

test('scheduled scroll saves are discarded after the history entry changes', () => {
  let currentEntryId: string | null = 'entry-a'
  const saved: number[] = []
  const save = (expectedEntryId: string, scrollY: number) => runScheduledScrollSave({
    expectedEntryId,
    scrollY,
    getCurrentEntryId: () => currentEntryId,
    save: (value) => saved.push(value),
  })

  assert.equal(save('entry-a', 180), true)
  currentEntryId = 'entry-b'
  assert.equal(save('entry-a', 720), false)
  assert.deepEqual(saved, [180])
})

test('pending pop restoration waits for content height and rejects another entry', () => {
  const pending = { entryId: 'entry-search-page-2', scrollY: 640 }
  const shortDocument = resolvePendingScrollRestoration(pending, 'entry-search-page-2', 300)
  assert.equal(shortDocument.status, 'pending')
  assert.deepEqual(shortDocument.pending, pending)

  const longDocument = resolvePendingScrollRestoration(shortDocument.pending, 'entry-search-page-2', 900)
  assert.equal(longDocument.status, 'restored')
  assert.equal(longDocument.scrollY, 640)
  assert.equal(longDocument.pending, null)

  const mismatchedEntry = resolvePendingScrollRestoration(shortDocument.pending, 'entry-dashboard', 900)
  assert.equal(mismatchedEntry.status, 'stale')
  assert.equal(mismatchedEntry.pending, null)
})

test('search URL is the source for destination, criteria, and page', () => {
  const criteria: SearchCriteria = {
    text: 'cat picture',
    tags: [{ type: 'Artists', name: 'alice' }],
    tagMode: 'and',
    dateFrom: '',
    dateTo: '',
    pagesMin: '',
    pagesMax: '',
  }
  const url = createSearchUrlForDestination(criteria, {
    destination: 'library',
    origin: currentOrigin,
  })
  url.searchParams.set('page', '4')
  assert.equal(url.pathname, '/search')
  assert.equal(url.searchParams.get('q'), 'cat picture')
  assert.deepEqual(url.searchParams.getAll('tag'), ['Artists:alice'])
  assert.equal(url.searchParams.get('page'), '4')
})
