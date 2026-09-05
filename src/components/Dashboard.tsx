import {
  ChevronRight,
  CircleAlert,
  Database,
  FolderOpen,
  Gauge,
  Image,
  ListChecks,
  RefreshCw,
  Server,
  TriangleAlert,
  Wrench,
  Zap,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { getErrorMessage } from '../api'
import { InternalLink } from '../app/client-router'
import { useDocumentTitle, formatPageTitle } from '../app/page-title'
import { getDashboardLogEntries, getDashboardSummary } from '../api/dashboard'
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
} from '../models/dashboard'
import { useVisiblePolling } from '../hooks/use-visible-polling'
import { DashboardDetails } from './DashboardDetails'
import {
  formatBytes,
  formatCount,
  formatDateTime,
  getDashboardStatus,
  LOADING_STATUS,
  normalize,
  ratio,
  STATUS_ICONS,
  UNKNOWN_STATUS,
  type DashboardStatusPresentation,
} from '../features/dashboard'
import { getDashboardRouteTitle, resolveDashboardRoute } from '../features/dashboard/dashboard-routes'
import { Button } from './ui'
import './dashboard.css'

export type { DashboardRoute } from '../features/dashboard/dashboard-routes'
// Keep the legacy helper import path stable for route-aware callers.
// oxlint-disable-next-line react/only-export-components
export { resolveDashboardRoute } from '../features/dashboard/dashboard-routes'

export interface DashboardProps {
  /** Parent shell can pass the current pathname; omitted in the browser uses window.location.pathname. */
  path?: string
  /** Changes whenever the active API client settings are replaced. */
  apiRevision: number
}

type StatusPresentation = DashboardStatusPresentation

const EMPTY_SUMMARY: DashboardSummaryResponse = {}
const EMPTY_LOGS: DashboardLogsResponse = { entries: [] }

const getStatus = getDashboardStatus

const getDataStoreStatus = (summary?: DataStoreSummary | null): StatusPresentation => {
  if (!summary) return UNKNOWN_STATUS
  if (summary.isConnected === true) return { label: '接続中', tone: 'success', icon: STATUS_ICONS.success }
  if (summary.isConnected === false) return { label: '切断', tone: 'danger', icon: STATUS_ICONS.danger }
  return summary.availability ? getStatus(summary.availability) : UNKNOWN_STATUS
}

const getAvailabilityStatus = (summary?: DataFolderSummary | null): StatusPresentation => {
  if (!summary || summary.isAvailable === undefined || summary.isAvailable === null) return UNKNOWN_STATUS
  return summary.isAvailable
    ? { label: '利用可能', tone: 'success', icon: STATUS_ICONS.success }
    : { label: '利用不可', tone: 'danger', icon: STATUS_ICONS.danger }
}

const getServiceStatus = (summary?: WebPilotSummary | ImageWorkerSummary | null): StatusPresentation => {
  if (!summary) return UNKNOWN_STATUS
  if (summary.lastTestStatus) return getStatus(summary.lastTestStatus)
  if (summary.isConfigured === true) return { label: '設定済み', tone: 'success', icon: STATUS_ICONS.success }
  if (summary.isConfigured === false) return { label: '未設定', tone: 'warning', icon: STATUS_ICONS.warning }
  return UNKNOWN_STATUS
}

const getMaintenanceStatus = (summary?: MaintenanceSummary | null): StatusPresentation => {
  if (!summary) return UNKNOWN_STATUS
  if (summary.isRunning === true) return getStatus('running')
  if (typeof summary.issuesCount === 'number') return summary.issuesCount > 0
    ? { label: '要確認', tone: 'warning', icon: STATUS_ICONS.warning }
    : { label: '正常', tone: 'success', icon: STATUS_ICONS.success }
  return UNKNOWN_STATUS
}

const getCacheStatus = (summary?: CacheSummary | null): StatusPresentation => {
  if (!summary) return UNKNOWN_STATUS
  if (typeof summary.hitRate === 'number') return { label: '観測中', tone: 'success', icon: STATUS_ICONS.success }
  if (typeof summary.entryCount === 'number' || typeof summary.sizeBytes === 'number') {
    return { label: '観測中', tone: 'info', icon: STATUS_ICONS.info }
  }
  return UNKNOWN_STATUS
}

