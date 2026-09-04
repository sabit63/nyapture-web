/**
 * TypeScript representations of the Nya Dashboard REST contracts.
 *
 * The API returns all dashboard responses in a NyaApiResponse envelope.  The
 * properties remain optional/nullable so an individual diagnostic section can
 * be unavailable without preventing the rest of the dashboard from rendering.
 */

export type DashboardApiResponse<T> = {
  success?: boolean
  message?: string | null
  data?: T | null
}

// ───────── Summary ─────────

export type MongoSummary = {
  isConnected?: boolean | null
  serverVersion?: string | null
  databaseName?: string | null
}

export type DataFolderSummary = {
  isAvailable?: boolean | null
  freeBytes?: number | null
  totalBytes?: number | null
}

export type DownloadsSummary = {
  runningCount?: number | null
  queuedCount?: number | null
  failedRecentCount?: number | null
}

export type WebPilotSummary = {
  isConfigured?: boolean | null
  lastTestStatus?: string | null
}

export type ImageWorkerSummary = {
  isConfigured?: boolean | null
  lastTestStatus?: string | null
}

export type MaintenanceSummary = {
  lastExecutionTime?: string | null
  nextExecutionTime?: string | null
  isRunning?: boolean | null
  issuesCount?: number | null
}

export type CacheSummary = {
  sizeBytes?: number | null
  entryCount?: number | null
  hitRate?: number | null
}

export type LogsSummary = {
  errors24h?: number | null
  warnings24h?: number | null
}

export type DashboardSummaryResponse = {
  generatedAt?: string | null
  mongoDb?: MongoSummary | null
  dataFolder?: DataFolderSummary | null
  downloads?: DownloadsSummary | null
  webPilot?: WebPilotSummary | null
  imageWorker?: ImageWorkerSummary | null
  maintenance?: MaintenanceSummary | null
  cache?: CacheSummary | null
  logs?: LogsSummary | null
  errors?: Record<string, string> | null
}

// ───────── MongoDB ─────────

export type MongoDbDiagnosticsResponse = {
  generatedAt?: string | null
  isConnected?: boolean | null
  serverVersion?: string | null
  databaseName?: string | null
  replicaSetState?: string | null
  collections?: MongoCollectionStatsDto[] | null
  error?: string | null
}

export type MongoCollectionStatsDto = {
  name?: string | null
  documentCount?: number | null
  sizeBytes?: number | null
  indexCount?: number | null
  indexes?: MongoIndexInfoDto[] | null
}

export type MongoIndexInfoDto = {
  name?: string | null
  keysJson?: string | null
  isUnique?: boolean | null
  isSparse?: boolean | null
}

// ───────── DataFolder / Downloads ─────────

export type DataFolderResponse = {
  generatedAt?: string | null
  path?: string | null
  exists?: boolean | null
  isWritable?: boolean | null
  totalBytes?: number | null
  freeBytes?: number | null
  usedBytes?: number | null
  usageRatio?: number | null
  error?: string | null
}

/** Download progress is a fraction in the inclusive range 0..1. */
export type DownloadProgress = number

export type DownloadJobDto = {
  jobId?: string | null
  bookId?: string | null
  url?: string | null
  status?: string | null
  progress?: DownloadProgress | null
  startedAt?: string | null
  finishedAt?: string | null
  failureReason?: string | null
}

export type DownloadsResponse = {
  generatedAt?: string | null
  running?: DownloadJobDto[] | null
  queued?: DownloadJobDto[] | null
  recentFailed?: DownloadJobDto[] | null
}

export type DomainIntervalDto = {
  domain?: string | null
  intervalMs?: number | null
  overrideIntervalMs?: number | null
  lastRequestAt?: string | null
}

export type DomainIntervalsResponse = {
  generatedAt?: string | null
  domains?: DomainIntervalDto[] | null
}

export type DomainIntervalUpdateItem = {
  domain?: string | null
  intervalMs?: number | null
}

export type DomainIntervalsUpdateRequest = {
  updates: DomainIntervalUpdateItem[]
}

// ───────── External service configuration ─────────

export type ConnectionTestResult = {
  success?: boolean | null
  testedAt?: string | null
  statusCode?: number | null
  latencyMs?: number | null
  message?: string | null
}

export type WebPilotConfigResponse = {
  generatedAt?: string | null
  baseUrl?: string | null
  isApiKeyConfigured?: boolean | null
  lastModified?: string | null
  lastTestResult?: ConnectionTestResult | null
}

