import {
  ArrowDown,
  ArrowUp,
  CalendarDays,
  Check,
  CircleAlert,
  CircleCheck,
  CircleHelp,
  ChevronDown,
  Download,
  Eraser,
  Files,
  Gauge,
  Globe2,
  LoaderCircle,
  ListChecks,
  ListFilter,
  Menu,
  PlugZap,
  Radio,
  RefreshCw,
  Save,
  Search,
  Settings,
  SlidersHorizontal,
  Trash2,
  X,
} from 'lucide-react'
import { FormEvent, useCallback, useEffect, useRef, useState } from 'react'

import {
  ApiError,
  DEFAULT_API_SETTINGS,
  autocompleteTags,
  buildBookSearchFilter,
  buildHitomiSearchUrl,
  clearPersistedApiSettings,
  configureApi,
  deleteBook,
  downloadWebBookCacheBook,
  getBook,
  getBookDeletionJob,
  getErrorMessage,
  getWebBookCacheBook,
  getWebBookContent,
  getWebPageContent,
  mapEBookToCard,
  mapHitomiSearchResponse,
  mapOnlineBookToCard,
  mapWebCacheBookToCard,
  loadPersistedApiSettings,
  requestBlob,
  savePersistedApiSettings,
  searchBooks as searchBooksApi,
  startBookDownload,
  testApiConnection as testApiConnectionRequest,
  validateApiSettings,
} from './api'
import type { ApiBookCardModel, ApiSettings, ApiSettingsErrors } from './api'
import nyaIcon from './assets/icon.png'
import { BookStatusBadge } from './components/BookStatusBadge'
import { BookViewerPage } from './components/BookViewerPage'
import { Dashboard } from './components/Dashboard'
import { DownloadManager } from './components/DownloadManager'
import { Snackbar, useSnackbar } from './components/Snackbar'
import { TagChip } from './components/TagChip'
import { Thumbnail } from './components/Thumbnail'
import { getTagLabel, HITOMI_APPENDS, TAG_TYPE_LABELS, TAG_TYPE_ORDER } from './models'
import type { BookCardModel, BookDeletionJob, BookDeletionJobStatus, BookDownloadStatus, BookTag, HitomiAppend, NyaTagType, SearchCriteria, SortDirection, SortType } from './models'
import { bookDownloadHubClient } from './realtime/book-download-hub'
import type { BookDownloadHubStatusEventKind } from './realtime/book-download-hub'
import {
  applySearchBookDownloadStatuses,
  getDownloadStatusIdentityKey,
} from './realtime/search-book-status'
import { useBookDownloadHubConnection } from './realtime/use-book-download-hub'

const parseTagParam = (value: string | null): BookTag | null => {
  if (!value) return null
  const separator = value.indexOf(':')
  if (separator < 1) return null
  const type = value.slice(0, separator) as NyaTagType
  const name = value.slice(separator + 1)
  if (!TAG_TYPE_ORDER.includes(type) || !name) return null
  return { type, name }
}

const emptyCriteria = (): SearchCriteria => ({
  text: '',
  tags: [],
  tagMode: 'and',
  dateFrom: '',
  dateTo: '',
  pagesMin: '',
  pagesMax: '',
})

const cloneCriteria = (criteria: SearchCriteria): SearchCriteria => ({
  ...criteria,
  tags: criteria.tags.map((tag) => ({ ...tag })),
})

const normalizeCriteriaForRoute = (criteria: SearchCriteria, isWebSearch: boolean): SearchCriteria => isWebSearch
  ? { ...criteria, tags: criteria.tags.slice(0, 1), tagMode: 'and' }
  : criteria

const parseHitomiAppend = (params: URLSearchParams): HitomiAppend => {
  const value = params.get('append')
  return HITOMI_APPENDS.includes(value as HitomiAppend) ? value as HitomiAppend : 'Normal'
}

const resolveTag = (tag: BookTag): BookTag => tag

const parseCriteriaFromUrl = (params: URLSearchParams): SearchCriteria => {
  const criteria = emptyCriteria()
  criteria.text = params.get('q') ?? ''
  criteria.tags = params.getAll('tag')
    .map(parseTagParam)
    .filter((tag): tag is BookTag => Boolean(tag))
    .map(resolveTag)
    .filter((tag, index, all) => all.findIndex((candidate) => candidate.type === tag.type && candidate.name === tag.name) === index)
  criteria.tagMode = params.get('tagMode') === 'or' ? 'or' : 'and'
  criteria.dateFrom = params.get('dateFrom') ?? ''
  criteria.dateTo = params.get('dateTo') ?? ''
  criteria.pagesMin = params.get('pagesMin') ?? ''
  criteria.pagesMax = params.get('pagesMax') ?? ''
  return criteria
}

const criteriaHasValues = (criteria: SearchCriteria) => Boolean(
  criteria.text.trim() || criteria.tags.length || criteria.dateFrom || criteria.dateTo || criteria.pagesMin || criteria.pagesMax,
)

const createSearchUrl = (criteria: SearchCriteria, hitomiAppend?: HitomiAppend) => {
  const isHitomiSearch = window.location.pathname === '/hitomila/search'
  const pathname = isHitomiSearch ? '/hitomila/search' : '/search'
  const url = new URL(pathname, window.location.origin)
  const text = criteria.text.trim()
  const tags = isHitomiSearch ? criteria.tags.slice(0, 1) : criteria.tags
  if (text) url.searchParams.set('q', text)
  tags.forEach((tag) => url.searchParams.append('tag', `${tag.type}:${tag.name}`))
  if (!isHitomiSearch && tags.length && criteria.tagMode === 'or') url.searchParams.set('tagMode', 'or')
  if (criteria.dateFrom) url.searchParams.set('dateFrom', criteria.dateFrom)
  if (criteria.dateTo) url.searchParams.set('dateTo', criteria.dateTo)
  if (criteria.pagesMin) url.searchParams.set('pagesMin', criteria.pagesMin)
  if (criteria.pagesMax) url.searchParams.set('pagesMax', criteria.pagesMax)
  if (isHitomiSearch) url.searchParams.set('append', hitomiAppend ?? 'Normal')
  url.searchParams.set('page', '1')
  return url
}

const sameTag = (left: BookTag, right: BookTag) => left.type === right.type && left.name.toLocaleLowerCase() === right.name.toLocaleLowerCase()

const formatTagCount = (count: number | undefined) => (
  typeof count === 'number' && Number.isFinite(count) ? count.toLocaleString('ja-JP') : null
)

const hasBookIdentifier = (value: string | undefined) => Boolean(value?.trim())

const parsePageParam = (value: string | null) => {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed >= 1 ? parsed : 1
}

type BookDeletionOutcome = {
  status: 'succeeded' | 'pending' | 'failed'
  message?: string
}

const BOOK_DELETION_STATUSES: BookDeletionJobStatus[] = ['Pending', 'Running', 'Succeeded', 'Failed']
const DELETION_POLL_INTERVAL_MS = 1000
const DELETION_POLL_TIMEOUT_MS = 30_000

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

const deleteBookAndWait = async (
  book: Pick<BookCardModel, 'apiGroupId' | 'apiBookId'>,
): Promise<BookDeletionOutcome> => {
  const groupId = book.apiGroupId?.trim()
  const bookId = book.apiBookId?.trim()
  if (!groupId || !bookId) return { status: 'failed', message: 'Book識別子がありません。' }

  try {
    const response = await deleteBook(groupId, bookId)
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
      await new Promise<void>((resolve) => window.setTimeout(resolve, Math.min(DELETION_POLL_INTERVAL_MS, remaining)))
      if (Date.now() >= deadline) return { status: 'pending' }

      const nextResponse = await getBookDeletionJob(response.data.jobId)
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
    return { status: 'failed', message: getErrorMessage(error) }
  }
}

const getBookIdentityKey = (book: Pick<BookCardModel, 'groupId' | 'bookId'>) => `${book.groupId}\u0000${book.bookId}`

type SearchSyncFreshness = 'idle' | 'syncing' | 'fresh' | 'stale'

type BufferedSearchStatusEvent = {
  kind: BookDownloadHubStatusEventKind
  status: BookDownloadStatus
}

type SearchRealtimeBuffer = {
  events: BufferedSearchStatusEvent[]
}

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

type PaginationItem = number | 'ellipsis'

const getPaginationItems = (currentPage: number, totalPages: number, pageCount: number): PaginationItem[] => {
  const safeTotalPages = Math.max(1, Math.floor(totalPages))
  const visiblePageCount = Math.min(Math.max(1, Math.floor(pageCount)), safeTotalPages)
  const safeCurrentPage = Math.min(safeTotalPages, Math.max(1, Math.floor(currentPage)))
  const lastWindowStart = safeTotalPages - visiblePageCount + 1
  const firstWindowPage = safeCurrentPage <= 1
    ? 1
    : safeCurrentPage >= safeTotalPages
      ? lastWindowStart
      : Math.min(lastWindowStart, Math.max(1, safeCurrentPage - Math.floor(visiblePageCount / 2)))
  const lastWindowPage = firstWindowPage + visiblePageCount - 1
  const items: PaginationItem[] = []

  if (firstWindowPage > 1) {
    items.push(1)
    if (firstWindowPage > 2) items.push('ellipsis')
  }
  items.push(...Array.from({ length: visiblePageCount }, (_, index) => firstWindowPage + index))
  if (lastWindowPage < safeTotalPages) {
    if (lastWindowPage < safeTotalPages - 1) items.push('ellipsis')
    items.push(safeTotalPages)
  }

  return items
}

export type BookViewerRouteState = 'missing' | 'loading' | 'notFound' | 'error' | 'ready'

