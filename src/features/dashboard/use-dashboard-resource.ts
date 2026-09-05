import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError, getErrorMessage } from '../../api'
import type { DashboardApiResponse } from '../../models/dashboard'

export type DashboardResourceStatus = 'idle' | 'loading' | 'refreshing' | 'success' | 'error'

export type DashboardResourceLoader<T> = (
  signal: AbortSignal,
) => Promise<DashboardApiResponse<T>>

export type DashboardResourceQuery<T> = {
  data: T | null
  status: DashboardResourceStatus
  error: string | null
  ready: boolean
  loading: boolean
  refreshing: boolean
  announcement: string
  generatedAt: string | null
  refresh: () => Promise<void>
  poll: (signal: AbortSignal) => Promise<void>
  update: (updater: (current: T | null) => T | null) => void
}

type GeneratedResource = { generatedAt?: string | null }

const getGeneratedAt = <T>(data: T | null) => (
  (data as GeneratedResource | null)?.generatedAt ?? null
)

/**
 * Shared dashboard resource lifecycle.
 *
 * `apiRevision` and `resourceKey` invalidate the previous response. Calls to
 * `refresh` and `poll` intentionally retain existing data so a transient
 * failure is shown alongside the last known snapshot.
 */
export function useDashboardResource<T>(
  apiRevision: number,
  resourceKey: string,
  title: string,
  load: DashboardResourceLoader<T>,
  manualRefreshRevision = 0,
): DashboardResourceQuery<T> {
  const [data, setData] = useState<T | null>(null)
  const dataRef = useRef<T | null>(null)
  const requestRef = useRef<AbortController | null>(null)
  const requestIdRef = useRef(0)
  const [status, setStatus] = useState<DashboardResourceStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  const [announcement, setAnnouncement] = useState('')

  const refreshInternal = useCallback((reset: boolean, pollSignal?: AbortSignal): Promise<void> => {
    if (pollSignal?.aborted) return Promise.resolve()
    requestRef.current?.abort()
    const controller = new AbortController()
    const requestId = requestIdRef.current + 1
    requestIdRef.current = requestId
    requestRef.current = controller
    const hasData = !reset && dataRef.current !== null

    if (reset) {
      dataRef.current = null
      setData(null)
      setReady(false)
    }
    setStatus(hasData ? 'refreshing' : 'loading')
    setError(null)
    setAnnouncement(`${title}${hasData ? 'を更新中' : 'を読み込み中'}`)

    const onPollAbort = pollSignal ? () => controller.abort() : null
    if (pollSignal && onPollAbort) pollSignal.addEventListener('abort', onPollAbort, { once: true })

    return load(controller.signal).then((response) => {
      if (controller.signal.aborted || requestRef.current !== controller || requestIdRef.current !== requestId) return
      if (response.success === false) {
        throw new ApiError(response.message ?? `${title}の取得に失敗しました。`, { category: 'server' })
      }
      const next = response.data ?? null
      dataRef.current = next
      setData(next)
      setReady(true)
      setStatus('success')
      setError(null)
      setAnnouncement(`${title}${hasData ? 'を更新しました' : 'を読み込みました'}`)
    }).catch((requestError: unknown) => {
      if (controller.signal.aborted || requestRef.current !== controller || requestIdRef.current !== requestId) return
      setReady(true)
      setStatus(hasData ? 'success' : 'error')
      setError(getErrorMessage(requestError))
      setAnnouncement(`${title}エラー`)
    }).finally(() => {
      if (pollSignal && onPollAbort) pollSignal.removeEventListener('abort', onPollAbort)
      if (requestRef.current !== controller || requestIdRef.current !== requestId) return
      requestRef.current = null
      if (controller.signal.aborted) {
        setReady(hasData)
        setStatus((current) => current === 'loading' || current === 'refreshing' ? (hasData ? 'success' : 'idle') : current)
        return
      }
      setReady(true)
      setStatus((current) => current === 'loading' || current === 'refreshing' ? (hasData ? 'success' : current) : current)
    })
  }, [load, title])

  const update = useCallback((updater: (current: T | null) => T | null) => {
    const next = updater(dataRef.current)
    dataRef.current = next
    setData(next)
  }, [])

  useEffect(() => {
    void refreshInternal(true)
    return () => {
      requestIdRef.current += 1
      requestRef.current?.abort()
      requestRef.current = null
    }
  }, [apiRevision, resourceKey, refreshInternal])

  const previousManualRefreshRevision = useRef(manualRefreshRevision)
  useEffect(() => {
    if (previousManualRefreshRevision.current === manualRefreshRevision) return
    previousManualRefreshRevision.current = manualRefreshRevision
    void refreshInternal(false)
  }, [manualRefreshRevision, refreshInternal])

  const refresh = useCallback(() => refreshInternal(false), [refreshInternal])
  const poll = useCallback((signal: AbortSignal) => refreshInternal(false, signal), [refreshInternal])
  const generatedAt = getGeneratedAt(data)
  return {
    data,
    status,
    error,
    ready,
    loading: status === 'loading',
    refreshing: status === 'refreshing',
    announcement,
    generatedAt,
    refresh,
    poll,
    update,
  }
}
