import type { ApiBookCardModel } from '../../api'
import { navigate } from '../../app/client-router'
import { BookGrid } from '../../components/BookGrid'
import { TagChip } from '../../components/TagChip'
import { TAG_TYPE_LABELS } from '../../models'
import { getBookIdentityKey } from '../library/book-deletion'
import { SearchResultsGrid } from './SearchResultsGrid'
import { createGroupBooksUrl } from './search-utils'
import type { SearchController } from './useSearchController'

export function GroupedBookshelves({ controller, onDetailsRequest }: {
  controller: SearchController
  onDetailsRequest: (book: ApiBookCardModel, trigger: HTMLButtonElement) => void
}) {
  const books = new Map(controller.visibleBooks.map((book) => [getBookIdentityKey(book), book]))
  const loading = controller.searchState === 'loading'
  return (
    <BookGrid settings={controller.displaySettings} className="grouped-bookshelves" inert={loading || undefined}>
      {controller.searchGroups.map((group) => (
        <section className="book-shelf" key={JSON.stringify(group.value)} aria-label={group.label}>
          <SearchResultsGrid {...controller}
            selectMode={false}
            displaySettings={{ ...controller.displaySettings, autoThumbnailColumns: false, thumbnailColumns: 2 }}
            visibleBooks={group.bookKeys.flatMap((key) => { const book = books.get(key); return book ? [book] : [] })}
            allowContinuous={false}
            isSearchLoading={loading}
            onDetailsRequest={onDetailsRequest}
          />
          <header className="book-shelf__header">
            <h2>
              <TagChip size="default"
                tag={{ type: controller.groupBy, name: group.value ?? '', displayName: group.label, count: group.totalBooksCount }}
                ariaLabel={group.value === null ? `${TAG_TYPE_LABELS[controller.groupBy]}が未設定の本を検索（${group.totalBooksCount}冊）` : undefined}
                onClick={() => navigate(createGroupBooksUrl(controller.criteria, controller.groupBy, group.value))}
                onSearchDestinationRequest={group.value === null ? undefined : controller.openTagSearchDestination}
              />
            </h2>
          </header>
        </section>
      ))}
    </BookGrid>
  )
}
