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

const LOCAL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const POSITIVE_INTEGER_PATTERN = /^[1-9]\d*$/

const isValidLocalDate = (value: string) => {
  if (!LOCAL_DATE_PATTERN.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(year, month - 1, day)
  return date.getFullYear() === year
    && date.getMonth() === month - 1
    && date.getDate() === day
}

const isPositiveInteger = (value: string) => (
  POSITIVE_INTEGER_PATTERN.test(value.trim()) && Number.isSafeInteger(Number(value))
)

const parsePage = (value: string | null) => {
  if (!value || !isPositiveInteger(value)) return 1
  const page = Number(value)
  return Number.isSafeInteger(page) ? page : 1
}

const normalizeOpaqueIds = (values: readonly string[]) => {
  const seen = new Set<string>()
  const normalized: string[] = []
  values.filter(Boolean).forEach((value) => {
    if (seen.has(value)) return
    seen.add(value)
    normalized.push(value)
  })
  return normalized
}

const toSearchParams = (search: string | URLSearchParams): URLSearchParams => {
  if (search instanceof URLSearchParams) return new URLSearchParams(search)
  const queryStart = search.indexOf('?')
  const query = queryStart >= 0 ? search.slice(queryStart + 1).split('#', 1)[0] : search
  return new URLSearchParams(query.startsWith('?') ? query.slice(1) : query)
}

/** Split a free-form ID field containing comma or newline separators. */
export const splitCacheIds = (text: string): string[] => {
  const values = text.split(/[,\r\n]+/).map((value) => value.trim()).filter(Boolean)
  const seen = new Set<string>()
  return values.filter((value) => {
    if (seen.has(value)) return false
    seen.add(value)
    return true
  })
}

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

const localDateToIso = (value: string, endOfDay: boolean) => {
  if (!isValidLocalDate(value)) return null
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(
    year,
    month - 1,
    day,
    endOfDay ? 23 : 0,
    endOfDay ? 59 : 0,
    endOfDay ? 59 : 0,
    endOfDay ? 999 : 0,
  )
  return date.toISOString()
}

export const buildCacheSearchRequest = (state: CacheSearchState): WebBookCacheSearchRequest => ({
  keyword: state.q.trim() || null,
  groupIds: normalizeOpaqueIds(state.groupIds),
  bookIds: normalizeOpaqueIds(state.bookIds),
  lowerUploadedTime: localDateToIso(state.from, false),
  upperUploadedTime: localDateToIso(state.to, true),
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
