import type {
  EBook,
  HitomiAppend,
  NyaBookStatus,
  NyaTagType,
  OnlineBookInPage,
  OnlineBookPageResponse,
  SearchCriteria,
  TagEntity,
  TagSet,
} from '../models'
import { NYA_BOOK_STATUSES, NYA_TAG_TYPES } from '../models'
import type { ApiImageRequestDescriptor } from './client'
import { mapEBookToCard } from './books'
import type { ApiBookCardModel } from './books'

const HITOMI_INDEX_ALL_URL = 'https://hitomi.la/index-all.html'
const HITOMI_SEARCH_URL = 'https://hitomi.la/search.html'

const HITOMI_TAG_FIELDS: Record<NyaTagType, string> = {
  Parodies: 'series',
  Characters: 'character',
  Categories: 'type',
  Groups: 'group',
  Artists: 'artist',
  Tags: 'tag',
  Languages: 'language',
  Unknown: 'tag',
}

export type HitomiSearchCriteria = Pick<SearchCriteria, 'text' | 'tags'>

const safePage = (value: unknown) => {
  const numeric = typeof value === 'number' ? value : Number(value)
  return Number.isSafeInteger(numeric) && numeric >= 1 ? numeric : 1
}

const tagFieldFor = (tagType: unknown, append: unknown) => {
  if (append === 'Male' || append === 'Female') return append.toLocaleLowerCase()
  return typeof tagType === 'string' && tagType in HITOMI_TAG_FIELDS
    ? HITOMI_TAG_FIELDS[tagType as NyaTagType]
    : HITOMI_TAG_FIELDS.Unknown
}

const normalizeTagName = (value: unknown) => (
  typeof value === 'string' ? value.trim().replace(/\s+/g, '_') : ''
)

/** Build the public Hitomi URL represented by the current search criteria. */
export const buildHitomiSearchUrl = (
  criteria: HitomiSearchCriteria,
  append: HitomiAppend = 'Normal',
  page?: number,
) => {
  const normalizedPage = safePage(page)
  const text = typeof criteria?.text === 'string' ? criteria.text.trim() : ''
  const tags = Array.isArray(criteria?.tags) ? criteria.tags : []
  const selectedTag = tags.find((tag) => normalizeTagName(tag?.name))
  const terms = text ? [text] : []

  if (selectedTag) {
    const tagName = normalizeTagName(selectedTag.name)
    terms.push(`${tagFieldFor(selectedTag.type, append)}:${tagName}`)
  }

  if (terms.length === 0) {
    return normalizedPage > 1
      ? `${HITOMI_INDEX_ALL_URL}?page=${normalizedPage}`
      : HITOMI_INDEX_ALL_URL
  }

  const searchUrl = `${HITOMI_SEARCH_URL}?${encodeURIComponent(terms.join(' '))}`
  return normalizedPage > 1 ? `${searchUrl}#${normalizedPage}` : searchUrl
}

type HitomiSearchResult = {
  books: ApiBookCardModel[]
  totalPage: number
  currentPage: number
}

const isObject = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
)

const stringValue = (value: unknown) => typeof value === 'string' ? value : undefined

const numberValue = (value: unknown) => (
  typeof value === 'number' && Number.isFinite(value) ? value : undefined
)

const stringRecord = (value: unknown): Record<string, string> | undefined => {
  if (!isObject(value)) return undefined
  const result = Object.entries(value).reduce<Record<string, string>>((current, [key, item]) => {
    if (typeof item === 'string') current[key] = item
    return current
  }, {})
  return Object.keys(result).length > 0 ? result : undefined
}

const tagSetValue = (value: unknown): TagSet | undefined => {
  if (!isObject(value)) return undefined
  const result: TagSet = {}
  Object.entries(value).forEach(([type, names]) => {
    if (!NYA_TAG_TYPES.includes(type as NyaTagType) || !Array.isArray(names)) return
    const strings = names.filter((name): name is string => typeof name === 'string')
    if (strings.length > 0) result[type as NyaTagType] = strings
  })
  return Object.keys(result).length > 0 ? result : undefined
}

const stringArray = (value: unknown) => (
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
)

const statusValue = (value: unknown): NyaBookStatus => (
  typeof value === 'string' && NYA_BOOK_STATUSES.includes(value as NyaBookStatus)
    ? value as NyaBookStatus
    : 'WebBookInPage'
)

const normalizedId = (value: unknown) => {
  const result = stringValue(value)?.trim()
  return result || undefined
}

const rawUrl = (value: unknown) => {
  const result = stringValue(value)
  return result || undefined
}

