export const BOOK_PAGE_REQUEST_WIDTHS = [720, 1280, 1920] as const
export const BOOK_PAGE_MAX_CONCURRENCY = 4
export const BOOK_PAGE_MAX_PIPELINE = 6
export const BOOK_PAGE_MAX_AUTO_RETRIES = 2
export const BOOK_PAGE_DECODE_TIMEOUT_MS = 30_000

// null requests the original width; undefined is reserved for an unmeasured reader.
export type BookPageRequestWidth = (typeof BOOK_PAGE_REQUEST_WIDTHS)[number] | null
export type BookPagePhase = 'deferred' | 'queued' | 'loading' | 'decoding' | 'retryWaiting' | 'loaded' | 'error'

export type BookPageSnapshot = Readonly<{
  phase: BookPagePhase
  displayedUrl?: string
  candidateUrl?: string
  candidateGeneration?: number
  aspectRatio: number
  isUpgrading: boolean
}>

type RequestKind = 'initial' | 'automaticRetry' | 'manualRetry' | 'upgrade'
type PendingPhase = 'queued' | 'fetching' | 'decoding'

type PageAsset = {
  objectUrl: string
  requestWidth: BookPageRequestWidth
  aspectRatio: number
  generation: number
}

type PendingRequest = {
  kind: RequestKind
  phase: PendingPhase
  targetWidth: BookPageRequestWidth
  generation: number
  enqueueSequence: number
  controller?: AbortController
  candidateUrl?: string
  pipelineSlotHeld?: boolean
  decodeTimer?: unknown
  decodeDeadline?: number
  decodeRemainingMs?: number
  decodeArmId?: number
}

type PageRecord = {
  pageNumber: number
  visible: boolean
  loadRange: boolean
  retentionRange: boolean
  generation: number
  aspectRatio: number
  displayedAsset?: PageAsset
  pendingRequest?: PendingRequest
  automaticRetriesUsed: number
  retryDeadline?: number
  retryRemainingMs?: number
  terminalError: boolean
  failedUpgradeWidth?: BookPageRequestWidth
}

export type BookPageQueueCandidate = Readonly<{
  pageNumber: number
  kind: RequestKind
  visible: boolean
  hasDisplayedAsset: boolean
  currentPage: number
  enqueueSequence: number
}>

export type BookPageLoaderOptions = {
  totalPages: number
  loadPage: (pageNumber: number, width: BookPageRequestWidth, signal: AbortSignal) => Promise<Blob>
  createObjectUrl?: (blob: Blob) => string
  revokeObjectUrl?: (url: string) => void
  now?: () => number
  random?: () => number
  setTimer?: (callback: () => void, delayMs: number) => unknown
  clearTimer?: (timer: unknown) => void
  /** Maximum in-flight fetches. Defaults to the existing viewer limit of 4. */
  maxConcurrency?: number
  /** Maximum fetch/decode pipeline slots. Defaults to the existing viewer limit of 6. */
  maxPipeline?: number
}

const DEFAULT_ASPECT_RATIO = 5 / 7

export const INITIAL_BOOK_PAGE_SNAPSHOT: BookPageSnapshot = Object.freeze({
  phase: 'deferred',
  aspectRatio: DEFAULT_ASPECT_RATIO,
  isUpgrading: false,
})

const asFinitePositive = (value: number) => Number.isFinite(value) && value > 0 ? value : undefined

const normalizeBookPageLimit = (value: number | undefined, fallback: number) => (
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : fallback
)

export const getBookPageRequestWidth = (
  readerWidth: number,
  devicePixelRatio: number,
): BookPageRequestWidth => {
  const normalizedWidth = asFinitePositive(readerWidth)
  if (normalizedWidth === undefined) return 1280
  const normalizedRatio = Math.min(asFinitePositive(devicePixelRatio) ?? 1, 2)
  const target = Math.ceil(normalizedWidth * normalizedRatio)
  return BOOK_PAGE_REQUEST_WIDTHS.find((width) => width >= target) ?? null
}

