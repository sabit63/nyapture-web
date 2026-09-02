import { requestJson } from './client'
import type {
  CacheClearStartResponse,
  CacheMetricsResponse,
  ConnectionTestResult,
  DashboardApiResponse,
  DashboardLogsResponse,
  DashboardMaintenanceResponse,
  DataFolderResponse,
  DataStoreDiagnosticsResponse,
  DomainIntervalsResponse,
  DomainIntervalsUpdateRequest,
  DownloadsResponse,
  ImageWorkerConfigResponse,
  ImageWorkerConfigUpdateRequest,
  MaintenanceActionResponse,
  MaintenanceIssuesResponse,
  MaintenanceRunDetailResponse,
  MaintenanceScheduleUpdateRequest,
  MaintenanceStorageSyncMode,
  MaintenanceTriggerResponse,
  WebPilotConfigResponse,
  WebPilotConfigUpdateRequest,
} from '../models/dashboard'

/** Envelope used by the dashboard endpoints in docs/openapi.yaml. */
export type ApiEnvelope<T> = DashboardApiResponse<T>

export type DashboardService = 'webpilot' | 'image-worker'

export type ServiceConfigResponse = WebPilotConfigResponse | ImageWorkerConfigResponse
export type ServiceConfigUpdateRequest = WebPilotConfigUpdateRequest | ImageWorkerConfigUpdateRequest

const segment = (value: string) => encodeURIComponent(value)

export const getDashboardDownloads = (signal?: AbortSignal) => (
  requestJson<ApiEnvelope<DownloadsResponse>>('/api/dashboard/downloads', { signal })
)

export const getDashboardIntervals = (signal?: AbortSignal) => (
  requestJson<ApiEnvelope<DomainIntervalsResponse>>('/api/dashboard/downloads/intervals', { signal })
)

export const updateDashboardIntervals = (body: DomainIntervalsUpdateRequest, signal?: AbortSignal) => (
  requestJson<ApiEnvelope<null>>('/api/dashboard/downloads/intervals', {
    method: 'PATCH',
    body,
    auth: 'edit',
    signal,
  })
)

export const cancelDashboardJob = (jobId: string, signal?: AbortSignal) => (
  requestJson<ApiEnvelope<null>>(`/api/dashboard/downloads/${segment(jobId)}/cancel`, {
    method: 'POST',
    auth: 'edit',
    signal,
  })
)

export const retryDashboardJob = (jobId: string, signal?: AbortSignal) => (
  requestJson<ApiEnvelope<null>>(`/api/dashboard/downloads/${segment(jobId)}/retry`, {
    method: 'POST',
    auth: 'edit',
    signal,
  })
)

export const getDataStoreDiagnostics = (signal?: AbortSignal) => (
  requestJson<ApiEnvelope<DataStoreDiagnosticsResponse>>('/api/dashboard/datastore', { signal })
)

export const getDataFolderDetails = (signal?: AbortSignal) => (
  requestJson<ApiEnvelope<DataFolderResponse>>('/api/dashboard/datafolder', { signal })
)

export const getServiceConfig = (service: DashboardService, signal?: AbortSignal) => (
  requestJson<ApiEnvelope<ServiceConfigResponse>>(`/api/dashboard/${service}/config`, { signal })
)

export const updateServiceConfig = (
  service: DashboardService,
  body: ServiceConfigUpdateRequest,
  signal?: AbortSignal,
) => (
  requestJson<ApiEnvelope<ServiceConfigResponse>>(`/api/dashboard/${service}/config`, {
    method: 'PATCH',
    body,
    auth: 'edit',
    signal,
  })
)

export const testService = (service: DashboardService, signal?: AbortSignal) => (
  requestJson<ApiEnvelope<ConnectionTestResult>>(`/api/dashboard/${service}/test`, {
    method: 'POST',
    auth: 'edit',
    signal,
  })
)

export const getMaintenance = (signal?: AbortSignal) => (
  requestJson<ApiEnvelope<DashboardMaintenanceResponse>>('/api/dashboard/maintenance', { signal })
)

export const getMaintenanceIssues = (signal?: AbortSignal) => (
  requestJson<ApiEnvelope<MaintenanceIssuesResponse>>('/api/dashboard/maintenance/issues', { signal })
)

export const startMaintenance = (mode: MaintenanceStorageSyncMode, signal?: AbortSignal) => (
  requestJson<ApiEnvelope<MaintenanceTriggerResponse>>('/api/dashboard/maintenance/run', {
    method: 'POST',
    body: { mode },
    auth: 'edit',
    signal,
  })
)

export const cancelMaintenance = (signal?: AbortSignal) => (
  requestJson<ApiEnvelope<null>>('/api/dashboard/maintenance/cancel', {
    method: 'POST',
    auth: 'edit',
    signal,
  })
)

export const pauseMaintenance = (signal?: AbortSignal) => (
  requestJson<ApiEnvelope<MaintenanceActionResponse>>('/api/dashboard/maintenance/pause', {
    method: 'POST',
    auth: 'edit',
    signal,
  })
)

export const resumeMaintenance = (signal?: AbortSignal) => (
  requestJson<ApiEnvelope<MaintenanceActionResponse>>('/api/dashboard/maintenance/resume', {
    method: 'POST',
    auth: 'edit',
    signal,
  })
)

export const getMaintenanceRun = (runId: string, signal?: AbortSignal) => (
  requestJson<ApiEnvelope<MaintenanceRunDetailResponse>>(`/api/dashboard/maintenance/runs/${segment(runId)}`, { signal })
)

export const updateMaintenanceSchedule = (body: MaintenanceScheduleUpdateRequest, signal?: AbortSignal) => (
  requestJson<ApiEnvelope<null>>('/api/dashboard/maintenance/schedule', {
    method: 'PATCH',
    body,
    auth: 'edit',
    signal,
  })
)

export const getCacheMetrics = (signal?: AbortSignal) => (
  requestJson<ApiEnvelope<CacheMetricsResponse>>('/api/dashboard/cache/metrics', { signal })
)

export const clearDashboardCache = (signal?: AbortSignal) => (
  requestJson<ApiEnvelope<CacheClearStartResponse>>('/api/dashboard/cache', {
    method: 'DELETE',
    auth: 'edit',
    signal,
  })
)

/** Delete only the cache entry identified by both its group and book IDs. */
export const removeDashboardBookCache = (groupId: string, bookId: string, signal?: AbortSignal) => (
  requestJson<ApiEnvelope<null>>(`/api/dashboard/cache/${segment(groupId)}/${segment(bookId)}`, {
    method: 'DELETE',
    auth: 'edit',
    signal,
  })
)

export type DashboardLogMinLevel = 'Trace' | 'Debug' | 'Information' | 'Warning' | 'Error' | 'Critical' | 'None'

export const getDashboardLogEntries = (
  since = 0,
  minLevel?: DashboardLogMinLevel,
  signal?: AbortSignal,
) => (
  requestJson<ApiEnvelope<DashboardLogsResponse>>('/api/dashboard/logs', {
    query: { since, minLevel },
    signal,
  })
)

export const clearDashboardLogs = (signal?: AbortSignal) => (
  requestJson<ApiEnvelope<null>>('/api/dashboard/logs', {
    method: 'DELETE',
    auth: 'edit',
    signal,
  })
)
