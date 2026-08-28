import {
  ArrowLeft,
  ArrowUp,
  ChevronDown,
  ChevronUp,
  ImageOff,
  RotateCcw,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, RefObject } from 'react'
import type { BookCardModel, BookTag, NyaTagType } from '../models'
import { getTagLabel, TAG_TYPE_LABELS, TAG_TYPE_ORDER } from '../models'
import { BookStatusBadge } from './BookStatusBadge'
import { TagChip } from './TagChip'
import './book-viewer.css'

type BookViewerRouteState = 'missing' | 'notFound' | 'ready'

export type BookViewerPageProps = {
  routeState: BookViewerRouteState
  routeIdentity: string
  book?: BookCardModel
  onTagSearch: (tag: BookTag) => void
}

type PagePhase = 'loading' | 'loaded' | 'error'

const MOCK_PAGE_WIDTH = 1000
const MOCK_PAGE_HEIGHT = 1400
const MOCK_MAX_PAGE_COUNT = 99
const MOCK_FAILURE_PAGE = 3
const MOCK_DELAY_BY_PAGE = new Map<number, number>([
  [1, 260],
  [3, 420],
  [7, 320],
])
const mockPageUrlCache = new Map<string, string>()

const isValidTotalPage = (value: number) => Number.isInteger(value) && value > 0 && value <= MOCK_MAX_PAGE_COUNT

const getBookIdentity = (book: Pick<BookCardModel, 'groupId' | 'bookId'>) => `${book.groupId}\u0000${book.bookId}`

const createNeutralPageUrl = (bookIdentity: string, pageNumber: number) => {
  const cacheKey = `${bookIdentity}:${pageNumber}`
  const cachedUrl = mockPageUrlCache.get(cacheKey)
  if (cachedUrl) return cachedUrl

  const palette = ['#e5e0d6', '#d9e1e6', '#e7dce2', '#dfe5d8', '#e4dcd0']
  const accentPalette = ['#8b6b82', '#62788c', '#9b725e', '#6d836e', '#7d728b']
  const background = palette[(pageNumber - 1) % palette.length]
  const accent = accentPalette[(pageNumber - 1) % accentPalette.length]
  const offset = (pageNumber * 29) % 190
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${MOCK_PAGE_WIDTH}" height="${MOCK_PAGE_HEIGHT}" viewBox="0 0 ${MOCK_PAGE_WIDTH} ${MOCK_PAGE_HEIGHT}"><rect width="1000" height="1400" fill="${background}"/><rect x="84" y="92" width="832" height="1216" rx="18" fill="#ffffff" fill-opacity=".54"/><path d="M142 ${256 + offset}h716M142 ${312 + offset}h560M142 ${368 + offset}h650" stroke="${accent}" stroke-opacity=".48" stroke-width="12" stroke-linecap="round"/><rect x="142" y="${548 + (offset % 120)}" width="716" height="390" rx="12" fill="${accent}" fill-opacity=".15"/><path d="M142 ${1018 + (offset % 100)}h460M142 ${1068 + (offset % 100)}h600M142 ${1118 + (offset % 100)}h330" stroke="${accent}" stroke-opacity=".34" stroke-width="10" stroke-linecap="round"/><circle cx="820" cy="1170" r="38" fill="${accent}" fill-opacity=".24"/></svg>`
  const url = `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`
  mockPageUrlCache.set(cacheKey, url)
  return url
}

const formatUploadDate = (uploadedTime: string) => {
  const date = new Date(uploadedTime)
  if (Number.isNaN(date.getTime())) return '不明'

  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)
  const getPart = (type: string) => parts.find((part) => part.type === type)?.value
  const year = getPart('year')
  const month = getPart('month')
  const day = getPart('day')
  const hour = getPart('hour')
  const minute = getPart('minute')
  const second = getPart('second')

  if (!year || !month || !day || !hour || !minute || !second) return '不明'
  return `${year}/${month}/${day} ${hour}:${minute}:${second} JST`
}

const groupBookTags = (tags: BookTag[]) => {
  const tagsByType = new Map<NyaTagType, BookTag[]>()
  tags.forEach((tag) => {
    const group = tagsByType.get(tag.type)
    if (group) group.push(tag)
    else tagsByType.set(tag.type, [tag])
  })

  return TAG_TYPE_ORDER
    .map((type) => ({ type, tags: tagsByType.get(type) ?? [] }))
    .filter((group) => group.tags.length > 0)
}

const getTagChipTitle = (tag: BookTag) => {
  const label = getTagLabel(tag)
  return label === tag.name ? tag.name : `${tag.name} / ${label}`
}

const getPageNumber = (target: Element) => Number(target.getAttribute('data-page-number') ?? 0)

