import { useCallback, useEffect, useRef, useState, type SetStateAction } from 'react'

import {
  ApiError,
  getErrorMessage,
  getWebBookContent,
  mapEBookToCard,
  mapOnlineBookToCard,
  requestBlob,
  startBookDownload,
} from '../../api'
import type { ApiBookCardModel } from '../../api'
import { findSearchBookIndex } from './search-book-download'
import type { BookCardModel } from '../../models'
import { deleteBooksWithConcurrency, getBookIdentityKey } from '../library/book-deletion'
import type { CloseReason, NativeDialogControls } from '../../components/ui'

type Notify = (message: string, tone?: 'success' | 'warning' | 'error') => void

export type SearchOperationsOptions = {
  isWebSearch: boolean
  apiRevision: number
  routeKey: string
  librarySearchBooks: ApiBookCardModel[]
  webSearchResultBooks: ApiBookCardModel[]
  selected: string[]
  searchResultsRef: { current: {
    librarySearchBooks: ApiBookCardModel[]
    webSearchResultBooks: ApiBookCardModel[]
    selected: string[]
  } }
  setLibrarySearchBooks: (update: SetStateAction<ApiBookCardModel[]>) => void
  setSelected: (update: SetStateAction<string[]>) => void
  updateWebSearchResultBooks: (update: SetStateAction<ApiBookCardModel[]>) => void
  replaceWebSearchBook: (original: BookCardModel, refreshed: ApiBookCardModel) => void
  replaceWebSearchBooks: (replacements: readonly { original: BookCardModel; refreshed: ApiBookCardModel }[]) => void
  notify: Notify
}

