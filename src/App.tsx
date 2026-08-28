import {
  ArrowDown,
  ArrowUp,
  BookOpen,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Download,
  Files,
  Gauge,
  Globe2,
  ListChecks,
  ListFilter,
  Menu,
  RefreshCw,
  Search,
  Settings,
  SlidersHorizontal,
  Trash2,
  X,
} from 'lucide-react'
import { FormEvent, useEffect, useRef, useState } from 'react'

import nyaIcon from './assets/icon.png'
import { BookStatusBadge } from './components/BookStatusBadge'
import { BookViewerPage } from './components/BookViewerPage'
import { Dashboard } from './components/Dashboard'
import { DownloadManager } from './components/DownloadManager'
import { TagChip } from './components/TagChip'
import { Thumbnail } from './components/Thumbnail'
import { libraryBooks, webSearchBooks } from './mocks/books'
import { getTagLabel, HITOMI_APPENDS, TAG_TYPE_LABELS, TAG_TYPE_ORDER } from './models'
import type { BookCardModel, BookTag, HitomiAppend, NyaTagType, SearchCriteria, SortDirection, SortType } from './models'

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

const resolveTag = (tag: BookTag): BookTag => (
  [...libraryBooks, ...webSearchBooks]
    .flatMap((book) => book.tags)
    .find((candidate) => candidate.type === tag.type && candidate.name === tag.name) ?? tag
)

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

const hasBookIdentifier = (value: string | undefined) => Boolean(value?.trim())

const getBookIdentityKey = (book: Pick<BookCardModel, 'groupId' | 'bookId'>) => `${book.groupId}\u0000${book.bookId}`

const MOCK_REFRESHED_TIME = '2026-08-28T18:00:00+09:00'

const refreshWebBookModel = (book: BookCardModel): BookCardModel => {
  if (book.status === 'WebBookInPage') return { ...book, status: 'WebBook' }
  if (book.status === 'WebBook' && book.uploadedTime !== MOCK_REFRESHED_TIME) {
    return {
      ...book,
      totalPage: book.totalPage + 1,
      uploadedTime: MOCK_REFRESHED_TIME,
    }
  }
  return book
}

export type BookViewerRouteState = 'missing' | 'notFound' | 'ready'

export type BookViewerRoute = {
  state: BookViewerRouteState
  book?: BookCardModel
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

  const book = libraryBooks.find((candidate) => candidate.bookId === idParam && candidate.groupId === gidParam)
    ?? webSearchBooks.find((candidate) => candidate.bookId === idParam && candidate.groupId === gidParam)

  return book
    ? { state: 'ready', book, identity }
    : { state: 'notFound', identity }
}

type HitomiSortPeriod = 'recent' | 'today' | 'week' | 'month' | 'year'

const HITOMI_SORT_PERIODS: { value: HitomiSortPeriod; label: string }[] = [
  { value: 'recent', label: '最近' },
  { value: 'today', label: '本日' },
  { value: 'week', label: '週間' },
  { value: 'month', label: '月間' },
  { value: 'year', label: '年間' },
]

type ApiSettings = {
  apiUrl: string
  apiKey: string
  editKey: string
  timeoutSeconds: number
}

type ApiSettingsErrors = {
  apiUrl?: string
  timeoutSeconds?: string
}

const DEFAULT_API_SETTINGS: ApiSettings = {
  apiUrl: 'http://localhost:5000',
  apiKey: '',
  editKey: '',
  timeoutSeconds: 30,
}

const normalizeApiUrl = (value: string): string | null => {
  const trimmed = value.trim()
  try {
    const parsed = new URL(trimmed)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
    const serialized = parsed.toString()
    const suffix = `${parsed.search}${parsed.hash}`
    const base = serialized.slice(0, serialized.length - suffix.length)
    return `${base.replace(/\/+$/, '')}${suffix}`
  } catch {
    return null
  }
}