const getLogStatus = (level?: string | null): StatusPresentation => {
  switch (normalize(level)) {
    case 'warning':
    case 'warn':
      return { label: '警告', tone: 'warning', icon: STATUS_ICONS.warning }
    case 'error':
      return { label: 'エラー', tone: 'danger', icon: STATUS_ICONS.danger }
    case 'critical':
    case 'fatal':
      return { label: '重大', tone: 'danger', icon: STATUS_ICONS.danger }
    default:
      return UNKNOWN_STATUS
  }
}

const usageRatio = (summary?: DataFolderSummary | null) => {
  if (!summary || typeof summary.freeBytes !== 'number' || typeof summary.totalBytes !== 'number' || summary.totalBytes <= 0) return null
  return ratio(1 - (summary.freeBytes / summary.totalBytes))
}

const sectionError = (errors: Record<string, string> | null | undefined, names: string[]) => {
  if (!errors) return null
  const wanted = names.map((name) => name.toLocaleLowerCase('en-US'))
  const match = Object.entries(errors).find(([key, value]) => wanted.includes(key.toLocaleLowerCase('en-US')) && value)
  return match?.[1] ?? null
}

const createLinkedAbortController = (parentSignal?: AbortSignal) => {
  const controller = new AbortController()
  if (!parentSignal) return { controller, dispose: () => undefined }

  const abort = () => controller.abort()
  if (parentSignal.aborted) controller.abort()
  else parentSignal.addEventListener('abort', abort, { once: true })

  return {
    controller,
    dispose: () => parentSignal.removeEventListener('abort', abort),
  }
}

const StatusBadge = ({ status, compact = false }: { status: StatusPresentation; compact?: boolean }) => {
  const Icon = status.icon
  return (
    <span className={`dashboard__status dashboard__status--${status.tone} ${compact ? 'dashboard__status--compact' : ''}`}>
      <Icon size={compact ? 13 : 14} aria-hidden="true" />
      <span>{status.label}</span>
    </span>
  )
}

type SummaryCardProps = {
  href: string
  title: string
  icon: LucideIcon
  status: StatusPresentation
  loading?: boolean
  error?: string | null
  children: ReactNode
}

function SummaryCard({ href, title, icon: Icon, status, loading = false, error, children }: SummaryCardProps) {
  const displayedStatus = error
    ? { label: '警告', tone: 'warning' as const, icon: STATUS_ICONS.warning }
    : loading ? LOADING_STATUS : status
  return (
    <InternalLink className="dashboard__card dashboard__summary-card dashboard__link-card" href={href}>
      <div className="dashboard__card-heading"><span className="dashboard__card-icon" aria-hidden="true"><Icon size={18} /></span><h3>{title}</h3><StatusBadge status={displayedStatus} compact /></div>
      <div className="dashboard__summary-card-body">{loading ? <><span className="dashboard__summary-value-skeleton" aria-hidden="true" /><span className="dashboard__summary-loading-label" role="status">取得中</span></> : children}</div>
      {error && <p className="dashboard__card-error"><CircleAlert size={13} aria-hidden="true" />{error}</p>}
      <ChevronRight className="dashboard__summary-card-chevron" size={16} aria-hidden="true" />
    </InternalLink>
  )
}

function ActivityEntry({ entry }: { entry: DashboardLogEntryDto }) {
  const status = getLogStatus(entry.level)
  return (
    <li className="dashboard__activity-entry">
      <span className="dashboard__activity-level"><StatusBadge status={status} compact /></span>
      <div className="dashboard__activity-content"><div className="dashboard__activity-meta"><span>{entry.category ?? 'システムログ'}</span><time dateTime={entry.timestamp ?? undefined}>{formatDateTime(entry.timestamp)}</time></div>{entry.message && <p>{entry.message}</p>}</div>
    </li>
  )
}