const pickClosestEntry = (entries: Map<Element, IntersectionObserverEntry>) => {
  const viewportCenter = window.innerHeight / 2
  let closest: IntersectionObserverEntry | undefined
  let closestDistance = Number.POSITIVE_INFINITY

  entries.forEach((entry) => {
    if (!entry.isIntersecting) return
    const rect = entry.target.getBoundingClientRect()
    const distance = Math.abs((rect.top + rect.bottom) / 2 - viewportCenter)
    if (distance < closestDistance) {
      closest = entry
      closestDistance = distance
    }
  })

  return closest
}

function BookViewerPage({ routeState, routeIdentity, book, onTagSearch }: BookViewerPageProps) {
  const headingRef = useRef<HTMLHeadingElement>(null)
  const lastFocusedRouteRef = useRef<string | null>(null)

  useEffect(() => {
    if (lastFocusedRouteRef.current === routeIdentity) return
    const focusHeading = () => {
      if (lastFocusedRouteRef.current === routeIdentity) return
      lastFocusedRouteRef.current = routeIdentity
      headingRef.current?.focus({ preventScroll: true })
    }
    const frame = window.requestAnimationFrame(focusHeading)
    return () => window.cancelAnimationFrame(frame)
  }, [routeIdentity])

  if (routeState === 'ready' && book) {
    return <BookViewerReady book={book} headingRef={headingRef} onTagSearch={onTagSearch} />
  }

  const isMissing = routeState === 'missing'
  return (
    <section className="book-viewer book-viewer--route-error" aria-labelledby="book-viewer-route-title">
      <h1 id="book-viewer-route-title" ref={headingRef} tabIndex={-1}>
        {isMissing ? 'Bookの指定が必要です' : 'Bookが見つかりません'}
      </h1>
      <p>
        {isMissing
          ? 'id と gid を指定すると、Bookの画像一覧を表示できます。'
          : '指定されたBookはライブラリまたは検索結果にありません。'}
      </p>
      <a className="button button--secondary" href="/search">検索へ戻る</a>
    </section>
  )
}

