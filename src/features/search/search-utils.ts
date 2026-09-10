import { HITOMI_APPENDS, NYA_BOOK_STATUSES, isValidLocalDate, TAG_TYPE_ORDER } from '../../models'
import type { BookTag, HitomiAppend, NyaBookStatus, NyaTagType, SearchCriteria } from '../../models'
import { toPublicPath } from '../../app/app-base-path'

export { isValidLocalDate }

export type SearchSyncFreshness = 'idle' | 'syncing' | 'fresh' | 'stale'

export const parseTagParam = (value: string | null): BookTag | null => {
  if (!value) return null
  const separator = value.indexOf(':')
  if (separator < 1) return null
  const type = value.slice(0, separator) as NyaTagType
  const name = value.slice(separator + 1)
  if (!TAG_TYPE_ORDER.includes(type) || !name) return null
  return { type, name }
}

export const emptyCriteria = (): SearchCriteria => ({
  text: '',
  tags: [],
  tagMode: 'and',
  dateFrom: '',
  dateTo: '',
  pagesMin: '',
  pagesMax: '',
})

export const cloneCriteria = (criteria: SearchCriteria): SearchCriteria => ({
  ...criteria,
  ...(criteria.statuses ? { statuses: [...criteria.statuses] } : {}),
  tags: criteria.tags.map((tag) => ({ ...tag })),
  ...(criteria.missingTagTypes ? { missingTagTypes: [...criteria.missingTagTypes] } : {}),
})

export const normalizeCriteriaForRoute = (
  criteria: SearchCriteria,
  isWebSearch: boolean,
  isMissingTagSearch = false,
  isStatusSearch = false,
): SearchCriteria => {
  const normalized = isWebSearch ? { ...criteria, tagMode: 'and' as const } : criteria
  const { missingTagTypes, statuses, ...common } = normalized
  return {
    ...common,
    ...(isMissingTagSearch && !isWebSearch && missingTagTypes !== undefined ? { missingTagTypes } : {}),
    ...(isStatusSearch && !isWebSearch && statuses !== undefined ? { statuses } : {}),
  }
}

const JAPANESE_LANGUAGE_TAG: BookTag = { type: 'Languages', name: 'japanese' }

const isJapaneseLanguageTag = (tag: BookTag) => tag.type === JAPANESE_LANGUAGE_TAG.type
  && tag.name.toLocaleLowerCase() === JAPANESE_LANGUAGE_TAG.name

export const parseHitomiAppend = (params: URLSearchParams): HitomiAppend => {
  const value = params.get('append')
  return HITOMI_APPENDS.includes(value as HitomiAppend) ? value as HitomiAppend : 'Normal'
}

export const resolveTag = (tag: BookTag): BookTag => tag

export const parseCriteriaFromUrl = (params: URLSearchParams): SearchCriteria => {
  const criteria = emptyCriteria()
  criteria.text = params.get('q') ?? ''
  criteria.tags = params.getAll('tag')
    .map(parseTagParam)
    .filter((tag): tag is BookTag => Boolean(tag))
    .map(resolveTag)
    .filter((tag, index, all) => all.findIndex((candidate) => candidate.type === tag.type && candidate.name === tag.name) === index)
  criteria.tagMode = params.get('tagMode') === 'or' ? 'or' : 'and'
  criteria.dateFrom = params.get('dateFrom') ?? ''
  criteria.dateTo = params.get('dateTo') ?? ''
  criteria.pagesMin = params.get('pagesMin') ?? ''
  criteria.pagesMax = params.get('pagesMax') ?? ''
  return criteria
}

const DEFAULT_MISSING_TAG_TYPES: NyaTagType[] = ['Artists', 'Groups']

const parseMissingTagTypes = (params: URLSearchParams): NyaTagType[] => {
  const values = params.getAll('missingTagType')
  if (values.length === 0) return [...DEFAULT_MISSING_TAG_TYPES]
  return values
    .filter((value): value is NyaTagType => TAG_TYPE_ORDER.includes(value as NyaTagType))
    .filter((value, index, all) => all.indexOf(value) === index)
}