const errorStatus = (error: unknown) => {
  if (typeof error !== 'object' || error === null || !('status' in error)) return undefined
  return typeof error.status === 'number' ? error.status : undefined
}

const errorCategory = (error: unknown) => {
  if (typeof error !== 'object' || error === null || !('category' in error)) return undefined
  return typeof error.category === 'string' ? error.category : undefined
}

export const isAbortLikeBookPageError = (error: unknown) => (
  typeof error === 'object'
  && error !== null
  && 'name' in error
  && error.name === 'AbortError'
)

export const isRetryableBookPageError = (error: unknown) => {
  if (isAbortLikeBookPageError(error)) return false
  const status = errorStatus(error)
  if (status === 400 || status === 401 || status === 403 || status === 409 || status === 422) return false
  if (status === 404 || status === 408 || status === 429 || status !== undefined && status >= 500) return true
  const category = errorCategory(error)
  return category === 'timeout' || category === 'offline' || category === 'server'
}

export const getBookPageRetryDelayMs = (retryNumber: number, random = Math.random) => {
  const normalizedRetry = Math.min(Math.max(Math.trunc(retryNumber), 1), BOOK_PAGE_MAX_AUTO_RETRIES)
  const baseDelay = 500 * 2 ** (normalizedRetry - 1)
  const randomValue = Math.min(Math.max(random(), 0), 1)
  return baseDelay + Math.min(Math.floor(randomValue * 251), 250)
}

export const getBookPageQueueLane = (candidate: BookPageQueueCandidate) => {
  if (candidate.kind === 'manualRetry') return 0
  if (!candidate.hasDisplayedAsset && candidate.visible) return 1
  if (!candidate.hasDisplayedAsset && candidate.kind === 'initial') return 2
  if (candidate.kind === 'automaticRetry') return 3
  if (candidate.visible) return 4
  return 5
}

export const compareBookPageQueueCandidates = (
  first: BookPageQueueCandidate,
  second: BookPageQueueCandidate,
) => {
  const laneDifference = getBookPageQueueLane(first) - getBookPageQueueLane(second)
  if (laneDifference !== 0) return laneDifference
  const firstDistance = Math.abs(first.pageNumber - first.currentPage)
  const secondDistance = Math.abs(second.pageNumber - second.currentPage)
  if (firstDistance !== secondDistance) return firstDistance - secondDistance
  if (first.pageNumber !== second.pageNumber) return first.pageNumber - second.pageNumber
  return first.enqueueSequence - second.enqueueSequence
}

const sameSnapshot = (first: BookPageSnapshot, second: BookPageSnapshot) => (
  first.phase === second.phase
  && first.displayedUrl === second.displayedUrl
  && first.candidateUrl === second.candidateUrl
  && first.candidateGeneration === second.candidateGeneration
  && first.aspectRatio === second.aspectRatio
  && first.isUpgrading === second.isUpgrading
)

export class BookPageLoader {
  private readonly records = new Map<number, PageRecord>()
  private readonly snapshots = new Map<number, BookPageSnapshot>()
  private readonly listeners = new Map<number, Set<() => void>>()
  private readonly geometryListeners = new Set<() => void>()
  private readonly queuedPages = new Set<number>()
  private readonly ownedUrls = new Set<string>()
  private readonly loadPage: BookPageLoaderOptions['loadPage']
  private readonly createObjectUrl: (blob: Blob) => string
  private readonly revokeObjectUrl: (url: string) => void
  private readonly now: () => number
  private readonly random: () => number
  private readonly setTimer: NonNullable<BookPageLoaderOptions['setTimer']>
  private readonly clearTimer: NonNullable<BookPageLoaderOptions['clearTimer']>
  private readonly maxConcurrency: number
  private readonly maxPipeline: number
  private currentPage = 1
  private requestWidth?: BookPageRequestWidth
  private activeCount = 0
  private activePipelineCount = 0
  private enqueueSequence = 0
  private drainScheduled = false
  private attachmentGeneration = 0
  private wakeTimer?: unknown
  private disposed = false
  private backgrounded = false
  private decodeArmSequence = 0

