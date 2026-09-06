import type { BookCardModel } from '../../models'

export type SearchViewMode = 'grid' | 'continuous'

export type HorizontalSwipeDirection = 'previous' | 'next'

export type SwipeCoordinates = {
  startX: number
  startY: number
  endX: number
  endY: number
}

/** API identifiers used by the `gid` and `id` continuous-view URL params. */
export type SearchContinuousIdentity = {
  groupId: string
  bookId: string
}

export type SearchViewState = {
  view: SearchViewMode
  start: SearchContinuousIdentity | null
}

export type SearchContinuousBook = Pick<
  BookCardModel,
  'status' | 'apiGroupId' | 'apiBookId' | 'totalPage'
>

export type ContinuousStartResolution<T> = {
  /** The original result order after removing books that cannot be read. */
  sequence: T[]
  /** Index within `sequence`; `-1` means that no readable book exists. */
  startIndex: number
}

const normalized = (value: string | null | undefined) => value?.trim() ?? ''

/**
 * Resolve a deliberate horizontal swipe while leaving vertical reading and
 * small pointer movements alone. A left swipe advances; a right swipe goes
 * back.
 */
export const resolveHorizontalSwipe = (
  coordinates: SwipeCoordinates,
  minimumDistance = 56,
): HorizontalSwipeDirection | null => {
  const values = Object.values(coordinates)
  if (values.some((value) => !Number.isFinite(value))) return null

  const deltaX = coordinates.endX - coordinates.startX
  const deltaY = coordinates.endY - coordinates.startY
  const horizontalDistance = Math.abs(deltaX)
  const verticalDistance = Math.abs(deltaY)
  const safeMinimumDistance = Number.isFinite(minimumDistance) ? Math.max(1, minimumDistance) : 56

  if (horizontalDistance < safeMinimumDistance || horizontalDistance <= verticalDistance * 1.25) return null
  return deltaX < 0 ? 'next' : 'previous'
}

/** Trackpad wheel deltas follow scroll direction, so positive X advances. */
export const resolveHorizontalWheelSwipe = (
  deltaX: number,
  deltaY: number,
  minimumDistance = 80,
): HorizontalSwipeDirection | null => {
  if (![deltaX, deltaY].every(Number.isFinite)) return null
  const horizontalDistance = Math.abs(deltaX)
  const verticalDistance = Math.abs(deltaY)
  const safeMinimumDistance = Number.isFinite(minimumDistance) ? Math.max(1, minimumDistance) : 80

  if (horizontalDistance < safeMinimumDistance || horizontalDistance <= verticalDistance * 1.25) return null
  return deltaX > 0 ? 'next' : 'previous'
}

const parseIdentity = (params: URLSearchParams): SearchContinuousIdentity | null => {
  const groupId = normalized(params.get('gid'))
  const bookId = normalized(params.get('id'))
  return groupId && bookId ? { groupId, bookId } : null
}

/**
 * Continuous mode is a library-only view. Unknown or non-library `view`
 * values deliberately fall back to the normal card grid.
 */
export const parseSearchViewMode = (
  params: URLSearchParams,
  isLibrarySearch: boolean,
): SearchViewMode => isLibrarySearch && params.get('view') === 'continuous' ? 'continuous' : 'grid'

/**
 * Parse a complete start identity only for an active library continuous view.
 * A missing or blank half of `gid`/`id` is treated as no requested start.
 */
export const parseSearchStartIdentity = (
  params: URLSearchParams,
  isLibrarySearch: boolean,
): SearchContinuousIdentity | null => (
  parseSearchViewMode(params, isLibrarySearch) === 'continuous' ? parseIdentity(params) : null
)

export const parseSearchViewState = (
  params: URLSearchParams,
  isLibrarySearch: boolean,
): SearchViewState => {
  const view = parseSearchViewMode(params, isLibrarySearch)
  return {
    view,
    start: view === 'continuous' ? parseIdentity(params) : null,
  }
}

/**
 * Return a cloned URL with continuous mode enabled. Passing no identity (or
 * a partial/blank identity) removes stale `gid`/`id` and starts at the first
 * readable result.
 */
export const applyContinuousSearchParams = (
  url: URL,
  identity?: SearchContinuousIdentity | null,
): URL => {
  const next = new URL(url.href)
  next.searchParams.set('view', 'continuous')
  next.searchParams.delete('gid')
  next.searchParams.delete('id')

  const groupId = normalized(identity?.groupId)
  const bookId = normalized(identity?.bookId)
  if (groupId && bookId) {
    next.searchParams.set('gid', groupId)
    next.searchParams.set('id', bookId)
  }
  return next
}

/** Return a cloned URL with all continuous-view state removed. */
export const removeContinuousSearchParams = (url: URL): URL => {
  const next = new URL(url.href)
  next.searchParams.delete('view')
  next.searchParams.delete('gid')
  next.searchParams.delete('id')
  return next
}

/** A book is readable only when its persisted page images have a safe count. */
export const isReadableBook = (book: SearchContinuousBook): boolean => (
  book.status === 'Downloaded'
  && Boolean(normalized(book.apiGroupId))
  && Boolean(normalized(book.apiBookId))
  && Number.isInteger(book.totalPage)
  && book.totalPage >= 1
  && book.totalPage <= 10_000
)

export const filterReadableBooks = <T extends SearchContinuousBook>(books: readonly T[]): T[] => (
  books.filter(isReadableBook)
)

const identityMatches = (book: SearchContinuousBook, identity: SearchContinuousIdentity) => (
  normalized(book.apiGroupId) === identity.groupId
  && normalized(book.apiBookId) === identity.bookId
)

/**
 * Filter to readable books and resolve a requested API identity in that
 * sequence. Invalid, absent, or non-readable identities fall back to index 0;
 * an empty sequence reports `startIndex: -1`.
 */
export const resolveContinuousStart = <T extends SearchContinuousBook>(
  books: readonly T[],
  identity?: SearchContinuousIdentity | null,
): ContinuousStartResolution<T> => {
  const sequence = filterReadableBooks(books)
  if (sequence.length === 0) return { sequence, startIndex: -1 }

  const groupId = normalized(identity?.groupId)
  const bookId = normalized(identity?.bookId)
  if (!groupId || !bookId) return { sequence, startIndex: 0 }

  const requested = { groupId, bookId }
  const startIndex = sequence.findIndex((book) => identityMatches(book, requested))
  return { sequence, startIndex: startIndex >= 0 ? startIndex : 0 }
}

/**
 * Return the previous, current, and next sequence indices, clamped to bounds
 * and de-duplicated at either edge. Empty or invalid-length sequences return
 * an empty window; a non-integer current index is floored before clamping.
 */
export const getMountedWindowIndices = (currentIndex: number, sequenceLength: number): number[] => {
  if (!Number.isSafeInteger(sequenceLength) || sequenceLength <= 0) return []
  const safeCurrent = Number.isFinite(currentIndex)
    ? Math.min(sequenceLength - 1, Math.max(0, Math.floor(currentIndex)))
    : 0
  return [...new Set([safeCurrent - 1, safeCurrent, safeCurrent + 1]
    .map((index) => Math.min(sequenceLength - 1, Math.max(0, index))))]
}

/** Alias named for the continuous reader component. */
export const getContinuousReaderWindowIndices = getMountedWindowIndices
