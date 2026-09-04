import {
  ArrowDownUp,
  Ban,
  Clock3,
  CloudDownload,
  CircleCheck,
  CircleHelp,
  CircleStop,
  Gauge,
  LibraryBig,
  Pause,
  PauseCircle,
  Play,
  RefreshCw,
  Search,
  Trash2,
  TriangleAlert,
  X,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { formatPageTitle, useDocumentTitle } from '../app/page-title'
import {
  ApiError,
  deleteDownloadItem,
  getDownloadStatuses,
  getDownloadSystemStatus,
  getErrorMessage,
  pauseAllDownloads as pauseAllDownloadsRequest,
  pauseDownloadItem,
  requestBlob,
  resumeAllDownloads as resumeAllDownloadsRequest,
  resumeDownloadItem,
  startBookDownload,
  updateDownloadPriority,
} from '../api'
import type { BookDownloadStatus, BookDownloadSystemStatus, NyaApiResponse } from '../models'
import { bookDownloadHubClient } from '../realtime/book-download-hub'
import type {
  BookDownloadHubConnectionState,
  BookDownloadHubStatusEventKind,
} from '../realtime/book-download-hub'
import { Snackbar, useSnackbar } from './Snackbar'
import { Thumbnail } from './Thumbnail'
import { Button, IconButton, StatePanel } from './ui'
import './download-manager.css'

type DownloadStatus = 'running' | 'queued' | 'paused' | 'failed' | 'stopped' | 'cancelled' | 'completed' | 'unknown'
type DownloadSort = 'priority' | 'progress' | 'added' | 'title'
type ItemAction = 'pause' | 'resume' | 'retry' | 'priority' | 'delete'

type DownloadJob = {
  id: string
  groupId?: string
  bookId?: string
  url?: string
  title: string
  artist?: string
  thumbnailUrl?: string
  cover: string
  status: DownloadStatus
  progress: number
  completedPages: number
  totalPages: number
  failedPages: number
  priority: number
  speed?: number
  queuePosition?: number
  errorMessage?: string
  addedAt: string
  lastUpdated?: string
}

type BufferedRealtimeEvent =
  | { type: 'status'; kind: BookDownloadHubStatusEventKind; status: BookDownloadStatus }
  | { type: 'snapshot'; statuses: Record<string, BookDownloadStatus> }
  | { type: 'system'; status: BookDownloadSystemStatus }

type RealtimeBuffer = {
  events: BufferedRealtimeEvent[]
}

type StatusPresentation = {
  label: string
  icon: LucideIcon
}

const STATUS_PRESENTATIONS: Record<DownloadStatus, StatusPresentation> = {
  running: { label: '実行中', icon: Play },
  queued: { label: '待機中', icon: Clock3 },
  paused: { label: '一時停止', icon: PauseCircle },
  failed: { label: '失敗', icon: TriangleAlert },
  stopped: { label: '停止', icon: CircleStop },
  cancelled: { label: 'キャンセル', icon: Ban },
  completed: { label: '完了', icon: CircleCheck },
  unknown: { label: '状態不明', icon: CircleHelp },
}

const HUB_CONNECTION_LABELS: Record<BookDownloadHubConnectionState, string> = {
  idle: 'リアルタイム未接続',
  connecting: 'リアルタイム接続中',
  connected: 'リアルタイム接続済み',
  reconnecting: 'リアルタイム再接続中',
  disconnected: 'リアルタイム切断・表示更新停止',
  error: 'リアルタイム接続エラー・表示更新停止',
}

const PRIORITY_LABELS = ['最優先', '高', '通常']
const COVER_VARIANTS = ['violet', 'blue', 'amber', 'rose'] as const

const asNonEmptyString = (value: unknown): string | undefined => (
  typeof value === 'string' && value.trim() ? value.trim() : undefined
)

const asNonNegativeInteger = (value: unknown, fallback = 0): number => (
  typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : fallback
)

const asNonNegativeNumber = (value: unknown): number | undefined => (
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
)

const firstString = (...values: unknown[]) => (
  values.map(asNonEmptyString).find((value): value is string => Boolean(value))
)

const getCoverVariant = (key: string) => {
  let hash = 0
  for (const character of key) hash = (hash * 31 + character.charCodeAt(0)) | 0
  return COVER_VARIANTS[Math.abs(hash) % COVER_VARIANTS.length]
}

const mapExecutionState = (state: BookDownloadStatus['executionState']): DownloadStatus | null => {
  switch (state) {
    case 'Queued': return 'queued'
    case 'Running': return 'running'
    case 'Paused': return 'paused'
    case 'Failed': return 'failed'
    case 'Stopped': return 'stopped'
    case 'Cancelled': return 'cancelled'
    case 'Completed': return 'completed'
    default: return 'unknown'
  }
}

const isValidBookIdentifier = (value: string) => (
  value !== '.'
  && value !== '..'
  && !value.includes('/')
  && !value.includes('\\')
  && ![...value].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
)

const isAbsoluteUrl = (value: string | undefined) => {
  if (!value) return false
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

const getDownloadStatusKey = (status: BookDownloadStatus, legacyKey?: string): string | null => {
  const groupId = asNonEmptyString(status.book?.groupId)
  const bookId = asNonEmptyString(status.book?.bookId)

  if (groupId && bookId && isValidBookIdentifier(groupId) && isValidBookIdentifier(bookId)) {
    return `${groupId}/${bookId}`
  }

  const url = asNonEmptyString(status.book?.url)
  if (url) return `url:${url}`

  const legacyUrl = asNonEmptyString(legacyKey)
  return isAbsoluteUrl(legacyUrl) ? `url:${legacyUrl}` : null
}

const timestampValue = (value: string | undefined) => {
  if (!value) return undefined
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? timestamp : undefined
}

type StatusFreshness = {
  lastUpdated?: string
  completedPages?: number
  currentPage?: number
  failedPages?: number
  executionState?: string
  downloadSpeed?: number
  priority?: number
  queuePosition?: number
  errorMessage?: string
}

const pageCountValue = (status: StatusFreshness) => Math.max(
  asNonNegativeInteger(status.completedPages),
  asNonNegativeInteger(status.currentPage),
)

const hasMeaningfulStatusChange = (current: StatusFreshness, next: StatusFreshness) => (
  next.executionState !== current.executionState
  || pageCountValue(next) > pageCountValue(current)
  || asNonNegativeInteger(next.failedPages) > asNonNegativeInteger(current.failedPages)
  || next.downloadSpeed !== undefined && next.downloadSpeed !== current.downloadSpeed
  || next.priority !== undefined && next.priority !== current.priority
  || next.queuePosition !== undefined && next.queuePosition !== current.queuePosition
  || next.errorMessage !== undefined && next.errorMessage !== current.errorMessage
)

const normalizeExecutionState = (state: string | undefined) => state?.toLocaleLowerCase('en-US')

const isNewDownloadAttempt = (currentState: string | undefined, nextState: string | undefined) => {
  const current = normalizeExecutionState(currentState)
  const next = normalizeExecutionState(nextState)
  const wasTerminal = current === 'failed'
    || current === 'cancelled'
    || current === 'stopped'
    || current === 'completed'
  const isActive = next === 'queued' || next === 'running'
  return wasTerminal && isActive
}

const shouldAcceptFreshness = (current: StatusFreshness | undefined, next: StatusFreshness) => {
  if (!current) return true
  const currentTimestamp = timestampValue(current.lastUpdated)
  const nextTimestamp = timestampValue(next.lastUpdated)
  const currentPages = pageCountValue(current)
  const nextPages = pageCountValue(next)

  if (nextPages < currentPages && !isNewDownloadAttempt(current.executionState, next.executionState)) return false
  if (nextPages > currentPages) return true

  if (currentTimestamp !== undefined && nextTimestamp !== undefined) {
    if (nextTimestamp > currentTimestamp) return true
    if (nextTimestamp < currentTimestamp) return false
    return hasMeaningfulStatusChange(current, next)
  }

  // When a producer omits LastUpdated, retain monotonic page progress while
  // otherwise honoring arrival order for status changes.
  if (nextPages < currentPages) return false
  return true
}

const shouldAcceptStatus = (current: BookDownloadStatus | undefined, next: BookDownloadStatus) => (
  shouldAcceptFreshness(current, next)
)

const shouldAcceptOrderedStatus = (current: BookDownloadStatus | undefined, next: BookDownloadStatus) => {
  if (!current) return true
  const currentPages = pageCountValue(current)
  const nextPages = pageCountValue(next)
  if (nextPages < currentPages && !isNewDownloadAttempt(current.executionState, next.executionState)) return false
  return hasMeaningfulStatusChange(current, next)
}

const shouldReplaceDownload = (current: DownloadJob, status: BookDownloadStatus) => (
  shouldAcceptFreshness({
    lastUpdated: current.lastUpdated,
    completedPages: current.completedPages,
    failedPages: current.failedPages,
    executionState: current.status,
    downloadSpeed: current.speed,
    priority: current.priority,
    queuePosition: current.queuePosition,
    errorMessage: current.errorMessage,
  }, {
    lastUpdated: status.lastUpdated,
    completedPages: status.completedPages,
    currentPage: status.currentPage,
    failedPages: status.failedPages,
    executionState: mapExecutionState(status.executionState) ?? 'unknown',
    downloadSpeed: status.downloadSpeed,
    priority: status.priority,
    queuePosition: status.queuePosition,
    errorMessage: status.errorMessage,
  }))

const mapDownloadStatus = (status: BookDownloadStatus, legacyKey?: string): DownloadJob | null => {
  const key = getDownloadStatusKey(status, legacyKey)
  if (!key) return null

  const mappedStatus = mapExecutionState(status.executionState)
  if (!mappedStatus) return null

  const book = status.book
  const title = firstString(book?.title, book?.captions?.Title, key) ?? 'タイトル不明'
  const artistTags = Array.isArray(book?.tagSet?.Artists)
    ? book.tagSet.Artists.map(asNonEmptyString).filter((value): value is string => Boolean(value))
    : []
  const artist = artistTags.length > 0
    ? artistTags.join('、')
    : firstString(book?.captions?.Artists)
  const totalPages = asNonNegativeInteger(book?.totalPage)
  const completedPages = Math.min(
    totalPages || Number.MAX_SAFE_INTEGER,
    Math.max(
      asNonNegativeInteger(status.completedPages),
      asNonNegativeInteger(status.currentPage),
    ),
  )
  const failedPages = asNonNegativeInteger(status.failedPages)
  const progress = totalPages > 0
    ? Math.min(100, Math.max(0, Math.round((completedPages / totalPages) * 100)))
    : 0
  const priority = asNonNegativeInteger(status.priority, PRIORITY_LABELS.length - 1)
  const queuePosition = typeof status.queuePosition === 'number'
    ? asNonNegativeInteger(status.queuePosition)
    : undefined

  return {
    id: key,
    groupId: asNonEmptyString(book?.groupId),
    bookId: asNonEmptyString(book?.bookId),
    url: asNonEmptyString(book?.url),
    title,
    artist,
    thumbnailUrl: asNonEmptyString(status.thumbnailUrl),
    cover: getCoverVariant(key),
    status: mappedStatus,
    progress,
    completedPages,
    totalPages,
    failedPages,
    priority,
    speed: asNonNegativeNumber(status.downloadSpeed),
    queuePosition,
    errorMessage: asNonEmptyString(status.errorMessage),
    addedAt: firstString(status.queuedAt, status.startedAt, status.lastUpdated, book?.uploadedTime) ?? '',
    lastUpdated: asNonEmptyString(status.lastUpdated),
  }
}

type MappedDownloadStatus = {
  status: BookDownloadStatus
  job: DownloadJob
}

const mapDownloadStatusEntries = (statuses: Record<string, BookDownloadStatus>) => {
  const mapped = new Map<string, MappedDownloadStatus>()
  Object.entries(statuses).forEach(([legacyKey, status]) => {
    if (!status || typeof status !== 'object') return
    const job = mapDownloadStatus(status, legacyKey)
    if (!job) return
    const current = mapped.get(job.id)
    if (!current || shouldReplaceDownload(current.job, status)) {
      mapped.set(job.id, { status, job })
    }
  })
  return mapped
}

const mapDownloadStatuses = (statuses: Record<string, BookDownloadStatus>): DownloadJob[] => (
  [...mapDownloadStatusEntries(statuses).values()]
    .filter(({ status }) => status.executionState !== 'Completed')
    .map(({ job }) => job)
)

const applyDownloadStatus = (
  downloads: DownloadJob[],
  status: BookDownloadStatus,
  orderedEvent = false,
): DownloadJob[] => {
  const key = getDownloadStatusKey(status)
  if (!key) return downloads
  if (status.executionState === 'Completed') {
    return downloads.filter((download) => download.id !== key)
  }
  const mapped = mapDownloadStatus(status)
  if (!mapped) return downloads

  const currentIndex = downloads.findIndex((download) => download.id === key)
  if (currentIndex < 0) return [...downloads, mapped]
  if (!orderedEvent && !shouldReplaceDownload(downloads[currentIndex], status)) return downloads
  if (
    orderedEvent
    && pageCountValue({ completedPages: mapped.completedPages }) < downloads[currentIndex].completedPages
    && !isNewDownloadAttempt(downloads[currentIndex].status, mapped.status)
  ) return downloads

  const next = [...downloads]
  next[currentIndex] = mapped
  return next
}

const applySystemStatus = (
  current: BookDownloadSystemStatus | null,
  next: BookDownloadSystemStatus,
) => {
  if (!current) return next
  const currentTimestamp = timestampValue(current.lastUpdated)
  const nextTimestamp = timestampValue(next.lastUpdated)
  if (currentTimestamp !== undefined && nextTimestamp !== undefined && nextTimestamp <= currentTimestamp) return current
  return next
}

const ensureApiSuccess = (response: NyaApiResponse | undefined, fallbackMessage: string) => {
  if (response?.success === false) {
    throw new ApiError(response.message ?? fallbackMessage, { category: 'server' })
  }
}

function getPriorityLabel(priority: number) {
  return PRIORITY_LABELS[priority] ?? '通常'
}

function getCounts(downloads: DownloadJob[]) {
  return {
    running: downloads.filter((download) => download.status === 'running').length,
    queued: downloads.filter((download) => download.status === 'queued').length,
    paused: downloads.filter((download) => download.status === 'paused').length,
  }
}

export interface DownloadManagerProps {
  /** Changes whenever the active API client settings are replaced. */
  apiRevision: number
  hubConnectionState: BookDownloadHubConnectionState
}

export function DownloadManager({ apiRevision, hubConnectionState }: DownloadManagerProps) {
  useDocumentTitle(formatPageTitle('ダウンロード管理'))
  const [downloads, setDownloads] = useState<DownloadJob[]>([])
  const [systemStatus, setSystemStatus] = useState<BookDownloadSystemStatus | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [sort, setSort] = useState<DownloadSort>('priority')
  const { notice, notify, dismiss } = useSnackbar()
  const [loadError, setLoadError] = useState('')
  const [isInitialLoading, setIsInitialLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [pendingActions, setPendingActions] = useState<Set<string>>(new Set())
  const mountedRef = useRef(false)
  const refreshControllerRef = useRef<AbortController | null>(null)
  const commandControllersRef = useRef(new Set<AbortController>())
  const pendingActionsRef = useRef(new Set<string>())
  const realtimeBufferRef = useRef<RealtimeBuffer | null>(null)
  const pendingRealtimeStatusesRef = useRef(new Map<string, BookDownloadStatus>())
  const latestRealtimeStatusesRef = useRef(new Map<string, BookDownloadStatus>())
  const terminalDownloadsRef = useRef(new Map<string, DownloadJob>())
  const realtimeFrameRef = useRef<number | null>(null)
  const reconciliationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const reconciliationControllerRef = useRef<AbortController | null>(null)
  const reconciliationInFlightRef = useRef(false)

  const counts = useMemo(() => getCounts(downloads), [downloads])

  const filteredDownloads = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLocaleLowerCase('ja-JP')
    const matches = downloads.filter((download) => (
      !normalizedQuery
      || download.title.toLocaleLowerCase('ja-JP').includes(normalizedQuery)
      || download.artist?.toLocaleLowerCase('ja-JP').includes(normalizedQuery) === true
    ))

    return [...matches].sort((first, second) => {
      if (sort === 'progress') return second.progress - first.progress
      if (sort === 'added') return second.addedAt.localeCompare(first.addedAt)
      if (sort === 'title') return first.title.localeCompare(second.title, 'ja')
      return first.priority - second.priority || second.addedAt.localeCompare(first.addedAt)
    })
  }, [downloads, searchQuery, sort])

  const hasSearchQuery = searchQuery.trim().length > 0
  const runningCount = counts.running
  const queuedCount = counts.queued
  const pausedCount = counts.paused
  const activeDownloads = runningCount + queuedCount
  const systemActivityLabel = systemStatus === null
    ? 'システム状態未取得'
    : systemStatus.isSystemRunning
      ? 'システム処理中'
      : 'システム待機中'

  const setPending = (key: string, pending: boolean) => {
    if (pending) pendingActionsRef.current.add(key)
    else pendingActionsRef.current.delete(key)
    setPendingActions(new Set(pendingActionsRef.current))
  }

  const isPending = (key: string) => pendingActions.has(key)

  const applyAcceptedRealtimeStatus = useCallback((
    downloads: DownloadJob[],
    status: BookDownloadStatus,
    legacyKey?: string,
  ): DownloadJob[] => {
    const key = getDownloadStatusKey(status, legacyKey)
    if (!key) return downloads

    const previous = latestRealtimeStatusesRef.current.get(key)
    if (status.executionState !== 'Completed' && !shouldAcceptOrderedStatus(previous, status)) return downloads
    latestRealtimeStatusesRef.current.set(key, status)

    if (status.executionState === 'Completed') {
      terminalDownloadsRef.current.delete(key)
      pendingRealtimeStatusesRef.current.delete(key)
      return downloads.filter((download) => download.id !== key)
    }

    const mapped = mapDownloadStatus(status, legacyKey)
    if (!mapped) return downloads
    if (status.executionState === 'Failed' || status.executionState === 'Cancelled') {
      terminalDownloadsRef.current.set(key, mapped)
    } else {
      terminalDownloadsRef.current.delete(key)
    }
    return applyDownloadStatus(downloads, status, true)
  }, [])

  const replaceDownloadSnapshot = useCallback((statuses: Record<string, BookDownloadStatus>): DownloadJob[] => {
    const mappedDownloads = mapDownloadStatuses(statuses)
    const nextDownloads = new Map(mappedDownloads.map((job) => [job.id, job]))
    const entries = mapDownloadStatusEntries(statuses)
    const snapshotKeys = new Set(entries.keys())

    entries.forEach(({ status, job }, key) => {
      const previous = latestRealtimeStatusesRef.current.get(key)
      const selectedStatus = shouldAcceptStatus(previous, status) ? status : previous
      if (!selectedStatus) return
      latestRealtimeStatusesRef.current.set(key, selectedStatus)

      if (selectedStatus.executionState === 'Completed') {
        terminalDownloadsRef.current.delete(key)
        nextDownloads.delete(key)
        return
      }

      const selectedJob = selectedStatus === status ? job : mapDownloadStatus(selectedStatus)
      if (!selectedJob) {
        nextDownloads.delete(key)
        return
      }
      if (selectedStatus.executionState === 'Failed' || selectedStatus.executionState === 'Cancelled') {
        terminalDownloadsRef.current.set(key, selectedJob)
      } else {
        terminalDownloadsRef.current.delete(key)
      }
      nextDownloads.set(key, selectedJob)
    })

    for (const [key, job] of terminalDownloadsRef.current) {
      if (!snapshotKeys.has(key) && !nextDownloads.has(key)) nextDownloads.set(key, job)
    }

    return [...nextDownloads.values()]
  }, [])

  const clearPendingRealtimeStatuses = useCallback(() => {
    pendingRealtimeStatusesRef.current.clear()
    if (realtimeFrameRef.current !== null) {
      window.cancelAnimationFrame(realtimeFrameRef.current)
      realtimeFrameRef.current = null
    }
  }, [])

  const flushPendingRealtimeStatuses = useCallback(() => {
    realtimeFrameRef.current = null
    const statuses = [...pendingRealtimeStatusesRef.current.values()]
    pendingRealtimeStatusesRef.current.clear()
    if (statuses.length === 0 || !mountedRef.current) return
    setDownloads((current) => statuses.reduce(
      (next, status) => applyAcceptedRealtimeStatus(next, status),
      current,
    ))
  }, [applyAcceptedRealtimeStatus])

  const queueRealtimeStatus = useCallback((
    kind: BookDownloadHubStatusEventKind,
    status: BookDownloadStatus,
  ) => {
    if (!mountedRef.current) return
    const activeBuffer = realtimeBufferRef.current
    if (activeBuffer) {
      activeBuffer.events.push({ type: 'status', kind, status })
      return
    }

    const key = getDownloadStatusKey(status)
    if (!key) return
    const isImmediate = status.executionState === 'Completed'
      || status.executionState === 'Failed'
      || status.executionState === 'Cancelled'
    if (isImmediate) {
      const pending = pendingRealtimeStatusesRef.current.get(key)
      if (pending && status.executionState !== 'Completed' && !shouldAcceptOrderedStatus(pending, status)) return
      pendingRealtimeStatusesRef.current.delete(key)
      setDownloads((current) => applyAcceptedRealtimeStatus(current, status))
      return
    }

    const pending = pendingRealtimeStatusesRef.current.get(key)
    if (!pending || shouldAcceptOrderedStatus(pending, status)) {
      pendingRealtimeStatusesRef.current.set(key, status)
    }
    if (realtimeFrameRef.current === null) {
      realtimeFrameRef.current = window.requestAnimationFrame(flushPendingRealtimeStatuses)
    }
  }, [applyAcceptedRealtimeStatus, flushPendingRealtimeStatuses])

  const applyRealtimeSystemStatus = useCallback((status: BookDownloadSystemStatus) => {
    if (!mountedRef.current) return
    const activeBuffer = realtimeBufferRef.current
    if (activeBuffer) {
      activeBuffer.events.push({ type: 'system', status })
      return
    }
    setSystemStatus((current) => applySystemStatus(current, status))
  }, [])

  const loadSnapshot = useCallback(async (notifyRefreshError = false, initial = false) => {
    refreshControllerRef.current?.abort()
    const controller = new AbortController()
    refreshControllerRef.current = controller
    const buffer: RealtimeBuffer = {
      events: realtimeBufferRef.current?.events.slice() ?? [],
    }
    realtimeBufferRef.current = buffer
    setIsRefreshing(true)
    if (initial) setIsInitialLoading(true)
    else setIsInitialLoading(false)
    try {
      const [statuses, nextSystemStatus] = await Promise.all([
        getDownloadStatuses(controller.signal),
        getDownloadSystemStatus(controller.signal),
      ])
      if (controller.signal.aborted || !mountedRef.current) return false
      if (!statuses || typeof statuses !== 'object' || Array.isArray(statuses)) {
        throw new ApiError('ダウンロード状況の形式が不正です。', { category: 'server' })
      }
      let nextDownloads = replaceDownloadSnapshot(statuses)
      let resolvedSystemStatus = nextSystemStatus && typeof nextSystemStatus === 'object' && !Array.isArray(nextSystemStatus)
        ? nextSystemStatus
        : null
      if (realtimeBufferRef.current === buffer) {
        realtimeBufferRef.current = null
        for (const event of buffer.events) {
          if (event.type === 'status') {
            nextDownloads = applyAcceptedRealtimeStatus(nextDownloads, event.status)
          } else if (event.type === 'snapshot') {
            nextDownloads = replaceDownloadSnapshot(event.statuses)
          }
          else resolvedSystemStatus = applySystemStatus(resolvedSystemStatus, event.status)
        }
      }
      setDownloads(nextDownloads)
      setSystemStatus(resolvedSystemStatus)
      setLoadError('')
      return true
    } catch (error) {
      if (controller.signal.aborted || !mountedRef.current) return false
      const message = getErrorMessage(error)
      setLoadError(message)
      if (realtimeBufferRef.current === buffer) {
        realtimeBufferRef.current = null
        if (buffer.events.some((event) => event.type === 'status' || event.type === 'snapshot')) {
          setDownloads((current) => buffer.events.reduce((next, event) => {
            if (event.type === 'status') return applyAcceptedRealtimeStatus(next, event.status)
            if (event.type === 'snapshot') return replaceDownloadSnapshot(event.statuses)
            return next
          }, current))
        }
        if (buffer.events.some((event) => event.type === 'system')) {
          setSystemStatus((current) => buffer.events.reduce((next, event) => (
            event.type === 'system' ? applySystemStatus(next, event.status) : next
          ), current))
        }
      }
      if (notifyRefreshError) notify(`ダウンロード一覧を更新できませんでした: ${message}`, 'error')
      return false
    } finally {
      if (refreshControllerRef.current === controller) {
        refreshControllerRef.current = null
        setIsRefreshing(false)
        setIsInitialLoading(false)
      }
    }
  }, [applyAcceptedRealtimeStatus, notify, replaceDownloadSnapshot])

  useEffect(() => {
    mountedRef.current = true
    setDownloads([])
    setSystemStatus(null)
    setLoadError('')
    dismiss()
    pendingActionsRef.current.clear()
    setPendingActions(new Set())
    latestRealtimeStatusesRef.current.clear()
    terminalDownloadsRef.current.clear()

    const applyStatusCollection = (statuses: BookDownloadStatus[]) => {
      if (!Array.isArray(statuses)) return
      statuses.forEach((status) => queueRealtimeStatus('statusUpdate', status))
    }
    const applyStatusSnapshot = (statuses: Record<string, BookDownloadStatus>) => {
      if (!mountedRef.current || !statuses || typeof statuses !== 'object' || Array.isArray(statuses)) return
      const activeBuffer = realtimeBufferRef.current
      if (activeBuffer) {
        activeBuffer.events.push({ type: 'snapshot', statuses })
        return
      }
      clearPendingRealtimeStatuses()
      setDownloads((current) => replaceDownloadSnapshot(statuses))
    }
    const unsubscribe = bookDownloadHubClient.subscribe({
      onStatus: queueRealtimeStatus,
      onRunningDownloads: applyStatusCollection,
      onQueuedDownloads: applyStatusCollection,
      onAllDownloadStatuses: applyStatusSnapshot,
      onSystemStatus: applyRealtimeSystemStatus,
      onBookDownloadStatus: (status) => queueRealtimeStatus('statusUpdate', status),
      onResyncRequested: () => {
        if (!mountedRef.current) return
        void loadSnapshot()
      },
    })

    void loadSnapshot(false, true)
    return () => {
      mountedRef.current = false
      unsubscribe()
      refreshControllerRef.current?.abort()
      commandControllersRef.current.forEach((controller) => controller.abort())
      commandControllersRef.current.clear()
      pendingActionsRef.current.clear()
      latestRealtimeStatusesRef.current.clear()
      terminalDownloadsRef.current.clear()
      realtimeBufferRef.current = null
      clearPendingRealtimeStatuses()
    }
  }, [
    apiRevision,
    applyRealtimeSystemStatus,
    clearPendingRealtimeStatuses,
    dismiss,
    loadSnapshot,
    queueRealtimeStatus,
    replaceDownloadSnapshot,
  ])

  useEffect(() => {
    let active = true

    const clearReconciliationTimer = () => {
      if (reconciliationTimerRef.current === null) return
      window.clearTimeout(reconciliationTimerRef.current)
      reconciliationTimerRef.current = null
    }

    const scheduleReconciliation = () => {
      if (!active || !mountedRef.current || activeDownloads <= 0) return
      clearReconciliationTimer()
      reconciliationTimerRef.current = window.setTimeout(() => {
        reconciliationTimerRef.current = null
        void pollStatuses()
      }, 1000)
    }

    const pollStatuses = async () => {
      if (!active || !mountedRef.current || activeDownloads <= 0) return
      if (reconciliationInFlightRef.current) {
        scheduleReconciliation()
        return
      }

      const controller = new AbortController()
      reconciliationControllerRef.current = controller
      reconciliationInFlightRef.current = true
      try {
        const statuses = await getDownloadStatuses(controller.signal)
        if (
          !controller.signal.aborted
          && active
          && mountedRef.current
          && statuses
          && typeof statuses === 'object'
          && !Array.isArray(statuses)
        ) {
          setDownloads((current) => replaceDownloadSnapshot(statuses))
        }
      } catch {
        // Reconciliation is best effort. The existing snapshot remains visible
        // and the next scheduled poll can recover without surfacing a toast.
      } finally {
        reconciliationInFlightRef.current = false
        if (reconciliationControllerRef.current === controller) {
          reconciliationControllerRef.current = null
        }
        scheduleReconciliation()
      }
    }

    if (activeDownloads > 0) scheduleReconciliation()

    return () => {
      active = false
      clearReconciliationTimer()
      reconciliationControllerRef.current?.abort()
    }
  }, [activeDownloads, apiRevision, replaceDownloadSnapshot])

  const runItemAction = async (id: string, action: ItemAction) => {
    const job = downloads.find((download) => download.id === id)
    if (!job || isPending(id)) return
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
    if (!['pause', 'resume', 'retry', 'priority', 'delete'].includes(action)) return

    setPending(id, true)
    const controller = new AbortController()
    commandControllersRef.current.add(controller)
    try {
      if (action === 'pause') {
        const response = await pauseDownloadItem(job.url as string, controller.signal)
        ensureApiSuccess(response, 'ダウンロードを一時停止できませんでした。')
      } else if (action === 'resume') {
        const response = await resumeDownloadItem(job.url as string, controller.signal)
        ensureApiSuccess(response, 'ダウンロードを再開できませんでした。')
      } else if (action === 'retry') {
        const response = await startBookDownload({ url: job.url as string, priority: job.priority }, controller.signal)
        ensureApiSuccess(response, 'ダウンロードを再試行できませんでした。')
      } else if (action === 'priority') {
        const nextPriority = (job.priority + 1) % PRIORITY_LABELS.length
        const response = await updateDownloadPriority({ url: job.url as string, priority: nextPriority }, controller.signal)
        ensureApiSuccess(response, 'ダウンロードの優先度を変更できませんでした。')
      } else {
        const response = await deleteDownloadItem(job.url as string, controller.signal)
        ensureApiSuccess(response, 'ダウンロードを削除できませんでした。')
      }

      if (action === 'retry' || action === 'delete') {
        terminalDownloadsRef.current.delete(job.id)
        latestRealtimeStatusesRef.current.delete(job.id)
        pendingRealtimeStatusesRef.current.delete(job.id)
      }
      const refreshed = await loadSnapshot()
      if (action === 'retry' || action === 'delete') terminalDownloadsRef.current.delete(job.id)
      if (!controller.signal.aborted && mountedRef.current) {
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
      }
    } catch (error) {
      if (!controller.signal.aborted && mountedRef.current) {
        notify(`${job.title}を操作できませんでした: ${getErrorMessage(error)}`, 'error')
      }
    } finally {
      commandControllersRef.current.delete(controller)
      setPending(id, false)
    }
  }

  const pauseDownload = (id: string) => { void runItemAction(id, 'pause') }
  const resumeDownload = (id: string) => { void runItemAction(id, 'resume') }
  const retryDownload = (id: string) => { void runItemAction(id, 'retry') }
  const changePriority = (id: string) => { void runItemAction(id, 'priority') }
  const deleteDownload = (id: string) => { void runItemAction(id, 'delete') }

  const runGlobalAction = async (action: 'pause' | 'resume') => {
    const pendingKey = `global-${action}`
    if (isPending(pendingKey)) return
    setPending(pendingKey, true)
    const controller = new AbortController()
    commandControllersRef.current.add(controller)
    try {
      const response = action === 'pause'
        ? await pauseAllDownloadsRequest(controller.signal)
        : await resumeAllDownloadsRequest(controller.signal)
      ensureApiSuccess(response, action === 'pause' ? 'ダウンロードを一時停止できませんでした。' : 'ダウンロードを再開できませんでした。')
      const refreshed = await loadSnapshot()
      if (!controller.signal.aborted && mountedRef.current) {
        const successMessage = action === 'pause'
          ? '実行中と待機中のダウンロードをすべて一時停止しました'
          : '一時停止中のダウンロードをすべて再開しました'
        notify(refreshed ? successMessage : `${successMessage}（一覧の更新に失敗しました）`, refreshed ? 'success' : 'warning')
      }
    } catch (error) {
      if (!controller.signal.aborted && mountedRef.current) {
        notify(`${action === 'pause' ? '一括一時停止' : '一括再開'}に失敗しました: ${getErrorMessage(error)}`, 'error')
      }
    } finally {
      commandControllersRef.current.delete(controller)
      setPending(pendingKey, false)
    }
  }

  const pauseAllDownloads = () => { void runGlobalAction('pause') }
  const resumeAllDownloads = () => { void runGlobalAction('resume') }
  const refreshDownloads = () => { void loadSnapshot(true) }

  const clearSearch = () => {
    setSearchQuery('')
  }

  const hubConnectionClass = hubConnectionState === 'connected'
    ? ''
    : hubConnectionState === 'connecting' || hubConnectionState === 'reconnecting'
      ? 'is-reconnecting'
      : 'is-stopped'

  return (
    <section
      className="download-manager"
      aria-labelledby="download-manager-title"
      aria-busy={isInitialLoading || isRefreshing}
    >
      <header className="download-manager__hero">
        <div className="download-manager__heading">
          <span className="download-manager__heading-icon" aria-hidden="true">
            <CloudDownload size={22} strokeWidth={2.1} />
          </span>
          <div>
            <h1 id="download-manager-title">ダウンロード管理</h1>
            <p className={`download-manager__connection ${hubConnectionClass}`} role="status" aria-live="polite">
              <span className="download-manager__connection-dot" aria-hidden="true" />
              <span>{HUB_CONNECTION_LABELS[hubConnectionState]}</span>
              <span className="download-manager__connection-divider" aria-hidden="true">•</span>
              <span>{systemActivityLabel}</span>
            </p>
          </div>
        </div>

        <div className="download-manager__global-actions" aria-label="ダウンロード全体の操作">
          <IconButton
            variant="outline"
            tone="success"
            size="compact"
            className="download-manager__global-action"
            type="button"
            aria-label="全て再開"
            disabled={isPending('global-resume') || pausedCount === 0}
            onClick={resumeAllDownloads}
          >
            <Play size={16} aria-hidden="true" />
          </IconButton>
          <IconButton
            variant="outline"
            tone="warning"
            size="compact"
            className="download-manager__global-action"
            type="button"
            aria-label="全て一時停止"
            disabled={isPending('global-pause') || activeDownloads === 0}
            onClick={pauseAllDownloads}
          >
            <Pause size={16} aria-hidden="true" />
          </IconButton>
          <IconButton
            variant="ghost"
            tone="neutral"
            size="compact"
            className="download-manager__icon-button"
            type="button"
            aria-label="ダウンロード一覧を更新"
            disabled={isRefreshing}
            onClick={refreshDownloads}
          >
            <RefreshCw className={isRefreshing ? 'is-spinning' : undefined} size={18} aria-hidden="true" />
          </IconButton>
        </div>
      </header>

      <section className="download-manager__filters" aria-label="ダウンロードの検索と並び順">
        <div className="download-manager__search-field">
          <Search size={17} aria-hidden="true" />
          <label className="sr-only" htmlFor="download-manager-search">タイトルまたは作者で検索</label>
          <input
            id="download-manager-search"
            type="search"
            value={searchQuery}
            placeholder="タイトルまたは作者で検索..."
            onChange={(event) => setSearchQuery(event.target.value)}
          />
          {searchQuery && (
            <IconButton
              variant="ghost"
              tone="neutral"
              size="compact"
              className="download-manager__search-clear"
              type="button"
              aria-label="検索をクリア"
              onClick={() => setSearchQuery('')}
            >
              <X size={14} aria-hidden="true" />
            </IconButton>
          )}
        </div>

        <label className="download-manager__sort-field">
          <span>並び順</span>
          <ArrowDownUp size={15} aria-hidden="true" />
          <select value={sort} onChange={(event) => setSort(event.target.value as DownloadSort)}>
            <option value="priority">優先度順</option>
            <option value="progress">進捗順</option>
            <option value="added">追加日時順</option>
            <option value="title">タイトル順</option>
          </select>
        </label>
      </section>

      <div className="download-manager__list-header">
        <p>
          <span aria-live="polite">{filteredDownloads.length}件</span>
          {isRefreshing && <span className="sr-only" role="status">更新中…</span>}
        </p>
      </div>

      {loadError && downloads.length > 0 && (
        <div className="download-manager__error" role="alert">
          <TriangleAlert size={16} aria-hidden="true" />
          <span>{loadError}</span>
          <Button variant="outline" tone="danger" size="compact" className="download-manager__error-retry" type="button" onClick={refreshDownloads} disabled={isRefreshing}>再試行</Button>
        </div>
      )}

      {isInitialLoading ? (
        <div className="download-manager__loading" role="status" aria-live="polite" aria-busy="true">
          <span className="sr-only">ダウンロード一覧を読み込み中…</span>
          <div className="download-manager__list download-manager__list--loading" aria-hidden="true">
            {Array.from({ length: 4 }, (_, index) => <DownloadCardSkeleton key={index} />)}
          </div>
        </div>
      ) : loadError && downloads.length === 0 ? (
        <StatePanel
          title="ダウンロード一覧を読み込めませんでした"
          description={loadError}
          icon={<TriangleAlert size={28} />}
          tone="danger"
          role="alert"
          action={<Button
            variant="outline"
            tone="danger"
            size="compact"
            className={isRefreshing ? 'download-manager__clear-button--pending' : 'download-manager__clear-button'}
            aria-label={isRefreshing ? '再試行中…' : '再試行'}
            aria-busy={isRefreshing}
            onClick={refreshDownloads}
            disabled={isRefreshing}
          >
            {isRefreshing ? <RefreshCw className="is-spinning" size={16} aria-hidden="true" /> : '再試行'}
          </Button>}
        />
      ) : filteredDownloads.length > 0 ? (
        <div className="download-manager__list" aria-live="polite" aria-busy={isRefreshing}>
          {filteredDownloads.map((download) => (
            <DownloadCard
              key={download.id}
              download={download}
              pending={isPending(download.id)}
              onPause={pauseDownload}
              onResume={resumeDownload}
              onRetry={retryDownload}
              onPriorityChange={changePriority}
              onDelete={deleteDownload}
            />
          ))}
        </div>
      ) : (
        <StatePanel
          title={hasSearchQuery ? '条件に一致するダウンロードがありません' : 'ダウンロードはありません'}
          icon={<Search size={28} />}
          action={hasSearchQuery && <Button variant="outline" tone="accent" size="compact" className="download-manager__clear-button" type="button" onClick={clearSearch}>検索をクリア</Button>}
        />
      )}

      <Snackbar notice={notice} onDismiss={dismiss} />
    </section>
  )
}

function DownloadCardSkeleton() {
  return (
    <article className="download-card download-card--skeleton" aria-hidden="true">
      <div className="download-card__cover-wrap">
        <span className="download-manager__skeleton download-card__skeleton-cover" />
      </div>

      <div className="download-card__body">
        <div className="download-card__title-row">
          <div className="download-card__skeleton-copy">
            <span className="download-manager__skeleton download-card__skeleton-line download-card__skeleton-line--title" />
            <span className="download-manager__skeleton download-card__skeleton-line download-card__skeleton-line--artist" />
          </div>
        </div>

        <div className="download-card__progress-row">
          <span className="download-manager__skeleton download-card__skeleton-progress" />
          <span className="download-manager__skeleton download-card__skeleton-percent" />
        </div>

        <div className="download-card__details">
          <span className="download-manager__skeleton download-card__skeleton-detail" />
          <span className="download-manager__skeleton download-card__skeleton-detail download-card__skeleton-detail--short" />
        </div>

        <div className="download-card__status-row">
          <span className="download-manager__skeleton download-card__skeleton-status" />
          <span className="download-manager__skeleton download-card__skeleton-priority" />
        </div>
      </div>

      <div className="download-card__actions">
        <span className="download-manager__skeleton download-card__skeleton-action" />
        <span className="download-manager__skeleton download-card__skeleton-action" />
        <span className="download-manager__skeleton download-card__skeleton-action" />
      </div>
    </article>
  )
}

function DownloadCard({
  download,
  pending,
  onPause,
  onResume,
  onRetry,
  onPriorityChange,
  onDelete,
}: {
  download: DownloadJob
  pending: boolean
  onPause: (id: string) => void
  onResume: (id: string) => void
  onRetry: (id: string) => void
  onPriorityChange: (id: string) => void
  onDelete: (id: string) => void
}) {
  const presentation = STATUS_PRESENTATIONS[download.status]
  const StatusIcon = presentation.icon
  const progressColor = download.status === 'failed'
    ? 'danger'
    : download.status === 'paused'
      ? 'warning'
      : download.status === 'queued'
        ? 'info'
        : download.status === 'stopped' || download.status === 'cancelled'
          ? 'warning'
          : 'primary'
  const canPause = download.status === 'running' || download.status === 'queued'
  const canResume = download.status === 'paused'
  const canRetry = download.status === 'failed'
  const canLoadBookThumbnail = Boolean(
    download.groupId
    && download.bookId
    && download.totalPages > 0
    && download.completedPages > 0,
  )
  const loadBookThumbnail = useCallback((signal: AbortSignal) => {
    if (!download.groupId || !download.bookId || download.totalPages <= 0) {
      return Promise.reject(new Error('Book page is not available'))
    }
    return requestBlob('/api/book/page', {
      query: {
        groupId: download.groupId,
        bookId: download.bookId,
        page: 1,
        width: 500,
        height: 700,
        strategy: 'speed',
        fallback_to_original: true,
      },
      headers: { Accept: 'image/*' },
      signal,
    })
  }, [download.bookId, download.groupId, download.totalPages])
  const legacyThumbnailUrl = isAbsoluteUrl(download.thumbnailUrl) ? download.thumbnailUrl : undefined

  return (
    <article className={`download-card download-card--${download.status}`} aria-busy={pending}>
      <div className="download-card__cover-wrap">
        <Thumbnail
          src={canLoadBookThumbnail ? undefined : legacyThumbnailUrl}
          load={canLoadBookThumbnail ? loadBookThumbnail : undefined}
          reloadKey={download.completedPages > 0 ? 1 : 0}
          alt={`${download.title}の表紙`}
          className="download-card__thumbnail"
          variant={download.cover}
          fallbackText="表紙なし"
          fallbackAriaLabel={`${download.title}の表紙を表示できません`}
        />
        <span className="download-card__cover-status" aria-label={`状態: ${presentation.label}`}>
          <StatusIcon size={12} aria-hidden="true" />
          <span>{presentation.label}</span>
        </span>
      </div>

      <div className="download-card__body">
        <div className="download-card__title-row">
          <div>
            <h2>{download.title}</h2>
            {download.artist && (
              <p className="download-card__artist"><span aria-hidden="true">作家</span>{download.artist}</p>
            )}
          </div>
          {download.priority === 0 && <span className="download-card__priority-badge">最優先</span>}
        </div>

        <div className="download-card__progress-row">
          <div
            className={`download-card__progress download-card__progress--${progressColor}`}
            role="progressbar"
            aria-label={`${download.title}のダウンロード進捗`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={download.progress}
          >
            <span style={{ width: `${download.progress}%` }} />
          </div>
          <strong>{download.progress}%</strong>
        </div>

        <div className="download-card__details">
          <span>
            <LibraryBig size={14} aria-hidden="true" />
            {download.completedPages} / {download.totalPages} ページ完了
          </span>
          {download.failedPages > 0 && (
            <span className="download-card__failed-pages">
              <TriangleAlert size={14} aria-hidden="true" />
              {download.failedPages}ページ失敗
            </span>
          )}
          {download.status === 'running' && download.speed !== undefined && (
            <span className="download-card__speed">
              <Gauge size={14} aria-hidden="true" />
              {download.speed.toFixed(1)} KB/s
            </span>
          )}
        </div>

        <div className="download-card__status-row">
          <span className="download-card__priority-text">優先度: {getPriorityLabel(download.priority)}</span>
          {download.status === 'queued' && download.queuePosition !== undefined && (
            <span className="download-card__queue-position">キュー内位置: {download.queuePosition}</span>
          )}
        </div>

        {download.status === 'failed' && download.errorMessage && (
          <p className="download-card__error">
            <TriangleAlert size={14} aria-hidden="true" />
            <span>{download.errorMessage}</span>
          </p>
        )}
      </div>

      <div className="download-card__actions" aria-label={`${download.title}の操作`}>
        {download.status === 'queued' && (
          <button
            className="download-card__action download-card__action--priority download-card__action--icon-only"
            type="button"
            aria-label={`${download.title}の優先度を変更（現在: ${getPriorityLabel(download.priority)}）`}
            disabled={pending || !download.url}
            onClick={() => onPriorityChange(download.id)}
          >
            <ArrowDownUp size={16} aria-hidden="true" />
          </button>
        )}

        {canPause ? (
          <button
            className="download-card__action download-card__action--pause download-card__action--icon-only"
            type="button"
            aria-label={`${download.title}を一時停止`}
            disabled={pending || !download.url}
            onClick={() => onPause(download.id)}
          >
            <Pause size={16} aria-hidden="true" />
          </button>
        ) : canResume ? (
          <button
            className="download-card__action download-card__action--resume download-card__action--icon-only"
            type="button"
            aria-label={`${download.title}を再開`}
            disabled={pending || !download.url}
            onClick={() => onResume(download.id)}
          >
            <Play size={16} aria-hidden="true" />
          </button>
        ) : canRetry ? (
          <button
            className="download-card__action download-card__action--retry download-card__action--icon-only"
            type="button"
            aria-label={`${download.title}を再試行`}
            disabled={pending || !download.url}
            onClick={() => onRetry(download.id)}
          >
            <RefreshCw size={16} aria-hidden="true" />
          </button>
        ) : null}

        <button
          className="download-card__action download-card__action--delete download-card__action--icon-only"
          type="button"
          aria-label={`${download.title}を削除`}
          disabled={pending || !download.url}
          onClick={() => onDelete(download.id)}
        >
          <Trash2 size={16} aria-hidden="true" />
        </button>
      </div>
    </article>
  )
}

export default DownloadManager
