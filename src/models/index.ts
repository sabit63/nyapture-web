export const NYA_TAG_TYPES = [
  'Unknown',
  'Parodies',
  'Characters',
  'Categories',
  'Groups',
  'Artists',
  'Tags',
  'Languages',
] as const

export type NyaTagType = (typeof NYA_TAG_TYPES)[number]

export const NYA_BOOK_STATUSES = [
  'Unknown',
  'Standby',
  'Downloaded',
  'Downloading',
  'Cancel',
  'DownloadError',
  'SaveError',
  'ShortPage',
  'Shredding',
  'Deleted',
  'WebBook',
  'WebBookInPage',
] as const

export type NyaBookStatus = (typeof NYA_BOOK_STATUSES)[number]

export const HITOMI_APPENDS = ['Normal', 'Male', 'Female'] as const

export type HitomiAppend = (typeof HITOMI_APPENDS)[number]

export const BOOK_SEARCH_SORT_TYPES = ['UploadedTime', 'Title', 'TotalPage', 'UpdatedTime'] as const

export type BookSearchSortType = (typeof BOOK_SEARCH_SORT_TYPES)[number]

export const TAG_SEARCH_TYPES = ['Exact', 'Fuzzy'] as const

export type TagSearchType = (typeof TAG_SEARCH_TYPES)[number]

export const TAG_SEARCH_SORT_TYPES = ['Type', 'Name', 'Created', 'Count'] as const

export type TagSearchSortType = (typeof TAG_SEARCH_SORT_TYPES)[number]

export const BOOK_GROUP_SORT_TYPES = ['BookCount', 'TagName'] as const

export type BookGroupSortType = (typeof BOOK_GROUP_SORT_TYPES)[number]

export const BOOK_DOWNLOAD_EXECUTION_STATES = [
  'Queued',
  'Running',
  'Paused',
  'Stopped',
  'Completed',
  'Failed',
  'Cancelled',
] as const

export type BookDownloadExecutionState = (typeof BOOK_DOWNLOAD_EXECUTION_STATES)[number]

export const ADDITIONAL_NAME_STATUSES = ['Pending', 'Approved'] as const

export type AdditionalNameStatus = (typeof ADDITIONAL_NAME_STATUSES)[number]

export const ADDITIONAL_NAME_SOURCES = ['None', 'Dictionary', 'LocalLLM', 'Manual'] as const

export type AdditionalNameSource = (typeof ADDITIONAL_NAME_SOURCES)[number]

export type TagSet = Partial<Record<NyaTagType, string[]>>

export type BookTag = {
  type: NyaTagType
  name: string
  displayName?: string
  count?: number
}

export const TAG_TYPE_ORDER = ['Artists', 'Groups', 'Parodies', 'Characters', 'Categories', 'Tags', 'Languages', 'Unknown'] as const

export const TAG_TYPE_LABELS: Record<NyaTagType, string> = {
  Artists: '作者',
  Groups: 'グループ',
  Parodies: '作品',
  Characters: 'キャラクター',
  Categories: 'カテゴリ',
  Tags: 'タグ',
  Languages: '言語',
  Unknown: 'その他',
}

export const getTagLabel = (tag: BookTag) => tag.displayName ?? tag.name

export type NyaApiResponse = {
  success?: boolean
  message?: string
}

export type EBook = {
  url?: string
  groupId?: string
  bookId?: string
  title?: string
  captions?: Record<string, string>
  totalPage?: number
  tagSet?: TagSet
  uploadedTime?: string
  pageUrls?: string[]
  status?: NyaBookStatus
}

export type EBookResponse = NyaApiResponse & {
  books?: EBook[]
  tags?: TagEntity[]
  totalCount?: number
  currentPage?: number
  totalPage?: number
  pageSize?: number
}

export type BookDeletionDisposition = 'Logical' | 'Physical'

export type BookDeletionJobStatus = 'Pending' | 'Running' | 'Succeeded' | 'Failed'

export type BookDeletionJob = {
  jobId: string
  groupId: string
  bookId: string
  disposition: BookDeletionDisposition
  status: BookDeletionJobStatus
  createdAtUtc: string
  startedAtUtc: string | null
  completedAtUtc: string | null
  failureMessage: string | null
  statusUrl: string
}

export type BookDeletionJobResponse = NyaApiResponse & {
  data?: BookDeletionJob
}

export type EBookGroup = {
  keyTagType?: string
  keyTagValue?: string
  keyTagDisplayName?: string
  totalBooksCount?: number
  books?: EBook[]
}

export type EBookGroupResponse = NyaApiResponse & {
  groups?: EBookGroup[]
  keyTagType?: string
  totalGroupCount?: number
  currentPage?: number
  totalPage?: number
}

export type BookSearchFilter = {
  tagSet?: TagSet
  exclusionTagSet?: TagSet
  texts?: string[]
  exclusionTexts?: string[]
  bookGroups?: string[]
  exclusionBookGroups?: string[]
  bookIds?: string[]
  exclusionBookIds?: string[]
  missingTagTypes?: NyaTagType[]
  status?: NyaBookStatus[]
  exclusionStatus?: NyaBookStatus[]
  lowerUploadedTime?: string
  upperUploadedTime?: string
  lowerPageCount?: number
  upperPageCount?: number
  sortType?: BookSearchSortType
  isAsc?: boolean
  isAnd?: boolean
  limit?: number
  page?: number
}

