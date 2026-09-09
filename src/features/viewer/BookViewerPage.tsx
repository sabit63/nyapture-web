import { ViewerControlPanel } from './ViewerControlPanel'
import { ArrowUp, ImageOff, ZoomIn, ZoomOut } from 'lucide-react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { RefObject } from 'react'
import type { ApiBookCardModel } from '../../api'
import { getBookPageBlob } from '../../api'
import { useViewerGeometry } from './use-viewer-geometry'
import { BookDetailsSheet } from './BookDetailsSheet'
import { BookRecommendations } from './BookRecommendations'
import { BookPageLoader } from './book-page-loading'
import { BookPageImage } from './BookPageImage'
import type { BookCardModel, BookTag } from '../../models'
import { InternalLink } from '../../app/client-router'
import { Button, buttonClassName } from '../../components/ui/Button'
import { IconButton } from '../../components/ui/IconButton'

type BookViewerRouteState = 'missing' | 'loading' | 'notFound' | 'error' | 'ready'

export type BookViewerPageProps = {
  routeState: BookViewerRouteState
  routeIdentity: string
  book?: BookCardModel
  errorMessage?: string
  onRetry?: () => void
  onBookChange: (book: ApiBookCardModel) => void
  onTitleChange: (groupId: string, bookId: string, title: string) => void
  getTagSearchHref: (tag: BookTag) => string
  onTagSearch: (tag: BookTag) => void
  onTagSearchDestinationRequest: (tag: BookTag, trigger: HTMLButtonElement) => void
  detailsOpen: boolean
  onDetailsOpenChange: (open: boolean) => void
  detailsTriggerRef: RefObject<HTMLButtonElement | null>
}

const READER_BASE_WIDTH = 760
const MAX_PAGE_COUNT = 10_000
const VIEWER_ZOOM_LEVELS = [50, 75, 100, 125, 150] as const
const DEFAULT_VIEWER_ZOOM_INDEX = VIEWER_ZOOM_LEVELS.indexOf(100)

const isValidTotalPage = (value: number) =>
  Number.isInteger(value) && value > 0 && value <= MAX_PAGE_COUNT

const getBookIdentity = (book: Pick<BookCardModel, 'groupId' | 'bookId'>) =>
  `${book.groupId}\u0000${book.bookId}`

