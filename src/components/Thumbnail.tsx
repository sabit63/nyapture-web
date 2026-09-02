import { ImageOff, RotateCcw } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import './thumbnail.css'

type ThumbnailImageState = 'loading' | 'loaded' | 'error'

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
  fallbackText,
  fallbackAriaLabel,
  retryOnError = true,
  className,
  variant,
  children,
}: ThumbnailProps) {
  const [imageState, setImageState] = useState<ThumbnailImageState>(src || load ? 'loading' : 'error')
  const [retryKey, setRetryKey] = useState(0)
  const [resolvedSrc, setResolvedSrc] = useState(src)

  useEffect(() => {
    if (!load) {
      setResolvedSrc(src)
      setImageState(src ? 'loading' : 'error')
      return
    }

    const controller = new AbortController()
    let objectUrl: string | undefined
    setResolvedSrc(undefined)
    setImageState('loading')
    load(controller.signal)
      .then((blob) => {
        if (controller.signal.aborted) return
        objectUrl = URL.createObjectURL(blob)
        setResolvedSrc(objectUrl)
      })
      .catch(() => {
        if (!controller.signal.aborted) setImageState('error')
      })

    return () => {
      controller.abort()
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [load, retryKey, src])

  const retryImage = () => {
    if ((!src && !load) || !retryOnError) return
    setImageState('loading')
    setRetryKey((current) => current + 1)
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
          onLoad={() => setImageState('loaded')}
          onError={() => setImageState('error')}
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