  constructor(private readonly options: BookPageLoaderOptions) {
    this.loadPage = options.loadPage
    this.createObjectUrl = options.createObjectUrl ?? ((blob) => URL.createObjectURL(blob))
    this.revokeObjectUrl = options.revokeObjectUrl ?? ((url) => URL.revokeObjectURL(url))
    this.now = options.now ?? (() => Date.now())
    this.random = options.random ?? Math.random
    this.setTimer = options.setTimer ?? ((callback, delayMs) => setTimeout(callback, delayMs))
    this.clearTimer = options.clearTimer ?? ((timer) => clearTimeout(timer as ReturnType<typeof setTimeout>))
    this.maxConcurrency = normalizeBookPageLimit(options.maxConcurrency, BOOK_PAGE_MAX_CONCURRENCY)
    this.maxPipeline = normalizeBookPageLimit(options.maxPipeline, BOOK_PAGE_MAX_PIPELINE)
  }

  subscribe(pageNumber: number, listener: () => void) {
    const listeners = this.listeners.get(pageNumber) ?? new Set()
    listeners.add(listener)
    this.listeners.set(pageNumber, listeners)
    return () => {
      listeners.delete(listener)
      if (listeners.size === 0) this.listeners.delete(pageNumber)
    }
  }

  subscribeGeometry(listener: () => void) {
    this.geometryListeners.add(listener)
    return () => this.geometryListeners.delete(listener)
  }

  getSnapshot(pageNumber: number) {
    return this.snapshots.get(pageNumber) ?? INITIAL_BOOK_PAGE_SNAPSHOT
  }

  getActiveCount() {
    return this.activeCount
  }

  getPipelineCount() {
    return this.activePipelineCount
  }

  getActivePipelineCount() {
    return this.activePipelineCount
  }

  setBackgrounded(backgrounded: boolean) {
    if (this.disposed || this.backgrounded === backgrounded) return
    this.backgrounded = backgrounded
    this.records.forEach((record) => {
      const pending = record.pendingRequest
      if (!pending || pending.phase !== 'decoding') return
      if (backgrounded) this.pauseDecodeTimer(pending)
      else this.armDecodeTimer(record, pending)
    })
  }

  getQueuedCount() {
    return this.queuedPages.size
  }

  attach() {
    const generation = ++this.attachmentGeneration
    return () => {
      queueMicrotask(() => {
        if (this.attachmentGeneration === generation) this.dispose()
      })
    }
  }

  setCurrentPage(pageNumber: number) {
    if (!this.isValidPage(pageNumber) || pageNumber === this.currentPage) return
    this.currentPage = pageNumber
    this.scheduleDrain()
  }

  setRequestWidth(width: BookPageRequestWidth) {
    if (this.requestWidth !== undefined && (width ?? Infinity) <= (this.requestWidth ?? Infinity)) return
    this.requestWidth = width
    this.records.forEach((record) => {
      if (this.isInLoadRange(record)) this.admit(record)
    })
  }

  setVisible(pageNumber: number, visible: boolean) {
    const record = this.recordFor(pageNumber)
    if (!record || record.visible === visible) return
    const wasInLoadRange = this.isInLoadRange(record)
    record.visible = visible
    this.rangeChanged(record, wasInLoadRange)
  }

  setLoadRange(pageNumber: number, inRange: boolean) {
    const record = this.recordFor(pageNumber)
    if (!record || record.loadRange === inRange) return
    const wasInLoadRange = this.isInLoadRange(record)
    record.loadRange = inRange
    this.rangeChanged(record, wasInLoadRange)
  }