function BookViewerPage({
  routeState,
  routeIdentity,
  book,
  errorMessage,
  onRetry,
  onBookChange,
  onTitleChange,
  getTagSearchHref,
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
        getTagSearchHref={getTagSearchHref}
        onBookChange={onBookChange}
        onTitleChange={onTitleChange}
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
      <section
        className="book-viewer book-viewer--route-loading"
        aria-busy="true"
        aria-labelledby="book-viewer-route-title"
      >
        <h1 id="book-viewer-route-title" ref={headingRef} className="sr-only" tabIndex={-1}>
          Bookビューア
        </h1>
        <p className="sr-only" role="status" aria-live="polite">
          Bookビューアのページを準備しています
        </p>
        <div className="book-viewer__reader" aria-hidden="true">
          <div className="book-viewer__pages">
            {Array.from({ length: 3 }, (_, index) => (
              <div
                className="book-viewer__page book-viewer__page--loading"
                key={`book-viewer-loading-page-${index + 1}`}
              >
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
    <section
      className="book-viewer book-viewer--route-error"
      aria-labelledby="book-viewer-route-title"
    >
      <h1 id="book-viewer-route-title" ref={headingRef} tabIndex={-1}>
        {isMissing
          ? 'Bookの指定が必要です'
          : isError
            ? 'Bookを読み込めません'
            : 'Bookが見つかりません'}
      </h1>
      <p>
        {isMissing
          ? 'id と gid を指定すると、Bookの画像一覧を表示できます。'
          : isError
            ? (errorMessage ?? 'APIへの接続を確認して、もう一度お試しください。')
            : '指定されたBookはライブラリまたは検索結果にありません。'}
      </p>
      {isError && onRetry && (
        <Button variant="solid" tone="accent" onClick={onRetry}>
          再試行
        </Button>
      )}
      <InternalLink
        className={buttonClassName({ variant: 'outline', tone: 'neutral' })}
        href="/search"
      >
        検索へ戻る
      </InternalLink>
    </section>
  )
}

function BookViewerReady({
  book,
  headingRef,
  onBookChange,
  onTitleChange,
  getTagSearchHref,
  onTagSearch,
  onTagSearchDestinationRequest,
  detailsOpen,
  onDetailsOpenChange,
  detailsTriggerRef,
}: {
  book: BookCardModel
  headingRef: RefObject<HTMLHeadingElement | null>
  onBookChange: (book: ApiBookCardModel) => void
  onTitleChange: (groupId: string, bookId: string, title: string) => void
  getTagSearchHref: (tag: BookTag) => string
  onTagSearch: (tag: BookTag) => void
  onTagSearchDestinationRequest: (tag: BookTag, trigger: HTMLButtonElement) => void
  detailsOpen: boolean
  onDetailsOpenChange: (open: boolean) => void
  detailsTriggerRef: RefObject<HTMLButtonElement | null>
}) {
  const bookIdentity = useMemo(() => getBookIdentity(book), [book])
  const totalPages = isValidTotalPage(book.totalPage) ? book.totalPage : 0
  const [zoomIndex, setZoomIndex] = useState(DEFAULT_VIEWER_ZOOM_INDEX)
  const zoomAnchorRef = useRef<{ pageNumber: number; ratio: number; viewportY: number } | null>(null)
  const pageLoader = useMemo(
    () =>
      new BookPageLoader({
        totalPages,
        loadPage: (pageNumber, width, signal) =>
          getBookPageBlob(
            {
              groupId: book.groupId,
              bookId: book.bookId,
              page: pageNumber,
              width,
              format: 'webp',
              fallbackToOriginal: false,
            },
            signal,
          ),
      }),
    [book.bookId, book.groupId, totalPages],
  )

  useEffect(() => pageLoader.attach(), [pageLoader])

  const { readerRef, currentPage, showScrollTop } = useViewerGeometry(
    bookIdentity,
    totalPages,
    pageLoader,
  )
  const zoomPercent = VIEWER_ZOOM_LEVELS[zoomIndex]
  const canZoomOut = zoomIndex > 0
  const canZoomIn = zoomIndex < VIEWER_ZOOM_LEVELS.length - 1

  useLayoutEffect(() => {
    const anchor = zoomAnchorRef.current
    zoomAnchorRef.current = null
    if (!anchor) return
    const page = readerRef.current?.querySelector<HTMLElement>(`[data-page-number="${anchor.pageNumber}"]`)
    if (!page) return
    const rect = page.getBoundingClientRect()
    const anchorY = rect.top + rect.height * anchor.ratio
    window.scrollBy({ top: anchorY - anchor.viewportY, behavior: 'auto' })
  }, [readerRef, zoomIndex])

  const changeZoom = (direction: -1 | 1) => {
    const nextIndex = Math.min(Math.max(zoomIndex + direction, 0), VIEWER_ZOOM_LEVELS.length - 1)
    if (nextIndex === zoomIndex) return

    const viewportY = window.innerHeight / 2
    const page = readerRef.current?.querySelector<HTMLElement>(`[data-page-number="${currentPage}"]`)
    if (page) {
      const rect = page.getBoundingClientRect()
      zoomAnchorRef.current = {
        pageNumber: currentPage,
        ratio: rect.height > 0 ? Math.min(Math.max((viewportY - rect.top) / rect.height, 0), 1) : 0,
        viewportY,
      }
    }
    setZoomIndex(nextIndex)
  }

  const scrollToTop = () => {
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' })
  }

  const titleId = 'book-viewer-heading'
  const renderedPages = useMemo(
    () =>
      Array.from({ length: totalPages }, (_, index) => (
        <BookPageImage
          key={`${bookIdentity}:${index + 1}`}
          bookTitle={book.title}
          pageLoader={pageLoader}
          pageNumber={index + 1}
        />
      )),
    [book.title, bookIdentity, pageLoader, totalPages],
  )

  return (
    <section className="book-viewer" aria-labelledby={titleId}>
      <h1 id={titleId} ref={headingRef} className="sr-only" tabIndex={-1}>
        {book.title}の画像一覧
      </h1>

      <section
        ref={readerRef}
        className="book-viewer__reader"
        aria-labelledby={titleId}
        style={{
          width: `${zoomPercent}%`,
          maxWidth: `${READER_BASE_WIDTH * zoomPercent / 100}px`,
        }}
      >
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
      <ViewerControlPanel>
      {totalPages > 0 && (
        <>
          <div className="book-viewer__zoom-controls" role="group" aria-label="画像の表示倍率">
            <IconButton
              className="book-viewer__floating-control"
              variant="ghost"
              tone="neutral"
              aria-label={`拡大（現在${zoomPercent}%）`}
              disabled={!canZoomIn}
              onClick={() => changeZoom(1)}
            >
              <ZoomIn size={18} aria-hidden="true" />
            </IconButton>
            <IconButton
              className="book-viewer__floating-control"
              variant="ghost"
              tone="neutral"
              aria-label={`縮小（現在${zoomPercent}%）`}
              disabled={!canZoomOut}
              onClick={() => changeZoom(-1)}
            >
              <ZoomOut size={18} aria-hidden="true" />
            </IconButton>
            <span className="sr-only" aria-live="polite">表示倍率{zoomPercent}%</span>
          </div>
        </>
      )}

      <BookRecommendations key={bookIdentity} book={book} getTagSearchHref={getTagSearchHref} onTagSearch={onTagSearch} />
      </ViewerControlPanel>

      {showScrollTop && (
        <div className="book-viewer__control-panel book-viewer__scroll-top-panel">
        <IconButton
          className="book-viewer__floating-control"
          variant="ghost"
          tone="neutral"
          aria-label="先頭へ戻る"
          onClick={scrollToTop}
        >
          <ArrowUp size={18} aria-hidden="true" />
        </IconButton>
        </div>
      )}

      <BookDetailsSheet
        key={bookIdentity}
        book={book}
        totalPages={totalPages}
        onBookChange={onBookChange}
        onTitleChange={onTitleChange}
        onTagSearch={onTagSearch}
        onTagSearchDestinationRequest={onTagSearchDestinationRequest}
        detailsOpen={detailsOpen}
        onDetailsOpenChange={onDetailsOpenChange}
        detailsTriggerRef={detailsTriggerRef}
      />
    </section>
  )
}

export { BookViewerPage }
