import { ImageOff, RotateCcw } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { MouseEventHandler, ReactNode } from 'react'
import {
  getThumbnailObserverRootMargin,
  normalizeThumbnailLoadingPolicy,
  ThumbnailLifecycle,
} from './thumbnail-loading'
import type {
  ThumbnailLoadingPolicy,
  ThumbnailRequestToken,
} from './thumbnail-loading'
import {
  getThumbnailRetryDelayMs,
  THUMBNAIL_MAX_AUTO_RETRIES,
} from './thumbnail-retry'
import './thumbnail.css'

type ThumbnailImageState = 'loading' | 'loaded' | 'error'

type ActiveThumbnailRequest = {
  token: ThumbnailRequestToken
  controller?: AbortController
  objectUrl?: string
}

type ThumbnailHandlers = {
  imageLoaded: (token: ThumbnailRequestToken) => void
  imageFailed: (token: ThumbnailRequestToken) => void
  retry: () => void
}

const isAbortLikeThumbnailError = (error: unknown) => (
  typeof error === 'object'
  && error !== null
  && 'name' in error
  && error.name === 'AbortError'
)

export type ThumbnailProps = {
  /** Image URL. When omitted, the component renders the missing-image fallback. */
  src?: string
  /** Optional authenticated/API-backed image loader. */
  load?: (signal: AbortSignal) => Promise<Blob>
  /** Optional key that forces an authenticated image reload when it changes. */
  reloadKey?: string | number
  /**
   * Controls when a thumbnail request is allowed to start. Strings are a
   * shorthand for the corresponding mode; object policies can set the number
   * of viewport heights used by the observer.
   */
  loadingPolicy?: ThumbnailLoadingPolicy
  /** Alternative text for the image. */
  alt: string
  /** Optional destination for making the thumbnail an accessible link. */
  linkHref?: string
  /** Accessible name for the optional link. */
  linkAriaLabel?: string
  /** Optional tab order for the optional link. */
  linkTabIndex?: number
  /** Optional click handler for the thumbnail link. */
  linkOnClick?: MouseEventHandler<HTMLAnchorElement>
  /** Text rendered in the fallback when the image is missing or cannot load. */
  fallbackText?: string
  /** Optional icon for entity-specific missing/failed image states. */
  fallbackIcon?: ReactNode
  /** Accessible name for the fallback region. */
  fallbackAriaLabel?: string
  /** Whether a failed image should expose the retry action. */
  retryOnError?: boolean
  /** Optional class added to the thumbnail root. */
  className?: string
  /** Optional visual variant, such as a book cover color. */
  variant?: string
  /** Content layered above the image and fallback, such as badges and actions. */
  children?: ReactNode
}

export function Thumbnail(props: ThumbnailProps) {
  // Remount the stateful implementation whenever the source changes. This
  // keeps the loading state in sync without an effect that could overwrite a
  // cached image's onLoad update after mount.
  const reloadSuffix = props.reloadKey === undefined ? '' : `:reload:${props.reloadKey}`
  const sourceKey = props.load
    ? `loader:${props.src ?? 'api'}${reloadSuffix}`
    : props.src
      ? `src:${props.src}${reloadSuffix}`
      : `missing${reloadSuffix}`
  return <ThumbnailInstance key={sourceKey} {...props} />
}

