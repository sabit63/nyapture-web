import {
  deleteBookPhysical,
  getBookDeletionJob,
  getErrorMessage,
} from '../../api'
import type { BookCardModel, BookDeletionJob, BookDeletionJobStatus } from '../../models'

export type BookDeletionOutcome = {
  status: 'succeeded' | 'pending' | 'failed' | 'aborted'
  message?: string
}

const BOOK_DELETION_STATUSES: BookDeletionJobStatus[] = ['Pending', 'Running', 'Succeeded', 'Failed']
const DELETION_POLL_INTERVAL_MS = 1000
const DELETION_POLL_TIMEOUT_MS = 30_000

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

const deletionOutcomeFromJob = (job: BookDeletionJob): BookDeletionOutcome => {
  if (job.status === 'Succeeded') return { status: 'succeeded' }
  if (job.status === 'Failed') return { status: 'failed', message: deletionFailureMessage(job) }
  if (job.status === 'Pending' || job.status === 'Running') return { status: 'pending' }
  return { status: 'failed', message: '削除ジョブの状態が不正です。' }
}

const createAbortError = () => {
  const error = new Error('削除ジョブの監視がキャンセルされました。')
  error.name = 'AbortError'
  return error
}

const waitForNextPoll = (delay: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  if (signal?.aborted) {
    reject(createAbortError())
    return
  }

  const timer = setTimeout(() => {
    signal?.removeEventListener('abort', onAbort)
    resolve()
  }, delay)
  const onAbort = () => {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
    reject(createAbortError())
  }
  signal?.addEventListener('abort', onAbort, { once: true })
})

export const deleteBookAndWait = async (
  book: Pick<BookCardModel, 'apiGroupId' | 'apiBookId'>,
  signal?: AbortSignal,
): Promise<BookDeletionOutcome> => {
  const groupId = book.apiGroupId?.trim()
  const bookId = book.apiBookId?.trim()
  if (!groupId || !bookId) return { status: 'failed', message: 'Book識別子がありません。' }

  try {
    const response = await deleteBookPhysical(groupId, bookId, signal)
    if (response.success === false) {
      return { status: 'failed', message: response.message ?? '削除ジョブを登録できませんでした。' }
    }
    if (!isBookDeletionJob(response.data)) {
      return { status: 'failed', message: '削除ジョブの応答が不正です。' }
    }

    const initialOutcome = deletionOutcomeFromJob(response.data)
    if (initialOutcome.status !== 'pending') return initialOutcome

    const deadline = Date.now() + DELETION_POLL_TIMEOUT_MS
    while (true) {
      const remaining = deadline - Date.now()
      if (remaining <= 0) return { status: 'pending' }
      await waitForNextPoll(Math.min(DELETION_POLL_INTERVAL_MS, remaining), signal)
      if (Date.now() >= deadline) return { status: 'pending' }

      const nextResponse = await getBookDeletionJob(response.data.jobId, signal)
      if (nextResponse.success === false) {
        return { status: 'failed', message: nextResponse.message ?? '削除ジョブの状態を取得できませんでした。' }
      }
      if (!isBookDeletionJob(nextResponse.data)) {
        return { status: 'failed', message: '削除ジョブの応答が不正です。' }
      }
      const nextOutcome = deletionOutcomeFromJob(nextResponse.data)
      if (nextOutcome.status !== 'pending') return nextOutcome
    }
  } catch (error) {
    if (signal?.aborted || (error instanceof Error && error.name === 'AbortError')) {
      return { status: 'aborted' }
    }
    return { status: 'failed', message: getErrorMessage(error) }
  }
}

export const getBookIdentityKey = (book: Pick<BookCardModel, 'groupId' | 'bookId'>) => `${book.groupId}\u0000${book.bookId}`