  setRetentionRange(pageNumber: number, inRange: boolean) {
    const record = this.recordFor(pageNumber)
    if (!record || record.retentionRange === inRange) return
    record.retentionRange = inRange
    this.rangeChanged(record, this.isInLoadRange(record))
  }

  manualRetry(pageNumber: number) {
    const record = this.recordFor(pageNumber)
    if (!record || !this.isEffectivelyRetained(record)) return
    record.automaticRetriesUsed = 0
    record.retryDeadline = undefined
    record.retryRemainingMs = undefined
    record.terminalError = false
    record.failedUpgradeWidth = undefined
    if (record.pendingRequest?.phase === 'queued') this.cancelQueued(record)
    this.queueRecord(record, 'manualRetry')
  }

  candidateLoaded(
    pageNumber: number,
    generation: number,
    candidateUrl: string,
    naturalWidth: number,
    naturalHeight: number,
  ) {
    const record = this.records.get(pageNumber)
    const pending = record?.pendingRequest
    if (!record || !pending || pending.generation !== generation || pending.candidateUrl !== candidateUrl) {
      this.releaseUnreferencedUrl(record, candidateUrl)
      return
    }

    this.clearDecodeTimer(pending)
    this.releasePipelineSlot(pending)
    const measuredRatio = asFinitePositive(naturalWidth) && asFinitePositive(naturalHeight)
      ? naturalWidth / naturalHeight
      : record.aspectRatio
    const previousUrl = record.displayedAsset?.objectUrl
    record.aspectRatio = measuredRatio
    record.displayedAsset = {
      objectUrl: candidateUrl,
      requestWidth: pending.targetWidth,
      aspectRatio: measuredRatio,
      generation,
    }
    record.pendingRequest = undefined
    record.automaticRetriesUsed = 0
    record.retryDeadline = undefined
    record.retryRemainingMs = undefined
    record.terminalError = false
    record.failedUpgradeWidth = undefined
    if (previousUrl && previousUrl !== candidateUrl) this.releaseUrl(previousUrl)
    this.publish(record)
    this.geometryListeners.forEach((listener) => listener())
    this.admit(record)
  }

  candidateFailed(pageNumber: number, generation: number, candidateUrl: string) {
    const record = this.records.get(pageNumber)
    const pending = record?.pendingRequest
    if (!record || !pending || pending.generation !== generation || pending.candidateUrl !== candidateUrl) {
      this.releaseUnreferencedUrl(record, candidateUrl)
      return
    }
    this.clearDecodeTimer(pending)
    this.releaseUrl(candidateUrl)
    pending.candidateUrl = undefined
    record.pendingRequest = undefined
    this.releasePipelineSlot(pending)
    this.handleFailure(record, { category: 'server' }, pending.targetWidth)
  }

  dispose() {
    if (this.disposed) return
    this.disposed = true
    this.clearWakeTimer()
    this.queuedPages.clear()
    this.records.forEach((record) => {
      record.generation += 1
      const pending = record.pendingRequest
      pending?.controller?.abort()
      if (pending) {
        this.clearDecodeTimer(pending)
        this.releasePipelineSlot(pending)
      }
      if (pending?.candidateUrl) this.releaseUrl(pending.candidateUrl)
      if (record.displayedAsset) this.releaseUrl(record.displayedAsset.objectUrl)
      record.pendingRequest = undefined
      record.displayedAsset = undefined
    })
    this.listeners.clear()
    this.geometryListeners.clear()
  }

  private isValidPage(pageNumber: number) {
    return Number.isInteger(pageNumber) && pageNumber >= 1 && pageNumber <= this.options.totalPages
  }

  private recordFor(pageNumber: number) {
    if (!this.isValidPage(pageNumber)) return undefined
    const existing = this.records.get(pageNumber)
    if (existing) return existing
    const record: PageRecord = {
      pageNumber,
      visible: false,
      loadRange: false,
      retentionRange: false,
      generation: 0,
      aspectRatio: DEFAULT_ASPECT_RATIO,
      automaticRetriesUsed: 0,
      terminalError: false,
    }
    this.records.set(pageNumber, record)
    return record
  }

