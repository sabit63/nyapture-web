import { requestJson } from './client'
import type {
  CacheMetricsResponse,
  ConnectionTestResult,
  DashboardApiResponse,
  DashboardLogsResponse,
  DashboardMaintenanceResponse,
  DashboardSummaryResponse,
  DataFolderResponse,
  DomainIntervalsResponse,
  DomainIntervalsUpdateRequest,
  DownloadsResponse,
  ImageWorkerConfigResponse,
  ImageWorkerConfigUpdateRequest,
  MaintenanceActionResponse,
  MaintenanceIssuesResponse,
  MaintenanceRunDetailResponse,
  MaintenanceScheduleUpdateRequest,
  MaintenanceStartRequestDto,
  MaintenanceStorageSyncMode,
  MaintenanceTriggerResponse,
  MongoDbDiagnosticsResponse,
  WebPilotConfigResponse,
  WebPilotConfigUpdateRequest,
} from '../models/dashboard'

/** Envelope returned by the Nya Dashboard API. */
export type ApiEnvelope<T> = DashboardApiResponse<T>

/** The Dashboard service configuration endpoints supported by Nya. */
export type DashboardService = 'webpilot' | 'image-worker'

export type ServiceConfigResponse = WebPilotConfigResponse | ImageWorkerConfigResponse
export type ServiceConfigUpdateRequest = WebPilotConfigUpdateRequest | ImageWorkerConfigUpdateRequest

/** Mutation endpoints return the non-data NyaApiResponse envelope. */
export type DashboardMutationResponse = ApiEnvelope<null>

const segment = (value: string) => encodeURIComponent(value)

// ───────── Summary / Downloads ─────────

export const getDashboardSummary = <T = DashboardSummaryResponse>(signal?: AbortSignal) => (
  requestJson<ApiEnvelope<T>>('/api/dashboard/summary', { signal })
)

export const getDashboardDownloads = (signal?: AbortSignal) => (
  requestJson<ApiEnvelope<DownloadsResponse>>('/api/dashboard/downloads', { signal })
)

export const getDashboardIntervals = (signal?: AbortSignal) => (
  requestJson<ApiEnvelope<DomainIntervalsResponse>>('/api/dashboard/downloads/intervals', { signal })
)

export const updateDashboardIntervals = (body: DomainIntervalsUpdateRequest, signal?: AbortSignal) => (
  requestJson<DashboardMutationResponse>('/api/dashboard/downloads/intervals', {
    method: 'PATCH',
    body,
    signal,
  })
)

export const cancelDashboardJob = (jobId: string, signal?: AbortSignal) => (
  requestJson<DashboardMutationResponse>(`/api/dashboard/downloads/${segment(jobId)}/cancel`, {
    method: 'POST',
    signal,
  })
)

export const retryDashboardJob = (jobId: string, signal?: AbortSignal) => (
  requestJson<DashboardMutationResponse>(`/api/dashboard/downloads/${segment(jobId)}/retry`, {
    method: 'POST',
    signal,
  })
)

/** @deprecated Use retryDashboardJob from this module. */
export const retryDashboardDownloadJob = retryDashboardJob

// ───────── MongoDB / DataFolder ─────────

export const getMongoDbDiagnostics = (signal?: AbortSignal) => (
  requestJson<ApiEnvelope<MongoDbDiagnosticsResponse>>('/api/dashboard/mongodb', { signal })
)

export const getDataFolderDetails = (signal?: AbortSignal) => (
  requestJson<ApiEnvelope<DataFolderResponse>>('/api/dashboard/datafolder', { signal })
)

// ───────── External service configuration ─────────

export const getServiceConfig = (service: DashboardService, signal?: AbortSignal) => (
  requestJson<ApiEnvelope<ServiceConfigResponse>>(`/api/dashboard/${service}/config`, { signal })
)

export const updateServiceConfig = (
  service: DashboardService,
  body: ServiceConfigUpdateRequest,
  signal?: AbortSignal,
) => (
  requestJson<DashboardMutationResponse>(`/api/dashboard/${service}/config`, {
    method: 'PATCH',
    body,
    signal,
  })
)

export const testService = (service: DashboardService, signal?: AbortSignal) => (
  requestJson<ApiEnvelope<ConnectionTestResult>>(`/api/dashboard/${service}/test`, {
    method: 'POST',
    signal,
  })
)

// ───────── Maintenance ─────────

export const getMaintenance = (signal?: AbortSignal) => (
  requestJson<ApiEnvelope<DashboardMaintenanceResponse>>('/api/dashboard/maintenance', { signal })
)

