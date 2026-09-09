import { useEffect, useRef, useState } from 'react'
import { getBookRecommendations, getEntityRecommendations } from '../../api/recommendations'
import type { RecommendationResult, RecommendationType } from '../../api/recommendations'
import { ApiError } from '../../api/client'

export type RecommendationState = {
  result?: RecommendationResult
  loading?: boolean
  error?: string
  attempts: number
  nextCheckAt?: number
}

// The owning panel is keyed by book identity; cache lifetime is one viewer visit.
export function useRecommendations(groupId: string, bookId: string, open: boolean, type: RecommendationType, entityType?: 'Artist' | 'Group', limit = 20) {
  const cache = useRef<Partial<Record<string, RecommendationState>>>({})
  const cacheKey = `${type}:${limit}`
  const [revision, setRevision] = useState(0)
  const [, render] = useState(0)
  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    const publish = (state: RecommendationState) => {
      cache.current[cacheKey] = state
      render((value) => value + 1)
    }
    const schedule = (state: RecommendationState) => {
      if (state.result?.status !== 'pending' || state.attempts >= 3) return
      timer = setTimeout(() => { void fetchResult(state.attempts + 1) }, Math.max(0, (state.nextCheckAt ?? Date.now()) - Date.now()))
    }
    async function fetchResult(attempts: number) {
      publish({ ...cache.current[cacheKey], loading: true, error: undefined, attempts })
      try {
        const result = entityType
          ? await getEntityRecommendations(entityType, bookId, type === 'Group' ? 'Group' : 'Artist', controller.signal, limit)
          : await getBookRecommendations(groupId, bookId, type, controller.signal, limit)
        if (controller.signal.aborted) return
        const state = { result, attempts, nextCheckAt: Date.now() + (result.retryAfterSeconds ?? 60) * 1000 }
        publish(state)
        schedule(state)
      } catch (error) {
        if (controller.signal.aborted) return
        publish({ attempts, error: error instanceof ApiError && (error.status === 401 || error.status === 403)
          ? '接続設定と認証情報を確認してください' : '関連候補を取得できませんでした' })
      }
    }
    const cached = cache.current[cacheKey]
    if (!cached || cached.loading) void fetchResult(cached?.attempts ?? 0)
    else schedule(cached)
    return () => { controller.abort(); clearTimeout(timer) }
  }, [groupId, bookId, open, type, revision, entityType, limit, cacheKey])

  return {
    state: cache.current[cacheKey],
    retry: () => { delete cache.current[cacheKey]; setRevision((value) => value + 1) },
  }
}
