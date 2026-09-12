import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { afterEach, beforeEach, it } from 'node:test'
import * as React from 'react'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { configureApi, getApiSettings } from '../src/api/client'
import { mapEBookToCard } from '../src/api/books'
import type { RecommendationTagDisplayName, RecommendationThumbnailBook } from '../src/api/recommendations'
import type { BookTag } from '../src/models'
import { createTagSearchDestinationUrls } from '../src/features/search/search-utils'
import { installHookDom } from './helpers/react-hook'
import { RecommendationDebugContext } from '../src/features/settings/RecommendationDebugContext'

registerHooks({ load(url, context, nextLoad) {
  return url.endsWith('.css') ? { format: 'module', source: '', shortCircuit: true } : nextLoad(url, context)
} })
Object.defineProperty(globalThis, 'React', { configurable: true, value: React })

const originalSettings = getApiSettings()
let dom: ReturnType<typeof installHookDom>
beforeEach(() => {
  dom = installHookDom()
  dom.window.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', '') }
  dom.window.HTMLDialogElement.prototype.close = function () { this.removeAttribute('open') }
  dom.window.scrollTo = () => undefined
  configureApi({ ...originalSettings, apiKey: 'thumbnail-test-key' })
})
afterEach(() => { configureApi(originalSettings); dom.cleanup() })

async function mount(type: 'Book' | 'Artist' | 'Group', thumbnail: RecommendationThumbnailBook | null | undefined, failImage = false, displayNames?: RecommendationTagDisplayName[], debug = false, sourceTag?: BookTag & { type: 'Artists' | 'Groups' }, defaultNavigation = false) {
  const { BookRecommendations } = await import('../src/features/viewer/BookRecommendations')
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  const requests: URL[] = []
  const selections: string[] = []
  const selectedTags: BookTag[] = []
  let currentThumbnail = thumbnail
  let currentDisplayNames = displayNames
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input))
    requests.push(url)
    if (url.pathname.endsWith('/recommendations') || url.pathname.startsWith('/api/recommendations/entities/')) return new Response(JSON.stringify({
      status: 'success', tagDisplayNames: currentDisplayNames, items: url.searchParams.get('targetType') === type ? [{
        key: { entityType: type, tagName: 'candidate-name', groupId: 'g', bookId: 'b' },
        book: type === 'Book' ? { title: 'Original book title', uploadedTime: '2026-09-12T15:00:01Z' } : undefined,
        commonTags: ['shared', 'blank', 'raw'],
        score: 0.125, signals: { titleRank: null, exactTagRank: 2 }, reasons: ['タグの一致'],
        entity: { totalBookCount: 4, thumbnailBook: currentThumbnail, representativeTags: ['shared', 'blank', 'raw'] },
      }] : [],
    }))
    assert.equal(url.pathname, '/api/book/page')
    assert.equal(new Headers(init?.headers).get('X-API-Key'), 'thumbnail-test-key')
    assert.equal(url.searchParams.get('page'), '1')
    if (failImage) throw new Error('image unavailable')
    const response = new Response(null)
    response.blob = async () => new Blob(['test-image'], { type: 'image/png' })
    return response
  }
  const click = async (selector: string) => {
    const target = container.querySelector<HTMLButtonElement>(selector)
    assert.ok(target)
    await act(async () => { target.click() })
  }
  await act(async () => { root.render(createElement(RecommendationDebugContext, { value: debug }, createElement(BookRecommendations, {
    ...(sourceTag ? { sourceTag } : { book: mapEBookToCard({ groupId: 'source', bookId: 'source' }) }),
    ...(defaultNavigation ? {} : { getTagSearchHref: (tag: BookTag) => createTagSearchDestinationUrls(tag).library.href,
    onTagSearch: (tag: BookTag) => { selections.push(`${tag.type}:${tag.name}`); selectedTags.push(tag) } }),
  }))) })
  if (defaultNavigation) assert.equal(requests.length, 0, 'recommendations load only when opened')
  await click(sourceTag ? 'button[aria-haspopup="dialog"]' : '[aria-label="タグ関連作品を開く"]')
  if (type !== 'Book') await click(`[role="tab"]:nth-child(${(type === 'Artist' ? 2 : 3) - (sourceTag ? 1 : 0)})`)
  return {
    container, requests, selections, selectedTags, click,
    setThumbnail(value: RecommendationThumbnailBook) { currentThumbnail = value },
    setDisplayNames(value?: RecommendationTagDisplayName[]) { currentDisplayNames = value },
    async cleanup() { await act(async () => { root.unmount() }); container.remove() },
  }
}