  private isInLoadRange(record: PageRecord) {
    return record.visible || record.loadRange
  }

  private isEffectivelyRetained(record: PageRecord) {
    return record.visible || record.loadRange || record.retentionRange
  }

  private rangeChanged(record: PageRecord, wasInLoadRange: boolean) {
    const isInLoadRange = this.isInLoadRange(record)
    if (wasInLoadRange && !isInLoadRange && record.retryDeadline !== undefined) {
      record.retryRemainingMs = Math.max(0, record.retryDeadline - this.now())
      record.retryDeadline = undefined
    } else if (!wasInLoadRange && isInLoadRange && record.retryRemainingMs !== undefined) {
      record.retryDeadline = this.now() + record.retryRemainingMs
      record.retryRemainingMs = undefined
    }
    if (wasInLoadRange && !isInLoadRange) this.cancelDecodeOutsideLoadRange(record)
    if (!this.isEffectivelyRetained(record)) {
      this.evict(record)
    } else if (isInLoadRange) {
      this.admit(record)
    } else {
      if (record.pendingRequest?.phase === 'queued') this.cancelQueued(record)
      this.publish(record)
    }
    this.scheduleWakeTimer()
  }

  private cancelDecodeOutsideLoadRange(record: PageRecord) {
    const pending = record.pendingRequest
    if (!pending || pending.phase !== 'decoding') return
    record.generation += 1
    this.clearDecodeTimer(pending)
    if (pending.candidateUrl) {
      this.releaseUrl(pending.candidateUrl)
      pending.candidateUrl = undefined
    }
    record.pendingRequest = undefined
    this.releasePipelineSlot(pending)
    this.publish(record)
  }

  private admit(record: PageRecord) {
    if (this.disposed || !this.isInLoadRange(record) || this.requestWidth === undefined) {
      this.publish(record)
      return
    }
    if (record.pendingRequest) return
    if (record.terminalError) {
      this.publish(record)
      return
    }
    if (record.retryDeadline !== undefined) {
      if (record.retryDeadline <= this.now()) {
        this.queueRecord(record, 'automaticRetry')
      } else {
        this.publish(record)
        this.scheduleWakeTimer()
      }
      return
    }
    if (!record.displayedAsset) {
      this.queueRecord(record, 'initial')
      return
    }
    if (
      (record.displayedAsset.requestWidth ?? Infinity) < (this.requestWidth ?? Infinity)
      && record.failedUpgradeWidth !== this.requestWidth
    ) {
      this.queueRecord(record, 'upgrade')
      return
    }
    this.publish(record)
  }

  private queueRecord(record: PageRecord, kind: RequestKind) {
    if (this.disposed || this.requestWidth === undefined || record.pendingRequest) return
    const targetWidth = this.requestWidth
    if (
      kind === 'upgrade'
      && record.failedUpgradeWidth !== undefined
      && record.failedUpgradeWidth !== targetWidth
    ) {
      record.automaticRetriesUsed = 0
      record.failedUpgradeWidth = undefined
    }
    record.retryDeadline = undefined
    record.retryRemainingMs = undefined
    record.pendingRequest = {
      kind,
      phase: 'queued',
      targetWidth,
      generation: ++record.generation,
      enqueueSequence: ++this.enqueueSequence,
      pipelineSlotHeld: false,
    }
    this.queuedPages.add(record.pageNumber)
    this.publish(record)
    this.scheduleDrain()
  }

  private cancelQueued(record: PageRecord) {
    if (record.pendingRequest?.phase !== 'queued') return
    this.queuedPages.delete(record.pageNumber)
    record.pendingRequest = undefined
    this.publish(record)
  }

