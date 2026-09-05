import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type SetStateAction } from 'react'

import {
  ApiError,
  autocompleteTags,
  buildBookSearchFilter,
  buildHitomiSearchUrl,
  getErrorMessage,
  getWebPageContent,
  mapEBookToCard,
  mapHitomiSearchResponse,
  searchBooks as searchBooksApi,
} from '../../api'
import type { ApiBookCardModel, DisplaySettings } from '../../api'
import type { BookDownloadHubConnectionState, BookDownloadHubStatusEventKind } from '../../realtime/book-download-hub'
import { bookDownloadHubClient } from '../../realtime/book-download-hub'
import { navigate, useRouterLocation } from '../../app/client-router'
import {
  applySearchBookDownloadStatuses,
  getDownloadStatusIdentityKey,
  normalizeSearchBookDownloadStatus,
} from '../../realtime/search-book-status'
import type { BookDownloadStatus, BookTag, HitomiAppend, NyaTagType, SearchCriteria, SortDirection, SortType, TagEntity } from '../../models'
import { getTagLabel, TAG_TYPE_ORDER } from '../../models'
import {
  cloneCriteria,
  createSearchUrlForDestination,
  createTagSearchDestinationUrls,
  criteriaHasValues,
  emptyCriteria,
  formatTagCount,
  HITOMI_SORT_PERIODS,
  normalizeCriteriaForRoute,
  parseCriteriaFromUrl,
  parseCriteriaForRoute,
  parseHitomiAppend,
  parsePageParam,
  resolveTag,
  sameTag,
  validateCriteria,
  type HitomiSortPeriod,
  type SearchDestination,
  type SearchSyncFreshness,
  type SearchValidationErrors,
} from './search-utils'
import { useSearchResults } from './useSearchResults'
import { useSearchOperations } from './useSearchOperations'
import { getBookIdentityKey } from '../library/book-deletion'
import {
  applyTagDisplayNameOverrides,
  getTagDisplayNameKey,
  updateTagDisplayNames,
  type TagDisplayNameOverrides,
  withTagDisplayName,
} from './tag-display-name'
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

type Notify = (message: string, tone?: 'success' | 'warning' | 'error') => void

type SearchControllerOptions = {
  isWebSearch: boolean
  isLibrarySearch: boolean
  isMissingTagSearch: boolean
  isBookViewer: boolean
  apiRevision: number
  displaySettings: DisplaySettings
  hubConnectionState: BookDownloadHubConnectionState
  notify: Notify
}

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

type TagSearchDestinationSelection = {
  tag: BookTag
  libraryUrl: string
  hitomiUrl: string
}

const JAPANESE_LANGUAGE_TAG: BookTag = { type: 'Languages', name: 'japanese' }

const statusTimestampValue = (status: BookDownloadStatus | undefined) => {
  if (!status?.lastUpdated) return undefined
  const parsed = Date.parse(status.lastUpdated)
  return Number.isNaN(parsed) ? undefined : parsed
}

const criteriaRouteKey = (
  criteria: SearchCriteria,
  hitomiAppend: HitomiAppend,
  resultPage: number,
  isWebSearch: boolean,
) => JSON.stringify({
  text: criteria.text,
  tags: criteria.tags.map((tag) => ({ type: tag.type, name: tag.name })),
  tagMode: criteria.tagMode,
  missingTagTypes: criteria.missingTagTypes,
  dateFrom: criteria.dateFrom,
  dateTo: criteria.dateTo,
  pagesMin: criteria.pagesMin,
  pagesMax: criteria.pagesMax,
  hitomiAppend: isWebSearch ? hitomiAppend : 'Normal',
  resultPage,
})