for (const path of ['/search/missing-tags?missingTagType=Artists', '/hitomila/search?append=Normal', '/web-cache?q=old']) {
  for (const type of ['Artist', 'Group'] as const) {
    it(`${path}: existing recommendations open ${type} in normal search`, async () => {
      dom.window.history.replaceState(null, '', path)
      const fixture = await mount(type, null, false, undefined, false, undefined, true)
      try {
        const link = fixture.container.querySelector<HTMLAnchorElement>('.recommendations__card--entity')!
        const destination = new URL(link.href)
        assert.equal(destination.pathname, '/search')
        assert.equal(destination.searchParams.get('tag'), `${type === 'Artist' ? 'Artists' : 'Groups'}:candidate-name`)
        assert.equal(destination.searchParams.has('append'), false)
        assert.equal(destination.searchParams.has('missingTagType'), false)
        await fixture.click('.recommendations__card--entity')
        assert.equal(dom.window.location.href, destination.href)
        assert.equal(fixture.container.querySelector('dialog[open]'), null)
      } finally { await fixture.cleanup() }
    })
  }
}

for (const type of ['Book', 'Artist', 'Group'] as const) {
  it(`${type}: exposes a link and leaves new-tab gestures to the browser`, async () => {
    const fixture = await mount(type, null)
    try {
      const link = fixture.container.querySelector<HTMLAnchorElement>('a.recommendations__card')
      assert.ok(link)
      const href = new URL(link.href)
      assert.equal(link.hasAttribute('target'), false)
      if (type === 'Book') {
        assert.equal(href.pathname, '/book/viewer')
        assert.equal(href.searchParams.get('gid'), 'g')
        assert.equal(href.searchParams.get('id'), 'b')
      } else {
        assert.equal(href.pathname, '/search')
        assert.equal(href.searchParams.get('tag'), `${type === 'Artist' ? 'Artists' : 'Groups'}:candidate-name`)
      }
      const originalHref = dom.window.location.href
      for (const [name, options] of [
        ['auxclick', { button: 1 }],
        ['click', { button: 1 }],
        ['click', { ctrlKey: true }],
        ['click', { metaKey: true }],
        ['click', { shiftKey: true }],
        ['click', { altKey: true }],
      ] as const) {
        let preventedByApp: boolean | undefined
        // Observe the app's decision, then suppress JSDOM's unsupported native navigation.
        const observe = (event: Event) => { preventedByApp = event.defaultPrevented; event.preventDefault() }
        document.addEventListener(name, observe, { once: true })
        await act(async () => { link.dispatchEvent(new dom.window.MouseEvent(name, { ...options, bubbles: true, cancelable: true })) })
        assert.equal(preventedByApp, false)
        assert.equal(dom.window.location.href, originalHref)
        assert.deepEqual(fixture.selections, [])
        assert.ok(fixture.container.querySelector('dialog[open]'))
      }
      await fixture.click('.recommendations__card')
      assert.equal(fixture.container.querySelector('dialog[open]'), null)
      if (type === 'Book') assert.equal(dom.window.location.href, link.href)
      else assert.deepEqual(fixture.selections, [`${type === 'Artist' ? 'Artists' : 'Groups'}:candidate-name`])
    } finally { await fixture.cleanup() }
  })
}

for (const type of ['Artist', 'Group'] as const) {
  it(`${type}: uses the thumbnail Book identity and retains entity search navigation`, async () => {
    const fixture = await mount(type, { groupId: 'covers/日本語', bookId: 'newest/1', uploadedTime: '2026-09-09T00:00:00Z' })
    try {
      const imageRequests = fixture.requests.filter((url) => url.pathname === '/api/book/page')
      assert.equal(imageRequests.length, 1)
      assert.equal(imageRequests[0].searchParams.get('groupId'), 'covers/日本語')
      assert.equal(imageRequests[0].searchParams.get('bookId'), 'newest/1')
      const image = fixture.container.querySelector<HTMLImageElement>('.recommendations__avatar img')
      assert.ok(image)
      assert.ok(image.src.startsWith('blob:'))
      await act(async () => { image.dispatchEvent(new dom.window.Event('load')) })
      assert.ok(fixture.container.querySelector('.recommendations__avatar .is-loaded'))
      assert.equal(fixture.container.querySelector('.recommendations__avatar .book-cover__fallback'), null)
      await fixture.click('.recommendations__card--entity')
      assert.deepEqual(fixture.selections, [`${type === 'Artist' ? 'Artists' : 'Groups'}:candidate-name`])
    } finally { await fixture.cleanup() }
  })
}

