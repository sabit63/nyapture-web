import type { TagEntity } from '../../models'

export type WebBookCacheBookDto = {
  groupId?: string | null
  bookId?: string | null
  url?: string | null
  title?: string | null
  captions?: Record<string, string>
  totalPage?: number
  tagSet?: Record<string, string[]>
  tags?: TagEntity[]
  uploadedTime?: string
  pageUrls?: string[]
  thumbnailUrl?: string | null
  sourcePageUrl?: string | null
  firstCachedAt?: string
  lastSyncedAt?: string
  lastSeenAt?: string
  syncError?: string | null
  autoDownloadEvaluatedAt?: string | null
  autoDownloadMatched?: boolean
  autoDownloadReason?: string | null
  autoDownloadEnqueuedAt?: string | null
}

export type WebBookCacheSearchRequest = {
  keyword?: string | null
  groupIds?: string[]
  bookIds?: string[]
  lowerUploadedTime?: string | null
  upperUploadedTime?: string | null
  maxPageCount?: number | null
  page?: number
  limit?: number | null
  isAsc?: boolean
}

export type WebBookCacheSearchResponse = {
  success?: boolean
  books?: WebBookCacheBookDto[]
  totalCount?: number
  totalPage?: number
  currentPage?: number
  pageSize?: number
}
