import { ApiError, requestJsonResponse } from './client'
import type { EBook, NyaTagType } from '../models'

export type RecommendationType = 'Book' | 'Artist' | 'Group'
export type RecommendationThumbnailBook = { groupId: string; bookId: string; uploadedTime: string }
export type RecommendationTagDisplayName = { type: NyaTagType; name: string; displayName: string }
export type RecommendationHit = {
  key?: { entityType: RecommendationType; groupId?: string; bookId?: string; tagName?: string }
  book?: EBook | null
  entity?: { totalBookCount?: number; representativeTags?: string[]; thumbnailBook?: RecommendationThumbnailBook | null } | null
  commonTags?: string[]
}
export type RecommendationResponse = {
  status: 'success' | 'no_features' | 'pending' | 'not_found' | 'unavailable'
  items?: RecommendationHit[] | null
  isStale?: boolean
  tagDisplayNames?: RecommendationTagDisplayName[]
}
export type RecommendationResult = RecommendationResponse & { retryAfterSeconds?: number }

export async function getBookRecommendations(groupId: string, bookId: string, targetType: RecommendationType, signal: AbortSignal): Promise<RecommendationResult> {
  try {
    const response = await requestJsonResponse<RecommendationResponse>(
      `/api/book/${encodeURIComponent(groupId)}/${encodeURIComponent(bookId)}/recommendations`,
      { query: { targetType, limit: 20 }, signal, retryAfterMaxSeconds: 2147483 },
    )
    if (!response.body || !['success', 'no_features', 'pending', 'not_found', 'unavailable'].includes(response.body.status)) {
      throw new ApiError('関連候補の応答が不正です。', { category: 'server' })
    }
    return { ...response.body, retryAfterSeconds: response.retryAfterSeconds }
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return { status: 'not_found' }
    if (error instanceof ApiError && error.status === 503) return { status: 'unavailable' }
    throw error
  }
}

/** Missing metadata is allowed by the API; only discard hits without a usable destination. */
export function usableRecommendations(items: RecommendationHit[] | null | undefined, type: RecommendationType) {
  const seen = new Set<string>()
  return (Array.isArray(items) ? items : []).filter((hit) => {
    const key = hit?.key
    if (!key || key.entityType !== type) return false
    const identity = type === 'Book'
      ? key.groupId?.trim() && key.bookId?.trim() ? JSON.stringify([key.groupId, key.bookId]) : ''
      : key.tagName?.trim() ?? ''
    if (!identity || seen.has(identity)) return false
    seen.add(identity)
    return true
  }).slice(0, 20)
}
