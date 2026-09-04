import {
  ArrowUp,
  ChevronDown,
  ImageOff,
  RotateCcw,
} from 'lucide-react'
import { memo, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, RefObject, SyntheticEvent } from 'react'
import { getBookPageBlob } from '../api'
import {
  BookPageLoader,
  getBookPageRequestWidth,
  INITIAL_BOOK_PAGE_SNAPSHOT,
} from '../features/viewer/book-page-loading'
import type { BookCardModel, BookTag, NyaTagType } from '../models'
import { getTagLabel, TAG_TYPE_LABELS, TAG_TYPE_ORDER } from '../models'
import { BookStatusBadge } from './BookStatusBadge'
import { TagChip } from './TagChip'
import { Button, buttonClassName } from './ui/Button'
import { IconButton } from './ui/IconButton'
import './book-viewer.css'

type BookViewerRouteState = 'missing' | 'loading' | 'notFound' | 'error' | 'ready'

export type BookViewerPageProps = {
  routeState: BookViewerRouteState
  routeIdentity: string
  book?: BookCardModel
  errorMessage?: string
  onRetry?: () => void
  onTagSearch: (tag: BookTag) => void
  onTagSearchDestinationRequest: (tag: BookTag, trigger: HTMLButtonElement) => void
  detailsOpen: boolean
  onDetailsOpenChange: (open: boolean) => void
  detailsTriggerRef: RefObject<HTMLButtonElement | null>
}

const PAGE_WIDTH = 1000
const PAGE_HEIGHT = 1400
const MAX_PAGE_COUNT = 10_000

const isValidTotalPage = (value: number) => Number.isInteger(value) && value > 0 && value <= MAX_PAGE_COUNT

const getBookIdentity = (book: Pick<BookCardModel, 'groupId' | 'bookId'>) => `${book.groupId}\u0000${book.bookId}`

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

