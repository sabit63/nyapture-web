import { useCallback, useEffect, useMemo, useRef, useState, type SetStateAction } from 'react'

import {
  ApiError,
  getErrorMessage,
  getBook,
  getWebBookContent,
  mapEBookToCard,
  mapOnlineBookToCard,
  requestBlob,
  startBookDownload,
} from '../../api'
import type { ApiBookCardModel } from '../../api'
import { findSearchBookIndex } from './search-book-download'
import type { BookCardModel, BookDownloadStatus } from '../../models'
import { bookDownloadHubClient } from '../../realtime/book-download-hub'
import { applySearchBookDownloadStatus, normalizeSearchBookDownloadStatus } from '../../realtime/search-book-status'
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
  setSelectMode: (enabled: boolean) => void
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
  setSelectMode,
  updateWebSearchResultBooks,
  replaceWebSearchBook,
  notify,
}: SearchOperationsOptions) {
  const [failedBookKeys, setFailedBookKeys] = useState<Set<string>>(new Set())
  const failureScope = useMemo(() => ({
    active: false,
    timers: new Map<string, ReturnType<typeof setTimeout>>(),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- A new scope invalidates callbacks from the previous search/API.
  }), [apiRevision, routeKey])
  useEffect(() => {
    failureScope.active = true
    setFailedBookKeys(new Set())
    return () => {
      failureScope.active = false
      failureScope.timers.forEach(clearTimeout)
      failureScope.timers.clear()
    }
  }, [failureScope])
  const markBookFailed = useCallback((book: BookCardModel) => {
    if (!failureScope.active) return
    const key = getBookIdentityKey(book)
    clearTimeout(failureScope.timers.get(key))
    setFailedBookKeys((current) => new Set([...current, key]))
    failureScope.timers.set(key, setTimeout(() => {
      failureScope.timers.delete(key)
      setFailedBookKeys((current) => {
        const next = new Set(current)
        next.delete(key)
        return next
      })
    }, 5000))
  }, [failureScope])
  const [bulkOperation, setBulkOperation] = useState<'download' | 'refresh' | null>(null)
  const bulkOperationRef = useRef<AbortController | null>(null)
  useEffect(() => {
    setBulkOperation(null)
    downloadRequestsRef.current = new Set()
    return () => {
      bulkOperationRef.current?.abort()
      bulkOperationRef.current = null
    }
  }, [apiRevision, routeKey])
  const [deleteDialogBooks, setDeleteDialogBooks] = useState<ApiBookCardModel[]>([])
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [deleteDialogPending, setDeleteDialogPending] = useState(false)
  const [deleteDialogError, setDeleteDialogError] = useState('')
  const [pendingDeletionKeys, setPendingDeletionKeys] = useState<Set<string>>(() => new Set())
  const [webDetailBook, setWebDetailBook] = useState<ApiBookCardModel>()
  const downloadRequestsRef = useRef(new Set<string>())
  const [webDetailDialogOpen, setWebDetailDialogOpen] = useState(false)
  const [webDetailLoading, setWebDetailLoading] = useState(false)
  const [webDetailError, setWebDetailError] = useState('')
  const deleteDialogRef = useRef<HTMLDialogElement>(null)
  const deleteDialogTriggerRef = useRef<HTMLElement | null>(null)
  const deleteDialogPendingRef = useRef(false)
  const deleteDialogBulkRef = useRef(false)
  const pendingDeletionKeysRef = useRef<Set<string>>(new Set())
  const deleteOperationControllersRef = useRef(new Set<AbortController>())
  const webDetailDialogRef = useRef<HTMLDialogElement>(null)
  const webDetailTriggerRef = useRef<HTMLElement | null>(null)
  const webDetailRequestRef = useRef<AbortController | null>(null)
  useEffect(() => {
    if (!webDetailDialogOpen) return
    const versions = new Map<string, number>()
    const applyStatus = (status: BookDownloadStatus) => {
      setWebDetailBook((current) => current
        ? applySearchBookDownloadStatus([current], status, versions).books[0]
        : current)
    }
    const applyCollection = (statuses: BookDownloadStatus[]) => statuses.forEach(applyStatus)
    return bookDownloadHubClient.subscribe({
      onStatus: (kind, status) => applyStatus(normalizeSearchBookDownloadStatus(status, kind === 'completed')),
      onRunningDownloads: applyCollection,
      onQueuedDownloads: applyCollection,
      onAllDownloadStatuses: (statuses) => applyCollection(Object.values(statuses)),
      onBookDownloadStatus: applyStatus,
    })
  }, [apiRevision, routeKey, webDetailDialogOpen])

  const requestDownload = useCallback(async (url: string, signal?: AbortSignal) => {
    const requests = downloadRequestsRef.current
    if (requests.has(url)) return false
    requests.add(url)
    try {
      await startBookDownload({ url, requestedBy: 'nyapture-web' }, signal)
      return true
    } finally {
      requests.delete(url)
    }
  }, [])
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
    let savedBook = response.book
    if (!savedBook && book.status === 'Downloaded' && book.apiGroupId && book.apiBookId) {
      const library = await getBook(book.apiGroupId, book.apiBookId, signal)
      if (library.success === false || !Array.isArray(library.books)) {
        throw new ApiError('保存状態を確認できませんでした。', { category: 'server' })
      }
      savedBook = library.books[0]
    }
    const refreshed = savedBook
      ? mapEBookToCard(savedBook, {
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

  const replaceResultBook = useCallback((book: BookCardModel, refreshed: ApiBookCardModel) => {
    if (isWebSearch) {
      replaceWebSearchBook(book, refreshed)
      return
    }
    setLibrarySearchBooks((current) => {
      const index = findSearchBookIndex(current, book, refreshed)
      if (index < 0) return current
      const next = [...current]
      next[index] = refreshed
      return next
    })
  }, [isWebSearch, replaceWebSearchBook, setLibrarySearchBooks])

  const fetchResultBook = useCallback(async (book: BookCardModel, signal?: AbortSignal) => {
    let refreshed: ApiBookCardModel
    if (!isWebSearch && book.status !== 'Downloaded' && book.apiGroupId && book.apiBookId) {
      const response = await getBook(book.apiGroupId, book.apiBookId, signal)
      const result = response.books?.[0]
      if (!result) throw new ApiError('Book情報がありません。', { category: 'notFound' })
      refreshed = mapEBookToCard(result)
    } else {
      refreshed = await fetchWebBook(book, signal)
    }
    return { ...refreshed, thumbnailReloadKey: `refresh:${Date.now()}` }
  }, [fetchWebBook, isWebSearch])

  const refreshWebBook = useCallback(async (book: BookCardModel) => {
    try {
      replaceResultBook(book, await fetchResultBook(book))
      notify(`「${book.title}」の情報を再取得しました`)
    } catch (error) {
      markBookFailed(book)
      notify(`再取得できませんでした: ${getErrorMessage(error)}`, 'error')
    }
  }, [fetchResultBook, markBookFailed, notify, replaceResultBook])

  const downloadWebBook = useCallback(async (book: BookCardModel) => {
    if (['Downloaded', 'Downloading', 'Standby', 'Shredding'].includes(book.status)) return

    const originalUrl = book.url?.trim()
    let targetBook = book as ApiBookCardModel

    if (book.status === 'WebBookInPage') {
      try {
        const refreshed = await fetchWebBook(book)
        targetBook = {
          ...refreshed,
          url: refreshed.url?.trim() || originalUrl || '',
        }
        const currentBooks = isWebSearch ? searchResultsRef.current.webSearchResultBooks : searchResultsRef.current.librarySearchBooks
        const currentIndex = findSearchBookIndex(currentBooks, book, targetBook)
        const currentBook = currentIndex >= 0 ? currentBooks[currentIndex] : undefined
        const status = currentBook && ['Downloaded', 'Downloading', 'Standby', 'Shredding'].includes(currentBook.status)
          ? currentBook.status
          : targetBook.status
        targetBook = status === targetBook.status ? targetBook : { ...targetBook, status }
        replaceResultBook(book, targetBook)
      } catch {
        // The download endpoint can resolve the URL independently. Keep the
        // candidate card intact and continue with its original URL.
        targetBook = book as ApiBookCardModel
      }
    }

    const targetUrl = targetBook.url?.trim() || originalUrl
    if (!targetUrl) {
      markBookFailed(targetBook)
      notify(`ダウンロードを開始できませんでした: Book URLがありません。`, 'error')
      return
    }

    const currentBooks = isWebSearch ? searchResultsRef.current.webSearchResultBooks : searchResultsRef.current.librarySearchBooks
    const currentIndex = findSearchBookIndex(currentBooks, book, targetBook)
    const currentStatus = currentIndex >= 0 ? currentBooks[currentIndex].status : undefined
    const discoveredStatus = currentStatus && ['Downloaded', 'Downloading', 'Standby', 'Shredding'].includes(currentStatus)
      ? currentStatus
      : ['Downloaded', 'Downloading', 'Standby', 'Shredding'].includes(targetBook.status)
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
    if (discoveredStatus === 'Standby' || discoveredStatus === 'Shredding') return

    try {
      if (!await requestDownload(targetUrl)) return
      notify(`「${targetBook.title || book.title}」のダウンロードを開始しました`)
    } catch (error) {
      markBookFailed(targetBook)
      notify(`ダウンロードを開始できませんでした: ${getErrorMessage(error)}`, 'error')
    }
  }, [fetchWebBook, isWebSearch, markBookFailed, notify, replaceResultBook, requestDownload, searchResultsRef])

  const canDownloadBook = useCallback((book: ApiBookCardModel) => Boolean(book.url?.trim())
    && !['Downloaded', 'Downloading', 'Standby', 'Shredding'].includes(book.status)
    && !pendingDeletionKeysRef.current.has(getBookIdentityKey(book)), [])
  const downloadableSelectedCount = (isWebSearch ? webSearchResultBooks : librarySearchBooks).filter((book) => selected.includes(getBookIdentityKey(book)) && canDownloadBook(book)).length

  const runBulkOperation = useCallback(async (operation: 'download' | 'refresh') => {
    if (bulkOperationRef.current || deleteDialogPendingRef.current) return
    const selectedKeys = new Set(searchResultsRef.current.selected)
    const resultKey = isWebSearch ? 'webSearchResultBooks' : 'librarySearchBooks'
    const targets = searchResultsRef.current[resultKey].filter((book) => selectedKeys.has(getBookIdentityKey(book)))
    if (!targets.length) return
    setSelectMode(false)
    const controller = new AbortController()
    bulkOperationRef.current = controller
    setBulkOperation(operation)
    let succeeded = 0
    let failed = 0
    let skipped = 0
    let nextIndex = 0
    const worker = async () => {
      while (!controller.signal.aborted && nextIndex < targets.length) {
        const book = targets[nextIndex++]
        const key = getBookIdentityKey(book)
        const current = searchResultsRef.current[resultKey].find((candidate) => getBookIdentityKey(candidate) === key)
        if (!current || pendingDeletionKeysRef.current.has(key) || (operation === 'download' && !canDownloadBook(current))) {
          skipped++
          continue
        }
        try {
          const refreshed = operation === 'refresh' ? await fetchResultBook(current, controller.signal) : undefined
          if (controller.signal.aborted) return
          if (operation === 'download' && !await requestDownload(current.url.trim(), controller.signal)) {
            skipped++
            continue
          }
          if (controller.signal.aborted) return
          succeeded++
          setSelected((keys) => keys.filter((value) => value !== key))
          if (refreshed) replaceResultBook(current, refreshed)
        } catch {
          if (controller.signal.aborted) return
          markBookFailed(current)
          failed++
        }
      }
    }
    try {
      await Promise.all(Array.from({ length: Math.min(3, targets.length) }, () => worker()))
      if (controller.signal.aborted) return
      const summary = operation === 'download' ? `${succeeded}件のダウンロードを開始しました` : `${succeeded}件を読み込みました`
      notify(`${summary}${failed ? `、${failed}件は失敗しました` : ''}${skipped ? `、${skipped}件は対象外です` : ''}`,
        failed ? succeeded ? 'warning' : 'error' : 'success')
    } finally {
      if (bulkOperationRef.current === controller) {
        bulkOperationRef.current = null
        setBulkOperation(null)
      }
    }
  }, [canDownloadBook, fetchResultBook, isWebSearch, markBookFailed, notify, replaceResultBook, requestDownload, searchResultsRef, setSelected, setSelectMode])

  const downloadSelectedBooks = useCallback(() => runBulkOperation('download'), [runBulkOperation])
  const refreshSelectedBooks = useCallback(() => runBulkOperation('refresh'), [runBulkOperation])

  const openDeleteDialog = useCallback((books: ApiBookCardModel[], trigger: HTMLElement | null, bulk = false) => {
    if (!books.length || deleteDialogPendingRef.current) return
    deleteDialogBulkRef.current = bulk
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
    openDeleteDialog(deletedBooks, trigger ?? null, true)
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
    if (deleteDialogBulkRef.current) {
      setSelected([])
      setSelectMode(false)
    } else {
      setSelected((current) => current.filter((key) => !targetKeys.has(key)))
    }
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
  }, [deleteDialogBooks, fetchWebBook, finishDeleteDialog, isWebSearch, notify, replaceWebSearchBook, setLibrarySearchBooks, setSelected, setSelectMode, updatePendingDeletionKeys, updateWebSearchResultBooks])

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
    failedBookKeys,
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
    refreshSelectedBooks,
    refreshWebBook,
    downloadWebBook,
    deleteLibraryBook,
    deleteSelectedLibraryBooks,
    downloadSelectedBooks,
    downloadableSelectedCount,
    bulkDownloadPending: bulkOperation === 'download',
    bulkRefreshPending: bulkOperation === 'refresh',
    bulkOperationPending: bulkOperation !== null,
    requestDeleteDialogClose,
    afterDeleteDialogClose,
    resolveDeleteRestoreFocus,
    confirmDeleteLibraryBooks,
  }
}

export type SearchOperationsController = ReturnType<typeof useSearchOperations>
