import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'

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
import {
  applySearchBookDownloadStatuses,
  getDownloadStatusIdentityKey,
} from '../../realtime/search-book-status'
import type { BookCardModel, BookDownloadStatus, BookTag, HitomiAppend, NyaTagType, SearchCriteria, SortDirection, SortType, TagEntity } from '../../models'
import { getTagLabel, HITOMI_APPENDS, TAG_TYPE_ORDER } from '../../models'
import { getBookIdentityKey, deleteBookAndWait } from '../library/book-deletion'
import {
  cloneCriteria,
  createSearchUrl,
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
  type SearchSyncFreshness,
} from './search-utils'

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

const JAPANESE_LANGUAGE_TAG: BookTag = { type: 'Languages', name: 'japanese' }

const statusTimestampValue = (status: BookDownloadStatus | undefined) => {
  if (!status?.lastUpdated) return undefined
  const parsed = Date.parse(status.lastUpdated)
  return Number.isNaN(parsed) ? undefined : parsed
}

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
  const [librarySearchBooks, setLibrarySearchBooks] = useState<ApiBookCardModel[]>([])
  const [webSearchResultBooks, setWebSearchResultBooks] = useState<ApiBookCardModel[]>([])
  const [searchResponseTags, setSearchResponseTags] = useState<TagEntity[]>([])
  const searchResultBooks = isWebSearch ? webSearchResultBooks : librarySearchBooks
  const [criteria, setCriteria] = useState<SearchCriteria>(() => parseCriteriaForRoute(new URLSearchParams(window.location.search), isWebSearch))
  const [query, setQuery] = useState(() => parseCriteriaFromUrl(new URLSearchParams(window.location.search)).text)
  const [selected, setSelected] = useState<string[]>([])
  const [selectMode, setSelectMode] = useState(false)
  const [sortType, setSortType] = useState<SortType>('uploaded')
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc')
  const [hitomiSortPeriod, setHitomiSortPeriod] = useState<HitomiSortPeriod>('recent')
  const [hitomiAppend, setHitomiAppend] = useState<HitomiAppend>(() => isWebSearch
    ? parseHitomiAppend(new URLSearchParams(window.location.search))
    : 'Normal')
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [draftCriteria, setDraftCriteria] = useState<SearchCriteria>(() => parseCriteriaForRoute(new URLSearchParams(window.location.search), isWebSearch))
  const [draftHitomiAppend, setDraftHitomiAppend] = useState<HitomiAppend>(() => isWebSearch
    ? parseHitomiAppend(new URLSearchParams(window.location.search))
    : 'Normal')
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
  const [resultPage, setResultPage] = useState(() => parsePageParam(new URLSearchParams(window.location.search).get('page')))
  const [totalResultPages, setTotalResultPages] = useState(1)
  const [paginationPageCount, setPaginationPageCount] = useState(() => window.innerWidth < 880 ? 5 : 7)
  const [deleteDialogBooks, setDeleteDialogBooks] = useState<ApiBookCardModel[]>([])
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [deleteDialogPending, setDeleteDialogPending] = useState(false)
  const [deleteDialogError, setDeleteDialogError] = useState('')
  const advancedDialogRef = useRef<HTMLDialogElement>(null)
  const advancedTriggerRef = useRef<HTMLButtonElement>(null)
  const activeSearchRequestRef = useRef<AbortController | null>(null)
  const searchRealtimeBufferRef = useRef<SearchRealtimeBuffer | null>(null)
  const pendingSearchStatusesRef = useRef(new Map<string, BufferedSearchStatusEvent>())
  const searchRealtimeFrameRef = useRef<number | null>(null)
  const searchStatusVersionsRef = useRef(new Map<string, number>())
  const deleteDialogRef = useRef<HTMLDialogElement>(null)
  const deleteDialogTriggerRef = useRef<HTMLElement | null>(null)
  const deleteDialogPendingRef = useRef(false)

  const applyStatusesToActiveSearch = useCallback((statuses: BookDownloadStatus[]) => {
    if (statuses.length === 0) return
    const apply = (current: ApiBookCardModel[]) => applySearchBookDownloadStatuses(
      current,
      statuses,
      searchStatusVersionsRef.current,
    )
    if (isWebSearch) setWebSearchResultBooks(apply)
    else if (isLibrarySearch) setLibrarySearchBooks(apply)
  }, [isLibrarySearch, isWebSearch])

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
    const activeBuffer = searchRealtimeBufferRef.current
    if (activeBuffer) {
      activeBuffer.events.push({ kind, status })
      return
    }

    const key = getDownloadStatusIdentityKey(status)
    if (!key) return
    const executionState = status.executionState
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
      const nextTimestamp = statusTimestampValue(status)
      if (
        pendingTimestamp !== undefined
        && nextTimestamp !== undefined
        && nextTimestamp <= pendingTimestamp
      ) return
      pendingSearchStatusesRef.current.delete(key)
      applyStatusesToActiveSearch([status])
      return
    }

    const pending = pendingSearchStatusesRef.current.get(key)
    const pendingTimestamp = statusTimestampValue(pending?.status)
    const nextTimestamp = statusTimestampValue(status)
    if (
      !pending
      || pendingTimestamp === undefined
      || nextTimestamp === undefined
      || nextTimestamp > pendingTimestamp
    ) {
      pendingSearchStatusesRef.current.set(key, { kind, status })
    }
    if (searchRealtimeFrameRef.current === null) {
      searchRealtimeFrameRef.current = window.requestAnimationFrame(flushPendingSearchStatuses)
    }
  }, [applyStatusesToActiveSearch, flushPendingSearchStatuses])

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
      onResyncRequested: () => setSearchRevision((current) => current + 1),
    })

    return () => {
      unsubscribe()
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
    if (!isLibrarySearch && !isWebSearch) return
    const controller = new AbortController()
    activeSearchRequestRef.current = controller
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
    let loadingTimer: number | null = null
    const isCurrentRequest = () => activeSearchRequestRef.current === controller
    setSearchState('loading')
    setSearchSyncFreshness('syncing')
    setSearchError('')
    setSearchLoaderVisible(false)
    setSearchResponseTags([])
    loadingTimer = window.setTimeout(() => {
      if (!controller.signal.aborted && isCurrentRequest()) setSearchLoaderVisible(true)
    }, 1000)

    const load = async () => {
      try {
        if (isWebSearch) {
          const response = await getWebPageContent(
            buildHitomiSearchUrl(criteria, hitomiAppend, resultPage),
            controller.signal,
          )
          if (response.success === false) {
            throw new ApiError(response.message ?? 'Hitomi検索に失敗しました。', { category: 'server' })
          }
          if (!isCurrentRequest()) return
          const mapped = mapHitomiSearchResponse(response)
          let nextBooks = mapped.books
          searchStatusVersionsRef.current.clear()
          if (searchRealtimeBufferRef.current === buffer) {
            searchRealtimeBufferRef.current = null
            nextBooks = applySearchBookDownloadStatuses(
              nextBooks,
              buffer.events.map((event) => event.status),
              searchStatusVersionsRef.current,
            )
          }
          setWebSearchResultBooks(nextBooks)
          setSearchResponseTags(response.tags ?? [])
          setTotalResultPages(mapped.totalPage)
          setSearchSyncFreshness('fresh')
        } else {
          const response = await searchBooksApi(
            buildBookSearchFilter(criteria, sortType, sortDirection, resultPage),
            controller.signal,
          )
          if (response.success === false) throw new ApiError(response.message ?? '検索に失敗しました。', { category: 'server' })
          if (!isCurrentRequest()) return
          const entities = response.tags ?? []
          let nextBooks = (response.books ?? []).map((book) => mapEBookToCard(book, { context: 'library', entities }))
          searchStatusVersionsRef.current.clear()
          if (searchRealtimeBufferRef.current === buffer) {
            searchRealtimeBufferRef.current = null
            nextBooks = applySearchBookDownloadStatuses(
              nextBooks,
              buffer.events.map((event) => event.status),
              searchStatusVersionsRef.current,
            )
          }
          setLibrarySearchBooks(nextBooks)
          setSearchResponseTags(response.tags ?? [])
          setTotalResultPages(Math.max(1, response.totalPage ?? 1))
          setSearchSyncFreshness('fresh')
        }
        if (isCurrentRequest()) setSearchState('success')
      } catch (error) {
        if (controller.signal.aborted || !isCurrentRequest()) return
        if (searchRealtimeBufferRef.current === buffer) {
          searchRealtimeBufferRef.current = null
          applyStatusesToActiveSearch(buffer.events.map((event) => event.status))
        }
        setSearchError(getErrorMessage(error))
        setSearchState('error')
        setSearchSyncFreshness('stale')
      } finally {
        if (!isCurrentRequest()) return
        if (loadingTimer !== null) window.clearTimeout(loadingTimer)
        loadingTimer = null
        activeSearchRequestRef.current = null
        setSearchLoaderVisible(false)
      }
    }

    void load()
    return () => {
      controller.abort()
      if (loadingTimer !== null) window.clearTimeout(loadingTimer)
      loadingTimer = null
      if (activeSearchRequestRef.current === controller) {
        activeSearchRequestRef.current = null
        setSearchLoaderVisible(false)
      }
    }
  }, [apiRevision, applyStatusesToActiveSearch, criteria, hitomiAppend, isLibrarySearch, isWebSearch, resultPage, searchRevision, sortDirection, sortType])

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
    const syncFromUrl = () => {
      const params = new URLSearchParams(window.location.search)
      const nextCriteria = parseCriteriaForRoute(params, isWebSearch)
      setCriteria(nextCriteria)
      setQuery(nextCriteria.text)
      setDraftCriteria(cloneCriteria(nextCriteria))
      const nextHitomiAppend = isWebSearch ? parseHitomiAppend(params) : 'Normal'
      setHitomiAppend(nextHitomiAppend)
      setDraftHitomiAppend(nextHitomiAppend)
      setResultPage(parsePageParam(params.get('page')))
      setAdvancedErrors({})
      setSelected([])
    }
    window.addEventListener('popstate', syncFromUrl)
    return () => window.removeEventListener('popstate', syncFromUrl)
  }, [])

  const filteredBooks = isWebSearch ? searchResultBooks : searchResultBooks.filter((book) => {
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
  const hasCriteria = criteriaHasValues(criteria) || (isWebSearch && hitomiAppend !== 'Normal')
  const localTagCandidates = searchResultBooks
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
    const url = createSearchUrl(nextCriteria, isWebSearch ? hitomiAppend : undefined)
    if (isBookViewer) {
      window.location.assign(url.toString())
      return
    }
    window.history.pushState({}, '', url)
    setResultPage(1)
    setCriteria(nextCriteria)
    setDraftCriteria(cloneCriteria(nextCriteria))
    setSelected([])
    window.requestAnimationFrame(() => document.getElementById('results-region')?.focus())
  }, [hitomiAppend, isBookViewer, isWebSearch, japaneseLanguageEnabled, query])

  const searchByTag = useCallback((tag: BookTag) => {
    const resolvedTag = resolveTag(tag)
    const nextTags = [resolvedTag]
    if (isWebSearch && japaneseLanguageEnabled && !sameTag(resolvedTag, JAPANESE_LANGUAGE_TAG)) {
      nextTags.push(JAPANESE_LANGUAGE_TAG)
    }
    const nextCriteria: SearchCriteria = { ...emptyCriteria(), tags: nextTags }
    const url = createSearchUrl(nextCriteria, isWebSearch ? hitomiAppend : undefined)
    if (isBookViewer) {
      window.location.assign(url.toString())
      return
    }
    window.history.pushState({}, '', url)
    setResultPage(1)
    setCriteria(nextCriteria)
    setQuery('')
    setDraftCriteria(cloneCriteria(nextCriteria))
    setSelected([])
    window.requestAnimationFrame(() => document.getElementById('results-region')?.focus())
  }, [hitomiAppend, isBookViewer, isWebSearch, japaneseLanguageEnabled])

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
    const url = createSearchUrl(nextCriteria, hitomiAppend)
    if (isBookViewer) {
      window.location.assign(url.toString())
      return
    }
    window.history.pushState({}, '', url)
    setResultPage(1)
    setCriteria(nextCriteria)
    setDraftCriteria(cloneCriteria(nextCriteria))
    setSelected([])
  }, [criteria, hitomiAppend, isBookViewer, isWebSearch, japaneseLanguageEnabled])

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
    const url = createSearchUrl(nextCriteria, isWebSearch ? nextHitomiAppend : undefined)
    if (isBookViewer) {
      window.location.assign(url.toString())
      return
    }
    window.history.pushState({}, '', url)
    setResultPage(1)
    setCriteria(nextCriteria)
    setQuery(nextCriteria.text)
    setDraftCriteria(cloneCriteria(nextCriteria))
    setHitomiAppend(nextHitomiAppend)
    setDraftHitomiAppend(nextHitomiAppend)
    setSelected([])
    requestClose('submit')
  }, [draftCriteria, draftHitomiAppend, isBookViewer, isWebSearch])

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
    const bookKey = getBookIdentityKey(book)
    try {
      const refreshed = await fetchWebBook(book)
      setWebSearchResultBooks((current) => current.map((candidate) => getBookIdentityKey(candidate) === bookKey ? refreshed : candidate))
      notify(`「${book.title}」のWeb情報を再取得しました`)
    } catch (error) {
      notify(`再取得できませんでした: ${getErrorMessage(error)}`, 'error')
    }
  }, [fetchWebBook, notify])

  const refreshSelectedWebBooks = useCallback(async () => {
    const selectedKeys = new Set(selected)
    const selectedBooks = webSearchResultBooks.filter((book) => selectedKeys.has(getBookIdentityKey(book)))
    if (selectedBooks.length === 0) return

    const results = await Promise.allSettled(selectedBooks.map(fetchWebBook))
    const refreshed = new Map<string, ApiBookCardModel>()
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') refreshed.set(getBookIdentityKey(selectedBooks[index]), result.value)
    })
    setWebSearchResultBooks((current) => current.map((candidate) => refreshed.get(getBookIdentityKey(candidate)) ?? candidate))
    const failed = results.length - refreshed.size
    notify(
      failed ? `${refreshed.size}件を更新、${failed}件は失敗しました` : `選択した${refreshed.size}件を読み込みました`,
      failed === 0 ? 'success' : refreshed.size === 0 ? 'error' : 'warning',
    )
  }, [fetchWebBook, notify, selected, webSearchResultBooks])

  const downloadWebBook = useCallback(async (book: BookCardModel) => {
    if (book.status === 'Downloaded' || book.status === 'Downloading') return

    const bookKey = getBookIdentityKey(book)
    try {
      if (!book.url) throw new ApiError('Book URLがありません。', { category: 'validation' })
      await startBookDownload({ url: book.url, requestedBy: 'nyapture-web' })
      setWebSearchResultBooks((current) => current.map((candidate) => getBookIdentityKey(candidate) === bookKey
        ? { ...candidate, status: 'Downloading' }
        : candidate))
      notify(`「${book.title}」のダウンロードを開始しました`)
    } catch (error) {
      notify(`ダウンロードを開始できませんでした: ${getErrorMessage(error)}`, 'error')
    }
  }, [notify])

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
    const targetBook = librarySearchBooks.find((candidate) => getBookIdentityKey(candidate) === bookKey)
    if (!targetBook) return
    openDeleteDialog([targetBook], trigger ?? null)
  }, [librarySearchBooks, openDeleteDialog])

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
        setLibrarySearchBooks((current) => current.filter((candidate) => getBookIdentityKey(candidate) !== bookKey))
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
  }, [deleteDialogBooks, finishDeleteDialog, notify])

  const refresh = useCallback(() => {
    setSearchRevision((current) => current + 1)
  }, [])

  const goToResultPage = useCallback((page: number) => {
    const nextPage = Math.min(totalResultPages, Math.max(1, page))
    const url = new URL(window.location.href)
    url.searchParams.set('page', String(nextPage))
    window.history.pushState({}, '', url)
    setResultPage(nextPage)
    setSelected([])
    window.requestAnimationFrame(() => {
      window.scrollTo({ top: 0, behavior: 'auto' })
      document.getElementById('results-region')?.focus({ preventScroll: true })
    })
  }, [totalResultPages])

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
    deleteDialogRef,
    deleteDialogBooks,
    deleteDialogOpen,
    deleteDialogPending,
    deleteDialogError,
    deleteDialogThumbnailRequest,
    loadDeleteDialogThumbnail,
    submitSearch,
    searchByTag,
    japaneseLanguageEnabled,
    toggleJapaneseLanguage,
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