function BookViewerPage({
  routeState,
  routeIdentity,
  book,
  errorMessage,
  onRetry,
  onTagSearch,
  onTagSearchDestinationRequest,
  detailsOpen,
  onDetailsOpenChange,
  detailsTriggerRef,
}: BookViewerPageProps) {
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
    return (
      <BookViewerReady
        book={book}
        headingRef={headingRef}
        onTagSearch={onTagSearch}
        onTagSearchDestinationRequest={onTagSearchDestinationRequest}
        detailsOpen={detailsOpen}
        onDetailsOpenChange={onDetailsOpenChange}
        detailsTriggerRef={detailsTriggerRef}
      />
    )
  }

  if (routeState === 'loading') {
    return (
      <section className="book-viewer book-viewer--route-loading" aria-busy="true" aria-labelledby="book-viewer-route-title">
        <h1 id="book-viewer-route-title" ref={headingRef} className="sr-only" tabIndex={-1}>Bookビューア</h1>
        <p className="sr-only" role="status" aria-live="polite">Bookビューアのページを準備しています</p>
        <div className="book-viewer__reader" aria-hidden="true">
          <div className="book-viewer__pages">
            {Array.from({ length: 3 }, (_, index) => (
              <div className="book-viewer__page book-viewer__page--loading" key={`book-viewer-loading-page-${index + 1}`}>
                <div className="book-viewer__page-frame">
                  <span className="book-viewer__page-skeleton" aria-hidden="true" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    )
  }

  const isMissing = routeState === 'missing'
  const isError = routeState === 'error'
  return (
    <section className="book-viewer book-viewer--route-error" aria-labelledby="book-viewer-route-title">
      <h1 id="book-viewer-route-title" ref={headingRef} tabIndex={-1}>
        {isMissing ? 'Bookの指定が必要です' : isError ? 'Bookを読み込めません' : 'Bookが見つかりません'}
      </h1>
      <p>
        {isMissing
          ? 'id と gid を指定すると、Bookの画像一覧を表示できます。'
          : isError
            ? errorMessage ?? 'APIへの接続を確認して、もう一度お試しください。'
            : '指定されたBookはライブラリまたは検索結果にありません。'}
      </p>
      {isError && onRetry && <Button variant="solid" tone="accent" onClick={onRetry}>再試行</Button>}
      <a className={buttonClassName({ variant: 'outline', tone: 'neutral' })} href="/search">検索へ戻る</a>
    </section>
  )
}

function BookViewerReady({
  book,
  headingRef,
  onTagSearch,
  onTagSearchDestinationRequest,
  detailsOpen,
  onDetailsOpenChange,
  detailsTriggerRef,
}: {
  book: BookCardModel
  headingRef: RefObject<HTMLHeadingElement | null>
  onTagSearch: (tag: BookTag) => void
  onTagSearchDestinationRequest: (tag: BookTag, trigger: HTMLButtonElement) => void
  detailsOpen: boolean
  onDetailsOpenChange: (open: boolean) => void
  detailsTriggerRef: RefObject<HTMLButtonElement | null>
}) {
  const bookIdentity = useMemo(() => getBookIdentity(book), [book])
  const sourceLabel = book.sourceLabel?.trim() || undefined
  const totalPages = isValidTotalPage(book.totalPage) ? book.totalPage : 0
  const tagGroups = useMemo(() => groupBookTags(book.tags), [book.tags])
  const [currentPage, setCurrentPage] = useState(totalPages > 0 ? 1 : 0)
  const [showScrollTop, setShowScrollTop] = useState(false)
  const readerRef = useRef<HTMLElement>(null)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const detailsPanelRef = useRef<HTMLDivElement>(null)
  const pointerStartedOutsideRef = useRef(false)
  const activeEntriesRef = useRef<Map<Element, IntersectionObserverEntry>>(new Map())
  const centerEntriesRef = useRef<Map<Element, IntersectionObserverEntry>>(new Map())
  const pageLoader = useMemo(() => new BookPageLoader({
    totalPages,
    loadPage: (pageNumber, width, signal) => getBookPageBlob({
      groupId: book.groupId,
      bookId: book.bookId,
      page: pageNumber,
      width,
      format: 'webp',
      fallbackToOriginal: false,
    }, signal),
  }), [book.bookId, book.groupId, totalPages])

  useEffect(() => pageLoader.attach(), [pageLoader])

  useEffect(() => {
    setCurrentPage(totalPages > 0 ? 1 : 0)
  }, [bookIdentity, totalPages])

  useEffect(() => {
    const reader = readerRef.current
    if (!reader) return
    let frame: number | undefined
    const measure = () => {
      frame = undefined
      pageLoader.setRequestWidth(getBookPageRequestWidth(
        reader.getBoundingClientRect().width,
        window.devicePixelRatio,
      ))
    }
    const scheduleMeasure = () => {
      if (frame !== undefined) return
      frame = window.requestAnimationFrame(measure)
    }
    measure()
    const observer = typeof ResizeObserver === 'undefined'
      ? undefined
      : new ResizeObserver(scheduleMeasure)
    observer?.observe(reader)
    window.addEventListener('resize', scheduleMeasure, { passive: true })
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', scheduleMeasure)
      if (frame !== undefined) window.cancelAnimationFrame(frame)
    }
  }, [pageLoader])

  useEffect(() => {
    const updateScrollTopVisibility = () => setShowScrollTop(window.scrollY > 420)
    updateScrollTopVisibility()
    window.addEventListener('scroll', updateScrollTopVisibility, { passive: true })
    return () => window.removeEventListener('scroll', updateScrollTopVisibility)
  }, [])

  useEffect(() => {
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
      if (pageNumber > 0 && activeEntries.has(candidate.target)) {
        setCurrentPage(pageNumber)
        pageLoader.setCurrentPage(pageNumber)
      }
    }

    const activeObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        const pageNumber = getPageNumber(entry.target)
        if (entry.isIntersecting) activeEntries.set(entry.target, entry)
        else activeEntries.delete(entry.target)
        if (pageNumber > 0) pageLoader.setVisible(pageNumber, entry.isIntersecting)
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
  }, [bookIdentity, pageLoader, totalPages])

  useEffect(() => {
    const reader = readerRef.current
    if (!reader || totalPages === 0 || typeof IntersectionObserver === 'undefined') return
    const pageElements = Array.from(reader.querySelectorAll<HTMLElement>('[data-page-number]'))
    let loadObserver: IntersectionObserver | undefined
    let retentionObserver: IntersectionObserver | undefined
    let frame: number | undefined
    let observedViewportHeight = 0

    const observeRanges = () => {
      frame = undefined
      const viewportHeight = Math.max(1, Math.round(window.innerHeight))
      if (viewportHeight === observedViewportHeight && loadObserver && retentionObserver) return
      observedViewportHeight = viewportHeight
      loadObserver?.disconnect()
      retentionObserver?.disconnect()
      loadObserver = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          const pageNumber = getPageNumber(entry.target)
          if (pageNumber > 0) pageLoader.setLoadRange(pageNumber, entry.isIntersecting)
        })
      }, { rootMargin: `${viewportHeight * 2}px 0px`, threshold: 0 })
      retentionObserver = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          const pageNumber = getPageNumber(entry.target)
          if (pageNumber > 0) pageLoader.setRetentionRange(pageNumber, entry.isIntersecting)
        })
      }, { rootMargin: `${viewportHeight * 3}px 0px`, threshold: 0 })
      pageElements.forEach((pageElement) => {
        loadObserver?.observe(pageElement)
        retentionObserver?.observe(pageElement)
      })
    }
    const scheduleRanges = () => {
      if (frame !== undefined) return
      frame = window.requestAnimationFrame(observeRanges)
    }

    observeRanges()
    window.addEventListener('resize', scheduleRanges, { passive: true })
    return () => {
      loadObserver?.disconnect()
      retentionObserver?.disconnect()
      window.removeEventListener('resize', scheduleRanges)
      if (frame !== undefined) window.cancelAnimationFrame(frame)
    }
  }, [bookIdentity, pageLoader, totalPages])

  useEffect(() => {
    const reader = readerRef.current
    if (!reader || totalPages === 0 || typeof IntersectionObserver !== 'undefined') return
    const pageElements = Array.from(reader.querySelectorAll<HTMLElement>('[data-page-number]'))
    type PageRange = { start: number; end: number } | null
    let visibleRange: PageRange = null
    let loadRange: PageRange = null
    let retentionRange: PageRange = null
    let frame: number | undefined

    const findRange = (margin: number): PageRange => {
      const minimum = -margin
      const maximum = window.innerHeight + margin
      let low = 0
      let high = pageElements.length
      while (low < high) {
        const middle = Math.floor((low + high) / 2)
        if (pageElements[middle].getBoundingClientRect().bottom < minimum) low = middle + 1
        else high = middle
      }
      const start = low
      low = start
      high = pageElements.length
      while (low < high) {
        const middle = Math.floor((low + high) / 2)
        if (pageElements[middle].getBoundingClientRect().top <= maximum) low = middle + 1
        else high = middle
      }
      const end = low - 1
      return start <= end && start < pageElements.length
        ? { start: start + 1, end: end + 1 }
        : null
    }

    const updateRange = (
      previous: PageRange,
      next: PageRange,
      update: (pageNumber: number, inRange: boolean) => void,
    ) => {
      if (previous) {
        for (let pageNumber = previous.start; pageNumber <= previous.end; pageNumber += 1) {
          if (!next || pageNumber < next.start || pageNumber > next.end) update(pageNumber, false)
        }
      }
      if (next) {
        for (let pageNumber = next.start; pageNumber <= next.end; pageNumber += 1) {
          if (!previous || pageNumber < previous.start || pageNumber > previous.end) update(pageNumber, true)
        }
      }
    }

    const updateFallbackRanges = () => {
      frame = undefined
      const viewportHeight = Math.max(1, window.innerHeight)
      const nextVisibleRange = findRange(0)
      const nextLoadRange = findRange(viewportHeight * 2)
      const nextRetentionRange = findRange(viewportHeight * 3)
      updateRange(visibleRange, nextVisibleRange, (pageNumber, inRange) => pageLoader.setVisible(pageNumber, inRange))
      updateRange(loadRange, nextLoadRange, (pageNumber, inRange) => pageLoader.setLoadRange(pageNumber, inRange))
      updateRange(retentionRange, nextRetentionRange, (pageNumber, inRange) => pageLoader.setRetentionRange(pageNumber, inRange))
      visibleRange = nextVisibleRange
      loadRange = nextLoadRange
      retentionRange = nextRetentionRange

      const currentCandidates = nextVisibleRange ?? nextLoadRange
      if (currentCandidates) {
        const viewportCenter = window.innerHeight / 2
        let nextCurrentPage = currentCandidates.start
        let closestDistance = Number.POSITIVE_INFINITY
        for (let pageNumber = currentCandidates.start; pageNumber <= currentCandidates.end; pageNumber += 1) {
          const rect = pageElements[pageNumber - 1].getBoundingClientRect()
          const distance = Math.abs((rect.top + rect.bottom) / 2 - viewportCenter)
          if (distance < closestDistance) {
            closestDistance = distance
            nextCurrentPage = pageNumber
          }
        }
        setCurrentPage(nextCurrentPage)
        pageLoader.setCurrentPage(nextCurrentPage)
      }
    }
    const scheduleFallbackRanges = () => {
      if (frame !== undefined) return
      frame = window.requestAnimationFrame(updateFallbackRanges)
    }

    const unsubscribeGeometry = pageLoader.subscribeGeometry(scheduleFallbackRanges)
    window.addEventListener('scroll', scheduleFallbackRanges, { passive: true })
    window.addEventListener('resize', scheduleFallbackRanges, { passive: true })
    updateFallbackRanges()
    return () => {
      unsubscribeGeometry()
      window.removeEventListener('scroll', scheduleFallbackRanges)
      window.removeEventListener('resize', scheduleFallbackRanges)
      if (frame !== undefined) window.cancelAnimationFrame(frame)
      updateRange(visibleRange, null, (pageNumber, inRange) => pageLoader.setVisible(pageNumber, inRange))
      updateRange(loadRange, null, (pageNumber, inRange) => pageLoader.setLoadRange(pageNumber, inRange))
      updateRange(retentionRange, null, (pageNumber, inRange) => pageLoader.setRetentionRange(pageNumber, inRange))
    }
  }, [bookIdentity, pageLoader, totalPages])

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
    else onDetailsOpenChange(false)
  }, [onDetailsOpenChange])

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

  const titleId = 'book-viewer-heading'
  const renderedPages = useMemo(() => Array.from({ length: totalPages }, (_, index) => (
    <BookViewerPageImage
      key={`${bookIdentity}:${index + 1}`}
      bookTitle={book.title}
      pageLoader={pageLoader}
      pageNumber={index + 1}
    />
  )), [book.title, bookIdentity, pageLoader, totalPages])

  return (
    <section className="book-viewer" aria-labelledby={titleId}>
      <h1 id={titleId} ref={headingRef} className="sr-only" tabIndex={-1}>{book.title}の画像一覧</h1>

      <section ref={readerRef} className="book-viewer__reader" aria-labelledby={titleId}>
        {totalPages > 0 ? (
          <div className="book-viewer__pages" aria-label={`${totalPages}ページの画像一覧`}>
            {renderedPages}
          </div>
        ) : (
          <div className="book-viewer__empty" role="status">
            <ImageOff size={34} strokeWidth={1.4} aria-hidden="true" />
            <strong>画像を表示できません</strong>
            <span>このBookのページ数が指定されていません。</span>
          </div>
        )}
      </section>

      {totalPages > 0 && (
        <div
          className="book-viewer__page-indicator"
          role="img"
          aria-label={`現在${currentPage}ページ、全${totalPages}ページ`}
        >
          {currentPage} / {totalPages}
        </div>
      )}

      {showScrollTop && (
        <IconButton
          className="book-viewer__scroll-top book-viewer__scroll-top--control"
          variant="ghost"
          tone="neutral"
          aria-label="先頭へ戻る"
          onClick={scrollToTop}
        >
          <ArrowUp size={18} aria-hidden="true" />
        </IconButton>
      )}

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
          onDetailsOpenChange(false)
          window.requestAnimationFrame(() => detailsTriggerRef.current?.focus())
        }}
      >
        <div ref={detailsPanelRef} className="book-viewer__details-panel">
          <header className="book-viewer__details-header">
            <div>
              <h2 id="book-viewer-details-title">{book.title}</h2>
            </div>
            <button className="book-viewer__shrink" type="button" data-details-initial-focus aria-label="情報パネルを縮小" onClick={closeDetails}>
              <ChevronDown size={20} aria-hidden="true" />
            </button>
          </header>

          <div className="book-viewer__details-body">
            <div className="book-viewer__details-meta" aria-label="Bookのメタデータ">
              <div className="book-viewer__details-meta-group book-viewer__details-meta-group--left">
                {sourceLabel && <span className="book-viewer__meta-chip book-viewer__meta-chip--source">{sourceLabel}</span>}
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
                        onSearchDestinationRequest={onTagSearchDestinationRequest}
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

