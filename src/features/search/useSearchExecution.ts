import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'

import {
  ApiError,
  buildBookSearchFilter,
  buildHitomiSearchUrl,
  getErrorMessage,
  getWebPageContent,
  mapEBookToCard,
  mapHitomiSearchResponse,
  searchBooks as searchBooksApi,
} from '../../api'
import type { ApiBookCardModel } from '../../api'
import type { BookDownloadHubStatusEventKind } from '../../realtime/book-download-hub'
import { bookDownloadHubClient } from '../../realtime/book-download-hub'
import {
  applySearchBookDownloadStatuses,
  getDownloadStatusIdentityKey,
  normalizeSearchBookDownloadStatus,
  type SearchBookStatusVersionMap,
} from '../../realtime/search-book-status'
import type { BookDownloadStatus, HitomiAppend, SearchCriteria, SortDirection, SortType, TagEntity } from '../../models'
import { validateCriteria } from './search-utils'
import { applyTagEntityMetadata } from './tag-display-name'
import { resolveSearchTags } from './resolve-search-tags'
import {
  beginForegroundSearchRequest,
  cancelSearchRequest,
  createSearchRequestLifecycleState,
  finishSearchRequest as finishSearchRequestLifecycle,
  isCurrentSearchRequest,
  requestBackgroundSearchRequest,
  resetSearchRequestLifecycle,
  type SearchRequestToken,
} from './search-request-lifecycle'

type BufferedSearchStatusEvent = {
  kind: BookDownloadHubStatusEventKind
  status: BookDownloadStatus
}

type SearchRealtimeBuffer = {
  events: BufferedSearchStatusEvent[]
}

type SearchResultSnapshot = {
  books: ApiBookCardModel[]
  tags: TagEntity[]
  totalPages: number
}

type ActiveSearchRequest = {
  token: SearchRequestToken
  controller: AbortController
  buffer: SearchRealtimeBuffer
}

export type SearchExecutionOptions = {
  isWebSearch: boolean
  isLibrarySearch: boolean
  isMissingTagSearch: boolean
  apiRevision: number
  searchLimit?: number
  criteria: SearchCriteria
  hitomiAppend: HitomiAppend
  resultPage: number
  sortType: SortType
  sortDirection: SortDirection
  routeStateSynchronized: boolean
  setLibrarySearchBooks: (update: SetStateAction<ApiBookCardModel[]>) => void
  updateWebSearchResultBooks: (update: SetStateAction<ApiBookCardModel[]>) => void
}

export type SearchExecutionResult = {
  searchResponseTags: TagEntity[]
  setSearchResponseTags: Dispatch<SetStateAction<TagEntity[]>>
  searchResultGeneration: number
  searchState: 'idle' | 'loading' | 'success' | 'error'
  searchSyncFreshness: 'idle' | 'syncing' | 'fresh' | 'stale'
  searchLoaderVisible: boolean
  searchError: string
  totalResultPages: number
  refresh: () => void
}

const statusTimestampValue = (status: BookDownloadStatus | undefined) => {
  if (!status?.lastUpdated) return undefined
  const parsed = Date.parse(status.lastUpdated)
  return Number.isNaN(parsed) ? undefined : parsed
}

/** True when an event cannot be ordered against a terminal card locally. */
export const shouldReconcileSearchStatus = (
  kind: BookDownloadHubStatusEventKind,
  status: BookDownloadStatus,
) => {
  const normalizedStatus = normalizeSearchBookDownloadStatus(status, kind === 'completed')
  const isTerminalStatus = kind === 'completed'
    || normalizedStatus.executionState === 'Completed'
    || normalizedStatus.book?.status === 'Downloaded'
  return !isTerminalStatus
    && !normalizedStatus.lastUpdated
    && Boolean(getDownloadStatusIdentityKey(normalizedStatus))
}

/** Terminal and explicitly paused/stopped events bypass the frame queue. */
export const shouldApplySearchStatusImmediately = (
  kind: BookDownloadHubStatusEventKind,
  status: BookDownloadStatus,
) => {
  const executionState = status.executionState
  return kind === 'completed'
    || kind === 'failed'
    || kind === 'cancelled'
    || executionState === 'Completed'
    || executionState === 'Failed'
    || executionState === 'Cancelled'
    || executionState === 'Paused'
    || executionState === 'Stopped'
}

