import {
  Activity,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  CircleHelp,
  CloudDownload,
  Database,
  FolderOpen,
  Gauge,
  HardDrive,
  Image,
  ListChecks,
  RefreshCw,
  Server,
  TriangleAlert,
  Wrench,
  Zap,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { getDashboardLogs, getDashboardSummary, getErrorMessage } from '../api'
import type {
  CacheSummary,
  DashboardLogEntryDto,
  DashboardLogsResponse,
  DashboardSummaryResponse,
  DataFolderSummary,
  DataStoreSummary,
  ImageWorkerSummary,
  MaintenanceSummary,
  WebPilotSummary,
} from '../mocks/dashboard'
import { DashboardDetails } from './DashboardDetails'
import './dashboard.css'

export type DashboardRoute =
  | 'home'
  | 'downloads'
  | 'datastore'
  | 'datafolder'
  | 'webpilot'
  | 'image-worker'
  | 'maintenance'
  | 'cache'
  | 'logs'

export interface DashboardProps {
  /** Parent shell can pass the current pathname; omitted in the browser uses window.location.pathname. */
  path?: string
  /** Changes whenever the active API client settings are replaced. */
  apiRevision: number
}

const DASHBOARD_PATHS: Record<string, DashboardRoute> = {
  '/dashboard': 'home',
  '/dashboard/downloads': 'downloads',
  '/dashboard/datastore': 'datastore',
  '/dashboard/mongodb': 'datastore',
  '/dashboard/datafolder': 'datafolder',
  '/dashboard/webpilot': 'webpilot',
  '/dashboard/image-worker': 'image-worker',
  '/dashboard/maintenance': 'maintenance',
  '/dashboard/cache': 'cache',
  '/dashboard/logs': 'logs',
}

type StatusTone = 'success' | 'warning' | 'danger' | 'info' | 'muted'

interface StatusPresentation {
  label: string
  tone: StatusTone
  icon: LucideIcon
}

const STATUS_ICONS: Record<StatusTone, LucideIcon> = {
  success: CheckCircle2,
  warning: TriangleAlert,
  danger: CircleAlert,
  info: Activity,
  muted: CircleHelp,
}

const UNKNOWN_STATUS: StatusPresentation = {
  label: '不明',
  tone: 'muted',
  icon: STATUS_ICONS.muted,
}

const EMPTY_SUMMARY: DashboardSummaryResponse = {}
const EMPTY_LOGS: DashboardLogsResponse = { entries: [] }

const normalizeStatus = (value?: string | null) => value?.trim().toLocaleLowerCase('en-US') ?? ''

const getFreeStringStatus = (value?: string | null): StatusPresentation => {
  switch (normalizeStatus(value)) {
    case 'available':
    case 'connected':
    case 'success':
    case 'succeeded':
    case 'ok':
    case 'healthy':
    case 'passed':
    case 'pass':
      return { label: '正常', tone: 'success', icon: STATUS_ICONS.success }
    case 'degraded':
      return { label: '劣化', tone: 'warning', icon: STATUS_ICONS.warning }
    case 'warning':
    case 'warn':
    case 'throttled':
      return { label: '警告', tone: 'warning', icon: STATUS_ICONS.warning }
    case 'error':
    case 'failed':
    case 'failure':
    case 'unavailable':
    case 'disconnected':
      return { label: 'エラー', tone: 'danger', icon: STATUS_ICONS.danger }
    case 'critical':
    case 'fatal':
      return { label: '重大', tone: 'danger', icon: STATUS_ICONS.danger }
    case 'notapplicable':
    case 'not applicable':
      return { label: '対象外', tone: 'info', icon: STATUS_ICONS.info }
    case 'running':
      return { label: '実行中', tone: 'info', icon: STATUS_ICONS.info }
    case 'paused':
      return { label: '一時停止', tone: 'warning', icon: STATUS_ICONS.warning }
    case 'configured':
      return { label: '設定済み', tone: 'success', icon: STATUS_ICONS.success }
    default:
      return UNKNOWN_STATUS
  }
}

const getDataStoreStatus = (summary?: DataStoreSummary | null): StatusPresentation => {
  if (!summary) return UNKNOWN_STATUS

  const availability = normalizeStatus(summary.availability)
  if (availability) {
    if (availability === 'available') {
      if (summary.isConnected === false) return { label: '切断', tone: 'danger', icon: STATUS_ICONS.danger }
      return summary.isConnected === true
        ? { label: '接続中', tone: 'success', icon: STATUS_ICONS.success }
        : { label: '利用可能', tone: 'info', icon: STATUS_ICONS.info }
    }
    if (availability === 'notapplicable') return getFreeStringStatus(availability)
    if (availability === 'unavailable') return { label: '利用不可', tone: 'danger', icon: STATUS_ICONS.danger }
    return UNKNOWN_STATUS
  }

  if (summary.isConnected === true) return { label: '接続中', tone: 'success', icon: STATUS_ICONS.success }
  if (summary.isConnected === false) return { label: '切断', tone: 'danger', icon: STATUS_ICONS.danger }
  return UNKNOWN_STATUS
}

const getAvailabilityStatus = (summary?: DataFolderSummary | null): StatusPresentation => {
  if (!summary || summary.isAvailable === undefined || summary.isAvailable === null) return UNKNOWN_STATUS
  return summary.isAvailable
    ? { label: '利用可能', tone: 'success', icon: STATUS_ICONS.success }
    : { label: '利用不可', tone: 'danger', icon: STATUS_ICONS.danger }
}

const getServiceStatus = (summary?: WebPilotSummary | ImageWorkerSummary | null): StatusPresentation => {
  if (!summary) return UNKNOWN_STATUS
  if (summary.isConfigured === false) return { label: '未設定', tone: 'warning', icon: STATUS_ICONS.warning }
  if (summary.lastTestStatus !== undefined && summary.lastTestStatus !== null) {
    return getFreeStringStatus(summary.lastTestStatus)
  }
  if (summary.isConfigured === true) return { label: '設定済み', tone: 'success', icon: STATUS_ICONS.success }
  return UNKNOWN_STATUS
}

const getServiceTestLabel = (value: string) => getFreeStringStatus(value).label

const getMaintenanceStatus = (summary?: MaintenanceSummary | null): StatusPresentation => {
  if (!summary) return UNKNOWN_STATUS
  if (summary.isRunning === true) return { label: '実行中', tone: 'info', icon: STATUS_ICONS.info }
  if (summary.isRunning === false && typeof summary.issuesCount === 'number' && Number.isFinite(summary.issuesCount)) {
    if (summary.issuesCount > 0) return { label: '要確認', tone: 'warning', icon: STATUS_ICONS.warning }
    if (summary.issuesCount === 0) return { label: '正常', tone: 'success', icon: STATUS_ICONS.success }
  }
  return UNKNOWN_STATUS
}

const getCacheStatus = (summary?: CacheSummary | null): StatusPresentation => {
  if (!summary) return UNKNOWN_STATUS
  if (typeof summary.hitRate === 'number' && Number.isFinite(summary.hitRate)) {
    return { label: '観測中', tone: 'success', icon: STATUS_ICONS.success }
  }
  if (typeof summary.entryCount === 'number' || typeof summary.sizeBytes === 'number') {
    return { label: '観測中', tone: 'info', icon: STATUS_ICONS.info }
  }
  return UNKNOWN_STATUS
}

const formatCount = (value?: number | null) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—'
  return value.toLocaleString('ja-JP')
}