for (const thumbnail of [null, undefined, { groupId: '', bookId: '', uploadedTime: '' }]) {
  it(`falls back to the entity icon without image requests for ${JSON.stringify(thumbnail)}`, async () => {
    const fixture = await mount('Artist', thumbnail)
    try {
      assert.equal(fixture.requests.length, 2)
      assert.ok(fixture.container.querySelector('.recommendations__avatar .book-cover__fallback svg'))
      assert.equal(fixture.container.querySelector('.recommendations__avatar img'), null)
    } finally { await fixture.cleanup() }
  })
}

it('refreshing a candidate replaces the previous thumbnail Book', async () => {
  const fixture = await mount('Group', { groupId: 'g', bookId: 'old', uploadedTime: '2026-09-08T00:00:00Z' })
  try {
    const oldSrc = fixture.container.querySelector<HTMLImageElement>('.recommendations__avatar img')?.src
    fixture.setThumbnail({ groupId: 'g', bookId: 'new', uploadedTime: '2026-09-09T00:00:00Z' })
    await fixture.click('[aria-label="関連候補を更新"]')
    assert.deepEqual(fixture.requests.filter((url) => url.pathname === '/api/book/page').map((url) => url.searchParams.get('bookId')), ['old', 'new'])
    assert.notEqual(fixture.container.querySelector<HTMLImageElement>('.recommendations__avatar img')?.src, oldSrc)
  } finally { await fixture.cleanup() }
})

it('returns to the group icon after bounded image retries fail', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] })
  const fixture = await mount('Group', { groupId: 'g', bookId: 'missing', uploadedTime: '2026-09-09T00:00:00Z' }, true)
  try {
    await act(async () => { context.mock.timers.tick(750) })
    await act(async () => { context.mock.timers.tick(1250) })
    assert.equal(fixture.requests.filter((url) => url.pathname === '/api/book/page').length, 3)
    assert.ok(fixture.container.querySelector('.recommendations__avatar .book-cover__fallback[aria-label="グループ"] svg'))
    assert.equal(fixture.container.querySelector('.recommendations__avatar button'), null)
    assert.equal(fixture.container.querySelector('.recommendations__avatar img'), null)
  } finally { await fixture.cleanup(); context.mock.timers.reset() }
})

const displayNames: RecommendationTagDisplayName[] = [
  { type: 'Groups', name: 'candidate-name', displayName: 'グループ表示名' },
  { type: 'Artists', name: 'candidate-name', displayName: '作者表示名' },
  { type: 'Artists', name: 'shared', displayName: '別種の表示名' },
  { type: 'Tags', name: 'shared', displayName: '共通表示名' },
  { type: 'Tags', name: 'blank', displayName: '   ' },
  { type: 'Tags', name: 'RAW', displayName: '大文字の別タグ' },
]

for (const type of ['Book', 'Artist', 'Group'] as const) {
  it(`${type}: prefers display names matched by type and exact name without changing identities`, async () => {
    const fixture = await mount(type, null, false, displayNames)
    try {
      assert.equal(fixture.container.querySelector('.recommendations__card strong')?.textContent,
        type === 'Book' ? 'Original book title' : type === 'Artist' ? '作者表示名' : 'グループ表示名')
      assert.deepEqual(Array.from(fixture.container.querySelectorAll('.recommendations__tags > span')).map((el) => el.textContent), type === 'Book' ? ['共通表示名', 'blank', 'raw'] : [])
      assert.equal(fixture.requests.length, type === 'Book' ? 1 : 2)
      if (type !== 'Book') {
        await fixture.click('.recommendations__card--entity')
        assert.deepEqual(fixture.selectedTags, [{ type: type === 'Artist' ? 'Artists' : 'Groups', name: 'candidate-name', displayName: type === 'Artist' ? '作者表示名' : 'グループ表示名' }])
      }
    } finally { await fixture.cleanup() }
  })
}