const validateApiSettings = (settings: ApiSettings): { normalized: ApiSettings | null; errors: ApiSettingsErrors } => {
  const errors: ApiSettingsErrors = {}
  const apiUrl = normalizeApiUrl(settings.apiUrl)
  if (!apiUrl) errors.apiUrl = 'http:// または https:// で始まる有効なURLを入力してください。'
  if (!Number.isInteger(settings.timeoutSeconds) || settings.timeoutSeconds < 1 || settings.timeoutSeconds > 3600) {
    errors.timeoutSeconds = 'タイムアウト秒数は1〜3600の整数で入力してください。'
  }

  return {
    normalized: Object.keys(errors).length
      ? null
      : { ...settings, apiUrl: apiUrl ?? settings.apiUrl },
    errors,
  }
}

const resolveHitomiSearchBook = (book: BookCardModel) => {
  const hasGroupId = hasBookIdentifier(book.groupId)
  const hasBookId = hasBookIdentifier(book.bookId)
  const libraryMatch = hasGroupId && hasBookId
    ? libraryBooks.find((candidate) => candidate.groupId === book.groupId && candidate.bookId === book.bookId)
    : !hasGroupId && !hasBookId && hasBookIdentifier(book.url)
      ? libraryBooks.find((candidate) => candidate.url === book.url)
      : undefined

  return libraryMatch ?? book
}

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

const formatDisplayDate = (uploadedTime: string) => uploadedTime.slice(0, 10).replaceAll('-', '/')

