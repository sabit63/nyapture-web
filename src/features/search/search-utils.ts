import { HITOMI_APPENDS, TAG_TYPE_ORDER } from '../../models'
import type { BookTag, HitomiAppend, NyaTagType, SearchCriteria } from '../../models'

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
  tags: criteria.tags.map((tag) => ({ ...tag })),
})

export const normalizeCriteriaForRoute = (criteria: SearchCriteria, isWebSearch: boolean): SearchCriteria => isWebSearch
  ? { ...criteria, tags: criteria.tags.slice(0, 1), tagMode: 'and' }
  : criteria

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

export const criteriaHasValues = (criteria: SearchCriteria) => Boolean(
  criteria.text.trim() || criteria.tags.length || criteria.dateFrom || criteria.dateTo || criteria.pagesMin || criteria.pagesMax,
)

export const createSearchUrl = (criteria: SearchCriteria, hitomiAppend?: HitomiAppend) => {
  const isHitomiSearch = window.location.pathname === '/hitomila/search'
  const pathname = isHitomiSearch ? '/hitomila/search' : '/search'
  const url = new URL(pathname, window.location.origin)
  const text = criteria.text.trim()
  const tags = isHitomiSearch ? criteria.tags.slice(0, 1) : criteria.tags
  if (text) url.searchParams.set('q', text)
  tags.forEach((tag) => url.searchParams.append('tag', `${tag.type}:${tag.name}`))
  if (!isHitomiSearch && tags.length && criteria.tagMode === 'or') url.searchParams.set('tagMode', 'or')
  if (criteria.dateFrom) url.searchParams.set('dateFrom', criteria.dateFrom)
  if (criteria.dateTo) url.searchParams.set('dateTo', criteria.dateTo)
  if (criteria.pagesMin) url.searchParams.set('pagesMin', criteria.pagesMin)
  if (criteria.pagesMax) url.searchParams.set('pagesMax', criteria.pagesMax)
  if (isHitomiSearch) url.searchParams.set('append', hitomiAppend ?? 'Normal')
  url.searchParams.set('page', '1')
  return url
}

export const sameTag = (left: BookTag, right: BookTag) => left.type === right.type && left.name.toLocaleLowerCase() === right.name.toLocaleLowerCase()

export const formatTagCount = (count: number | undefined) => (
  typeof count === 'number' && Number.isFinite(count) ? count.toLocaleString('ja-JP') : null
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

export type SearchValidationErrors = { date?: string; pages?: string }

export const validateCriteria = (criteria: SearchCriteria): SearchValidationErrors => {
  const errors: SearchValidationErrors = {}
  if (criteria.dateFrom && criteria.dateTo && criteria.dateFrom > criteria.dateTo) {
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
