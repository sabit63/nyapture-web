import {
  ApiError,
  enqueueBookPhysicalDeletion,
  getBook,
  getBookDeletionJob,
  getErrorMessage,
} from '../../api'
import type { ApiJsonResponse } from '../../api'
import type {
  BookCardModel,
  BookDeletionJob,
  BookDeletionJobResponse,
  BookDeletionJobStatus,
  EBookResponse,
} from '../../models'

export type BookDeletionOutcome = {
  status: 'succeeded' | 'failed' | 'aborted'
  message?: string
}

export type BookDeletionTarget = Pick<BookCardModel, 'apiGroupId' | 'apiBookId'>

export type BookDeletionRunnerDependencies = {
  enqueue: (
    groupId: string,
    bookId: string,
    signal?: AbortSignal,
  ) => Promise<ApiJsonResponse<BookDeletionJobResponse>>
  getJob: (jobId: string, signal?: AbortSignal) => Promise<BookDeletionJobResponse>
  getBook: (groupId: string, bookId: string, signal?: AbortSignal) => Promise<EBookResponse>
  wait: (delayMs: number, signal?: AbortSignal) => Promise<void>
  now: () => number
}

export type DeleteBooksWithConcurrencyOptions<T extends BookDeletionTarget> = {
  signal?: AbortSignal
  concurrency?: number
  deleteOne?: (book: T, signal?: AbortSignal) => Promise<BookDeletionOutcome>
  onSettled?: (book: T, outcome: BookDeletionOutcome, index: number) => void | Promise<void>
}

const BOOK_DELETION_STATUSES: BookDeletionJobStatus[] = ['Pending', 'Running', 'Succeeded', 'Failed']
const FAST_POLL_WINDOW_MS = 30_000
const FAST_POLL_INTERVAL_MS = 1000
const SLOW_POLL_INTERVAL_MS = 5000
const MAX_ENQUEUE_RETRIES = 3
const MAX_DELETION_CONCURRENCY = 3

const hasBookIdentifier = (value: string | undefined) => Boolean(value?.trim())

const isBookDeletionJob = (value: unknown): value is BookDeletionJob => {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<BookDeletionJob>
  return hasBookIdentifier(candidate.jobId)
    && BOOK_DELETION_STATUSES.includes(candidate.status as BookDeletionJobStatus)
}

const deletionFailureMessage = (job: BookDeletionJob | undefined) => (
  typeof job?.failureMessage === 'string' && job.failureMessage.trim()
    ? job.failureMessage.trim()
    : '削除ジョブが失敗しました。'
)

const deletionOutcomeFromJob = (job: BookDeletionJob): BookDeletionOutcome | undefined => {
  if (job.status === 'Succeeded') return { status: 'succeeded' }
  if (job.status === 'Failed') return { status: 'failed', message: deletionFailureMessage(job) }
  return undefined
}

const createAbortError = () => {
  const error = new Error('削除ジョブの監視がキャンセルされました。')
  error.name = 'AbortError'
  return error
}

const waitForDelay = (delayMs: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  if (signal?.aborted) {
    reject(createAbortError())
    return
  }

  const onAbort = () => {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
    reject(createAbortError())
  }
  const timer = setTimeout(() => {
    signal?.removeEventListener('abort', onAbort)
    resolve()
  }, delayMs)
  signal?.addEventListener('abort', onAbort, { once: true })
})

const defaultDependencies: BookDeletionRunnerDependencies = {
  enqueue: enqueueBookPhysicalDeletion,
  getJob: getBookDeletionJob,
  getBook,
  wait: waitForDelay,
  now: Date.now,
}

const isAbortError = (error: unknown, signal?: AbortSignal) => (
  signal?.aborted || error instanceof Error && error.name === 'AbortError'
)

const isRetryableError = (error: unknown) => error instanceof ApiError && (
  error.status === 503
  || error.category === 'timeout'
  || error.category === 'offline'
  || error.category === 'server'
)

const retryDelayMs = (error: unknown, retryIndex: number) => (
  error instanceof ApiError && error.retryAfterSeconds !== undefined
    ? error.retryAfterSeconds * 1000
    : 2 ** retryIndex * 1000
)

const reconcileMissingJob = async (
  groupId: string,
  bookId: string,
  signal: AbortSignal | undefined,
  dependencies: BookDeletionRunnerDependencies,
): Promise<BookDeletionOutcome | undefined> => {
  try {
    const response = await dependencies.getBook(groupId, bookId, signal)
    if (response.success === false) {
      return { status: 'failed', message: response.message ?? '削除結果を確認できませんでした。' }
    }
    if (!Array.isArray(response.books)) {
      return { status: 'failed', message: 'Book確認応答が不正です。' }
    }
    if (response.books.length === 0) return { status: 'succeeded' }
    return { status: 'failed', message: '削除ジョブが失われ、Bookが残っています。' }
  } catch (error) {
    if (isAbortError(error, signal)) throw error
    if (error instanceof ApiError && error.category === 'notFound') return { status: 'succeeded' }
    if (isRetryableError(error)) return undefined
    return { status: 'failed', message: getErrorMessage(error) }
  }
}

