import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type SetStateAction } from 'react'

import {
  ApiError,
  autocompleteTags,
  buildBookSearchFilter,
  buildHitomiSearchUrl,
  getErrorMessage,
  getWebBookContent,
  getWebPageContent,
  mapEBookToCard,
  mapHitomiSearchResponse,
  mapOnlineBookToCard,
  requestBlob,
  searchBooks as searchBooksApi,
  startBookDownload,
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
import type { BookCardModel, BookDownloadStatus, BookTag, HitomiAppend, NyaTagType, SearchCriteria, SortDirection, SortType, TagEntity } from '../../models'
import { getTagLabel, HITOMI_APPENDS, TAG_TYPE_ORDER } from '../../models'
import { getBookIdentityKey, deleteBookAndWait } from '../library/book-deletion'
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
} from './search-utils'
import { findSearchBookIndex } from './search-book-download'
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
  dateFrom: criteria.dateFrom,
  dateTo: criteria.dateTo,
  pagesMin: criteria.pagesMin,
  pagesMax: criteria.pagesMax,
  hitomiAppend: isWebSearch ? hitomiAppend : 'Normal',
  resultPage,
})

const overlaySavedBookStatuses = async (
  books: ApiBookCardModel[],
  signal?: AbortSignal,
) => {
  const idsByGroup = new Map<string, Set<string>>()
  books.forEach((book) => {
    const groupId = book.apiGroupId?.trim()
    const bookId = book.apiBookId?.trim()
    if (!groupId || !bookId) return
    const ids = idsByGroup.get(groupId) ?? new Set<string>()
    ids.add(bookId)
    idsByGroup.set(groupId, ids)
  })
  if (idsByGroup.size === 0) return books

  const responses = await Promise.all([...idsByGroup].map(async ([groupId, ids]) => {
    const response = await searchBooksApi({
      bookGroups: [groupId],
      bookIds: [...ids],
      isAnd: true,
      limit: Math.max(1, ids.size),
      page: 1,
    }, signal)
    if (response.success === false) {
      throw new ApiError(response.message ?? '保存済みBookの状態を取得できませんでした。', { category: 'server' })
    }
    return response
  }))

  const savedBooks = new Map<string, Pick<ApiBookCardModel, 'status' | 'thumbnailRequest'>>()
  responses.forEach((response) => {
    response.books?.forEach((book) => {
      const mapped = mapEBookToCard(book, { context: 'library', entities: response.tags ?? [] })
      const groupId = mapped.apiGroupId?.trim()
      const bookId = mapped.apiBookId?.trim()
      if (groupId && bookId) {
        savedBooks.set(`${groupId}\u0000${bookId}`, {
          status: mapped.status,
          thumbnailRequest: mapped.thumbnailRequest,
        })
      }
    })
  })

  return books.map((book) => {
    const groupId = book.apiGroupId?.trim()
    const bookId = book.apiBookId?.trim()
    const saved = groupId && bookId ? savedBooks.get(`${groupId}\u0000${bookId}`) : undefined
    if (!saved) return book
    return {
      ...book,
      status: saved.status,
      thumbnailRequest: saved.thumbnailRequest ?? book.thumbnailRequest,
    }
  })
}

