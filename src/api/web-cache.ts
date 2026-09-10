import { ApiError, requestBlob, requestJson } from './client'
import {
  downloadWebBookCacheBook,
  getWebBookCacheBook,
  searchWebBookCache,
} from './endpoints'
import type {
  WebBookCacheBookDto,
  WebBookCacheConfigDto,
  WebBookCacheConfigResponse,
  WebBookCacheSiteTestResponse,
  WebBookCacheStatusResponse,
  WebBookCacheSyncRequest,
  WebBookCacheSyncStartResponse,
  WebBookCacheValidationResponse,
} from './dto/web-cache'
import { createEnvelopePolicy, type ApiResponse, type ApiEnvelope } from './response'

const segment = (value: string) => encodeURIComponent(value)
const { assertSuccess, unwrapData } = createEnvelopePolicy('Web Book Cache APIの応答に失敗しました。')

/** Search responses are returned directly by the Web Book Cache endpoint. */
export const searchCache = searchWebBookCache

export const getCacheBook = async (
  groupId: string,
  bookId: string,
  signal?: AbortSignal,
): Promise<WebBookCacheBookDto> => (
  unwrapData(await getWebBookCacheBook(groupId, bookId, signal) as ApiEnvelope<WebBookCacheBookDto>)
)

export const enqueueCacheBook = async (
  groupId: string,
  bookId: string,
  signal?: AbortSignal,
): Promise<void> => {
  const response = await downloadWebBookCacheBook(groupId, bookId, signal)
  assertSuccess(response)
}

export const deleteCacheBook = async (
  groupId: string,
  bookId: string,
  signal?: AbortSignal,
): Promise<void> => {
  const response = await requestJson<ApiResponse>(`/api/web-cache/${segment(groupId)}/${segment(bookId)}`, {
    method: 'DELETE',
    auth: 'edit',
    signal,
  })
  assertSuccess(response)
}

export const loadCacheThumbnail = (
  groupId: string,
  bookId: string,
  signal?: AbortSignal,
): Promise<Blob> => requestBlob(`/api/web-cache/${segment(groupId)}/${segment(bookId)}/thumbnail`, {
  headers: { Accept: 'image/*' },
  signal,
})

export const getCacheConfig = async (signal?: AbortSignal): Promise<WebBookCacheConfigResponse> => (
  unwrapData(await requestJson<ApiEnvelope<WebBookCacheConfigResponse>>('/api/dashboard/web-cache/config', { signal }))
)

export const validateCacheConfig = async (
  config: WebBookCacheConfigDto,
  signal?: AbortSignal,
): Promise<WebBookCacheValidationResponse> => (
  unwrapData(await requestJson<ApiEnvelope<WebBookCacheValidationResponse>>('/api/dashboard/web-cache/config/validate', {
    method: 'POST',
    body: config,
    signal,
  }))
)

export const saveCacheConfig = async (
  config: WebBookCacheConfigDto,
  signal?: AbortSignal,
): Promise<WebBookCacheConfigResponse> => (
  unwrapData(await requestJson<ApiEnvelope<WebBookCacheConfigResponse>>('/api/dashboard/web-cache/config', {
    method: 'PATCH',
    body: config,
    auth: 'edit',
    signal,
  }))
)

export const resetCacheConfig = async (signal?: AbortSignal): Promise<void> => {
  const response = await requestJson<ApiResponse>('/api/dashboard/web-cache/config/reset', {
    method: 'POST',
    auth: 'edit',
    signal,
  })
  assertSuccess(response)
}

export const getCacheStatus = async (signal?: AbortSignal): Promise<WebBookCacheStatusResponse> => (
  unwrapData(await requestJson<ApiEnvelope<WebBookCacheStatusResponse>>('/api/dashboard/web-cache/status', { signal }))
)

export const runCacheSync = async (
  request: WebBookCacheSyncRequest,
  signal?: AbortSignal,
): Promise<WebBookCacheSyncStartResponse> => (
  unwrapData(await requestJson<ApiEnvelope<WebBookCacheSyncStartResponse>>('/api/dashboard/web-cache/sync/run', {
    method: 'POST',
    body: { groupId: request.groupId ?? null, force: request.force },
    auth: 'edit',
    signal,
  }))
)

export const cancelCacheSync = async (signal?: AbortSignal): Promise<void> => {
  const response = await requestJson<ApiResponse>('/api/dashboard/web-cache/sync/cancel', {
    method: 'POST',
    auth: 'edit',
    signal,
  })
  assertSuccess(response)
}

export const testCacheSite = async (
  groupId: string,
  signal?: AbortSignal,
): Promise<WebBookCacheSiteTestResponse> => {
  const response = await requestJson<ApiEnvelope<WebBookCacheSiteTestResponse>>(
    `/api/dashboard/web-cache/sites/${segment(groupId)}/test`,
    { method: 'POST', signal },
  )
  const result = unwrapData(response)
  if (result.success === false) {
    throw new ApiError(result.message?.trim() || 'Web Book Cacheサイト接続試験に失敗しました。')
  }
  return result
}