export type BookViewerRoute = {
  state: 'missing' | 'ready'
  groupId?: string
  bookId?: string
  identity: string
}

const resolveBookViewerRoute = (search: string): BookViewerRoute => {
  const params = new URLSearchParams(search)
  const idParam = params.get('id')
  const gidParam = params.get('gid')
  const identity = `${idParam ?? ''}\u0000${gidParam ?? ''}`

  if (idParam === null || gidParam === null || !hasBookIdentifier(idParam) || !hasBookIdentifier(gidParam)) {
    return { state: 'missing', identity }
  }

  return { state: 'ready', groupId: gidParam, bookId: idParam, identity }
}

type HitomiSortPeriod = 'recent' | 'today' | 'week' | 'month' | 'year'
type ApiConnectionState = 'idle' | 'pending' | 'success' | 'error'

const API_CONNECTION_STATE_LABELS: Record<ApiConnectionState, string> = {
  idle: '未確認',
  pending: '確認中',
  success: '接続済み',
  error: '接続エラー',
}

const HITOMI_SORT_PERIODS: { value: HitomiSortPeriod; label: string }[] = [
  { value: 'recent', label: '最近' },
  { value: 'today', label: '本日' },
  { value: 'week', label: '週間' },
  { value: 'month', label: '月間' },
  { value: 'year', label: '年間' },
]

const validateCriteria = (criteria: SearchCriteria) => {
  const errors: { date?: string; pages?: string } = {}
  if (criteria.dateFrom && criteria.dateTo && criteria.dateFrom > criteria.dateTo) {
    errors.date = '開始日は終了日以前にしてください。'
  }

  const pageValues = [criteria.pagesMin, criteria.pagesMax]
  if (pageValues.some((value) => value && (!/^\d+$/.test(value) || Number(value) < 1))) {
    errors.pages = 'ページ数は1以上の整数で入力してください。'
  } else if (criteria.pagesMin && criteria.pagesMax && Number(criteria.pagesMin) > Number(criteria.pagesMax)) {
    errors.pages = '最小ページ数は最大ページ数以下にしてください。'
  }
  return errors
}

const formatDisplayDate = (uploadedTime: string) => uploadedTime.slice(0, 16).replace('T', ' ').replaceAll('-', '/')

const navGroups = [
  {
    label: 'ライブラリ',
    items: [
      { label: '検索', icon: Search, href: '/search' },
      { label: '未タグ検索', icon: ListFilter },
    ],
  },
  {
    label: 'オンライン',
    items: [
      { label: 'Hitomi', icon: Globe2, href: '/hitomila/search' },
      { label: 'ダウンロード', icon: Download, href: '/download/book' },
    ],
  },
  {
    label: 'システム',
    items: [
      { label: 'Dashboard', icon: Gauge, href: '/dashboard' },
    ],
  },
]

