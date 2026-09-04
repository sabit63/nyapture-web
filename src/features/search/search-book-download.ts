import type { BookCardModel } from '../../models'

export type SearchBookIdentity = Pick<BookCardModel, 'groupId' | 'bookId' | 'url'>

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
  return books.map((book, currentIndex) => currentIndex === index ? refreshed : book)
}
