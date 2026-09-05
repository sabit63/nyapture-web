import type {
  BookCardModel,
  BookSearchFilter,
  BookTag,
  EBook,
  NyaBookStatus,
  NyaTagType,
  SearchCriteria,
  SortDirection,
  SortType,
  TagEntity,
  TagSet,
} from '../models'
import { NYA_BOOK_STATUSES, NYA_TAG_TYPES } from '../models'
import type { ApiImageRequestDescriptor } from './client'
import type { WebBookCacheBookDto, WebBookCacheSearchRequest } from './endpoints'

export type ApiBookCardModel = BookCardModel & {
  thumbnailRequest?: ApiImageRequestDescriptor
  /** Changes when an existing thumbnail must be fetched again. */
  thumbnailReloadKey?: string | number
}

const isTagType = (value: string): value is NyaTagType => NYA_TAG_TYPES.includes(value as NyaTagType)
const isBookStatus = (value: string | undefined): value is NyaBookStatus => NYA_BOOK_STATUSES.includes(value as NyaBookStatus)

const safeIdentity = (value: string | null | undefined, fallback: string) => value?.trim() || fallback

type BookMappingContext = 'library' | 'hitomi'
type BookMappingOptions = {
  context?: BookMappingContext
  entities?: TagEntity[]
  sourceUrl?: string | null
}

const fallbackGroupIdFor = (context: BookMappingContext) => context === 'library' ? 'unknown-group' : 'hitomi'

export const createBookPageThumbnailRequest = (
  groupId: string | null | undefined,
  bookId: string | null | undefined,
  totalPage: number | null | undefined,
): ApiImageRequestDescriptor | undefined => {
  const normalizedGroupId = groupId?.trim()
  const normalizedBookId = bookId?.trim()
  if (!normalizedGroupId || !normalizedBookId || !totalPage || totalPage < 1) return undefined
  return {
    method: 'GET',
    path: '/api/book/page',
    query: {
      groupId: normalizedGroupId,
      bookId: normalizedBookId,
      page: 1,
      width: 500,
      height: 700,
      strategy: 'speed',
      fallback_to_original: true,
    },
  }
}
const fallbackStatusFor = (context: BookMappingContext): NyaBookStatus => context === 'library' ? 'Unknown' : 'WebBook'

const sourceLabelFromUrl = (value: string | null | undefined) => {
  const candidate = value?.trim()
  if (!candidate) return undefined

  let parsed: URL
  try {
    parsed = new URL(candidate)
  } catch {
    return undefined
  }

  const hostname = parsed.hostname.trim().toLocaleLowerCase().replace(/^www\./, '')
  if (!hostname) return undefined
  if (hostname === 'hitomi.la' || hostname.endsWith('.hitomi.la')) return 'HitomiLa'
  if (hostname === 'nhentai.net' || hostname.endsWith('.nhentai.net')) return 'NHentai'
  return hostname
}

const colorFor = (value: string) => {
  const covers = ['violet', 'blue', 'amber', 'rose', 'green', 'slate']
  const hash = [...value].reduce((total, character) => total + character.charCodeAt(0), 0)
  return covers[hash % covers.length]
}

const normalizeTagSet = (tagSet?: Record<string, string[]>): TagSet => {
  const normalized: TagSet = {}
  Object.entries(tagSet ?? {}).forEach(([type, names]) => {
    if (isTagType(type) && Array.isArray(names)) normalized[type] = names.filter(Boolean)
  })
  return normalized
}

const tagsFrom = (tagSet: TagSet, entities: TagEntity[] = []): BookTag[] => (
  Object.entries(tagSet).flatMap(([type, names]) => (names ?? []).map((name) => {
    const entity = entities.find((candidate) => candidate.type === type && candidate.name === name)
    return {
      type: type as NyaTagType,
      name,
      displayName: entity?.displayName,
      count: entity?.count,
    }
  }))
)

