import assert from 'node:assert/strict'
import test from 'node:test'

import { buildBookSearchFilter } from '../src/api/books'
import type { NyaTagType, SearchCriteria } from '../src/models'
import { formatSearchPageTitle } from '../src/app/page-title'
import { isNavigationItemActive, navigationGroups } from '../src/app/navigation'
import {
  cloneCriteria,
  createSearchUrlForDestination,
  criteriaHasValues,
  normalizeCriteriaForRoute,
  parseCriteriaForRoute,
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

test('missing-tag routes default to Artists and Groups when the parameter is omitted', () => {
  const criteria = parseCriteriaForRoute(new URLSearchParams('q=sample'), false, true)

  assert.deepEqual(criteria.missingTagTypes, ['Artists', 'Groups'])
  assert.equal(criteria.text, 'sample')
})

test('missing-tag routes retain only valid unique values and preserve an explicitly empty state', () => {
  const deduplicated = parseCriteriaForRoute(new URLSearchParams(
    'missingTagType=Groups&missingTagType=Artists&missingTagType=Groups&missingTagType=Tags',
  ), false, true)
  const invalid = parseCriteriaForRoute(new URLSearchParams('missingTagType=invalid&missingTagType='), false, true)

  assert.deepEqual(deduplicated.missingTagTypes, ['Groups', 'Artists', 'Tags'])
  assert.deepEqual(invalid.missingTagTypes, [])
})

test('normal and Web routes drop missing-tag conditions', () => {
  const criteria: SearchCriteria = { ...emptyCriteria(), missingTagTypes: ['Artists'] }

  assert.equal(normalizeCriteriaForRoute(criteria, false).missingTagTypes, undefined)
  assert.equal(normalizeCriteriaForRoute(criteria, true).missingTagTypes, undefined)
  assert.equal(parseCriteriaForRoute(new URLSearchParams('missingTagType=Artists'), false).missingTagTypes, undefined)
  assert.equal(parseCriteriaForRoute(new URLSearchParams('japanese=off&missingTagType=Artists'), true).missingTagTypes, undefined)
})

test('missing-tag URLs serialize and parse repeated values', () => {
  const url = createSearchUrlForDestination({
    ...emptyCriteria(),
    text: '  sample  ',
    missingTagTypes: ['Artists', 'Groups'],
  }, {
    destination: 'missing-tags',
    origin: 'https://search.example',
  })

  assert.equal(url.pathname, '/search/missing-tags')
  assert.equal(url.searchParams.get('q'), 'sample')
  assert.deepEqual(url.searchParams.getAll('missingTagType'), ['Artists', 'Groups'])
  assert.deepEqual(parseCriteriaForRoute(new URLSearchParams(url.search), false, true).missingTagTypes, ['Artists', 'Groups'])
})

test('missing-tag URLs preserve an explicit empty selection and other destinations omit it', () => {
  const criteria = { ...emptyCriteria(), missingTagTypes: [] }
  const missingUrl = createSearchUrlForDestination(criteria, {
    destination: 'missing-tags',
    origin: 'https://search.example',
  })
  const libraryUrl = createSearchUrlForDestination({ ...criteria, missingTagTypes: ['Artists'] }, {
    destination: 'library',
    origin: 'https://search.example',
  })
  const hitomiUrl = createSearchUrlForDestination({ ...criteria, missingTagTypes: ['Artists'] }, {
    destination: 'hitomi',
    origin: 'https://search.example',
  })

  assert.deepEqual(missingUrl.searchParams.getAll('missingTagType'), [''])
  assert.deepEqual(parseCriteriaForRoute(new URLSearchParams(missingUrl.search), false, true).missingTagTypes, [])
  assert.deepEqual(libraryUrl.searchParams.getAll('missingTagType'), [])
  assert.deepEqual(hitomiUrl.searchParams.getAll('missingTagType'), [])
})

test('criteria cloning copies tag and missing-tag arrays', () => {
  const criteria = {
    ...emptyCriteria(),
    tags: [{ type: 'Artists' as const, name: 'alice', displayName: 'Alice' }],
    missingTagTypes: ['Artists', 'Groups'] as NyaTagType[],
  }
  const clone = cloneCriteria(criteria)

  assert.notEqual(clone.tags, criteria.tags)
  assert.notEqual(clone.tags[0], criteria.tags[0])
  assert.notEqual(clone.missingTagTypes, criteria.missingTagTypes)
  clone.tags[0].displayName = 'Changed'
  clone.missingTagTypes?.push('Tags')
  assert.equal(criteria.tags[0].displayName, 'Alice')
  assert.deepEqual(criteria.missingTagTypes, ['Artists', 'Groups'])
})

test('missing-tag criteria count as values and require at least one type only on that route', () => {
  const emptySelection = { ...emptyCriteria(), missingTagTypes: [] }

  assert.equal(criteriaHasValues(emptyCriteria()), false)
  assert.equal(criteriaHasValues(emptySelection), false)
  assert.equal(criteriaHasValues({ ...emptyCriteria(), missingTagTypes: ['Artists'] }), true)
  assert.deepEqual(validateCriteria(emptySelection, true), { missingTags: '1種類以上選択してください。' })
  assert.deepEqual(validateCriteria(emptySelection, false), {})
  assert.deepEqual(validateCriteria({ ...emptyCriteria(), missingTagTypes: ['Artists'] }, true), {})
})

test('book search filters send missing-tag types while retaining isAnd', () => {
  const filter = buildBookSearchFilter({
    ...emptyCriteria(),
    tags: [{ type: 'Artists', name: 'alice' }],
    tagMode: 'or',
    missingTagTypes: ['Artists', 'Groups'],
  }, 'title', 'asc', 3)
  const emptyFilter = buildBookSearchFilter({ ...emptyCriteria(), missingTagTypes: [] }, 'uploaded', 'desc')

  assert.deepEqual(filter.missingTagTypes, ['Artists', 'Groups'])
  assert.equal(filter.isAnd, false)
  assert.equal(filter.sortType, 'Title')
  assert.equal(filter.page, 3)
  assert.equal(emptyFilter.missingTagTypes, undefined)
})

test('missing-tag URLs preserve ordinary filters and the API uses both sets of conditions', () => {
  const url = createSearchUrlForDestination({
    ...emptyCriteria(),
    text: 'sample',
    tags: [{ type: 'Languages', name: 'japanese' }],
    tagMode: 'or',
    missingTagTypes: ['Artists', 'Groups'],
    pagesMin: '10',
    pagesMax: '100',
  }, { destination: 'missing-tags', origin: 'https://search.example' })
  const restored = parseCriteriaForRoute(url.searchParams, false, true)
  const filter = buildBookSearchFilter(restored, 'uploaded', 'desc', 2)

  assert.deepEqual(filter.missingTagTypes, ['Artists', 'Groups'])
  assert.deepEqual(filter.tagSet, { Languages: ['japanese'] })
  assert.deepEqual(filter.texts, ['sample'])
  assert.equal(filter.isAnd, false)
  assert.equal(filter.lowerPageCount, 10)
  assert.equal(filter.upperPageCount, 100)
  assert.equal(filter.page, 2)
})

test('missing-tag navigation and titles distinguish the dedicated route', () => {
  const items = navigationGroups[0].items
  assert.equal(isNavigationItemActive(items[0], '/search/missing-tags'), false)
  assert.equal(isNavigationItemActive(items[1], '/search/missing-tags'), true)
  const title = formatSearchPageTitle({
    isWebSearch: false,
    isLibrarySearch: true,
    isMissingTagSearch: true,
    criteria: { ...emptyCriteria(), missingTagTypes: ['Artists', 'Groups'] },
    hitomiAppend: 'Normal',
    resultPage: 2,
  })
  assert.equal(title, 'すべて未設定: 作者・グループ / 2P - 未タグ検索 | Nyapture')
})
