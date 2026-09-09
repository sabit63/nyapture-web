import { ApiError, requestJsonResponse } from './client'
import type { EBook, NyaTagType } from '../models'

export type RecommendationType = 'Book' | 'Artist' | 'Group'
export type RecommendationThumbnailBook = { groupId: string; bookId: string; uploadedTime: string }
export type RecommendationTagDisplayName = { type: NyaTagType; name: string; displayName: string }
export type RecommendationEntity = {
  key?: RecommendationHit['key']
  totalBookCount?: number
  semanticBookCount?: number
  exactBookCount?: number
  representativeTags?: string[]
  thumbnailBook?: RecommendationThumbnailBook | null
}
export type RecommendationHit = {
  key?: { entityType: RecommendationType; groupId?: string; bookId?: string; tagName?: string }
  book?: EBook | null
  entity?: RecommendationEntity | null
  score?: number
  signals?: { titleRank?: number | null; semanticTagRank?: number | null; exactTagRank?: number | null }
  reasons?: string[]
  commonTags?: string[]
}
export type RecommendationResponse = {
  profileVersion?: string | null
  exactWeightingVersion?: string | null
  generateEmbeddings?: boolean | null
  detail?: string | null
  sourceEntity?: RecommendationEntity | null
  status: 'success' | 'no_features' | 'pending' | 'not_found' | 'unavailable'
  items?: RecommendationHit[] | null
  isStale?: boolean
  tagDisplayNames?: RecommendationTagDisplayName[]
}
export type RecommendationResult = RecommendationResponse & { retryAfterSeconds?: number }

export async function getBookRecommendations(groupId: string, bookId: string, targetType: RecommendationType, signal: AbortSignal): Promise<RecommendationResult> {
  return getRecommendations(`/api/book/${encodeURIComponent(groupId)}/${encodeURIComponent(bookId)}/recommendations`, { targetType, limit: 20 }, signal)
}

export async function getEntityRecommendations(entityType: 'Artist' | 'Group', tagName: string, targetType: 'Artist' | 'Group', signal: AbortSignal): Promise<RecommendationResult> {
  return getRecommendations(`/api/recommendations/entities/${entityType}`, { tagName, targetType, limit: 20 }, signal)
}

async function getRecommendations(path: string, query: { targetType: RecommendationType; limit: number; tagName?: string }, signal: AbortSignal): Promise<RecommendationResult> {
  try {
    const response = await requestJsonResponse<RecommendationResponse>(
      path,
      { query, signal, retryAfterMaxSeconds: 2147483 },
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