function BookViewerReady({
  book,
  headingRef,
  onTagSearch,
}: {
  book: BookCardModel
  headingRef: RefObject<HTMLHeadingElement | null>
  onTagSearch: (tag: BookTag) => void
}) {
  const bookIdentity = useMemo(() => getBookIdentity(book), [book])
  const totalPages = isValidTotalPage(book.totalPage) ? book.totalPage : 0
  const tagGroups = useMemo(() => groupBookTags(book.tags), [book.tags])
  const [currentPage, setCurrentPage] = useState(totalPages > 0 ? 1 : 0)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [showScrollTop, setShowScrollTop] = useState(false)
  const readerRef = useRef<HTMLElement>(null)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const detailsPanelRef = useRef<HTMLDivElement>(null)
  const expandButtonRef = useRef<HTMLButtonElement>(null)
  const pointerStartedOutsideRef = useRef(false)
  const activeEntriesRef = useRef<Map<Element, IntersectionObserverEntry>>(new Map())
  const centerEntriesRef = useRef<Map<Element, IntersectionObserverEntry>>(new Map())

  useEffect(() => {
    const updateScrollTopVisibility = () => setShowScrollTop(window.scrollY > 420)
    updateScrollTopVisibility()
    window.addEventListener('scroll', updateScrollTopVisibility, { passive: true })
    return () => window.removeEventListener('scroll', updateScrollTopVisibility)
  }, [])

  useEffect(() => {
    setCurrentPage(totalPages > 0 ? 1 : 0)
    const reader = readerRef.current
    if (!reader || totalPages === 0 || typeof IntersectionObserver === 'undefined') return

    const pageElements = Array.from(reader.querySelectorAll<HTMLElement>('[data-page-number]'))
    const activeEntries = new Map<Element, IntersectionObserverEntry>()
    const centerEntries = new Map<Element, IntersectionObserverEntry>()
    activeEntriesRef.current = activeEntries
    centerEntriesRef.current = centerEntries

    const updateFromCenter = () => {
      const candidate = pickClosestEntry(centerEntries)
      if (!candidate) return
      const pageNumber = getPageNumber(candidate.target)
      if (pageNumber > 0 && activeEntries.has(candidate.target)) setCurrentPage(pageNumber)
    }

    const activeObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) activeEntries.set(entry.target, entry)
        else activeEntries.delete(entry.target)
      })
      updateFromCenter()
    }, { threshold: [0, 0.1, 0.5, 1] })

    const centerObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) centerEntries.set(entry.target, entry)
        else centerEntries.delete(entry.target)
      })
      updateFromCenter()
    }, {
      rootMargin: '-45% 0px -45% 0px',
      threshold: [0, 0.01, 0.5, 1],
    })

    pageElements.forEach((pageElement) => {
      activeObserver.observe(pageElement)
      centerObserver.observe(pageElement)
    })

    return () => {
      activeObserver.disconnect()
      centerObserver.disconnect()
      activeEntries.clear()
      centerEntries.clear()
    }
  }, [bookIdentity, totalPages])

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return

    if (detailsOpen) {
      if (!dialog.open) {
        if (typeof dialog.showModal === 'function') dialog.showModal()
        else dialog.setAttribute('open', '')
      }
      window.requestAnimationFrame(() => dialog.querySelector<HTMLElement>('[data-details-initial-focus]')?.focus())
    } else if (dialog.open) {
      dialog.close()
    }
  }, [detailsOpen])

  const closeDetails = useCallback(() => {
    const dialog = dialogRef.current
    if (dialog?.open) dialog.close()
    else setDetailsOpen(false)
  }, [])

  const navigateBack = () => {
    try {
      const referrer = document.referrer ? new URL(document.referrer) : null
      const safeReferrer = referrer
        && referrer.origin === window.location.origin
        && referrer.pathname !== '/book/viewer'
      if (safeReferrer && window.history.length > 1) {
        window.history.back()
        return
      }
    } catch {
      // Fall through to the stable search destination when the referrer is malformed.
    }
    window.location.assign('/search')
  }

  const scrollToTop = () => {
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' })
  }

  const handleDetailsKeyDown = (event: ReactKeyboardEvent<HTMLDialogElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      closeDetails()
      return
    }
    if (event.key !== 'Tab') return

    const dialog = dialogRef.current
    if (!dialog) return
    const focusableElements = Array.from(dialog.querySelectorAll<HTMLElement>(
      'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ))
    if (focusableElements.length === 0) return
    const first = focusableElements[0]
    const last = focusableElements[focusableElements.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  const displayCurrentPage = totalPages > 0 ? currentPage : 0
  const titleId = 'book-viewer-heading'

  return (
    <section className="book-viewer" aria-labelledby={titleId}>
      <h1 id={titleId} ref={headingRef} className="sr-only" tabIndex={-1}>{book.title}の画像一覧</h1>

      <button className="book-viewer__back" type="button" aria-label="戻る" title="戻る" onClick={navigateBack}>
        <ArrowLeft size={18} aria-hidden="true" />
      </button>

      <section ref={readerRef} className="book-viewer__reader" aria-labelledby={titleId}>
        {totalPages > 0 ? (
          <div className="book-viewer__pages" aria-label={`${totalPages}ページの画像一覧`}>
            {Array.from({ length: totalPages }, (_, index) => (
              <BookViewerPageImage
                key={`${bookIdentity}:${index + 1}`}
                book={book}
                bookIdentity={bookIdentity}
                pageNumber={index + 1}
              />
            ))}
          </div>
        ) : (
          <div className="book-viewer__empty" role="status">
            <ImageOff size={34} strokeWidth={1.4} aria-hidden="true" />
            <strong>画像を表示できません</strong>
            <span>このBookのページ数が指定されていません。</span>
          </div>
        )}
      </section>

      {showScrollTop && (
        <button className="book-viewer__scroll-top" type="button" aria-label="先頭へ戻る" title="先頭へ戻る" onClick={scrollToTop}>
          <ArrowUp size={18} aria-hidden="true" />
        </button>
      )}

      <aside className="book-viewer__dock" aria-label="Book操作">
        <div className="book-viewer__dock-inner">
          <div className="book-viewer__dock-title" title={book.title}>{book.title}</div>
          <span className="book-viewer__progress" aria-label={`現在${displayCurrentPage}ページ、全${totalPages}ページ`}>
            {displayCurrentPage} / {totalPages}
          </span>
          <button
            ref={expandButtonRef}
            className="book-viewer__expand"
            type="button"
            aria-haspopup="dialog"
            aria-expanded={detailsOpen}
            aria-controls="book-viewer-details"
            aria-label="情報パネルを展開"
            title="展開"
            onClick={() => setDetailsOpen(true)}
          >
            <ChevronUp size={20} aria-hidden="true" />
          </button>
        </div>
      </aside>

      <dialog
        ref={dialogRef}
        id="book-viewer-details"
        className="book-viewer__details-dialog"
        aria-labelledby="book-viewer-details-title"
        onCancel={(event) => {
          event.preventDefault()
          closeDetails()
        }}
        onKeyDown={handleDetailsKeyDown}
        onPointerDown={(event) => {
          const panel = detailsPanelRef.current
          if (!panel) return
          const rect = panel.getBoundingClientRect()
          pointerStartedOutsideRef.current = event.clientX < rect.left
            || event.clientX > rect.right
            || event.clientY < rect.top
            || event.clientY > rect.bottom
        }}
        onClick={(event) => {
          if (event.target === event.currentTarget && pointerStartedOutsideRef.current) closeDetails()
          pointerStartedOutsideRef.current = false
        }}
        onClose={() => {
          setDetailsOpen(false)
          window.requestAnimationFrame(() => expandButtonRef.current?.focus())
        }}
      >
        <div ref={detailsPanelRef} className="book-viewer__details-panel">
          <header className="book-viewer__details-header">
            <div>
              <h2 id="book-viewer-details-title">{book.title}</h2>
            </div>
            <button className="book-viewer__shrink" type="button" data-details-initial-focus aria-label="情報パネルを縮小" title="縮小" onClick={closeDetails}>
              <ChevronDown size={20} aria-hidden="true" />
            </button>
          </header>

          <div className="book-viewer__details-body">
            <div className="book-viewer__details-meta" aria-label="Bookのメタデータ">
              <div className="book-viewer__details-meta-group book-viewer__details-meta-group--left">
                <span className="book-viewer__meta-chip book-viewer__meta-chip--source">{book.source}</span>
                <BookStatusBadge status={book.status} variant="inline" />
              </div>
              <div className="book-viewer__details-meta-group book-viewer__details-meta-group--right">
                <span className="book-viewer__meta-chip book-viewer__meta-chip--page">Page: {totalPages}</span>
                <time className="book-viewer__meta-chip book-viewer__meta-chip--date" dateTime={book.uploadedTime}>
                  {formatUploadDate(book.uploadedTime)}
                </time>
              </div>
            </div>

            <div className="book-viewer__tag-groups">
              {tagGroups.map(({ type, tags }) => (
                <section className="book-viewer__tag-group" key={type} aria-labelledby={`book-viewer-tag-group-${type}`}>
                  <div className="book-viewer__tag-group-heading">
                    <h3 id={`book-viewer-tag-group-${type}`}>{TAG_TYPE_LABELS[type]}</h3>
                    <span>{tags.length}</span>
                  </div>
                  <div className="book-viewer__tag-chips">
                    {tags.map((tag) => (
                      <TagChip
                        key={`${tag.type}:${tag.name}:${tag.displayName ?? ''}`}
                        tag={tag}
                        size="default"
                        title={getTagChipTitle(tag)}
                        onClick={() => {
                          closeDetails()
                          onTagSearch(tag)
                        }}
                      />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          </div>
        </div>
      </dialog>
    </section>
  )
}

function BookViewerPageImage({
  book,
  bookIdentity,
  pageNumber,
}: {
  book: BookCardModel
  bookIdentity: string
  pageNumber: number
}) {
  const [phase, setPhase] = useState<PagePhase>('loading')
  const [retryCount, setRetryCount] = useState(0)
  const pageUrl = useMemo(() => createNeutralPageUrl(bookIdentity, pageNumber), [bookIdentity, pageNumber])

  useEffect(() => {
    let active = true
    const delay = MOCK_DELAY_BY_PAGE.get(pageNumber) ?? 0
    const timer = window.setTimeout(() => {
      if (!active) return
      if (pageNumber === MOCK_FAILURE_PAGE && retryCount === 0) {
        setPhase('error')
      } else {
        setPhase('loaded')
      }
    }, delay)

    return () => {
      active = false
      window.clearTimeout(timer)
    }
  }, [pageNumber, retryCount, pageUrl])

  const retryPage = () => {
    setPhase('loading')
    setRetryCount((current) => current + 1)
  }

  return (
    <figure
      className={`book-viewer__page book-viewer__page--${phase}`}
      data-page-number={pageNumber}
      aria-busy={phase === 'loading' ? true : undefined}
    >
      <div className="book-viewer__page-frame">
        {phase === 'loading' && <span className="book-viewer__page-skeleton" aria-hidden="true" />}
        {phase === 'loaded' && (
          <img
            src={pageUrl}
            alt={`${book.title}の${pageNumber}ページ目`}
            width={MOCK_PAGE_WIDTH}
            height={MOCK_PAGE_HEIGHT}
            loading="lazy"
            decoding="async"
            onLoad={() => setPhase('loaded')}
            onError={() => setPhase('error')}
          />
        )}
        {phase === 'error' && (
          <div className="book-viewer__page-error" role="alert">
            <ImageOff size={27} strokeWidth={1.5} aria-hidden="true" />
            <span>このページを読み込めませんでした</span>
            <button type="button" onClick={retryPage}>
              <RotateCcw size={14} aria-hidden="true" />
              再試行
            </button>
          </div>
        )}
      </div>
    </figure>
  )
}

export { BookViewerPage }
