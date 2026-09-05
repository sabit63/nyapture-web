import {
  forwardRef,
  useCallback,
  useEffect,
  useRef,
  useSyncExternalStore,
  type AnchorHTMLAttributes,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type Ref,
} from 'react'

const ROUTER_NAMESPACE = 'nyapture-router'
const ROUTER_STATE_KEY = '__nyapture_router__'

export type RouterHistoryMetadata = {
  namespace: typeof ROUTER_NAMESPACE
  entryId: string
  previousEntryId?: string
  scrollY: number
}

export type RouterHistoryState = Record<string, unknown> & {
  [ROUTER_STATE_KEY]?: RouterHistoryMetadata
}

export type RouterNavigationType = 'initial' | 'push' | 'replace' | 'pop'

export type NavigateOptions = {
  replace?: boolean
  preservePrevious?: boolean
}

export type PendingScrollRestoration = {
  entryId: string
  scrollY: number
}

export type ScrollRestorationAttemptStatus = 'none' | 'restored' | 'pending' | 'stale'

export type ScrollRestorationAttempt = {
  status: ScrollRestorationAttemptStatus
  pending: PendingScrollRestoration | null
  scrollY?: number
}

export type RouterLocation = {
  href: string
  origin: string
  pathname: string
  search: string
  hash: string
  historyState: unknown
  history: RouterHistoryMetadata | null
  navigationType: RouterNavigationType
  revision: number
}

export type NavigationClickDetails = {
  button?: number
  defaultPrevented?: boolean
  metaKey?: boolean
  ctrlKey?: boolean
  shiftKey?: boolean
  altKey?: boolean
  target?: string | null
  download?: boolean
  href?: string | null
  currentHref?: string
  currentOrigin?: string
}

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null
)

const normalizeScrollY = (value: unknown) => (
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0
)

export const readRouterHistoryMetadata = (state: unknown): RouterHistoryMetadata | null => {
  if (!isRecord(state)) return null
  const metadata = state[ROUTER_STATE_KEY]
  if (!isRecord(metadata) || metadata.namespace !== ROUTER_NAMESPACE || typeof metadata.entryId !== 'string') return null
  return {
    namespace: ROUTER_NAMESPACE,
    entryId: metadata.entryId,
    ...(typeof metadata.previousEntryId === 'string' ? { previousEntryId: metadata.previousEntryId } : {}),
    scrollY: normalizeScrollY(metadata.scrollY),
  }
}

export const createRouterHistoryState = (
  state: unknown,
  entryId: string,
  scrollY = 0,
  previousEntryId?: string,
): RouterHistoryState => ({
  ...(isRecord(state) ? state : {}),
  [ROUTER_STATE_KEY]: {
    namespace: ROUTER_NAMESPACE,
    entryId,
    ...(previousEntryId ? { previousEntryId } : {}),
    scrollY: normalizeScrollY(scrollY),
  },
})

export const updateRouterScrollState = (state: unknown, scrollY: number): RouterHistoryState | null => {
  const metadata = readRouterHistoryMetadata(state)
  if (!metadata) return null
  return createRouterHistoryState(state, metadata.entryId, scrollY, metadata.previousEntryId)
}

/**
 * Applies a scheduled scroll save only while its original history entry is
 * still active. This is intentionally DOM-free so an old RAF cannot mutate a
 * destination entry after a push or pop.
 */
export const runScheduledScrollSave = ({
  expectedEntryId,
  scrollY,
  getCurrentEntryId,
  save,
}: {
  expectedEntryId: string
  scrollY: number
  getCurrentEntryId: () => string | null
  save: (scrollY: number) => void
}) => {
  if (getCurrentEntryId() !== expectedEntryId) return false
  save(scrollY)
  return true
}

/**
 * Resolves one pending pop restoration against the currently rendered
 * document. A short document keeps the request pending until its height
 * grows; a different entry invalidates it immediately.
 */
export const resolvePendingScrollRestoration = (
  pending: PendingScrollRestoration | null,
  currentEntryId: string | null,
  maxScrollY: number,
): ScrollRestorationAttempt => {
  if (!pending) return { status: 'none', pending: null }
  if (!currentEntryId || pending.entryId !== currentEntryId) return { status: 'stale', pending: null }
  if (!Number.isFinite(maxScrollY) || maxScrollY < pending.scrollY) {
    return { status: 'pending', pending: { ...pending } }
  }
  return { status: 'restored', pending: null, scrollY: pending.scrollY }
}