/** Apply events captured during a request before committing its API snapshot. */
export const applyBufferedSearchStatusesToSnapshot = (
  books: ApiBookCardModel[],
  events: readonly BufferedSearchStatusEvent[],
  versions: SearchBookStatusVersionMap,
) => applySearchBookDownloadStatuses(books, events.map((event) => event.status), versions)

export function useSearchExecution({
  isWebSearch,
  isLibrarySearch,
  isMissingTagSearch,
  apiRevision,
  searchLimit = 50,
  criteria,
  hitomiAppend,
  resultPage,
  sortType,
  sortDirection,
  routeStateSynchronized,
  setLibrarySearchBooks,
  updateWebSearchResultBooks,
}: SearchExecutionOptions): SearchExecutionResult {
  const [searchResponseTags, setSearchResponseTags] = useState<TagEntity[]>([])
  const [searchResultGeneration, setSearchResultGeneration] = useState(0)
  const [totalResultPages, setTotalResultPages] = useState(1)
  const [searchState, setSearchState] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [searchSyncFreshness, setSearchSyncFreshness] = useState<'idle' | 'syncing' | 'fresh' | 'stale'>('idle')
  const [searchLoaderVisible, setSearchLoaderVisible] = useState(false)
  const [searchError, setSearchError] = useState('')
  const [searchRevision, setSearchRevision] = useState(0)
  const tagEnrichmentRef = useRef<AbortController | null>(null)
  const activeSearchRequestRef = useRef<ActiveSearchRequest | null>(null)
  const searchRequestLifecycleRef = useRef(createSearchRequestLifecycleState())
  const requestBackgroundSearchRef = useRef<(() => void) | null>(null)
  const searchRealtimeBufferRef = useRef<SearchRealtimeBuffer | null>(null)
  const pendingSearchStatusesRef = useRef(new Map<string, BufferedSearchStatusEvent>())
  const searchRealtimeFrameRef = useRef<number | null>(null)
  const searchStatusVersionsRef = useRef<SearchBookStatusVersionMap>(new Map())
  const searchStatusReconciliationFrameRef = useRef<number | null>(null)

  const applyStatusesToActiveSearch = useCallback((statuses: BookDownloadStatus[]) => {
    if (statuses.length === 0) return
    const apply = (current: ApiBookCardModel[]) => applySearchBookDownloadStatuses(
      current,
      statuses,
      searchStatusVersionsRef.current,
    )
    if (isWebSearch) updateWebSearchResultBooks(apply)
    else if (isLibrarySearch) setLibrarySearchBooks(apply)
  }, [isLibrarySearch, isWebSearch, setLibrarySearchBooks, updateWebSearchResultBooks])

  const flushPendingSearchStatuses = useCallback(() => {
    searchRealtimeFrameRef.current = null
    const events = [...pendingSearchStatusesRef.current.values()]
    pendingSearchStatusesRef.current.clear()
    applyStatusesToActiveSearch(events.map((event) => event.status))
  }, [applyStatusesToActiveSearch])

  const scheduleSearchStatusReconciliation = useCallback(() => {
    if (searchStatusReconciliationFrameRef.current !== null) return
    searchStatusReconciliationFrameRef.current = window.requestAnimationFrame(() => {
      searchStatusReconciliationFrameRef.current = null
      requestBackgroundSearchRef.current?.()
    })
  }, [])

  const queueSearchStatus = useCallback((
    kind: BookDownloadHubStatusEventKind,
    status: BookDownloadStatus,
  ) => {
    const normalizedStatus = normalizeSearchBookDownloadStatus(status, kind === 'completed')
    if (shouldReconcileSearchStatus(kind, normalizedStatus)) {
      // Without a timestamp, a progress event cannot be ordered against a
      // completed card. Keep the terminal UI state and reconcile once for the
      // whole frame through the normal background-search lifecycle.
      scheduleSearchStatusReconciliation()
    }
    const activeBuffer = searchRealtimeBufferRef.current
    if (activeBuffer) {
      activeBuffer.events.push({ kind, status: normalizedStatus })
      return
    }

    const key = getDownloadStatusIdentityKey(normalizedStatus)
    if (!key) return
    const isCompletion = kind === 'completed' || normalizedStatus.executionState === 'Completed'
    if (shouldApplySearchStatusImmediately(kind, normalizedStatus)) {
      const pending = pendingSearchStatusesRef.current.get(key)
      const pendingTimestamp = statusTimestampValue(pending?.status)
      const nextTimestamp = statusTimestampValue(normalizedStatus)
      if (pendingTimestamp !== undefined && nextTimestamp !== undefined) {
        if (nextTimestamp < pendingTimestamp) return
        if (nextTimestamp === pendingTimestamp && !isCompletion) return
      }
      pendingSearchStatusesRef.current.delete(key)
      applyStatusesToActiveSearch([normalizedStatus])
      return
    }

    const pending = pendingSearchStatusesRef.current.get(key)
    const pendingTimestamp = statusTimestampValue(pending?.status)
    const nextTimestamp = statusTimestampValue(normalizedStatus)
    if (
      !pending
      || pendingTimestamp === undefined
      || nextTimestamp === undefined
      || nextTimestamp > pendingTimestamp
    ) {
      pendingSearchStatusesRef.current.set(key, { kind, status: normalizedStatus })
    }
    if (searchRealtimeFrameRef.current === null) {
      searchRealtimeFrameRef.current = window.requestAnimationFrame(flushPendingSearchStatuses)
    }
  }, [applyStatusesToActiveSearch, flushPendingSearchStatuses, scheduleSearchStatusReconciliation])

  const fetchSearchResults = useCallback(async (signal: AbortSignal): Promise<SearchResultSnapshot> => {
    if (!isWebSearch) {
      const validation = validateCriteria(criteria, isMissingTagSearch)
      const validationMessage = validation.date ?? validation.pages ?? validation.missingTags
      if (validationMessage) throw new ApiError(validationMessage, { category: 'validation' })
    }

    if (isWebSearch) {
      const response = await getWebPageContent(
        buildHitomiSearchUrl(criteria, hitomiAppend, resultPage),
        signal,
      )
      if (response.success === false) {
        throw new ApiError(response.message ?? 'Hitomi検索に失敗しました。', { category: 'server' })
      }
      const tags = response.tags ?? []
      const mapped = mapHitomiSearchResponse({ ...response, tags })
      return {
        books: mapped.books,
        tags,
        totalPages: mapped.totalPage,
      }
    }

    const response = await searchBooksApi(
      buildBookSearchFilter(criteria, sortType, sortDirection, resultPage, searchLimit),
      signal,
    )
    if (response.success === false) throw new ApiError(response.message ?? '検索に失敗しました。', { category: 'server' })
    const entities = response.tags ?? []
    return {
      books: (response.books ?? []).map((book) => mapEBookToCard(book, { context: 'library', entities })),
      tags: entities,
      totalPages: Math.max(1, response.totalPage ?? 1),
    }
  }, [criteria, hitomiAppend, isMissingTagSearch, isWebSearch, resultPage, sortDirection, sortType, searchLimit])

  const createSearchRequest = useCallback((token: SearchRequestToken): ActiveSearchRequest => {
    tagEnrichmentRef.current?.abort()
    const previous = activeSearchRequestRef.current
    if (previous && previous.token.id !== token.id) previous.controller.abort()
    if (searchRealtimeFrameRef.current !== null) {
      window.cancelAnimationFrame(searchRealtimeFrameRef.current)
      searchRealtimeFrameRef.current = null
    }
    const pendingEvents = [...pendingSearchStatusesRef.current.values()]
    pendingSearchStatusesRef.current.clear()
    const buffer: SearchRealtimeBuffer = {
      events: [
        ...(searchRealtimeBufferRef.current?.events ?? []),
        ...pendingEvents,
      ],
    }
    searchRealtimeBufferRef.current = buffer
    const request: ActiveSearchRequest = {
      token,
      controller: new AbortController(),
      buffer,
    }
    activeSearchRequestRef.current = request
    return request
  }, [])

  const isActiveSearchRequest = useCallback((request: ActiveSearchRequest) => (
    activeSearchRequestRef.current === request
    && isCurrentSearchRequest(searchRequestLifecycleRef.current, request.token)
  ), [])

  const applySearchResultSnapshot = useCallback((request: ActiveSearchRequest, snapshot: SearchResultSnapshot) => {
    let nextBooks = snapshot.books
    searchStatusVersionsRef.current.clear()
    if (searchRealtimeBufferRef.current === request.buffer) {
      searchRealtimeBufferRef.current = null
      nextBooks = applyBufferedSearchStatusesToSnapshot(
        nextBooks,
        request.buffer.events,
        searchStatusVersionsRef.current,
      )
    }
    if (isWebSearch) updateWebSearchResultBooks(nextBooks)
    else setLibrarySearchBooks(nextBooks)
    setSearchResponseTags(snapshot.tags)
    setTotalResultPages(snapshot.totalPages)
    setSearchResultGeneration((current) => current + 1)
  }, [isWebSearch, setLibrarySearchBooks, updateWebSearchResultBooks])

  const applyBufferedStatusesAfterFailedRequest = useCallback((request: ActiveSearchRequest) => {
    if (searchRealtimeBufferRef.current !== request.buffer) return
    searchRealtimeBufferRef.current = null
    applyStatusesToActiveSearch(request.buffer.events.map((event) => event.status))
  }, [applyStatusesToActiveSearch])

  const finishActiveSearchRequest = useCallback((request: ActiveSearchRequest) => {
    if (!isActiveSearchRequest(request)) return false
    activeSearchRequestRef.current = null
    if (searchRealtimeBufferRef.current === request.buffer) searchRealtimeBufferRef.current = null
    const result = finishSearchRequestLifecycle(searchRequestLifecycleRef.current, request.token)
    searchRequestLifecycleRef.current = result.state
    if (result.startPendingBackground) requestBackgroundSearchRef.current?.()
    return result.accepted
  }, [isActiveSearchRequest])

  const runSearchRequest = useCallback((request: ActiveSearchRequest, onFinally?: () => void) => {
    const load = async () => {
      try {
        const snapshot = await fetchSearchResults(request.controller.signal)
        if (!isActiveSearchRequest(request)) return
        applySearchResultSnapshot(request, snapshot)
        setSearchSyncFreshness('fresh')
        setSearchError('')
        setSearchState('success')
        if (isWebSearch) {
          const enrichment = new AbortController()
          tagEnrichmentRef.current = enrichment
          void resolveSearchTags(criteria.tags, snapshot.tags, enrichment.signal).then((tags) => {
            if (enrichment.signal.aborted || tagEnrichmentRef.current !== enrichment) return
            setSearchResponseTags(tags)
            updateWebSearchResultBooks((books) => books.map((book) => ({
              ...book, tags: applyTagEntityMetadata(book.tags, tags),
            })))
          })
        }
      } catch (error) {
        if (request.controller.signal.aborted || !isActiveSearchRequest(request)) return
        applyBufferedStatusesAfterFailedRequest(request)
        if (request.token.kind === 'foreground') {
          setSearchError(getErrorMessage(error))
          setSearchState('error')
        }
        setSearchSyncFreshness('stale')
      } finally {
        if (isActiveSearchRequest(request)) {
          onFinally?.()
          finishActiveSearchRequest(request)
        }
      }
    }

    void load()
  }, [applyBufferedStatusesAfterFailedRequest, applySearchResultSnapshot, criteria.tags, fetchSearchResults, finishActiveSearchRequest, isActiveSearchRequest, isWebSearch, updateWebSearchResultBooks])

  const startSearchRequest = useCallback((token: SearchRequestToken, onFinally?: () => void) => {
    const request = createSearchRequest(token)
    if (token.kind === 'background') setSearchSyncFreshness('syncing')
    runSearchRequest(request, onFinally)
    return request
  }, [createSearchRequest, runSearchRequest])

  const requestBackgroundSearch = useCallback(() => {
    if ((!isLibrarySearch && !isWebSearch) || !routeStateSynchronized || (isMissingTagSearch && !criteria.missingTagTypes?.length)) return
    // Connection/resync events never restart a foreground search or own its loader.
    const result = requestBackgroundSearchRequest(searchRequestLifecycleRef.current)
    searchRequestLifecycleRef.current = result.state
    if (result.token) startSearchRequest(result.token)
  }, [criteria.missingTagTypes, isLibrarySearch, isMissingTagSearch, isWebSearch, routeStateSynchronized, startSearchRequest])

  useEffect(() => {
    requestBackgroundSearchRef.current = requestBackgroundSearch
    return () => {
      requestBackgroundSearchRef.current = null
    }
  }, [requestBackgroundSearch])

  useEffect(() => {
    if ((!isLibrarySearch && !isWebSearch) || !routeStateSynchronized) return
    if (isMissingTagSearch && !criteria.missingTagTypes?.length) {
      activeSearchRequestRef.current?.controller.abort()
      activeSearchRequestRef.current = null
      searchRequestLifecycleRef.current = resetSearchRequestLifecycle(searchRequestLifecycleRef.current)
      searchRealtimeBufferRef.current = null
      if (searchStatusReconciliationFrameRef.current !== null) {
        window.cancelAnimationFrame(searchStatusReconciliationFrameRef.current)
        searchStatusReconciliationFrameRef.current = null
      }
      setLibrarySearchBooks([])
      setSearchResponseTags([])
      setTotalResultPages(1)
      setSearchState('idle')
      setSearchSyncFreshness('idle')
      setSearchError('')
      setSearchLoaderVisible(false)
      return
    }
    const begun = beginForegroundSearchRequest(searchRequestLifecycleRef.current)
    searchRequestLifecycleRef.current = begun.state
    setSearchState('loading')
    setSearchSyncFreshness('syncing')
    setSearchError('')
    setSearchLoaderVisible(true)
    setSearchResponseTags([])
    const request = startSearchRequest(begun.token, () => setSearchLoaderVisible(false))
    return () => {
      request.controller.abort()
      tagEnrichmentRef.current?.abort()
      searchRequestLifecycleRef.current = cancelSearchRequest(searchRequestLifecycleRef.current, request.token)
      if (activeSearchRequestRef.current === request) {
        activeSearchRequestRef.current = null
        setSearchLoaderVisible(false)
      }
    }
  }, [apiRevision, criteria, hitomiAppend, isActiveSearchRequest, isLibrarySearch, isMissingTagSearch, isWebSearch, resultPage, routeStateSynchronized, runSearchRequest, searchRevision, setLibrarySearchBooks, sortDirection, sortType, startSearchRequest])

  useEffect(() => {
    if (!isLibrarySearch && !isWebSearch) return
    const pendingSearchStatuses = pendingSearchStatusesRef.current
    const searchStatusVersions = searchStatusVersionsRef.current
    const applyCollection = (statuses: BookDownloadStatus[]) => {
      statuses.forEach((status) => queueSearchStatus('statusUpdate', status))
    }
    const unsubscribe = bookDownloadHubClient.subscribe({
      onStatus: queueSearchStatus,
      onRunningDownloads: applyCollection,
      onQueuedDownloads: applyCollection,
      onAllDownloadStatuses: (statuses) => applyCollection(Object.values(statuses)),
      onBookDownloadStatus: (status) => queueSearchStatus('statusUpdate', status),
      onResyncRequested: () => requestBackgroundSearchRef.current?.(),
    })

    return () => {
      unsubscribe()
      tagEnrichmentRef.current?.abort()
      const activeRequest = activeSearchRequestRef.current
      activeRequest?.controller.abort()
      activeSearchRequestRef.current = null
      searchRequestLifecycleRef.current = resetSearchRequestLifecycle(searchRequestLifecycleRef.current)
      searchRealtimeBufferRef.current = null
      pendingSearchStatuses.clear()
      searchStatusVersions.clear()
      if (searchRealtimeFrameRef.current !== null) {
        window.cancelAnimationFrame(searchRealtimeFrameRef.current)
        searchRealtimeFrameRef.current = null
      }
      if (searchStatusReconciliationFrameRef.current !== null) {
        window.cancelAnimationFrame(searchStatusReconciliationFrameRef.current)
        searchStatusReconciliationFrameRef.current = null
      }
      setSearchSyncFreshness('idle')
    }
  }, [isLibrarySearch, isWebSearch, queueSearchStatus])

  const refresh = useCallback(() => {
    setSearchRevision((current) => current + 1)
  }, [])

  return {
    searchResponseTags,
    setSearchResponseTags,
    searchResultGeneration,
    searchState,
    searchSyncFreshness,
    searchLoaderVisible,
    searchError,
    totalResultPages,
    refresh,
  }
}
