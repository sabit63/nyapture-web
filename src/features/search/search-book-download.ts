import type { BookCardModel } from '../../models'
import { ApiError } from '../../api/client'

export type SearchBookIdentity = Pick<BookCardModel, 'groupId' | 'bookId' | 'url'>

export type SearchBookSelectionState<T> = {
  books: readonly T[]
  selected: readonly string[]
}

const identityKey = (book: SearchBookIdentity) => `${book.groupId}\u0000${book.bookId}`

const normalizedUrl = (book: SearchBookIdentity) => book.url.trim()

const uniqueIndex = <T>(items: readonly T[], predicate: (item: T) => boolean) => {
  const matches = items.reduce<number[]>((indexes, item, index) => (
    predicate(item) ? [...indexes, index] : indexes
  ), [])
  return matches.length === 1 ? matches[0] : -1
}

/**
 * Locate a web-search card across a detail refresh. The original identity is
 * preferred, while the refreshed identity handles servers that fill in IDs.
 * URL matching is only used when it identifies exactly one card.
 */
export const findSearchBookIndex = <T extends SearchBookIdentity>(
  books: readonly T[],
  original: SearchBookIdentity,
  refreshed?: SearchBookIdentity,
) => {
  const identities = refreshed ? [original, refreshed] : [original]
  for (const identity of identities) {
    const index = uniqueIndex(books, (book) => identityKey(book) === identityKey(identity))
    if (index >= 0) return index
  }

  const urls = identities.map(normalizedUrl).filter(Boolean)
  for (const url of urls) {
    const index = uniqueIndex(books, (book) => normalizedUrl(book) === url)
    if (index >= 0) return index
  }

  return -1
}

export const replaceSearchBookByIdentity = <T extends SearchBookIdentity>(
  books: readonly T[],
  original: SearchBookIdentity,
  refreshed: T,
) => {
  const index = findSearchBookIndex(books, original, refreshed)
  if (index < 0) return [...books]
  if (books.some((book, currentIndex) => currentIndex !== index && identityKey(book) === identityKey(refreshed))) {
    throw new ApiError('再取得したBookのIDが別の検索結果と重複しています。元のBookを保持しました。', { category: 'validation' })
  }
  return books.map((book, currentIndex) => currentIndex === index ? refreshed : book)
}

/** Replace a card and remap its selection key as one state transition. */
export const replaceSearchBookAndSelection = <T extends SearchBookIdentity>(
  state: SearchBookSelectionState<T>,
  original: SearchBookIdentity,
  refreshed: T,
): SearchBookSelectionState<T> => {
  const index = findSearchBookIndex(state.books, original, refreshed)
  if (index < 0) return { books: [...state.books], selected: [...state.selected] }

  const current = state.books[index]
  const sourceKeys = new Set([identityKey(original), identityKey(current)])
  const refreshedKey = identityKey(refreshed)
  const selected = [...new Set(state.selected.map((key) => sourceKeys.has(key) ? refreshedKey : key))]
  return {
    books: replaceSearchBookByIdentity(state.books, original, refreshed),
    selected,
  }
}

/** Apply multiple replacements while preserving selection remapping atomically. */
export const replaceSearchBooksAndSelection = <T extends SearchBookIdentity>(
  state: SearchBookSelectionState<T>,
  replacements: readonly { original: SearchBookIdentity; refreshed: T }[],
): SearchBookSelectionState<T> => replacements.reduce<SearchBookSelectionState<T>>(
  (current, replacement) => replaceSearchBookAndSelection(current, replacement.original, replacement.refreshed),
  { books: [...state.books], selected: [...state.selected] },
)