export const getMaintenanceIssues = (signal?: AbortSignal) => (
  requestJson<ApiEnvelope<MaintenanceIssuesResponse>>('/api/dashboard/maintenance/issues', { signal })
)

export const startMaintenance = (
  mode: MaintenanceStorageSyncMode | null = null,
  signal?: AbortSignal,
) => {
  const body: MaintenanceStartRequestDto = { mode }
  return requestJson<ApiEnvelope<MaintenanceTriggerResponse>>('/api/dashboard/maintenance/run', {
    method: 'POST',
    body,
    signal,
  })
}

export const cancelMaintenance = (signal?: AbortSignal) => (
  requestJson<DashboardMutationResponse>('/api/dashboard/maintenance/cancel', {
    method: 'POST',
    signal,
  })
)

export const pauseMaintenance = (signal?: AbortSignal) => (
  requestJson<ApiEnvelope<MaintenanceActionResponse>>('/api/dashboard/maintenance/pause', {
    method: 'POST',
    signal,
  })
)

export const resumeMaintenance = (signal?: AbortSignal) => (
  requestJson<ApiEnvelope<MaintenanceActionResponse>>('/api/dashboard/maintenance/resume', {
    method: 'POST',
    signal,
  })
)

export const getMaintenanceRun = (runId: string, signal?: AbortSignal) => (
  requestJson<ApiEnvelope<MaintenanceRunDetailResponse>>(`/api/dashboard/maintenance/runs/${segment(runId)}`, { signal })
)

export const updateMaintenanceSchedule = (body: MaintenanceScheduleUpdateRequest, signal?: AbortSignal) => (
  requestJson<DashboardMutationResponse>('/api/dashboard/maintenance/schedule', {
    method: 'PATCH',
    body,
    signal,
  })
)

// ───────── Cache ─────────

export const getCacheMetrics = (signal?: AbortSignal) => (
  requestJson<ApiEnvelope<CacheMetricsResponse>>('/api/dashboard/cache/metrics', { signal })
)

export const clearDashboardCache = (signal?: AbortSignal) => (
  requestJson<DashboardMutationResponse>('/api/dashboard/cache', {
    method: 'DELETE',
    signal,
  })
)

/** Delete the cache entry identified by its book ID. */
export const removeDashboardBookCache = (bookId: string, signal?: AbortSignal) => (
  requestJson<DashboardMutationResponse>(`/api/dashboard/cache/${segment(bookId)}`, {
    method: 'DELETE',
    signal,
  })
)

// ───────── Logs ─────────

export type DashboardLogMinLevel = 'Trace' | 'Debug' | 'Information' | 'Warning' | 'Error' | 'Critical' | 'None'

const requestDashboardLogs = <T>(
  since: number,
  minLevel: DashboardLogMinLevel | undefined,
  signal?: AbortSignal,
) => (
  requestJson<ApiEnvelope<T>>('/api/dashboard/logs', {
    query: { since, minLevel },
    signal,
  })
)

/**
 * Fetch the dashboard log cursor.  The two-argument form retains the legacy
 * Warning minimum used by the home page; pass a level explicitly for a
 * filtered snapshot.
 */
export function getDashboardLogs<T = DashboardLogsResponse>(since?: number, signal?: AbortSignal): Promise<ApiEnvelope<T>>
export function getDashboardLogs<T = DashboardLogsResponse>(
  since: number,
  minLevel?: DashboardLogMinLevel,
  signal?: AbortSignal,
): Promise<ApiEnvelope<T>>
export function getDashboardLogs<T = DashboardLogsResponse>(
  since = 0,
  minLevelOrSignal?: DashboardLogMinLevel | AbortSignal,
  signal?: AbortSignal,
) {
  const minLevel = typeof minLevelOrSignal === 'string' ? minLevelOrSignal : 'Warning'
  const requestSignal = typeof minLevelOrSignal === 'string' ? signal : minLevelOrSignal
  return requestDashboardLogs<T>(since, minLevel, requestSignal)
}

/** Fetch logs with no implicit minimum, suitable for the Logs detail filter. */
export const getDashboardLogEntries = (
  since = 0,
  minLevel?: DashboardLogMinLevel,
  signal?: AbortSignal,
) => requestDashboardLogs<DashboardLogsResponse>(since, minLevel, signal)

export const clearDashboardLogs = (signal?: AbortSignal) => (
  requestJson<DashboardMutationResponse>('/api/dashboard/logs', {
    method: 'DELETE',
    signal,
  })
)
