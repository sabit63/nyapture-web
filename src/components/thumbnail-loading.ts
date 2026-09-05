export type ThumbnailLoadingMode = 'immediate' | 'page' | 'range'

export type ThumbnailLoadingPolicy = ThumbnailLoadingMode | {
  mode: ThumbnailLoadingMode
  /** Number of viewport heights to include around the thumbnail. */
  viewports?: number
}

export type NormalizedThumbnailLoadingPolicy = {
  mode: ThumbnailLoadingMode
  viewports: number
}

export const DEFAULT_THUMBNAIL_PAGE_VIEWPORTS = 3
export const DEFAULT_THUMBNAIL_RANGE_VIEWPORTS = 4

const normalizeViewportDistance = (value: number | undefined, fallback: number) => {
  if (value === undefined || Number.isNaN(value)) return fallback
  return Math.max(0, value)
}

export const normalizeThumbnailLoadingPolicy = (
  policy?: ThumbnailLoadingPolicy,
): NormalizedThumbnailLoadingPolicy => {
  const mode = typeof policy === 'string' ? policy : policy?.mode ?? 'immediate'
  const viewports = typeof policy === 'string' ? undefined : policy?.viewports

  return {
    mode,
    viewports: normalizeViewportDistance(
      viewports,
      mode === 'page' ? DEFAULT_THUMBNAIL_PAGE_VIEWPORTS : DEFAULT_THUMBNAIL_RANGE_VIEWPORTS,
    ),
  }
}

export const getThumbnailObserverRootMargin = (viewportHeight: number, viewports: number) => {
  const height = Number.isFinite(viewportHeight) ? Math.max(1, viewportHeight) : 1
  const distance = Number.isFinite(viewports) ? Math.max(0, viewports) : 0
  return `${Math.ceil(height * distance)}px 0px`
}

export type ThumbnailLifecyclePhase = 'deferred' | 'loading' | 'retryWaiting' | 'loaded' | 'error'

export type ThumbnailRequestToken = {
  generation: number
}

export type ThumbnailLifecycleState = {
  active: boolean
  mode: ThumbnailLoadingMode
  phase: ThumbnailLifecyclePhase
  entered: boolean
  inRange: boolean
  generation: number
  requestGeneration: number | null
}

export type ThumbnailLifecycleEffect = 'start' | 'abort' | 'release' | 'stopRetry'

export type ThumbnailLifecycleTransition = {
  state: ThumbnailLifecycleState
  effects: readonly ThumbnailLifecycleEffect[]
  token?: ThumbnailRequestToken
}

const copyState = (state: ThumbnailLifecycleState): ThumbnailLifecycleState => ({ ...state })

/**
 * Small, DOM-free lifecycle used by Thumbnail. Keeping range transitions here
 * makes the abort/release/reset contract explicit and testable.
 */
export class ThumbnailLifecycle {
  private current: ThumbnailLifecycleState

  constructor(policy?: ThumbnailLoadingPolicy) {
    const { mode } = normalizeThumbnailLoadingPolicy(policy)
    this.current = {
      active: true,
      mode,
      phase: 'deferred',
      entered: false,
      inRange: mode === 'immediate',
      generation: 0,
      requestGeneration: null,
    }
  }

  snapshot(): ThumbnailLifecycleState {
    return copyState(this.current)
  }

  isCurrent(token: ThumbnailRequestToken): boolean {
    return this.current.active && this.current.requestGeneration === token.generation
  }

  canRetry(generation: number): boolean {
    return this.current.active
      && this.current.generation === generation
      && (this.current.mode !== 'range' || this.current.inRange)
  }

  enter(): ThumbnailLifecycleTransition {
    if (!this.current.active) return this.transition([])

    const firstEntry = !this.current.entered
    this.current.entered = true
    this.current.inRange = true

    if (this.current.mode === 'page' && !firstEntry) return this.transition([])
    if (this.current.phase !== 'deferred' && this.current.phase !== 'error') {
      return this.transition([])
    }
    return this.start()
  }

  leave(): ThumbnailLifecycleTransition {
    if (!this.current.active || this.current.mode !== 'range' || !this.current.inRange) {
      return this.transition([])
    }

    this.current.inRange = false
    this.current.entered = true
    this.current.generation += 1
    this.current.requestGeneration = null
    this.current.phase = 'deferred'
    return this.transition(['abort', 'stopRetry', 'release'])
  }

  /** Starts a new request, invalidating any older request generation. */
  start(): ThumbnailLifecycleTransition {
    if (!this.current.active) return this.transition([])
    if (this.current.mode === 'range' && !this.current.inRange) return this.transition([])

    const hadRequest = this.current.requestGeneration !== null
    const hadRetainedAsset = this.current.phase === 'loaded'
    this.current.generation += 1
    this.current.requestGeneration = this.current.generation
    this.current.phase = 'loading'
    const effects: ThumbnailLifecycleEffect[] = []
    if (hadRequest) effects.push('abort')
    if (hadRequest || hadRetainedAsset) effects.push('release')
    effects.push('stopRetry', 'start')
    return this.transition(effects, { generation: this.current.generation })
  }

  markRetryWaiting(token: ThumbnailRequestToken): ThumbnailLifecycleTransition {
    if (!this.isCurrent(token)) return this.transition([])
    this.current.requestGeneration = null
    this.current.phase = 'retryWaiting'
    return this.transition([])
  }

  markLoaded(token: ThumbnailRequestToken): ThumbnailLifecycleTransition {
    if (!this.isCurrent(token)) return this.transition([])
    this.current.requestGeneration = null
    this.current.phase = 'loaded'
    return this.transition([])
  }

  markError(token: ThumbnailRequestToken): ThumbnailLifecycleTransition {
    if (!this.isCurrent(token)) return this.transition([])
    this.current.requestGeneration = null
    this.current.phase = 'error'
    return this.transition([])
  }

  reset(): ThumbnailLifecycleTransition {
    if (!this.current.active) return this.transition([])
    this.current.generation += 1
    this.current.requestGeneration = null
    this.current.phase = 'deferred'
    this.current.entered = false
    this.current.inRange = this.current.mode === 'immediate'
    return this.transition(['abort', 'stopRetry', 'release'])
  }

  dispose(): ThumbnailLifecycleTransition {
    if (!this.current.active) return this.transition([])
    this.current.active = false
    this.current.generation += 1
    this.current.requestGeneration = null
    this.current.phase = 'deferred'
    this.current.inRange = false
    return this.transition(['abort', 'stopRetry', 'release'])
  }

  private transition(
    effects: readonly ThumbnailLifecycleEffect[],
    token?: ThumbnailRequestToken,
  ): ThumbnailLifecycleTransition {
    return { state: this.snapshot(), effects, token }
  }
}
