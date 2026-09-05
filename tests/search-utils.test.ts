import assert from 'node:assert/strict'
import test from 'node:test'

import type { SearchCriteria } from '../src/models'
import { buildBookSearchFilter } from '../src/api/books'
import {
  createSearchUrlForDestination,
  createTagSearchDestinationUrls,
  isValidLocalDate,
  validateCriteria,
} from '../src/features/search/search-utils'

const emptyCriteria = (): SearchCriteria => ({
  text: '',
  tags: [],
  tagMode: 'and',
  dateFrom: '',
  dateTo: '',
  pagesMin: '',
  pagesMax: '',
})

test('explicit destinations use their own path and supplied origin', () => {
  const criteria = emptyCriteria()
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      location: {
        origin: 'https://current.example',
        pathname: '/hitomila/search',
      },
    },
  })

  try {
    const libraryUrl = createSearchUrlForDestination(criteria, {
      destination: 'library',
      origin: 'https://search.example/current/path',
    })
    const hitomiUrl = createSearchUrlForDestination(criteria, {
      destination: 'hitomi',
      origin: 'https://search.example/current/path',
    })

    assert.equal(libraryUrl.href, 'https://search.example/search?page=1')
    assert.equal(hitomiUrl.href, 'https://search.example/hitomila/search?japanese=off&append=Normal&page=1')
  } finally {
    if (originalWindow) {
      Object.defineProperty(globalThis, 'window', originalWindow)
    } else {
      Reflect.deleteProperty(globalThis, 'window')
    }
  }
})

test('library URLs serialize trimmed text, repeated encoded tags, ranges, and tag mode', () => {
  const url = createSearchUrlForDestination({
    ...emptyCriteria(),
    text: '  cats & dogs  ',
    tags: [
      { type: 'Artists', name: 'Alice & Bob' },
      { type: 'Tags', name: 'tag name' },
    ],
    tagMode: 'or',
    dateFrom: '2025-01-02',
    dateTo: '2025-02-03',
    pagesMin: '10',
    pagesMax: '20',
  }, {
    destination: 'library',
    origin: 'https://search.example',
  })

  assert.equal(url.pathname, '/search')
  assert.equal(url.searchParams.get('q'), 'cats & dogs')
  assert.deepEqual(url.searchParams.getAll('tag'), ['Artists:Alice & Bob', 'Tags:tag name'])
  assert.equal(url.searchParams.get('tagMode'), 'or')
  assert.equal(url.searchParams.get('dateFrom'), '2025-01-02')
  assert.equal(url.searchParams.get('dateTo'), '2025-02-03')
  assert.equal(url.searchParams.get('pagesMin'), '10')
  assert.equal(url.searchParams.get('pagesMax'), '20')
  assert.equal(url.searchParams.get('page'), '1')
  assert.match(url.search, /tag=Artists%3AAlice\+%26\+Bob/)
  assert.match(url.search, /tag=Tags%3Atag\+name/)
})

test('hitomi Japanese tags are serialized once without japanese=off', () => {
  const url = createSearchUrlForDestination({
    ...emptyCriteria(),
    tags: [
      { type: 'Languages', name: 'japanese' },
      { type: 'Languages', name: 'JAPANESE' },
      { type: 'Tags', name: 'doujin' },
    ],
  }, {
    destination: 'hitomi',
    hitomiAppend: 'Female',
    origin: 'https://search.example',
  })

  assert.equal(url.pathname, '/hitomila/search')
  assert.deepEqual(url.searchParams.getAll('tag'), ['Languages:japanese', 'Tags:doujin'])
  assert.equal(url.searchParams.get('japanese'), null)
  assert.equal(url.searchParams.get('append'), 'Female')
  assert.equal(url.searchParams.get('page'), '1')
})

test('hitomi URLs mark missing Japanese tags and default append to Normal', () => {
  const url = createSearchUrlForDestination({
    ...emptyCriteria(),
    tags: [{ type: 'Tags', name: 'a+b' }],
  }, {
    destination: 'hitomi',
    origin: 'https://search.example',
  })

  assert.deepEqual(url.searchParams.getAll('tag'), ['Tags:a+b'])
  assert.equal(url.searchParams.get('japanese'), 'off')
  assert.equal(url.searchParams.get('append'), 'Normal')
  assert.equal(url.searchParams.get('page'), '1')
})

test('tag destination URLs use Japanese and Normal as cross-route defaults', () => {
  const urls = createTagSearchDestinationUrls({ type: 'Artists', name: 'artist name' }, {
    origin: 'https://search.example',
  })

  assert.deepEqual(urls.library.searchParams.getAll('tag'), ['Artists:artist name'])
  assert.equal(urls.library.pathname, '/search')
  assert.deepEqual(urls.hitomi.searchParams.getAll('tag'), [
    'Artists:artist name',
    'Languages:japanese',
  ])
  assert.equal(urls.hitomi.searchParams.get('japanese'), null)
  assert.equal(urls.hitomi.searchParams.get('append'), 'Normal')
})

test('tag destination URLs preserve disabled Japanese and current Hitomi append', () => {
  const urls = createTagSearchDestinationUrls({ type: 'Tags', name: 'tag' }, {
    japaneseLanguageEnabled: false,
    hitomiAppend: 'Male',
    origin: 'https://search.example',
  })

  assert.deepEqual(urls.hitomi.searchParams.getAll('tag'), ['Tags:tag'])
  assert.equal(urls.hitomi.searchParams.get('japanese'), 'off')
  assert.equal(urls.hitomi.searchParams.get('append'), 'Male')
})

test('calendar validation rejects malformed and impossible URL dates before building a request', () => {
  assert.equal(isValidLocalDate('2024-02-29'), true)
  assert.equal(isValidLocalDate('2023-02-29'), false)
  assert.equal(isValidLocalDate('2024-02-30'), false)
  assert.equal(isValidLocalDate('not-a-date'), false)

  const invalid = { ...emptyCriteria(), dateFrom: '2024-02-30' }
  assert.equal(validateCriteria(invalid).date, '開始日は有効な日付を入力してください。')
  assert.equal(buildBookSearchFilter(invalid, 'uploaded', 'desc').lowerUploadedTime, undefined)
})

test('calendar range validation still rejects reversed valid dates', () => {
  const errors = validateCriteria({
    ...emptyCriteria(),
    dateFrom: '2025-02-03',
    dateTo: '2025-01-02',
  })
  assert.equal(errors.date, '開始日は終了日以前にしてください。')
})
