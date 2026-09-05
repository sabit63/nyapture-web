import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { formatPageTitle, useDocumentTitle } from '../../app/page-title'
import { useVisiblePolling } from '../../hooks/use-visible-polling'
import {
  ApiError,
  deleteDownloadItem,
  getDownloadStatuses,
  getDownloadSystemStatus,
  getErrorMessage,
  pauseAllDownloads as pauseAllDownloadsRequest,
  pauseDownloadItem,
  resumeAllDownloads as resumeAllDownloadsRequest,
  resumeDownloadItem,
  startBookDownload,
  updateDownloadPriority,
} from '../../api'
import type { BookDownloadStatus, BookDownloadSystemStatus, NyaApiResponse } from '../../models'
import { bookDownloadHubClient } from '../../realtime/book-download-hub'
import type { BookDownloadHubStatusEventKind } from '../../realtime/book-download-hub'
import {
  applySystemStatus,
  createEmptyDownloadProjection,
  forgetDownloadAttempt,
  getDownloadCounts,
  getDownloadStatusKey,
  projectDownloadSnapshot,
  reduceDownloadStatus,
  type DownloadJob,
  type DownloadProjection,
} from './download-state'
import {
  createDownloadPollingState,
  finishDownloadReconciliation,
  requestDownloadReconciliation,
  setDownloadPollingActive,
  setDownloadPollingVisible,
  startDownloadReconciliation,
  type DownloadPollingState,
} from './download-polling'

export type DownloadNoticeTone = 'success' | 'warning' | 'error'
export type DownloadNotice = (message: string, tone?: DownloadNoticeTone) => void
export type DownloadItemAction = 'pause' | 'resume' | 'retry' | 'priority' | 'delete'

type BufferedRealtimeEvent =
  | { type: 'status'; kind: BookDownloadHubStatusEventKind; status: BookDownloadStatus }
  | { type: 'snapshot'; statuses: Record<string, BookDownloadStatus> }
  | { type: 'system'; status: BookDownloadSystemStatus }

type RealtimeBuffer = {
  generation: number
  events: BufferedRealtimeEvent[]
}

type CommandHandle = {
  generation: number
  controller: AbortController
}

export type DownloadManagerHookOptions = {
  apiRevision: number
  notify: DownloadNotice
  dismiss: () => void
}

export type DownloadManagerHookResult = {
  downloads: DownloadJob[]
  systemStatus: BookDownloadSystemStatus | null
  counts: ReturnType<typeof getDownloadCounts>
  loadError: string
  isInitialLoading: boolean
  isRefreshing: boolean
  pendingActions: ReadonlySet<string>
  refreshDownloads: () => void
  pauseDownload: (id: string) => void
  resumeDownload: (id: string) => void
  retryDownload: (id: string) => void
  changePriority: (id: string) => void
  deleteDownload: (id: string) => void
  pauseAllDownloads: () => void
  resumeAllDownloads: () => void
}

const isAbsoluteStatusMap = (value: unknown): value is Record<string, BookDownloadStatus> => (
  Boolean(value)
  && typeof value === 'object'
  && !Array.isArray(value)
)

const ensureApiSuccess = (response: NyaApiResponse | undefined, fallbackMessage: string) => {
  if (response?.success === false) {
    throw new ApiError(response.message ?? fallbackMessage, { category: 'server' })
  }
}

const isAbort = (error: unknown, signal: AbortSignal) => signal.aborted || (
  error instanceof ApiError && error.message.includes('キャンセル')
)

const applyBufferedEvents = (
  startingProjection: DownloadProjection,
  events: BufferedRealtimeEvent[],
) => {
  let projection = startingProjection
  let needsReconciliation = false
  let systemStatus: BookDownloadSystemStatus | null = null

  for (const event of events) {
    if (event.type === 'status') {
      const result = reduceDownloadStatus(projection, event.status)
      projection = result.projection
      needsReconciliation ||= result.needsReconciliation
    } else if (event.type === 'snapshot') {
      projection = projectDownloadSnapshot(projection, event.statuses)
    } else {
      systemStatus = applySystemStatus(systemStatus, event.status)
    }
  }

  return { projection, systemStatus, needsReconciliation }
}