/**
 * Returns true when a normal primary-button click can be handled by the SPA.
 * Keeping this decision pure makes browser-specific link behavior easy to
 * exercise without a DOM test environment.
 */
export const shouldInterceptNavigationClick = ({
  button = 0,
  defaultPrevented = false,
  metaKey = false,
  ctrlKey = false,
  shiftKey = false,
  altKey = false,
  target = null,
  download = false,
  href,
  currentHref,
  currentOrigin,
}: NavigationClickDetails): boolean => {
  if (defaultPrevented || button !== 0 || metaKey || ctrlKey || shiftKey || altKey) return false
  if (target !== null && target !== '') return false
  if (download || !href) return false

  let destination: URL
  let current: URL | undefined
  try {
    destination = new URL(href, currentHref ?? currentOrigin ?? 'http://localhost/')
    current = currentHref ? new URL(currentHref) : undefined
  } catch {
    return false
  }

  const origin = currentOrigin ?? current?.origin
  if (!origin || destination.origin !== origin) return false
  if (current && destination.pathname === current.pathname && destination.search === current.search) {
    // Hash changes are deliberately left to the browser so native anchor
    // scrolling and URL semantics remain intact.
    if (destination.hash !== current.hash) return false
    if (destination.href === current.href) return false
  }
  return true
}

type RouterSubscriber = () => void

let entrySequence = 0