const normalizedRawBook = (book: OnlineBookInPage): EBook => ({
  url: stringValue(book.url),
  groupId: stringValue(book.groupId),
  bookId: stringValue(book.bookId),
  title: stringValue(book.title),
  captions: stringRecord(book.captions),
  totalPage: numberValue(book.totalPage),
  tagSet: tagSetValue(book.tagSet),
  uploadedTime: stringValue(book.uploadedTime),
  pageUrls: stringArray(book.pageUrls),
  status: statusValue(book.status),
})

const encodeBase64 = (value: string): string | undefined => {
  if (typeof btoa !== 'function') return undefined

  try {
    if (typeof TextEncoder === 'function') {
      const bytes = new TextEncoder().encode(value)
      let binary = ''
      bytes.forEach((byte) => {
        binary += String.fromCharCode(byte)
      })
      return btoa(binary)
    }
    return btoa(value)
  } catch {
    return undefined
  }
}

const webThumbnailRequest = (pageUrls: string[]): ApiImageRequestDescriptor | undefined => {
  const imageUrl = pageUrls.find((value) => value.trim())?.trim()
  if (!imageUrl) return undefined
  const eurl = encodeBase64(imageUrl)
  if (!eurl) return undefined
  return {
    method: 'GET',
    path: '/api/web/book/thumbnail',
    query: { eurl },
  }
}

type OnlineBookCardMappingOptions = {
  preserveLocalThumbnail?: boolean
}

/** Map a Hitomi online book to a gallery card using its web thumbnail endpoint. */
export const mapOnlineBookToCard = (
  book: EBook,
  entities: TagEntity[] = [],
  options: OnlineBookCardMappingOptions = {},
): ApiBookCardModel => {
  const mapped = mapEBookToCard(book, {
    context: 'hitomi',
    entities,
    sourceUrl: book.url,
  })
  const thumbnailRequest = webThumbnailRequest(mapped.pageUrls)

  if (thumbnailRequest) return { ...mapped, thumbnailRequest }
  if (options.preserveLocalThumbnail) return mapped
  return { ...mapped, thumbnailRequest: undefined }
}

const mapUnmatchedBook = (rawBook: OnlineBookInPage, entities: TagEntity[]) => {
  const sourceBook = normalizedRawBook(rawBook)
  return mapOnlineBookToCard(sourceBook, entities, { preserveLocalThumbnail: true })
}

const findLibraryMatch = (rawBook: OnlineBookInPage, libraryBooks: EBook[]) => {
  const groupId = normalizedId(rawBook.groupId)
  const bookId = normalizedId(rawBook.bookId)

  if (groupId && bookId) {
    return libraryBooks.find((candidate) => (
      normalizedId(candidate.groupId) === groupId
      && normalizedId(candidate.bookId) === bookId
    ))
  }

  if (groupId || bookId) return undefined

  const url = rawUrl(rawBook.url)
  if (!url) return undefined
  return libraryBooks.find((candidate) => rawUrl(candidate.url) === url)
}

const pageNumber = (value: unknown) => {
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) return 1
  return Math.max(1, Math.floor(numeric))
}

const safeEntities = (value: unknown): TagEntity[] => (
  Array.isArray(value) ? value.filter(isObject) as TagEntity[] : []
)

const safeBooks = (value: unknown): EBook[] => (
  Array.isArray(value) ? value.filter(isObject) as EBook[] : []
)

/** Map a web-page response to the gallery card and pagination models used by the UI. */
export const mapHitomiSearchResponse = (
  response: OnlineBookPageResponse | null | undefined,
): HitomiSearchResult => {
  const onlineBookPage = response?.onlineBookPage
  const entities = safeEntities(response?.tags)
  const libraryBooks = safeBooks(response?.books)
  const rawBooks = Array.isArray(onlineBookPage?.books)
    ? onlineBookPage.books.filter(isObject) as OnlineBookInPage[]
    : []

  const books = rawBooks.map((rawBook) => {
    const libraryMatch = findLibraryMatch(rawBook, libraryBooks)
    return libraryMatch
      ? mapEBookToCard(libraryMatch, { context: 'library', entities })
      : mapUnmatchedBook(rawBook, entities)
  })

  return {
    books,
    totalPage: pageNumber(response?.totalPage ?? onlineBookPage?.totalPage),
    currentPage: pageNumber(response?.currentPage ?? onlineBookPage?.currentPage),
  }
}

export const mapOnlineBookPageResponse = mapHitomiSearchResponse
