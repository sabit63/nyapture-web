import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type SetStateAction } from 'react'

import {
  autocompleteTags,
} from '../../api'
import type { ApiBookCardModel, DisplaySettings } from '../../api'
import type { BookDownloadHubConnectionState } from '../../realtime/book-download-hub'
import type { BookTag, HitomiAppend, NyaBookStatus, NyaTagType, SearchCriteria, SortDirection, SortType } from '../../models'
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
  resolveTag,
  sameTag,
  validateCriteria,
  type HitomiSortPeriod,
  type SearchDestination,
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
import { useSearchExecution } from './useSearchExecution'
import { useSearchUrlSync, type SearchRouteStateBindings } from './useSearchUrlSync'
import {
  applyContinuousSearchParams,
  parseSearchStartIdentity,
  parseSearchViewMode,
  removeContinuousSearchParams,
} from './search-continuous-utils'

type Notify = (message: string, tone?: 'success' | 'warning' | 'error') => void

type SearchControllerOptions = {
  isWebSearch: boolean
  isLibrarySearch: boolean
  isStatusSearch?: boolean
  isMissingTagSearch: boolean
  isBookViewer: boolean
  apiRevision: number
  displaySettings: DisplaySettings
  hubConnectionState: BookDownloadHubConnectionState
  notify: Notify
}

type TagSearchDestinationSelection = {
  tag: BookTag
  libraryUrl: string
  hitomiUrl: string
}

const JAPANESE_LANGUAGE_TAG: BookTag = { type: 'Languages', name: 'japanese' }