const createEntryId = () => {
  const randomId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${++entrySequence}`
  return `${ROUTER_NAMESPACE}-${randomId}`
}

const readBrowserLocation = (): RouterLocation => {
  if (typeof window === 'undefined') {
    const fallback = new URL('http://localhost/')
    return {
      href: fallback.href,
      origin: fallback.origin,
      pathname: fallback.pathname,
      search: fallback.search,
      hash: fallback.hash,
      historyState: null,
      history: null,
      navigationType: 'initial',
      revision: 0,
    }
  }

  const url = new URL(window.location.href)
  return {
    href: url.href,
    origin: url.origin,
    pathname: url.pathname,
    search: url.search,
    hash: url.hash,
    historyState: window.history.state,
    history: readRouterHistoryMetadata(window.history.state),
    navigationType: 'initial',
    revision: 0,
  }
}

const createLocationStore = () => {
  let snapshot = readBrowserLocation()
  let revision = 0
  let navigationType: RouterNavigationType = 'initial'
  const subscribers = new Set<RouterSubscriber>()
  let listenersAttached = false
  let pendingScrollRestoration: PendingScrollRestoration | null = null

  const ensureHistoryEntry = () => {
    if (typeof window === 'undefined') return null
    const existing = readRouterHistoryMetadata(window.history.state)
    if (existing) return existing
    const state = createRouterHistoryState(window.history.state, createEntryId(), window.scrollY)
    window.history.replaceState(state, '', window.location.href)
    snapshot = readBrowserLocation()
    return readRouterHistoryMetadata(state)
  }

  const emit = (nextNavigationType: RouterNavigationType) => {
    pendingScrollRestoration = null
    navigationType = nextNavigationType
    revision += 1
    const current = readBrowserLocation()
    snapshot = {
      ...current,
      navigationType,
      revision,
    }
    subscribers.forEach((subscriber) => subscriber())
  }

  const onPopState = () => {
    ensureHistoryEntry()
    emit('pop')
  }

  const attachListeners = () => {
    if (listenersAttached || typeof window === 'undefined') return
    listenersAttached = true
    ensureHistoryEntry()
    window.addEventListener('popstate', onPopState)
  }

  const detachListeners = () => {
    if (!listenersAttached || typeof window === 'undefined') return
    listenersAttached = false
    window.removeEventListener('popstate', onPopState)
  }

  const getSnapshot = () => {
    if (typeof window === 'undefined') return snapshot
    const href = window.location.href
    const state = window.history.state
    const history = readRouterHistoryMetadata(state)
    if (href !== snapshot.href || history?.entryId !== snapshot.history?.entryId || history?.scrollY !== snapshot.history?.scrollY) {
      snapshot = {
        ...readBrowserLocation(),
        navigationType,
        revision,
      }
    }
    return snapshot
  }

  const subscribe = (subscriber: RouterSubscriber) => {
    subscribers.add(subscriber)
    attachListeners()
    return () => {
      subscribers.delete(subscriber)
      if (subscribers.size === 0) detachListeners()
    }
  }

  const persistScroll = (scrollY: number, expectedEntryId?: string) => {
    if (typeof window === 'undefined') return false
    ensureHistoryEntry()
    const currentMetadata = readRouterHistoryMetadata(window.history.state)
    if (expectedEntryId && currentMetadata?.entryId !== expectedEntryId) return false
    const nextState = updateRouterScrollState(window.history.state, scrollY)
    if (!nextState) return false
    window.history.replaceState(nextState, '', window.location.href)
    snapshot = {
      ...readBrowserLocation(),
      navigationType: snapshot.navigationType,
      revision: snapshot.revision,
    }
    return true
  }

  const beginScrollRestoration = (pending: PendingScrollRestoration) => {
    pendingScrollRestoration = { ...pending }
    return retryPendingScrollRestoration()
  }

  const retryPendingScrollRestoration = (): ScrollRestorationAttempt => {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      return { status: 'none', pending: pendingScrollRestoration }
    }
    const documentElement = document.documentElement
    const body = document.body
    const scrollHeight = Math.max(documentElement?.scrollHeight ?? 0, body?.scrollHeight ?? 0)
    const maxScrollY = Math.max(0, scrollHeight - Math.max(0, window.innerHeight))
    const currentEntryId = readRouterHistoryMetadata(window.history.state)?.entryId ?? null
    const attempt = resolvePendingScrollRestoration(
      pendingScrollRestoration,
      currentEntryId,
      maxScrollY,
    )
    pendingScrollRestoration = attempt.pending
    if (attempt.status === 'restored' && attempt.scrollY !== undefined) {
      window.scrollTo({ top: attempt.scrollY, behavior: 'auto' })
    }
    return attempt
  }

  const navigate = (to: string | URL, options: NavigateOptions = {}) => {
    if (typeof window === 'undefined') return
    const destination = new URL(to.toString(), window.location.href)
    if (destination.origin !== window.location.origin) {
      window.location.assign(destination.toString())
      return
    }
    if (destination.href === window.location.href) return
    if (destination.pathname === window.location.pathname
      && destination.search === window.location.search
      && destination.hash !== window.location.hash) {
      window.location.assign(destination.toString())
      return
    }

    const currentMetadata = ensureHistoryEntry()
    persistScroll(window.scrollY)
    const state = createRouterHistoryState(
      window.history.state,
      createEntryId(),
      0,
      options.preservePrevious === false ? undefined : currentMetadata?.entryId,
    )
    const method = options.replace ? 'replaceState' : 'pushState'
    window.history[method](state, '', `${destination.pathname}${destination.search}${destination.hash}`)
    emit(options.replace ? 'replace' : 'push')
  }

  return {
    getSnapshot,
    subscribe,
    navigate,
    persistScroll,
    ensureHistoryEntry,
    beginScrollRestoration,
    retryPendingScrollRestoration,
  }
}

const locationStore = createLocationStore()

export const navigate = (to: string | URL, options?: NavigateOptions) => locationStore.navigate(to, options)

export const persistScrollPosition = (scrollY: number, expectedEntryId?: string) => locationStore.persistScroll(scrollY, expectedEntryId)

/**
 * Starts a pop restoration for a specific history entry and immediately
 * attempts it. Call retryPendingScrollRestoration after async content is
 * committed to retry a still-short document.
 */
export const beginPendingScrollRestoration = (entryId: string, scrollY: number) => (
  locationStore.beginScrollRestoration({ entryId, scrollY: normalizeScrollY(scrollY) })
)

export const retryPendingScrollRestoration = () => locationStore.retryPendingScrollRestoration()

export const useRouterLocation = () => useSyncExternalStore(
  locationStore.subscribe,
  locationStore.getSnapshot,
  locationStore.getSnapshot,
)

export const shouldUseRouterHistoryBack = (state: unknown, historyLength: number) => (
  Boolean(readRouterHistoryMetadata(state)?.previousEntryId) && historyLength > 1
)

export const navigateBackOrFallback = (fallback = '/search') => {
  if (typeof window === 'undefined') return
  if (shouldUseRouterHistoryBack(window.history.state, window.history.length)) {
    window.history.back()
    return
  }
  navigate(fallback, { replace: true, preservePrevious: false })
}

const getAnchorTarget = (anchor: HTMLAnchorElement) => (
  anchor.hasAttribute('target') ? anchor.getAttribute('target') : null
)

export type InternalLinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  ref?: Ref<HTMLAnchorElement>
}

export const InternalLink = forwardRef<HTMLAnchorElement, Omit<InternalLinkProps, 'ref'>>(({
  href,
  onClick,
  ...props
}, ref) => {
  const handleClick = useCallback((event: ReactMouseEvent<HTMLAnchorElement>) => {
    onClick?.(event)
    if (event.defaultPrevented || typeof window === 'undefined') return
    const anchor = event.currentTarget
    if (!shouldInterceptNavigationClick({
      button: event.button,
      defaultPrevented: event.defaultPrevented,
      metaKey: event.metaKey,
      ctrlKey: event.ctrlKey,
      shiftKey: event.shiftKey,
      altKey: event.altKey,
      target: getAnchorTarget(anchor),
      download: anchor.hasAttribute('download'),
      href: anchor.href,
      currentHref: window.location.href,
      currentOrigin: window.location.origin,
    })) return
    event.preventDefault()
    navigate(anchor.href)
  }, [onClick])

  return <a ref={ref} href={href} onClick={handleClick} {...props} />
})
InternalLink.displayName = 'InternalLink'

const focusDestinationHeading = () => {
  if (typeof document === 'undefined') return
  const heading = document.querySelector<HTMLElement>('main h1, main [role="heading"]')
  if (!heading) return
  const hadTabIndex = heading.hasAttribute('tabindex')
  if (!hadTabIndex) heading.setAttribute('tabindex', '-1')
  heading.focus({ preventScroll: true })
}

export function RouterRuntime({ children }: { children?: ReactNode }) {
  const location = useRouterLocation()
  const scrollFrameRef = useRef<number | null>(null)

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.history.scrollRestoration = 'manual'
    locationStore.ensureHistoryEntry()
    const onScroll = () => {
      if (scrollFrameRef.current !== null) return
      const expectedEntryId = readRouterHistoryMetadata(window.history.state)?.entryId
        ?? locationStore.ensureHistoryEntry()?.entryId
      if (!expectedEntryId) return
      const persist = () => {
        scrollFrameRef.current = null
        runScheduledScrollSave({
          expectedEntryId,
          scrollY: window.scrollY,
          getCurrentEntryId: () => readRouterHistoryMetadata(window.history.state)?.entryId ?? null,
          save: (scrollY) => persistScrollPosition(scrollY, expectedEntryId),
        })
      }
      if (typeof window.requestAnimationFrame === 'function') {
        scrollFrameRef.current = window.requestAnimationFrame(persist)
      } else {
        persist()
      }
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', onScroll)
      if (scrollFrameRef.current !== null) window.cancelAnimationFrame(scrollFrameRef.current)
      scrollFrameRef.current = null
    }
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined' || location.revision === 0) return
    const frame = typeof window.requestAnimationFrame === 'function'
      ? window.requestAnimationFrame(() => {
        if (location.navigationType === 'pop') {
          if (location.history?.entryId) {
            beginPendingScrollRestoration(location.history.entryId, location.history.scrollY)
          } else {
            window.scrollTo({ top: 0, behavior: 'auto' })
          }
          focusDestinationHeading()
        } else {
          window.scrollTo({ top: 0, behavior: 'auto' })
          focusDestinationHeading()
        }
      })
      : undefined
    if (frame === undefined) {
      if (location.navigationType === 'pop' && location.history?.entryId) {
        beginPendingScrollRestoration(location.history.entryId, location.history.scrollY)
      } else {
        window.scrollTo({ top: 0, behavior: 'auto' })
      }
      focusDestinationHeading()
    }
    return () => {
      if (frame !== undefined) window.cancelAnimationFrame(frame)
    }
  }, [location.history?.entryId, location.history?.scrollY, location.navigationType, location.revision])

  return children ?? null
}

export const routerConstants = {
  namespace: ROUTER_NAMESPACE,
  stateKey: ROUTER_STATE_KEY,
} as const