function ThumbnailInstance({
  src,
  load,
  loadingPolicy,
  alt,
  linkHref,
  linkAriaLabel,
  linkTabIndex,
  linkOnClick,
  fallbackText,
  fallbackIcon,
  fallbackAriaLabel,
  retryOnError = true,
  className,
  variant,
  children,
}: ThumbnailProps) {
  const normalizedPolicy = normalizeThumbnailLoadingPolicy(loadingPolicy)
  const { mode: loadingMode, viewports } = normalizedPolicy
  const hasSource = Boolean(src || load)
  const [imageState, setImageState] = useState<ThumbnailImageState>(hasSource ? 'loading' : 'error')
  const [retryKey, setRetryKey] = useState(0)
  const [resolvedSrc, setResolvedSrc] = useState<string | undefined>()
  const [renderToken, setRenderToken] = useState<ThumbnailRequestToken | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const lifecycleRef = useRef<ThumbnailLifecycle | null>(null)
  const requestRef = useRef<ActiveThumbnailRequest | null>(null)
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const automaticRetriesRef = useRef(0)
  const observerRef = useRef<IntersectionObserver | null>(null)
  const handlersRef = useRef<ThumbnailHandlers>({
    imageLoaded: () => undefined,
    imageFailed: () => undefined,
    retry: () => undefined,
  })

  useEffect(() => {
    const lifecycle = new ThumbnailLifecycle({ mode: loadingMode, viewports })
    let disposed = false
    let observer: IntersectionObserver | null = null
    let observedViewportHeight = 0
    lifecycleRef.current = lifecycle
    automaticRetriesRef.current = 0
    setResolvedSrc(undefined)
    setRenderToken(null)
    setImageState(hasSource ? 'loading' : 'error')

    const clearRetryTimer = () => {
      if (retryTimerRef.current === null) return
      clearTimeout(retryTimerRef.current)
      retryTimerRef.current = null
    }

    const revokeObjectUrl = (request: ActiveThumbnailRequest | null) => {
      if (!request?.objectUrl) return
      const objectUrl = request.objectUrl
      request.objectUrl = undefined
      URL.revokeObjectURL(objectUrl)
    }

    const releaseCurrentRequest = () => {
      const request = requestRef.current
      requestRef.current = null
      setRenderToken(null)
      setResolvedSrc(undefined)
      revokeObjectUrl(request)
    }

    const abortCurrentRequest = () => {
      requestRef.current?.controller?.abort()
    }

    const isCurrentLifecycle = (token: ThumbnailRequestToken) => (
      !disposed
      && lifecycleRef.current === lifecycle
      && lifecycle.isCurrent(token)
    )

    const isCurrentRequest = (token: ThumbnailRequestToken) => (
      isCurrentLifecycle(token)
      && requestRef.current?.token.generation === token.generation
    )

    function scheduleAutomaticRetry(token: ThumbnailRequestToken) {
      if (!isCurrentRequest(token) || retryTimerRef.current !== null) return

      const retryNumber = automaticRetriesRef.current + 1
      if (retryNumber > THUMBNAIL_MAX_AUTO_RETRIES) {
        lifecycle.markError(token)
        releaseCurrentRequest()
        setImageState('error')
        return
      }

      automaticRetriesRef.current = retryNumber
      lifecycle.markRetryWaiting(token)
      releaseCurrentRequest()
      setImageState('loading')
      const timerGeneration = lifecycle.snapshot().generation
      let timer: ReturnType<typeof setTimeout>
      timer = setTimeout(() => {
        if (retryTimerRef.current === timer) retryTimerRef.current = null
        if (!lifecycle.canRetry(timerGeneration)) return
        executeTransition(lifecycle.start())
      }, getThumbnailRetryDelayMs(retryNumber))
      retryTimerRef.current = timer
    }

    function startRequest(token: ThumbnailRequestToken) {
      if (!isCurrentLifecycle(token)) return

      const request: ActiveThumbnailRequest = { token }
      requestRef.current = request
      setRenderToken(token)
      setImageState('loading')

      if (!load) {
        if (!src) {
          lifecycle.markError(token)
          setImageState('error')
          return
        }
        setResolvedSrc(src)
        setRetryKey((current) => current + 1)
        return
      }

      const controller = new AbortController()
      request.controller = controller
      let requestPromise: Promise<Blob>
      try {
        requestPromise = load(controller.signal)
      } catch (error) {
        if (!controller.signal.aborted && !isAbortLikeThumbnailError(error)) {
          scheduleAutomaticRetry(token)
        }
        return
      }

      Promise.resolve(requestPromise)
        .then((blob) => {
          if (!isCurrentRequest(token) || controller.signal.aborted) return
          let objectUrl: string
          try {
            objectUrl = URL.createObjectURL(blob)
          } catch {
            scheduleAutomaticRetry(token)
            return
          }
          if (!isCurrentRequest(token)) {
            URL.revokeObjectURL(objectUrl)
            return
          }
          request.objectUrl = objectUrl
          setResolvedSrc(objectUrl)
          setImageState('loading')
        })
        .catch((error: unknown) => {
          if (!isCurrentRequest(token) || controller.signal.aborted || isAbortLikeThumbnailError(error)) return
          scheduleAutomaticRetry(token)
        })
    }

    function executeTransition(transition: ReturnType<ThumbnailLifecycle['start']>) {
      const effects = new Set(transition.effects)
      if (effects.has('stopRetry')) clearRetryTimer()
      if (effects.has('abort')) abortCurrentRequest()
      if (effects.has('release')) {
        releaseCurrentRequest()
        if (transition.state.phase === 'deferred') setImageState('loading')
      }
      if (effects.has('start') && transition.token) startRequest(transition.token)
    }

    function enterRange() {
      const transition = lifecycle.enter()
      executeTransition(transition)
      if (loadingMode === 'page' && transition.effects.includes('start')) {
        observer?.disconnect()
        observer = null
        observerRef.current = null
      }
    }

    function leaveRange() {
      executeTransition(lifecycle.leave())
    }

    function imageLoaded(token: ThumbnailRequestToken) {
      if (!isCurrentRequest(token)) return
      automaticRetriesRef.current = 0
      lifecycle.markLoaded(token)
      setImageState('loaded')
    }

    function imageFailed(token: ThumbnailRequestToken) {
      if (!isCurrentRequest(token)) return
      scheduleAutomaticRetry(token)
    }

    function retry() {
      if ((!src && !load) || disposed) return
      automaticRetriesRef.current = 0
      clearRetryTimer()
      executeTransition(lifecycle.start())
    }

    handlersRef.current = { imageLoaded, imageFailed, retry }

    if (!hasSource) {
      return () => {
        disposed = true
        handlersRef.current = {
          imageLoaded: () => undefined,
          imageFailed: () => undefined,
          retry: () => undefined,
        }
        lifecycle.dispose()
        clearRetryTimer()
        observer?.disconnect()
        observerRef.current = null
        abortCurrentRequest()
        const request = requestRef.current
        requestRef.current = null
        revokeObjectUrl(request)
        if (lifecycleRef.current === lifecycle) lifecycleRef.current = null
      }
    }

    if (loadingMode === 'immediate') {
      enterRange()
    } else if (typeof window === 'undefined' || typeof IntersectionObserver === 'undefined' || !rootRef.current) {
      // The observer is an optimization. Without it, preserve the old
      // behavior and request immediately rather than leaving a blank card.
      enterRange()
    } else {
      const handleIntersection: IntersectionObserverCallback = (entries) => {
        for (const entry of entries) {
          if (entry.target !== rootRef.current) continue
          if (entry.isIntersecting) enterRange()
          else if (loadingMode === 'range') leaveRange()
        }
      }

      const rebuildObserver = () => {
        const target = rootRef.current
        if (!target) return
        const nextViewportHeight = Math.max(1, Math.round(window.innerHeight))
        if (observer && observedViewportHeight === nextViewportHeight) return
        observer?.disconnect()
        observedViewportHeight = nextViewportHeight
        observer = new IntersectionObserver(handleIntersection, {
          rootMargin: getThumbnailObserverRootMargin(nextViewportHeight, viewports),
          threshold: 0,
        })
        observerRef.current = observer
        observer.observe(target)
      }

      rebuildObserver()
      window.addEventListener('resize', rebuildObserver)

      return () => {
        disposed = true
        handlersRef.current = {
          imageLoaded: () => undefined,
          imageFailed: () => undefined,
          retry: () => undefined,
        }
        lifecycle.dispose()
        clearRetryTimer()
        window.removeEventListener('resize', rebuildObserver)
        observer?.disconnect()
        observerRef.current = null
        abortCurrentRequest()
        const request = requestRef.current
        requestRef.current = null
        revokeObjectUrl(request)
        if (lifecycleRef.current === lifecycle) lifecycleRef.current = null
      }
    }

    return () => {
      disposed = true
      handlersRef.current = {
        imageLoaded: () => undefined,
        imageFailed: () => undefined,
        retry: () => undefined,
      }
      lifecycle.dispose()
      clearRetryTimer()
      observer?.disconnect()
      observerRef.current = null
      abortCurrentRequest()
      const request = requestRef.current
      requestRef.current = null
      revokeObjectUrl(request)
      if (lifecycleRef.current === lifecycle) lifecycleRef.current = null
    }
  }, [hasSource, load, loadingMode, src, viewports])

  const imageLoaded = () => {
    if (renderToken) handlersRef.current.imageLoaded(renderToken)
  }

  const imageFailed = () => {
    if (renderToken) handlersRef.current.imageFailed(renderToken)
  }

  const imageContent = (
    <>
      {resolvedSrc && (
        <img
          key={`${retryKey}:${renderToken?.generation ?? 'none'}`}
          className="book-cover__image"
          src={resolvedSrc}
          alt={alt}
          width="500"
          height="700"
          loading={loadingMode === 'immediate' ? 'lazy' : 'eager'}
          decoding="async"
          onLoad={imageLoaded}
          onError={imageFailed}
        />
      )}
      {imageState === 'loading' && <span className="book-cover__skeleton" aria-hidden="true" />}
    </>
  )

  const imageLink = linkHref ? (
    <a
      className="book-cover__link"
      href={linkHref}
      aria-label={linkAriaLabel}
      tabIndex={linkTabIndex}
      onClick={linkOnClick}
    >
      {imageContent}
    </a>
  ) : (
    <div className="book-cover__link">{imageContent}</div>
  )

  const rootClassName = [
    'book-cover',
    variant && `book-cover--${variant}`,
    `is-${imageState}`,
    className,
  ].filter(Boolean).join(' ')

  return (
    <div ref={rootRef} className={rootClassName}>
      {imageLink}
      {imageState === 'error' && (
        <div className="book-cover__fallback" role="group" aria-label={fallbackAriaLabel ?? `${alt}を表示できません`}>
          {fallbackIcon ?? <ImageOff size={34} strokeWidth={1.4} aria-hidden="true" />}
          <span>{fallbackText ?? 'サムネイルはありません'}</span>
          {(src || load) && retryOnError && (
            <button type="button" onClick={() => handlersRef.current.retry()}>
              <RotateCcw size={14} />再試行
            </button>
          )}
        </div>
      )}
      {children}
    </div>
  )
}
