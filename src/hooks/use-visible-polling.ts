import { useCallback, useEffect, useRef } from 'react'

export type VisiblePoll = (signal: AbortSignal) => void | Promise<void>

export type VisiblePollingOptions = {
  intervalMs: number
  enabled?: boolean
  poll: VisiblePoll
}

/**
 * Runs a REST poll only while the document is visible.
 *
 * The callback receives the AbortSignal owned by the poller. Callers should
 * pass it to their polling request so a hidden tab can cancel that request
 * without affecting manual reads or mutations.
 */
export function useVisiblePolling({ intervalMs, enabled = true, poll }: VisiblePollingOptions) {
  const pollRef = useRef(poll)
  const enabledRef = useRef(enabled)
  const intervalRef = useRef(intervalMs)
  const visibleRef = useRef(typeof document === 'undefined' || !document.hidden)
  const timerRef = useRef<number | null>(null)
  const controllerRef = useRef<AbortController | null>(null)
  const runIdRef = useRef(0)
  const runRef = useRef<() => void>(() => undefined)

  useEffect(() => {
    pollRef.current = poll
  }, [poll])

  useEffect(() => {
    enabledRef.current = enabled
  }, [enabled])

  useEffect(() => {
    intervalRef.current = intervalMs
  }, [intervalMs])

  const cancel = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }

    const controller = controllerRef.current
    if (!controller) return
    controllerRef.current = null
    runIdRef.current += 1
    controller.abort()
  }, [])

  const schedule = useCallback(() => {
    if (!enabledRef.current || !visibleRef.current || controllerRef.current || timerRef.current !== null) return
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null
      runRef.current()
    }, Math.max(0, intervalRef.current))
  }, [])

  const run = useCallback(() => {
    if (!enabledRef.current || !visibleRef.current || controllerRef.current) return

    const controller = new AbortController()
    const runId = runIdRef.current + 1
    runIdRef.current = runId
    controllerRef.current = controller

    void Promise.resolve()
      .then(() => {
        if (!controller.signal.aborted) return pollRef.current(controller.signal)
      })
      .catch(() => undefined)
      .finally(() => {
        if (controllerRef.current !== controller || runIdRef.current !== runId) return
        controllerRef.current = null
        schedule()
      })
  }, [schedule])

  useEffect(() => {
    runRef.current = run
  }, [run])

  useEffect(() => {
    enabledRef.current = enabled
    intervalRef.current = intervalMs
    if (!enabled) {
      cancel()
      return
    }
    schedule()
  }, [cancel, enabled, intervalMs, schedule])

  useEffect(() => {
    if (typeof document === 'undefined') return

    const onVisibilityChange = () => {
      const visible = !document.hidden
      visibleRef.current = visible
      if (!visible) {
        cancel()
        return
      }
      if (enabledRef.current) {
        if (timerRef.current !== null) {
          window.clearTimeout(timerRef.current)
          timerRef.current = null
        }
        runRef.current()
      }
    }

    document.addEventListener('visibilitychange', onVisibilityChange)
    if (enabledRef.current && visibleRef.current) schedule()

    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange)
      cancel()
    }
  }, [cancel, schedule])
}
