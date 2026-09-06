import assert from 'node:assert/strict'
import test from 'node:test'
import { JSDOM } from 'jsdom'

import {
  addAppBasePath,
  getAppBasePath,
  isAppPath,
  normalizeAppBasePath,
  removeAppBasePath,
  toPublicUrl,
} from '../src/app/app-base-path'
import { shouldInterceptNavigationClick } from '../src/app/client-router'
import { createSearchUrlForDestination } from '../src/features/search/search-utils'
import type { SearchCriteria } from '../src/models'

const emptyCriteria = (): SearchCriteria => ({
  text: '',
  tags: [],
  tagMode: 'and',
  dateFrom: '',
  dateTo: '',
  pagesMin: '',
  pagesMax: '',
})

const installBaseDom = (url: string, baseHref: string) => {
  const dom = new JSDOM(`<!doctype html><html><head><base href="${baseHref}"></head><body></body></html>`, {
    url,
    pretendToBeVisual: true,
  })
  const originals = new Map<string, PropertyDescriptor | undefined>()
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document })) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
  }
  return {
    window: dom.window,
    cleanup() {
      dom.window.close()
      for (const [key, descriptor] of originals) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor)
        else Reflect.deleteProperty(globalThis, key)
      }
    },
  }
}

test('base path helpers normalize, prefix, strip, and avoid double prefixes', () => {
  const base = '/nyapture/viewer/'
  assert.equal(normalizeAppBasePath(base), '/nyapture/viewer')
  assert.equal(addAppBasePath('/search?q=cat', base), '/nyapture/viewer/search?q=cat')
  assert.equal(addAppBasePath('/nyapture/viewer/search?q=cat', base), '/nyapture/viewer/search?q=cat')
  assert.equal(removeAppBasePath('/nyapture/viewer/search?q=cat', base), '/search?q=cat')
  assert.equal(removeAppBasePath('/other/search', base), '/other/search')
  assert.equal(isAppPath('/nyapture/viewer/book/viewer', base), true)
  assert.equal(isAppPath('/nyapture/viewer-old/book/viewer', base), false)
})

test('runtime baseURI prefixes search URLs and leaves public URLs stable', () => {
  const dom = installBaseDom('http://localhost/nyapture/viewer/search', '/nyapture/viewer/')
  try {
    assert.equal(getAppBasePath(), '/nyapture/viewer')
    assert.equal(addAppBasePath('/search'), '/nyapture/viewer/search')
    assert.equal(removeAppBasePath('/nyapture/viewer/search'), '/search')
    assert.equal(toPublicUrl('/search?page=2').href, 'http://localhost/nyapture/viewer/search?page=2')
    assert.equal(toPublicUrl(new URL('http://localhost/dashboard')).pathname, '/dashboard')
    const searchUrl = createSearchUrlForDestination(emptyCriteria(), { destination: 'library' })
    assert.equal(searchUrl.pathname, '/nyapture/viewer/search')
  } finally {
    dom.cleanup()
  }
})

test('root deployment preserves logical and public paths', () => {
  const dom = installBaseDom('http://localhost/search', '/')
  try {
    assert.equal(getAppBasePath(), '/')
    assert.equal(addAppBasePath('/search'), '/search')
    assert.equal(removeAppBasePath('/search'), '/search')
    assert.equal(toPublicUrl('/search?page=2').pathname, '/search')
  } finally {
    dom.cleanup()
  }
})

test('non-root deployments do not intercept same-origin links outside the app subtree', () => {
  const common = {
    button: 0,
    currentHref: 'http://localhost/nyapture/viewer/search',
    currentOrigin: 'http://localhost',
    appBasePath: '/nyapture/viewer',
  }
  assert.equal(shouldInterceptNavigationClick({ ...common, href: '/nyapture/viewer/dashboard' }), true)
  assert.equal(shouldInterceptNavigationClick({ ...common, href: '/dashboard' }), false)
})
