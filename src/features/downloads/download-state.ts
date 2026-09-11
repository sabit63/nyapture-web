import type {
  BookDownloadStatus,
  BookDownloadSystemStatus,
  EBook,
} from '../../models'

export type DownloadStatus = 'running' | 'queued' | 'paused' | 'failed' | 'stopped' | 'cancelled' | 'completed' | 'unknown'
export type DownloadSort = 'priority' | 'progress' | 'added' | 'title'

export type DownloadJob = {
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

export const sortDownloads = (downloads: readonly DownloadJob[], sort: DownloadSort) => (
  [...downloads].sort((first, second) => {
    if (first.status === 'running' || second.status === 'running') {
      return Number(second.status === 'running') - Number(first.status === 'running')
    }
    if (sort === 'progress') return second.progress - first.progress
    if (sort === 'added') return second.addedAt.localeCompare(first.addedAt)
    if (sort === 'title') return first.title.localeCompare(second.title, 'ja')
    return first.priority - second.priority || second.addedAt.localeCompare(first.addedAt)
  })
)

export type DownloadProjection = {
  downloads: DownloadJob[]
  statuses: ReadonlyMap<string, BookDownloadStatus>
  terminalDownloads: ReadonlyMap<string, DownloadJob>
}

export type DownloadStatusReduction = {
  projection: DownloadProjection
  accepted: boolean
  needsReconciliation: boolean
}

export type DownloadSnapshotOptions = {
  /** REST status-all is authoritative; a hub snapshot is merged conservatively. */
  authoritative?: boolean
}

const PRIORITY_LABEL_COUNT = 3
const COVER_VARIANTS = ['violet', 'blue', 'amber', 'rose'] as const

const EMPTY_PROJECTION: DownloadProjection = {
  downloads: [],
  statuses: new Map(),
  terminalDownloads: new Map(),
}

export const createEmptyDownloadProjection = (): DownloadProjection => ({
  downloads: [],
  statuses: new Map(),
  terminalDownloads: new Map(),
})

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

export const isAbsoluteUrl = (value: string | undefined) => {
  if (!value) return false
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

const isValidBookIdentifier = (value: string) => (
  value !== '.'
  && value !== '..'
  && !value.includes('/')
  && !value.includes('\\')
  && ![...value].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
)

export const getDownloadStatusKey = (status: BookDownloadStatus, legacyKey?: string): string | null => {
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

const normalizeExecutionState = (state: string | undefined) => state?.trim().toLocaleLowerCase('en-US')

const isTerminalState = (state: string | undefined) => {
  const normalized = normalizeExecutionState(state)
  return normalized === 'failed'
    || normalized === 'stopped'
    || normalized === 'cancelled'
    || normalized === 'completed'
}

const isActiveState = (state: string | undefined) => {
  const normalized = normalizeExecutionState(state)
  return normalized === 'queued' || normalized === 'running' || normalized === 'paused'
}

const isNewDownloadAttempt = (currentState: string | undefined, nextState: string | undefined) => {
  const current = normalizeExecutionState(currentState)
  const next = normalizeExecutionState(nextState)
  const wasTerminal = isTerminalState(current)
  const isActive = next === 'queued' || next === 'running'
  return wasTerminal && isActive
}

const hasMeaningfulStatusChange = (current: StatusFreshness, next: StatusFreshness) => (
  next.executionState !== current.executionState
  || pageCountValue(next) > pageCountValue(current)
  || asNonNegativeInteger(next.failedPages) > asNonNegativeInteger(current.failedPages)
  || next.downloadSpeed !== undefined && next.downloadSpeed !== current.downloadSpeed
  || next.priority !== undefined && next.priority !== current.priority
  || next.queuePosition !== undefined && next.queuePosition !== current.queuePosition
  || next.errorMessage !== undefined && next.errorMessage !== current.errorMessage
)

const freshnessValue = (status: BookDownloadStatus | DownloadJob): StatusFreshness => (
  'status' in status
    ? {
      lastUpdated: status.lastUpdated,
      completedPages: status.completedPages,
      failedPages: status.failedPages,
      executionState: status.status,
      downloadSpeed: status.speed,
      priority: status.priority,
      queuePosition: status.queuePosition,
      errorMessage: status.errorMessage,
    }
    : {
      lastUpdated: status.lastUpdated,
      completedPages: status.completedPages,
      currentPage: status.currentPage,
      failedPages: status.failedPages,
      executionState: normalizeExecutionState(status.executionState),
      downloadSpeed: status.downloadSpeed,
      priority: status.priority,
      queuePosition: status.queuePosition,
      errorMessage: status.errorMessage,
    }
)

/**
 * Returns whether an event with missing LastUpdated is a suspicious terminal
 * regression. The caller should ask REST for an authoritative snapshot rather
 * than turning a completed page count back into a failed card.
 */
export const statusNeedsReconciliation = (
  current: BookDownloadStatus | undefined,
  next: BookDownloadStatus,
) => {
  if (!current || next.lastUpdated) return false
  const currentValue = freshnessValue(current)
  const nextValue = freshnessValue(next)
  if (isTerminalState(currentValue.executionState) && isActiveState(nextValue.executionState)) return true
  if (!isTerminalState(nextValue.executionState)) return false
  return pageCountValue(nextValue) < pageCountValue(currentValue)
    && !isNewDownloadAttempt(currentValue.executionState, nextValue.executionState)
}

const shouldAcceptFreshness = (
  current: StatusFreshness | undefined,
  next: StatusFreshness,
) => {
  if (!current) return true

  const currentTimestamp = timestampValue(current.lastUpdated)
  const nextTimestamp = timestampValue(next.lastUpdated)
  const currentPages = pageCountValue(current)
  const nextPages = pageCountValue(next)
  const newAttempt = isNewDownloadAttempt(current.executionState, next.executionState)

  if (currentTimestamp !== undefined && nextTimestamp !== undefined) {
    if (nextTimestamp > currentTimestamp) {
      if (nextPages < currentPages && !newAttempt && !isTerminalState(next.executionState)) return false
      return true
    }
    if (nextTimestamp < currentTimestamp) return false
    if (nextPages < currentPages && !newAttempt && !isTerminalState(next.executionState)) return false
    return hasMeaningfulStatusChange(current, next)
  }

  if (nextPages < currentPages && !newAttempt) return false
  return true
}

/** Timestamp/page ordering used when merging REST snapshots. */
export const shouldAcceptSnapshotStatus = (
  current: BookDownloadStatus | undefined,
  next: BookDownloadStatus,
) => shouldAcceptFreshness(current ? freshnessValue(current) : undefined, freshnessValue(next))

/** Arrival ordering used for individual SignalR status events. */
export const shouldAcceptOrderedStatus = (
  current: BookDownloadStatus | undefined,
  next: BookDownloadStatus,
) => {
  if (!current) return true
  const currentValue = freshnessValue(current)
  const nextValue = freshnessValue(next)
  const currentPages = pageCountValue(currentValue)
  const nextPages = pageCountValue(nextValue)
  const newAttempt = isNewDownloadAttempt(currentValue.executionState, nextValue.executionState)

  const currentTimestamp = timestampValue(currentValue.lastUpdated)
  const nextTimestamp = timestampValue(nextValue.lastUpdated)
  if (nextTimestamp === undefined && isTerminalState(currentValue.executionState) && isActiveState(nextValue.executionState)) return false
  if (nextPages < currentPages && !newAttempt && (!isTerminalState(nextValue.executionState) || nextTimestamp === undefined)) return false
  if (currentTimestamp !== undefined && nextTimestamp !== undefined && nextTimestamp < currentTimestamp) return false
  return hasMeaningfulStatusChange(currentValue, nextValue)
}

export const mapExecutionState = (state: BookDownloadStatus['executionState']): DownloadStatus => {
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

const artistsFromBook = (book?: EBook) => {
  const artists = Array.isArray(book?.tagSet?.Artists)
    ? book.tagSet.Artists.map(asNonEmptyString).filter((value): value is string => Boolean(value))
    : []
  return artists.length > 0 ? artists.join('、') : firstString(book?.captions?.Artists)
}

export const mapDownloadStatus = (
  status: BookDownloadStatus,
  legacyKey?: string,
): DownloadJob | null => {
  const key = getDownloadStatusKey(status, legacyKey)
  if (!key) return null

  const book = status.book
  const totalPages = asNonNegativeInteger(book?.totalPage)
  const completedPages = Math.min(
    totalPages || Number.MAX_SAFE_INTEGER,
    Math.max(
      asNonNegativeInteger(status.completedPages),
      asNonNegativeInteger(status.currentPage),
    ),
  )
  const progress = totalPages > 0
    ? Math.min(100, Math.max(0, Math.round((completedPages / totalPages) * 100)))
    : 0

  return {
    id: key,
    groupId: asNonEmptyString(book?.groupId),
    bookId: asNonEmptyString(book?.bookId),
    url: asNonEmptyString(book?.url),
    title: firstString(book?.title, book?.captions?.Title, key) ?? 'タイトル不明',
    artist: artistsFromBook(book),
    thumbnailUrl: asNonEmptyString(status.thumbnailUrl),
    cover: getCoverVariant(key),
    status: mapExecutionState(status.executionState),
    progress,
    completedPages,
    totalPages,
    failedPages: asNonNegativeInteger(status.failedPages),
    priority: asNonNegativeInteger(status.priority, PRIORITY_LABEL_COUNT - 1),
    speed: asNonNegativeNumber(status.downloadSpeed),
    queuePosition: typeof status.queuePosition === 'number'
      ? asNonNegativeInteger(status.queuePosition)
      : undefined,
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
    if (!current || shouldAcceptSnapshotStatus(current.status, status)) {
      mapped.set(job.id, { status, job })
    }
  })
  return mapped
}

const deriveDownloads = (
  statuses: ReadonlyMap<string, BookDownloadStatus>,
  terminalDownloads: ReadonlyMap<string, DownloadJob>,
) => {
  const jobs = new Map<string, DownloadJob>()
  statuses.forEach((status, key) => {
    if (status.executionState === 'Completed') return
    const legacyKey = key.startsWith('url:') ? key.slice('url:'.length) : undefined
    const mapped = mapDownloadStatus(status, legacyKey)
    const job = mapped ? { ...mapped, id: key } : null
    if (job) jobs.set(key, job)
  })
  terminalDownloads.forEach((job, key) => {
    if (!jobs.has(key)) jobs.set(key, job)
  })
  return [...jobs.values()]
}

const projectionFromMaps = (
  statuses: Map<string, BookDownloadStatus>,
  terminalDownloads: Map<string, DownloadJob>,
): DownloadProjection => ({
  downloads: deriveDownloads(statuses, terminalDownloads),
  statuses,
  terminalDownloads,
})

/**
 * Project a REST or hub snapshot without changing either the input record or
 * the previous projection's maps. REST snapshots replace omitted terminal
 * entries, which makes a completed retry visible as a genuinely new attempt.
 */
export const projectDownloadSnapshot = (
  previous: DownloadProjection = EMPTY_PROJECTION,
  statuses: Record<string, BookDownloadStatus>,
  { authoritative = false }: DownloadSnapshotOptions = {},
): DownloadProjection => {
  const entries = mapDownloadStatusEntries(statuses)
  const nextStatuses = authoritative ? new Map<string, BookDownloadStatus>() : new Map(previous.statuses)
  const nextTerminalDownloads = authoritative
    ? new Map<string, DownloadJob>()
    : new Map(previous.terminalDownloads)

  entries.forEach(({ status, job }, key) => {
    const current = authoritative ? undefined : nextStatuses.get(key)
    const selected = current && !shouldAcceptSnapshotStatus(current, status) ? current : status
    nextStatuses.set(key, selected)
    const selectedJob = selected === status ? job : mapDownloadStatus(selected)
    if (!selectedJob) return

    if (selected.executionState === 'Completed') {
      nextTerminalDownloads.delete(key)
    } else if (isTerminalState(selected.executionState)) {
      nextTerminalDownloads.set(key, selectedJob)
    } else {
      nextTerminalDownloads.delete(key)
    }
  })

  return projectionFromMaps(nextStatuses, nextTerminalDownloads)
}

/** Apply one ordered SignalR status event as a pure projection transition. */
export const reduceDownloadStatus = (
  previous: DownloadProjection,
  status: BookDownloadStatus,
  legacyKey?: string,
): DownloadStatusReduction => {
  const key = getDownloadStatusKey(status, legacyKey)
  if (!key) return { projection: previous, accepted: false, needsReconciliation: false }

  const current = previous.statuses.get(key)
  if (current && !shouldAcceptOrderedStatus(current, status)) {
    return {
      projection: previous,
      accepted: false,
      needsReconciliation: statusNeedsReconciliation(current, status),
    }
  }

  const nextStatuses = new Map(previous.statuses)
  const nextTerminalDownloads = new Map(previous.terminalDownloads)
  nextStatuses.set(key, status)
  const job = mapDownloadStatus(status, legacyKey)
  if (!job) return { projection: previous, accepted: false, needsReconciliation: false }

  if (status.executionState === 'Completed') {
    nextTerminalDownloads.delete(key)
  } else if (isTerminalState(status.executionState)) {
    nextTerminalDownloads.set(key, job)
  } else {
    nextTerminalDownloads.delete(key)
  }

  return {
    projection: projectionFromMaps(nextStatuses, nextTerminalDownloads),
    accepted: true,
    needsReconciliation: false,
  }
}

/** Remove local knowledge of an attempt before retry/delete reconciliation. */
export const forgetDownloadAttempt = (
  previous: DownloadProjection,
  key: string,
): DownloadProjection => {
  const statuses = new Map(previous.statuses)
  const terminalDownloads = new Map(previous.terminalDownloads)
  statuses.delete(key)
  terminalDownloads.delete(key)
  return projectionFromMaps(statuses, terminalDownloads)
}

export const applySystemStatus = (
  current: BookDownloadSystemStatus | null,
  next: BookDownloadSystemStatus,
) => {
  if (!current) return next
  const currentTimestamp = timestampValue(current.lastUpdated)
  const nextTimestamp = timestampValue(next.lastUpdated)
  if (currentTimestamp !== undefined && nextTimestamp !== undefined && nextTimestamp <= currentTimestamp) return current
  return next
}

export const getDownloadCounts = (downloads: DownloadJob[]) => ({
  running: downloads.filter((download) => download.status === 'running').length,
  queued: downloads.filter((download) => download.status === 'queued').length,
  paused: downloads.filter((download) => download.status === 'paused').length,
})

export const getPriorityLabel = (priority: number) => (
  priority === 0 ? '最優先' : priority === 1 ? '高' : '通常'
)

export const ensureDownloadProjection = (value: DownloadProjection | null | undefined) => value ?? createEmptyDownloadProjection()
