import { ChevronLeft, ChevronRight, List, X, ZoomIn, ZoomOut } from 'lucide-react'
import {
  useEffect,
  useCallback,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from 'react'

import { getBookPageBlob, requestBlob, type ApiBookCardModel } from '../../api'
import { Thumbnail } from '../../components/Thumbnail'
import type { BookTag } from '../../models'
import { BookRecommendations } from '../viewer/BookRecommendations'
import { Button, Dialog, DialogBody, DialogHeader, IconButton } from '../../components/ui'
import { BookPageImage } from '../viewer/BookPageImage'
import { BookPageLoader } from '../viewer/book-page-loading'
import { useViewerGeometry } from '../viewer/use-viewer-geometry'
import {
  getContinuousReaderWindowIndices,
  resolveHorizontalSwipe,
  resolveHorizontalWheelSwipe,
  type HorizontalSwipeDirection,
} from './search-continuous-utils'
import './search-continuous-reader.css'

const READER_BASE_WIDTH = 760
const VIEWER_ZOOM_LEVELS = [50, 75, 100, 125, 150] as const
const DEFAULT_ZOOM_INDEX = VIEWER_ZOOM_LEVELS.indexOf(100)
const WHEEL_GESTURE_IDLE_MS = 180

type SearchContinuousReaderProps = {
  books: ApiBookCardModel[]
  startIndex: number
  resultPage: number
  totalResultPages: number
  isLoading: boolean
  onActiveBookChange: (book: ApiBookCardModel) => void
  onBookJump: (book: ApiBookCardModel) => void
  onResultPageChange: (page: number) => void
  onTagSearch: (tag: BookTag) => void
}

type BookProgress = {
  bookIndex: number
  page: number
}

type MeasuredSection = {
  height: number
  zoomPercent: number
}

type SwipePointerStart = {
  pointerId: number
  x: number
  y: number
}

type WheelSwipeGesture = {
  deltaX: number
  deltaY: number
  locked: boolean
}

const readableIdentity = (book: ApiBookCardModel) => `${book.apiGroupId}\u0000${book.apiBookId}`

const isSwipeControl = (target: EventTarget | null) => (
  target instanceof Element
  && Boolean(target.closest('button, a, input, select, textarea, dialog, [role="dialog"]'))
)

function ContinuousNavigatorThumbnail({ book }: { book: ApiBookCardModel }) {
  const thumbnailRequest = book.thumbnailRequest
  const loadThumbnail = useCallback((signal: AbortSignal) => {
    if (!thumbnailRequest) return Promise.reject(new Error('Thumbnail request is unavailable'))
    return requestBlob(thumbnailRequest.path, {
      query: thumbnailRequest.query,
      headers: { Accept: 'image/*' },
      signal,
    })
  }, [thumbnailRequest])

  return (
    <span className="continuous-reader__navigator-thumbnail" aria-hidden="true">
      <Thumbnail
        src={book.thumbnailUrl}
        load={thumbnailRequest ? loadThumbnail : undefined}
        reloadKey={book.thumbnailReloadKey}
        loadingPolicy={{ mode: 'page', viewports: 1 }}
        alt=""
        fallbackText=""
        retryOnError={false}
        variant={book.cover}
      />
    </span>
  )
}

export function SearchContinuousReader({
  books,
  startIndex,
  resultPage,
  totalResultPages,
  isLoading,
  onActiveBookChange,
  onBookJump,
  onResultPageChange,
  onTagSearch,
}: SearchContinuousReaderProps) {
  const [zoomIndex, setZoomIndex] = useState(DEFAULT_ZOOM_INDEX)
  const [activeProgress, setActiveProgress] = useState<BookProgress>({ bookIndex: startIndex, page: 1 })
  const [windowIndex, setWindowIndex] = useState(startIndex)
  const [revealedEnd, setRevealedEnd] = useState(startIndex)
  const [navigatorOpen, setNavigatorOpen] = useState(false)
  const sectionHeightsRef = useRef(new Map<number, MeasuredSection>())
  const swipePointerStartRef = useRef<SwipePointerStart | null>(null)
  const wheelSwipeGestureRef = useRef<WheelSwipeGesture>({ deltaX: 0, deltaY: 0, locked: false })
  const wheelGestureTimerRef = useRef<number | undefined>(undefined)
  const progressTriggerRef = useRef<HTMLButtonElement>(null)
  const navigatorCloseRef = useRef<HTMLButtonElement>(null)
  const orderKey = useMemo(() => books.map(readableIdentity).join('\u0001'), [books])
  const zoomPercent = VIEWER_ZOOM_LEVELS[zoomIndex]
  const activeBook = books[activeProgress.bookIndex] ?? books[startIndex]
  const mountedIndices = useMemo(
    () => new Set(getContinuousReaderWindowIndices(windowIndex, books.length)),
    [books.length, windowIndex],
  )

  useEffect(() => {
    setZoomIndex(DEFAULT_ZOOM_INDEX)
    setActiveProgress({ bookIndex: startIndex, page: 1 })
    setWindowIndex(startIndex)
    setRevealedEnd(startIndex)
    setNavigatorOpen(false)
    sectionHeightsRef.current.clear()
  }, [books.length, orderKey, startIndex])

  useEffect(() => () => {
    if (wheelGestureTimerRef.current !== undefined) {
      window.clearTimeout(wheelGestureTimerRef.current)
    }
  }, [])

  useEffect(() => {
    if (activeBook) onActiveBookChange(activeBook)
  }, [activeBook, onActiveBookChange])

  const setActive = (bookIndex: number, page: number) => {
    setWindowIndex(bookIndex)
    setActiveProgress((current) => current.bookIndex === bookIndex && current.page === page
      ? current
      : { bookIndex, page })
  }

  const revealNext = (bookIndex: number) => {
    setRevealedEnd((current) => bookIndex < current
      ? current
      : Math.min(books.length - 1, current + 1))
  }

  const changeZoom = (direction: -1 | 1) => {
    setZoomIndex((current) => Math.min(Math.max(current + direction, 0), VIEWER_ZOOM_LEVELS.length - 1))
  }

  const switchBook = (direction: HorizontalSwipeDirection | null) => {
    const targetIndex = direction === 'next'
      ? activeProgress.bookIndex + 1
      : direction === 'previous'
        ? activeProgress.bookIndex - 1
        : -1
    const targetBook = books[targetIndex]
    if (targetBook) onBookJump(targetBook)
  }

  const startSwipe = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (
      isLoading
      || navigatorOpen
      || !event.isPrimary
      || (event.pointerType === 'mouse' && event.button !== 0)
      || isSwipeControl(event.target)
    ) return

    swipePointerStartRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
    }
    if (event.pointerType === 'mouse') event.preventDefault()
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      // Pointer capture can be unavailable for synthetic/legacy pointer input;
      // the gesture still completes when pointerup remains inside the reader.
    }
  }

  const cancelSwipe = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (swipePointerStartRef.current?.pointerId === event.pointerId) {
      swipePointerStartRef.current = null
    }
  }

  const finishSwipe = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = swipePointerStartRef.current
    if (!start || start.pointerId !== event.pointerId) return
    swipePointerStartRef.current = null

    const direction = resolveHorizontalSwipe({
      startX: start.x,
      startY: start.y,
      endX: event.clientX,
      endY: event.clientY,
    })
    switchBook(direction)
  }

  const handleWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    if (isLoading || navigatorOpen || isSwipeControl(event.target)) return

    const multiplier = event.deltaMode === 1
      ? 16
      : event.deltaMode === 2
        ? Math.max(window.innerWidth, 1)
        : 1
    const deltaX = event.deltaX * multiplier
    const deltaY = event.deltaY * multiplier
    const gesture = wheelSwipeGestureRef.current
    gesture.deltaX += deltaX
    gesture.deltaY += deltaY

    if (Math.abs(gesture.deltaX) > Math.abs(gesture.deltaY)) event.preventDefault()
    if (wheelGestureTimerRef.current !== undefined) window.clearTimeout(wheelGestureTimerRef.current)
    wheelGestureTimerRef.current = window.setTimeout(() => {
      wheelSwipeGestureRef.current = { deltaX: 0, deltaY: 0, locked: false }
      wheelGestureTimerRef.current = undefined
    }, WHEEL_GESTURE_IDLE_MS)

    if (gesture.locked) return
    const direction = resolveHorizontalWheelSwipe(gesture.deltaX, gesture.deltaY)
    if (!direction) return
    gesture.locked = true
    switchBook(direction)
  }

  if (!activeBook) return null

  return (
    <div
      className="continuous-reader"
      aria-busy={isLoading || undefined}
      inert={isLoading ? true : undefined}
      onPointerDown={startSwipe}
      onPointerUp={finishSwipe}
      onPointerCancel={cancelSwipe}
      onWheel={handleWheel}
      onDragStart={(event) => event.preventDefault()}
    >
      <div className="continuous-reader__sections">
        {books.slice(startIndex, revealedEnd + 1).map((book, offset) => {
          const bookIndex = startIndex + offset
          const measuredSection = sectionHeightsRef.current.get(bookIndex)
          const measuredHeight = measuredSection
            ? measuredSection.height * zoomPercent / measuredSection.zoomPercent
            : undefined
          return mountedIndices.has(bookIndex) ? (
            <ContinuousBookSection
              key={readableIdentity(book)}
              book={book}
              bookIndex={bookIndex}
              bookCount={books.length}
              zoomPercent={zoomPercent}
              onActive={setActive}
              onNearEnd={revealNext}
              onMeasured={(height) => sectionHeightsRef.current.set(bookIndex, { height, zoomPercent })}
            />
          ) : (
            <ContinuousBookSpacer
              key={readableIdentity(book)}
              book={book}
              measuredHeight={measuredHeight}
              zoomPercent={zoomPercent}
              onApproach={() => setWindowIndex(bookIndex)}
            />
          )
        })}
      </div>

      {revealedEnd >= books.length - 1 && (
        <nav className="continuous-reader__result-navigation" aria-label="検索結果の前後ページ">
          <Button
            type="button"
            disabled={isLoading || resultPage <= 1}
            onClick={() => onResultPageChange(resultPage - 1)}
          >
            <ChevronLeft size={16} aria-hidden="true" />
            前の50件
          </Button>
          <span>{resultPage} / {totalResultPages}</span>
          <Button
            type="button"
            disabled={isLoading || resultPage >= totalResultPages}
            onClick={() => onResultPageChange(resultPage + 1)}
          >
            次の50件
            <ChevronRight size={16} aria-hidden="true" />
          </Button>
        </nav>
      )}

      <button
        ref={progressTriggerRef}
        type="button"
        className="continuous-reader__progress"
        aria-label={`作品一覧を開く。現在${activeProgress.bookIndex + 1}冊目、全${books.length}冊、${activeProgress.page}ページ目、全${activeBook.totalPage}ページ`}
        aria-expanded={navigatorOpen}
        onClick={() => setNavigatorOpen(true)}
      >
        <List size={14} aria-hidden="true" />
        <span>Book {activeProgress.bookIndex + 1}/{books.length}</span>
        <span>Page {activeProgress.page}/{activeBook.totalPage}</span>
      </button>

      <div className="book-viewer__zoom-controls" role="group" aria-label="画像の表示倍率">
        <IconButton
          className="book-viewer__floating-control"
          aria-label={`拡大（現在${zoomPercent}%）`}
          disabled={zoomIndex >= VIEWER_ZOOM_LEVELS.length - 1}
          onClick={() => changeZoom(1)}
        >
          <ZoomIn size={18} aria-hidden="true" />
        </IconButton>
        <IconButton
          className="book-viewer__floating-control"
          aria-label={`縮小（現在${zoomPercent}%）`}
          disabled={zoomIndex <= 0}
          onClick={() => changeZoom(-1)}
        >
          <ZoomOut size={18} aria-hidden="true" />
        </IconButton>
        <span className="sr-only" aria-live="polite">表示倍率{zoomPercent}%</span>
      </div>

      {!isLoading && <BookRecommendations
        key={readableIdentity(activeBook)}
        book={activeBook}
        onTagSearch={onTagSearch}
      />}

      <Dialog
        className="continuous-reader__navigator-dialog"
        open={navigatorOpen}
        aria-labelledby="continuous-reader-navigator-title"
        initialFocusRef={navigatorCloseRef}
        resolveRestoreFocus={() => progressTriggerRef.current}
        onRequestClose={() => {
          setNavigatorOpen(false)
          return true
        }}
      >
        {({ requestClose }) => (
          <div className="continuous-reader__navigator-panel">
            <DialogHeader className="continuous-reader__navigator-header">
              <h2 id="continuous-reader-navigator-title">作品一覧</h2>
              <IconButton
                ref={navigatorCloseRef}
                aria-label="作品一覧を閉じる"
                onClick={() => requestClose('close-button')}
              >
                <X size={19} aria-hidden="true" />
              </IconButton>
            </DialogHeader>
            <DialogBody className="continuous-reader__navigator-body">
              <ol>
                {books.map((book, index) => (
                  <li key={readableIdentity(book)}>
                    <button
                      type="button"
                      aria-current={index === activeProgress.bookIndex ? 'true' : undefined}
                      onClick={() => {
                        requestClose('submit')
                        onBookJump(book)
                      }}
                    >
                      <span className="continuous-reader__navigator-number">{index + 1}</span>
                      <ContinuousNavigatorThumbnail book={book} />
                      <strong>{book.title}</strong>
                      <small>{book.totalPage}P</small>
                    </button>
                  </li>
                ))}
              </ol>
            </DialogBody>
          </div>
        )}
      </Dialog>
    </div>
  )
}