export function useSearchOperations({
  isWebSearch,
  apiRevision,
  routeKey,
  librarySearchBooks,
  webSearchResultBooks,
  selected,
  searchResultsRef,
  setLibrarySearchBooks,
  setSelected,
  updateWebSearchResultBooks,
  replaceWebSearchBook,
  replaceWebSearchBooks,
  notify,
}: SearchOperationsOptions) {
  const [deleteDialogBooks, setDeleteDialogBooks] = useState<ApiBookCardModel[]>([])
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [deleteDialogPending, setDeleteDialogPending] = useState(false)
  const [deleteDialogError, setDeleteDialogError] = useState('')
  const [pendingDeletionKeys, setPendingDeletionKeys] = useState<Set<string>>(() => new Set())
  const [webDetailBook, setWebDetailBook] = useState<ApiBookCardModel>()
  const [webDetailDialogOpen, setWebDetailDialogOpen] = useState(false)
  const [webDetailLoading, setWebDetailLoading] = useState(false)
  const [webDetailError, setWebDetailError] = useState('')
  const deleteDialogRef = useRef<HTMLDialogElement>(null)
  const deleteDialogTriggerRef = useRef<HTMLElement | null>(null)
  const deleteDialogPendingRef = useRef(false)
  const pendingDeletionKeysRef = useRef<Set<string>>(new Set())
  const deleteOperationControllersRef = useRef(new Set<AbortController>())
  const webDetailDialogRef = useRef<HTMLDialogElement>(null)
  const webDetailTriggerRef = useRef<HTMLElement | null>(null)
  const webDetailRequestRef = useRef<AbortController | null>(null)
  const abortDeleteOperations = useCallback(() => {
    deleteOperationControllersRef.current.forEach((controller) => controller.abort())
    deleteOperationControllersRef.current.clear()
  }, [])

  useEffect(() => {
    deleteDialogPendingRef.current = false
    setDeleteDialogPending(false)
    setDeleteDialogOpen(false)
    webDetailRequestRef.current?.abort()
    webDetailRequestRef.current = null
    setWebDetailDialogOpen(false)

    return () => {
      webDetailRequestRef.current?.abort()
    }
  }, [apiRevision, routeKey])

  useEffect(() => {
    abortDeleteOperations()
    pendingDeletionKeysRef.current = new Set()
    setPendingDeletionKeys(new Set())

    return abortDeleteOperations
  }, [abortDeleteOperations, apiRevision])

  const updatePendingDeletionKeys = useCallback((update: (current: Set<string>) => Set<string>) => {
    const next = update(pendingDeletionKeysRef.current)
    pendingDeletionKeysRef.current = next
    setPendingDeletionKeys(next)
  }, [])

  const fetchWebBook = useCallback(async (book: BookCardModel, signal?: AbortSignal) => {
    if (!book.url) throw new ApiError('Book URLがありません。', { category: 'validation' })
    const response = await getWebBookContent(book.url, signal)
    const refreshed = response.book
      ? mapEBookToCard(response.book, {
          context: 'library',
          entities: response.tags ?? [],
        })
      : response.onlineBook
        ? mapOnlineBookToCard(response.onlineBook, response.tags ?? [])
        : undefined
    if (!refreshed) throw new ApiError('Book情報がありません。', { category: 'notFound' })
    const previous = book as ApiBookCardModel
    return {
      ...refreshed,
      url: refreshed.url?.trim() || previous.url,
      sourceLabel: refreshed.sourceLabel ?? previous.sourceLabel,
      thumbnailUrl: refreshed.thumbnailUrl ?? previous.thumbnailUrl,
      thumbnailRequest: refreshed.thumbnailRequest ?? previous.thumbnailRequest,
      thumbnailReloadKey: refreshed.thumbnailReloadKey ?? previous.thumbnailReloadKey,
    }
  }, [])

  const openWebBookDetail = useCallback((book: BookCardModel, trigger?: HTMLElement) => {
    if (!isWebSearch || (book.apiGroupId?.trim() && book.apiBookId?.trim())) return
    const url = book.url?.trim()
    if (!url) return

    webDetailRequestRef.current?.abort()
    const controller = new AbortController()
    webDetailRequestRef.current = controller
    webDetailTriggerRef.current = trigger ?? null
    setWebDetailBook(book as ApiBookCardModel)
    setWebDetailError('')
    setWebDetailLoading(true)
    setWebDetailDialogOpen(true)

    void fetchWebBook(book, controller.signal)
      .then((refreshed) => {
        if (controller.signal.aborted || webDetailRequestRef.current !== controller) return
        setWebDetailBook(refreshed)
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted && webDetailRequestRef.current === controller) {
          setWebDetailError(getErrorMessage(error))
        }
      })
      .finally(() => {
        if (webDetailRequestRef.current === controller) {
          webDetailRequestRef.current = null
          setWebDetailLoading(false)
        }
      })
  }, [fetchWebBook, isWebSearch])

  const requestWebDetailClose = useCallback((_reason: CloseReason) => {
    webDetailRequestRef.current?.abort()
    webDetailRequestRef.current = null
    setWebDetailDialogOpen(false)
    return true
  }, [])

  const afterWebDetailClose = useCallback(() => {
    setWebDetailBook(undefined)
    setWebDetailError('')
    setWebDetailLoading(false)
  }, [])

  const resolveWebDetailRestoreFocus = useCallback(() => {
    const trigger = webDetailTriggerRef.current
    webDetailTriggerRef.current = null
    return trigger
  }, [])

  const refreshWebBook = useCallback(async (book: BookCardModel) => {
    try {
      const refreshed = await fetchWebBook(book)
      replaceWebSearchBook(book, refreshed)
      notify(`「${book.title}」のWeb情報を再取得しました`)
    } catch (error) {
      notify(`再取得できませんでした: ${getErrorMessage(error)}`, 'error')
    }
  }, [fetchWebBook, notify, replaceWebSearchBook])

  const refreshSelectedWebBooks = useCallback(async () => {
    const selectedKeys = new Set(selected)
    const selectedBooks = webSearchResultBooks.filter((book) => selectedKeys.has(getBookIdentityKey(book)))
    if (selectedBooks.length === 0) return

    const results = await Promise.allSettled(selectedBooks.map((selectedBook) => fetchWebBook(selectedBook)))
    const refreshed: { original: BookCardModel; refreshed: ApiBookCardModel }[] = []
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') refreshed.push({ original: selectedBooks[index], refreshed: result.value })
    })
    replaceWebSearchBooks(refreshed)
    const failed = results.length - refreshed.length
    notify(
      failed ? `${refreshed.length}件を更新、${failed}件は失敗しました` : `選択した${refreshed.length}件を読み込みました`,
      failed === 0 ? 'success' : refreshed.length === 0 ? 'error' : 'warning',
    )
  }, [fetchWebBook, notify, replaceWebSearchBooks, selected, webSearchResultBooks])

  const downloadWebBook = useCallback(async (book: BookCardModel) => {
    if (book.status === 'Downloaded' || book.status === 'Downloading') return

    const originalUrl = book.url?.trim()
    let targetBook = book as ApiBookCardModel

    if (book.status === 'WebBookInPage') {
      try {
        const refreshed = await fetchWebBook(book)
        targetBook = {
          ...refreshed,
          url: refreshed.url?.trim() || originalUrl || '',
        }
        const currentBooks = searchResultsRef.current.webSearchResultBooks
        const currentIndex = findSearchBookIndex(currentBooks, book, targetBook)
        const currentBook = currentIndex >= 0 ? currentBooks[currentIndex] : undefined
        const status = currentBook?.status === 'Downloaded' || currentBook?.status === 'Downloading'
          ? currentBook.status
          : targetBook.status
        targetBook = status === targetBook.status ? targetBook : { ...targetBook, status }
        replaceWebSearchBook(book, targetBook)
      } catch {
        // The download endpoint can resolve the URL independently. Keep the
        // candidate card intact and continue with its original URL.
        targetBook = book as ApiBookCardModel
      }
    }

    const targetUrl = targetBook.url?.trim() || originalUrl
    if (!targetUrl) {
      notify(`ダウンロードを開始できませんでした: Book URLがありません。`, 'error')
      return
    }

    const currentBooks = searchResultsRef.current.webSearchResultBooks
    const currentIndex = findSearchBookIndex(currentBooks, book, targetBook)
    const currentStatus = currentIndex >= 0 ? currentBooks[currentIndex].status : undefined
    const discoveredStatus = currentStatus === 'Downloaded' || currentStatus === 'Downloading'
      ? currentStatus
      : targetBook.status === 'Downloaded' || targetBook.status === 'Downloading'
        ? targetBook.status
        : undefined
    if (discoveredStatus === 'Downloaded') {
      notify(`「${targetBook.title || book.title}」はダウンロード済みです`)
      return
    }
    if (discoveredStatus === 'Downloading') {
      notify(`「${targetBook.title || book.title}」はダウンロード中です`, 'warning')
      return
    }

    try {
      await startBookDownload({ url: targetUrl, requestedBy: 'nyapture-web' })
      updateWebSearchResultBooks((current) => {
        const index = findSearchBookIndex(current, book, targetBook)
        if (index < 0) return current
        const currentBook = current[index]
        if (currentBook.status === 'Downloaded') return current
        const next = [...current]
        next[index] = { ...currentBook, status: 'Downloading' }
        return next
      })
      setWebDetailBook((current) => current && current.url === targetUrl
        ? { ...current, status: 'Downloading' }
        : current)
      notify(`「${targetBook.title || book.title}」のダウンロードを開始しました`)
    } catch (error) {
      notify(`ダウンロードを開始できませんでした: ${getErrorMessage(error)}`, 'error')
    }
  }, [fetchWebBook, notify, replaceWebSearchBook, searchResultsRef, updateWebSearchResultBooks])

  const openDeleteDialog = useCallback((books: ApiBookCardModel[], trigger: HTMLElement | null) => {
    if (!books.length || deleteDialogPendingRef.current) return
    deleteDialogTriggerRef.current = trigger
    deleteDialogPendingRef.current = false
    setDeleteDialogBooks(books)
    setDeleteDialogError('')
    setDeleteDialogPending(false)
    setDeleteDialogOpen(true)
  }, [])

  const deleteLibraryBook = useCallback((book: BookCardModel, trigger?: HTMLElement) => {
    const bookKey = getBookIdentityKey(book)
    if (pendingDeletionKeysRef.current.has(bookKey)) return
    const activeBooks = isWebSearch ? webSearchResultBooks : librarySearchBooks
    const targetBook = activeBooks.find((candidate) => getBookIdentityKey(candidate) === bookKey)
    if (!targetBook) return
    if (targetBook.status === 'WebBook' || targetBook.status === 'WebBookInPage') return
    openDeleteDialog([targetBook], trigger ?? null)
  }, [isWebSearch, librarySearchBooks, openDeleteDialog, webSearchResultBooks])

  const deleteSelectedLibraryBooks = useCallback((trigger?: HTMLElement) => {
    const selectedKeys = new Set(selected)
    const deletedBooks = librarySearchBooks.filter((book) => {
      const key = getBookIdentityKey(book)
      return selectedKeys.has(key) && !pendingDeletionKeysRef.current.has(key)
    })
    if (!deletedBooks.length) return
    openDeleteDialog(deletedBooks, trigger ?? null)
  }, [librarySearchBooks, openDeleteDialog, selected])

  const requestDeleteDialogClose = useCallback((_reason: CloseReason) => {
    if (deleteDialogPendingRef.current) return false
    setDeleteDialogOpen(false)
    return true
  }, [])

  const afterDeleteDialogClose = useCallback(() => {
    setDeleteDialogBooks([])
    setDeleteDialogError('')
  }, [])

  const resolveDeleteRestoreFocus = useCallback((reason: CloseReason) => {
    const trigger = deleteDialogTriggerRef.current
    deleteDialogTriggerRef.current = null
    return reason === 'escape' || reason === 'backdrop' || reason === 'close-button' ? trigger : null
  }, [])

  const finishDeleteDialog = useCallback((requestClose: NativeDialogControls['requestClose']) => {
    deleteDialogPendingRef.current = false
    setDeleteDialogPending(false)
    requestClose('submit')
  }, [])

  const confirmDeleteLibraryBooks = useCallback(async (requestClose: NativeDialogControls['requestClose']) => {
    if (deleteDialogPendingRef.current || !deleteDialogBooks.length) return
    const targetBooks = deleteDialogBooks.filter((book) => !pendingDeletionKeysRef.current.has(getBookIdentityKey(book)))
    if (!targetBooks.length) {
      finishDeleteDialog(requestClose)
      return
    }
    const operationController = new AbortController()
    deleteOperationControllersRef.current.add(operationController)
    deleteDialogPendingRef.current = true
    setDeleteDialogPending(true)
    setDeleteDialogError('')
    const targetKeys = new Set(targetBooks.map(getBookIdentityKey))
    updatePendingDeletionKeys((current) => new Set([...current, ...targetKeys]))
    setSelected((current) => current.filter((key) => !targetKeys.has(key)))
    finishDeleteDialog(requestClose)
    notify(`${targetBooks.length}件の削除を開始しました`)

    void deleteBooksWithConcurrency(targetBooks, {
      signal: operationController.signal,
      concurrency: 3,
      onSettled: async (book, outcome) => {
        if (operationController.signal.aborted || outcome.status === 'aborted') return
        const bookKey = getBookIdentityKey(book)
        if (outcome.status === 'succeeded') {
          if (isWebSearch) {
            try {
              const refreshed = await fetchWebBook(book, operationController.signal)
              if (!operationController.signal.aborted) replaceWebSearchBook(book, refreshed)
            } catch {
              if (!operationController.signal.aborted) {
                updateWebSearchResultBooks((current) => current.filter((candidate) => getBookIdentityKey(candidate) !== bookKey))
              }
            }
          } else {
            setLibrarySearchBooks((current) => current.filter((candidate) => getBookIdentityKey(candidate) !== bookKey))
          }
        }
        updatePendingDeletionKeys((current) => {
          const next = new Set(current)
          next.delete(bookKey)
          return next
        })
      },
    }).then((results) => {
      if (operationController.signal.aborted) return
      const completed = results.filter((result) => result.status === 'succeeded').length
      const failed = results.filter((result) => result.status === 'failed').length
      const summary = [
        completed > 0 ? `${completed}件を削除` : '',
        failed > 0 ? `${failed}件は失敗` : '',
      ].filter(Boolean).join('、')
      notify(summary, failed > 0 ? completed > 0 ? 'warning' : 'error' : 'success')
    }).finally(() => {
      deleteOperationControllersRef.current.delete(operationController)
    })
  }, [deleteDialogBooks, fetchWebBook, finishDeleteDialog, isWebSearch, notify, replaceWebSearchBook, setLibrarySearchBooks, setSelected, updatePendingDeletionKeys, updateWebSearchResultBooks])

  const deleteDialogBook = deleteDialogBooks.length === 1 ? deleteDialogBooks[0] : undefined
  const deleteDialogThumbnailRequest = deleteDialogBook?.thumbnailRequest
  const loadDeleteDialogThumbnail = useCallback((signal: AbortSignal) => {
    if (!deleteDialogThumbnailRequest) return Promise.reject(new Error('Thumbnail request is unavailable'))
    return requestBlob(deleteDialogThumbnailRequest.path, {
      query: deleteDialogThumbnailRequest.query,
      headers: { Accept: 'image/*' },
      signal,
    })
  }, [deleteDialogThumbnailRequest])

  return {
    deleteDialogRef,
    deleteDialogBooks,
    deleteDialogOpen,
    deleteDialogPending,
    deleteDialogError,
    pendingDeletionKeys,
    deleteDialogThumbnailRequest,
    loadDeleteDialogThumbnail,
    webDetailDialogRef,
    webDetailBook,
    webDetailDialogOpen,
    webDetailLoading,
    webDetailError,
    openWebBookDetail,
    requestWebDetailClose,
    afterWebDetailClose,
    resolveWebDetailRestoreFocus,
    refreshSelectedWebBooks,
    refreshWebBook,
    downloadWebBook,
    deleteLibraryBook,
    deleteSelectedLibraryBooks,
    requestDeleteDialogClose,
    afterDeleteDialogClose,
    resolveDeleteRestoreFocus,
    confirmDeleteLibraryBooks,
  }
}

export type SearchOperationsController = ReturnType<typeof useSearchOperations>
