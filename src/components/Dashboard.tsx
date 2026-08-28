import {
  Activity,
  ArrowLeft,
  ArrowUpRight,
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
import {
  DASHBOARD_MOCK_DATA,
  DASHBOARD_MOCK_LOGS,
} from '../mocks/dashboard'
import type {
  CacheSummary,
  DashboardLogEntryDto,
  DashboardSummaryResponse,
  DataFolderSummary,
  DataStoreSummary,
  ImageWorkerSummary,
  MaintenanceSummary,
  WebPilotSummary,
} from '../mocks/dashboard'
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

const DETAIL_COPY: Record<Exclude<DashboardRoute, 'home'>, {
  title: string
  description: string
  icon: LucideIcon
}> = {
  downloads: {
    title: 'Downloads',
    description: 'ダウンロードの実行状況と直近の失敗を確認する詳細画面です。',
    icon: CloudDownload,
  },
  datastore: {
    title: 'Data Store',
    description: 'Data Storeの接続状態と診断情報を確認する詳細画面です。',
    icon: Database,
  },
  datafolder: {
    title: 'DataFolder',
    description: 'DataFolderの利用可能状態と容量情報を確認する詳細画面です。',
    icon: FolderOpen,
  },
  webpilot: {
    title: 'WebPilot',
    description: 'WebPilotの設定状態と接続テスト結果を確認する詳細画面です。',
    icon: Server,
  },
  'image-worker': {
    title: 'ImageWorker',
    description: 'ImageWorkerの設定状態と接続テスト結果を確認する詳細画面です。',
    icon: Image,
  },
  maintenance: {
    title: 'Maintenance',
    description: 'メンテナンスの実行状態と検出された問題を確認する詳細画面です。',
    icon: Wrench,
  },
  cache: {
    title: 'Cache',
    description: 'キャッシュの利用状況とヒット率を確認する詳細画面です。',
    icon: Zap,
  },
  logs: {
    title: 'Logs',
    description: 'Warning以上のシステムログを確認する詳細画面です。',
    icon: ListChecks,
  },
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

const getServiceTestLabel = (value?: string | null) => value ? getFreeStringStatus(value).label : '未取得'

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

const DetailLink = ({ href, label = '詳細を見る' }: { href: string; label?: string }) => (
  <a className="dashboard__detail-link" href={href}>
    <span>{label}</span>
    <ChevronRight size={15} aria-hidden="true" />
  </a>
)

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
  lastUpdated,
  isRefreshing,
  announcement,
  onRefresh,
}: {
  summary: DashboardSummaryResponse
  lastUpdated?: string | null
  isRefreshing: boolean
  announcement: string
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

  const latestLogs = useMemo(() => (DASHBOARD_MOCK_LOGS.entries ?? [])
    .filter((entry) => isWarningOrHigher(entry.level))
    .sort((left, right) => (right.sequence ?? 0) - (left.sequence ?? 0))
    .slice(0, 5), [])

  const attentionItems: Array<{
    label: string
    value: string
    detail: string
    href: string
    tone: StatusTone
    icon: LucideIcon
  }> = [
    {
      label: '失敗ダウンロード',
      value: `${formatCount(failedDownloadCount)}件`,
      detail: '直近の失敗',
      href: '/dashboard/downloads',
      tone: getCountTone(failedDownloadCount, 'danger'),
      icon: CloudDownload,
    },
    {
      label: 'Maintenance問題',
      value: `${formatCount(summary.maintenance?.issuesCount)}件`,
      detail: '検出された問題',
      href: '/dashboard/maintenance',
      tone: getCountTone(summary.maintenance?.issuesCount, 'warning'),
      icon: Wrench,
    },
    {
      label: '警告ログ',
      value: `${formatCount(summary.logs?.warnings24h)}件`,
      detail: '過去24時間',
      href: '/dashboard/logs',
      tone: getCountTone(summary.logs?.warnings24h, 'warning'),
      icon: TriangleAlert,
    },
    {
      label: '劣化サービス',
      value: `${formatCount(degradedServices.length)}件`,
      detail: degradedServices.map((service) => service.label).join('、') || '該当なし',
      href: degradedServices.some((service) => service.label === 'ImageWorker')
        ? '/dashboard/image-worker'
        : '/dashboard/webpilot',
      tone: degradedServices.length === 0 ? 'success' : 'warning',
      icon: Server,
    },
  ]

  return (
    <section className="dashboard" aria-labelledby="dashboard-title" aria-busy={isRefreshing}>
      <p className="dashboard__live-region sr-only" role="status" aria-live="polite">{announcement}</p>

      <header className="dashboard__hero">
        <div className="dashboard__hero-heading">
          <span className="dashboard__hero-icon" aria-hidden="true"><Gauge size={25} strokeWidth={2.1} /></span>
          <div>
            <p className="dashboard__eyebrow">OPERATIONS DASHBOARD</p>
            <h1 id="dashboard-title">システムダッシュボード</h1>
            <p className="dashboard__hero-description">システムの健全性と運用状況をひと目で確認できます。</p>
          </div>
        </div>

        <div className="dashboard__hero-meta">
          <div className="dashboard__hero-badges">
            <span className="dashboard__mock-badge">モックデータ</span>
            <span className="dashboard__api-status">
              <span className="dashboard__api-dot" aria-hidden="true" />
              <span>API 接続中</span>
            </span>
          </div>
          <div className="dashboard__update-row">
            <span className="dashboard__updated-label">最終更新</span>
            <time className="dashboard__updated-time" dateTime={lastUpdated ?? undefined}>{formatDateTime(lastUpdated)}</time>
            <button
              className="dashboard__refresh-button"
              type="button"
              aria-label={isRefreshing ? 'Dashboardを更新中' : 'Dashboardを更新'}
              title={isRefreshing ? '更新中' : '更新'}
              disabled={isRefreshing}
              onClick={onRefresh}
            >
              <RefreshCw className={isRefreshing ? 'dashboard__refresh-icon is-spinning' : 'dashboard__refresh-icon'} size={16} aria-hidden="true" />
              <span>{isRefreshing ? '更新中' : '更新'}</span>
            </button>
          </div>
        </div>
      </header>

      <section className="dashboard__section" aria-labelledby="dashboard-attention-title">
        <div className="dashboard__section-heading">
          <div>
            <p className="dashboard__eyebrow">ATTENTION</p>
            <h2 id="dashboard-attention-title">要確認</h2>
          </div>
          <span className="dashboard__section-count">{attentionItems.length}項目</span>
        </div>
        <div className="dashboard__attention-grid">
          {attentionItems.map((item) => {
            const Icon = item.icon
            return (
              <a className={`dashboard__attention-item dashboard__attention-item--${item.tone}`} href={item.href} key={item.label}>
                <span className="dashboard__attention-icon" aria-hidden="true"><Icon size={18} /></span>
                <span className="dashboard__attention-copy">
                  <span className="dashboard__attention-label">{item.label}</span>
                  <strong>{item.value}</strong>
                  <small>{item.detail}</small>
                </span>
                <ArrowUpRight className="dashboard__attention-arrow" size={16} aria-hidden="true" />
              </a>
            )
          })}
        </div>
      </section>

      <section className="dashboard__section" aria-labelledby="dashboard-kpi-title">
        <div className="dashboard__section-heading">
          <div>
            <p className="dashboard__eyebrow">AT A GLANCE</p>
            <h2 id="dashboard-kpi-title">システム概要</h2>
          </div>
        </div>
        <div className="dashboard__kpi-grid">
          <article className="dashboard__card dashboard__kpi-card">
            <div className="dashboard__card-heading">
              <span className="dashboard__card-icon" aria-hidden="true"><Database size={18} /></span>
              <div>
                <p className="dashboard__card-eyebrow">DATA STORE</p>
                <h3>Data Store</h3>
              </div>
              <StatusBadge status={dataStoreStatus} compact />
            </div>
            <div className="dashboard__metric-row">
              <strong className="dashboard__metric-value">{dataStoreStatus.label}</strong>
              <span className="dashboard__metric-caption">接続状態</span>
            </div>
            <p className="dashboard__card-note">
              {summary.dataStore?.storeName ?? 'ストア名不明'}
              <span aria-hidden="true"> · </span>
              {summary.dataStore?.providerVersion ?? 'バージョン不明'}
            </p>
            <DetailLink href="/dashboard/datastore" />
          </article>

          <article className="dashboard__card dashboard__kpi-card">
            <div className="dashboard__card-heading">
              <span className="dashboard__card-icon" aria-hidden="true"><HardDrive size={18} /></span>
              <div>
                <p className="dashboard__card-eyebrow">STORAGE</p>
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
            <DetailLink href="/dashboard/datafolder" />
          </article>

          <article className="dashboard__card dashboard__kpi-card">
            <div className="dashboard__card-heading">
              <span className="dashboard__card-icon" aria-hidden="true"><CloudDownload size={18} /></span>
              <div>
                <p className="dashboard__card-eyebrow">DOWNLOADS</p>
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
            <p className={`dashboard__inline-notice ${failedDownloadCount && failedDownloadCount > 0 ? 'dashboard__inline-notice--warning' : ''}`}>
              <TriangleAlert size={13} aria-hidden="true" />
              <span>{typeof failedDownloadCount !== 'number' || !Number.isFinite(failedDownloadCount)
                ? '失敗数 不明'
                : failedDownloadCount > 0
                  ? `失敗 ${formatCount(failedDownloadCount)}件`
                  : '失敗なし'}</span>
            </p>
            <DetailLink href="/dashboard/downloads" />
          </article>

          <article className="dashboard__card dashboard__kpi-card">
            <div className="dashboard__card-heading">
              <span className="dashboard__card-icon" aria-hidden="true"><Gauge size={18} /></span>
              <div>
                <p className="dashboard__card-eyebrow">CACHE</p>
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
            <DetailLink href="/dashboard/cache" />
          </article>
        </div>
      </section>

      <section className="dashboard__section" aria-labelledby="dashboard-operations-title">
        <div className="dashboard__section-heading">
          <div>
            <p className="dashboard__eyebrow">OPERATIONS</p>
            <h2 id="dashboard-operations-title">運用サービス</h2>
          </div>
        </div>
        <div className="dashboard__operations-grid">
          <article className="dashboard__card dashboard__operation-card">
            <div className="dashboard__card-heading">
              <span className="dashboard__card-icon dashboard__card-icon--warning" aria-hidden="true"><Wrench size={18} /></span>
              <div>
                <p className="dashboard__card-eyebrow">MAINTENANCE</p>
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
            <DetailLink href="/dashboard/maintenance" />
          </article>

          <article className="dashboard__card dashboard__operation-card">
            <div className="dashboard__card-heading">
              <span className="dashboard__card-icon" aria-hidden="true"><Server size={18} /></span>
              <div>
                <p className="dashboard__card-eyebrow">WEBPILOT</p>
                <h3>WebPilot</h3>
              </div>
              <StatusBadge status={webPilotStatus} compact />
            </div>
            <div className="dashboard__operation-main">
              <strong>{webPilotStatus.label}</strong>
              <span>{summary.webPilot?.isConfigured ? '設定済み' : '接続設定'}</span>
            </div>
            <p className="dashboard__card-note">最終テスト: {getServiceTestLabel(summary.webPilot?.lastTestStatus)}</p>
            <DetailLink href="/dashboard/webpilot" />
          </article>

          <article className="dashboard__card dashboard__operation-card">
            <div className="dashboard__card-heading">
              <span className="dashboard__card-icon dashboard__card-icon--purple" aria-hidden="true"><Image size={18} /></span>
              <div>
                <p className="dashboard__card-eyebrow">IMAGE WORKER</p>
                <h3>ImageWorker</h3>
              </div>
              <StatusBadge status={imageWorkerStatus} compact />
            </div>
            <div className="dashboard__operation-main">
              <strong>{imageWorkerStatus.label}</strong>
              <span>{summary.imageWorker?.isConfigured ? '設定済み' : '接続設定'}</span>
            </div>
            <p className="dashboard__card-note">最終テスト: {getServiceTestLabel(summary.imageWorker?.lastTestStatus)}</p>
            <DetailLink href="/dashboard/image-worker" />
          </article>
        </div>
      </section>

      <section className="dashboard__section" aria-labelledby="dashboard-activity-title">
        <div className="dashboard__section-heading">
          <div>
            <p className="dashboard__eyebrow">ACTIVITY</p>
            <h2 id="dashboard-activity-title">最新のアクティビティ</h2>
          </div>
          <DetailLink href="/dashboard/logs" label="ログをすべて見る" />
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
        <p>{entry.message ?? 'メッセージなし'}</p>
      </div>
      <ChevronRight className="dashboard__activity-chevron" size={16} aria-hidden="true" />
    </li>
  )
}

function DashboardDetailPlaceholder({ route }: { route: Exclude<DashboardRoute, 'home'> }) {
  const copy = DETAIL_COPY[route]
  const Icon = copy.icon
  return (
    <section className="dashboard dashboard--detail" aria-labelledby="dashboard-detail-title">
      <article className="dashboard__placeholder">
        <span className="dashboard__placeholder-icon" aria-hidden="true"><Icon size={25} /></span>
        <p className="dashboard__eyebrow">DASHBOARD DETAIL</p>
        <h1 id="dashboard-detail-title">{copy.title}</h1>
        <p className="dashboard__placeholder-description">{copy.description}</p>
        <p className="dashboard__placeholder-note">この詳細画面はモックです。実データの取得と操作は今後の実装で追加されます。</p>
        <a className="dashboard__back-link" href="/dashboard">
          <ArrowLeft size={16} aria-hidden="true" />
          <span>Dashboardへ戻る</span>
        </a>
      </article>
    </section>
  )
}

export function Dashboard({ path }: DashboardProps = {}) {
  const route = resolveDashboardRoute(path)
  const [summary, setSummary] = useState<DashboardSummaryResponse>(() => DASHBOARD_MOCK_DATA)
  const [lastUpdated, setLastUpdated] = useState<string | null>(() => DASHBOARD_MOCK_DATA.generatedAt ?? null)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [announcement, setAnnouncement] = useState('')
  const refreshTimerRef = useRef<number | null>(null)

  useEffect(() => () => {
    if (refreshTimerRef.current !== null) window.clearTimeout(refreshTimerRef.current)
  }, [])

  const refresh = () => {
    if (isRefreshing) return
    setIsRefreshing(true)
    setAnnouncement('Dashboardを更新しています。')
    refreshTimerRef.current = window.setTimeout(() => {
      const refreshedAt = new Date().toISOString()
      setSummary((current) => ({ ...current, generatedAt: refreshedAt }))
      setLastUpdated(refreshedAt)
      setIsRefreshing(false)
      setAnnouncement('Dashboardを更新しました。')
      refreshTimerRef.current = null
    }, 650)
  }

  if (route !== 'home') return <DashboardDetailPlaceholder route={route} />

  return (
    <DashboardHome
      summary={summary}
      lastUpdated={lastUpdated}
      isRefreshing={isRefreshing}
      announcement={announcement}
      onRefresh={refresh}
    />
  )
}

export default Dashboard
