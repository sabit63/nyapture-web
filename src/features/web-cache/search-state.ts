import { isValidLocalDate, localDateToIso } from '../../models'
import type { WebBookCacheSearchRequest } from '../../models/web-cache'

export type CacheSearchState = {
  q: string
  groupIds: string[]
  bookIds: string[]
  from: string
  to: string
  maxPages: string
  page: number
  asc: boolean
}

export const DEFAULT_CACHE_SEARCH_STATE: CacheSearchState = {
  q: '',
  groupIds: [],
  bookIds: [],
  from: '',
  to: '',
  maxPages: '',
  page: 1,
  asc: false,
}

const POSITIVE_INTEGER_PATTERN = /^[1-9]\d*$/

const isPositiveInteger = (value: string) => (
  POSITIVE_INTEGER_PATTERN.test(value.trim()) && Number.isSafeInteger(Number(value))
)

const parsePage = (value: string | null) => {
  if (!value || !isPositiveInteger(value)) return 1
  const page = Number(value)
  return Number.isSafeInteger(page) ? page : 1
}

const normalizeOpaqueIds = (values: readonly string[]) => [...new Set(values.filter(Boolean))]

const toSearchParams = (search: string | URLSearchParams): URLSearchParams => {
  if (search instanceof URLSearchParams) return new URLSearchParams(search)
  const queryStart = search.indexOf('?')
  const query = queryStart >= 0 ? search.slice(queryStart + 1).split('#', 1)[0] : search
  return new URLSearchParams(query.startsWith('?') ? query.slice(1) : query)
}

/** Split a free-form ID field containing comma or newline separators. */
export const splitCacheIds = (text: string): string[] => (
  normalizeOpaqueIds(text.split(/[,\r\n]+/).map((value) => value.trim()))
)

export const parseCacheSearch = (search: string | URLSearchParams): CacheSearchState => {
  const params = toSearchParams(search)
  const from = params.get('from') ?? ''
  const to = params.get('to') ?? ''
  const maxPages = params.get('maxPages') ?? ''
  const normalizedFrom = isValidLocalDate(from) ? from : ''
  const normalizedTo = isValidLocalDate(to) ? to : ''
  const hasReversedDateRange = Boolean(normalizedFrom && normalizedTo && normalizedFrom > normalizedTo)
  return {
    q: params.get('q') ?? '',
    groupIds: normalizeOpaqueIds(params.getAll('groupId')),
    bookIds: normalizeOpaqueIds(params.getAll('bookId')),
    from: hasReversedDateRange ? '' : normalizedFrom,
    to: hasReversedDateRange ? '' : normalizedTo,
    maxPages: isPositiveInteger(maxPages) ? maxPages.trim() : '',
    page: parsePage(params.get('page')),
    asc: params.get('asc') === 'true',
  }
}

export const serializeCacheSearch = (state: CacheSearchState): string => {
  const params = new URLSearchParams()
  const query = state.q.trim()
  if (query) params.set('q', query)
  normalizeOpaqueIds(state.groupIds).forEach((groupId) => params.append('groupId', groupId))
  normalizeOpaqueIds(state.bookIds).forEach((bookId) => params.append('bookId', bookId))
  if (isValidLocalDate(state.from)) params.set('from', state.from)
  if (isValidLocalDate(state.to)) params.set('to', state.to)
  if (isPositiveInteger(state.maxPages)) params.set('maxPages', state.maxPages.trim())
  if (Number.isSafeInteger(state.page) && state.page >= 1 && state.page !== 1) {
    params.set('page', String(state.page))
  }
  if (state.asc) params.set('asc', 'true')
  const queryString = params.toString()
  return queryString ? `?${queryString}` : ''
}

export const buildCacheSearchRequest = (state: CacheSearchState): WebBookCacheSearchRequest => ({
  keyword: state.q.trim() || null,
  groupIds: normalizeOpaqueIds(state.groupIds),
  bookIds: normalizeOpaqueIds(state.bookIds),
  lowerUploadedTime: localDateToIso(state.from, false) ?? null,
  upperUploadedTime: localDateToIso(state.to, true) ?? null,
  maxPageCount: isPositiveInteger(state.maxPages) ? Number(state.maxPages.trim()) : null,
  page: Number.isSafeInteger(state.page) && state.page >= 1 ? state.page : 1,
  limit: 50,
  isAsc: state.asc,
})

export const validateCacheSearch = (state: CacheSearchState): string | null => {
  if (state.from && !isValidLocalDate(state.from)) return '開始日は有効な日付を入力してください。'
  if (state.to && !isValidLocalDate(state.to)) return '終了日は有効な日付を入力してください。'
  if (state.from && state.to && state.from > state.to) return '開始日は終了日以前にしてください。'
  if (state.maxPages && !isPositiveInteger(state.maxPages)) {
    return '最大ページ数は1以上の整数で入力してください。'
  }
  if (!Number.isSafeInteger(state.page) || state.page < 1) return 'ページ番号は1以上の整数で入力してください。'
  return null
}