const getCountTone = (value: number | null | undefined, nonZeroTone: StatusTone): StatusTone => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'muted'
  return value === 0 ? 'success' : nonZeroTone
}

const formatBytes = (value?: number | null) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—'
  if (Math.abs(value) < 1_000) return `${value.toLocaleString('ja-JP')} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let normalized = Math.abs(value)
  let unitIndex = -1
  while (normalized >= 1_000 && unitIndex < units.length - 1) {
    normalized /= 1_000
    unitIndex += 1
  }
  const sign = value < 0 ? '-' : ''
  return `${sign}${normalized.toLocaleString('ja-JP', { maximumFractionDigits: 1 })} ${units[unitIndex]}`
}

const formatDateTime = (value?: string | null) => {
  if (!value) return '未取得'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '未取得'
  return new Intl.DateTimeFormat('ja-JP', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

const clampRatio = (value?: number | null) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return Math.min(1, Math.max(0, value))
}

const getDataFolderUsageRatio = (summary?: DataFolderSummary | null) => {
  if (!summary) return null
  const explicitRatio = clampRatio(summary.usageRatio)
  if (explicitRatio !== null) return explicitRatio
  if (typeof summary.totalBytes !== 'number' || !Number.isFinite(summary.totalBytes) || summary.totalBytes <= 0) return null
  if (typeof summary.freeBytes !== 'number' || !Number.isFinite(summary.freeBytes)) return null
  return clampRatio(1 - (summary.freeBytes / summary.totalBytes))
}

const ratioToPercent = (ratio: number | null) => ratio === null ? null : Math.round(ratio * 100)

const LOG_LEVEL_ORDER: Record<string, number> = {
  trace: 0,
  debug: 1,
  info: 2,
  warning: 3,
  warn: 3,
  error: 4,
  critical: 5,
  fatal: 5,
}

const getLogStatus = (level?: string | null): StatusPresentation => {
  switch (normalizeStatus(level)) {
    case 'warning':
    case 'warn':
      return { label: '警告', tone: 'warning', icon: STATUS_ICONS.warning }
    case 'error':
      return { label: 'エラー', tone: 'danger', icon: STATUS_ICONS.danger }
    case 'critical':
      return { label: '重大', tone: 'danger', icon: STATUS_ICONS.danger }
    case 'fatal':
      return { label: '致命的', tone: 'danger', icon: STATUS_ICONS.danger }
    default:
      return UNKNOWN_STATUS
  }
}

const isWarningOrHigher = (level?: string | null) => {
  const normalized = normalizeStatus(level)
  return normalized in LOG_LEVEL_ORDER && LOG_LEVEL_ORDER[normalized] >= LOG_LEVEL_ORDER.warning
}

const resolveDashboardPath = (path?: string) => {
  const source = path ?? (typeof window === 'undefined' ? '/dashboard' : window.location.pathname)
  const pathname = source.split(/[?#]/)[0] || '/'
  if (pathname.length <= 1) return pathname
  return pathname.replace(/\/+$/, '')
}

export const resolveDashboardRoute = (path?: string): DashboardRoute => DASHBOARD_PATHS[resolveDashboardPath(path)] ?? 'home'

const StatusBadge = ({ status, compact = false }: { status: StatusPresentation; compact?: boolean }) => {
  const Icon = status.icon
  return (
    <span className={`dashboard__status dashboard__status--${status.tone} ${compact ? 'dashboard__status--compact' : ''}`}>
      <Icon size={compact ? 13 : 14} aria-hidden="true" />
      <span>{status.label}</span>
    </span>
  )
}

function DashboardHome({
  summary,
  logs,
  lastUpdated,
  isRefreshing,
  announcement,
  errorMessage,
  apiStatus,
  onRefresh,
}: {
  summary: DashboardSummaryResponse
  logs: DashboardLogsResponse
  lastUpdated?: string | null
  isRefreshing: boolean
  announcement: string
  errorMessage?: string | null
  apiStatus: 'loading' | 'connected' | 'error'
  onRefresh: () => void
}) {
  const dataStoreStatus = getDataStoreStatus(summary.dataStore)
  const dataFolderStatus = getAvailabilityStatus(summary.dataFolder)
  const maintenanceStatus = getMaintenanceStatus(summary.maintenance)
  const webPilotStatus = getServiceStatus(summary.webPilot)
  const imageWorkerStatus = getServiceStatus(summary.imageWorker)
  const cacheStatus = getCacheStatus(summary.cache)

  const runningCount = summary.downloads?.runningCount
  const queuedCount = summary.downloads?.queuedCount
  const activeDownloadCount = typeof runningCount === 'number' && typeof queuedCount === 'number'
    ? runningCount + queuedCount
    : null
  const failedDownloadCount = summary.downloads?.failedRecentCount
  const dataFolderRatio = getDataFolderUsageRatio(summary.dataFolder)
  const dataFolderPercent = ratioToPercent(dataFolderRatio)
  const cacheRatio = clampRatio(summary.cache?.hitRate)
  const cachePercent = ratioToPercent(cacheRatio)

  const degradedServices = [
    { label: 'WebPilot', summary: summary.webPilot },
    { label: 'ImageWorker', summary: summary.imageWorker },
  ].filter((service) => normalizeStatus(service.summary?.lastTestStatus) === 'degraded')

  const latestLogs = useMemo(() => (logs.entries ?? [])
    .slice()
    .filter((entry) => isWarningOrHigher(entry.level))
    .sort((left, right) => (right.sequence ?? 0) - (left.sequence ?? 0))
    .slice(0, 5), [logs])

  const attentionItems: Array<{
    label: string
    value: string
    detail: string
    tone: StatusTone
    icon: LucideIcon
  }> = []

  if (typeof failedDownloadCount === 'number' && Number.isFinite(failedDownloadCount) && failedDownloadCount > 0) {
    attentionItems.push({
      label: '失敗ダウンロード',
      value: `${formatCount(failedDownloadCount)}件`,
      detail: '直近の失敗',
      tone: getCountTone(failedDownloadCount, 'danger'),
      icon: CloudDownload,
    })
  }
  if (
    typeof summary.maintenance?.issuesCount === 'number'
    && Number.isFinite(summary.maintenance.issuesCount)
    && summary.maintenance.issuesCount > 0
  ) {
    attentionItems.push({
      label: 'Maintenance問題',
      value: `${formatCount(summary.maintenance?.issuesCount)}件`,
      detail: '検出された問題',
      tone: getCountTone(summary.maintenance?.issuesCount, 'warning'),
      icon: Wrench,
    })
  }
  if (
    typeof summary.logs?.warnings24h === 'number'
    && Number.isFinite(summary.logs.warnings24h)
    && summary.logs.warnings24h > 0
  ) {
    attentionItems.push({
      label: '警告ログ',
      value: `${formatCount(summary.logs?.warnings24h)}件`,
      detail: '過去24時間',
      tone: getCountTone(summary.logs?.warnings24h, 'warning'),
      icon: TriangleAlert,
    })
  }
  if (degradedServices.length > 0) {
    attentionItems.push({
      label: '劣化サービス',
      value: `${formatCount(degradedServices.length)}件`,
      detail: degradedServices.map((service) => service.label).join('、'),
      tone: 'warning',
      icon: Server,
    })
  }

  const dataStoreDetails = [
    summary.dataStore?.storeName,
    summary.dataStore?.providerVersion,
  ].flatMap((value) => value?.trim() ? [value.trim()] : [])

  return (
    <section className="dashboard" aria-labelledby="dashboard-title" aria-busy={isRefreshing}>
      <p className="dashboard__live-region sr-only" role="status" aria-live="polite">{announcement}</p>

      <header className="dashboard__hero">
        <div className="dashboard__hero-heading">
          <span className="dashboard__hero-icon" aria-hidden="true"><Gauge size={25} strokeWidth={2.1} /></span>
          <div>
            <h1 id="dashboard-title">システムダッシュボード</h1>
          </div>
        </div>

        <div className="dashboard__hero-meta">
          <div className="dashboard__hero-badges">
            <span className={`dashboard__api-status dashboard__api-status--${apiStatus}`}>
              <span className="dashboard__api-dot" aria-hidden="true" />
              <span className={apiStatus === 'loading' ? 'sr-only' : undefined}>
                {apiStatus === 'loading' ? 'API 読み込み中' : apiStatus === 'error' ? 'API エラー' : 'API 接続中'}
              </span>
            </span>
          </div>
          <div className="dashboard__update-row">
            <span className="dashboard__updated-label">最終更新</span>
            <time className="dashboard__updated-time" dateTime={lastUpdated ?? undefined}>{formatDateTime(lastUpdated)}</time>
            <button
              className="dashboard__refresh-button"
              type="button"
              aria-label={isRefreshing ? 'Dashboardを更新中' : 'Dashboardを更新'}
              disabled={isRefreshing}
              onClick={onRefresh}
            >
              <RefreshCw className={isRefreshing ? 'dashboard__refresh-icon is-spinning' : 'dashboard__refresh-icon'} size={16} aria-hidden="true" />
            </button>
          </div>
        </div>
      </header>

      {errorMessage ? (
        <div className="dashboard__error dashboard__error--inline" role="alert">
          <CircleAlert size={17} aria-hidden="true" />
          <p>{errorMessage}</p>
          <button className="dashboard__retry-button" type="button" disabled={isRefreshing} onClick={onRefresh}>
            再試行
          </button>
        </div>
      ) : null}

      {attentionItems.length > 0 && (
        <section className="dashboard__section" aria-labelledby="dashboard-attention-title">
          <div className="dashboard__section-heading">
            <div>
              <h2 id="dashboard-attention-title">要確認</h2>
            </div>
            <span className="dashboard__section-count">{attentionItems.length}項目</span>
          </div>
          <div className="dashboard__attention-grid">
            {attentionItems.map((item) => {
              const Icon = item.icon
              return (
                <article className={`dashboard__attention-item dashboard__attention-item--${item.tone}`} key={item.label}>
                  <span className="dashboard__attention-icon" aria-hidden="true"><Icon size={18} /></span>
                  <span className="dashboard__attention-copy">
                    <span className="dashboard__attention-label">{item.label}</span>
                    <strong>{item.value}</strong>
                    <small>{item.detail}</small>
                  </span>
                </article>
              )
            })}
          </div>
        </section>
      )}

      <section className="dashboard__section" aria-labelledby="dashboard-kpi-title">
        <div className="dashboard__section-heading">
          <div>
            <h2 id="dashboard-kpi-title">システム概要</h2>
          </div>
        </div>
        <div className="dashboard__kpi-grid">
          <article className="dashboard__card dashboard__kpi-card">
            <div className="dashboard__card-heading">
              <span className="dashboard__card-icon" aria-hidden="true"><Database size={18} /></span>
              <div>
                <h3>Data Store</h3>
              </div>
              <StatusBadge status={dataStoreStatus} compact />
            </div>
            {dataStoreDetails.length > 0 && (
              <p className="dashboard__card-note">{dataStoreDetails.join(' · ')}</p>
            )}
          </article>

          <article className="dashboard__card dashboard__kpi-card">
            <div className="dashboard__card-heading">
              <span className="dashboard__card-icon" aria-hidden="true"><HardDrive size={18} /></span>
              <div>
                <h3>DataFolder</h3>
              </div>
              <StatusBadge status={dataFolderStatus} compact />
            </div>
            <div className="dashboard__metric-row">
              <strong className="dashboard__metric-value">{dataFolderPercent === null ? '—' : `${dataFolderPercent}%`}</strong>
              <span className="dashboard__metric-caption">使用中</span>
            </div>
            <div
              className="dashboard__meter"
              role="progressbar"
              aria-label="DataFolder使用率"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={dataFolderPercent ?? undefined}
              aria-valuetext={dataFolderPercent === null ? '使用率 不明' : `使用率 ${dataFolderPercent}%`}
            >
              <span style={{ width: `${dataFolderPercent ?? 0}%` }} />
            </div>
            <p className="dashboard__card-note">空き {formatBytes(summary.dataFolder?.freeBytes)} / {formatBytes(summary.dataFolder?.totalBytes)}</p>
          </article>

          <article className="dashboard__card dashboard__kpi-card">
            <div className="dashboard__card-heading">
              <span className="dashboard__card-icon" aria-hidden="true"><CloudDownload size={18} /></span>
              <div>
                <h3>Downloads</h3>
              </div>
              <StatusBadge
                status={failedDownloadCount === 0
                  ? { label: '正常', tone: 'success', icon: STATUS_ICONS.success }
                  : failedDownloadCount === null || failedDownloadCount === undefined
                    ? UNKNOWN_STATUS
                    : { label: '要確認', tone: 'warning', icon: STATUS_ICONS.warning }}
                compact
              />
            </div>
            <div className="dashboard__metric-row">
              <strong className="dashboard__metric-value">{activeDownloadCount === null ? '—' : `${formatCount(activeDownloadCount)}件`}</strong>
              <span className="dashboard__metric-caption">稼働中</span>
            </div>
            <p className="dashboard__card-note">実行中 {formatCount(runningCount)} · 待機中 {formatCount(queuedCount)}</p>
            {typeof failedDownloadCount === 'number' && Number.isFinite(failedDownloadCount) && failedDownloadCount > 0 && (
              <p className="dashboard__inline-notice dashboard__inline-notice--warning">
                <TriangleAlert size={13} aria-hidden="true" />
                <span>失敗 {formatCount(failedDownloadCount)}件</span>
              </p>
            )}
          </article>

          <article className="dashboard__card dashboard__kpi-card">
            <div className="dashboard__card-heading">
              <span className="dashboard__card-icon" aria-hidden="true"><Gauge size={18} /></span>
              <div>
                <h3>Cache hit率</h3>
              </div>
              <StatusBadge status={cacheStatus} compact />
            </div>
            <div className="dashboard__metric-row">
              <strong className="dashboard__metric-value">{cachePercent === null ? '—' : `${cachePercent}%`}</strong>
              <span className="dashboard__metric-caption">ヒット率</span>
            </div>
            <div
              className="dashboard__meter dashboard__meter--primary"
              role="progressbar"
              aria-label="Cache hit率"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={cachePercent ?? undefined}
              aria-valuetext={cachePercent === null ? 'Cache hit率 不明' : `Cache hit率 ${cachePercent}%`}
            >
              <span style={{ width: `${cachePercent ?? 0}%` }} />
            </div>
            <p className="dashboard__card-note">{formatCount(summary.cache?.entryCount)}エントリ · {formatBytes(summary.cache?.sizeBytes)}</p>
          </article>
        </div>
      </section>

      <section className="dashboard__section" aria-labelledby="dashboard-operations-title">
        <div className="dashboard__section-heading">
          <div>
            <h2 id="dashboard-operations-title">運用サービス</h2>
          </div>
        </div>
        <div className="dashboard__operations-grid">
          <article className="dashboard__card dashboard__operation-card">
            <div className="dashboard__card-heading">
              <span className="dashboard__card-icon dashboard__card-icon--warning" aria-hidden="true"><Wrench size={18} /></span>
              <div>
                <h3>Maintenance</h3>
              </div>
              <StatusBadge status={maintenanceStatus} compact />
            </div>
            <div className="dashboard__operation-main">
              <strong>{formatCount(summary.maintenance?.issuesCount)}件</strong>
              <span>検出された問題</span>
            </div>
            <dl className="dashboard__operation-details">
              <div><dt>最終実行</dt><dd>{formatDateTime(summary.maintenance?.lastExecutionTime)}</dd></div>
              <div><dt>次回実行</dt><dd>{formatDateTime(summary.maintenance?.nextExecutionTime)}</dd></div>
            </dl>
          </article>

          <article className="dashboard__card dashboard__operation-card">
            <div className="dashboard__card-heading">
              <span className="dashboard__card-icon" aria-hidden="true"><Server size={18} /></span>
              <div>
                <h3>WebPilot</h3>
              </div>
              <StatusBadge status={webPilotStatus} compact />
            </div>
            {summary.webPilot?.lastTestStatus && (
              <p className="dashboard__card-note">最終テスト: {getServiceTestLabel(summary.webPilot.lastTestStatus)}</p>
            )}
          </article>

          <article className="dashboard__card dashboard__operation-card">
            <div className="dashboard__card-heading">
              <span className="dashboard__card-icon dashboard__card-icon--purple" aria-hidden="true"><Image size={18} /></span>
              <div>
                <h3>ImageWorker</h3>
              </div>
              <StatusBadge status={imageWorkerStatus} compact />
            </div>
            {summary.imageWorker?.lastTestStatus && (
              <p className="dashboard__card-note">最終テスト: {getServiceTestLabel(summary.imageWorker.lastTestStatus)}</p>
            )}
          </article>
        </div>
      </section>

      <section className="dashboard__section" aria-labelledby="dashboard-activity-title">
        <div className="dashboard__section-heading">
          <div>
            <h2 id="dashboard-activity-title">最新のアクティビティ</h2>
          </div>
        </div>
        <article className="dashboard__card dashboard__activity-card">
          {latestLogs.length > 0 ? (
            <ul className="dashboard__activity-list">
              {latestLogs.map((entry) => <ActivityEntry entry={entry} key={entry.sequence ?? `${entry.timestamp}-${entry.message}`} />)}
            </ul>
          ) : (
            <p className="dashboard__empty">Warning以上のログはありません。</p>
          )}
        </article>
      </section>
    </section>
  )
}

function ActivityEntry({ entry }: { entry: DashboardLogEntryDto }) {
  const status = getLogStatus(entry.level)
  return (
    <li className="dashboard__activity-entry">
      <span className="dashboard__activity-level"><StatusBadge status={status} compact /></span>
      <div className="dashboard__activity-content">
        <div className="dashboard__activity-meta">
          <span>{entry.category ?? 'システムログ'}</span>
          <time dateTime={entry.timestamp ?? undefined}>{formatDateTime(entry.timestamp)}</time>
        </div>
        {entry.message && <p>{entry.message}</p>}
      </div>
      <ChevronRight className="dashboard__activity-chevron" size={16} aria-hidden="true" />
    </li>
  )
}

function DashboardLoadingState({ announcement }: { announcement: string }) {
  return (
    <section className="dashboard dashboard--state" aria-labelledby="dashboard-title" aria-busy="true">
      <p className="dashboard__live-region sr-only" role="status" aria-live="polite">{announcement}</p>
      <h1 id="dashboard-title" className="sr-only">システムダッシュボード</h1>
      <div className="dashboard__loading-skeleton" aria-hidden="true">
        <div className="dashboard__loading-hero">
          <div className="dashboard__loading-hero-heading">
            <span className="dashboard__skeleton dashboard__skeleton--hero-icon" />
            <span className="dashboard__loading-hero-copy">
              <span className="dashboard__skeleton dashboard__skeleton--hero-title" />
              <span className="dashboard__skeleton dashboard__skeleton--hero-subtitle" />
            </span>
          </div>
          <div className="dashboard__loading-hero-meta">
            <span className="dashboard__skeleton dashboard__skeleton--hero-badge" />
            <span className="dashboard__skeleton dashboard__skeleton--hero-time" />
          </div>
        </div>

        <div className="dashboard__loading-section">
          <span className="dashboard__skeleton dashboard__skeleton--section-title" />
          <div className="dashboard__loading-grid dashboard__loading-grid--kpi">
            {Array.from({ length: 4 }, (_, index) => (
              <div className="dashboard__loading-card dashboard__loading-card--kpi" key={index}>
                <span className="dashboard__loading-card-heading">
                  <span className="dashboard__skeleton dashboard__skeleton--card-icon" />
                  <span className="dashboard__skeleton dashboard__skeleton--card-title" />
                <span className="dashboard__skeleton dashboard__skeleton--status" />
              </span>
              <span className="dashboard__skeleton dashboard__skeleton--metric" />
              <span className="dashboard__skeleton dashboard__skeleton--card-note" />
            </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}

function DashboardErrorState({ message, announcement, onRetry }: {
  message: string
  announcement: string
  onRetry: () => void
}) {
  return (
    <section className="dashboard dashboard--state" aria-labelledby="dashboard-title" aria-busy="false">
      <p className="dashboard__live-region sr-only" role="status" aria-live="polite">{announcement}</p>
      <div className="dashboard__state-card dashboard__state-card--error" role="alert">
        <span className="dashboard__state-icon" aria-hidden="true"><CircleAlert size={25} /></span>
        <h1 id="dashboard-title">システムダッシュボード</h1>
        <p>{message}</p>
        <button className="dashboard__retry-button" type="button" onClick={onRetry}>再試行</button>
      </div>
    </section>
  )
}

export function Dashboard({ path, apiRevision }: DashboardProps) {
  const route = resolveDashboardRoute(path)
  const [summary, setSummary] = useState<DashboardSummaryResponse | null>(null)
  const [logs, setLogs] = useState<DashboardLogsResponse | null>(null)
  const [lastUpdated, setLastUpdated] = useState<string | null>(null)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [announcement, setAnnouncement] = useState('')
  const [loadState, setLoadState] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const requestControllerRef = useRef<AbortController | null>(null)

  const refresh = (resetApiData = false) => {
    if (route !== 'home' || requestControllerRef.current !== null) return

    const controller = new AbortController()
    const hasExistingData = !resetApiData && (summary !== null || logs !== null)
    requestControllerRef.current = controller
    if (resetApiData) {
      setSummary(null)
      setLogs(null)
      setLastUpdated(null)
    }
    setIsRefreshing(true)
    setLoadState(hasExistingData ? 'success' : 'loading')
    setErrorMessage(null)
    setAnnouncement(hasExistingData ? 'Dashboardを更新しています。' : 'Dashboardを読み込んでいます。')

    void Promise.all([
      getDashboardSummary<DashboardSummaryResponse>(controller.signal),
      getDashboardLogs<DashboardLogsResponse>(0, controller.signal),
    ]).then(([summaryResponse, logsResponse]) => {
      if (controller.signal.aborted) return

      const nextSummary = summaryResponse.data ?? EMPTY_SUMMARY
      const nextLogs = logsResponse.data ?? EMPTY_LOGS
      setSummary(nextSummary)
      setLogs(nextLogs)
      setLastUpdated(nextSummary.generatedAt ?? nextLogs.generatedAt ?? null)
      setLoadState('success')
      setErrorMessage(null)
      setAnnouncement(hasExistingData ? 'Dashboardを更新しました。' : 'Dashboardを読み込みました。')
    }).catch((error: unknown) => {
      if (controller.signal.aborted) return

      const message = getErrorMessage(error)
      setLoadState(hasExistingData ? 'success' : 'error')
      setErrorMessage(message)
      setAnnouncement(`${hasExistingData ? 'Dashboardの更新' : 'Dashboardの読み込み'}に失敗しました。${message}`)
    }).finally(() => {
      if (requestControllerRef.current !== controller) return
      requestControllerRef.current = null
      setIsRefreshing(false)
    })
  }

  useEffect(() => {
    if (route !== 'home') {
      requestControllerRef.current?.abort()
      requestControllerRef.current = null
      return
    }

    refresh(true)
    return () => {
      requestControllerRef.current?.abort()
      requestControllerRef.current = null
    }
  }, [apiRevision, route])

  if (route !== 'home') return <DashboardDetails route={route} apiRevision={apiRevision} />

  if (summary === null && loadState !== 'error') {
    return <DashboardLoadingState announcement={announcement || 'Dashboardを読み込んでいます。'} />
  }

  if (summary === null) {
    return <DashboardErrorState
      message={errorMessage ?? 'Dashboardの読み込みに失敗しました。'}
      announcement={announcement}
      onRetry={refresh}
    />
  }

  return (
    <DashboardHome
      summary={summary}
      logs={logs ?? EMPTY_LOGS}
      lastUpdated={lastUpdated}
      isRefreshing={isRefreshing}
      announcement={announcement}
      errorMessage={errorMessage}
      apiStatus={isRefreshing ? 'loading' : errorMessage ? 'error' : 'connected'}
      onRefresh={refresh}
    />
  )
}

export default Dashboard