export const parseCriteriaForRoute = (
  params: URLSearchParams,
  isWebSearch: boolean,
  isMissingTagSearch = false,
  isStatusSearch = false,
): SearchCriteria => {
  const criteria = normalizeCriteriaForRoute(parseCriteriaFromUrl(params), isWebSearch, isMissingTagSearch, isStatusSearch)
  if (isStatusSearch && !isWebSearch) {
    const values = params.getAll('status')
    const statuses = values.length === 0 ? NYA_BOOK_STATUSES.filter((status) => status !== 'Downloaded') : values
      .filter((value): value is NyaBookStatus => NYA_BOOK_STATUSES.includes(value as NyaBookStatus))
      .filter((value, index, all) => all.indexOf(value) === index)
    return { ...criteria, statuses }
  }
  if (isMissingTagSearch && !isWebSearch) {
    return { ...criteria, missingTagTypes: parseMissingTagTypes(params) }
  }
  if (!isWebSearch || params.get('japanese')?.trim().toLocaleLowerCase() === 'off') return criteria
  if (criteria.tags.some(isJapaneseLanguageTag)) return criteria
  return { ...criteria, tags: [...criteria.tags, { ...JAPANESE_LANGUAGE_TAG }] }
}

export const criteriaHasValues = (criteria: SearchCriteria) => Boolean(
  criteria.text.trim()
  || criteria.tags.length
  || criteria.statuses?.length
  || criteria.missingTagTypes?.length
  || criteria.dateFrom
  || criteria.dateTo
  || criteria.pagesMin
  || criteria.pagesMax,
)

export type SearchDestination = 'library' | 'hitomi' | 'missing-tags' | 'status'

export const createSearchUrlForDestination = (
  criteria: SearchCriteria,
  options: { destination: SearchDestination; hitomiAppend?: HitomiAppend; origin?: string },
): URL => {
  const isHitomiSearch = options.destination === 'hitomi'
  const isMissingTagSearch = options.destination === 'missing-tags'
  const isStatusSearch = options.destination === 'status'
  const pathname = isStatusSearch ? '/search/status' : isHitomiSearch ? '/hitomila/search' : isMissingTagSearch ? '/search/missing-tags' : '/search'
  const url = new URL(toPublicPath(pathname), options.origin ?? window.location.origin)
  const text = criteria.text.trim()
  const tags = isHitomiSearch
    ? criteria.tags.filter((tag, index, all) => !isJapaneseLanguageTag(tag) || all.findIndex(isJapaneseLanguageTag) === index)
    : criteria.tags
  if (text) url.searchParams.set('q', text)
  tags.forEach((tag) => url.searchParams.append('tag', `${tag.type}:${tag.name}`))
  if (isHitomiSearch && !tags.some(isJapaneseLanguageTag)) url.searchParams.set('japanese', 'off')
  if (!isHitomiSearch && tags.length && criteria.tagMode === 'or') url.searchParams.set('tagMode', 'or')
  if (criteria.dateFrom) url.searchParams.set('dateFrom', criteria.dateFrom)
  if (criteria.dateTo) url.searchParams.set('dateTo', criteria.dateTo)
  if (criteria.pagesMin) url.searchParams.set('pagesMin', criteria.pagesMin)
  if (criteria.pagesMax) url.searchParams.set('pagesMax', criteria.pagesMax)
  if (isMissingTagSearch && criteria.missingTagTypes !== undefined) {
    if (criteria.missingTagTypes.length === 0) {
      url.searchParams.set('missingTagType', '')
    } else {
      criteria.missingTagTypes.forEach((type) => url.searchParams.append('missingTagType', type))
    }
  }
  if (isStatusSearch && criteria.statuses !== undefined) {
    if (criteria.statuses.length === 0) url.searchParams.set('status', '')
    else criteria.statuses.forEach((status) => url.searchParams.append('status', status))
  }
  if (isHitomiSearch) url.searchParams.set('append', options.hitomiAppend ?? 'Normal')
  url.searchParams.set('page', '1')
  return url
}

