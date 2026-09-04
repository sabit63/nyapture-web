import { ImageOff, RotateCcw } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { MouseEventHandler, ReactNode } from 'react'
import {
  getThumbnailRetryDelayMs,
  THUMBNAIL_MAX_AUTO_RETRIES,
} from './thumbnail-retry'
import './thumbnail.css'

type ThumbnailImageState = 'loading' | 'loaded' | 'error'

type ThumbnailLifecycle = {
  active: boolean
  startLoad: () => void
  releaseObjectUrl: () => void
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
  alt,
  linkHref,
  linkAriaLabel,
  linkTabIndex,
  linkOnClick,
  fallbackText,
  fallbackAriaLabel,
  retryOnError = true,
  className,
  variant,
  children,
}: ThumbnailProps) {
  const [imageState, setImageState] = useState<ThumbnailImageState>(src || load ? 'loading' : 'error')
  const [retryKey, setRetryKey] = useState(0)
  const [resolvedSrc, setResolvedSrc] = useState(load ? undefined : src)
  const lifecycleRef = useRef<ThumbnailLifecycle | null>(null)
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const automaticRetriesRef = useRef(0)

  const scheduleAutomaticRetry = useCallback(() => {
    const lifecycle = lifecycleRef.current
    if (!lifecycle?.active || retryTimerRef.current !== null) return

    const retryNumber = automaticRetriesRef.current + 1
    lifecycle.releaseObjectUrl()
    if (retryNumber > THUMBNAIL_MAX_AUTO_RETRIES) {
      setResolvedSrc(undefined)
      setImageState('error')
      return
    }

    automaticRetriesRef.current = retryNumber
    setResolvedSrc(undefined)
    setImageState('loading')
    let timer: ReturnType<typeof setTimeout>
    timer = setTimeout(() => {
      if (retryTimerRef.current === timer) retryTimerRef.current = null
      if (!lifecycle.active) return
      if (load) {
        lifecycle.startLoad()
        return
      }
      if (!src) {
        setImageState('error')
        return
      }
      setResolvedSrc(src)
      setImageState('loading')
      setRetryKey((current) => current + 1)
    }, getThumbnailRetryDelayMs(retryNumber))
    retryTimerRef.current = timer
  }, [load, src])

  useEffect(() => {
    const lifecycle: ThumbnailLifecycle = {
      active: true,
      startLoad: () => undefined,
      releaseObjectUrl: () => undefined,
    }
    lifecycleRef.current = lifecycle
    automaticRetriesRef.current = 0

    if (retryTimerRef.current !== null) {
      clearTimeout(retryTimerRef.current)
      retryTimerRef.current = null
    }

    if (!load) {
      setResolvedSrc(src)
      setImageState(src ? 'loading' : 'error')
      return () => {
        lifecycle.active = false
        if (retryTimerRef.current !== null) {
          clearTimeout(retryTimerRef.current)
          retryTimerRef.current = null
        }
        if (lifecycleRef.current === lifecycle) lifecycleRef.current = null
      }
    }

    let controller: AbortController | undefined
    let objectUrl: string | undefined
    const revokeObjectUrl = () => {
      const currentUrl = objectUrl
      objectUrl = undefined
      if (currentUrl) URL.revokeObjectURL(currentUrl)
    }
    const startLoad = () => {
      if (!lifecycle.active) return
      controller?.abort()
      lifecycle.releaseObjectUrl()
      const nextController = new AbortController()
      controller = nextController
      setResolvedSrc(undefined)
      setImageState('loading')

      let request: Promise<Blob>
      try {
        request = load(nextController.signal)
      } catch (error) {
        if (!nextController.signal.aborted && !isAbortLikeThumbnailError(error)) scheduleAutomaticRetry()
        return
      }
      Promise.resolve(request)
        .then((blob) => {
          if (!lifecycle.active || nextController.signal.aborted) return
          revokeObjectUrl()
          objectUrl = URL.createObjectURL(blob)
          setResolvedSrc(objectUrl)
          setImageState('loading')
        })
        .catch((error: unknown) => {
          if (!lifecycle.active || nextController.signal.aborted || isAbortLikeThumbnailError(error)) return
          scheduleAutomaticRetry()
        })
    }
    lifecycle.releaseObjectUrl = revokeObjectUrl
    lifecycle.startLoad = startLoad
    setResolvedSrc(undefined)
    setImageState('loading')
    startLoad()

    return () => {
      lifecycle.active = false
      if (retryTimerRef.current !== null) {
        clearTimeout(retryTimerRef.current)
        retryTimerRef.current = null
      }
      controller?.abort()
      revokeObjectUrl()
      if (lifecycleRef.current === lifecycle) lifecycleRef.current = null
    }
  }, [load, scheduleAutomaticRetry, src])

  const retryImage = () => {
    if ((!src && !load) || !retryOnError) return
    const lifecycle = lifecycleRef.current
    if (!lifecycle?.active) return
    automaticRetriesRef.current = 0
    if (retryTimerRef.current !== null) {
      clearTimeout(retryTimerRef.current)
      retryTimerRef.current = null
    }
    setImageState('loading')
    setResolvedSrc(undefined)
    lifecycle.releaseObjectUrl()
    if (load) {
      lifecycle.startLoad()
    } else {
      setResolvedSrc(src)
      setRetryKey((current) => current + 1)
    }
  }

  const imageLoaded = () => {
    if (!lifecycleRef.current?.active) return
    automaticRetriesRef.current = 0
    setImageState('loaded')
  }

  const imageFailed = () => {
    if (!lifecycleRef.current?.active) return
    scheduleAutomaticRetry()
  }

  const imageContent = (
    <>
      {resolvedSrc && (
        <img
          key={retryKey}
          className="book-cover__image"
          src={resolvedSrc}
          alt={alt}
          width="500"
          height="700"
          loading="lazy"
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
    <div className={rootClassName}>
      {imageLink}
      {imageState === 'error' && (
        <div className="book-cover__fallback" role="img" aria-label={fallbackAriaLabel ?? `${alt}を表示できません`}>
          <ImageOff size={34} strokeWidth={1.4} aria-hidden="true" />
          <span>{fallbackText ?? 'サムネイルはありません'}</span>
          {(src || load) && retryOnError && (
            <button type="button" onClick={retryImage}>
              <RotateCcw size={14} />再試行
            </button>
          )}
        </div>
      )}
      {children}
    </div>
  )
}