export type BookTitleUpdateRequest = {
  title: string
}

export type BookTagEditRequest = {
  tagType: string
  tags: string[]
}

export type TagEntity = {
  type?: NyaTagType
  name?: string
  count?: number
  displayName?: string
}

export type TagAutocompleteResponse = NyaApiResponse & {
  errorCode?: string | null
  tags?: TagAutocompleteSuggestion[]
  totalCount?: number
  currentPage?: number
  totalPage?: number
  pageSize?: number
}

export type TagAutocompleteSuggestion = {
  name?: string
  tagType?: string
  count?: number
  displayName?: string
  score?: number
}

export type TagSearchFilter = {
  tagTypes?: NyaTagType[]
  names?: string[]
  searchType?: TagSearchType
  sortType?: TagSearchSortType
  isAsc?: boolean
  isAnd?: boolean
  limit?: number
  page?: number
}

export type TagSearchResponse = NyaApiResponse & {
  tags?: TagEntity[]
  totalCount?: number
  currentPage?: number
  totalPage?: number
  pageSize?: number
}

export type TagResponse = TagSearchResponse

export type BookDownloadRequest = {
  url: string
  priority?: number
  requestedBy?: string
}

export type BookDownloadStatus = {
  book?: EBook
  executionState?: BookDownloadExecutionState
  thumbnailUrl?: string
  currentPage?: number
  completedPages?: number
  failedPages?: number
  priority?: number
  downloadSpeed?: number
  errorMessage?: string
  startedAt?: string
  lastUpdated?: string
  requestedBy?: string
  hostName?: string
  queuePosition?: number
  queuedAt?: string
}

export type BookDownloadSystemStatus = {
  runningCount?: number
  queuedCount?: number
  pausedCount?: number
  isSystemRunning?: boolean
  lastUpdated?: string
}

export type SystemStatus = BookDownloadSystemStatus

export type OnlineBookPage = {
  url?: string
  currentPage?: number
  totalPage?: number
  books?: OnlineBookInPage[]
}

export type OnlineBook = EBook & {
  status?: 'WebBook'
}

export type OnlineBookInPage = {
  url?: string
  groupId?: string
  bookId?: string
  title?: string
  captions?: Record<string, string>
  totalPage?: number
  tagSet?: TagSet
  uploadedTime?: string
  pageUrls?: string[]
  status?: 'WebBookInPage'
}

export type OnlineBookPageResponse = NyaApiResponse & {
  onlineBookPage?: OnlineBookPage
  books?: EBook[]
  tags?: TagEntity[]
  totalCount?: number
  currentPage?: number
  totalPage?: number
  pageSize?: number
}

export type OnlineBookResponse = NyaApiResponse & {
  onlineBook?: OnlineBook
  book?: EBook
  tags?: TagEntity[]
}

export type TagAdditionalNameDto = {
  name?: string
  tagType?: NyaTagType
  primaryAdditionalName?: string
  status?: AdditionalNameStatus
  source?: AdditionalNameSource
  candidates?: string[]
  count?: number
}

export type TagAdditionalNameListResponse = {
  items?: TagAdditionalNameDto[]
  total?: number
  page?: number
  limit?: number
}

export type TagAdditionalNameBatchGetRequest = {
  name?: string
  tagType?: NyaTagType
}

export type TagAdditionalNameBatchGetResponse = {
  items?: TagAdditionalNameDto[]
}

export type TagAdditionalNameUpsertRequest = {
  name?: string
  tagType?: NyaTagType
  primaryAdditionalName?: string
  status?: AdditionalNameStatus
  source?: AdditionalNameSource
  candidates?: string[]
}

export type TagAdditionalNameUpsertResponse = {
  created?: number
  updated?: number
}

export const SORT_TYPES = ['uploaded', 'title', 'pages'] as const

export type SortType = (typeof SORT_TYPES)[number]

export const SORT_DIRECTIONS = ['desc', 'asc'] as const

export type SortDirection = (typeof SORT_DIRECTIONS)[number]

export const TAG_MODES = ['and', 'or'] as const

export type TagMode = (typeof TAG_MODES)[number]

export type SearchCriteria = {
  text: string
  tags: BookTag[]
  tagMode: TagMode
  dateFrom: string
  dateTo: string
  pagesMin: string
  pagesMax: string
}

type LegacyBookFixtureFields = Partial<Record<'source', string>>

export type BookCardModel = EBook & LegacyBookFixtureFields & {
  groupId: string
  bookId: string
  apiGroupId?: string
  apiBookId?: string
  url: string
  title: string
  captions: Record<string, string>
  totalPage: number
  tagSet: TagSet
  uploadedTime: string
  pageUrls: string[]
  status: NyaBookStatus
  sourceLabel?: string
  tags: BookTag[]
  thumbnailUrl?: string
  cover: string
}