  private evict(record: PageRecord) {
    const pending = record.pendingRequest
    record.generation += 1
    if (pending?.phase === 'queued') this.queuedPages.delete(record.pageNumber)
    if (pending?.phase === 'fetching') pending.controller?.abort()
    if (pending) this.clearDecodeTimer(pending)
    if (pending) this.releasePipelineSlot(pending)
    if (pending?.candidateUrl) this.releaseUrl(pending.candidateUrl)
    if (record.displayedAsset) this.releaseUrl(record.displayedAsset.objectUrl)
    record.displayedAsset = undefined
    if (pending?.phase !== 'fetching') record.pendingRequest = undefined
    this.publish(record)
  }

  private drainQueue() {
    if (this.disposed) return
    while (
      this.activeCount < this.maxConcurrency
      && this.activePipelineCount < this.maxPipeline
    ) {
      const candidates = [...this.queuedPages].flatMap((pageNumber) => {
        const record = this.records.get(pageNumber)
        const pending = record?.pendingRequest
        if (!record || !pending || pending.phase !== 'queued' || !this.isInLoadRange(record)) return []
        return [{
          pageNumber,
          kind: pending.kind,
          visible: record.visible,
          hasDisplayedAsset: Boolean(record.displayedAsset),
          currentPage: this.currentPage,
          enqueueSequence: pending.enqueueSequence,
        } satisfies BookPageQueueCandidate]
      }).sort(compareBookPageQueueCandidates)
      const next = candidates[0]
      if (!next) return
      const record = this.records.get(next.pageNumber)
      const pending = record?.pendingRequest
      if (!record || !pending || pending.phase !== 'queued') {
        this.queuedPages.delete(next.pageNumber)
        continue
      }
      this.startRequest(record, pending)
    }
  }

  private startRequest(record: PageRecord, pending: PendingRequest) {
    this.queuedPages.delete(record.pageNumber)
    const controller = new AbortController()
    pending.phase = 'fetching'
    pending.controller = controller
    pending.pipelineSlotHeld = true
    this.activeCount += 1
    this.activePipelineCount += 1
    this.publish(record)

    Promise.resolve()
      .then(() => this.loadPage(record.pageNumber, pending.targetWidth, controller.signal))
      .then((blob) => {
        if (
          controller.signal.aborted
          || this.disposed
          || record.pendingRequest !== pending
          || pending.generation !== record.generation
          || !this.isEffectivelyRetained(record)
        ) {
          this.releasePipelineSlot(pending)
          return
        }
        if (!this.isInLoadRange(record)) {
          record.pendingRequest = undefined
          this.releasePipelineSlot(pending)
          this.publish(record)
          return
        }
        const candidateUrl = this.createObjectUrl(blob)
        this.ownedUrls.add(candidateUrl)
        pending.phase = 'decoding'
        pending.controller = undefined
        pending.candidateUrl = candidateUrl
        pending.decodeRemainingMs = BOOK_PAGE_DECODE_TIMEOUT_MS
        this.publish(record)
        this.armDecodeTimer(record, pending)
      })
      .catch((error) => {
        this.clearDecodeTimer(pending)
        if (pending.candidateUrl) {
          this.releaseUrl(pending.candidateUrl)
          pending.candidateUrl = undefined
        }
        this.releasePipelineSlot(pending)
        if (record.pendingRequest !== pending) return
        record.pendingRequest = undefined
        if (controller.signal.aborted || this.disposed || pending.generation !== record.generation) {
          this.publish(record)
          return
        }
        this.handleFailure(record, error, pending.targetWidth)
      })
      .finally(() => {
        this.activeCount = Math.max(0, this.activeCount - 1)
        if (record.pendingRequest === pending && pending.phase === 'fetching') {
          this.releasePipelineSlot(pending)
          record.pendingRequest = undefined
          this.publish(record)
        }
        if (this.isInLoadRange(record) && !record.pendingRequest) this.admit(record)
        this.scheduleDrain()
      })
  }