const BookViewerPageImage = memo(function BookViewerPageImage({
  bookTitle,
  pageLoader,
  pageNumber,
}: {
  bookTitle: string
  pageLoader: BookPageLoader
  pageNumber: number
}) {
  const subscribe = useCallback(
    (listener: () => void) => pageLoader.subscribe(pageNumber, listener),
    [pageLoader, pageNumber],
  )
  const getSnapshot = useCallback(
    () => pageLoader.getSnapshot(pageNumber),
    [pageLoader, pageNumber],
  )
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, () => INITIAL_BOOK_PAGE_SNAPSHOT)
  const isBusy = snapshot.phase === 'queued'
    || snapshot.phase === 'loading'
    || snapshot.phase === 'decoding'
    || snapshot.phase === 'retryWaiting'
  const initialCandidateUrl = snapshot.displayedUrl ? undefined : snapshot.candidateUrl
  const upgradeCandidateUrl = snapshot.displayedUrl ? snapshot.candidateUrl : undefined
  const pageLabel = `${bookTitle}の${pageNumber}ページ目`

  const candidateLoaded = (event: SyntheticEvent<HTMLImageElement>) => {
    if (!snapshot.candidateUrl || snapshot.candidateGeneration === undefined) return
    pageLoader.candidateLoaded(
      pageNumber,
      snapshot.candidateGeneration,
      snapshot.candidateUrl,
      event.currentTarget.naturalWidth,
      event.currentTarget.naturalHeight,
    )
  }
  const candidateFailed = () => {
    if (!snapshot.candidateUrl || snapshot.candidateGeneration === undefined) return
    pageLoader.candidateFailed(pageNumber, snapshot.candidateGeneration, snapshot.candidateUrl)
  }

  return (
    <figure
      className={`book-viewer__page book-viewer__page--${snapshot.phase} ${snapshot.isUpgrading ? 'is-upgrading' : ''}`}
      data-page-number={pageNumber}
      aria-busy={isBusy ? true : undefined}
      style={{ aspectRatio: snapshot.aspectRatio }}
    >
      <div className="book-viewer__page-frame">
        {!snapshot.displayedUrl && isBusy && <span className="book-viewer__page-skeleton" aria-hidden="true" />}
        {snapshot.displayedUrl && (
          <img
            src={snapshot.displayedUrl}
            alt={pageLabel}
            width={PAGE_WIDTH}
            height={PAGE_HEIGHT}
            decoding="async"
          />
        )}
        {initialCandidateUrl && (
          <img
            src={initialCandidateUrl}
            alt={pageLabel}
            width={PAGE_WIDTH}
            height={PAGE_HEIGHT}
            decoding="async"
            onLoad={candidateLoaded}
            onError={candidateFailed}
          />
        )}
        {upgradeCandidateUrl && (
          <img
            className="book-viewer__page-image-probe"
            src={upgradeCandidateUrl}
            alt=""
            width={PAGE_WIDTH}
            height={PAGE_HEIGHT}
            decoding="async"
            aria-hidden="true"
            onLoad={candidateLoaded}
            onError={candidateFailed}
          />
        )}
        {snapshot.phase === 'error' && (
          <div className="book-viewer__page-error" aria-label={`${pageLabel}を読み込めませんでした`}>
            <ImageOff size={27} strokeWidth={1.5} aria-hidden="true" />
            <span>このページを読み込めませんでした</span>
            <button type="button" onClick={() => pageLoader.manualRetry(pageNumber)}>
              <RotateCcw size={14} aria-hidden="true" />
              再試行
            </button>
          </div>
        )}
      </div>
    </figure>
  )
})

export { BookViewerPage }
