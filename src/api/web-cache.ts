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
  WebBookCacheSearchRequest,
  WebBookCacheSearchResponse,
  WebBookCacheSiteTestResponse,
  WebBookCacheStatusResponse,
  WebBookCacheSyncRequest,
  WebBookCacheSyncStartResponse,
  WebBookCacheValidationResponse,
} from '../models/web-cache'

type ApiResponse = {
  success?: boolean
  message?: string | null
}

type ApiEnvelope<T> = ApiResponse & {
  data?: T | null
}

const segment = (value: string) => encodeURIComponent(value)

const failureMessage = (response?: ApiResponse | null) => (
  response?.message?.trim() || 'Web Book Cache APIの応答に失敗しました。'
)

const assertSuccess = (response: (ApiResponse & { data?: unknown }) | null | undefined): void => {
  if (response?.success === false) {
    const data = response.data
    const errors = data && typeof data === 'object' && 'errors' in data && Array.isArray(data.errors)
      ? data.errors.filter((value): value is string => typeof value === 'string')
      : undefined
    throw new ApiError(failureMessage(response), { validationErrors: errors })
  }
}

const unwrapData = <T>(response: ApiEnvelope<T>): T => {
  assertSuccess(response)
  if (response.data === undefined || response.data === null) {
    throw new ApiError(failureMessage(response))
  }
  return response.data
}

/** Search responses are returned directly by the Web Book Cache endpoint. */
export const searchCache = async (
  request: WebBookCacheSearchRequest,
  signal?: AbortSignal,
): Promise<WebBookCacheSearchResponse> => {
  const response = await searchWebBookCache(request, signal)
  assertSuccess(response)
  return response
}

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