const compareBooks = (left: BookCardModel, right: BookCardModel, sortType: SortType, direction: SortDirection) => {
  const primaryComparison = sortType === 'updated'
    ? left.uploadedTime.localeCompare(right.uploadedTime)
    : sortType === 'title'
      ? left.title.localeCompare(right.title, 'ja')
      : left.totalPage - right.totalPage

  if (primaryComparison !== 0) return direction === 'asc' ? primaryComparison : -primaryComparison
  return left.bookId.localeCompare(right.bookId)
}

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
  const [librarySearchBooks, setLibrarySearchBooks] = useState<BookCardModel[]>(() => libraryBooks)
  const [webSearchResultBooks, setWebSearchResultBooks] = useState<BookCardModel[]>(() => webSearchBooks.map(resolveHitomiSearchBook))
  const searchBooks = isWebSearch ? webSearchResultBooks : librarySearchBooks
  const downloadedTagKeys = new Set(
    librarySearchBooks
      .filter((book) => book.status === 'Downloaded')
      .flatMap((book) => book.tags)
      .filter((tag) => tag.type === 'Artists' || tag.type === 'Groups')
      .map((tag) => `${tag.type}:${tag.name.toLowerCase()}`),
  )
  const getDownloadCandidateTags = (book: BookCardModel) => isWebSearch && (book.status === 'WebBook' || book.status === 'WebBookInPage')
    ? book.tags.filter((tag) => (
      (tag.type === 'Artists' || tag.type === 'Groups')
      && downloadedTagKeys.has(`${tag.type}:${tag.name.toLowerCase()}`)
    ))
    : []
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [criteria, setCriteria] = useState<SearchCriteria>(() => normalizeCriteriaForRoute(parseCriteriaFromUrl(new URLSearchParams(window.location.search)), isWebSearch))
  const [query, setQuery] = useState(() => parseCriteriaFromUrl(new URLSearchParams(window.location.search)).text)
  const [selected, setSelected] = useState<string[]>([])
  const [selectMode, setSelectMode] = useState(false)
  const [notice, setNotice] = useState('')
  const [sortType, setSortType] = useState<SortType>('updated')
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
  const [apiSettings, setApiSettings] = useState<ApiSettings>(DEFAULT_API_SETTINGS)
  const [apiSettingsDraft, setApiSettingsDraft] = useState<ApiSettings>(DEFAULT_API_SETTINGS)
  const [apiSettingsOpen, setApiSettingsOpen] = useState(false)
  const [apiSettingsErrors, setApiSettingsErrors] = useState<ApiSettingsErrors>({})
  const [apiConnectionState, setApiConnectionState] = useState<'idle' | 'pending' | 'success'>('idle')
  const menuButtonRef = useRef<HTMLButtonElement>(null)
  const advancedDialogRef = useRef<HTMLDialogElement>(null)
  const advancedTriggerRef = useRef<HTMLButtonElement>(null)
  const advancedCloseReasonRef = useRef<'apply' | 'cancel'>('cancel')
  const apiSettingsDialogRef = useRef<HTMLDialogElement>(null)
  const apiSettingsTriggerRef = useRef<HTMLButtonElement>(null)
  const apiConnectionTimeoutRef = useRef<number | null>(null)

  const filteredBooks = searchBooks.filter((book) => {
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
  const visibleBooks = [...filteredBooks].sort((left, right) => compareBooks(left, right, sortType, sortDirection))
  const hasCriteria = criteriaHasValues(criteria) || (isWebSearch && hitomiAppend !== 'Normal')
  const tagCandidates = searchBooks
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
  const showTagCandidates = tagInputFocused && tagCandidates.length > 0

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

  useEffect(() => () => {
    if (apiConnectionTimeoutRef.current !== null) window.clearTimeout(apiConnectionTimeoutRef.current)
  }, [])

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
    setCriteria(nextCriteria)
    setDraftCriteria(cloneCriteria(nextCriteria))
    setSelected([])
    setNotice(nextCriteria.text
      ? `「${nextCriteria.text}」で${isWebSearch ? 'Web検索' : '検索'}しました`
      : (isWebSearch ? 'すべてのWeb検索結果を表示しています' : 'すべての蔵書を表示しています'))
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
    setCriteria(nextCriteria)
    setQuery('')
    setDraftCriteria(cloneCriteria(nextCriteria))
    setSelected([])
    setNotice(`「${getTagLabel(tag)}」だけで${isWebSearch ? 'Web検索' : '検索'}しています`)
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
    setApiConnectionState('idle')
    const dialog = apiSettingsDialogRef.current
    if (dialog && !dialog.open) dialog.showModal()
    setApiSettingsOpen(true)
  }

  const clearApiConnectionCheck = () => {
    if (apiConnectionTimeoutRef.current !== null) {
      window.clearTimeout(apiConnectionTimeoutRef.current)
      apiConnectionTimeoutRef.current = null
    }
    setApiConnectionState('idle')
  }

  const closeApiSettings = () => {
    clearApiConnectionCheck()
    const dialog = apiSettingsDialogRef.current
    if (dialog?.open) {
      dialog.close()
    } else {
      setApiSettingsOpen(false)
      window.requestAnimationFrame(() => apiSettingsTriggerRef.current?.focus())
    }
  }

  const testApiConnection = () => {
    const { normalized, errors } = validateApiSettings(apiSettingsDraft)
    setApiSettingsErrors(errors)
    if (!normalized) return

    setApiSettingsDraft(normalized)
    clearApiConnectionCheck()
    setApiConnectionState('pending')
    apiConnectionTimeoutRef.current = window.setTimeout(() => {
      apiConnectionTimeoutRef.current = null
      setApiConnectionState('success')
    }, 450)
  }

  const saveApiSettings = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const { normalized, errors } = validateApiSettings(apiSettingsDraft)
    setApiSettingsErrors(errors)
    if (!normalized) return

    clearApiConnectionCheck()
    setApiSettings(normalized)
    setApiSettingsDraft(normalized)
    setNotice('API設定を保存しました')
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
    setCriteria(nextCriteria)
    setQuery(nextCriteria.text)
    setDraftCriteria(cloneCriteria(nextCriteria))
    setHitomiAppend(nextHitomiAppend)
    setDraftHitomiAppend(nextHitomiAppend)
    setSelected([])
    const nextHasCriteria = criteriaHasValues(nextCriteria) || (isWebSearch && nextHitomiAppend !== 'Normal')
    setNotice(nextHasCriteria
      ? `${isWebSearch ? 'Web検索' : '蔵書検索'}の詳細条件を適用しました`
      : (isWebSearch ? 'すべてのWeb検索結果を表示しています' : 'すべての蔵書を表示しています'))
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

  const deleteLibraryBook = (book: BookCardModel) => {
    const bookKey = getBookIdentityKey(book)
    setLibrarySearchBooks((current) => current.filter((candidate) => getBookIdentityKey(candidate) !== bookKey))
    setNotice(`「${book.title}」を削除しました`)
  }

  const refreshWebBook = (book: BookCardModel) => {
    const bookKey = getBookIdentityKey(book)
    setWebSearchResultBooks((current) => current.map((candidate) => getBookIdentityKey(candidate) === bookKey
      ? refreshWebBookModel(candidate)
      : candidate))

    const message = book.status === 'WebBookInPage'
      ? `「${book.title}」を未保存に更新しました`
      : book.status === 'WebBook'
        ? `「${book.title}」のWeb情報を再取得しました`
        : `「${book.title}」を再読み込みしました`
    setNotice(message)
  }

  const refreshSelectedWebBooks = () => {
    const selectedKeys = new Set(selected)
    const selectedBooks = webSearchResultBooks.filter((book) => selectedKeys.has(getBookIdentityKey(book)))
    if (selectedBooks.length === 0) return

    setWebSearchResultBooks((current) => current.map((candidate) => selectedKeys.has(getBookIdentityKey(candidate))
      ? refreshWebBookModel(candidate)
      : candidate))
    setNotice(`選択した${selectedBooks.length}件を読み込みました`)
  }

  const downloadWebBook = (book: BookCardModel) => {
    if (book.status === 'Downloaded' || book.status === 'Downloading') return

    const bookKey = getBookIdentityKey(book)
    setWebSearchResultBooks((current) => current.map((candidate) => getBookIdentityKey(candidate) === bookKey
      ? { ...candidate, status: 'Downloading' }
      : candidate))
    setNotice(`「${book.title}」のダウンロードを開始しました`)
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

  const deleteSelectedLibraryBooks = () => {
    const selectedKeys = new Set(selected)
    const deletedBooks = librarySearchBooks.filter((book) => selectedKeys.has(getBookIdentityKey(book)))
    setLibrarySearchBooks((current) => current.filter((book) => !selectedKeys.has(getBookIdentityKey(book))))
    setSelected([])
    setNotice(`選択した${deletedBooks.length}件の蔵書を削除しました`)
  }

  const toggleSelectMode = () => {
    setSelectMode((current) => !current)
    setSelected([])
  }

  const refresh = () => {
    setNotice('ライブラリを更新しました')
    window.setTimeout(() => setNotice(''), 2800)
  }

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
            <Menu size={20} />
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
              <X size={16} />
            </button>
          )}
          <button className="search-submit" type="submit" aria-label="検索を実行">
            <Search size={16} />
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
            <SlidersHorizontal size={17} />
          </button>
          </form>
        )}

        <div className="topbar__actions">
          <div className="connection" title="APIへの接続状態" aria-label="API接続済み">
            <span className="connection__dot" aria-hidden="true" />
          </div>
          <button
            ref={apiSettingsTriggerRef}
            className="icon-button api-settings-trigger"
            type="button"
            aria-label="API設定を開く"
            title="API設定"
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
            <X size={19} />
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
                        <button className="nav-item" type="button" aria-label={`${item.label}（準備中）`} onClick={() => { setNotice(`${item.label}は次の実装フェーズで追加します`); setDrawerOpen(false) }}>
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
          <DownloadManager />
        ) : (
          <>
        {isDashboard ? (
          <Dashboard path={currentPath} />
        ) : (
          <>
        {isBookViewer ? (
          <BookViewerPage
            routeState={viewerRoute?.state ?? 'missing'}
            book={viewerRoute?.book}
            routeIdentity={viewerRoute?.identity ?? 'missing'}
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

        <section id="results-region" className="results" aria-label={isWebSearch ? 'Web検索結果一覧' : '蔵書一覧'} tabIndex={-1}>
          <div className="results-toolbar">
            <div className="results-actions">
              {selectMode && <span className="selection-count" aria-live="polite">{selected.length}件を選択中</span>}
              <label className="sort-control sort-control--type">
                <span>並び順</span>
                {isWebSearch ? (
                  <select
                    value={hitomiSortPeriod}
                    aria-label="Hitomiの並び順"
                    onChange={(event) => {
                      const nextPeriod = event.target.value as HitomiSortPeriod
                      setHitomiSortPeriod(nextPeriod)
                      const periodLabel = HITOMI_SORT_PERIODS.find((period) => period.value === nextPeriod)?.label ?? '最近'
                      setNotice(`Hitomiの並び順を${periodLabel}に変更しました`)
                    }}
                  >
                    {HITOMI_SORT_PERIODS.map((period) => <option key={period.value} value={period.value}>{period.label}</option>)}
                  </select>
                ) : (
                  <select value={sortType} aria-label="並び順の種類" onChange={(event) => setSortType(event.target.value as SortType)}>
                    <option value="updated">更新日時</option>
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
                  title={sortDirection === 'desc' ? '降順（昇順に切り替える）' : '昇順（降順に切り替える）'}
                  onClick={() => setSortDirection((current) => current === 'desc' ? 'asc' : 'desc')}
                >
                  {sortDirection === 'desc' ? <ArrowDown size={17} aria-hidden="true" /> : <ArrowUp size={17} aria-hidden="true" />}
                </button>
              )}
              <button
                className={`icon-button toolbar-icon selection-toggle ${selectMode ? 'is-active' : ''}`}
                type="button"
                aria-label={selectMode ? '選択を終了' : '選択'}
                title={selectMode ? '選択を終了' : '選択'}
                aria-pressed={selectMode}
                onClick={toggleSelectMode}
              >
                <Check size={16} aria-hidden="true" />
              </button>
              <button className="icon-button toolbar-icon" type="button" aria-label="結果を更新" onClick={refresh}>
                <RefreshCw size={17} />
              </button>
            </div>
          </div>

          {isWebSearch && selectMode && (
            <div className="selection-toolbar" role="group" aria-label="Web検索結果の一括操作">
              <button
                className="icon-button toolbar-icon"
                type="button"
                aria-label="全選択"
                title="全選択"
                disabled={visibleBooks.length === 0 || visibleBooks.every((book) => selected.includes(getBookIdentityKey(book)))}
                onClick={selectAllVisibleBooks}
              >
                <ListChecks size={17} aria-hidden="true" />
              </button>
              <button
                className="icon-button toolbar-icon"
                type="button"
                aria-label="読み込み"
                title="読み込み"
                disabled={selected.length === 0}
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
                title="全選択"
                disabled={visibleBooks.length === 0 || visibleBooks.every((book) => selected.includes(getBookIdentityKey(book)))}
                onClick={selectAllVisibleBooks}
              >
                <ListChecks size={17} aria-hidden="true" />
              </button>
              <button
                className="icon-button toolbar-icon selection-toolbar__delete"
                type="button"
                aria-label="選択を削除"
                title="選択を削除"
                disabled={selected.length === 0}
                onClick={deleteSelectedLibraryBooks}
              >
                <Trash2 size={17} aria-hidden="true" />
              </button>
            </div>
          )}

          <div className="book-grid" aria-busy="false">
            {visibleBooks.map((book) => {
              const downloadCandidateTags = getDownloadCandidateTags(book)
              const bookKey = getBookIdentityKey(book)
              return (
                <BookCard
                  key={bookKey}
                  book={book}
                  selectMode={selectMode}
                  selected={selected.includes(bookKey)}
                  onToggle={() => toggleSelection(bookKey)}
                  onTagSearch={searchByTag}
                  isDownloadCandidate={downloadCandidateTags.length > 0}
                  isWebSearch={isWebSearch}
                  onDelete={!isWebSearch ? () => deleteLibraryBook(book) : undefined}
                  onRefresh={isWebSearch ? () => refreshWebBook(book) : undefined}
                  onDownload={isWebSearch ? () => downloadWebBook(book) : undefined}
                />
              )
            })}
          </div>

          {hasCriteria && visibleBooks.length === 0 && (
            <div className="empty-state" role="status">
              <Search size={24} aria-hidden="true" />
              <strong>条件に一致する{isWebSearch ? 'Web検索結果' : '蔵書'}がありません</strong>
              <span>検索条件を変更して、もう一度お試しください。</span>
            </div>
          )}

          {visibleBooks.length > 0 && (
            <nav className="pagination" aria-label="検索結果のページ">
              <button type="button" aria-label="前のページ" disabled><ChevronLeft size={18} /></button>
              <button type="button" className="is-current" aria-current="page">1</button>
              <button type="button">2</button>
              <button type="button">3</button>
              <span aria-hidden="true">…</span>
              <button type="button">13</button>
              <button type="button" aria-label="次のページ"><ChevronRight size={18} /></button>
            </nav>
          )}
        </section>
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
          onClick={(event) => {
            if (event.target === event.currentTarget) closeAdvancedSearch('cancel')
          }}
        >
          <form className="advanced-dialog__panel" noValidate onSubmit={applyAdvancedSearch}>
            <header className="advanced-dialog__header">
              <div>
                <span>検索条件</span>
                <h2 id="advanced-search-title">詳細検索</h2>
              </div>
              <button className="icon-button" type="button" aria-label="詳細検索を閉じる" onClick={() => closeAdvancedSearch('cancel')}>
                <X size={19} />
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
                        {tagCandidates.map((tag, index) => (
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
                              <span>{getTagLabel(tag)}</span>
                              {tag.displayName && tag.displayName !== tag.name && <small>{tag.name}</small>}
                            </button>
                          </li>
                        ))}
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
              <button className="button button--ghost" type="button" onClick={clearAdvancedDraft}>クリア</button>
              <span />
              <button className="button button--ghost" type="button" onClick={() => closeAdvancedSearch('cancel')}>キャンセル</button>
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
          onClose={() => {
            if (apiConnectionTimeoutRef.current !== null) {
              window.clearTimeout(apiConnectionTimeoutRef.current)
              apiConnectionTimeoutRef.current = null
            }
            setApiConnectionState('idle')
            setApiSettingsOpen(false)
            window.requestAnimationFrame(() => apiSettingsTriggerRef.current?.focus())
          }}
          onClick={(event) => {
            if (event.target === event.currentTarget) closeApiSettings()
          }}
        >
          <form className="advanced-dialog__panel api-settings-dialog__panel" noValidate onSubmit={saveApiSettings}>
            <header className="advanced-dialog__header">
              <div>
                <span>接続設定</span>
                <h2 id="api-settings-title">API設定</h2>
              </div>
              <button className="icon-button" type="button" aria-label="API設定を閉じる" onClick={closeApiSettings}>
                <X size={19} />
              </button>
            </header>

            <div className="advanced-dialog__body">
              <section className="advanced-dialog__field">
                <label htmlFor="api-settings-url">APIのURL</label>
                <input
                  id="api-settings-url"
                  type="url"
                  required
                  value={apiSettingsDraft.apiUrl}
                  placeholder="http://localhost:5000"
                  autoComplete="url"
                  aria-invalid={Boolean(apiSettingsErrors.apiUrl)}
                  aria-describedby={apiSettingsErrors.apiUrl ? 'api-settings-url-error' : undefined}
                  onChange={(event) => {
                    clearApiConnectionCheck()
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
                    clearApiConnectionCheck()
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
                    clearApiConnectionCheck()
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
                    clearApiConnectionCheck()
                    setApiSettingsDraft((current) => ({ ...current, timeoutSeconds: Number(event.target.value) }))
                    setApiSettingsErrors((current) => ({ ...current, timeoutSeconds: undefined }))
                  }}
                />
                {apiSettingsErrors.timeoutSeconds && <p id="api-settings-timeout-error" className="advanced-field-error" role="alert">{apiSettingsErrors.timeoutSeconds}</p>}
              </section>

              {apiConnectionState === 'success' && (
                <p className="api-settings__connection-status" role="status">接続に成功しました（モック）</p>
              )}
            </div>

            <footer className="advanced-dialog__footer">
              <button className="button button--ghost" type="button" disabled={apiConnectionState === 'pending'} onClick={testApiConnection}>{apiConnectionState === 'pending' ? '確認中…' : '接続確認'}</button>
              <span />
              <button className="button button--ghost" type="button" onClick={closeApiSettings}>キャンセル</button>
              <button className="button button--primary" type="submit">保存</button>
            </footer>
          </form>
        </dialog>

        <div className={`live-notice ${notice ? 'live-notice--visible' : ''}`} role="status" aria-live="polite">
          <Check size={17} />{notice}
        </div>
          </>
        )}
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
  onDelete?: () => void
  onRefresh?: () => void
  onDownload?: () => void
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const tagsTriggerRef = useRef<HTMLButtonElement>(null)
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
        alt={`${book.title}の表紙`}
        linkHref={viewerUrl}
        linkAriaLabel={`${book.title}を閲覧`}
        linkTabIndex={selectMode ? -1 : undefined}
        fallbackText={book.thumbnailUrl ? '画像を読み込めませんでした' : 'サムネイルはありません'}
        fallbackAriaLabel={`${book.title}のサムネイルを表示できません`}
        variant={book.cover}
      >
        <BookStatusBadge status={book.status} />
        <span className={`source-badge ${book.source === 'Local' ? 'source-badge--local' : ''}`}>{book.source}</span>
        {selectMode ? (
          <button className="card-select" type="button" aria-label={`${book.title}を${selected ? '選択解除' : '選択'}`} aria-pressed={selected} onClick={onToggle}>
            {selected && <Check size={15} />}
          </button>
        ) : isWebSearch ? (
          <div className="card-actions" aria-label={`${book.title}の操作`}>
            <button className="card-action" type="button" aria-label={`${book.title}を再読み込み`} title={`${book.title}を再読み込み`} onClick={() => onRefresh?.()}>
              <RefreshCw size={16} aria-hidden="true" />
            </button>
            <button className="card-action" type="button" aria-label={downloadLabel} title={downloadLabel} disabled={downloadDisabled} onClick={() => onDownload?.()}>
              <Download size={16} aria-hidden="true" />
            </button>
          </div>
        ) : (
          <button className="card-action card-action--delete" type="button" aria-label={`${book.title}を削除`} title={`${book.title}を削除`} onClick={() => onDelete?.()}>
            <Trash2 size={17} aria-hidden="true" />
          </button>
        )}
      </Thumbnail>
      <div className="book-card__body">
        <div className="book-card__title-row">
          <h3><a href={viewerUrl}>{book.title}</a></h3>
          <BookOpen size={17} aria-hidden="true" />
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
        onClick={(event) => {
          if (event.target === event.currentTarget) closeTagsDialog()
        }}
      >
        <div className="tags-dialog__panel">
          <header className="tags-dialog__header">
            <div>
              <span>タグ一覧</span>
              <h2 id={`tags-dialog-title-${book.bookId}`}>{book.title}</h2>
            </div>
            <button className="icon-button" type="button" aria-label="タグ一覧を閉じる" onClick={closeTagsDialog}>
              <X size={19} />
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