export function useDownloadManager({
  apiRevision,
  notify,
  dismiss,
}: DownloadManagerHookOptions): DownloadManagerHookResult {
  useDocumentTitle(formatPageTitle('ダウンロード'))

  const generationRef = useRef(0)
  const mountedRef = useRef(false)
  const projectionRef = useRef<DownloadProjection>(createEmptyDownloadProjection())
  const [projection, setProjection] = useState<DownloadProjection>(() => projectionRef.current)
  const [systemStatus, setSystemStatus] = useState<BookDownloadSystemStatus | null>(null)
  const [loadError, setLoadError] = useState('')
  const [isInitialLoading, setIsInitialLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [pendingActions, setPendingActions] = useState<ReadonlySet<string>>(new Set())

  const refreshControllerRef = useRef<AbortController | null>(null)
  const commandControllersRef = useRef(new Set<CommandHandle>())
  const pendingActionsRef = useRef<ReadonlySet<string>>(new Set())
  const realtimeBufferRef = useRef<RealtimeBuffer | null>(null)
  const pendingRealtimeStatusesRef = useRef(new Map<string, BookDownloadStatus>())
  const realtimeFrameRef = useRef<number | null>(null)
  const reconciliationControllerRef = useRef<AbortController | null>(null)
  const reconciliationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pollingStateRef = useRef<DownloadPollingState>(createDownloadPollingState())
  const scheduleImmediateReconciliationRef = useRef<() => void>(() => undefined)

  const isCurrentGeneration = useCallback((generation: number) => (
    mountedRef.current && generation === generationRef.current
  ), [])

  const commitProjection = useCallback((next: DownloadProjection, generation?: number) => {
    if (!mountedRef.current || generation !== undefined && generation !== generationRef.current) return false
    projectionRef.current = next
    setProjection(next)
    return true
  }, [])

  const setPending = useCallback((key: string, pending: boolean, generation: number) => {
    if (!isCurrentGeneration(generation)) return
    const next = new Set(pendingActionsRef.current)
    if (pending) next.add(key)
    else next.delete(key)
    pendingActionsRef.current = next
    setPendingActions(next)
  }, [isCurrentGeneration])

  const clearPendingRealtimeStatuses = useCallback(() => {
    pendingRealtimeStatusesRef.current.clear()
    if (realtimeFrameRef.current !== null) {
      window.cancelAnimationFrame(realtimeFrameRef.current)
      realtimeFrameRef.current = null
    }
  }, [])

  const applyRealtimeStatus = useCallback((
    status: BookDownloadStatus,
    generation = generationRef.current,
  ) => {
    if (!isCurrentGeneration(generation)) return false
    const result = reduceDownloadStatus(projectionRef.current, status)
    if (result.accepted) commitProjection(result.projection, generation)
    if (result.needsReconciliation) {
      pollingStateRef.current = requestDownloadReconciliation(pollingStateRef.current)
      scheduleImmediateReconciliationRef.current()
    }
    return result.accepted
  }, [commitProjection, isCurrentGeneration])

  const flushPendingRealtimeStatuses = useCallback(() => {
    realtimeFrameRef.current = null
    if (!mountedRef.current) return
    const statuses = [...pendingRealtimeStatusesRef.current.values()]
    pendingRealtimeStatusesRef.current.clear()
    let nextProjection = projectionRef.current
    let needsReconciliation = false
    for (const status of statuses) {
      const result = reduceDownloadStatus(nextProjection, status)
      nextProjection = result.projection
      needsReconciliation ||= result.needsReconciliation
    }
    if (nextProjection !== projectionRef.current) commitProjection(nextProjection)
    if (needsReconciliation) {
      pollingStateRef.current = requestDownloadReconciliation(pollingStateRef.current)
      scheduleImmediateReconciliationRef.current()
    }
  }, [commitProjection])

  const queueRealtimeStatus = useCallback((
    _kind: BookDownloadHubStatusEventKind,
    status: BookDownloadStatus,
  ) => {
    if (!mountedRef.current) return
    const activeBuffer = realtimeBufferRef.current
    if (activeBuffer) {
      activeBuffer.events.push({ type: 'status', kind: _kind, status })
      return
    }

    const key = getDownloadStatusKey(status)
    if (!key) return
    const pending = pendingRealtimeStatusesRef.current.get(key)
    if (pending) {
      const pendingResult = reduceDownloadStatus(projectionRef.current, pending)
      const nextResult = reduceDownloadStatus(pendingResult.projection, status)
      if (!nextResult.accepted && nextResult.needsReconciliation) {
        pollingStateRef.current = requestDownloadReconciliation(pollingStateRef.current)
      }
      if (!nextResult.accepted) return
    }

    const isImmediate = status.executionState === 'Completed'
      || status.executionState === 'Failed'
      || status.executionState === 'Cancelled'
      || status.executionState === 'Stopped'
    if (isImmediate) {
      pendingRealtimeStatusesRef.current.delete(key)
      applyRealtimeStatus(status)
      return
    }

    pendingRealtimeStatusesRef.current.set(key, status)
    if (realtimeFrameRef.current === null) {
      realtimeFrameRef.current = window.requestAnimationFrame(flushPendingRealtimeStatuses)
    }
  }, [applyRealtimeStatus, flushPendingRealtimeStatuses])

  const applyRealtimeSnapshot = useCallback((
    statuses: Record<string, BookDownloadStatus>,
  ) => {
    if (!mountedRef.current || !isAbsoluteStatusMap(statuses)) return
    const activeBuffer = realtimeBufferRef.current
    if (activeBuffer) {
      activeBuffer.events.push({ type: 'snapshot', statuses })
      return
    }
    clearPendingRealtimeStatuses()
    commitProjection(projectDownloadSnapshot(projectionRef.current, statuses))
  }, [clearPendingRealtimeStatuses, commitProjection])

  const applyRealtimeSystemStatus = useCallback((status: BookDownloadSystemStatus) => {
    if (!mountedRef.current) return
    const activeBuffer = realtimeBufferRef.current
    if (activeBuffer) {
      activeBuffer.events.push({ type: 'system', status })
      return
    }
    setSystemStatus((current) => applySystemStatus(current, status))
  }, [])

  const beginRestBuffer = useCallback((generation: number) => {
    const buffer: RealtimeBuffer = {
      generation,
      events: realtimeBufferRef.current?.generation === generation
        ? realtimeBufferRef.current.events.slice()
        : [],
    }
    realtimeBufferRef.current = buffer
    return buffer
  }, [])

  const finishRestBuffer = useCallback((
    buffer: RealtimeBuffer,
    projection: DownloadProjection,
    system: BookDownloadSystemStatus | null,
  ) => {
    if (realtimeBufferRef.current !== buffer) return { projection, system, needsReconciliation: false }
    realtimeBufferRef.current = null
    const buffered = applyBufferedEvents(projection, buffer.events)
    return {
      projection: buffered.projection,
      system: system ? applySystemStatus(system, buffered.systemStatus ?? system) : buffered.systemStatus,
      needsReconciliation: buffered.needsReconciliation,
    }
  }, [])

  const drainRestBuffer = useCallback((buffer: RealtimeBuffer, generation: number) => {
    if (realtimeBufferRef.current !== buffer || !isCurrentGeneration(generation)) return false
    const buffered = finishRestBuffer(buffer, projectionRef.current, null)
    if (buffered.projection !== projectionRef.current) commitProjection(buffered.projection, generation)
    if (buffered.system) {
      setSystemStatus((current) => applySystemStatus(current, buffered.system as BookDownloadSystemStatus))
    }
    return buffered.needsReconciliation
  }, [commitProjection, finishRestBuffer, isCurrentGeneration])

  const loadSnapshot = useCallback(async ({
    generation = generationRef.current,
    notifyRefreshError = false,
    initial = false,
  }: {
    generation?: number
    notifyRefreshError?: boolean
    initial?: boolean
  } = {}) => {
    if (!isCurrentGeneration(generation)) return false
    refreshControllerRef.current?.abort()
    reconciliationControllerRef.current?.abort()
    pollingStateRef.current = finishDownloadReconciliation(pollingStateRef.current)
    const controller = new AbortController()
    refreshControllerRef.current = controller
    const buffer = beginRestBuffer(generation)
    let needsReconciliationAfter = false
    setIsRefreshing(true)
    setIsInitialLoading(initial)
    try {
      const [statuses, nextSystemStatus] = await Promise.all([
        getDownloadStatuses(controller.signal),
        getDownloadSystemStatus(controller.signal),
      ])
      if (!isCurrentGeneration(generation) || controller.signal.aborted) return false
      if (!isAbsoluteStatusMap(statuses)) {
        throw new ApiError('ダウンロード状況の形式が不正です。', { category: 'server' })
      }

      let nextProjection = projectDownloadSnapshot(
        createEmptyDownloadProjection(),
        statuses,
        { authoritative: true },
      )
      const nextSystem = nextSystemStatus && typeof nextSystemStatus === 'object' && !Array.isArray(nextSystemStatus)
        ? nextSystemStatus
        : null
      const buffered = finishRestBuffer(buffer, nextProjection, nextSystem)
      nextProjection = buffered.projection
      if (!commitProjection(nextProjection, generation)) return false
      setSystemStatus(buffered.system)
      setLoadError('')
      if (buffered.needsReconciliation) {
        pollingStateRef.current = requestDownloadReconciliation(pollingStateRef.current)
        needsReconciliationAfter = true
      } else {
        pollingStateRef.current = { ...pollingStateRef.current, requested: false }
      }
      return true
    } catch (error: unknown) {
      if (!isCurrentGeneration(generation) || controller.signal.aborted) return false
      const message = getErrorMessage(error)
      setLoadError(message)
      if (realtimeBufferRef.current === buffer) {
        needsReconciliationAfter = drainRestBuffer(buffer, generation)
        if (needsReconciliationAfter) {
          pollingStateRef.current = requestDownloadReconciliation(pollingStateRef.current)
        }
      }
      if (notifyRefreshError) notify(`ダウンロード一覧を更新できませんでした: ${message}`, 'error')
      return false
    } finally {
      if (refreshControllerRef.current === controller) {
        refreshControllerRef.current = null
        setIsRefreshing(false)
        setIsInitialLoading(false)
        if (needsReconciliationAfter && isCurrentGeneration(generation)) {
          scheduleImmediateReconciliationRef.current()
        }
      }
    }
  }, [beginRestBuffer, commitProjection, drainRestBuffer, finishRestBuffer, isCurrentGeneration, notify])

  const reconcileStatuses = useCallback(async (signal: AbortSignal) => {
    const generation = generationRef.current
    if (signal.aborted || !isCurrentGeneration(generation)) return
    const visible = typeof document === 'undefined' || !document.hidden
    pollingStateRef.current = setDownloadPollingVisible(pollingStateRef.current, visible)
    const started = startDownloadReconciliation(pollingStateRef.current)
    if (!started.started || refreshControllerRef.current) {
      if (reconciliationControllerRef.current?.signal === signal) reconciliationControllerRef.current = null
      return
    }
    pollingStateRef.current = started.state
    const controller = new AbortController()
    const abortFromPoll = () => controller.abort()
    signal.addEventListener('abort', abortFromPoll, { once: true })
    reconciliationControllerRef.current = controller
    const buffer = beginRestBuffer(generation)
    let needsReconciliationAfter = false
    try {
      const statuses = await getDownloadStatuses(controller.signal)
      if (!isCurrentGeneration(generation) || controller.signal.aborted || !isAbsoluteStatusMap(statuses)) return
      let nextProjection = projectDownloadSnapshot(
        createEmptyDownloadProjection(),
        statuses,
        { authoritative: true },
      )
      const buffered = finishRestBuffer(buffer, nextProjection, null)
      nextProjection = buffered.projection
      commitProjection(nextProjection, generation)
      needsReconciliationAfter = buffered.needsReconciliation
    } catch {
      // The finally block drains any hub events received while this request
      // was in flight, including events received before an abort or bad REST
      // response was observed.
    } finally {
      if (realtimeBufferRef.current === buffer) {
        needsReconciliationAfter ||= drainRestBuffer(buffer, generation)
      }
      signal.removeEventListener('abort', abortFromPoll)
      if (reconciliationControllerRef.current === controller) {
        reconciliationControllerRef.current = null
        if (isCurrentGeneration(generation)) {
          pollingStateRef.current = finishDownloadReconciliation(pollingStateRef.current)
          if (needsReconciliationAfter) {
            pollingStateRef.current = requestDownloadReconciliation(pollingStateRef.current)
          }
          if (pollingStateRef.current.requested) scheduleImmediateReconciliationRef.current()
        }
      }
    }
  }, [beginRestBuffer, commitProjection, drainRestBuffer, finishRestBuffer, isCurrentGeneration])

  const scheduleImmediateReconciliation = useCallback(() => {
    pollingStateRef.current = requestDownloadReconciliation(pollingStateRef.current)
    if (typeof document !== 'undefined' && document.hidden) return
    if (refreshControllerRef.current || reconciliationTimerRef.current !== null || reconciliationControllerRef.current !== null) return
    reconciliationTimerRef.current = window.setTimeout(() => {
      reconciliationTimerRef.current = null
      if (refreshControllerRef.current || typeof document !== 'undefined' && document.hidden) return
      const controller = new AbortController()
      reconciliationControllerRef.current = controller
      void reconcileStatuses(controller.signal)
    }, 0)
  }, [reconcileStatuses])

  useEffect(() => {
    scheduleImmediateReconciliationRef.current = scheduleImmediateReconciliation
  }, [scheduleImmediateReconciliation])

  useEffect(() => {
    pollingStateRef.current = setDownloadPollingActive(
      pollingStateRef.current,
      projection.downloads.some((download) => download.status === 'running' || download.status === 'queued'),
    )
  }, [projection.downloads])

  useVisiblePolling({
    intervalMs: 2_000,
    enabled: projection.downloads.some((download) => download.status === 'running' || download.status === 'queued'),
    poll: reconcileStatuses,
  })

  useEffect(() => {
    if (typeof document === 'undefined') return
    const onVisibilityChange = () => {
      const visible = !document.hidden
      pollingStateRef.current = setDownloadPollingVisible(pollingStateRef.current, visible)
      if (!visible) {
        if (reconciliationTimerRef.current !== null) {
          window.clearTimeout(reconciliationTimerRef.current)
          reconciliationTimerRef.current = null
        }
        reconciliationControllerRef.current?.abort()
        return
      }
      if (pollingStateRef.current.requested) scheduleImmediateReconciliation()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => document.removeEventListener('visibilitychange', onVisibilityChange)
  }, [scheduleImmediateReconciliation])

  useEffect(() => {
    const generation = generationRef.current + 1
    generationRef.current = generation
    mountedRef.current = true
    projectionRef.current = createEmptyDownloadProjection()
    setProjection(projectionRef.current)
    setSystemStatus(null)
    setLoadError('')
    setIsInitialLoading(true)
    setIsRefreshing(false)
    pendingActionsRef.current = new Set()
    setPendingActions(pendingActionsRef.current)
    clearPendingRealtimeStatuses()
    pollingStateRef.current = createDownloadPollingState()
    dismiss()

    const applyStatusCollection = (statuses: BookDownloadStatus[]) => {
      if (!Array.isArray(statuses)) return
      statuses.forEach((status) => queueRealtimeStatus('statusUpdate', status))
    }
    const unsubscribe = bookDownloadHubClient.subscribe({
      onStatus: queueRealtimeStatus,
      onRunningDownloads: applyStatusCollection,
      onQueuedDownloads: applyStatusCollection,
      onAllDownloadStatuses: applyRealtimeSnapshot,
      onSystemStatus: applyRealtimeSystemStatus,
      onBookDownloadStatus: (status) => queueRealtimeStatus('statusUpdate', status),
      onResyncRequested: () => {
        if (mountedRef.current) void loadSnapshot({ generation })
      },
    })

    void loadSnapshot({ generation, initial: true })
    const refreshController = refreshControllerRef.current
    const reconciliationController = reconciliationControllerRef.current
    const commandControllers = commandControllersRef.current
    return () => {
      mountedRef.current = false
      unsubscribe()
      refreshController?.abort()
      reconciliationController?.abort()
      if (reconciliationTimerRef.current !== null) {
        window.clearTimeout(reconciliationTimerRef.current)
        reconciliationTimerRef.current = null
      }
      commandControllers.forEach(({ controller }) => controller.abort())
      commandControllers.clear()
      pendingActionsRef.current = new Set()
      realtimeBufferRef.current = null
      clearPendingRealtimeStatuses()
      pollingStateRef.current = createDownloadPollingState()
    }
  }, [apiRevision, applyRealtimeSnapshot, applyRealtimeSystemStatus, clearPendingRealtimeStatuses, dismiss, loadSnapshot, queueRealtimeStatus])

  const runItemAction = useCallback(async (id: string, action: DownloadItemAction) => {
    const generation = generationRef.current
    const job = projectionRef.current.downloads.find((download) => download.id === id)
    if (!job || !isCurrentGeneration(generation) || pendingActionsRef.current.has(id)) return
    if (action === 'delete' && !window.confirm(`「${job.title}」をダウンロード一覧から削除しますか？`)) return
    if (action === 'priority' && job.status !== 'queued') return
    const requiresBookUrl = action === 'pause'
      || action === 'resume'
      || action === 'retry'
      || action === 'priority'
      || action === 'delete'
    if (requiresBookUrl && !job.url) {
      notify(`${job.title}を操作できませんでした: Book URLがありません。`, 'error')
      return
    }

    const handle: CommandHandle = { generation, controller: new AbortController() }
    commandControllersRef.current.add(handle)
    setPending(id, true, generation)
    try {
      if (action === 'pause') {
        const response = await pauseDownloadItem(job.url as string, handle.controller.signal)
        ensureApiSuccess(response, 'ダウンロードを一時停止できませんでした。')
      } else if (action === 'resume') {
        const response = await resumeDownloadItem(job.url as string, handle.controller.signal)
        ensureApiSuccess(response, 'ダウンロードを再開できませんでした。')
      } else if (action === 'retry') {
        const response = await startBookDownload({ url: job.url as string, priority: job.priority }, handle.controller.signal)
        ensureApiSuccess(response, 'ダウンロードを再試行できませんでした。')
      } else if (action === 'priority') {
        const nextPriority = (job.priority + 1) % 3
        const response = await updateDownloadPriority({ url: job.url as string, priority: nextPriority }, handle.controller.signal)
        ensureApiSuccess(response, 'ダウンロードの優先度を変更できませんでした。')
      } else {
        const response = await deleteDownloadItem(job.url as string, handle.controller.signal)
        ensureApiSuccess(response, 'ダウンロードを削除できませんでした。')
      }

      if (!isCurrentGeneration(generation) || handle.controller.signal.aborted) return
      if (action === 'retry' || action === 'delete') {
        commitProjection(forgetDownloadAttempt(projectionRef.current, job.id), generation)
        pendingRealtimeStatusesRef.current.delete(job.id)
      }
      const refreshed = await loadSnapshot({ generation })
      if (!isCurrentGeneration(generation) || handle.controller.signal.aborted) return
      const successMessage = action === 'pause'
        ? `${job.title}を一時停止しました`
        : action === 'resume'
          ? `${job.title}を再開しました`
          : action === 'retry'
            ? `${job.title}のダウンロードを再試行します`
            : action === 'priority'
              ? `${job.title}の優先度を変更しました`
              : `${job.title}をリストから削除しました`
      notify(refreshed ? successMessage : `${successMessage}（一覧の更新に失敗しました）`, refreshed ? 'success' : 'warning')
    } catch (error: unknown) {
      if (isCurrentGeneration(generation) && !isAbort(error, handle.controller.signal)) {
        notify(`${job.title}を操作できませんでした: ${getErrorMessage(error)}`, 'error')
      }
    } finally {
      commandControllersRef.current.delete(handle)
      setPending(id, false, generation)
    }
  }, [commitProjection, isCurrentGeneration, loadSnapshot, notify, setPending])

  const runGlobalAction = useCallback(async (action: 'pause' | 'resume') => {
    const generation = generationRef.current
    const pendingKey = `global-${action}`
    if (!isCurrentGeneration(generation) || pendingActionsRef.current.has(pendingKey)) return
    const handle: CommandHandle = { generation, controller: new AbortController() }
    commandControllersRef.current.add(handle)
    setPending(pendingKey, true, generation)
    try {
      const response = action === 'pause'
        ? await pauseAllDownloadsRequest(handle.controller.signal)
        : await resumeAllDownloadsRequest(handle.controller.signal)
      ensureApiSuccess(response, action === 'pause' ? 'ダウンロードを一時停止できませんでした。' : 'ダウンロードを再開できませんでした。')
      if (!isCurrentGeneration(generation) || handle.controller.signal.aborted) return
      const refreshed = await loadSnapshot({ generation })
      if (!isCurrentGeneration(generation) || handle.controller.signal.aborted) return
      const successMessage = action === 'pause'
        ? '実行中と待機中のダウンロードをすべて一時停止しました'
        : '一時停止中のダウンロードをすべて再開しました'
      notify(refreshed ? successMessage : `${successMessage}（一覧の更新に失敗しました）`, refreshed ? 'success' : 'warning')
    } catch (error: unknown) {
      if (isCurrentGeneration(generation) && !isAbort(error, handle.controller.signal)) {
        notify(`${action === 'pause' ? '一括一時停止' : '一括再開'}に失敗しました: ${getErrorMessage(error)}`, 'error')
      }
    } finally {
      commandControllersRef.current.delete(handle)
      setPending(pendingKey, false, generation)
    }
  }, [isCurrentGeneration, loadSnapshot, notify, setPending])

  const counts = useMemo(() => getDownloadCounts(projection.downloads), [projection.downloads])

  return {
    downloads: projection.downloads,
    systemStatus,
    counts,
    loadError,
    isInitialLoading,
    isRefreshing,
    pendingActions,
    refreshDownloads: () => { void loadSnapshot({ notifyRefreshError: true }) },
    pauseDownload: (id) => { void runItemAction(id, 'pause') },
    resumeDownload: (id) => { void runItemAction(id, 'resume') },
    retryDownload: (id) => { void runItemAction(id, 'retry') },
    changePriority: (id) => { void runItemAction(id, 'priority') },
    deleteDownload: (id) => { void runItemAction(id, 'delete') },
    pauseAllDownloads: () => { void runGlobalAction('pause') },
    resumeAllDownloads: () => { void runGlobalAction('resume') },
  }
}