export const createTagSearchDestinationUrls = (
  tag: BookTag,
  options: {
    hitomiAppend?: HitomiAppend
    japaneseLanguageEnabled?: boolean
    origin?: string
  } = {},
) => {
  const resolvedTag = resolveTag(tag)
  const hitomiTags = [resolvedTag]
  if ((options.japaneseLanguageEnabled ?? true) && !isJapaneseLanguageTag(resolvedTag)) {
    hitomiTags.push(JAPANESE_LANGUAGE_TAG)
  }

  return {
    library: createSearchUrlForDestination({ ...emptyCriteria(), tags: [resolvedTag] }, {
      destination: 'library',
      origin: options.origin,
    }),
    hitomi: createSearchUrlForDestination({ ...emptyCriteria(), tags: hitomiTags }, {
      destination: 'hitomi',
      hitomiAppend: options.hitomiAppend,
      origin: options.origin,
    }),
  }
}

export const sameTag = (left: BookTag, right: BookTag) => left.type === right.type && left.name.toLocaleLowerCase() === right.name.toLocaleLowerCase()

export const formatTagCount = (count: number | undefined) => (
  typeof count === 'number' && Number.isFinite(count) ? String(count) : null
)

export const parsePageParam = (value: string | null) => {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed >= 1 ? parsed : 1
}

export type PaginationItem = number | 'ellipsis'

export const getPaginationItems = (currentPage: number, totalPages: number, pageCount: number): PaginationItem[] => {
  const safeTotalPages = Math.max(1, Math.floor(totalPages))
  const visiblePageCount = Math.min(Math.max(1, Math.floor(pageCount)), safeTotalPages)
  const safeCurrentPage = Math.min(safeTotalPages, Math.max(1, Math.floor(currentPage)))
  const lastWindowStart = safeTotalPages - visiblePageCount + 1
  const firstWindowPage = safeCurrentPage <= 1
    ? 1
    : safeCurrentPage >= safeTotalPages
      ? lastWindowStart
      : Math.min(lastWindowStart, Math.max(1, safeCurrentPage - Math.floor(visiblePageCount / 2)))
  const lastWindowPage = firstWindowPage + visiblePageCount - 1
  const items: PaginationItem[] = []

  if (firstWindowPage > 1) {
    items.push(1)
    if (firstWindowPage > 2) items.push('ellipsis')
  }
  items.push(...Array.from({ length: visiblePageCount }, (_, index) => firstWindowPage + index))
  if (lastWindowPage < safeTotalPages) {
    if (lastWindowPage < safeTotalPages - 1) items.push('ellipsis')
    items.push(safeTotalPages)
  }

  return items
}

export type SearchValidationErrors = { date?: string; pages?: string; missingTags?: string; statuses?: string }

export const validateCriteria = (criteria: SearchCriteria, isMissingTagSearch = false, isStatusSearch = false): SearchValidationErrors => {
  const errors: SearchValidationErrors = {}
  if (isStatusSearch && !criteria.statuses?.length) errors.statuses = '1種類以上選択してください。'
  if (isMissingTagSearch && !criteria.missingTagTypes?.length) {
    errors.missingTags = '1種類以上選択してください。'
  }
  if (criteria.dateFrom && !isValidLocalDate(criteria.dateFrom)) {
    errors.date = '開始日は有効な日付を入力してください。'
  } else if (criteria.dateTo && !isValidLocalDate(criteria.dateTo)) {
    errors.date = '終了日は有効な日付を入力してください。'
  } else if (criteria.dateFrom && criteria.dateTo && criteria.dateFrom > criteria.dateTo) {
    errors.date = '開始日は終了日以前にしてください。'
  }

  const pageValues = [criteria.pagesMin, criteria.pagesMax]
  if (pageValues.some((value) => value && (!/^\d+$/.test(value) || Number(value) < 1))) {
    errors.pages = 'ページ数は1以上の整数で入力してください。'
  } else if (criteria.pagesMin && criteria.pagesMax && Number(criteria.pagesMin) > Number(criteria.pagesMax)) {
    errors.pages = '最小ページ数は最大ページ数以下にしてください。'
  }
  return errors
}

export type HitomiSortPeriod = 'recent' | 'today' | 'week' | 'month' | 'year'

export const HITOMI_SORT_PERIODS: { value: HitomiSortPeriod; label: string }[] = [
  { value: 'recent', label: '最近' },
  { value: 'today', label: '本日' },
  { value: 'week', label: '週間' },
  { value: 'month', label: '月間' },
  { value: 'year', label: '年間' },
]
