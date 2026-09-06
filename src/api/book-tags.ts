import { ApiError, requestJson } from './client'
import { mapEBookToCard } from './books'
import { getBook } from './endpoints'
import type { ApiBookCardModel } from './books'
import type { NyaApiResponse, NyaTagType } from '../models'

const segment = (value: string) => encodeURIComponent(value)

const bookTagsPath = (groupId: string, bookId: string) => (
  `/api/book/${segment(groupId)}/${segment(bookId)}/tags`
)

const editBookTags = (
  method: 'POST' | 'DELETE',
  groupId: string,
  bookId: string,
  tagType: NyaTagType,
  tags: string[],
  signal?: AbortSignal,
) => requestJson<NyaApiResponse>(bookTagsPath(groupId, bookId), {
  method,
  body: { tagType, tags },
  auth: 'edit',
  signal,
})

export const addBookTags = (
  groupId: string,
  bookId: string,
  tagType: NyaTagType,
  tags: string[],
  signal?: AbortSignal,
) => editBookTags('POST', groupId, bookId, tagType, tags, signal)

export const removeBookTags = (
  groupId: string,
  bookId: string,
  tagType: NyaTagType,
  tags: string[],
  signal?: AbortSignal,
) => editBookTags('DELETE', groupId, bookId, tagType, tags, signal)

/** Fetch and map the current library state for a book after a tag operation. */
export const fetchBookTagState = async (
  groupId: string,
  bookId: string,
  signal?: AbortSignal,
): Promise<ApiBookCardModel> => {
  const response = await getBook(groupId, bookId, signal)
  if (response.success === false) {
    throw new ApiError(response.message?.trim() || 'Book情報を取得できませんでした。', { category: 'server' })
  }

  const book = response.books?.[0]
  if (!book) throw new ApiError('Book情報がありません。', { category: 'notFound' })
  return mapEBookToCard(book, { context: 'library', entities: response.tags ?? [] })
}
