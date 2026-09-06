import { ApiError } from '../../api/client'
import {
  addBookTags,
  fetchBookTagState,
  removeBookTags,
} from '../../api/book-tags'
import type { ApiBookCardModel } from '../../api/books'
import type { BookTag, NyaTagType } from '../../models'
import { TAG_TYPE_ORDER } from '../../models'

export { fetchBookTagState } from '../../api/book-tags'

export type BookTagChange = {
  type: NyaTagType
  add: string[]
  remove: string[]
}

export const tagKey = (tag: Pick<BookTag, 'type' | 'name'>) => `${tag.type}\u0000${tag.name}`

export const normalizeDraftTags = (tags: BookTag[]): BookTag[] => {
  const seen = new Set<string>()
  const normalized: BookTag[] = []

  for (const tag of tags) {
    const name = tag.name.trim()
    if (!name) continue
    const next = { ...tag, name }
    const key = tagKey(next)
    if (seen.has(key)) continue
    seen.add(key)
    normalized.push(next)
  }

  return normalized
}

export const getBookTagChanges = (
  baseline: BookTag[],
  draft: BookTag[],
): BookTagChange[] => {
  const normalizedBaseline = normalizeDraftTags(baseline)
  const normalizedDraft = normalizeDraftTags(draft)
  const baselineByType = new Map<NyaTagType, string[]>()
  const draftByType = new Map<NyaTagType, string[]>()

  for (const tag of normalizedBaseline) {
    const names = baselineByType.get(tag.type) ?? []
    names.push(tag.name)
    baselineByType.set(tag.type, names)
  }
  for (const tag of normalizedDraft) {
    const names = draftByType.get(tag.type) ?? []
    names.push(tag.name)
    draftByType.set(tag.type, names)
  }

  return TAG_TYPE_ORDER.flatMap((type) => {
    const baselineNames = baselineByType.get(type) ?? []
    const draftNames = draftByType.get(type) ?? []
    const baselineSet = new Set(baselineNames)
    const draftSet = new Set(draftNames)
    const add = draftNames.filter((name) => !baselineSet.has(name))
    const remove = baselineNames.filter((name) => !draftSet.has(name))
    return add.length || remove.length ? [{ type, add, remove }] : []
  })
}

export class BookTagSaveError extends Error {
  readonly latestBook?: ApiBookCardModel

  constructor(
    message: string,
    options: { latestBook?: ApiBookCardModel; cause?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'BookTagSaveError'
    this.latestBook = options.latestBook
  }
}

const errorMessage = (error: unknown) => {
  if (error instanceof Error && error.message.trim()) return error.message
  if (typeof error === 'string' && error.trim()) return error
  return 'Bookタグの保存に失敗しました。'
}

const isAbortError = (error: unknown) => (
  error instanceof Error && error.name === 'AbortError'
)

const assertMutationSucceeded = (response: { success?: boolean; message?: string }) => {
  if (response.success === false) {
    throw new ApiError(response.message?.trim() || 'Bookタグの更新に失敗しました。', { category: 'server' })
  }
}

export const saveBookTagChanges = async (
  groupId: string,
  bookId: string,
  baseline: BookTag[],
  draft: BookTag[],
  signal?: AbortSignal,
): Promise<ApiBookCardModel> => {
  const changes = getBookTagChanges(baseline, draft)

  try {
    for (const change of changes) {
      if (!change.add.length) continue
      assertMutationSucceeded(await addBookTags(groupId, bookId, change.type, change.add, signal))
    }
    for (const change of changes) {
      if (!change.remove.length) continue
      assertMutationSucceeded(await removeBookTags(groupId, bookId, change.type, change.remove, signal))
    }
    return await fetchBookTagState(groupId, bookId, signal)
  } catch (cause: unknown) {
    let latestBook: ApiBookCardModel | undefined
    if (!signal?.aborted && !isAbortError(cause)) {
      try {
        latestBook = await fetchBookTagState(groupId, bookId, signal)
      } catch {
        latestBook = undefined
      }
    }
    throw new BookTagSaveError(errorMessage(cause), { latestBook, cause })
  }
}