export const mapEBookToCard = (
  book: EBook,
  options: BookMappingOptions = {},
): ApiBookCardModel => {
  const context = options.context ?? 'library'
  const fallbackIdentity = safeIdentity(book.url, safeIdentity(book.title, 'unknown-book'))
  const apiGroupId = safeIdentity(book.groupId, '') || undefined
  const apiBookId = safeIdentity(book.bookId, '') || undefined
  const groupId = safeIdentity(book.groupId, fallbackGroupIdFor(context))
  const bookId = safeIdentity(book.bookId, fallbackIdentity)
  const tagSet = normalizeTagSet(book.tagSet)
  const totalPage = Number.isInteger(book.totalPage) && (book.totalPage ?? 0) > 0 ? book.totalPage ?? 0 : 0
  const sourceLabel = sourceLabelFromUrl(options.sourceUrl ?? book.url)

  return {
    ...book,
    groupId,
    bookId,
    apiGroupId,
    apiBookId,
    url: book.url ?? '',
    title: book.title?.trim() || bookId,
    captions: book.captions ?? {},
    totalPage,
    tagSet,
    uploadedTime: book.uploadedTime ?? '',
    pageUrls: book.pageUrls ?? [],
    status: isBookStatus(book.status) ? book.status : fallbackStatusFor(context),
    sourceLabel,
    tags: tagsFrom(tagSet, options.entities),
    cover: colorFor(`${groupId}:${bookId}`),
    thumbnailRequest: createBookPageThumbnailRequest(apiGroupId, apiBookId, totalPage),
  }
}

export const mapWebCacheBookToCard = (
  book: WebBookCacheBookDto,
): ApiBookCardModel => {
  const tagSet = normalizeTagSet(book.tagSet)
  for (const tag of book.tags ?? []) {
    if (!tag.type || !isTagType(tag.type) || !tag.name) continue
    const names = tagSet[tag.type] ?? []
    if (!names.includes(tag.name)) tagSet[tag.type] = [...names, tag.name]
  }
  const mapped = mapEBookToCard({
    groupId: book.groupId ?? undefined,
    bookId: book.bookId ?? undefined,
    url: book.url ?? undefined,
    title: book.title ?? undefined,
    captions: book.captions,
    totalPage: book.totalPage,
    tagSet,
    uploadedTime: book.uploadedTime,
    pageUrls: book.pageUrls,
    status: 'WebBook',
  }, {
    context: 'hitomi',
    entities: book.tags,
    sourceUrl: book.sourcePageUrl ?? book.url,
  })

  return {
    ...mapped,
    thumbnailUrl: book.thumbnailUrl ?? undefined,
    thumbnailRequest: mapped.apiGroupId && mapped.apiBookId ? {
      method: 'GET',
      path: `/api/web-cache/${encodeURIComponent(mapped.apiGroupId)}/${encodeURIComponent(mapped.apiBookId)}/thumbnail`,
      query: {},
    } : mapped.thumbnailRequest,
  }
}

const asDateTime = (date: string, endOfDay = false) => date
  ? new Date(`${date}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}`).toISOString()
  : undefined

export const buildBookSearchFilter = (
  criteria: SearchCriteria,
  sortType: SortType,
  direction: SortDirection,
  page = 1,
): BookSearchFilter => {
  const tagSet = criteria.tags.reduce<TagSet>((result, tag) => ({
    ...result,
    [tag.type]: [...(result[tag.type] ?? []), tag.name],
  }), {})
  const apiSort = sortType === 'title' ? 'Title' : sortType === 'pages' ? 'TotalPage' : 'UploadedTime'

  return {
    tagSet: criteria.tags.length ? tagSet : undefined,
    missingTagTypes: criteria.missingTagTypes?.length ? [...criteria.missingTagTypes] : undefined,
    texts: criteria.text.trim() ? [criteria.text.trim()] : undefined,
    lowerUploadedTime: asDateTime(criteria.dateFrom),
    upperUploadedTime: asDateTime(criteria.dateTo, true),
    lowerPageCount: criteria.pagesMin ? Number(criteria.pagesMin) : undefined,
    upperPageCount: criteria.pagesMax ? Number(criteria.pagesMax) : undefined,
    sortType: apiSort,
    isAsc: direction === 'asc',
    isAnd: criteria.tagMode === 'and',
    limit: 50,
    page,
  }
}

export const buildWebCacheSearchRequest = (
  criteria: SearchCriteria,
  direction: SortDirection,
  page = 1,
): WebBookCacheSearchRequest => ({
  keyword: criteria.text.trim() || criteria.tags[0]?.name || null,
  lowerUploadedTime: asDateTime(criteria.dateFrom) ?? null,
  upperUploadedTime: asDateTime(criteria.dateTo, true) ?? null,
  maxPageCount: criteria.pagesMax ? Number(criteria.pagesMax) : null,
  page,
  limit: 50,
  isAsc: direction === 'asc',
})
