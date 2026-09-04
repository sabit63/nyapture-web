import type {
  BookDownloadRequest,
  BookDownloadStatus,
  BookDownloadSystemStatus,
  BookDeletionJobResponse,
  BookSearchFilter,
  EBookResponse,
  NyaApiResponse,
  NyaTagType,
  OnlineBookPageResponse,
  OnlineBookResponse,
  TagAutocompleteResponse,
  TagAdditionalNameDto,
  TagAdditionalNameUpsertRequest,
  TagAdditionalNameUpsertResponse,
} from '../models'
import { requestBlob, requestJson } from './client'

type EndpointApiEnvelope<T> = NyaApiResponse & { data?: T }

export type WebBookCacheBookDto = {
  groupId?: string | null
  bookId?: string | null
  url?: string | null
  title?: string | null
  captions?: Record<string, string>
  totalPage?: number
  tagSet?: Record<string, string[]>
  uploadedTime?: string
  pageUrls?: string[]
  thumbnailUrl?: string | null
  sourcePageUrl?: string | null
  firstCachedAt?: string
  lastSyncedAt?: string
  lastSeenAt?: string
  syncError?: string | null
  autoDownloadEvaluatedAt?: string | null
  autoDownloadMatched?: boolean
  autoDownloadReason?: string | null
  autoDownloadEnqueuedAt?: string | null
}

export type WebBookCacheSearchRequest = {
  keyword?: string | null
  groupIds?: string[]
  bookIds?: string[]
  lowerUploadedTime?: string | null
  upperUploadedTime?: string | null
  maxPageCount?: number | null
  page?: number
  limit?: number | null
  isAsc?: boolean
}

export type WebBookCacheSearchResponse = {
  success?: boolean
  books?: WebBookCacheBookDto[]
  totalCount?: number
  totalPage?: number
  currentPage?: number
  pageSize?: number
}

const segment = (value: string) => encodeURIComponent(value)

export const searchBooks = (filter: BookSearchFilter, signal?: AbortSignal) => (
  requestJson<EBookResponse>('/api/book/search', { method: 'POST', body: filter, signal })
)

export const getBook = (groupId: string, bookId: string, signal?: AbortSignal) => (
  requestJson<EBookResponse>(`/api/book/${segment(groupId)}/${segment(bookId)}`, { signal })
)

export const deleteBook = (groupId: string, bookId: string, signal?: AbortSignal) => (
  requestJson<BookDeletionJobResponse>(`/api/book/${segment(groupId)}/${segment(bookId)}`, {
    method: 'DELETE',
    query: { remove: true },
    auth: 'edit',
    signal,
  })
)

export const getBookDeletionJob = (jobId: string, signal?: AbortSignal) => (
  requestJson<BookDeletionJobResponse>(`/api/book/deletion-jobs/${segment(jobId)}`, { signal })
)

export const getBookPageBlob = (
  book: {
    groupId: string
    bookId: string
    page: number
    width?: number
    height?: number
    format?: 'jpeg' | 'png' | 'webp' | 'avif'
    fallbackToOriginal?: boolean
  },
  signal?: AbortSignal,
) => requestBlob('/api/book/page', {
  query: {
    groupId: book.groupId,
    bookId: book.bookId,
    page: book.page,
    width: book.width,
    height: book.height,
    strategy: 'balanced',
    format: book.format,
    fallback_to_original: book.fallbackToOriginal ?? true,
  },
  headers: { Accept: 'image/*' },
  signal,
})

export const autocompleteTags = (query: string, type?: NyaTagType, signal?: AbortSignal) => (
  requestJson<TagAutocompleteResponse>('/api/tag/autocomplete', {
    query: { q: query, type, limit: 10 },
    signal,
  })
)

export const getTagAdditionalName = (tagType: NyaTagType, name: string, signal?: AbortSignal) => (
  requestJson<TagAdditionalNameDto>(`/api/tag-additional/${segment(tagType)}/${segment(name)}`, { signal })
)

export const upsertTagAdditionalNames = (
  requests: TagAdditionalNameUpsertRequest[],
  signal?: AbortSignal,
) => (
  requestJson<TagAdditionalNameUpsertResponse>('/api/tag-additional', {
    method: 'POST',
    body: requests,
    auth: 'edit',
    signal,
  })
)

export const searchWebBookCache = (filter: WebBookCacheSearchRequest, signal?: AbortSignal) => (
  requestJson<WebBookCacheSearchResponse>('/api/web-cache/search', { method: 'POST', body: filter, signal })
)

export const getWebBookCacheBook = (groupId: string, bookId: string, signal?: AbortSignal) => (
  requestJson<EndpointApiEnvelope<WebBookCacheBookDto>>(`/api/web-cache/${segment(groupId)}/${segment(bookId)}`, { signal })
)

export const downloadWebBookCacheBook = (groupId: string, bookId: string, signal?: AbortSignal) => (
  requestJson<NyaApiResponse>(`/api/web-cache/${segment(groupId)}/${segment(bookId)}/download`, {
    method: 'POST',
    auth: 'edit',
    signal,
  })
)

export const getWebBookContent = (url: string, signal?: AbortSignal) => (
  requestJson<OnlineBookResponse>('/api/web/book', { method: 'POST', body: url, signal })
)

export const getWebPageContent = (url: string, signal?: AbortSignal) => (
  requestJson<OnlineBookPageResponse>('/api/web/page', { method: 'POST', body: url, signal })
)

export const getDownloadStatuses = (signal?: AbortSignal) => (
  requestJson<Record<string, BookDownloadStatus>>('/api/download/status-all', { signal })
)

export const getDownloadSystemStatus = (signal?: AbortSignal) => (
  requestJson<BookDownloadSystemStatus>('/api/download/system-status', { signal })
)

export const pauseAllDownloads = (signal?: AbortSignal) => (
  requestJson<NyaApiResponse>('/api/download/pause', { method: 'POST', auth: 'edit', signal })
)

export const resumeAllDownloads = (signal?: AbortSignal) => (
  requestJson<NyaApiResponse>('/api/download/resume', { method: 'POST', auth: 'edit', signal })
)

export const pauseDownloadItem = (url: string, signal?: AbortSignal) => (
  requestJson<NyaApiResponse>('/api/download/pause-item', { method: 'POST', body: url, auth: 'edit', signal })
)

export const resumeDownloadItem = (url: string, signal?: AbortSignal) => (
  requestJson<NyaApiResponse>('/api/download/resume-item', { method: 'POST', body: url, auth: 'edit', signal })
)

export const deleteDownloadItem = (key: string, signal?: AbortSignal) => (
  requestJson<NyaApiResponse>('/api/download/delete', { method: 'POST', body: key, auth: 'edit', signal })
)

export const updateDownloadPriority = (request: BookDownloadRequest, signal?: AbortSignal) => (
  requestJson<NyaApiResponse>('/api/download/queue/priority', { method: 'POST', body: request, auth: 'edit', signal })
)

export const startBookDownload = (request: BookDownloadRequest, signal?: AbortSignal) => (
  requestJson<NyaApiResponse>('/api/download/start', { method: 'POST', body: request, auth: 'edit', signal })
)
