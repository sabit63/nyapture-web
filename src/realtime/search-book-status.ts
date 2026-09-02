import { createBookPageThumbnailRequest } from '../api/books'
import type { ApiBookCardModel } from '../api/books'
import { NYA_BOOK_STATUSES } from '../models'
import type { BookDownloadStatus, NyaBookStatus } from '../models'

export type SearchBookStatusVersionMap = Map<string, number>

export type SearchBookStatusApplyResult = {
  books: ApiBookCardModel[]
  matchedKey?: string
  accepted: boolean
  changed: boolean
}

const normalizedIdentity = (value: string | null | undefined) => value?.trim() ?? ''

const timestampValue = (value: string | null | undefined) => {
  if (!value) return undefined
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? undefined : parsed
}

export const getApiBookIdentityKey = (
  book: Pick<ApiBookCardModel, 'apiGroupId' | 'apiBookId'>,
) => {
  const groupId = normalizedIdentity(book.apiGroupId)
  const bookId = normalizedIdentity(book.apiBookId)
  return groupId && bookId ? `${groupId}\u0000${bookId}` : undefined
}

export const getDownloadStatusIdentityKey = (status: BookDownloadStatus) => {
  const groupId = normalizedIdentity(status.book?.groupId)
  const bookId = normalizedIdentity(status.book?.bookId)
  if (groupId && bookId) return `${groupId}\u0000${bookId}`

  const url = normalizedIdentity(status.book?.url)
  return url ? `url:${url}` : undefined
}

const isNyaBookStatus = (value: string | null | undefined): value is NyaBookStatus => (
  Boolean(value) && NYA_BOOK_STATUSES.includes(value as NyaBookStatus)
)

const findMatchingBookIndex = (books: ApiBookCardModel[], status: BookDownloadStatus) => {
  const groupId = normalizedIdentity(status.book?.groupId)
  const bookId = normalizedIdentity(status.book?.bookId)
  if (groupId && bookId) {
    return books.findIndex((book) => (
      normalizedIdentity(book.apiGroupId) === groupId
      && normalizedIdentity(book.apiBookId) === bookId
    ))
  }

  const url = normalizedIdentity(status.book?.url)
  if (!url) return -1
  const matches = books.reduce<number[]>((result, book, index) => (
    normalizedIdentity(book.url) === url ? [...result, index] : result
  ), [])
  return matches.length === 1 ? matches[0] : -1
}

export const applySearchBookDownloadStatus = (
  books: ApiBookCardModel[],
  status: BookDownloadStatus,
  versions: SearchBookStatusVersionMap,
): SearchBookStatusApplyResult => {
  if (!isNyaBookStatus(status.book?.status)) {
    return { books, accepted: false, changed: false }
  }

  const index = findMatchingBookIndex(books, status)
  if (index < 0) return { books, accepted: false, changed: false }

  const matchedKey = getApiBookIdentityKey(books[index])
    ?? getDownloadStatusIdentityKey(status)
  if (!matchedKey) return { books, accepted: false, changed: false }

  const nextTimestamp = timestampValue(status.lastUpdated)
  const currentTimestamp = versions.get(matchedKey)
  if (
    currentTimestamp !== undefined
    && nextTimestamp !== undefined
    && nextTimestamp <= currentTimestamp
  ) {
    return { books, matchedKey, accepted: false, changed: false }
  }
  if (nextTimestamp !== undefined) versions.set(matchedKey, nextTimestamp)

  const currentBook = books[index]
  const downloadedThumbnailRequest = status.book.status === 'Downloaded'
    ? createBookPageThumbnailRequest(
      status.book.groupId ?? currentBook.apiGroupId,
      status.book.bookId ?? currentBook.apiBookId,
      status.book.totalPage ?? currentBook.totalPage,
    )
    : undefined
  const thumbnailReloadKey = downloadedThumbnailRequest
    ? `downloaded:${status.lastUpdated ?? 'current'}`
    : currentBook.thumbnailReloadKey
  const shouldRefreshThumbnail = downloadedThumbnailRequest !== undefined && (
    currentBook.status !== 'Downloaded'
    || currentBook.thumbnailRequest?.path !== downloadedThumbnailRequest.path
    || currentBook.thumbnailReloadKey !== thumbnailReloadKey
  )

  if (currentBook.status === status.book.status && !shouldRefreshThumbnail) {
    return { books, matchedKey, accepted: true, changed: false }
  }

  const next = [...books]
  next[index] = {
    ...currentBook,
    status: status.book.status,
    ...(downloadedThumbnailRequest ? {
      thumbnailRequest: downloadedThumbnailRequest,
      thumbnailReloadKey,
    } : {}),
  }
  return { books: next, matchedKey, accepted: true, changed: true }
}

export const applySearchBookDownloadStatuses = (
  books: ApiBookCardModel[],
  statuses: BookDownloadStatus[],
  versions: SearchBookStatusVersionMap,
) => statuses.reduce(
  (current, status) => applySearchBookDownloadStatus(current, status, versions).books,
  books,
)
