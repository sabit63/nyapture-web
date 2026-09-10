import { memo } from 'react'
import type { ApiBookCardModel } from '../../api'
import { BookCard } from '../../components/BookCard'
import { BookGrid } from '../../components/BookGrid'
import { getBookIdentityKey } from '../library/book-deletion'
import { isDownloadCandidate } from './download-candidate'
import { isReadableBook } from './search-continuous-utils'
import type { SearchController } from './useSearchController'

type Props = Pick<SearchController,
  'visibleBooks'
  | 'displaySettings'
  | 'pendingDeletionKeys'
  | 'isWebSearch'
  | 'selectMode'
  | 'selected'
  | 'toggleSelection'
  | 'searchByTag'
  | 'openTagSearchDestination'
  | 'openWebBookDetail'
  | 'enterContinuousView'
  | 'getContinuousViewHref'
  | 'deleteLibraryBook'
  | 'refreshWebBook'
  | 'downloadWebBook'> & {
  isSearchLoading: boolean
  onDetailsRequest: (book: ApiBookCardModel, trigger: HTMLButtonElement) => void
}

// Keep overlay state updates from rendering every search result and thumbnail.
export const SearchResultsGrid = memo(function SearchResultsGrid({
  visibleBooks,
  displaySettings,
  pendingDeletionKeys,
  isWebSearch,
  selectMode,
  selected,
  toggleSelection,
  searchByTag,
  openTagSearchDestination,
  openWebBookDetail,
  enterContinuousView,
  getContinuousViewHref,
  deleteLibraryBook,
  refreshWebBook,
  downloadWebBook,
  isSearchLoading,
  onDetailsRequest,
}: Props) {
  return (
    <BookGrid
      settings={displaySettings}
      aria-busy={isSearchLoading}
      inert={isSearchLoading ? true : undefined}
    >
      {visibleBooks.map((book) => {
        const bookKey = getBookIdentityKey(book)
        const deletionPending = pendingDeletionKeys.has(bookKey)
        const canStartContinuous = !isWebSearch && !selectMode && isReadableBook(book)
        return (
          <BookCard
            key={bookKey}
            book={book}
            selectMode={selectMode}
            selected={selected.includes(bookKey)}
            onToggle={() => toggleSelection(bookKey)}
            actionsDisabled={deletionPending}
            onTagSearch={searchByTag}
            onTagSearchDestinationRequest={openTagSearchDestination}
            onTagOverflowDetails={(trigger) => onDetailsRequest(book, trigger)}
            isDownloadCandidate={isWebSearch && isDownloadCandidate(book)}
            onOpen={isWebSearch && !selectMode && !(book.apiGroupId?.trim() && book.apiBookId?.trim())
              ? (trigger) => openWebBookDetail(book, trigger)
              : undefined}
            onCoverOpen={canStartContinuous ? () => enterContinuousView(book) : undefined}
            coverHref={canStartContinuous ? getContinuousViewHref(book) : undefined}
            coverOpenAriaLabel={canStartContinuous ? `${book.title}から連続閲覧` : undefined}
            onDelete={(trigger) => deleteLibraryBook(book, trigger)}
            onRefresh={() => refreshWebBook(book)}
            onDownload={() => downloadWebBook(book)}
          />
        )
      })}
    </BookGrid>
  )
})
