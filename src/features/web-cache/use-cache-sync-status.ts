import { useCallback, useEffect, useRef, useState } from 'react'
import { getCacheStatus } from '../../api/web-cache'
import { getErrorMessage } from '../../api'
import type { WebBookCacheStatusResponse } from '../../models/web-cache'
import { useVisiblePolling } from '../../hooks/use-visible-polling'

export function useCacheSyncStatus(apiRevision: number) {
  const [status, setStatus] = useState<WebBookCacheStatusResponse | null>(null)
  const [statusLoading, setStatusLoading] = useState(true)
  const [statusError, setStatusError] = useState<string | null>(null)
  const requestRef = useRef<AbortController | null>(null)
  const revisionRef = useRef(apiRevision)
  const abortStatus = useCallback(() => requestRef.current?.abort(), [])
  const loadStatus = useCallback(async (_generation?: number, silent = false, signal?: AbortSignal) => {
    if (revisionRef.current !== apiRevision || signal?.aborted) return
    requestRef.current?.abort()
    const controller = new AbortController()
    requestRef.current = controller
    const abort = () => controller.abort()
    signal?.addEventListener('abort', abort, { once: true })
    if (!silent) setStatusLoading(true)
    try {
      const result = await getCacheStatus(controller.signal)
      if (controller.signal.aborted || revisionRef.current !== apiRevision) return
      setStatus(result)
      setStatusError(null)
    } catch (error) {
      if (!controller.signal.aborted && revisionRef.current === apiRevision) setStatusError(getErrorMessage(error))
    } finally {
      signal?.removeEventListener('abort', abort)
      if (requestRef.current === controller) {
        requestRef.current = null
        setStatusLoading(false)
      }
    }
  }, [apiRevision])
  useEffect(() => {
    revisionRef.current = apiRevision
    setStatus(null)
    setStatusError(null)
    void loadStatus()
    return abortStatus
  }, [abortStatus, apiRevision, loadStatus])
  const poll = useCallback((signal: AbortSignal) => loadStatus(undefined, true, signal), [loadStatus])
  useVisiblePolling({ intervalMs: 2_000, enabled: status?.isRunning === true, poll })
  return { status, setStatus, statusLoading, statusError, loadStatus, abortStatus }
}
