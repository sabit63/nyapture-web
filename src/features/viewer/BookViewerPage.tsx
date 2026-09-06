import { ArrowUp, ImageOff, RotateCcw } from 'lucide-react'
import { memo, useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import type { RefObject, SyntheticEvent } from 'react'
import type { ApiBookCardModel } from '../../api'
import { getBookPageBlob } from '../../api'
import { useViewerGeometry } from './use-viewer-geometry'
import { BookDetailsSheet } from './BookDetailsSheet'
import { BookPageLoader, INITIAL_BOOK_PAGE_SNAPSHOT } from './book-page-loading'
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
  onTagSearch: (tag: BookTag) => void
  onTagSearchDestinationRequest: (tag: BookTag, trigger: HTMLButtonElement) => void
  detailsOpen: boolean
  onDetailsOpenChange: (open: boolean) => void
  detailsTriggerRef: RefObject<HTMLButtonElement | null>
}

const PAGE_WIDTH = 1000
const PAGE_HEIGHT = 1400
const MAX_PAGE_COUNT = 10_000

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
  onTagSearch: (tag: BookTag) => void
  onTagSearchDestinationRequest: (tag: BookTag, trigger: HTMLButtonElement) => void
  detailsOpen: boolean
  onDetailsOpenChange: (open: boolean) => void
  detailsTriggerRef: RefObject<HTMLButtonElement | null>
}) {
  const bookIdentity = useMemo(() => getBookIdentity(book), [book])
  const totalPages = isValidTotalPage(book.totalPage) ? book.totalPage : 0
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

  const scrollToTop = () => {
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' })
  }

  const titleId = 'book-viewer-heading'
  const renderedPages = useMemo(
    () =>
      Array.from({ length: totalPages }, (_, index) => (
        <BookViewerPageImage
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
  const isBusy =
    snapshot.phase === 'queued' ||
    snapshot.phase === 'loading' ||
    snapshot.phase === 'decoding' ||
    snapshot.phase === 'retryWaiting'
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
        {!snapshot.displayedUrl && isBusy && (
          <span className="book-viewer__page-skeleton" aria-hidden="true" />
        )}
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
          <div
            className="book-viewer__page-error"
            aria-label={`${pageLabel}を読み込めませんでした`}
          >
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