  private armDecodeTimer(record: PageRecord, pending: PendingRequest) {
    if (
      this.disposed
      || this.backgrounded
      || record.pendingRequest !== pending
      || pending.phase !== 'decoding'
      || !pending.pipelineSlotHeld
    ) return
    const remainingMs = Math.max(0, pending.decodeRemainingMs ?? BOOK_PAGE_DECODE_TIMEOUT_MS)
    if (pending.decodeTimer !== undefined) this.clearTimer(pending.decodeTimer)
    pending.decodeTimer = undefined
    pending.decodeDeadline = undefined
    const armId = ++this.decodeArmSequence
    pending.decodeArmId = armId
    pending.decodeRemainingMs = undefined
    if (remainingMs === 0) {
      queueMicrotask(() => this.decodeTimedOut(record, pending, armId))
      return
    }
    pending.decodeDeadline = this.now() + remainingMs
    pending.decodeTimer = this.setTimer(() => {
      if (pending.decodeArmId !== armId) return
      pending.decodeTimer = undefined
      pending.decodeDeadline = undefined
      this.decodeTimedOut(record, pending, armId)
    }, remainingMs)
  }

  private pauseDecodeTimer(pending: PendingRequest) {
    if (pending.decodeTimer !== undefined) {
      const currentTime = this.now()
      const deadline = pending.decodeDeadline ?? currentTime
      pending.decodeRemainingMs = Math.max(0, deadline - currentTime)
      this.clearTimer(pending.decodeTimer)
      pending.decodeTimer = undefined
    }
    pending.decodeArmId = undefined
    if (pending.decodeRemainingMs === undefined) {
      pending.decodeRemainingMs = BOOK_PAGE_DECODE_TIMEOUT_MS
    }
    pending.decodeDeadline = undefined
  }

  private clearDecodeTimer(pending: PendingRequest) {
    if (pending.decodeTimer !== undefined) {
      this.clearTimer(pending.decodeTimer)
      pending.decodeTimer = undefined
    }
    pending.decodeDeadline = undefined
    pending.decodeRemainingMs = undefined
    pending.decodeArmId = undefined
  }

  private decodeTimedOut(record: PageRecord, pending: PendingRequest, armId: number) {
    if (
      this.disposed
      || this.backgrounded
      || record.pendingRequest !== pending
      || pending.phase !== 'decoding'
      || pending.decodeArmId !== armId
      || !pending.pipelineSlotHeld
    ) return
    this.clearDecodeTimer(pending)
    if (pending.candidateUrl) {
      this.releaseUrl(pending.candidateUrl)
      pending.candidateUrl = undefined
    }
    record.pendingRequest = undefined
    this.releasePipelineSlot(pending)
    this.handleFailure(record, { category: 'timeout' }, pending.targetWidth)
  }

  private releasePipelineSlot(pending: PendingRequest) {
    if (!pending.pipelineSlotHeld) return
    pending.pipelineSlotHeld = false
    this.activePipelineCount = Math.max(0, this.activePipelineCount - 1)
    this.scheduleDrain()
  }

  private scheduleDrain() {
    if (this.disposed || this.drainScheduled) return
    this.drainScheduled = true
    queueMicrotask(() => {
      this.drainScheduled = false
      this.drainQueue()
    })
  }

  private handleFailure(record: PageRecord, error: unknown, targetWidth: BookPageRequestWidth) {
    if (isRetryableBookPageError(error) && record.automaticRetriesUsed < BOOK_PAGE_MAX_AUTO_RETRIES) {
      record.automaticRetriesUsed += 1
      const delay = getBookPageRetryDelayMs(record.automaticRetriesUsed, this.random)
      if (this.isInLoadRange(record)) {
        record.retryDeadline = this.now() + delay
        record.retryRemainingMs = undefined
      } else {
        record.retryDeadline = undefined
        record.retryRemainingMs = delay
      }
      record.terminalError = false
      this.publish(record)
      this.scheduleWakeTimer()
      return
    }

    record.retryDeadline = undefined
    record.retryRemainingMs = undefined
    if (record.displayedAsset) {
      record.failedUpgradeWidth = targetWidth
      this.publish(record)
      return
    }
    record.terminalError = true
    this.publish(record)
  }