it('refreshing uses new display names and falls back when translations are no longer returned', async () => {
  const fixture = await mount('Artist', null, false, displayNames)
  try {
    fixture.setDisplayNames([{ type: 'Artists', name: 'candidate-name', displayName: '更新した表示名' }])
    await fixture.click('[aria-label="関連候補を更新"]')
    assert.equal(fixture.container.querySelector('.recommendations__card strong')?.textContent, '更新した表示名')
    assert.equal(fixture.container.querySelector('.recommendations__tags'), null)
    fixture.setDisplayNames(undefined)
    await fixture.click('[aria-label="関連候補を更新"]')
    assert.equal(fixture.container.querySelector('.recommendations__card strong')?.textContent, 'candidate-name')
  } finally { await fixture.cleanup() }
})

for (const type of ['Book', 'Artist', 'Group'] as const) {
  it(`${type}: debug details distinguish missing ranks, preserve raw scores and do not navigate`, async () => {
    const fixture = await mount(type, null, false, displayNames, true)
    try {
      const details = fixture.container.querySelector<HTMLElement>('[aria-label="候補1のDebug詳細"]')!
      assert.ok(details)
      assert.ok(fixture.container.querySelector('[aria-label="レコメンドAPIのDebug詳細"]'))
      const fields = new Map(Array.from(details.querySelectorAll('dl > div')).map((row) => [row.querySelector('dt')?.textContent, row.querySelector('dd')?.textContent]))
      assert.equal(fields.get('score（一致率ではありません）'), '0.125')
      assert.equal(fields.get('titleRank'), 'null')
      assert.equal(fields.get('semanticTagRank'), '未提供')
      assert.equal(fields.get('exactTagRank'), '2')
      assert.equal(fields.get('推薦理由'), 'タグの一致')
      assert.ok(fields.get('共通タグ')?.includes('共通表示名 (shared)'))
      assert.equal(details.closest('a'), null)
      await fixture.click('summary')
      assert.ok(fixture.container.querySelector('details[open]'))
      assert.deepEqual(fixture.selections, [])
      assert.ok(fixture.container.querySelector('dialog[open]'))
    } finally { await fixture.cleanup() }
  })
}
it('normal mode does not render debug details', async () => {
  const fixture = await mount('Book', null)
  try {
    assert.equal(fixture.container.querySelector('.recommendations__debug'), null)
    const time = fixture.container.querySelector('time')
    assert.equal(time?.textContent, '2026/09/13 00:00:01 JST')
    assert.equal(time?.getAttribute('datetime'), '2026-09-12T15:00:01Z')
  }
  finally { await fixture.cleanup() }
})

for (const sourceType of ['Artists', 'Groups'] as const) {
  for (const targetType of ['Artist', 'Group'] as const) {
    it(`${sourceType} to ${targetType}: searches using original names and retains entity navigation`, async () => {
      const sourceTag = { type: sourceType, name: 'original/作者 & group?', displayName: '表示名' }
      const fixture = await mount(targetType, null, false, displayNames, true, sourceTag)
      try {
        assert.deepEqual(Array.from(fixture.container.querySelectorAll('[role="tab"]')).map((tab) => tab.textContent), ['作者', 'グループ'])
        assert.ok(fixture.container.querySelector('h2')?.textContent?.includes('表示名'))
        const request = fixture.requests.at(-1)!
        assert.equal(request.pathname, `/api/recommendations/entities/${sourceType === 'Artists' ? 'Artist' : 'Group'}`)
        assert.equal(request.searchParams.get('tagName'), sourceTag.name)
        assert.equal(request.searchParams.get('targetType'), targetType)
        assert.equal(request.searchParams.get('limit'), '20')
        assert.ok(fixture.container.querySelector('.recommendations__debug'))
        const count = fixture.requests.length
        await fixture.click('[aria-label="関連候補を閉じる"]')
        await fixture.click('button[aria-haspopup="dialog"]')
        assert.equal(fixture.requests.length, count)
        await fixture.click('.recommendations__card')
        assert.deepEqual(fixture.selections, [`${targetType === 'Artist' ? 'Artists' : 'Groups'}:candidate-name`])
      } finally { await fixture.cleanup() }
    })
  }
}
