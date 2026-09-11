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
import { ApiError, requestBlob, requestJson, requestJsonResponse } from './client'
import type {
  WebBookCacheBookDto,
  WebBookCacheSearchRequest,
  WebBookCacheSearchResponse,
} from './dto/web-cache-candidate'
export type {
  WebBookCacheBookDto,
  WebBookCacheSearchRequest,
  WebBookCacheSearchResponse,
} from './dto/web-cache-candidate'

type EndpointApiEnvelope<T> = NyaApiResponse & { data?: T }

const segment = (value: string) => encodeURIComponent(value)

/** All search screens treat HTTP 200 as success, including empty search responses. */
const requestSearch = async <T extends { success?: boolean; message?: string }>(path: string, query: unknown, signal?: AbortSignal): Promise<T> => {
  const { body, status } = await requestJsonResponse<T>(path, { method: 'POST', body: query, signal })
  if (status !== 200 && body.success === false) throw new ApiError(body.message ?? '検索に失敗しました。', { category: 'server', status })
  return body
}

export const searchBooks = (filter: BookSearchFilter, signal?: AbortSignal) => (
  requestSearch<EBookResponse>('/api/book/search', filter, signal)
)

export const getBook = (groupId: string, bookId: string, signal?: AbortSignal) => (
  requestJson<EBookResponse>(`/api/book/${segment(groupId)}/${segment(bookId)}`, { signal })
)

export const updateBookTitle = (
  groupId: string,
  bookId: string,
  title: string,
  signal?: AbortSignal,
) => (
  requestJson<NyaApiResponse>(`/api/book/${segment(groupId)}/${segment(bookId)}/title`, {
    method: 'PATCH',
    body: { title },
    auth: 'edit',
    signal,
  })
)

/** Permanently remove a library book, including its page storage and metadata. */
export const deleteBookPhysical = (groupId: string, bookId: string, signal?: AbortSignal) => (
  requestJson<BookDeletionJobResponse>(`/api/book/${segment(groupId)}/${segment(bookId)}`, {
    method: 'DELETE',
    query: { remove: true },
    auth: 'edit',
    signal,
  })
)

/**
 * Permanently remove a library book and retain the HTTP response metadata.
 *
 * The body contract intentionally matches deleteBookPhysical.  The metadata
 * is needed by the asynchronous deletion monitor for Retry-After scheduling,
 * while the legacy endpoint above continues to expose only its response body.
 */
export const deleteBookPhysicalWithMetadata = (
  groupId: string,
  bookId: string,
  signal?: AbortSignal,
) => (
  requestJsonResponse<BookDeletionJobResponse>(`/api/book/${segment(groupId)}/${segment(bookId)}`, {
    method: 'DELETE',
    query: { remove: true },
    auth: 'edit',
    signal,
  })
)

/** Explicit name for the asynchronous physical-deletion enqueue operation. */
export const enqueueBookPhysicalDeletion = deleteBookPhysicalWithMetadata

/** @deprecated Use deleteBookPhysical to make the deletion disposition explicit. */
export const deleteBook = deleteBookPhysical

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
  requestSearch<WebBookCacheSearchResponse>('/api/web-cache/search', filter, signal)
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
  requestJson<OnlineBookResponse>('/api/web/book', { method: 'POST', body: url, auth: 'edit', signal })
)

export const getWebPageContent = (url: string, signal?: AbortSignal) => (
  requestSearch<OnlineBookPageResponse>('/api/web/page', url, signal)
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
