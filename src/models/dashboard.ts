/**
 * Dashboard detail contracts.  The API intentionally leaves most response
 * properties optional so the viewer can render partial diagnostics while a
 * provider is unavailable.
 */

export type DashboardApiResponse<T> = {
  success?: boolean
  message?: string | null
  data?: T | null
}

export type DataStoreObservationAvailability = 'Available' | 'Unavailable' | 'NotSupported' | string

export type DataStoreIndexDto = {
  name?: string | null
  definition?: string | null
  isUnique?: boolean | null
  availability?: DataStoreObservationAvailability | null
  diagnosticCode?: string | null
}

export type DataStoreResourceDto = {
  name?: string | null
  recordCount?: number | null
  sizeBytes?: number | null
  indexCount?: number | null
  availability?: DataStoreObservationAvailability | null
  diagnosticCode?: string | null
  indexes?: DataStoreIndexDto[] | null
}

export type DataStoreTopologyDto = {
  availability?: DataStoreObservationAvailability | null
  state?: string | null
  diagnosticCode?: string | null
}

export type DataStoreStatisticsDto = {
  bookCount?: number | null
  tagCount?: number | null
  observedAt?: string | null
  indexCount?: number | null
  dataSizeBytes?: number | null
  storeName?: string | null
  availableStoreNames?: string[] | null
}

export type DataStoreDiagnosticsResponse = {
  generatedAt?: string | null
  isConnected?: boolean | null
  providerVersion?: string | null
  storeName?: string | null
  availability?: DataStoreObservationAvailability | null
  diagnosticCode?: string | null
  error?: string | null
  topology?: DataStoreTopologyDto | null
  resources?: DataStoreResourceDto[] | null
  statistics?: DataStoreStatisticsDto | null
}

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

export type DownloadJobDto = {
  jobId?: string | null
  bookId?: string | null
  url?: string | null
  status?: string | null
  progress?: number | null
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

export type ConnectionTestResult = {
  success?: boolean | null
  testedAt?: string | null
  statusCode?: number | null
  latencyMs?: number | null
  message?: string | null
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
  intervalMinutes: number | null
  cpuThreshold: number | null
}

export type MaintenanceStorageSyncMode = 'Quick' | 'Deep'

export type MaintenanceStartRequestDto = {
  mode: MaintenanceStorageSyncMode | null
}

export type MaintenanceTriggerResponse = {
  started?: boolean | null
  runId?: string | null
  message?: string | null
}

export type MaintenanceActionResponse = {
  success?: boolean | null
  message?: string | null
  runId?: string | null
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

export type CacheClearState = 'Idle' | 'Running' | 'Completed' | 'Failed' | string

export type CacheClearStatusResponse = {
  runId?: string | null
  state?: CacheClearState | null
  totalEntries?: number | null
  processedEntries?: number | null
  deletedEntries?: number | null
  failedEntries?: number | null
  startedAt?: string | null
  finishedAt?: string | null
  error?: string | null
}

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
  clearStatus?: CacheClearStatusResponse | null
}

export type CacheClearStartResponse = {
  started?: boolean | null
  message?: string | null
  status?: CacheClearStatusResponse | null
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

export type DashboardLogLevel = 'Trace' | 'Debug' | 'Information' | 'Warning' | 'Error' | 'Critical' | 'None'