function DashboardHome({
  summary,
  logs,
  lastUpdated,
  isRefreshing,
  announcement,
  summaryError,
  logsError,
  isInitialLoading,
  onRefresh,
}: {
  summary: DashboardSummaryResponse | null
  logs: DashboardLogsResponse
  lastUpdated?: string | null
  isRefreshing: boolean
  announcement: string
  summaryError?: string | null
  logsError?: string | null
  isInitialLoading: boolean
  onRefresh: () => void
}) {
  const folderRatio = usageRatio(summary?.dataFolder)
  const dataFolderPercent = folderRatio === null ? null : Math.round(folderRatio * 100)
  const cacheRatio = ratio(summary?.cache?.hitRate)
  const cachePercent = cacheRatio === null ? null : Math.round(cacheRatio * 100)
  const latestLogs = useMemo(() => (logs.entries ?? []).slice().sort((left, right) => (right.sequence ?? 0) - (left.sequence ?? 0)).slice(0, 5), [logs])
  const errors = summary?.errors
  const errorCount = summary?.logs?.errors24h
  const logStatus = errorCount && errorCount > 0
    ? { label: '要確認', tone: 'warning' as const, icon: STATUS_ICONS.warning }
    : { label: '監視中', tone: 'success' as const, icon: STATUS_ICONS.success }

  return (
    <section className="dashboard" aria-labelledby="dashboard-title" aria-busy={isRefreshing}>
      <p className="dashboard__live-region sr-only" role="status" aria-live="polite">{announcement}</p>
      <header className="dashboard__hero"><div className="dashboard__hero-heading"><span className="dashboard__hero-icon" aria-hidden="true"><Gauge size={25} strokeWidth={2.1} /></span><div><h1 id="dashboard-title">システムダッシュボード</h1></div></div><div className="dashboard__hero-meta"><div className="dashboard__hero-badges"><span className={`dashboard__api-status dashboard__api-status--${summaryError ? 'error' : isRefreshing ? 'loading' : 'connected'}`}><span className="dashboard__api-dot" aria-hidden="true" /><span>{summaryError ? 'API エラー' : isRefreshing ? 'API 読み込み中' : 'API 接続中'}</span></span></div><div className="dashboard__update-row"><span className="dashboard__updated-label">最終更新</span><time className="dashboard__updated-time" dateTime={lastUpdated ?? undefined}>{formatDateTime(lastUpdated)}</time><Button variant="ghost" tone="neutral" size="compact" className="dashboard__refresh-button" type="button" aria-label={isRefreshing ? 'Dashboardを更新中' : 'Dashboardを更新'} disabled={isRefreshing} onClick={onRefresh}><RefreshCw className={isRefreshing ? 'dashboard__refresh-icon is-spinning' : 'dashboard__refresh-icon'} size={16} aria-hidden="true" /></Button></div></div></header>

      {summaryError && <div className="dashboard__error dashboard__error--inline" role="alert"><CircleAlert size={17} aria-hidden="true" /><p>{summaryError}</p><Button variant="outline" tone="danger" size="compact" className="dashboard__retry-button" type="button" disabled={isRefreshing} onClick={onRefresh}>再試行</Button></div>}
      <section className="dashboard__section" aria-labelledby="dashboard-overview-title"><div className="dashboard__section-heading"><div><h2 id="dashboard-overview-title">システム概要</h2></div><span className="dashboard__section-count">8項目</span></div><div className="dashboard__kpi-grid dashboard__summary-grid">
        <SummaryCard loading={isInitialLoading} href="/dashboard/datastore" title="DataStore" icon={Database} status={getDataStoreStatus(summary?.dataStore)} error={sectionError(errors, ['dataStore', 'datastore', 'mongoDb', 'mongodb'])}><strong>{summary?.dataStore?.providerVersion ?? '—'}</strong><span>{summary?.dataStore?.storeName ?? '接続情報未取得'}</span></SummaryCard>
        <SummaryCard loading={isInitialLoading} href="/dashboard/datafolder" title="DataFolder" icon={FolderOpen} status={getAvailabilityStatus(summary?.dataFolder)} error={sectionError(errors, ['dataFolder', 'datafolder'])}><strong>{dataFolderPercent === null ? '—' : `${dataFolderPercent}%`}</strong><span>空き {formatBytes(summary?.dataFolder?.freeBytes)} / {formatBytes(summary?.dataFolder?.totalBytes)}</span></SummaryCard>
        <SummaryCard loading={isInitialLoading} href="/dashboard/webpilot" title="WebPilot" icon={Server} status={getServiceStatus(summary?.webPilot)} error={sectionError(errors, ['webPilot', 'webpilot'])}><strong>{summary?.webPilot?.isConfigured ? '設定済み' : '未設定'}</strong><span>{summary?.webPilot?.lastTestStatus ? `最終テスト: ${summary.webPilot.lastTestStatus}` : '疎通結果未取得'}</span></SummaryCard>
        <SummaryCard loading={isInitialLoading} href="/dashboard/image-worker" title="ImageWorker" icon={Image} status={getServiceStatus(summary?.imageWorker)} error={sectionError(errors, ['imageWorker', 'image-worker'])}><strong>{summary?.imageWorker?.isConfigured ? '設定済み' : '未設定'}</strong><span>{summary?.imageWorker?.lastTestStatus ? `最終テスト: ${summary.imageWorker.lastTestStatus}` : '疎通結果未取得'}</span></SummaryCard>
        <SummaryCard loading={isInitialLoading} href="/dashboard/maintenance" title="Maintenance" icon={Wrench} status={getMaintenanceStatus(summary?.maintenance)} error={sectionError(errors, ['maintenance'])}><strong>{formatCount(summary?.maintenance?.issuesCount)}件</strong><span>最終 {formatDateTime(summary?.maintenance?.lastExecutionTime)}</span></SummaryCard>
        <SummaryCard loading={isInitialLoading} href="/dashboard/cache" title="Cache" icon={Zap} status={getCacheStatus(summary?.cache)} error={sectionError(errors, ['cache'])}><strong>{cachePercent === null ? '—' : `${cachePercent}%`}</strong><span>{formatCount(summary?.cache?.entryCount)}エントリ · {formatBytes(summary?.cache?.sizeBytes)}</span></SummaryCard>
        <SummaryCard href="/dashboard/web-cache" title="Web Cache" icon={Server} status={{ label: '管理', tone: 'info', icon: Server }}><strong>同期と設定</strong><span>サイト・自動ダウンロード管理</span></SummaryCard>
        <SummaryCard loading={isInitialLoading} href="/dashboard/logs" title="Logs" icon={ListChecks} status={summary === null ? UNKNOWN_STATUS : logStatus} error={logsError ?? sectionError(errors, ['logs'])}><strong>{formatCount(errorCount)}件</strong><span>過去24時間の ERROR</span></SummaryCard>
      </div></section>

      <section className="dashboard__section" aria-labelledby="dashboard-activity-title"><div className="dashboard__section-heading"><div><h2 id="dashboard-activity-title">最新のアクティビティ</h2></div></div><article className="dashboard__card dashboard__activity-card">{logsError && <p className="dashboard__inline-notice dashboard__inline-notice--warning"><TriangleAlert size={13} aria-hidden="true" />{logsError}</p>}{latestLogs.length > 0 ? <ul className="dashboard__activity-list">{latestLogs.map((entry, index) => <ActivityEntry entry={entry} key={entry.sequence ?? `${entry.timestamp}-${entry.message}-${index}`} />)}</ul> : <p className="dashboard__empty">ログはありません。</p>}</article></section>
    </section>
  )
}