  private queueDueRetries() {
    if (this.disposed) return
    const now = this.now()
    this.records.forEach((record) => {
      if (
        record.retryDeadline !== undefined
        && record.retryDeadline <= now
        && this.isInLoadRange(record)
        && !record.pendingRequest
        && !record.terminalError
      ) {
        this.queueRecord(record, 'automaticRetry')
      }
    })
    this.scheduleWakeTimer()
  }

  private scheduleWakeTimer() {
    this.clearWakeTimer()
    if (this.disposed) return
    let nextDeadline: number | undefined
    this.records.forEach((record) => {
      if (
        record.retryDeadline === undefined
        || !this.isInLoadRange(record)
        || record.pendingRequest
        || record.terminalError
      ) return
      nextDeadline = nextDeadline === undefined
        ? record.retryDeadline
        : Math.min(nextDeadline, record.retryDeadline)
    })
    if (nextDeadline === undefined) return
    const delay = Math.max(0, nextDeadline - this.now())
    this.wakeTimer = this.setTimer(() => {
      this.wakeTimer = undefined
      this.queueDueRetries()
    }, delay)
  }

  private clearWakeTimer() {
    if (this.wakeTimer === undefined) return
    this.clearTimer(this.wakeTimer)
    this.wakeTimer = undefined
  }

  private releaseUrl(url: string) {
    if (!this.ownedUrls.delete(url)) return
    this.revokeObjectUrl(url)
  }

  private releaseUnreferencedUrl(record: PageRecord | undefined, url: string) {
    if (record?.displayedAsset?.objectUrl === url || record?.pendingRequest?.candidateUrl === url) return
    this.releaseUrl(url)
  }

  private publish(record: PageRecord) {
    const next = this.snapshotFor(record)
    const previous = this.snapshots.get(record.pageNumber) ?? INITIAL_BOOK_PAGE_SNAPSHOT
    if (sameSnapshot(previous, next)) return
    const snapshot = Object.freeze(next)
    this.snapshots.set(record.pageNumber, snapshot)
    this.listeners.get(record.pageNumber)?.forEach((listener) => listener())
  }

  private snapshotFor(record: PageRecord): BookPageSnapshot {
    if (!this.isEffectivelyRetained(record)) {
      return {
        phase: 'deferred',
        aspectRatio: record.aspectRatio,
        isUpgrading: false,
      }
    }
    const pending = record.pendingRequest
    if (record.displayedAsset) {
      return {
        phase: 'loaded',
        displayedUrl: record.displayedAsset.objectUrl,
        candidateUrl: pending?.candidateUrl,
        candidateGeneration: pending?.candidateUrl ? pending.generation : undefined,
        aspectRatio: record.aspectRatio,
        isUpgrading: Boolean(pending),
      }
    }
    if (record.terminalError) {
      return {
        phase: 'error',
        aspectRatio: record.aspectRatio,
        isUpgrading: false,
      }
    }
    if (pending) {
      return {
        phase: pending.phase === 'queued'
          ? 'queued'
          : pending.phase === 'fetching'
            ? 'loading'
            : 'decoding',
        candidateUrl: pending.candidateUrl,
        candidateGeneration: pending.candidateUrl ? pending.generation : undefined,
        aspectRatio: record.aspectRatio,
        isUpgrading: false,
      }
    }
    if (record.retryDeadline !== undefined && this.isInLoadRange(record)) {
      return {
        phase: 'retryWaiting',
        aspectRatio: record.aspectRatio,
        isUpgrading: false,
      }
    }
    return {
      phase: 'deferred',
      aspectRatio: record.aspectRatio,
      isUpgrading: false,
    }
  }
}