export const createBookDeletionRunner = (
  overrides: Partial<BookDeletionRunnerDependencies> = {},
) => {
  const dependencies = { ...defaultDependencies, ...overrides }

  return async (
    book: BookDeletionTarget,
    signal?: AbortSignal,
  ): Promise<BookDeletionOutcome> => {
    const groupId = book.apiGroupId?.trim()
    const bookId = book.apiBookId?.trim()
    if (!groupId || !bookId) return { status: 'failed', message: 'Book識別子がありません。' }

    try {
      let enqueueResponse: ApiJsonResponse<BookDeletionJobResponse> | undefined
      for (let retryIndex = 0; retryIndex <= MAX_ENQUEUE_RETRIES; retryIndex += 1) {
        try {
          enqueueResponse = await dependencies.enqueue(groupId, bookId, signal)
          break
        } catch (error) {
          if (isAbortError(error, signal)) throw error
          if (!isRetryableError(error) || retryIndex === MAX_ENQUEUE_RETRIES) {
            return { status: 'failed', message: getErrorMessage(error) }
          }
          await dependencies.wait(retryDelayMs(error, retryIndex), signal)
        }
      }

      const response = enqueueResponse?.body
      if (!response || response.success === false) {
        return { status: 'failed', message: response?.message ?? '削除ジョブを登録できませんでした。' }
      }
      if (!isBookDeletionJob(response.data)) {
        return { status: 'failed', message: '削除ジョブの応答が不正です。' }
      }

      const initialOutcome = deletionOutcomeFromJob(response.data)
      if (initialOutcome) return initialOutcome

      const pollingStartedAt = dependencies.now()
      let nextDelayMs = (enqueueResponse?.retryAfterSeconds ?? 1) * 1000
      while (true) {
        await dependencies.wait(nextDelayMs, signal)
        try {
          const nextResponse = await dependencies.getJob(response.data.jobId, signal)
          if (nextResponse.success === false) {
            return { status: 'failed', message: nextResponse.message ?? '削除ジョブの状態を取得できませんでした。' }
          }
          if (!isBookDeletionJob(nextResponse.data)) {
            return { status: 'failed', message: '削除ジョブの応答が不正です。' }
          }
          const outcome = deletionOutcomeFromJob(nextResponse.data)
          if (outcome) return outcome
        } catch (error) {
          if (isAbortError(error, signal)) throw error
          if (error instanceof ApiError && error.category === 'notFound') {
            const reconciled = await reconcileMissingJob(groupId, bookId, signal, dependencies)
            if (reconciled) return reconciled
          } else if (!isRetryableError(error)) {
            return { status: 'failed', message: getErrorMessage(error) }
          }
          nextDelayMs = SLOW_POLL_INTERVAL_MS
          continue
        }

        nextDelayMs = dependencies.now() - pollingStartedAt < FAST_POLL_WINDOW_MS
          ? FAST_POLL_INTERVAL_MS
          : SLOW_POLL_INTERVAL_MS
      }
    } catch (error) {
      if (isAbortError(error, signal)) return { status: 'aborted' }
      return { status: 'failed', message: getErrorMessage(error) }
    }
  }
}

export const deleteBookAndWait = createBookDeletionRunner()

export const deleteBooksWithConcurrency = async <T extends BookDeletionTarget>(
  books: readonly T[],
  options: DeleteBooksWithConcurrencyOptions<T> = {},
): Promise<BookDeletionOutcome[]> => {
  if (books.length === 0) return []
  const concurrency = Math.min(
    MAX_DELETION_CONCURRENCY,
    Math.max(1, Math.trunc(options.concurrency ?? MAX_DELETION_CONCURRENCY)),
  )
  const results = new Array<BookDeletionOutcome>(books.length)
  let nextIndex = 0
  const deleteOne = options.deleteOne ?? deleteBookAndWait

  const worker = async () => {
    while (nextIndex < books.length) {
      const index = nextIndex
      nextIndex += 1
      const book = books[index]
      const outcome = await deleteOne(book, options.signal)
      results[index] = outcome
      await options.onSettled?.(book, outcome, index)
    }
  }

  await Promise.all(Array.from(
    { length: Math.min(concurrency, books.length) },
    () => worker(),
  ))
  return results
}

export const getBookIdentityKey = (book: Pick<BookCardModel, 'groupId' | 'bookId'>) => `${book.groupId}\u0000${book.bookId}`
