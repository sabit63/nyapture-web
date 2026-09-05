/**
 * Web Book Cache API contracts.
 *
 * The cache book/search DTOs are defined alongside the existing endpoint
 * functions for compatibility with the current API module.  Re-exporting
 * them here gives feature code one model-facing import location without
 * duplicating the wire shape.
 */
export type {
  WebBookCacheBookDto,
  WebBookCacheSearchRequest,
  WebBookCacheSearchResponse,
} from '../api/endpoints'

export type WebBookCacheSiteConfigDto = {
  groupId: string | null
  enabled: boolean
  startUrl: string | null
  intervalMinutes: number | null
  maxPagesPerRun: number | null
  maxDetailsPerRun: number | null
  domainIntervalMilliseconds: number | null
}

export type WebBookAutoDownloadConfigDto = {
  enabled: boolean
  conditionMode: string
  maxPageCount: number
  maxAutoDownloadsPerRun: number
  maxAutoDownloadsPerDay: number
  minFreeDiskGb: number
  allowedGroupIds: string[]
  excludedTags: string[]
}

export type WebBookCacheConfigDto = {
  enabled: boolean
  intervalMinutes: number
  initialLookbackDays: number
  maxPagesPerRun: number
  maxDetailsPerRun: number
  sites: WebBookCacheSiteConfigDto[]
  autoDownload: WebBookAutoDownloadConfigDto
  updatedAt?: string | null
  updatedBy?: string | null
}

export type WebBookCacheConfigResponse = {
  generatedAt?: string
  config: WebBookCacheConfigDto
  hasRuntimeOverride?: boolean
}

export type WebBookCacheValidationResponse = {
  isValid?: boolean
  errors?: string[]
}

export type WebBookCacheStatusResponse = {
  generatedAt?: string
  isRunning?: boolean
  lastStartedAt?: string | null
  lastFinishedAt?: string | null
  nextRunAt?: string | null
  currentSite?: string | null
  pagesLoaded?: number
  detailsLoaded?: number
  createdCount?: number
  updatedCount?: number
  autoDownloadMatchedCount?: number
  autoDownloadEnqueuedCount?: number
  lastError?: string | null
}

export type WebBookCacheSyncRequest = {
  groupId?: string | null
  force: boolean
}

export type WebBookCacheSyncStartResponse = {
  started?: boolean
  message?: string | null
  status?: WebBookCacheStatusResponse | null
}

export type WebBookCacheSiteTestResponse = {
  success?: boolean
  message?: string | null
  bookCount?: number
  currentPage?: number
  totalPage?: number
}