export type WebPilotConfigUpdateRequest = {
  baseUrl?: string | null
  apiKey?: string | null
}

export type ImageWorkerConfigResponse = {
  generatedAt?: string | null
  baseUrl?: string | null
  isApiKeyConfigured?: boolean | null
  lastModified?: string | null
  lastTestResult?: ConnectionTestResult | null
}

export type ImageWorkerConfigUpdateRequest = {
  baseUrl?: string | null
  apiKey?: string | null
}

// ───────── Maintenance ─────────

export type MaintenanceScheduleDto = {
  intervalMinutes?: number | null
  cpuThreshold?: number | null
  isIntervalOverridden?: boolean | null
  isCpuThresholdOverridden?: boolean | null
  lastModified?: string | null
}

export type MaintenanceHistoryEntryDto = {
  runId?: string | null
  startedAt?: string | null
  finishedAt?: string | null
  result?: string | null
  storageSyncMode?: string | null
  processedBooks?: number | null
  issuesDetected?: number | null
}

export type DashboardMaintenanceResponse = {
  generatedAt?: string | null
  schedule?: MaintenanceScheduleDto | null
  lastExecutionTime?: string | null
  nextExecutionTime?: string | null
  lastExecutionResult?: string | null
  isRunning?: boolean | null
  currentRunId?: string | null
  currentProcessedBooks?: number | null
  isThrottled?: boolean | null
  isPaused?: boolean | null
  currentCpuUsage?: number | null
  recentHistory?: MaintenanceHistoryEntryDto[] | null
}

export type MaintenanceIssueDto = {
  issueType?: string | null
  target?: string | null
  detail?: string | null
  detectedAt?: string | null
  runId?: string | null
}

export type MaintenanceIssuesResponse = {
  generatedAt?: string | null
  issues?: MaintenanceIssueDto[] | null
}

export type MaintenanceScheduleUpdateRequest = {
  intervalMinutes?: number | null
  cpuThreshold?: number | null
}

export type MaintenanceStorageSyncMode = 'Quick' | 'Deep'

export type MaintenanceStartRequestDto = {
  mode?: MaintenanceStorageSyncMode | null
}

export type MaintenanceTriggerResponse = {
  started?: boolean | null
  runId?: string | null
  message?: string | null
}

export type MaintenanceActionResponse = {
  success?: boolean | null
  message?: string | null
}

export type MaintenanceCheckSummaryDto = {
  ok?: number | null
  warning?: number | null
  error?: number | null
  skipped?: number | null
  repaired?: number | null
}

export type MaintenanceRunDto = {
  runId?: string | null
  status?: string | null
  storageSyncMode?: string | null
  totalBooks?: number | null
  processedBooks?: number | null
  results?: Record<string, MaintenanceCheckSummaryDto | null> | null
  enabledChecks?: string[] | null
  startedAt?: string | null
  completedAt?: string | null
}

export type MaintenanceCheckResultDetailDto = {
  status?: string | null
  message?: string | null
  targetPages?: number[] | null
  processedCount?: number | null
  issuePages?: Record<string, string> | null
  directoryPath?: string | null
}

export type MaintenanceTaskDto = {
  runId?: string | null
  bookId?: string | null
  groupId?: string | null
  status?: string | null
  checkResults?: Record<string, MaintenanceCheckResultDetailDto | null> | null
  startedAt?: string | null
  completedAt?: string | null
}

export type MaintenanceRunDetailResponse = {
  generatedAt?: string | null
  run?: MaintenanceRunDto | null
  tasks?: MaintenanceTaskDto[] | null
}

// ───────── Cache / Logs ─────────

export type CacheMetricsResponse = {
  generatedAt?: string | null
  sizeBytes?: number | null
  entryCount?: number | null
  hitCount?: number | null
  missCount?: number | null
  hitRate?: number | null
  evictionCount?: number | null
  lastClearedAt?: string | null
  strategy?: string | null
}

export type DashboardLogEntryDto = {
  sequence?: number | null
  timestamp?: string | null
  level?: string | null
  category?: string | null
  message?: string | null
  exception?: string | null
}

export type DashboardLogsResponse = {
  generatedAt?: string | null
  latestSequence?: number | null
  entries?: DashboardLogEntryDto[] | null
}

export type DashboardLogLevel =
  | 'Trace'
  | 'Debug'
  | 'Information'
  | 'Warning'
  | 'Error'
  | 'Critical'
  | 'None'
