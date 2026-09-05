import type { BookCardModel } from '../../models'

/**
 * A web book is a download candidate when one of its artist/group tags is
 * already used by at least one library book.
 *
 * The search page applies the web-search condition before calling this
 * predicate. Keeping the status and tag checks here lets other web-book
 * surfaces use the same visual rule.
 */
export const isDownloadCandidate = (
  book: Pick<BookCardModel, 'status' | 'tags'>,
): boolean => (
  (book.status === 'WebBook' || book.status === 'WebBookInPage')
    && book.tags.some((tag) => (
      (tag.type === 'Artists' || tag.type === 'Groups')
      && typeof tag.count === 'number'
      && tag.count >= 1
    ))
)