export function useSearchController({
  isWebSearch,
  isLibrarySearch,
  isMissingTagSearch,
  isStatusSearch = false,
  isBookViewer,
  apiRevision,
  displaySettings,
  hubConnectionState,
  notify,
}: SearchControllerOptions) {
  const searchRouteBindingsRef = useRef<SearchRouteStateBindings | null>(null)
  const {
    routerLocation,
    routeCriteria,
    routeSearchParams,
    routeHitomiAppend,
    routeResultPage,
    isRouteStateSynchronized,
    navigateSearchUrl: navigateSearchUrlFromRoute,
    setResultPage: setResultPageFromRoute,
  } = useSearchUrlSync({
    isWebSearch,
    isLibrarySearch,
    isMissingTagSearch,
    isStatusSearch,
    routeBindingsRef: searchRouteBindingsRef,
  })
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
  const searchResultBooks = isWebSearch ? webSearchResultBooks : librarySearchBooks
  const searchView = parseSearchViewMode(routeSearchParams, isLibrarySearch)
  const continuousStart = parseSearchStartIdentity(routeSearchParams, isLibrarySearch)
  const [criteria, setCriteria] = useState<SearchCriteria>(() => cloneCriteria(routeCriteria))
  const [draftStatuses, setDraftStatuses] = useState<NyaBookStatus[]>(() => [...(routeCriteria.statuses ?? [])])
  const statusesError = validateCriteria({ ...criteria, statuses: draftStatuses }, false, isStatusSearch).statuses ?? ''
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
  const [resultPage, setResultPageState] = useState(routeResultPage)
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
  searchRouteBindingsRef.current = {
    setCriteria,
    setQuery,
    setDraftStatuses,
    setDraftMissingTagTypes,
    setMissingTagsError,
    setDraftCriteria,
    setHitomiAppend,
    setDraftHitomiAppend,
    setResultPageState,
    setAdvancedErrors,
    setSelected,
  }
  const currentSearchDestination: SearchDestination = isWebSearch ? 'hitomi' : isStatusSearch ? 'status' : isMissingTagSearch ? 'missing-tags' : 'library'
  const routeStateSynchronized = isRouteStateSynchronized({
    criteria,
    hitomiAppend,
    resultPage,
  })

  const searchExecution = useSearchExecution({
    searchLimit: displaySettings.searchLimit ?? 50,
    isWebSearch,
    isLibrarySearch,
    isMissingTagSearch,
    isStatusSearch,
    apiRevision,
    criteria,
    hitomiAppend,
    resultPage,
    sortType,
    sortDirection,
    routeStateSynchronized,
    setLibrarySearchBooks,
    updateWebSearchResultBooks,
  })
  const {
    searchResponseTags,
    setSearchResponseTags,
    searchResultGeneration,
    searchState,
    searchSyncFreshness,
    searchLoaderVisible,
    searchError,
    totalResultPages,
    refresh,
  } = searchExecution

  const setResultPage = useCallback((value: SetStateAction<number>) => {
    const nextPage = Math.max(1, Math.floor(typeof value === 'function' ? value(resultPage) : value))
    if (nextPage === resultPage) return
    if (searchView !== 'continuous') {
      setResultPageFromRoute(nextPage, resultPage)
      return
    }
    const url = applyContinuousSearchParams(new URL(routerLocation.href))
    url.searchParams.set('page', String(nextPage))
    navigateSearchUrlFromRoute(url)
  }, [navigateSearchUrlFromRoute, resultPage, routerLocation.href, searchView, setResultPageFromRoute])

  // New searches start in the grid; reading navigation preserves its own URL.
  const navigateSearchUrl = useCallback((url: URL) => {
    navigateSearchUrlFromRoute(removeContinuousSearchParams(url), searchExecution.refresh)
  }, [navigateSearchUrlFromRoute, searchExecution.refresh])

  const getContinuousViewHref = useCallback((book?: ApiBookCardModel) => {
    const identity = book?.apiGroupId?.trim() && book.apiBookId?.trim()
      ? { groupId: book.apiGroupId.trim(), bookId: book.apiBookId.trim() }
      : undefined
    return applyContinuousSearchParams(new URL(routerLocation.href), identity).href
  }, [routerLocation.href])

  const enterContinuousView = useCallback((book?: ApiBookCardModel) => {
    setSelectMode(false)
    setSelected([])
    navigateSearchUrlFromRoute(new URL(getContinuousViewHref(book)))
  }, [navigateSearchUrlFromRoute, getContinuousViewHref, setSelected])

  const exitContinuousView = useCallback(() => {
    navigateSearchUrlFromRoute(removeContinuousSearchParams(new URL(routerLocation.href)))
  }, [navigateSearchUrlFromRoute, routerLocation.href])

  const resetSearchOrder = useCallback(() => {
    const url = removeContinuousSearchParams(new URL(routerLocation.href))
    url.searchParams.set('page', '1')
    navigateSearchUrlFromRoute(url)
  }, [navigateSearchUrlFromRoute, routerLocation.href])

  const changeSortType = useCallback((next: SortType) => {
    if (next === sortType) return
    setSortType(next)
    resetSearchOrder()
  }, [resetSearchOrder, sortType])

  const changeSortDirection = useCallback((next: SortDirection) => {
    if (next === sortDirection) return
    setSortDirection(next)
    resetSearchOrder()
  }, [resetSearchOrder, sortDirection])

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
    setSelectMode,
    updateWebSearchResultBooks,
    replaceWebSearchBook,
    replaceWebSearchBooks,
    notify,
  })

  const changeHitomiAppend = useCallback((next: HitomiAppend) => {
    if (!isWebSearch || next === hitomiAppend) return
    const url = createSearchUrlForDestination(criteria, {
      destination: currentSearchDestination,
      hitomiAppend: next,
    })
    navigateSearchUrl(url)
  }, [criteria, currentSearchDestination, hitomiAppend, isWebSearch, navigateSearchUrl])

  const applyBookTagChange = useCallback((updated: ApiBookCardModel) => {
    const updateTags = <T extends { groupId: string; bookId: string }>(book: T): T => (
      book.groupId === updated.groupId && book.bookId === updated.bookId
        ? { ...book, tags: applyTagDisplayNameOverrides(updated.tags, tagDisplayNameOverrides), tagSet: updated.tagSet }
        : book
    )
    setLibrarySearchBooks((current) => current.map(updateTags))
    updateWebSearchResultBooks((current) => current.map(updateTags))
  }, [setLibrarySearchBooks, updateWebSearchResultBooks, tagDisplayNameOverrides])

  const applyBookTitleChange = useCallback((groupId: string, bookId: string, title: string) => {
    const updateTitle = (book: ApiBookCardModel) => (
      book.groupId === groupId && book.bookId === bookId ? { ...book, title } : book
    )
    setLibrarySearchBooks((current) => current.map(updateTitle))
    updateWebSearchResultBooks((current) => current.map(updateTitle))
  }, [setLibrarySearchBooks, updateWebSearchResultBooks])

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
  }, [setSearchResponseTags, setLibrarySearchBooks, updateWebSearchResultBooks])

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
    if (routerLocation.revision === 0) return
    setAdvancedOpen(false)
    setTagSearchDestinationDialogOpen(false)
  }, [routerLocation.revision])

  const displayedSearchResultBooks = useMemo(() => searchResultBooks.map((book) => {
    const deletionPending = searchOperations.pendingDeletionKeys.has(getBookIdentityKey(book))
    const projectedBook = deletionPending && book.status !== 'Shredding'
      ? { ...book, status: 'Shredding' as const }
      : book
    const tags = applyTagDisplayNameOverrides(projectedBook.tags, tagDisplayNameOverrides)
    return tags === projectedBook.tags ? projectedBook : { ...projectedBook, tags }
  }), [searchOperations.pendingDeletionKeys, searchResultBooks, tagDisplayNameOverrides])

  // The missing-tag API evaluates ordinary conditions together with the missing types.
  const filteredBooks = useMemo(() => isWebSearch || isMissingTagSearch || isStatusSearch ? displayedSearchResultBooks : displayedSearchResultBooks.filter((book) => {
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
  }), [isWebSearch, isMissingTagSearch, isStatusSearch, displayedSearchResultBooks, criteria])
  const visibleBooks = filteredBooks
  const hasCriteria = criteriaHasValues(criteria)
  const localTagCandidates = useMemo(() => displayedSearchResultBooks
    .flatMap((book) => book.tags)
    .filter((tag) => tag.type === tagType)
    .filter((tag, index, all) => all.findIndex((candidate) => candidate.type === tag.type && candidate.name === tag.name) === index)
    .filter((tag) => !draftCriteria.tags.some((selectedTag) => sameTag(selectedTag, tag)))
    .filter((tag) => {
      const normalizedInput = tagInput.trim().toLocaleLowerCase()
      if (!normalizedInput) return true
      return getTagLabel(tag).toLocaleLowerCase().includes(normalizedInput) || tag.name.toLocaleLowerCase().includes(normalizedInput)
    })
    .slice(0, 8), [displayedSearchResultBooks, tagType, draftCriteria.tags, tagInput])
  const tagCandidates = tagInput.trim() ? remoteTagCandidates : localTagCandidates
  const showTagCandidates = tagInputFocused && tagCandidates.length > 0
  const japaneseLanguageEnabled = criteria.tags.some((tag) => sameTag(tag, JAPANESE_LANGUAGE_TAG))

  const submitSearch = useCallback((event: FormEvent) => {
    event.preventDefault()
    const nextCriteria: SearchCriteria = isStatusSearch ? {
      ...cloneCriteria(criteria), text: query.trim(), statuses: [...draftStatuses],
    } : isMissingTagSearch ? {
      ...cloneCriteria(criteria),
      text: query.trim(),
      missingTagTypes: [...draftMissingTagTypes],
    } : {
      ...emptyCriteria(),
      text: query.trim(),
      tags: isWebSearch && japaneseLanguageEnabled ? [JAPANESE_LANGUAGE_TAG] : [],
    }
    const errors = validateCriteria(nextCriteria, isMissingTagSearch, isStatusSearch)
    setMissingTagsError(errors.missingTags ?? '')
    if (errors.missingTags || errors.statuses) return
    if (isMissingTagSearch || isStatusSearch) setQuery(nextCriteria.text)
    const url = createSearchUrlForDestination(nextCriteria, {
      destination: currentSearchDestination,
      hitomiAppend: isWebSearch ? hitomiAppend : undefined,
    })
    navigateSearchUrl(url)
  }, [criteria, draftStatuses, isStatusSearch, draftMissingTagTypes, isMissingTagSearch, currentSearchDestination, hitomiAppend, isWebSearch, japaneseLanguageEnabled, navigateSearchUrl, query])

  const getTagSearchHref = useCallback((tag: BookTag) => {
    const resolvedTag = resolveTag(tag)
    const nextTags = [resolvedTag]
    if (isWebSearch && japaneseLanguageEnabled && !sameTag(resolvedTag, JAPANESE_LANGUAGE_TAG)) {
      nextTags.push(JAPANESE_LANGUAGE_TAG)
    }
    const nextCriteria: SearchCriteria = { ...emptyCriteria(), tags: nextTags, ...(isStatusSearch ? { statuses: [...(criteria.statuses ?? [])] } : {}), ...(isMissingTagSearch ? { missingTagTypes: [...(criteria.missingTagTypes ?? [])] } : {}) }
    const url = createSearchUrlForDestination(nextCriteria, {
      destination: currentSearchDestination,
      hitomiAppend: isWebSearch ? hitomiAppend : undefined,
    })
    return url.href
  }, [criteria.statuses, isStatusSearch, criteria.missingTagTypes, isMissingTagSearch, currentSearchDestination, hitomiAppend, isWebSearch, japaneseLanguageEnabled])

  const searchByTag = useCallback((tag: BookTag) => {
    navigateSearchUrl(new URL(getTagSearchHref(tag)))
  }, [getTagSearchHref, navigateSearchUrl])

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
    setDraftCriteria(cloneCriteria(normalizeCriteriaForRoute(isStatusSearch
      ? { ...criteria, text: query, statuses: [...draftStatuses] }
      : isMissingTagSearch
      ? { ...criteria, text: query, missingTagTypes: [...draftMissingTagTypes] }
      : criteria, isWebSearch, isMissingTagSearch, isStatusSearch)))
    setDraftHitomiAppend(isWebSearch ? hitomiAppend : 'Normal')
    setAdvancedErrors({})
    setTagType('Artists')
    setTagInput('')
    setTagInputFocused(false)
    setHighlightedTagIndex(0)
    setAdvancedOpen(true)
  }, [criteria, draftStatuses, isStatusSearch, draftMissingTagTypes, query, isMissingTagSearch, hitomiAppend, isWebSearch])

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
    const errors = isWebSearch ? {} : validateCriteria(draftCriteria, isMissingTagSearch, isStatusSearch)
    setAdvancedErrors(errors)
    if (!isWebSearch && (errors.date || errors.pages || errors.missingTags || errors.statuses)) return

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
    if (isStatusSearch) {
      setQuery(nextCriteria.text)
      setDraftStatuses([...(nextCriteria.statuses ?? [])])
    }
    if (isMissingTagSearch) {
      setQuery(nextCriteria.text)
      setDraftMissingTagTypes([...(nextCriteria.missingTagTypes ?? [])])
      setMissingTagsError('')
    }
    navigateSearchUrl(url)
    requestClose('submit')
  }, [isStatusSearch, currentSearchDestination, draftCriteria, draftHitomiAppend, isWebSearch, isMissingTagSearch, navigateSearchUrl])

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
      visibleBooks.forEach((book) => {
        const key = getBookIdentityKey(book)
        if (!searchOperations.pendingDeletionKeys.has(key)) next.add(key)
      })
      return [...next]
    })
  }, [searchOperations.pendingDeletionKeys, setSelected, visibleBooks])

  return {
    applyBookTagChange,
    applyBookTitleChange,
    isWebSearch,
    isLibrarySearch,
    isMissingTagSearch,
    isStatusSearch,
    draftStatuses,
    statusesError,
    draftMissingTagTypes,
    setDraftStatuses,
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
    searchView,
    continuousStart,
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
    getTagSearchHref,
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
    setSortType: changeSortType,
    setSortDirection: changeSortDirection,
    enterContinuousView,
    getContinuousViewHref,
    exitContinuousView,
    toggleSelection,
    selectAllVisibleBooks,
    toggleSelectMode,
    refresh,
    goToResultPage,
  }
}

export type SearchController = ReturnType<typeof useSearchController>
export { HITOMI_SORT_PERIODS, formatTagCount }