export function useSearchController({
  isWebSearch,
  isLibrarySearch,
  isBookViewer,
  apiRevision,
  displaySettings,
  hubConnectionState,
  notify,
}: SearchControllerOptions) {
  const routerLocation = useRouterLocation()
  const routeSearchParams = useMemo(() => new URLSearchParams(routerLocation.search), [routerLocation.search])
  const routeCriteria = useMemo(() => parseCriteriaForRoute(routeSearchParams, isWebSearch), [isWebSearch, routeSearchParams])
  const routeHitomiAppend = isWebSearch ? parseHitomiAppend(routeSearchParams) : 'Normal'
  const routeResultPage = parsePageParam(routeSearchParams.get('page'))
  const [librarySearchBooks, setLibrarySearchBooks] = useState<ApiBookCardModel[]>([])
  const [webSearchResultBooks, setWebSearchResultBooks] = useState<ApiBookCardModel[]>([])
  const [searchResponseTags, setSearchResponseTags] = useState<TagEntity[]>([])
  const searchResultBooks = isWebSearch ? webSearchResultBooks : librarySearchBooks
  const [criteria, setCriteria] = useState<SearchCriteria>(() => cloneCriteria(routeCriteria))
  const [query, setQuery] = useState(() => parseCriteriaFromUrl(routeSearchParams).text)
  const [selected, setSelected] = useState<string[]>([])
  const [selectMode, setSelectMode] = useState(false)
  const [sortType, setSortType] = useState<SortType>('uploaded')
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc')
  const [hitomiSortPeriod, setHitomiSortPeriod] = useState<HitomiSortPeriod>('recent')
  const [hitomiAppend, setHitomiAppend] = useState<HitomiAppend>(() => routeHitomiAppend)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [draftCriteria, setDraftCriteria] = useState<SearchCriteria>(() => cloneCriteria(routeCriteria))
  const [draftHitomiAppend, setDraftHitomiAppend] = useState<HitomiAppend>(() => routeHitomiAppend)
  const [advancedErrors, setAdvancedErrors] = useState<{ date?: string; pages?: string }>({})
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
  const [deleteDialogBooks, setDeleteDialogBooks] = useState<ApiBookCardModel[]>([])
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [deleteDialogPending, setDeleteDialogPending] = useState(false)
  const [deleteDialogError, setDeleteDialogError] = useState('')
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
  const webSearchResultBooksRef = useRef<ApiBookCardModel[]>([])
  const deleteDialogRef = useRef<HTMLDialogElement>(null)
  const deleteDialogTriggerRef = useRef<HTMLElement | null>(null)
  const deleteDialogPendingRef = useRef(false)
  const currentSearchDestination: SearchDestination = isWebSearch ? 'hitomi' : 'library'
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

  const updateWebSearchResultBooks = useCallback((
    update: ApiBookCardModel[] | ((current: ApiBookCardModel[]) => ApiBookCardModel[]),
  ) => {
    const current = webSearchResultBooksRef.current
    const next = typeof update === 'function' ? update(current) : update
    webSearchResultBooksRef.current = next
    setWebSearchResultBooks(next)
  }, [])

  const applyStatusesToActiveSearch = useCallback((statuses: BookDownloadStatus[]) => {
    if (statuses.length === 0) return
    const apply = (current: ApiBookCardModel[]) => applySearchBookDownloadStatuses(
      current,
      statuses,
      searchStatusVersionsRef.current,
    )
    if (isWebSearch) updateWebSearchResultBooks(apply)
    else if (isLibrarySearch) setLibrarySearchBooks(apply)
  }, [isLibrarySearch, isWebSearch, updateWebSearchResultBooks])

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
  }, [updateWebSearchResultBooks])

  const flushPendingSearchStatuses = useCallback(() => {
    searchRealtimeFrameRef.current = null
    const events = [...pendingSearchStatusesRef.current.values()]
    pendingSearchStatusesRef.current.clear()
    applyStatusesToActiveSearch(events.map((event) => event.status))
  }, [applyStatusesToActiveSearch])

  const queueSearchStatus = useCallback((
    kind: BookDownloadHubStatusEventKind,
    status: BookDownloadStatus,
  ) => {
    const normalizedStatus = normalizeSearchBookDownloadStatus(status, kind === 'completed')
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
  }, [applyStatusesToActiveSearch, flushPendingSearchStatuses])

  const fetchSearchResults = useCallback(async (signal: AbortSignal): Promise<SearchResultSnapshot> => {
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
  }, [criteria, hitomiAppend, isWebSearch, resultPage, sortDirection, sortType])

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
  }, [isWebSearch, updateWebSearchResultBooks])

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
    if (!isLibrarySearch && !isWebSearch) return
    // Connection/resync events never restart a foreground search or own its loader.
    const result = requestBackgroundSearchRequest(searchRequestLifecycleRef.current)
    searchRequestLifecycleRef.current = result.state
    if (result.token) startSearchRequest(result.token)
  }, [isLibrarySearch, isWebSearch, startSearchRequest])

  useEffect(() => {
    requestBackgroundSearchRef.current = requestBackgroundSearch
    return () => {
      requestBackgroundSearchRef.current = null
    }
  }, [requestBackgroundSearch])

  useEffect(() => {
    if ((!isLibrarySearch && !isWebSearch) || !routeStateSynchronized) return
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
  }, [apiRevision, criteria, hitomiAppend, isActiveSearchRequest, isLibrarySearch, isWebSearch, resultPage, routeStateSynchronized, routerLocation.pathname, routerLocation.search, runSearchRequest, searchRevision, sortDirection, sortType, startSearchRequest])

  useEffect(() => {
    if (!isLibrarySearch && !isWebSearch) return
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
      pendingSearchStatusesRef.current.clear()
      searchStatusVersionsRef.current.clear()
      if (searchRealtimeFrameRef.current !== null) {
        window.cancelAnimationFrame(searchRealtimeFrameRef.current)
        searchRealtimeFrameRef.current = null
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
    setDraftCriteria(cloneCriteria(routeCriteria))
    setHitomiAppend(routeHitomiAppend)
    setDraftHitomiAppend(routeHitomiAppend)
    setResultPageState(routeResultPage)
    setAdvancedErrors({})
    setSelected([])
  }, [isLibrarySearch, isWebSearch, routeCriteria, routeHitomiAppend, routeResultPage, routerLocation.pathname, routerLocation.search])

  useEffect(() => {
    if (routerLocation.revision === 0) return
    setAdvancedOpen(false)
    setTagSearchDestinationDialogOpen(false)
    if (!deleteDialogPendingRef.current) setDeleteDialogOpen(false)
  }, [routerLocation.revision])

  const displayedSearchResultBooks = useMemo(() => searchResultBooks.map((book) => {
    const tags = applyTagDisplayNameOverrides(book.tags, tagDisplayNameOverrides)
    return tags === book.tags ? book : { ...book, tags }
  }), [searchResultBooks, tagDisplayNameOverrides])

  const filteredBooks = isWebSearch ? displayedSearchResultBooks : displayedSearchResultBooks.filter((book) => {
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
    const nextCriteria: SearchCriteria = {
      ...emptyCriteria(),
      text: query.trim(),
      tags: isWebSearch && japaneseLanguageEnabled ? [JAPANESE_LANGUAGE_TAG] : [],
    }
    const url = createSearchUrlForDestination(nextCriteria, {
      destination: currentSearchDestination,
      hitomiAppend: isWebSearch ? hitomiAppend : undefined,
    })
    navigateSearchUrl(url)
  }, [currentSearchDestination, hitomiAppend, isWebSearch, japaneseLanguageEnabled, navigateSearchUrl, query])

  const searchByTag = useCallback((tag: BookTag) => {
    const resolvedTag = resolveTag(tag)
    const nextTags = [resolvedTag]
    if (isWebSearch && japaneseLanguageEnabled && !sameTag(resolvedTag, JAPANESE_LANGUAGE_TAG)) {
      nextTags.push(JAPANESE_LANGUAGE_TAG)
    }
    const nextCriteria: SearchCriteria = { ...emptyCriteria(), tags: nextTags }
    const url = createSearchUrlForDestination(nextCriteria, {
      destination: currentSearchDestination,
      hitomiAppend: isWebSearch ? hitomiAppend : undefined,
    })
    navigateSearchUrl(url)
  }, [currentSearchDestination, hitomiAppend, isWebSearch, japaneseLanguageEnabled, navigateSearchUrl])

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
    setDraftCriteria(cloneCriteria(normalizeCriteriaForRoute(criteria, isWebSearch)))
    setDraftHitomiAppend(isWebSearch ? hitomiAppend : 'Normal')
    setAdvancedErrors({})
    setTagType('Artists')
    setTagInput('')
    setTagInputFocused(false)
    setHighlightedTagIndex(0)
    setAdvancedOpen(true)
  }, [criteria, hitomiAppend, isWebSearch])

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
    setDraftCriteria(emptyCriteria())
    setDraftHitomiAppend('Normal')
    setAdvancedErrors({})
    setTagType('Artists')
    setTagInput('')
    setHighlightedTagIndex(0)
  }, [])

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
    const errors = isWebSearch ? {} : validateCriteria(draftCriteria)
    setAdvancedErrors(errors)
    if (!isWebSearch && (errors.date || errors.pages)) return

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
    navigateSearchUrl(url)
    requestClose('submit')
  }, [currentSearchDestination, draftCriteria, draftHitomiAppend, isWebSearch, navigateSearchUrl])

  const fetchWebBook = useCallback(async (book: BookCardModel) => {
    if (!book.url) throw new ApiError('Book URLがありません。', { category: 'validation' })
    const response = await getWebBookContent(book.url)
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
      thumbnailUrl: refreshed.thumbnailUrl ?? previous.thumbnailUrl,
      thumbnailRequest: refreshed.thumbnailRequest ?? previous.thumbnailRequest,
      thumbnailReloadKey: refreshed.thumbnailReloadKey ?? previous.thumbnailReloadKey,
    }
  }, [])

  const refreshWebBook = useCallback(async (book: BookCardModel) => {
    try {
      const refreshed = await fetchWebBook(book)
      updateWebSearchResultBooks((current) => {
        const index = findSearchBookIndex(current, book, refreshed)
        if (index < 0) return current
        const next = [...current]
        next[index] = refreshed
        return next
      })
      notify(`「${book.title}」のWeb情報を再取得しました`)
    } catch (error) {
      notify(`再取得できませんでした: ${getErrorMessage(error)}`, 'error')
    }
  }, [fetchWebBook, notify, updateWebSearchResultBooks])

  const refreshSelectedWebBooks = useCallback(async () => {
    const selectedKeys = new Set(selected)
    const selectedBooks = webSearchResultBooks.filter((book) => selectedKeys.has(getBookIdentityKey(book)))
    if (selectedBooks.length === 0) return

    const results = await Promise.allSettled(selectedBooks.map(fetchWebBook))
    const refreshed = new Map<string, ApiBookCardModel>()
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') refreshed.set(getBookIdentityKey(selectedBooks[index]), result.value)
    })
    updateWebSearchResultBooks((current) => current.map((candidate) => refreshed.get(getBookIdentityKey(candidate)) ?? candidate))
    const failed = results.length - refreshed.size
    notify(
      failed ? `${refreshed.size}件を更新、${failed}件は失敗しました` : `選択した${refreshed.size}件を読み込みました`,
      failed === 0 ? 'success' : refreshed.size === 0 ? 'error' : 'warning',
    )
  }, [fetchWebBook, notify, selected, updateWebSearchResultBooks, webSearchResultBooks])

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
        updateWebSearchResultBooks((current) => {
          const index = findSearchBookIndex(current, book, targetBook)
          if (index < 0) return current
          const currentBook = current[index]
          const status = currentBook.status === 'Downloaded' || currentBook.status === 'Downloading'
            ? currentBook.status
            : targetBook.status
          const next = [...current]
          next[index] = status === targetBook.status ? targetBook : { ...targetBook, status }
          return next
        })
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

    const currentIndex = findSearchBookIndex(webSearchResultBooksRef.current, book, targetBook)
    const currentStatus = currentIndex >= 0 ? webSearchResultBooksRef.current[currentIndex].status : undefined
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
      notify(`「${targetBook.title || book.title}」のダウンロードを開始しました`)
    } catch (error) {
      notify(`ダウンロードを開始できませんでした: ${getErrorMessage(error)}`, 'error')
    }
  }, [fetchWebBook, notify, updateWebSearchResultBooks])

  const toggleSelection = useCallback((bookId: string) => {
    setSelected((current) => current.includes(bookId) ? current.filter((item) => item !== bookId) : [...current, bookId])
  }, [])

  const selectAllVisibleBooks = useCallback(() => {
    setSelected((current) => {
      const next = new Set(current)
      visibleBooks.forEach((book) => next.add(getBookIdentityKey(book)))
      return [...next]
    })
  }, [visibleBooks])

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
    const activeBooks = isWebSearch ? webSearchResultBooks : librarySearchBooks
    const targetBook = activeBooks.find((candidate) => getBookIdentityKey(candidate) === bookKey)
    if (!targetBook) return
    if (targetBook.status === 'WebBook' || targetBook.status === 'WebBookInPage') return
    openDeleteDialog([targetBook], trigger ?? null)
  }, [isWebSearch, librarySearchBooks, openDeleteDialog, webSearchResultBooks])

  const deleteSelectedLibraryBooks = useCallback((trigger?: HTMLElement) => {
    const selectedKeys = new Set(selected)
    const deletedBooks = librarySearchBooks.filter((book) => selectedKeys.has(getBookIdentityKey(book)))
    if (!deletedBooks.length) return
    openDeleteDialog(deletedBooks, trigger ?? null)
  }, [librarySearchBooks, openDeleteDialog, selected])

  const requestDeleteDialogClose = useCallback((_reason: 'escape' | 'backdrop' | 'close-button' | 'submit' | 'programmatic') => {
    if (deleteDialogPendingRef.current) return false
    setDeleteDialogOpen(false)
    return true
  }, [])

  const afterDeleteDialogClose = useCallback(() => {
    setDeleteDialogBooks([])
    setDeleteDialogError('')
  }, [])

  const resolveDeleteRestoreFocus = useCallback((reason: 'escape' | 'backdrop' | 'close-button' | 'submit' | 'programmatic') => {
    const trigger = deleteDialogTriggerRef.current
    deleteDialogTriggerRef.current = null
    return reason === 'escape' || reason === 'backdrop' || reason === 'close-button' ? trigger : null
  }, [])

  const finishDeleteDialog = useCallback((requestClose: (reason: 'escape' | 'backdrop' | 'close-button' | 'submit' | 'programmatic') => boolean) => {
    deleteDialogPendingRef.current = false
    setDeleteDialogPending(false)
    requestClose('submit')
  }, [])

  const confirmDeleteLibraryBooks = useCallback(async (requestClose: (reason: 'escape' | 'backdrop' | 'close-button' | 'submit' | 'programmatic') => boolean) => {
    if (deleteDialogPendingRef.current || !deleteDialogBooks.length) return
    const targetBooks = deleteDialogBooks
    deleteDialogPendingRef.current = true
    setDeleteDialogPending(true)
    setDeleteDialogError('')

    if (targetBooks.length === 1) {
      const book = targetBooks[0]
      const bookKey = getBookIdentityKey(book)
      const result = await deleteBookAndWait(book)
      if (result.status === 'succeeded') {
        if (isWebSearch) {
          setSearchRevision((current) => current + 1)
        } else {
          setLibrarySearchBooks((current) => current.filter((candidate) => getBookIdentityKey(candidate) !== bookKey))
        }
        setSelected((current) => current.filter((key) => key !== bookKey))
        notify(`「${book.title}」を削除しました`)
        finishDeleteDialog(requestClose)
      } else if (result.status === 'pending') {
        notify(`「${book.title}」の削除を受け付けました。処理中です。`, 'warning')
        finishDeleteDialog(requestClose)
      } else {
        const message = `削除できませんでした: ${result.message ?? '削除ジョブが失敗しました。'}`
        setDeleteDialogError(message)
        notify(message, 'error')
        deleteDialogPendingRef.current = false
        setDeleteDialogPending(false)
      }
      return
    }

    const results = await Promise.all(targetBooks.map(deleteBookAndWait))
    const completedKeys = new Set(results.flatMap((result, index) => result.status === 'succeeded'
      ? [getBookIdentityKey(targetBooks[index])]
      : []))
    const completed = results.filter((result) => result.status === 'succeeded').length
    const pending = results.filter((result) => result.status === 'pending').length
    const failed = results.filter((result) => result.status === 'failed').length
    setLibrarySearchBooks((current) => current.filter((book) => !completedKeys.has(getBookIdentityKey(book))))
    setSelected((current) => current.filter((key) => !completedKeys.has(key)))
    const summary = [
      completed > 0 ? `${completed}件を削除` : '',
      pending > 0 ? `${pending}件は処理中` : '',
      failed > 0 ? `${failed}件は失敗` : '',
    ].filter(Boolean).join('、')
    notify(summary, failed > 0 ? completed > 0 || pending > 0 ? 'warning' : 'error' : pending > 0 ? 'warning' : 'success')
    finishDeleteDialog(requestClose)
  }, [deleteDialogBooks, finishDeleteDialog, isWebSearch, notify])

  const refresh = useCallback(() => {
    setSearchRevision((current) => current + 1)
  }, [])

  const goToResultPage = useCallback((page: number) => {
    const nextPage = Math.min(totalResultPages, Math.max(1, page))
    setSelected([])
    setResultPage(nextPage)
  }, [setResultPage, totalResultPages])

  const toggleSelectMode = useCallback(() => {
    setSelectMode((current) => !current)
    setSelected([])
  }, [])

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
    isWebSearch,
    isLibrarySearch,
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
    deleteDialogRef,
    deleteDialogBooks,
    deleteDialogOpen,
    deleteDialogPending,
    deleteDialogError,
    deleteDialogThumbnailRequest,
    loadDeleteDialogThumbnail,
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

export type SearchController = ReturnType<typeof useSearchController>
export { HITOMI_SORT_PERIODS, formatTagCount }