export function Dashboard({ path, apiRevision }: DashboardProps) {
  const route = resolveDashboardRoute(path)
  useDocumentTitle(route === 'home'
    ? formatPageTitle('Dashboard')
    : formatPageTitle(getDashboardRouteTitle(route), 'Dashboard'))
  const [summary, setSummary] = useState<DashboardSummaryResponse | null>(null)
  const [logs, setLogs] = useState<DashboardLogsResponse>(EMPTY_LOGS)
  const [summaryStatus, setSummaryStatus] = useState<'idle' | 'loading' | 'refreshing' | 'success' | 'error'>('loading')
  const [summaryError, setSummaryError] = useState<string | null>(null)
  const [logsError, setLogsError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<string | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const summaryRef = useRef<DashboardSummaryResponse | null>(null)
  const logsRef = useRef<DashboardLogsResponse>(EMPTY_LOGS)
  const summaryRequestRef = useRef<AbortController | null>(null)
  const logsRequestRef = useRef<AbortController | null>(null)

  useEffect(() => { summaryRef.current = summary }, [summary])
  useEffect(() => { logsRef.current = logs }, [logs])

  const refreshSummary = useCallback((reset = false, parentSignal?: AbortSignal) => {
    if (route !== 'home') return Promise.resolve()
    summaryRequestRef.current?.abort()
    const linked = createLinkedAbortController(parentSignal)
    const { controller } = linked
    summaryRequestRef.current = controller
    const hasData = !reset && summaryRef.current !== null
    if (reset) { summaryRef.current = null; setSummary(null); setLastUpdated(null) }
    setSummaryStatus(hasData ? 'refreshing' : 'loading')
    setSummaryError(null)
    setAnnouncement(hasData ? 'Dashboard概要を更新しています。' : 'Dashboard概要を読み込んでいます。')
    return getDashboardSummary(controller.signal).then((response) => {
      if (controller.signal.aborted) return
      if (response.success === false) throw new Error(response.message ?? 'Dashboard概要を取得できませんでした。')
      const next = response.data ?? EMPTY_SUMMARY
      summaryRef.current = next
      setSummary(next)
      setLastUpdated(next.generatedAt ?? logsRef.current.generatedAt ?? null)
      setSummaryStatus('success')
      setSummaryError(null)
      setAnnouncement('Dashboard概要を更新しました。')
    }).catch((error: unknown) => {
      if (controller.signal.aborted) return
      setSummaryStatus(hasData ? 'success' : 'error')
      setSummaryError(getErrorMessage(error))
      setAnnouncement(`Dashboard概要の取得に失敗しました。${getErrorMessage(error)}`)
    }).finally(() => {
      linked.dispose()
      if (summaryRequestRef.current === controller) summaryRequestRef.current = null
    })
  }, [route])

  const refreshLogs = useCallback((reset = false, parentSignal?: AbortSignal) => {
    if (route !== 'home') return Promise.resolve()
    logsRequestRef.current?.abort()
    const linked = createLinkedAbortController(parentSignal)
    const { controller } = linked
    logsRequestRef.current = controller
    const hasData = !reset && (logsRef.current.entries?.length ?? 0) > 0
    if (reset) { logsRef.current = EMPTY_LOGS; setLogs(EMPTY_LOGS); setLogsError(null) }
    return getDashboardLogEntries(0, 'Warning', controller.signal).then((response) => {
      if (controller.signal.aborted) return
      if (response.success === false) throw new Error(response.message ?? 'ログを取得できませんでした。')
      const next = response.data ?? EMPTY_LOGS
      logsRef.current = next
      setLogs(next)
      setLogsError(null)
      setLastUpdated((current) => current ?? next.generatedAt ?? null)
      if (!hasData) setAnnouncement('Dashboardログを読み込みました。')
    }).catch((error: unknown) => {
      if (controller.signal.aborted) return
      setLogsError(getErrorMessage(error))
    }).finally(() => {
      linked.dispose()
      if (logsRequestRef.current === controller) logsRequestRef.current = null
    })
  }, [route])

  const refreshHome = useCallback((reset = false, parentSignal?: AbortSignal) => (
    Promise.all([refreshSummary(reset, parentSignal), refreshLogs(reset, parentSignal)]).then(() => undefined)
  ), [refreshLogs, refreshSummary])

  const pollHome = useCallback((signal: AbortSignal) => {
    const summaryPending = summaryRequestRef.current && !summaryRequestRef.current.signal.aborted
    const logsPending = logsRequestRef.current && !logsRequestRef.current.signal.aborted
    if (summaryPending || logsPending) return
    return refreshHome(false, signal)
  }, [refreshHome])

  useVisiblePolling({ intervalMs: 10_000, enabled: route === 'home', poll: pollHome })

  useEffect(() => {
    if (route !== 'home' || typeof document === 'undefined') return
    const abortHiddenRequests = () => {
      if (!document.hidden) return
      summaryRequestRef.current?.abort()
      logsRequestRef.current?.abort()
    }
    document.addEventListener('visibilitychange', abortHiddenRequests)
    return () => document.removeEventListener('visibilitychange', abortHiddenRequests)
  }, [route])

  useEffect(() => {
    if (route !== 'home') return
    if (typeof document !== 'undefined' && document.hidden) return
    void refreshHome(true)
    return () => {
      summaryRequestRef.current?.abort()
      logsRequestRef.current?.abort()
      summaryRequestRef.current = null
      logsRequestRef.current = null
    }
  }, [apiRevision, route, refreshHome])

  if (route !== 'home') return <DashboardDetails route={route} apiRevision={apiRevision} />
  const isRefreshing = summaryStatus === 'loading' || summaryStatus === 'refreshing'
  return <DashboardHome summary={summary} logs={logs} lastUpdated={lastUpdated} isRefreshing={isRefreshing} isInitialLoading={summary === null && summaryStatus === 'loading'} announcement={announcement || 'Dashboardを読み込んでいます。'} summaryError={summaryError} logsError={logsError} onRefresh={() => refreshHome(summary === null)} />
}

export default Dashboard
