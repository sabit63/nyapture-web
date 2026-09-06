import { ImageOff, RotateCcw } from 'lucide-react'
import { memo, useCallback, useSyncExternalStore } from 'react'
import type { SyntheticEvent } from 'react'

import { INITIAL_BOOK_PAGE_SNAPSHOT, type BookPageLoader } from './book-page-loading'
import './book-viewer.css'

const PAGE_WIDTH = 1000
const PAGE_HEIGHT = 1400

export const BookPageImage = memo(function BookPageImage({
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
    snapshot.phase === 'queued'
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