function App() {
  const currentPath = window.location.pathname
  const isWebSearch = currentPath === '/hitomila/search'
  const isLibrarySearch = currentPath === '/search'
  const isBookViewer = currentPath === '/book/viewer'
  const isDownloadManager = currentPath === '/download/book'
  const isDashboard = currentPath === '/dashboard' || currentPath.startsWith('/dashboard/')
  const viewerRoute = isBookViewer ? resolveBookViewerRoute(window.location.search) : undefined
  const [librarySearchBooks, setLibrarySearchBooks] = useState<ApiBookCardModel[]>([])
  const [webSearchResultBooks, setWebSearchResultBooks] = useState<ApiBookCardModel[]>([])
  const searchResultBooks = isWebSearch ? webSearchResultBooks : librarySearchBooks
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [criteria, setCriteria] = useState<SearchCriteria>(() => normalizeCriteriaForRoute(parseCriteriaFromUrl(new URLSearchParams(window.location.search)), isWebSearch))
  const [query, setQuery] = useState(() => parseCriteriaFromUrl(new URLSearchParams(window.location.search)).text)
  const [selected, setSelected] = useState<string[]>([])
  const [selectMode, setSelectMode] = useState(false)
  const { notice, notify, dismiss } = useSnackbar()
  const [sortType, setSortType] = useState<SortType>('uploaded')
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc')
  const [hitomiSortPeriod, setHitomiSortPeriod] = useState<HitomiSortPeriod>('recent')
  const [hitomiAppend, setHitomiAppend] = useState<HitomiAppend>(() => isWebSearch
    ? parseHitomiAppend(new URLSearchParams(window.location.search))
    : 'Normal')
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [draftCriteria, setDraftCriteria] = useState<SearchCriteria>(() => normalizeCriteriaForRoute(parseCriteriaFromUrl(new URLSearchParams(window.location.search)), isWebSearch))
  const [draftHitomiAppend, setDraftHitomiAppend] = useState<HitomiAppend>(() => isWebSearch
    ? parseHitomiAppend(new URLSearchParams(window.location.search))
    : 'Normal')
  const [advancedErrors, setAdvancedErrors] = useState<{ date?: string; pages?: string }>({})
  const [tagType, setTagType] = useState<NyaTagType>('Artists')
  const [tagInput, setTagInput] = useState('')
  const [tagInputFocused, setTagInputFocused] = useState(false)
  const [highlightedTagIndex, setHighlightedTagIndex] = useState(0)
  const [remoteTagCandidates, setRemoteTagCandidates] = useState<BookTag[]>([])
  const [apiSettings, setApiSettings] = useState<ApiSettings>(() => {
    const persisted = loadPersistedApiSettings()
    return configureApi(persisted)
  })
  const [apiSettingsDraft, setApiSettingsDraft] = useState<ApiSettings>(() => ({ ...apiSettings }))
  const [apiSettingsOpen, setApiSettingsOpen] = useState(false)
  const [apiSettingsErrors, setApiSettingsErrors] = useState<ApiSettingsErrors>({})
  const [apiSettingsSaveError, setApiSettingsSaveError] = useState('')
  const [draftConnectionState, setDraftConnectionState] = useState<ApiConnectionState>('idle')
  const [draftConnectionError, setDraftConnectionError] = useState('')
  const [deleteDialogBooks, setDeleteDialogBooks] = useState<ApiBookCardModel[]>([])
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [deleteDialogPending, setDeleteDialogPending] = useState(false)
  const [deleteDialogError, setDeleteDialogError] = useState('')
  const [activeConnectionState, setActiveConnectionState] = useState<ApiConnectionState>('idle')
  const [apiRevision, setApiRevision] = useState(0)
  const [searchRevision, setSearchRevision] = useState(0)
  const [searchState, setSearchState] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [searchSyncFreshness, setSearchSyncFreshness] = useState<SearchSyncFreshness>('idle')
  const [searchLoaderVisible, setSearchLoaderVisible] = useState(false)
  const [searchError, setSearchError] = useState('')
  const [resultPage, setResultPage] = useState(() => parsePageParam(new URLSearchParams(window.location.search).get('page')))
  const [totalResultPages, setTotalResultPages] = useState(1)
  const [paginationPageCount, setPaginationPageCount] = useState(() => window.innerWidth <= 860 ? 5 : 7)
  const [viewerBook, setViewerBook] = useState<ApiBookCardModel>()
  const [viewerState, setViewerState] = useState<BookViewerRouteState>(() => viewerRoute?.state === 'ready' ? 'loading' : 'missing')
  const [viewerError, setViewerError] = useState('')
  const [viewerRevision, setViewerRevision] = useState(0)
  const realtimeEnabled = isLibrarySearch || isWebSearch || isDownloadManager
  const hubConnectionState = useBookDownloadHubConnection(realtimeEnabled, apiRevision)
  const menuButtonRef = useRef<HTMLButtonElement>(null)
  const advancedDialogRef = useRef<HTMLDialogElement>(null)
  const advancedPanelRef = useRef<HTMLFormElement>(null)
  const advancedPointerStartedOutsideRef = useRef(false)
  const advancedTriggerRef = useRef<HTMLButtonElement>(null)
  const advancedCloseReasonRef = useRef<'apply' | 'cancel'>('cancel')
  const apiSettingsDialogRef = useRef<HTMLDialogElement>(null)
  const apiSettingsPanelRef = useRef<HTMLFormElement>(null)
  const apiSettingsPointerStartedOutsideRef = useRef(false)
  const apiSettingsTriggerRef = useRef<HTMLButtonElement>(null)
  const draftConnectionAbortRef = useRef<AbortController | null>(null)
  const activeConnectionAbortRef = useRef<AbortController | null>(null)
  const activeSearchRequestRef = useRef<AbortController | null>(null)
  const searchRealtimeBufferRef = useRef<SearchRealtimeBuffer | null>(null)
  const pendingSearchStatusesRef = useRef(new Map<string, BufferedSearchStatusEvent>())
  const searchRealtimeFrameRef = useRef<number | null>(null)
  const searchStatusVersionsRef = useRef(new Map<string, number>())
  const announceActiveConnectionRef = useRef<'save' | 'reset' | null>(null)
  const deleteDialogRef = useRef<HTMLDialogElement>(null)
  const deleteDialogPanelRef = useRef<HTMLDivElement>(null)
  const deleteDialogPointerStartedOutsideRef = useRef(false)
  const deleteDialogTriggerRef = useRef<HTMLElement | null>(null)
  const deleteDialogPendingRef = useRef(false)

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
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && drawerOpen) {
        setDrawerOpen(false)
        menuButtonRef.current?.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [drawerOpen])

  useEffect(() => {
    document.body.classList.toggle('drawer-open', drawerOpen)
    return () => document.body.classList.remove('drawer-open')
  }, [drawerOpen])

  useEffect(() => {
    const updatePaginationPageCount = () => setPaginationPageCount(window.innerWidth <= 860 ? 5 : 7)
    window.addEventListener('resize', updatePaginationPageCount)
    return () => window.removeEventListener('resize', updatePaginationPageCount)
  }, [])

  useEffect(() => {
    activeConnectionAbortRef.current?.abort()
    const controller = new AbortController()
    activeConnectionAbortRef.current = controller
    const announcedAction = announceActiveConnectionRef.current
    setActiveConnectionState('pending')

    void testApiConnectionRequest(undefined, controller.signal)
      .then(() => {
        if (controller.signal.aborted) return
        setActiveConnectionState('success')
        if (announcedAction === 'save') notify('API設定を保存し、接続を確認しました')
        if (announcedAction === 'reset') notify('API設定を既定値へ戻し、接続を確認しました')
        if (announceActiveConnectionRef.current === announcedAction) announceActiveConnectionRef.current = null
      })
      .catch(() => {
        if (controller.signal.aborted) return
        setActiveConnectionState('error')
        if (announcedAction === 'save') notify('API設定を保存しましたが、接続を確認できませんでした', 'warning')
        if (announcedAction === 'reset') notify('API設定を既定値へ戻しましたが、接続を確認できませんでした', 'warning')
        if (announceActiveConnectionRef.current === announcedAction) announceActiveConnectionRef.current = null
      })
      .finally(() => {
        if (activeConnectionAbortRef.current === controller) activeConnectionAbortRef.current = null
      })

    return () => controller.abort()
  }, [apiRevision, notify])

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
    if (!isBookViewer || viewerRoute?.state !== 'ready' || !viewerRoute.groupId || !viewerRoute.bookId) {
      if (isBookViewer) setViewerState('missing')
      return
    }
    const controller = new AbortController()
    setViewerState('loading')
    setViewerError('')
    getBook(viewerRoute.groupId, viewerRoute.bookId, controller.signal)
      .then((response) => {
        const book = response.books?.[0]
        if (!book) {
          setViewerState('notFound')
          return
        }
        setViewerBook(mapEBookToCard(book, { context: 'library', entities: response.tags ?? [] }))
        setViewerState('ready')
      })
      .catch((error) => {
        if (controller.signal.aborted) return
        if (error instanceof ApiError && error.category === 'notFound') {
          setViewerState('notFound')
          return
        }
        setViewerError(getErrorMessage(error))
        setViewerState('error')
      })
    return () => controller.abort()
  }, [apiRevision, isBookViewer, viewerRevision, viewerRoute?.bookId, viewerRoute?.groupId, viewerRoute?.state])

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
    const syncFromUrl = () => {
      const params = new URLSearchParams(window.location.search)
      const nextCriteria = normalizeCriteriaForRoute(parseCriteriaFromUrl(params), isWebSearch)
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

  const submitSearch = (event: FormEvent) => {
    event.preventDefault()
    const nextCriteria: SearchCriteria = { ...emptyCriteria(), text: query.trim() }
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
  }

  const searchByTag = (tag: BookTag) => {
    const nextCriteria: SearchCriteria = { ...emptyCriteria(), tags: [resolveTag(tag)] }
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
  }

  const openAdvancedSearch = () => {
    setDraftCriteria(cloneCriteria(normalizeCriteriaForRoute(criteria, isWebSearch)))
    setDraftHitomiAppend(isWebSearch ? hitomiAppend : 'Normal')
    setAdvancedErrors({})
    setTagType('Artists')
    setTagInput('')
    setTagInputFocused(false)
    setHighlightedTagIndex(0)
    advancedCloseReasonRef.current = 'cancel'
    const dialog = advancedDialogRef.current
    if (dialog && !dialog.open) dialog.showModal()
    setAdvancedOpen(true)
  }

  const closeAdvancedSearch = (reason: 'apply' | 'cancel') => {
    advancedCloseReasonRef.current = reason
    const dialog = advancedDialogRef.current
    if (dialog?.open) {
      dialog.close()
    } else {
      setAdvancedOpen(false)
      window.requestAnimationFrame(() => (reason === 'apply'
        ? document.getElementById('results-region')
        : advancedTriggerRef.current)?.focus())
    }
  }

  const openApiSettings = () => {
    setApiSettingsDraft({ ...apiSettings })
    setApiSettingsErrors({})
    setApiSettingsSaveError('')
    setDraftConnectionState('idle')
    const dialog = apiSettingsDialogRef.current
    if (dialog && !dialog.open) dialog.showModal()
    setApiSettingsOpen(true)
  }

  const clearDraftConnectionCheck = () => {
    draftConnectionAbortRef.current?.abort()
    draftConnectionAbortRef.current = null
    setDraftConnectionError('')
    setDraftConnectionState('idle')
  }

  const closeApiSettings = () => {
    clearDraftConnectionCheck()
    const dialog = apiSettingsDialogRef.current
    if (dialog?.open) {
      dialog.close()
    } else {
      setApiSettingsOpen(false)
      window.requestAnimationFrame(() => apiSettingsTriggerRef.current?.focus())
    }
  }

  const testApiConnection = async () => {
    const { normalized, errors } = validateApiSettings(apiSettingsDraft)
    setApiSettingsErrors(errors)
    if (!normalized) return

    setApiSettingsDraft(normalized)
    setApiSettingsSaveError('')
    clearDraftConnectionCheck()
    setDraftConnectionState('pending')
    const controller = new AbortController()
    draftConnectionAbortRef.current = controller
    try {
      await testApiConnectionRequest(normalized, controller.signal)
      setDraftConnectionState('success')
    } catch (error) {
      if (controller.signal.aborted) return
      setDraftConnectionError(getErrorMessage(error))
      setDraftConnectionState('error')
    } finally {
      if (draftConnectionAbortRef.current === controller) draftConnectionAbortRef.current = null
    }
  }

  const saveApiSettings = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const { normalized, errors } = validateApiSettings(apiSettingsDraft)
    setApiSettingsErrors(errors)
    if (!normalized) return

    try {
      savePersistedApiSettings(normalized)
    } catch {
      setApiSettingsSaveError('API設定を端末へ保存できませんでした。ブラウザのストレージ設定を確認してください。')
      return
    }

    clearDraftConnectionCheck()
    configureApi(normalized)
    setApiSettings(normalized)
    setApiSettingsDraft(normalized)
    announceActiveConnectionRef.current = 'save'
    setApiRevision((current) => current + 1)
    closeApiSettings()
  }

  const resetApiSettings = () => {
    if (!window.confirm('端末に保存したAPI設定を削除し、既定値へ戻しますか？')) return

    try {
      clearPersistedApiSettings()
    } catch {
      setApiSettingsSaveError('端末に保存したAPI設定を削除できませんでした。ブラウザのストレージ設定を確認してください。')
      return
    }

    const defaults = configureApi({ ...DEFAULT_API_SETTINGS })
    clearDraftConnectionCheck()
    setApiSettings(defaults)
    setApiSettingsDraft(defaults)
    setApiSettingsErrors({})
    setApiSettingsSaveError('')
    announceActiveConnectionRef.current = 'reset'
    setApiRevision((current) => current + 1)
    closeApiSettings()
  }

  const applyAdvancedSearch = (event: FormEvent<HTMLFormElement>) => {
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
      tags: (isWebSearch ? draftCriteria.tags.slice(0, 1) : draftCriteria.tags).map((tag) => resolveTag(tag)),
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
    closeAdvancedSearch('apply')
  }

  const clearAdvancedDraft = () => {
    setDraftCriteria(emptyCriteria())
    setDraftHitomiAppend('Normal')
    setAdvancedErrors({})
    setTagType('Artists')
    setTagInput('')
    setHighlightedTagIndex(0)
  }

  const selectDraftTag = (tag: BookTag) => {
    setDraftCriteria((current) => isWebSearch
      ? { ...current, tags: [resolveTag(tag)], tagMode: 'and' }
      : current.tags.some((selectedTag) => sameTag(selectedTag, tag))
        ? current
        : { ...current, tags: [...current.tags, resolveTag(tag)] })
    setTagInput('')
    setHighlightedTagIndex(0)
    setTagInputFocused(true)
  }

  const removeDraftTag = (tag: BookTag) => {
    setDraftCriteria((current) => ({ ...current, tags: current.tags.filter((selectedTag) => !sameTag(selectedTag, tag)) }))
  }

  const closeDrawer = () => {
    setDrawerOpen(false)
    menuButtonRef.current?.focus()
  }

  const openDeleteDialog = (books: ApiBookCardModel[], trigger: HTMLElement | null) => {
    if (!books.length || deleteDialogPendingRef.current) return
    deleteDialogTriggerRef.current = trigger
    deleteDialogPendingRef.current = false
    setDeleteDialogBooks(books)
    setDeleteDialogError('')
    setDeleteDialogPending(false)
    const dialog = deleteDialogRef.current
    if (dialog && !dialog.open) dialog.showModal()
    setDeleteDialogOpen(true)
  }

  const closeDeleteDialog = () => {
    if (deleteDialogPendingRef.current) return
    const dialog = deleteDialogRef.current
    if (dialog?.open) {
      dialog.close()
    } else {
      setDeleteDialogOpen(false)
      const trigger = deleteDialogTriggerRef.current
      window.requestAnimationFrame(() => {
        if (trigger?.isConnected && !trigger.hasAttribute('disabled')) trigger.focus()
      })
    }
  }

  const finishDeleteDialog = () => {
    deleteDialogPendingRef.current = false
    setDeleteDialogPending(false)
    setDeleteDialogOpen(false)
    closeDeleteDialog()
  }

  const deleteLibraryBook = (book: BookCardModel, trigger?: HTMLElement) => {
    const bookKey = getBookIdentityKey(book)
    const targetBook = librarySearchBooks.find((candidate) => getBookIdentityKey(candidate) === bookKey)
    if (!targetBook) return
    openDeleteDialog([targetBook], trigger ?? null)
  }

  const confirmDeleteLibraryBooks = async () => {
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
        finishDeleteDialog()
      } else if (result.status === 'pending') {
        notify(`「${book.title}」の削除を受け付けました。処理中です。`, 'warning')
        finishDeleteDialog()
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
    finishDeleteDialog()
  }

  const fetchWebBook = async (book: BookCardModel) => {
    const apiGroupId = book.apiGroupId?.trim()
    const apiBookId = book.apiBookId?.trim()
    if (apiGroupId && apiBookId) {
      try {
        const response = await getWebBookCacheBook(apiGroupId, apiBookId)
        if (response.data) {
          const cached = mapWebCacheBookToCard(response.data)
          try {
            return (await overlaySavedBookStatuses([cached]))[0] ?? cached
          } catch {
            return cached
          }
        }
      } catch (error) {
        if (!book.url) throw error
      }
    }
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
  }

  const refreshWebBook = async (book: BookCardModel) => {
    const bookKey = getBookIdentityKey(book)
    try {
      const refreshed = await fetchWebBook(book)
      setWebSearchResultBooks((current) => current.map((candidate) => getBookIdentityKey(candidate) === bookKey ? refreshed : candidate))
      notify(`「${book.title}」のWeb情報を再取得しました`)
    } catch (error) {
      notify(`再取得できませんでした: ${getErrorMessage(error)}`, 'error')
    }
  }

  const refreshSelectedWebBooks = async () => {
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
  }

  const downloadWebBook = async (book: BookCardModel) => {
    if (book.status === 'Downloaded' || book.status === 'Downloading') return

    const bookKey = getBookIdentityKey(book)
    const apiGroupId = book.apiGroupId?.trim()
    const apiBookId = book.apiBookId?.trim()
    try {
      if (apiGroupId && apiBookId) {
        await downloadWebBookCacheBook(apiGroupId, apiBookId)
      }
      else if (book.url) await startBookDownload({ url: book.url, requestedBy: 'nyapture-web' })
      else throw new ApiError('Book URLがありません。', { category: 'validation' })
      setWebSearchResultBooks((current) => current.map((candidate) => getBookIdentityKey(candidate) === bookKey
        ? { ...candidate, status: 'Downloading' }
        : candidate))
      notify(`「${book.title}」のダウンロードを開始しました`)
    } catch (error) {
      notify(`ダウンロードを開始できませんでした: ${getErrorMessage(error)}`, 'error')
    }
  }

  const toggleSelection = (bookId: string) => {
    setSelected((current) => current.includes(bookId) ? current.filter((item) => item !== bookId) : [...current, bookId])
  }

  const selectAllVisibleBooks = () => {
    setSelected((current) => {
      const next = new Set(current)
      visibleBooks.forEach((book) => next.add(getBookIdentityKey(book)))
      return [...next]
    })
  }

  const deleteSelectedLibraryBooks = (trigger?: HTMLElement) => {
    const selectedKeys = new Set(selected)
    const deletedBooks = librarySearchBooks.filter((book) => selectedKeys.has(getBookIdentityKey(book)))
    if (!deletedBooks.length) return
    openDeleteDialog(deletedBooks, trigger ?? null)
  }

  const toggleSelectMode = () => {
    setSelectMode((current) => !current)
    setSelected([])
  }

  const refresh = () => {
    setSearchRevision((current) => current + 1)
  }

  const goToResultPage = (page: number) => {
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
  }

  const apiStatus = activeConnectionState === 'error'
    ? 'error'
    : activeConnectionState === 'pending'
      ? 'loading'
      : activeConnectionState === 'success'
        ? 'connected'
        : 'unknown'
  const ConnectionIcon = apiStatus === 'error'
    ? CircleAlert
    : apiStatus === 'loading'
      ? LoaderCircle
      : apiStatus === 'connected'
        ? CircleCheck
        : CircleHelp
  const connectionLabel = apiStatus === 'error'
    ? 'API接続エラー'
    : apiStatus === 'loading'
      ? 'API接続中'
      : apiStatus === 'connected'
        ? 'API接続済み'
        : 'API接続未確認'
  const realtimeIsStale = searchSyncFreshness === 'stale'
    || hubConnectionState === 'disconnected'
    || hubConnectionState === 'error'
  const realtimeStatusClass = hubConnectionState === 'connected' && !realtimeIsStale
    ? searchSyncFreshness === 'syncing' ? 'loading' : 'connected'
    : hubConnectionState === 'connecting' || hubConnectionState === 'reconnecting'
      ? 'loading'
      : hubConnectionState === 'error'
        ? 'error'
        : realtimeIsStale
          ? 'stale'
          : 'unknown'
  const realtimeConnectionLabel = hubConnectionState === 'connected'
    ? searchSyncFreshness === 'syncing'
      ? 'Book Statusを同期中'
      : searchSyncFreshness === 'stale'
        ? 'リアルタイム接続済み。Status表示が古い可能性があります'
        : 'Book Statusリアルタイム接続済み'
    : hubConnectionState === 'connecting'
      ? 'Book Statusリアルタイム接続中'
      : hubConnectionState === 'reconnecting'
        ? 'Book Statusを再接続中。表示が古い可能性があります'
        : hubConnectionState === 'error'
          ? 'Book Statusリアルタイム接続エラー。表示が古い可能性があります'
          : hubConnectionState === 'disconnected'
            ? 'Book Statusリアルタイム切断。表示が古い可能性があります'
            : 'Book Statusリアルタイム接続待機中'
  const draftConnectionStatusLabel = API_CONNECTION_STATE_LABELS[draftConnectionState]
  const isSearchLoading = searchState === 'loading'
  const showSearchLoader = isSearchLoading && searchLoaderVisible
  const searchLoadingAnnouncement = isWebSearch ? 'Hitomi検索結果を読み込み中' : '検索結果を読み込み中'
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

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">本文へ移動</a>

      <header className="topbar">
        <div className="topbar__brand">
          <button
            ref={menuButtonRef}
            className="icon-button menu-button"
            type="button"
            aria-label="ナビゲーションを開く"
            aria-expanded={drawerOpen}
            aria-controls="primary-navigation"
            onClick={() => setDrawerOpen(true)}
          >
            <Menu size={20} aria-hidden="true" />
          </button>
          <a className="brand" href="/search" aria-label="Nyapture ホーム">
            <span className="brand__mark"><img className="brand__image" src={nyaIcon} alt="" /></span>
            <span className="brand__name">Nyapture</span>
          </a>
        </div>

        {isDashboard ? (
          <span aria-hidden="true" />
        ) : (
          <form className="quick-search" role="search" onSubmit={submitSearch}>
          <label className="sr-only" htmlFor="header-search">{isWebSearch ? 'Web検索' : '蔵書'}を検索</label>
          <input
            id="header-search"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          {query && (
            <button className="search-clear" type="button" aria-label="検索語を消去" onClick={() => setQuery('')}>
              <X size={16} aria-hidden="true" />
            </button>
          )}
          <button className="search-submit" type="submit" aria-label="検索を実行">
            <Search size={16} aria-hidden="true" />
          </button>
          <span className="quick-search__divider" aria-hidden="true" />
          <button
            ref={advancedTriggerRef}
            className="search-detail"
            type="button"
            aria-label="詳細検索"
            aria-expanded={advancedOpen}
            aria-controls="advanced-search-dialog"
            onClick={openAdvancedSearch}
          >
            <SlidersHorizontal size={17} aria-hidden="true" />
          </button>
          </form>
        )}

        <div className="topbar__actions">
          {(isLibrarySearch || isWebSearch) && (
            <span
              className={`connection connection--realtime connection--${realtimeStatusClass}`}
              role="status"
              aria-label={realtimeConnectionLabel}
              aria-live="polite"
              data-realtime-state={hubConnectionState}
              data-sync-freshness={searchSyncFreshness}
            >
              <Radio className="connection__icon" aria-hidden="true" />
            </span>
          )}
          <span
            className={`connection connection--${apiStatus}`}
            role="status"
            aria-label={connectionLabel}
            aria-live="polite"
          >
            <ConnectionIcon className="connection__icon" aria-hidden="true" />
          </span>
          <button
            ref={apiSettingsTriggerRef}
            className="icon-button api-settings-trigger"
            type="button"
            aria-label="API設定を開く"
            aria-haspopup="dialog"
            aria-expanded={apiSettingsOpen}
            aria-controls="api-settings-dialog"
            onClick={openApiSettings}
          >
            <Settings size={18} aria-hidden="true" />
          </button>
        </div>
      </header>

      <button className="drawer-scrim" type="button" aria-label="ナビゲーションを閉じる" onClick={closeDrawer} />

      <aside id="primary-navigation" className={`drawer ${drawerOpen ? 'drawer--open' : ''}`} aria-label="メインナビゲーション">
        <div className="drawer__mobile-head">
          <span className="brand__mark"><img className="brand__image" src={nyaIcon} alt="" /></span>
          <span>Nyapture</span>
          <button className="icon-button" type="button" aria-label="ナビゲーションを閉じる" onClick={closeDrawer}>
            <X size={19} aria-hidden="true" />
          </button>
        </div>
        <nav>
        {navGroups.map((group) => (
            <div className="nav-group" key={group.label}>
              <h2>{group.label}</h2>
              <ul>
                {group.items.map((item) => {
                  const Icon = item.icon
                  const itemHref = 'href' in item ? item.href : undefined
                  const itemIsActive = itemHref === '/dashboard'
                    ? isDashboard
                    : itemHref === currentPath
                  return (
                    <li key={item.label}>
                      {itemHref ? (
                        <a href={itemHref} className={`nav-item ${itemIsActive ? 'nav-item--active' : ''}`} aria-current={itemIsActive ? 'page' : undefined} onClick={() => setDrawerOpen(false)}>
                          <Icon size={18} />
                          <span>{item.label}</span>
                        </a>
                      ) : (
                        <button className="nav-item" type="button" aria-label={`${item.label}（準備中）`} disabled>
                          <Icon size={18} />
                          <span>{item.label}</span>
                          <span className="nav-item__soon">Soon</span>
                        </button>
                      )}
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
        </nav>
      </aside>

      <main id="main-content" className="main-content" tabIndex={-1}>
        {isDownloadManager ? (
          <DownloadManager apiRevision={apiRevision} hubConnectionState={hubConnectionState} />
        ) : (
          <>
        {isDashboard ? (
          <Dashboard path={currentPath} apiRevision={apiRevision} />
        ) : (
          <>
        {isBookViewer ? (
          <BookViewerPage
            routeState={viewerState}
            book={viewerBook}
            routeIdentity={viewerRoute?.identity ?? 'missing'}
            errorMessage={viewerError}
            onRetry={() => setViewerRevision((current) => current + 1)}
            onTagSearch={searchByTag}
          />
        ) : (
          <>
        <h1 id="page-title" className="sr-only">{isWebSearch ? 'Web検索' : '蔵書検索'}</h1>

        <section className="filter-panel" aria-label="検索条件" hidden={!hasCriteria}>
          <div className="filter-values">
            {criteria.text && (
              <span className="filter-value">検索: {criteria.text}</span>
            )}
            {isWebSearch && hitomiAppend !== 'Normal' && (
              <span className="filter-value">HitomiAppend: {hitomiAppend}</span>
            )}
            {criteria.tags.length > 0 && (
              <span className="filter-value filter-value--tags">
                <span className="filter-value__operator">{criteria.tagMode === 'and' ? 'すべてのタグ' : 'いずれかのタグ'}:</span>
                {criteria.tags.map((tag) => (
                  <TagChip key={`${tag.type}:${tag.name}`} tag={tag} size="default" />
                ))}
              </span>
            )}
            {(criteria.dateFrom || criteria.dateTo) && (
              <span className="filter-value">
                日時: {criteria.dateFrom || '指定なし'} ～ {criteria.dateTo || '指定なし'}
              </span>
            )}
            {(criteria.pagesMin || criteria.pagesMax) && (
              <span className="filter-value">
                ページ数: {criteria.pagesMin || '指定なし'} ～ {criteria.pagesMax || '指定なし'}
              </span>
            )}
          </div>
        </section>

        <section id="results-region" className="results" aria-label={isWebSearch ? 'Web検索結果一覧' : '蔵書一覧'} aria-busy={isSearchLoading} tabIndex={-1}>
          <div className="results-toolbar">
            <div className="results-actions">
              {selectMode && <span className="selection-count" aria-live="polite">{selected.length}件を選択中</span>}
              <label className="sort-control sort-control--type">
                <span>並び順</span>
                {isWebSearch ? (
                  <select
                    value={hitomiSortPeriod}
                    aria-label="Hitomiの並び順"
                    disabled={isSearchLoading}
                    onChange={(event) => {
                      const nextPeriod = event.target.value as HitomiSortPeriod
                      setHitomiSortPeriod(nextPeriod)
                    }}
                  >
                    {HITOMI_SORT_PERIODS.map((period) => <option key={period.value} value={period.value}>{period.label}</option>)}
                  </select>
                ) : (
                  <select value={sortType} aria-label="並び順の種類" disabled={isSearchLoading} onChange={(event) => { setSortType(event.target.value as SortType); setResultPage(1) }}>
                    <option value="uploaded">アップロード日時</option>
                    <option value="title">タイトル順</option>
                    <option value="pages">ページ数順</option>
                  </select>
                )}
                <ChevronDown size={15} aria-hidden="true" />
              </label>
              {!isWebSearch && (
                <button
                  className="icon-button toolbar-icon sort-direction-toggle"
                  type="button"
                  aria-label={sortDirection === 'desc' ? '現在は降順。昇順に切り替える' : '現在は昇順。降順に切り替える'}
                  aria-pressed={sortDirection === 'asc'}
                  disabled={isSearchLoading}
                  onClick={() => { setSortDirection((current) => current === 'desc' ? 'asc' : 'desc'); setResultPage(1) }}
                >
                  {sortDirection === 'desc' ? <ArrowDown size={17} aria-hidden="true" /> : <ArrowUp size={17} aria-hidden="true" />}
                </button>
              )}
              <button
                className={`icon-button toolbar-icon selection-toggle ${selectMode ? 'is-active' : ''}`}
                type="button"
                aria-label={selectMode ? '選択を終了' : '選択'}
                aria-pressed={selectMode}
                disabled={isSearchLoading}
                onClick={toggleSelectMode}
              >
                <Check size={16} aria-hidden="true" />
              </button>
              <button className="icon-button toolbar-icon" type="button" aria-label="結果を更新" disabled={isSearchLoading} onClick={refresh}>
                <RefreshCw size={17} aria-hidden="true" />
              </button>
            </div>
          </div>

          {isWebSearch && selectMode && (
            <div className="selection-toolbar" role="group" aria-label="Web検索結果の一括操作">
              <button
                className="icon-button toolbar-icon"
                type="button"
                aria-label="全選択"
                disabled={isSearchLoading || visibleBooks.length === 0 || visibleBooks.every((book) => selected.includes(getBookIdentityKey(book)))}
                onClick={selectAllVisibleBooks}
              >
                <ListChecks size={17} aria-hidden="true" />
              </button>
              <button
                className="icon-button toolbar-icon"
                type="button"
                aria-label="読み込み"
                disabled={isSearchLoading || selected.length === 0}
                onClick={refreshSelectedWebBooks}
              >
                <RefreshCw size={17} aria-hidden="true" />
              </button>
            </div>
          )}

          {isLibrarySearch && selectMode && (
            <div className="selection-toolbar" role="group" aria-label="蔵書の一括操作">
              <button
                className="icon-button toolbar-icon"
                type="button"
                aria-label="全選択"
                disabled={isSearchLoading || visibleBooks.length === 0 || visibleBooks.every((book) => selected.includes(getBookIdentityKey(book)))}
                onClick={selectAllVisibleBooks}
              >
                <ListChecks size={17} aria-hidden="true" />
              </button>
              <button
                className="icon-button toolbar-icon selection-toolbar__delete"
                type="button"
                aria-label="選択を削除"
                disabled={isSearchLoading || selected.length === 0}
                onClick={(event) => deleteSelectedLibraryBooks(event.currentTarget)}
              >
                <Trash2 size={17} aria-hidden="true" />
              </button>
            </div>
          )}

          {isSearchLoading && (
            <p className="sr-only" role="status" aria-live="polite">{searchLoadingAnnouncement}</p>
          )}

          {searchState === 'error' && (
            <div className="empty-state" role="alert">
              <strong>検索結果を取得できませんでした</strong>
              <span>{searchError}</span>
              <button className="button button--secondary" type="button" disabled={isSearchLoading} onClick={refresh}>再試行</button>
            </div>
          )}

          <div className={`results-stage ${isSearchLoading && visibleBooks.length === 0 ? 'results-stage--loading-empty' : ''} ${showSearchLoader ? 'results-stage--loading-visible' : ''}`}>
            <div className="book-grid" aria-busy={isSearchLoading} inert={isSearchLoading ? true : undefined}>
              {visibleBooks.map((book) => {
                const bookKey = getBookIdentityKey(book)
                return (
                  <BookCard
                    key={bookKey}
                    book={book}
                    selectMode={selectMode}
                    selected={selected.includes(bookKey)}
                    onToggle={() => toggleSelection(bookKey)}
                    onTagSearch={searchByTag}
                    isDownloadCandidate={isWebSearch
                      && (book.status === 'WebBook' || book.status === 'WebBookInPage')
                      && book.tags.some((tag) => (
                        (tag.type === 'Artists' || tag.type === 'Groups')
                        && typeof tag.count === 'number'
                        && tag.count >= 1
                      ))}
                    isWebSearch={isWebSearch}
                    onDelete={!isWebSearch ? (trigger) => deleteLibraryBook(book, trigger) : undefined}
                    onRefresh={isWebSearch ? () => refreshWebBook(book) : undefined}
                    onDownload={isWebSearch ? () => downloadWebBook(book) : undefined}
                  />
                )
              })}
            </div>
            {showSearchLoader && (
              <div className="results-loading-overlay" aria-hidden="true">
                <LoaderCircle className="results-spinner" size={30} strokeWidth={2.1} />
              </div>
            )}
          </div>

          {searchState === 'success' && visibleBooks.length === 0 && (
            <div className="empty-state" role="status">
              <Search size={24} aria-hidden="true" />
              <strong>{hasCriteria ? `条件に一致する${isWebSearch ? 'Web検索結果' : '蔵書'}がありません` : `${isWebSearch ? 'Web検索結果' : '蔵書'}はありません`}</strong>
            </div>
          )}

          {visibleBooks.length > 0 && totalResultPages > 1 && (
            <nav className="pagination" aria-label="検索結果のページ">
              {getPaginationItems(resultPage, totalResultPages, paginationPageCount).map((item, index) => item === 'ellipsis'
                ? <span key={`ellipsis-${index}`} className="pagination__ellipsis" aria-hidden="true">…</span>
                : item === resultPage
                  ? <span key={item} className="pagination__current" aria-current="page" aria-label={`現在${item}ページ（全${totalResultPages}ページ中）`}>{item}</span>
                  : <button key={item} type="button" aria-label={`${item}ページへ移動`} disabled={isSearchLoading} onClick={() => goToResultPage(item)}>{item}</button>)}
            </nav>
          )}
        </section>
          </>
        )}
          </>
        )}
          </>
        )}

        <dialog
          ref={advancedDialogRef}
          id="advanced-search-dialog"
          className="advanced-dialog"
          aria-labelledby="advanced-search-title"
          onCancel={(event) => {
            event.preventDefault()
            closeAdvancedSearch('cancel')
          }}
          onClose={() => {
            const reason = advancedCloseReasonRef.current
            setAdvancedOpen(false)
            setTagInputFocused(false)
            advancedCloseReasonRef.current = 'cancel'
            window.requestAnimationFrame(() => {
              const target = reason === 'apply' ? document.getElementById('results-region') : advancedTriggerRef.current
              target?.focus()
            })
          }}
          onPointerDown={(event) => {
            const panel = advancedPanelRef.current
            if (!panel) return
            const rect = panel.getBoundingClientRect()
            advancedPointerStartedOutsideRef.current = event.clientX < rect.left
              || event.clientX > rect.right
              || event.clientY < rect.top
              || event.clientY > rect.bottom
          }}
          onClick={(event) => {
            if (event.target === event.currentTarget && advancedPointerStartedOutsideRef.current) closeAdvancedSearch('cancel')
            advancedPointerStartedOutsideRef.current = false
          }}
        >
          <form ref={advancedPanelRef} className="advanced-dialog__panel" noValidate onSubmit={applyAdvancedSearch}>
            <header className="advanced-dialog__header">
              <div>
                <h2 id="advanced-search-title">詳細検索</h2>
              </div>
              <button className="icon-button" type="button" aria-label="詳細検索を閉じる" onClick={() => closeAdvancedSearch('cancel')}>
                <X size={19} aria-hidden="true" />
              </button>
            </header>

            <div className="advanced-dialog__body">
              {!isWebSearch && (
                <section className="advanced-dialog__field">
                  <label htmlFor="advanced-search-text">テキスト入力</label>
                  <input
                    id="advanced-search-text"
                    type="search"
                    value={draftCriteria.text}
                    placeholder="タイトル、作者、タグを検索"
                    onChange={(event) => setDraftCriteria((current) => ({ ...current, text: event.target.value }))}
                  />
                </section>
              )}

              <section className="advanced-dialog__field">
                <label htmlFor="advanced-tag-type">タグ選択</label>
                <div className="advanced-tag-picker">
                  <select
                    id="advanced-tag-type"
                    value={tagType}
                    aria-label="タグの種別"
                    onChange={(event) => {
                      setTagType(event.target.value as NyaTagType)
                      setHighlightedTagIndex(0)
                    }}
                  >
                    {TAG_TYPE_ORDER.map((type) => <option key={type} value={type}>{TAG_TYPE_LABELS[type]}</option>)}
                  </select>
                  <div className="advanced-tag-combobox">
                    <input
                      id="advanced-tag-input"
                      type="text"
                      role="combobox"
                      value={tagInput}
                      placeholder="タグを入力して選択"
                      autoComplete="off"
                      aria-autocomplete="list"
                      aria-expanded={showTagCandidates}
                      aria-controls="advanced-tag-options"
                      aria-activedescendant={showTagCandidates && tagCandidates[highlightedTagIndex] ? `advanced-tag-option-${highlightedTagIndex}` : undefined}
                      onFocus={() => setTagInputFocused(true)}
                      onBlur={() => window.setTimeout(() => setTagInputFocused(false), 120)}
                      onChange={(event) => {
                        setTagInput(event.target.value)
                        setHighlightedTagIndex(0)
                        setTagInputFocused(true)
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'ArrowDown' && tagCandidates.length) {
                          event.preventDefault()
                          setHighlightedTagIndex((current) => Math.min(current + 1, tagCandidates.length - 1))
                        } else if (event.key === 'ArrowUp' && tagCandidates.length) {
                          event.preventDefault()
                          setHighlightedTagIndex((current) => Math.max(current - 1, 0))
                        } else if (event.key === 'Enter' && showTagCandidates && tagCandidates[highlightedTagIndex]) {
                          event.preventDefault()
                          selectDraftTag(tagCandidates[highlightedTagIndex])
                        } else if (event.key === 'Escape' && (tagInput || showTagCandidates)) {
                          event.preventDefault()
                          event.stopPropagation()
                          setTagInput('')
                          setTagInputFocused(false)
                          setHighlightedTagIndex(0)
                        }
                      }}
                    />
                    {showTagCandidates && (
                      <ul id="advanced-tag-options" className="advanced-tag-options" role="listbox" aria-label={`${TAG_TYPE_LABELS[tagType]}の候補`}>
                        {tagCandidates.map((tag, index) => {
                          const formattedCount = formatTagCount(tag.count)
                          return (
                            <li key={`${tag.type}:${tag.name}`} role="presentation">
                              <button
                                id={`advanced-tag-option-${index}`}
                                data-tag-type={tag.type}
                                type="button"
                                role="option"
                                aria-selected={index === highlightedTagIndex}
                                onMouseDown={(event) => event.preventDefault()}
                                onMouseEnter={() => setHighlightedTagIndex(index)}
                                onClick={() => selectDraftTag(tag)}
                              >
                                <span aria-hidden="true">#</span>
                                <span className="advanced-tag-option__text">
                                  <span>{getTagLabel(tag)}</span>
                                  {tag.displayName && tag.displayName !== tag.name && <small>{tag.name}</small>}
                                </span>
                                {formattedCount !== null && (
                                  <span className="advanced-tag-option__count">
                                    <span className="sr-only">使用回数 </span>
                                    {formattedCount}
                                    <span className="sr-only"> 件</span>
                                  </span>
                                )}
                              </button>
                            </li>
                          )
                        })}
                      </ul>
                    )}
                  </div>
                </div>
                {draftCriteria.tags.length > 0 && (
                  <div className="advanced-selected-tags" aria-label="選択済みタグ">
                    {draftCriteria.tags.map((tag) => (
                      <TagChip
                        key={`${tag.type}:${tag.name}`}
                        tag={tag}
                        size="default"
                        onRemove={() => removeDraftTag(tag)}
                      />
                    ))}
                  </div>
                )}
                {!isWebSearch && (
                  <fieldset className="advanced-tag-mode">
                    <legend>タグの一致条件</legend>
                    <label><input type="radio" name="advanced-tag-mode" value="and" checked={draftCriteria.tagMode === 'and'} onChange={() => setDraftCriteria((current) => ({ ...current, tagMode: 'and' }))} />すべて一致</label>
                    <label><input type="radio" name="advanced-tag-mode" value="or" checked={draftCriteria.tagMode === 'or'} onChange={() => setDraftCriteria((current) => ({ ...current, tagMode: 'or' }))} />いずれか一致</label>
                  </fieldset>
                )}
              </section>

              {isWebSearch && (
                <section className="advanced-dialog__field">
                  <label htmlFor="hitomi-append">HitomiAppend</label>
                  <select id="hitomi-append" value={draftHitomiAppend} onChange={(event) => setDraftHitomiAppend(event.target.value as HitomiAppend)}>
                    {HITOMI_APPENDS.map((append) => <option key={append} value={append}>{append}</option>)}
                  </select>
                </section>
              )}

              {!isWebSearch && (
                <>
                  <fieldset className="advanced-dialog__field advanced-range-field">
                    <legend>日時範囲</legend>
                    <div className="advanced-range-grid">
                      <label htmlFor="advanced-date-from">開始日</label>
                      <input id="advanced-date-from" type="date" value={draftCriteria.dateFrom} aria-invalid={Boolean(advancedErrors.date)} aria-describedby={advancedErrors.date ? 'advanced-date-error' : undefined} onChange={(event) => { setDraftCriteria((current) => ({ ...current, dateFrom: event.target.value })); setAdvancedErrors((current) => ({ ...current, date: undefined })) }} />
                      <label htmlFor="advanced-date-to">終了日</label>
                      <input id="advanced-date-to" type="date" value={draftCriteria.dateTo} aria-invalid={Boolean(advancedErrors.date)} aria-describedby={advancedErrors.date ? 'advanced-date-error' : undefined} onChange={(event) => { setDraftCriteria((current) => ({ ...current, dateTo: event.target.value })); setAdvancedErrors((current) => ({ ...current, date: undefined })) }} />
                    </div>
                    {advancedErrors.date && <p id="advanced-date-error" className="advanced-field-error" role="alert">{advancedErrors.date}</p>}
                  </fieldset>

                  <fieldset className="advanced-dialog__field advanced-range-field">
                    <legend>ページ数範囲</legend>
                    <div className="advanced-range-grid">
                      <label htmlFor="advanced-pages-min">最小ページ数</label>
                      <input id="advanced-pages-min" type="number" min="1" step="1" inputMode="numeric" value={draftCriteria.pagesMin} aria-invalid={Boolean(advancedErrors.pages)} aria-describedby={advancedErrors.pages ? 'advanced-pages-error' : undefined} onChange={(event) => { setDraftCriteria((current) => ({ ...current, pagesMin: event.target.value })); setAdvancedErrors((current) => ({ ...current, pages: undefined })) }} />
                      <label htmlFor="advanced-pages-max">最大ページ数</label>
                      <input id="advanced-pages-max" type="number" min="1" step="1" inputMode="numeric" value={draftCriteria.pagesMax} aria-invalid={Boolean(advancedErrors.pages)} aria-describedby={advancedErrors.pages ? 'advanced-pages-error' : undefined} onChange={(event) => { setDraftCriteria((current) => ({ ...current, pagesMax: event.target.value })); setAdvancedErrors((current) => ({ ...current, pages: undefined })) }} />
                    </div>
                    {advancedErrors.pages && <p id="advanced-pages-error" className="advanced-field-error" role="alert">{advancedErrors.pages}</p>}
                  </fieldset>
                </>
              )}
            </div>

            <footer className="advanced-dialog__footer">
              <button className="icon-button" type="button" aria-label="検索条件をクリア" onClick={clearAdvancedDraft}>
                <Eraser size={17} aria-hidden="true" />
              </button>
              <span />
              <button className="button button--primary" type="submit"><Search size={15} aria-hidden="true" />検索</button>
            </footer>
          </form>
        </dialog>

        <dialog
          ref={apiSettingsDialogRef}
          id="api-settings-dialog"
          className="advanced-dialog api-settings-dialog"
          aria-labelledby="api-settings-title"
          onCancel={(event) => {
            event.preventDefault()
            closeApiSettings()
          }}
          onKeyDown={(event) => {
            if (event.key !== 'Escape') return
            event.preventDefault()
            closeApiSettings()
          }}
          onClose={() => {
            draftConnectionAbortRef.current?.abort()
            draftConnectionAbortRef.current = null
            setDraftConnectionState('idle')
            setApiSettingsOpen(false)
            window.requestAnimationFrame(() => apiSettingsTriggerRef.current?.focus())
          }}
          onPointerDown={(event) => {
            const panel = apiSettingsPanelRef.current
            if (!panel) return
            const rect = panel.getBoundingClientRect()
            apiSettingsPointerStartedOutsideRef.current = event.clientX < rect.left
              || event.clientX > rect.right
              || event.clientY < rect.top
              || event.clientY > rect.bottom
          }}
          onClick={(event) => {
            if (event.target === event.currentTarget && apiSettingsPointerStartedOutsideRef.current) closeApiSettings()
            apiSettingsPointerStartedOutsideRef.current = false
          }}
        >
          <form ref={apiSettingsPanelRef} className="advanced-dialog__panel api-settings-dialog__panel" noValidate onSubmit={saveApiSettings}>
            <header className="advanced-dialog__header">
              <div>
                <h2 id="api-settings-title">API設定</h2>
              </div>
              <div className="api-settings-dialog__header-actions">
                <span
                  className={`api-settings__connection-indicator api-settings__connection-indicator--${draftConnectionState}`}
                  role="status"
                  aria-live="polite"
                  aria-atomic="true"
                  aria-label={`API接続状態: ${draftConnectionStatusLabel}`}
                >
                  <span className="api-settings__connection-indicator-dot" aria-hidden="true" />
                  <span className={draftConnectionState === 'pending' ? 'sr-only' : undefined}>{draftConnectionStatusLabel}</span>
                </span>
                <button className="icon-button" type="button" aria-label="API設定を閉じる" onClick={closeApiSettings}>
                  <X size={19} aria-hidden="true" />
                </button>
              </div>
            </header>

            <div className="advanced-dialog__body">
              <section className="advanced-dialog__field">
                <label htmlFor="api-settings-url">APIのURL</label>
                <input
                  id="api-settings-url"
                  type="url"
                  required
                  value={apiSettingsDraft.apiUrl}
                  placeholder="http://localhost:5270"
                  autoComplete="url"
                  aria-invalid={Boolean(apiSettingsErrors.apiUrl)}
                  aria-describedby={apiSettingsErrors.apiUrl ? 'api-settings-url-error' : undefined}
                  onChange={(event) => {
                    clearDraftConnectionCheck()
                    setApiSettingsSaveError('')
                    setApiSettingsDraft((current) => ({ ...current, apiUrl: event.target.value }))
                    setApiSettingsErrors((current) => ({ ...current, apiUrl: undefined }))
                  }}
                />
                {apiSettingsErrors.apiUrl && <p id="api-settings-url-error" className="advanced-field-error" role="alert">{apiSettingsErrors.apiUrl}</p>}
              </section>

              <section className="advanced-dialog__field">
                <label htmlFor="api-settings-api-key">APIKey（任意）</label>
                <input
                  id="api-settings-api-key"
                  type="password"
                  value={apiSettingsDraft.apiKey}
                  autoComplete="new-password"
                  onChange={(event) => {
                    clearDraftConnectionCheck()
                    setApiSettingsSaveError('')
                    setApiSettingsDraft((current) => ({ ...current, apiKey: event.target.value }))
                  }}
                />
              </section>

              <section className="advanced-dialog__field">
                <label htmlFor="api-settings-edit-key">EditKey（任意）</label>
                <input
                  id="api-settings-edit-key"
                  type="password"
                  value={apiSettingsDraft.editKey}
                  autoComplete="new-password"
                  onChange={(event) => {
                    clearDraftConnectionCheck()
                    setApiSettingsSaveError('')
                    setApiSettingsDraft((current) => ({ ...current, editKey: event.target.value }))
                  }}
                />
              </section>

              <section className="advanced-dialog__field">
                <label htmlFor="api-settings-timeout">タイムアウト秒数</label>
                <input
                  id="api-settings-timeout"
                  type="number"
                  required
                  min="1"
                  max="3600"
                  step="1"
                  inputMode="numeric"
                  value={apiSettingsDraft.timeoutSeconds}
                  aria-invalid={Boolean(apiSettingsErrors.timeoutSeconds)}
                  aria-describedby={apiSettingsErrors.timeoutSeconds ? 'api-settings-timeout-error' : undefined}
                  onChange={(event) => {
                    clearDraftConnectionCheck()
                    setApiSettingsSaveError('')
                    setApiSettingsDraft((current) => ({ ...current, timeoutSeconds: Number(event.target.value) }))
                    setApiSettingsErrors((current) => ({ ...current, timeoutSeconds: undefined }))
                  }}
                />
                {apiSettingsErrors.timeoutSeconds && <p id="api-settings-timeout-error" className="advanced-field-error" role="alert">{apiSettingsErrors.timeoutSeconds}</p>}
              </section>

              {draftConnectionState === 'error' && (
                <p className="advanced-field-error" role="alert">{draftConnectionError}</p>
              )}
              {apiSettingsSaveError && <p className="advanced-field-error" role="alert">{apiSettingsSaveError}</p>}
            </div>

            <footer className="advanced-dialog__footer api-settings-dialog__footer">
              <button
                className="button button--ghost api-settings-dialog__action"
                type="button"
                aria-label="接続確認"
                title="接続確認"
                disabled={draftConnectionState === 'pending'}
                onClick={testApiConnection}
              >
                {draftConnectionState === 'pending'
                  ? <LoaderCircle className="api-settings-dialog__action-icon api-settings-dialog__action-icon--spinning" size={18} aria-hidden="true" />
                  : <PlugZap className="api-settings-dialog__action-icon" size={18} aria-hidden="true" />}
              </button>
              <button
                className="button button--danger-ghost api-settings-dialog__action"
                type="button"
                aria-label="端末から削除"
                title="端末から削除"
                disabled={draftConnectionState === 'pending'}
                onClick={resetApiSettings}
              >
                <Trash2 className="api-settings-dialog__action-icon" size={18} aria-hidden="true" />
              </button>
              <span />
              <button className="button button--primary api-settings-dialog__action" type="submit" aria-label="保存" title="保存">
                <Save className="api-settings-dialog__action-icon" size={18} aria-hidden="true" />
              </button>
            </footer>
          </form>
        </dialog>

        <dialog
          ref={deleteDialogRef}
          id="library-delete-dialog"
          className="delete-dialog"
          aria-labelledby="delete-dialog-title"
          aria-describedby="delete-dialog-description"
          onCancel={(event) => {
            event.preventDefault()
            if (!deleteDialogPendingRef.current) closeDeleteDialog()
          }}
          onKeyDown={(event) => {
            if (event.key !== 'Escape') return
            event.preventDefault()
            if (!deleteDialogPendingRef.current) closeDeleteDialog()
          }}
          onClose={() => {
            if (deleteDialogPendingRef.current) {
              window.requestAnimationFrame(() => {
                const dialog = deleteDialogRef.current
                if (dialog && !dialog.open) dialog.showModal()
              })
              return
            }
            setDeleteDialogOpen(false)
            setDeleteDialogBooks([])
            setDeleteDialogError('')
            const trigger = deleteDialogTriggerRef.current
            deleteDialogTriggerRef.current = null
            window.requestAnimationFrame(() => {
              if (trigger?.isConnected && !trigger.hasAttribute('disabled')) trigger.focus()
            })
          }}
          onPointerDown={(event) => {
            const panel = deleteDialogPanelRef.current
            if (!panel) return
            const rect = panel.getBoundingClientRect()
            deleteDialogPointerStartedOutsideRef.current = event.clientX < rect.left
              || event.clientX > rect.right
              || event.clientY < rect.top
              || event.clientY > rect.bottom
          }}
          onClick={(event) => {
            if (event.target === event.currentTarget && deleteDialogPointerStartedOutsideRef.current && !deleteDialogPendingRef.current) {
              closeDeleteDialog()
            }
            deleteDialogPointerStartedOutsideRef.current = false
          }}
        >
          <div ref={deleteDialogPanelRef} className="delete-dialog__panel">
            <header className="delete-dialog__header">
              <div>
                <span>蔵書の削除</span>
                <h2 id="delete-dialog-title">削除の確認</h2>
              </div>
            </header>

            <div className="delete-dialog__body">
              {deleteDialogPending && <p className="sr-only" role="status" aria-live="polite">削除しています。完了までお待ちください。</p>}
              {deleteDialogBook ? (
                <>
                  <p id="delete-dialog-description" className="delete-dialog__description">
                    「{deleteDialogBook.title}」を削除します。この操作は取り消せません。
                  </p>
                  <div className="delete-dialog__single">
                    <Thumbnail
                      className="delete-dialog__thumbnail"
                      src={deleteDialogBook.thumbnailUrl}
                      load={deleteDialogThumbnailRequest ? loadDeleteDialogThumbnail : undefined}
                      alt={`${deleteDialogBook.title}の表紙`}
                      fallbackText={deleteDialogBook.thumbnailUrl || deleteDialogThumbnailRequest ? '画像を読み込めませんでした' : 'サムネイルはありません'}
                      fallbackAriaLabel={`${deleteDialogBook.title}のサムネイルを表示できません`}
                      variant={deleteDialogBook.cover}
                    />
                    <p className="delete-dialog__book-title">{deleteDialogBook.title}</p>
                  </div>
                </>
              ) : (
                <>
                  <p id="delete-dialog-description" className="delete-dialog__description">
                    選択した蔵書を削除します。この操作は取り消せません。
                  </p>
                  <ul className="delete-dialog__title-list" aria-label="削除対象の蔵書">
                    {deleteDialogBooks.map((book) => <li key={getBookIdentityKey(book)}>{book.title}</li>)}
                  </ul>
                </>
              )}
              {deleteDialogError && <p className="delete-dialog__error" role="alert">{deleteDialogError}</p>}
            </div>

            <footer className="delete-dialog__footer">
              <button
                className="icon-button delete-dialog__action delete-dialog__action--cancel"
                type="button"
                aria-label="削除をキャンセル"
                title="削除をキャンセル"
                disabled={deleteDialogPending}
                onClick={closeDeleteDialog}
              >
                <X size={19} aria-hidden="true" />
              </button>
              <span />
              <button
                className="icon-button delete-dialog__action delete-dialog__action--confirm"
                type="button"
                aria-label={deleteDialogPending ? '削除中' : '削除を実行'}
                title={deleteDialogPending ? '削除中' : '削除を実行'}
                disabled={deleteDialogPending}
                onClick={confirmDeleteLibraryBooks}
              >
                {deleteDialogPending
                  ? <LoaderCircle className="delete-dialog__spinner" size={19} aria-hidden="true" />
                  : <Trash2 size={19} aria-hidden="true" />}
              </button>
            </footer>
          </div>
        </dialog>

        <Snackbar notice={notice} onDismiss={dismiss} />
      </main>
    </div>
  )
}

function BookCard({
  book,
  selectMode,
  selected,
  onToggle,
  onTagSearch,
  isDownloadCandidate = false,
  isWebSearch,
  onDelete,
  onRefresh,
  onDownload,
}: {
  book: BookCardModel
  selectMode: boolean
  selected: boolean
  onToggle: () => void
  onTagSearch: (tag: BookTag) => void
  isDownloadCandidate?: boolean
  isWebSearch: boolean
  onDelete?: (trigger: HTMLButtonElement) => void
  onRefresh?: () => void
  onDownload?: () => void
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const tagsPanelRef = useRef<HTMLDivElement>(null)
  const tagsPointerStartedOutsideRef = useRef(false)
  const tagsTriggerRef = useRef<HTMLButtonElement>(null)
  const thumbnailRequest = (book as ApiBookCardModel).thumbnailRequest
  const thumbnailReloadKey = (book as ApiBookCardModel).thumbnailReloadKey
  const sourceLabel = book.sourceLabel?.trim() || undefined
  const loadThumbnail = useCallback((signal: AbortSignal) => {
    if (!thumbnailRequest) return Promise.reject(new Error('Thumbnail request is unavailable'))
    return requestBlob(thumbnailRequest.path, { query: thumbnailRequest.query, headers: { Accept: 'image/*' }, signal })
  }, [thumbnailRequest])
  const inlineTags = [
    ...book.tags.filter((tag) => tag.type === 'Artists'),
    ...book.tags.filter((tag) => tag.type === 'Groups'),
  ].slice(0, 2)
  const hiddenTagCount = Math.max(0, book.tags.length - inlineTags.length)
  const viewerUrl = `/book/viewer?id=${encodeURIComponent(book.bookId)}&gid=${encodeURIComponent(book.groupId)}`
  const downloadDisabled = book.status === 'Downloaded' || book.status === 'Downloading'
  const downloadLabel = book.status === 'Downloaded'
    ? `${book.title}はダウンロード済み`
    : book.status === 'Downloading'
      ? `${book.title}はダウンロード中`
      : `${book.title}をダウンロード`

  const openTagsDialog = () => dialogRef.current?.showModal()
  const closeTagsDialog = () => dialogRef.current?.close()

  return (
    <article className={`book-card ${selected ? 'book-card--selected' : ''} ${isDownloadCandidate ? 'book-card--download-candidate' : ''}`} data-book-status={book.status}>
      <Thumbnail
        src={book.thumbnailUrl}
        load={thumbnailRequest ? loadThumbnail : undefined}
        reloadKey={thumbnailReloadKey}
        alt={`${book.title}の表紙`}
        linkHref={viewerUrl}
        linkAriaLabel={`${book.title}を閲覧`}
        linkTabIndex={selectMode ? -1 : undefined}
        fallbackText={book.thumbnailUrl || thumbnailRequest ? '画像を読み込めませんでした' : 'サムネイルはありません'}
        fallbackAriaLabel={`${book.title}のサムネイルを表示できません`}
        variant={book.cover}
      >
        <BookStatusBadge status={book.status} />
        {sourceLabel && <span className="source-badge">{sourceLabel}</span>}
        {selectMode ? (
          <button className="card-select" type="button" aria-label={`${book.title}を${selected ? '選択解除' : '選択'}`} aria-pressed={selected} onClick={onToggle}>
            {selected && <Check size={15} />}
          </button>
        ) : isWebSearch ? (
          <div className="card-actions" aria-label={`${book.title}の操作`}>
            <button className="card-action" type="button" aria-label={`${book.title}を再読み込み`} onClick={() => onRefresh?.()}>
              <RefreshCw size={16} aria-hidden="true" />
            </button>
            <button className="card-action" type="button" aria-label={downloadLabel} disabled={downloadDisabled} onClick={() => onDownload?.()}>
              <Download size={16} aria-hidden="true" />
            </button>
          </div>
        ) : (
          <button className="card-action card-action--delete" type="button" aria-label={`${book.title}を削除`} onClick={(event) => onDelete?.(event.currentTarget)}>
            <Trash2 size={17} aria-hidden="true" />
          </button>
        )}
      </Thumbnail>
      <div className="book-card__body">
        <div className="book-card__title-row">
          <h3><a href={viewerUrl}>{book.title}</a></h3>
        </div>
        <div className="book-tags" aria-label="主要タグ">
          {inlineTags.map((tag) => (
            <TagChip key={`${tag.type}:${tag.name}`} tag={tag} size="compact" onClick={() => onTagSearch(tag)} />
          ))}
          {hiddenTagCount > 0 && (
            <button
              ref={tagsTriggerRef}
              className="tag-overflow"
              type="button"
              aria-label={`${book.title}の残り${hiddenTagCount}件のタグを表示`}
              onClick={openTagsDialog}
            >
              +{hiddenTagCount}
            </button>
          )}
        </div>
        <div className="book-card__meta">
          <span><Files size={13} aria-hidden="true" />{book.totalPage}ページ</span>
          <time dateTime={book.uploadedTime}><CalendarDays size={13} aria-hidden="true" />{formatDisplayDate(book.uploadedTime)}</time>
        </div>
      </div>
      <dialog
        ref={dialogRef}
        className="tags-dialog"
        aria-labelledby={`tags-dialog-title-${book.bookId}`}
        onClose={() => tagsTriggerRef.current?.focus()}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            closeTagsDialog()
          }
        }}
        onPointerDown={(event) => {
          const panel = tagsPanelRef.current
          if (!panel) return
          const rect = panel.getBoundingClientRect()
          tagsPointerStartedOutsideRef.current = event.clientX < rect.left
            || event.clientX > rect.right
            || event.clientY < rect.top
            || event.clientY > rect.bottom
        }}
        onClick={(event) => {
          if (event.target === event.currentTarget && tagsPointerStartedOutsideRef.current) closeTagsDialog()
          tagsPointerStartedOutsideRef.current = false
        }}
      >
        <div ref={tagsPanelRef} className="tags-dialog__panel">
          <header className="tags-dialog__header">
            <div>
              <span>タグ一覧</span>
              <h2 id={`tags-dialog-title-${book.bookId}`}>{book.title}</h2>
            </div>
            <button className="icon-button" type="button" aria-label="タグ一覧を閉じる" onClick={closeTagsDialog}>
              <X size={19} aria-hidden="true" />
            </button>
          </header>
          <div className="tags-dialog__body">
            {TAG_TYPE_ORDER.map((type) => {
              const tags = book.tags.filter((tag) => tag.type === type)
              if (!tags.length) return null
              return (
                <section className="tags-dialog__group" key={type} aria-labelledby={`tags-${book.bookId}-${type}`}>
                  <div className="tags-dialog__group-heading">
                    <h3 id={`tags-${book.bookId}-${type}`}>{TAG_TYPE_LABELS[type]}</h3>
                    <span>{tags.length}</span>
                  </div>
                  <div className="tags-dialog__chips">
                    {tags.map((tag) => (
                      <TagChip
                        key={`${tag.type}:${tag.name}`}
                        tag={tag}
                        size="default"
                        title={tag.displayName && tag.displayName !== tag.name ? tag.name : undefined}
                        onClick={() => {
                          closeTagsDialog()
                          onTagSearch(tag)
                        }}
                      />
                    ))}
                  </div>
                </section>
              )
            })}
          </div>
        </div>
      </dialog>
    </article>
  )
}

export default App