function ContinuousBookSection({
  book,
  bookIndex,
  bookCount,
  zoomPercent,
  onActive,
  onNearEnd,
  onMeasured,
}: {
  book: ApiBookCardModel
  bookIndex: number
  bookCount: number
  zoomPercent: number
  onActive: (bookIndex: number, page: number) => void
  onNearEnd: (bookIndex: number) => void
  onMeasured: (height: number) => void
}) {
  const sectionRef = useRef<HTMLElement>(null)
  const endRef = useRef<HTMLDivElement>(null)
  const activeRef = useRef(false)
  const groupId = book.apiGroupId as string
  const bookId = book.apiBookId as string
  const identity = `${groupId}\u0000${bookId}`
  const pageLoader = useMemo(() => new BookPageLoader({
    totalPages: book.totalPage,
    maxConcurrency: 2,
    maxPipeline: 3,
    loadPage: (pageNumber, width, signal) => getBookPageBlob({
      groupId,
      bookId,
      page: pageNumber,
      width,
      format: 'webp',
      fallbackToOriginal: false,
    }, signal),
  }), [book.totalPage, bookId, groupId])
  const { readerRef, currentPage } = useViewerGeometry(identity, book.totalPage, pageLoader)

  useEffect(() => pageLoader.attach(), [pageLoader])

  useEffect(() => {
    const section = sectionRef.current
    if (!section || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver((entries) => {
      const isActive = entries.some((entry) => entry.isIntersecting)
      activeRef.current = isActive
      if (isActive) onActive(bookIndex, currentPage)
    }, { rootMargin: '-45% 0px -45% 0px', threshold: 0 })
    observer.observe(section)
    return () => observer.disconnect()
  }, [bookIndex, currentPage, onActive])

  useEffect(() => {
    if (activeRef.current) onActive(bookIndex, currentPage)
  }, [bookIndex, currentPage, onActive])

  useEffect(() => {
    const end = endRef.current
    if (!end || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) onNearEnd(bookIndex)
    }, { rootMargin: `${Math.max(1, window.innerHeight) * 2}px 0px`, threshold: 0 })
    observer.observe(end)
    return () => observer.disconnect()
  }, [bookIndex, onNearEnd])

  useEffect(() => {
    const section = sectionRef.current
    if (!section) return
    const measure = () => onMeasured(section.getBoundingClientRect().height)
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(section)
    return () => observer.disconnect()
  }, [onMeasured])

  return (
    <article
      ref={sectionRef}
      className="continuous-reader__book"
      data-continuous-book-index={bookIndex}
      aria-labelledby={`continuous-reader-book-${bookIndex}`}
    >
      <h2 id={`continuous-reader-book-${bookIndex}`} className="sr-only">
        {book.title}（{bookIndex + 1}/{bookCount}）
      </h2>
      <section
        ref={readerRef}
        className="book-viewer__reader continuous-reader__pages"
        aria-label={`${book.title}の${book.totalPage}ページの画像一覧`}
        style={{
          width: `${zoomPercent}%`,
          maxWidth: `${READER_BASE_WIDTH * zoomPercent / 100}px`,
        }}
      >
        <div className="book-viewer__pages">
          {Array.from({ length: book.totalPage }, (_, index) => (
            <BookPageImage
              key={`${identity}:${index + 1}`}
              bookTitle={book.title}
              pageLoader={pageLoader}
              pageNumber={index + 1}
            />
          ))}
        </div>
      </section>
      <div ref={endRef} className="continuous-reader__book-end" aria-hidden="true" />
    </article>
  )
}

function ContinuousBookSpacer({
  book,
  measuredHeight,
  zoomPercent,
  onApproach,
}: {
  book: ApiBookCardModel
  measuredHeight?: number
  zoomPercent: number
  onApproach: () => void
}) {
  const spacerRef = useRef<HTMLDivElement>(null)
  const viewportWidth = typeof window === 'undefined' ? READER_BASE_WIDTH : window.innerWidth - 32
  const readerWidth = Math.min(viewportWidth, READER_BASE_WIDTH * zoomPercent / 100)
  const estimatedHeight = book.totalPage * (readerWidth * 1.4 + 12)

  useEffect(() => {
    const spacer = spacerRef.current
    if (!spacer || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) onApproach()
    }, { rootMargin: '200% 0px', threshold: 0 })
    observer.observe(spacer)
    return () => observer.disconnect()
  }, [onApproach])

  return (
    <div
      ref={spacerRef}
      className="continuous-reader__book-spacer"
      style={{ height: `${Math.max(1, measuredHeight ?? estimatedHeight)}px` }}
      aria-hidden="true"
    />
  )
}