export function useSearchController({
  isWebSearch,
  isLibrarySearch,
  isMissingTagSearch,
  isBookViewer,
  apiRevision,
  displaySettings,
  hubConnectionState,
  notify,
}: SearchControllerOptions) {
  const routerLocation = useRouterLocation()
  const routeSearchParams = useMemo(() => new URLSearchParams(routerLocation.search), [routerLocation.search])
  const routeCriteria = useMemo(() => parseCriteriaForRoute(routeSearchParams, isWebSearch, isMissingTagSearch), [isWebSearch, isMissingTagSearch, routeSearchParams])
  const routeHitomiAppend = isWebSearch ? parseHitomiAppend(routeSearchParams) : 'Normal'
  const routeResultPage = parsePageParam(routeSearchParams.get('page'))
  const {
    librarySearchBooks,
    webSearchResultBooks,
    selected,
    setLibrarySearchBooks,
    setSelected,
    updateWebSearchResultBooks,
    replaceWebSearchBook,
    replaceWebSearchBooks,
    stateRef: searchResultsStateRef,
  } = useSearchResults()
  const [searchResponseTags, setSearchResponseTags] = useState<TagEntity[]>([])
  const searchResultBooks = isWebSearch ? webSearchResultBooks : librarySearchBooks
  const [criteria, setCriteria] = useState<SearchCriteria>(() => cloneCriteria(routeCriteria))
  const [draftMissingTagTypes, setDraftMissingTagTypes] = useState<NyaTagType[]>(() => [...(routeCriteria.missingTagTypes ?? [])])
  const [missingTagsError, setMissingTagsError] = useState(() => validateCriteria(routeCriteria, isMissingTagSearch).missingTags ?? '')
  const [query, setQuery] = useState(() => parseCriteriaFromUrl(routeSearchParams).text)
  const [selectMode, setSelectMode] = useState(false)
  const [sortType, setSortType] = useState<SortType>('uploaded')
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc')
  const [hitomiSortPeriod, setHitomiSortPeriod] = useState<HitomiSortPeriod>('recent')
  const [hitomiAppend, setHitomiAppend] = useState<HitomiAppend>(() => routeHitomiAppend)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [draftCriteria, setDraftCriteria] = useState<SearchCriteria>(() => cloneCriteria(routeCriteria))
  const [draftHitomiAppend, setDraftHitomiAppend] = useState<HitomiAppend>(() => routeHitomiAppend)
  const [advancedErrors, setAdvancedErrors] = useState<SearchValidationErrors>({})
  const [tagType, setTagType] = useState<NyaTagType>('Artists')
  const [tagInput, setTagInput] = useState('')
  const [tagInputFocused, setTagInputFocused] = useState(false)
  const [highlightedTagIndex, setHighlightedTagIndex] = useState(0)
  const [remoteTagCandidates, setRemoteTagCandidates] = useState<BookTag[]>([])
  const [searchRevision, setSearchRevision] = useState(0)
  const [searchState, setSearchState] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [searchSyncFreshness, setSearchSyncFreshness] = useState<SearchSyncFreshness>('idle')
  const [searchLoaderVisible, setSearchLoaderVisible] = useState(false)
  const [searchError, setSearchError] = useState('')
  const [resultPage, setResultPageState] = useState(routeResultPage)
  const [searchResultGeneration, setSearchResultGeneration] = useState(0)
  const [totalResultPages, setTotalResultPages] = useState(1)
  const [paginationPageCount, setPaginationPageCount] = useState(() => window.innerWidth < 880 ? 5 : 7)
  const [tagSearchDestinationDialogOpen, setTagSearchDestinationDialogOpen] = useState(false)
  const [tagSearchDestinationSelection, setTagSearchDestinationSelection] = useState<TagSearchDestinationSelection>()
  const [tagDisplayNameOverrides, setTagDisplayNameOverrides] = useState<TagDisplayNameOverrides>(
    () => new Map(),
  )
  const advancedDialogRef = useRef<HTMLDialogElement>(null)
  const advancedTriggerRef = useRef<HTMLButtonElement>(null)
  const tagSearchDestinationDialogRef = useRef<HTMLDialogElement>(null)
  const tagSearchDestinationTriggerRef = useRef<HTMLButtonElement | null>(null)
  const activeSearchRequestRef = useRef<ActiveSearchRequest | null>(null)
  const searchRequestLifecycleRef = useRef(createSearchRequestLifecycleState())
  const requestBackgroundSearchRef = useRef<(() => void) | null>(null)
  const searchRealtimeBufferRef = useRef<SearchRealtimeBuffer | null>(null)
  const pendingSearchStatusesRef = useRef(new Map<string, BufferedSearchStatusEvent>())
  const searchRealtimeFrameRef = useRef<number | null>(null)
  const searchStatusVersionsRef = useRef(new Map<string, number>())
  const searchStatusReconciliationFrameRef = useRef<number | null>(null)
  const currentSearchDestination: SearchDestination = isWebSearch ? 'hitomi' : isMissingTagSearch ? 'missing-tags' : 'library'
  const routeStateSynchronized = !isLibrarySearch && !isWebSearch
    ? true
    : criteriaRouteKey(criteria, hitomiAppend, resultPage, isWebSearch)
      === criteriaRouteKey(routeCriteria, routeHitomiAppend, routeResultPage, isWebSearch)

  const setResultPage = useCallback((value: SetStateAction<number>) => {
    const nextPage = Math.max(1, Math.floor(typeof value === 'function' ? value(resultPage) : value))
    if (nextPage === resultPage) return
    const url = new URL(routerLocation.href)
    url.searchParams.set('page', String(nextPage))
    navigate(url)
  }, [resultPage, routerLocation.href])

  const navigateSearchUrl = useCallback((url: URL) => {
    if (url.href === routerLocation.href) {
      setSearchRevision((current) => current + 1)
      return
    }
    navigate(url)
  }, [routerLocation.href])

  const changeHitomiAppend = useCallback((next: HitomiAppend) => {
    if (!isWebSearch || next === hitomiAppend) return
    const url = createSearchUrlForDestination(criteria, {
      destination: currentSearchDestination,
      hitomiAppend: next,
    })
    navigateSearchUrl(url)
  }, [criteria, currentSearchDestination, hitomiAppend, isWebSearch, navigateSearchUrl])

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

  const applyTagDisplayName = useCallback((tag: BookTag, displayName?: string) => {
    setTagDisplayNameOverrides((current) => {
      const key = getTagDisplayNameKey(tag)
      if (current.has(key) && current.get(key) === displayName) return current
      const next = new Map(current)
      next.set(key, displayName)
      return next
    })
    setLibrarySearchBooks((current) => current.map((book) => {
      const tags = updateTagDisplayNames(book.tags, tag, displayName)
      return tags === book.tags ? book : { ...book, tags }
    }))
    updateWebSearchResultBooks((current) => current.map((book) => {
      const tags = updateTagDisplayNames(book.tags, tag, displayName)
      return tags === book.tags ? book : { ...book, tags }
    }))
    setSearchResponseTags((current) => updateTagDisplayNames(current, tag, displayName))
    setCriteria((current) => ({
      ...current,
      tags: updateTagDisplayNames(current.tags, tag, displayName),
    }))
    setDraftCriteria((current) => ({
      ...current,
      tags: updateTagDisplayNames(current.tags, tag, displayName),
    }))
    setTagSearchDestinationSelection((current) => {
      if (!current || !sameTag(current.tag, tag)) return current
      return { ...current, tag: withTagDisplayName(current.tag, displayName) }
    })
  }, [setLibrarySearchBooks, updateWebSearchResultBooks])

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
    const isTerminalStatus = kind === 'completed'
      || normalizedStatus.executionState === 'Completed'
      || normalizedStatus.book?.status === 'Downloaded'
    if (!isTerminalStatus && !normalizedStatus.lastUpdated && getDownloadStatusIdentityKey(normalizedStatus)) {
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
    const executionState = normalizedStatus.executionState
    const isCompletion = kind === 'completed' || executionState === 'Completed'
    const applyImmediately = kind === 'completed'
      || kind === 'failed'
      || kind === 'cancelled'
      || executionState === 'Completed'
      || executionState === 'Failed'
      || executionState === 'Cancelled'
      || executionState === 'Paused'
      || executionState === 'Stopped'
    if (applyImmediately) {
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
      const mapped = mapHitomiSearchResponse(response)
      return {
        books: mapped.books,
        tags: response.tags ?? [],
        totalPages: mapped.totalPage,
      }
    }

    const response = await searchBooksApi(
      buildBookSearchFilter(criteria, sortType, sortDirection, resultPage),
      signal,
    )
    if (response.success === false) throw new ApiError(response.message ?? '検索に失敗しました。', { category: 'server' })
    const entities = response.tags ?? []
    return {
      books: (response.books ?? []).map((book) => mapEBookToCard(book, { context: 'library', entities })),
      tags: entities,
      totalPages: Math.max(1, response.totalPage ?? 1),
    }
  }, [criteria, hitomiAppend, isMissingTagSearch, isWebSearch, resultPage, sortDirection, sortType])

  const createSearchRequest = useCallback((token: SearchRequestToken): ActiveSearchRequest => {
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
      nextBooks = applySearchBookDownloadStatuses(
        nextBooks,
        request.buffer.events.map((event) => event.status),
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
  }, [applyBufferedStatusesAfterFailedRequest, applySearchResultSnapshot, fetchSearchResults, finishActiveSearchRequest, isActiveSearchRequest])

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
  }, [isLibrarySearch, isWebSearch, isMissingTagSearch, criteria.missingTagTypes, routeStateSynchronized, startSearchRequest])

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
    let loadingTimer: number | null = null
    setSearchState('loading')
    setSearchSyncFreshness('syncing')
    setSearchError('')
    setSearchLoaderVisible(false)
    setSearchResponseTags([])
    const request = startSearchRequest(begun.token, () => {
      if (loadingTimer !== null) window.clearTimeout(loadingTimer)
      loadingTimer = null
      setSearchLoaderVisible(false)
    })
    loadingTimer = window.setTimeout(() => {
      if (!request.controller.signal.aborted && isActiveSearchRequest(request)) setSearchLoaderVisible(true)
    }, 1000)
    return () => {
      request.controller.abort()
      if (loadingTimer !== null) window.clearTimeout(loadingTimer)
      loadingTimer = null
      searchRequestLifecycleRef.current = cancelSearchRequest(searchRequestLifecycleRef.current, request.token)
      if (activeSearchRequestRef.current === request) {
        activeSearchRequestRef.current = null
        setSearchLoaderVisible(false)
      }
    }
  }, [apiRevision, criteria, hitomiAppend, isActiveSearchRequest, isLibrarySearch, isMissingTagSearch, isWebSearch, resultPage, routeStateSynchronized, routerLocation.pathname, routerLocation.search, runSearchRequest, searchRevision, setLibrarySearchBooks, sortDirection, sortType, startSearchRequest])

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

  useEffect(() => {
    const queryValue = tagInput.trim()
    if (!tagInputFocused || !queryValue) {
      setRemoteTagCandidates([])
      return
    }
    const controller = new AbortController()
    autocompleteTags(queryValue, tagType, controller.signal)
      .then((response) => {
        setRemoteTagCandidates((response.tags ?? []).flatMap((suggestion) => {
          const type = suggestion.tagType as NyaTagType
          if (!suggestion.name || !TAG_TYPE_ORDER.includes(type)) return []
          return [{ type, name: suggestion.name, displayName: suggestion.displayName, count: suggestion.count }]
        }))
      })
      .catch(() => {
        if (!controller.signal.aborted) setRemoteTagCandidates([])
      })
    return () => controller.abort()
  }, [apiRevision, tagInput, tagInputFocused, tagType])

  useEffect(() => {
    const updatePaginationPageCount = () => setPaginationPageCount(window.innerWidth < 880 ? 5 : 7)
    window.addEventListener('resize', updatePaginationPageCount)
    return () => window.removeEventListener('resize', updatePaginationPageCount)
  }, [])

  useEffect(() => {
    if (!isLibrarySearch && !isWebSearch) return
    setCriteria(cloneCriteria(routeCriteria))
    setQuery(routeCriteria.text)
    setDraftMissingTagTypes([...(routeCriteria.missingTagTypes ?? [])])
    setMissingTagsError(validateCriteria(routeCriteria, isMissingTagSearch).missingTags ?? '')
    setDraftCriteria(cloneCriteria(routeCriteria))
    setHitomiAppend(routeHitomiAppend)
    setDraftHitomiAppend(routeHitomiAppend)
    setResultPageState(routeResultPage)
    setAdvancedErrors({})
    setSelected([])
  }, [isLibrarySearch, isWebSearch, isMissingTagSearch, routeCriteria, routeHitomiAppend, routeResultPage, routerLocation.pathname, routerLocation.search, setSelected])

  useEffect(() => {
    if (routerLocation.revision === 0) return
    setAdvancedOpen(false)
    setTagSearchDestinationDialogOpen(false)
  }, [routerLocation.revision])

  const displayedSearchResultBooks = useMemo(() => searchResultBooks.map((book) => {
    const tags = applyTagDisplayNameOverrides(book.tags, tagDisplayNameOverrides)
    return tags === book.tags ? book : { ...book, tags }
  }), [searchResultBooks, tagDisplayNameOverrides])

  // The missing-tag API evaluates ordinary conditions together with the missing types.
  const filteredBooks = isWebSearch || isMissingTagSearch ? displayedSearchResultBooks : displayedSearchResultBooks.filter((book) => {
    const normalizedQuery = criteria.text.trim().toLocaleLowerCase()
    if (normalizedQuery) {
      const searchableText = [
        book.title,
        ...book.tags.flatMap((tag) => [tag.name, getTagLabel(tag)]),
      ].join(' ').toLocaleLowerCase()
      if (!searchableText.includes(normalizedQuery)) return false
    }

    if (criteria.tags.length) {
      const tagMatches = criteria.tags.map((selectedTag) => book.tags.some((bookTag) => sameTag(bookTag, selectedTag)))
      if (criteria.tagMode === 'and' ? tagMatches.some((matches) => !matches) : tagMatches.every((matches) => !matches)) return false
    }

    const bookDate = book.uploadedTime.slice(0, 10)
    if (criteria.dateFrom && bookDate < criteria.dateFrom) return false
    if (criteria.dateTo && bookDate > criteria.dateTo) return false
    if (criteria.pagesMin && book.totalPage < Number(criteria.pagesMin)) return false
    if (criteria.pagesMax && book.totalPage > Number(criteria.pagesMax)) return false
    return true
  })
  const visibleBooks = filteredBooks
  const hasCriteria = criteriaHasValues(criteria)
  const localTagCandidates = displayedSearchResultBooks
    .flatMap((book) => book.tags)
    .filter((tag) => tag.type === tagType)
    .filter((tag, index, all) => all.findIndex((candidate) => candidate.type === tag.type && candidate.name === tag.name) === index)
    .filter((tag) => !draftCriteria.tags.some((selectedTag) => sameTag(selectedTag, tag)))
    .filter((tag) => {
      const normalizedInput = tagInput.trim().toLocaleLowerCase()
      if (!normalizedInput) return true
      return getTagLabel(tag).toLocaleLowerCase().includes(normalizedInput) || tag.name.toLocaleLowerCase().includes(normalizedInput)
    })
    .slice(0, 8)
  const tagCandidates = tagInput.trim() ? remoteTagCandidates : localTagCandidates
  const showTagCandidates = tagInputFocused && tagCandidates.length > 0
  const japaneseLanguageEnabled = criteria.tags.some((tag) => sameTag(tag, JAPANESE_LANGUAGE_TAG))

  const submitSearch = useCallback((event: FormEvent) => {
    event.preventDefault()
    const nextCriteria: SearchCriteria = isMissingTagSearch ? {
      ...cloneCriteria(criteria),
      text: query.trim(),
      missingTagTypes: [...draftMissingTagTypes],
    } : {
      ...emptyCriteria(),
      text: query.trim(),
      tags: isWebSearch && japaneseLanguageEnabled ? [JAPANESE_LANGUAGE_TAG] : [],
    }
    const errors = validateCriteria(nextCriteria, isMissingTagSearch)
    setMissingTagsError(errors.missingTags ?? '')
    if (errors.missingTags) return
    if (isMissingTagSearch) setQuery(nextCriteria.text)
    const url = createSearchUrlForDestination(nextCriteria, {
      destination: currentSearchDestination,
      hitomiAppend: isWebSearch ? hitomiAppend : undefined,
    })
    navigateSearchUrl(url)
  }, [criteria, draftMissingTagTypes, isMissingTagSearch, currentSearchDestination, hitomiAppend, isWebSearch, japaneseLanguageEnabled, navigateSearchUrl, query])

  const searchByTag = useCallback((tag: BookTag) => {
    const resolvedTag = resolveTag(tag)
    const nextTags = [resolvedTag]
    if (isWebSearch && japaneseLanguageEnabled && !sameTag(resolvedTag, JAPANESE_LANGUAGE_TAG)) {
      nextTags.push(JAPANESE_LANGUAGE_TAG)
    }
    const nextCriteria: SearchCriteria = { ...emptyCriteria(), tags: nextTags, ...(isMissingTagSearch ? { missingTagTypes: [...(criteria.missingTagTypes ?? [])] } : {}) }
    const url = createSearchUrlForDestination(nextCriteria, {
      destination: currentSearchDestination,
      hitomiAppend: isWebSearch ? hitomiAppend : undefined,
    })
    navigateSearchUrl(url)
  }, [criteria.missingTagTypes, isMissingTagSearch, currentSearchDestination, hitomiAppend, isWebSearch, japaneseLanguageEnabled, navigateSearchUrl])

  const openTagSearchDestination = useCallback((tag: BookTag, trigger: HTMLButtonElement) => {
    const resolvedTag = resolveTag(tag)
    const urls = createTagSearchDestinationUrls(resolvedTag, {
      japaneseLanguageEnabled: isWebSearch ? japaneseLanguageEnabled : true,
      hitomiAppend: isWebSearch ? hitomiAppend : 'Normal',
    })
    tagSearchDestinationTriggerRef.current = trigger
    setTagSearchDestinationSelection({
      tag: resolvedTag,
      libraryUrl: urls.library.toString(),
      hitomiUrl: urls.hitomi.toString(),
    })
    setTagSearchDestinationDialogOpen(true)
  }, [hitomiAppend, isWebSearch, japaneseLanguageEnabled])

  const requestTagSearchDestinationClose = useCallback(() => {
    setTagSearchDestinationDialogOpen(false)
    return true
  }, [])

  const afterTagSearchDestinationClose = useCallback(() => {
    setTagSearchDestinationSelection(undefined)
  }, [])

  const resolveTagSearchDestinationRestoreFocus = useCallback(() => {
    const trigger = tagSearchDestinationTriggerRef.current
    tagSearchDestinationTriggerRef.current = null
    return trigger
  }, [])

  const toggleJapaneseLanguage = useCallback(() => {
    if (!isWebSearch) return
    const nextTags = japaneseLanguageEnabled
      ? criteria.tags.filter((tag) => !sameTag(tag, JAPANESE_LANGUAGE_TAG))
      : [...criteria.tags, JAPANESE_LANGUAGE_TAG]
    const nextCriteria: SearchCriteria = {
      ...criteria,
      tags: nextTags,
      tagMode: 'and',
    }
    const url = createSearchUrlForDestination(nextCriteria, {
      destination: currentSearchDestination,
      hitomiAppend,
    })
    navigateSearchUrl(url)
  }, [criteria, currentSearchDestination, hitomiAppend, isWebSearch, japaneseLanguageEnabled, navigateSearchUrl])

  const openAdvancedSearch = useCallback(() => {
    setDraftCriteria(cloneCriteria(normalizeCriteriaForRoute(isMissingTagSearch
      ? { ...criteria, text: query, missingTagTypes: [...draftMissingTagTypes] }
      : criteria, isWebSearch, isMissingTagSearch)))
    setDraftHitomiAppend(isWebSearch ? hitomiAppend : 'Normal')
    setAdvancedErrors({})
    setTagType('Artists')
    setTagInput('')
    setTagInputFocused(false)
    setHighlightedTagIndex(0)
    setAdvancedOpen(true)
  }, [criteria, draftMissingTagTypes, query, isMissingTagSearch, hitomiAppend, isWebSearch])

  const requestAdvancedClose = useCallback((_reason: 'escape' | 'backdrop' | 'close-button' | 'submit' | 'programmatic') => {
    setAdvancedOpen(false)
    return true
  }, [])

  const afterAdvancedClose = useCallback(() => {
    setTagInputFocused(false)
  }, [])

  const resolveAdvancedRestoreFocus = useCallback((reason: 'escape' | 'backdrop' | 'close-button' | 'submit' | 'programmatic') => {
    if (reason === 'submit') return document.getElementById('results-region')
    if (reason === 'escape' || reason === 'backdrop' || reason === 'close-button') return advancedTriggerRef.current
    return null
  }, [])

  const clearAdvancedDraft = useCallback(() => {
    setDraftCriteria((current) => ({ ...emptyCriteria(), ...(isMissingTagSearch ? { missingTagTypes: [...(current.missingTagTypes ?? [])] } : {}) }))
    setDraftHitomiAppend('Normal')
    setAdvancedErrors({})
    setTagType('Artists')
    setTagInput('')
    setHighlightedTagIndex(0)
  }, [isMissingTagSearch])

  const selectDraftTag = useCallback((tag: BookTag) => {
    setDraftCriteria((current) => ({
      ...current,
      tags: current.tags.some((selectedTag) => sameTag(selectedTag, tag))
        ? current.tags
        : [...current.tags, resolveTag(tag)],
      tagMode: isWebSearch ? 'and' : current.tagMode,
    }))
    setTagInput('')
    setHighlightedTagIndex(0)
    setTagInputFocused(true)
  }, [isWebSearch])

  const removeDraftTag = useCallback((tag: BookTag) => {
    setDraftCriteria((current) => ({ ...current, tags: current.tags.filter((selectedTag) => !sameTag(selectedTag, tag)) }))
  }, [])

  const applyAdvancedSearch = useCallback((event: FormEvent<HTMLFormElement>, requestClose: (reason: 'escape' | 'backdrop' | 'close-button' | 'submit' | 'programmatic') => boolean) => {
    event.preventDefault()
    const errors = isWebSearch ? {} : validateCriteria(draftCriteria, isMissingTagSearch)
    setAdvancedErrors(errors)
    if (!isWebSearch && (errors.date || errors.pages || errors.missingTags)) return

    const nextHitomiAppend: HitomiAppend = isWebSearch ? draftHitomiAppend : 'Normal'
    const nextCriteria: SearchCriteria = {
      ...draftCriteria,
      text: draftCriteria.text.trim(),
      dateFrom: isWebSearch ? '' : draftCriteria.dateFrom.trim(),
      dateTo: isWebSearch ? '' : draftCriteria.dateTo.trim(),
      pagesMin: isWebSearch ? '' : draftCriteria.pagesMin.trim(),
      pagesMax: isWebSearch ? '' : draftCriteria.pagesMax.trim(),
      tagMode: isWebSearch ? 'and' : draftCriteria.tagMode,
      tags: draftCriteria.tags.map((tag) => resolveTag(tag)),
    }
    const url = createSearchUrlForDestination(nextCriteria, {
      destination: currentSearchDestination,
      hitomiAppend: isWebSearch ? nextHitomiAppend : undefined,
    })
    if (isMissingTagSearch) {
      setQuery(nextCriteria.text)
      setDraftMissingTagTypes([...(nextCriteria.missingTagTypes ?? [])])
      setMissingTagsError('')
    }
    navigateSearchUrl(url)
    requestClose('submit')
  }, [currentSearchDestination, draftCriteria, draftHitomiAppend, isWebSearch, isMissingTagSearch, navigateSearchUrl])

  const refresh = useCallback(() => {
    setSearchRevision((current) => current + 1)
  }, [])

  const searchOperationScopeKey = `${routerLocation.pathname}\u0000${routerLocation.search}`
  const searchOperations = useSearchOperations({
    isWebSearch,
    apiRevision,
    routeKey: searchOperationScopeKey,
    librarySearchBooks,
    webSearchResultBooks,
    selected,
    searchResultsRef: searchResultsStateRef,
    setLibrarySearchBooks,
    setSelected,
    updateWebSearchResultBooks,
    replaceWebSearchBook,
    replaceWebSearchBooks,
    refreshSearch: refresh,
    notify,
  })

  const goToResultPage = useCallback((page: number) => {
    const nextPage = Math.min(totalResultPages, Math.max(1, page))
    setSelected([])
    setResultPage(nextPage)
  }, [setResultPage, setSelected, totalResultPages])

  const toggleSelectMode = useCallback(() => {
    setSelectMode((current) => !current)
    setSelected([])
  }, [setSelected])

  const toggleSelection = useCallback((bookId: string) => {
    setSelected((current) => current.includes(bookId) ? current.filter((item) => item !== bookId) : [...current, bookId])
  }, [setSelected])

  const selectAllVisibleBooks = useCallback(() => {
    setSelected((current) => {
      const next = new Set(current)
      visibleBooks.forEach((book) => next.add(getBookIdentityKey(book)))
      return [...next]
    })
  }, [setSelected, visibleBooks])

  return {
    isWebSearch,
    isLibrarySearch,
    isMissingTagSearch,
    draftMissingTagTypes,
    setDraftMissingTagTypes,
    missingTagsError,
    setMissingTagsError,
    isBookViewer,
    criteria,
    query,
    setQuery,
    selected,
    selectMode,
    sortType,
    sortDirection,
    hitomiSortPeriod,
    hitomiAppend,
    advancedOpen,
    draftCriteria,
    draftHitomiAppend,
    advancedErrors,
    tagType,
    tagInput,
    tagInputFocused,
    highlightedTagIndex,
    tagCandidates,
    showTagCandidates,
    searchResultBooks,
    searchResultGeneration,
    searchResponseTags,
    visibleBooks,
    hasCriteria,
    searchState,
    searchError,
    searchLoaderVisible,
    searchLoadingAnnouncement: isWebSearch ? 'Hitomi検索結果を読み込み中' : '検索結果を読み込み中',
    totalResultPages,
    resultPage,
    setResultPage,
    paginationPageCount,
    displaySettings,
    searchSyncFreshness,
    hubConnectionState,
    advancedDialogRef,
    advancedTriggerRef,
    tagSearchDestinationDialogRef,
    tagSearchDestinationDialogOpen,
    tagSearchDestinationSelection,
    tagDisplayNameOverrides,
    ...searchOperations,
    submitSearch,
    searchByTag,
    openTagSearchDestination,
    applyTagDisplayName,
    requestTagSearchDestinationClose,
    afterTagSearchDestinationClose,
    resolveTagSearchDestinationRestoreFocus,
    japaneseLanguageEnabled,
    toggleJapaneseLanguage,
    changeHitomiAppend,
    openAdvancedSearch,
    requestAdvancedClose,
    afterAdvancedClose,
    resolveAdvancedRestoreFocus,
    applyAdvancedSearch,
    clearAdvancedDraft,
    selectDraftTag,
    removeDraftTag,
    setDraftCriteria,
    setDraftHitomiAppend,
    setTagType,
    setTagInput,
    setTagInputFocused,
    setHighlightedTagIndex,
    setAdvancedErrors,
    setHitomiSortPeriod,
    setSortType,
    setSortDirection,
    toggleSelection,
    selectAllVisibleBooks,
    toggleSelectMode,
    refresh,
    goToResultPage,
  }
}

export type SearchController = ReturnType<typeof useSearchController>
export { HITOMI_SORT_PERIODS, formatTagCount }
