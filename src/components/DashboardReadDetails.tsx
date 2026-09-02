import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  CloudDownload,
  Database,
  FileWarning,
  FolderOpen,
  Gauge,
  HardDrive,
  Image,
  ListChecks,
  ListFilter,
  LoaderCircle,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Server,
  Trash2,
  TriangleAlert,
  X,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode, RefObject } from 'react'
import { ApiError, getErrorMessage } from '../api'
import {
  cancelDashboardJob,
  clearDashboardLogs,
  getDashboardDownloads,
  getDashboardIntervals,
  getDashboardLogEntries,
  getDataFolderDetails,
  getDataStoreDiagnostics,
  retryDashboardJob,
  updateDashboardIntervals,
} from '../api/dashboard'
import type {
  DashboardLogEntryDto,
  DashboardLogsResponse,
  DataFolderResponse,
  DataStoreDiagnosticsResponse,
  DownloadJobDto,
  DomainIntervalDto,
  DomainIntervalsResponse,
} from '../models/dashboard'

type DetailEnvelope<T> = {
  success?: boolean
  message?: string | null
  data?: T | null
}

type DetailLoader<T> = (signal: AbortSignal) => Promise<DetailEnvelope<T>>

type DetailQuery<T> = {
  data: T | null
  error: string | null
  loading: boolean
  refreshing: boolean
  announcement: string
  generatedAt: string | null
  refresh: () => void
}

type StatusTone = 'success' | 'warning' | 'danger' | 'info' | 'muted'

type StatusBadgeProps = {
  children: ReactNode
  tone?: StatusTone
  icon?: LucideIcon
}

const formatNumber = (value?: number | null) => (
  typeof value === 'number' && Number.isFinite(value) ? new Intl.NumberFormat('ja-JP').format(value) : '—'
)

const formatBytes = (value?: number | null) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—'
  if (Math.abs(value) < 1024) return `${formatNumber(value)} B`
  const units = ['KB', 'MB', 'GB', 'TB', 'PB']
  let size = value
  let unit = -1
  while (Math.abs(size) >= 1024 && unit < units.length - 1) {
    size /= 1024
    unit += 1
  }
  return `${new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 1 }).format(size)} ${units[unit]}`
}

const formatDateTime = (value?: string | null) => {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('ja-JP', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(date)
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

const normalize = (value?: string | null) => value?.trim().toLocaleLowerCase('en-US') ?? ''

const getStatus = (value?: string | null): { label: string; tone: StatusTone; icon: LucideIcon } => {
  switch (normalize(value)) {
    case 'available':
    case 'connected':
    case 'success':
    case 'succeeded':
    case 'ok':
    case 'healthy':
    case 'passed':
    case 'pass':
    case 'completed':
    case 'complete':
      return { label: '正常', tone: 'success', icon: CheckCircle2 }
    case 'running':
    case 'processing':
    case 'pending':
      return { label: '実行中', tone: 'info', icon: Activity }
    case 'paused':
      return { label: '一時停止', tone: 'warning', icon: TriangleAlert }
    case 'warning':
    case 'warn':
    case 'degraded':
    case 'throttled':
      return { label: '警告', tone: 'warning', icon: AlertTriangle }
    case 'error':
    case 'failed':
    case 'failure':
    case 'unavailable':
    case 'disconnected':
    case 'critical':
    case 'fatal':
      return { label: 'エラー', tone: 'danger', icon: CircleAlert }
    case 'notapplicable':
    case 'not applicable':
    case 'notsupported':
    case 'not supported':
      return { label: '対象外', tone: 'muted', icon: FileWarning }
    case 'idle':
      return { label: '待機', tone: 'muted', icon: Activity }
    default:
      return { label: value?.trim() || '—', tone: 'muted', icon: Activity }
  }
}

const getMutationError = (error: unknown) => (
  error instanceof ApiError && error.status === 403 ? 'ローカル限定' : getErrorMessage(error)
)

const isAbortError = (error: unknown, signal: AbortSignal) => signal.aborted || (
  error instanceof ApiError && error.message.includes('キャンセル')
)

function StatusBadge({ children, tone = 'muted', icon: Icon }: StatusBadgeProps) {
  return (
    <span className={`dashboard__status dashboard__status--${tone} dashboard-detail__badge`}>
      {Icon && <Icon size={13} aria-hidden="true" />}
      <span>{children}</span>
    </span>
  )
}

function DetailSkeleton() {
  return (
    <div className="dashboard-detail__skeleton" aria-hidden="true">
      <span />
      <span />
      <span />
    </div>
  )
}

function useDashboardData<T>(
  apiRevision: number,
  route: string,
  load: DetailLoader<T>,
  title: string,
  getGeneratedAt?: (data: T | null) => string | null,
): DetailQuery<T> {
  const requestRef = useRef<AbortController | null>(null)
  const dataRef = useRef<T | null>(null)
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [announcement, setAnnouncement] = useState('')

  const refresh = useCallback((reset = false) => {
    requestRef.current?.abort()
    const controller = new AbortController()
    requestRef.current = controller
    const hasData = !reset && dataRef.current !== null
    if (reset) {
      dataRef.current = null
      setData(null)
    }
    setLoading(true)
    setRefreshing(hasData)
    setError(null)
    setAnnouncement(`${title}${hasData ? 'を更新中' : 'を読み込み中'}`)

    void load(controller.signal).then((response) => {
      if (controller.signal.aborted) return
      if (response.success === false) {
        throw new ApiError(response.message ?? `${title}の取得に失敗しました。`, { category: 'server' })
      }
      const nextData = response.data ?? null
      dataRef.current = nextData
      setData(nextData)
      setError(null)
      setAnnouncement(`${title}${hasData ? 'を更新' : 'を読み込み'}ました`)
    }).catch((requestError: unknown) => {
      if (isAbortError(requestError, controller.signal)) return
      const message = getErrorMessage(requestError)
      setError(message)
      setAnnouncement(`${title}エラー ${message}`)
    }).finally(() => {
      if (requestRef.current !== controller) return
      requestRef.current = null
      setLoading(false)
      setRefreshing(false)
    })
  }, [load, title])

  useEffect(() => {
    refresh(true)
    return () => {
      requestRef.current?.abort()
      requestRef.current = null
    }
  }, [apiRevision, route, refresh])

  return {
    data,
    error,
    loading,
    refreshing,
    announcement,
    generatedAt: getGeneratedAt?.(data) ?? (
      (data as (T & { generatedAt?: string | null }) | null)?.generatedAt ?? null
    ),
    refresh: () => refresh(false),
  }
}

function useMutationControllers(apiRevision: number) {
  const controllersRef = useRef(new Set<AbortController>())
  const create = useCallback(() => {
    const controller = new AbortController()
    controllersRef.current.add(controller)
    return controller
  }, [])
  const release = useCallback((controller: AbortController) => {
    controllersRef.current.delete(controller)
  }, [])
  const abortAll = useCallback(() => {
    controllersRef.current.forEach((controller) => controller.abort())
    controllersRef.current.clear()
  }, [])

  useEffect(() => () => abortAll(), [abortAll, apiRevision])

  return { create, release }
}

type DetailFrameProps<T> = {
  title: string
  icon: LucideIcon
  route: string
  query: DetailQuery<T>
  children: ReactNode
}

function DetailFrame<T>({ title, icon: Icon, route, query, children }: DetailFrameProps<T>) {
  return (
    <div className="dashboard-detail__content" aria-busy={query.loading}>
      <p className="dashboard__live-region dashboard-detail__live-region sr-only" role="status" aria-live="polite">
        {query.announcement}
      </p>
      {query.generatedAt && (
        <time className="dashboard-detail__generated" dateTime={query.generatedAt}>
          {formatDateTime(query.generatedAt)}
        </time>
      )}
      {query.error && (
        <div className="dashboard-detail__inline-error" role="alert">
          <CircleAlert size={15} aria-hidden="true" />
          <span>{query.error}</span>
          <button className="icon-button" type="button" aria-label="再試行" onClick={query.refresh} disabled={query.loading}>
            <RotateCcw size={15} aria-hidden="true" />
          </button>
        </div>
      )}
      {query.data === null
        ? query.loading
          ? <DetailSkeleton />
          : <div className="dashboard-detail__empty" role="status"><TriangleAlert size={18} aria-hidden="true" /><span>データなし</span></div>
        : children}
    </div>
  )
}

function DetailSection({
  title,
  count,
  children,
  className = '',
}: {
  title: string
  count?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={`dashboard-detail__section dashboard__section ${className}`}>
      <div className="dashboard-detail__section-heading dashboard__section-heading">
        <h2>{title}</h2>
        {count !== undefined && <span className="dashboard-detail__count dashboard__section-count">{count}</span>}
      </div>
      {children}
    </section>
  )
}

function MetricCard({ label, value, icon: Icon, tone = 'muted' }: {
  label: string
  value: ReactNode
  icon: LucideIcon
  tone?: StatusTone
}) {
  return (
    <article className="dashboard-detail__metric dashboard__card">
      <div className="dashboard-detail__metric-label">
        <span className={`dashboard__card-icon dashboard-detail__metric-icon dashboard__card-icon--${tone}`} aria-hidden="true"><Icon size={17} /></span>
        <span>{label}</span>
      </div>
      <strong>{value}</strong>
    </article>
  )
}

function getJobName(job: DownloadJobDto) {
  return job.bookId?.trim() || job.jobId?.trim() || '—'
}

function getJobStatus(job: DownloadJobDto, group: 'running' | 'queued' | 'failed') {
  if (group === 'running') return getStatus('running')
  if (group === 'queued') return getStatus('pending')
  return getStatus(job.status || 'failed')
}

type DownloadsDetailData = {
  downloads: { generatedAt?: string | null; running?: DownloadJobDto[] | null; queued?: DownloadJobDto[] | null; recentFailed?: DownloadJobDto[] | null }
  intervals: DomainIntervalsResponse
}

export function DownloadsDetails({ apiRevision }: { apiRevision: number }) {
  const load = useCallback(async (signal: AbortSignal): Promise<DetailEnvelope<DownloadsDetailData>> => {
    const [downloadsResponse, intervalsResponse] = await Promise.all([
      getDashboardDownloads(signal),
      getDashboardIntervals(signal),
    ])
    if (downloadsResponse.success === false) {
      return { success: false, message: downloadsResponse.message }
    }
    if (intervalsResponse.success === false) {
      return { success: false, message: intervalsResponse.message }
    }
    return {
      data: {
        downloads: downloadsResponse.data ?? {},
        intervals: intervalsResponse.data ?? {},
      },
    }
  }, [])
  const query = useDashboardData(apiRevision, 'downloads', load, 'Downloads', (data) => (
    data?.downloads.generatedAt ?? data?.intervals.generatedAt ?? null
  ))
  const { create, release } = useMutationControllers(apiRevision)
  const [pendingJobs, setPendingJobs] = useState<Record<string, 'cancel' | 'retry'>>({})
  const [intervalDrafts, setIntervalDrafts] = useState<Record<string, string>>({})
  const [intervalError, setIntervalError] = useState<string | null>(null)
  const [mutationFeedback, setMutationFeedback] = useState<string | null>(null)
  const [intervalSaving, setIntervalSaving] = useState(false)

  useEffect(() => {
    const rows = query.data?.intervals.domains ?? []
    setIntervalDrafts((current) => {
      const next = { ...current }
      rows.forEach((row) => {
        const domain = row.domain?.trim()
        if (!domain || domain in current) return
        next[domain] = row.overrideIntervalMs == null ? '' : String(row.overrideIntervalMs)
      })
      return next
    })
  }, [query.data])

  const runJobAction = async (job: DownloadJobDto, action: 'cancel' | 'retry') => {
    const jobId = job.jobId?.trim()
    if (!jobId || pendingJobs[jobId]) return
    const controller = create()
    setPendingJobs((current) => ({ ...current, [jobId]: action }))
    setMutationFeedback(null)
    try {
      if (action === 'cancel') await cancelDashboardJob(jobId, controller.signal)
      else await retryDashboardJob(jobId, controller.signal)
      if (controller.signal.aborted) return
      setMutationFeedback(action === 'cancel' ? 'キャンセル済み' : '再試行済み')
      query.refresh()
    } catch (error: unknown) {
      if (!isAbortError(error, controller.signal)) setMutationFeedback(getMutationError(error))
    } finally {
      release(controller)
      if (!controller.signal.aborted) {
        setPendingJobs((current) => {
          const next = { ...current }
          delete next[jobId]
          return next
        })
      }
    }
  }

  const saveIntervals = async () => {
    if (intervalSaving) return
    const rows = query.data?.intervals.domains ?? []
    const updates: { domain?: string | null; intervalMs?: number | null }[] = []
    for (const row of rows) {
      const domain = row.domain?.trim()
      if (!domain) continue
      const raw = intervalDrafts[domain] ?? ''
      if (!raw.trim()) {
        updates.push({ domain, intervalMs: null })
        continue
      }
      const interval = Number(raw)
      if (!Number.isFinite(interval) || interval < 0) {
        setIntervalError('数値')
        return
      }
      updates.push({ domain, intervalMs: Math.round(interval) })
    }
    const controller = create()
    setIntervalSaving(true)
    setIntervalError(null)
    setMutationFeedback(null)
    try {
      await updateDashboardIntervals({ updates }, controller.signal)
      if (controller.signal.aborted) return
      setIntervalDrafts({})
      setMutationFeedback('保存済み')
      query.refresh()
    } catch (error: unknown) {
      if (!isAbortError(error, controller.signal)) setIntervalError(getMutationError(error))
    } finally {
      release(controller)
      if (!controller.signal.aborted) setIntervalSaving(false)
    }
  }

  const running = query.data?.downloads.running ?? []
  const queued = query.data?.downloads.queued ?? []
  const failed = query.data?.downloads.recentFailed ?? []
  const downloadsData = query.data

  if (!downloadsData) {
    return <DetailFrame title="Downloads" icon={CloudDownload} route="downloads" query={query}>{null}</DetailFrame>
  }

  return (
    <DetailFrame title="Downloads" icon={CloudDownload} route="downloads" query={query}>
      <div className="dashboard-detail__metrics">
        <MetricCard label="実行中" value={formatNumber(running.length)} icon={Activity} tone="info" />
        <MetricCard label="待機" value={formatNumber(queued.length)} icon={CloudDownload} tone="warning" />
        <MetricCard label="失敗" value={formatNumber(failed.length)} icon={CircleAlert} tone="danger" />
      </div>
      <DetailSection title="ジョブ" count={formatNumber(running.length + queued.length + failed.length)}>
        <div className="dashboard-detail__table-wrap" role="region" aria-label="ダウンロードジョブ" tabIndex={0}>
          <table className="dashboard-detail__table">
            <thead><tr><th scope="col">Book</th><th scope="col">状態</th><th scope="col">進捗</th><th scope="col">時刻</th><th scope="col"><span className="sr-only">操作</span></th></tr></thead>
            <tbody>
              {([
                ...running.map((job) => ({ job, group: 'running' as const })),
                ...queued.map((job) => ({ job, group: 'queued' as const })),
                ...failed.map((job) => ({ job, group: 'failed' as const })),
              ]).map(({ job, group }, index) => {
                const id = job.jobId?.trim() || `${group}-${job.bookId ?? index}`
                const status = getJobStatus(job, group)
                const pending = job.jobId ? pendingJobs[job.jobId] : undefined
                return (
                  <tr key={id}>
                    <th scope="row"><span className="dashboard-detail__value-truncate">{getJobName(job)}</span></th>
                    <td><StatusBadge tone={status.tone} icon={status.icon}>{status.label}</StatusBadge></td>
                    <td>
                      {typeof job.progress === 'number'
                        ? <div className="dashboard-detail__progress-cell"><progress max={100} value={clamp(job.progress, 0, 100)} aria-label={`${getJobName(job)}の進捗`} /><span>{formatNumber(Math.round(job.progress))}%</span></div>
                        : '—'}
                    </td>
                    <td><time dateTime={job.startedAt ?? job.finishedAt ?? undefined}>{formatDateTime(job.startedAt ?? job.finishedAt)}</time></td>
                    <td className="dashboard-detail__actions-cell">
                      {(group === 'running' || group === 'queued') && job.jobId && (
                        <button className="icon-button" type="button" aria-label={`${getJobName(job)}をキャンセル`} aria-busy={pending === 'cancel'} disabled={Boolean(pending)} onClick={() => void runJobAction(job, 'cancel')}>
                          {pending === 'cancel' ? <LoaderCircle className="dashboard-detail__spin" size={16} aria-hidden="true" /> : <X size={16} aria-hidden="true" />}
                        </button>
                      )}
                      {group === 'failed' && job.jobId && (
                        <button className="icon-button" type="button" aria-label={`${getJobName(job)}を再試行`} aria-busy={pending === 'retry'} disabled={Boolean(pending)} onClick={() => void runJobAction(job, 'retry')}>
                          {pending === 'retry' ? <LoaderCircle className="dashboard-detail__spin" size={16} aria-hidden="true" /> : <RotateCcw size={16} aria-hidden="true" />}
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {!running.length && !queued.length && !failed.length && <div className="dashboard-detail__empty">—</div>}
        </div>
        {mutationFeedback && <span className="dashboard-detail__feedback" role="status">{mutationFeedback}</span>}
      </DetailSection>
      <DetailSection title="間隔" count={formatNumber(downloadsData.intervals.domains?.length ?? 0)}>
        <div className="dashboard-detail__table-wrap" role="region" aria-label="ドメイン間隔" tabIndex={0}>
          <table className="dashboard-detail__table">
            <thead><tr><th scope="col">Domain</th><th scope="col">標準 ms</th><th scope="col">Override ms</th><th scope="col"><span className="sr-only">状態</span></th></tr></thead>
            <tbody>
              {(downloadsData.intervals.domains ?? []).map((row: DomainIntervalDto, index) => {
                const domain = row.domain?.trim() || `domain-${index}`
                const value = intervalDrafts[domain] ?? (row.overrideIntervalMs == null ? '' : String(row.overrideIntervalMs))
                return (
                  <tr key={domain}>
                    <th scope="row"><span className="dashboard-detail__value-truncate">{domain}</span></th>
                    <td>{formatNumber(row.intervalMs)}</td>
                    <td><input className="dashboard-detail__number-input" type="number" min="0" step="1" inputMode="numeric" aria-label={`${domain} override ms`} value={value} onChange={(event) => setIntervalDrafts((current) => ({ ...current, [domain]: event.target.value }))} /></td>
                    <td>{value.trim() ? <StatusBadge tone="info">適用</StatusBadge> : <StatusBadge tone="muted">未適用</StatusBadge>}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {!downloadsData.intervals.domains?.length && <div className="dashboard-detail__empty">—</div>}
        </div>
        {intervalError && <span className="dashboard-detail__field-error" role="alert">{intervalError}</span>}
        <button className="button button--secondary dashboard-detail__save" type="button" aria-busy={intervalSaving} disabled={intervalSaving} onClick={() => void saveIntervals()}>
          {intervalSaving ? <LoaderCircle className="dashboard-detail__spin" size={15} aria-hidden="true" /> : <Save size={15} aria-hidden="true" />}
          <span>保存</span>
        </button>
      </DetailSection>
    </DetailFrame>
  )
}

export function DataStoreDetails({ apiRevision }: { apiRevision: number }) {
  const load = useCallback((signal: AbortSignal) => getDataStoreDiagnostics(signal), [])
  const query = useDashboardData(apiRevision, 'datastore', load, 'Data Store')
  const data = query.data

  if (!data) {
    return <DetailFrame title="Data Store" icon={Database} route="datastore" query={query}>{null}</DetailFrame>
  }

  const availability = getStatus(data.availability)
  const connected = data.isConnected === true
    ? { label: '接続', tone: 'success' as const, icon: CheckCircle2 }
    : data.isConnected === false
      ? { label: '切断', tone: 'danger' as const, icon: CircleAlert }
      : availability
  const resources = data.resources ?? []
  const statistics = data.statistics

  return (
    <DetailFrame title="Data Store" icon={Database} route="datastore" query={query}>
      <DetailSection title="状態">
        <div className="dashboard-detail__metrics">
          <MetricCard label="接続" value={<StatusBadge tone={connected.tone} icon={connected.icon}>{connected.label}</StatusBadge>} icon={Database} tone={connected.tone} />
          <MetricCard label="Provider" value={data.providerVersion || '—'} icon={Server} tone="info" />
          <MetricCard label="Store" value={data.storeName || '—'} icon={HardDrive} tone="muted" />
        </div>
        <div className="dashboard-detail__meta">
          <StatusBadge tone={availability.tone} icon={availability.icon}>{availability.label}</StatusBadge>
          {data.diagnosticCode && <code>{data.diagnosticCode}</code>}
          {data.topology?.state && <span>{data.topology.state}</span>}
        </div>
        {(data.error || data.topology?.diagnosticCode) && (
          <div className="dashboard-detail__error" role="alert">
            <CircleAlert size={15} aria-hidden="true" />
            <span>{data.error || data.topology?.diagnosticCode}</span>
          </div>
        )}
      </DetailSection>
      <DetailSection title="統計">
        <div className="dashboard-detail__table-wrap" role="region" aria-label="Data Store統計" tabIndex={0}>
          <table className="dashboard-detail__table">
            <tbody>
              <tr><th scope="row">Books</th><td>{formatNumber(statistics?.bookCount)}</td><th scope="row">Tags</th><td>{formatNumber(statistics?.tagCount)}</td></tr>
              <tr><th scope="row">Indexes</th><td>{formatNumber(statistics?.indexCount)}</td><th scope="row">Size</th><td>{formatBytes(statistics?.dataSizeBytes)}</td></tr>
              <tr><th scope="row">Observed</th><td colSpan={3}><time dateTime={statistics?.observedAt ?? undefined}>{formatDateTime(statistics?.observedAt)}</time></td></tr>
            </tbody>
          </table>
        </div>
      </DetailSection>
      <DetailSection title="Resources" count={formatNumber(resources.length)}>
        <div className="dashboard-detail__table-wrap" role="region" aria-label="Data Storeリソース" tabIndex={0}>
          <table className="dashboard-detail__table">
            <thead><tr><th scope="col">Name</th><th scope="col">Records</th><th scope="col">Size</th><th scope="col">Indexes</th><th scope="col">状態</th></tr></thead>
            <tbody>
              {resources.map((resource, index) => {
                const status = getStatus(resource.availability)
                return (
                  <tr key={`${resource.name ?? 'resource'}-${index}`}>
                    <th scope="row">{resource.name || '—'}</th>
                    <td>{formatNumber(resource.recordCount)}</td>
                    <td>{formatBytes(resource.sizeBytes)}</td>
                    <td>{formatNumber(resource.indexCount)}</td>
                    <td><StatusBadge tone={status.tone} icon={status.icon}>{status.label}</StatusBadge></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {!resources.length && <div className="dashboard-detail__empty">—</div>}
        </div>
        {resources.some((resource) => resource.indexes?.length) && (
          <div className="dashboard-detail__table-wrap" role="region" aria-label="Data Storeインデックス" tabIndex={0}>
            <table className="dashboard-detail__table">
              <thead><tr><th scope="col">Resource</th><th scope="col">Index</th><th scope="col">Unique</th><th scope="col">状態</th></tr></thead>
              <tbody>
                {resources.flatMap((resource, resourceIndex) => (resource.indexes ?? []).map((index, indexIndex) => {
                  const status = getStatus(index.availability)
                  return (
                    <tr key={`${resource.name ?? resourceIndex}-${index.name ?? indexIndex}`}>
                      <th scope="row">{resource.name || '—'}</th>
                      <td><span className="dashboard-detail__value-truncate">{index.name || '—'}</span></td>
                      <td>{index.isUnique == null ? '—' : index.isUnique ? 'Yes' : 'No'}</td>
                      <td><StatusBadge tone={status.tone} icon={status.icon}>{status.label}</StatusBadge></td>
                    </tr>
                  )
                }))}
              </tbody>
            </table>
          </div>
        )}
      </DetailSection>
    </DetailFrame>
  )
}

export function DataFolderDetails({ apiRevision }: { apiRevision: number }) {
  const load = useCallback((signal: AbortSignal) => getDataFolderDetails(signal), [])
  const query = useDashboardData(apiRevision, 'datafolder', load, 'DataFolder')
  const data = query.data

  if (!data) {
    return <DetailFrame title="DataFolder" icon={FolderOpen} route="datafolder" query={query}>{null}</DetailFrame>
  }

  const total = typeof data.totalBytes === 'number' && data.totalBytes > 0 ? data.totalBytes : null
  const used = typeof data.usedBytes === 'number' ? data.usedBytes : total !== null && typeof data.freeBytes === 'number' ? total - data.freeBytes : null
  const usageRatio = typeof data.usageRatio === 'number'
    ? clamp(data.usageRatio > 1 ? data.usageRatio / 100 : data.usageRatio, 0, 1)
    : total !== null && used !== null ? clamp(used / total, 0, 1) : null
  const usagePercent = usageRatio === null ? null : Math.round(usageRatio * 100)
  const usageTone: StatusTone = usagePercent !== null && usagePercent >= 90 ? 'danger' : usagePercent !== null && usagePercent >= 75 ? 'warning' : 'success'

  return (
    <DetailFrame title="DataFolder" icon={FolderOpen} route="datafolder" query={query}>
      <DetailSection title="状態">
        <div className="dashboard-detail__metrics">
          <MetricCard label="Path" value={<span className="dashboard-detail__value-truncate">{data.path || '—'}</span>} icon={FolderOpen} tone="info" />
          <MetricCard label="Exists" value={<StatusBadge tone={data.exists === true ? 'success' : data.exists === false ? 'danger' : 'muted'}>{data.exists === true ? '存在' : data.exists === false ? 'なし' : '—'}</StatusBadge>} icon={FolderOpen} tone={data.exists === false ? 'danger' : 'success'} />
          <MetricCard label="Writable" value={<StatusBadge tone={data.isWritable === true ? 'success' : data.isWritable === false ? 'warning' : 'muted'}>{data.isWritable === true ? '書込可' : data.isWritable === false ? '読取専用' : '—'}</StatusBadge>} icon={Save} tone={data.isWritable === false ? 'warning' : 'success'} />
        </div>
      </DetailSection>
      <DetailSection title="容量">
        <div className="dashboard-detail__storage">
          <div className="dashboard-detail__storage-heading">
            <strong>{usagePercent === null ? '—' : `${usagePercent}%`}</strong>
            {usagePercent !== null && <StatusBadge tone={usageTone} icon={usageTone === 'danger' ? CircleAlert : usageTone === 'warning' ? AlertTriangle : CheckCircle2}>{usageTone === 'danger' ? '危険' : usageTone === 'warning' ? '警告' : '正常'}</StatusBadge>}
          </div>
          <div className={`dashboard-detail__progress dashboard-detail__progress--${usageTone}`} role="progressbar" aria-label="使用率" aria-valuemin={0} aria-valuemax={100} aria-valuenow={usagePercent ?? 0} aria-valuetext={usagePercent === null ? '—' : `${usagePercent}%`}>
            <span style={{ width: `${usagePercent ?? 0}%` }} />
          </div>
          <dl className="dashboard-detail__definition-grid">
            <div><dt>Used</dt><dd>{formatBytes(used)}</dd></div>
            <div><dt>Free</dt><dd>{formatBytes(data.freeBytes)}</dd></div>
            <div><dt>Total</dt><dd>{formatBytes(total)}</dd></div>
          </dl>
        </div>
        {data.error && <div className="dashboard-detail__error" role="alert"><CircleAlert size={15} aria-hidden="true" /><span>{data.error}</span></div>}
      </DetailSection>
    </DetailFrame>
  )
}

function ConfirmDialog({
  open,
  title,
  value,
  pending,
  confirmLabel,
  triggerRef,
  onConfirm,
  onDismiss,
}: {
  open: boolean
  title: string
  value?: ReactNode
  pending: boolean
  confirmLabel: string
  triggerRef: RefObject<HTMLElement | null>
  onConfirm: () => void
  onDismiss: () => void
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const descriptionId = `dashboard-detail-dialog-description-${title.replace(/\W/g, '-')}`

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  return (
    <dialog
      ref={dialogRef}
      className="dashboard-detail__dialog"
      aria-labelledby={`${descriptionId}-title`}
      aria-describedby={value ? descriptionId : undefined}
      onCancel={(event) => {
        if (pending) event.preventDefault()
      }}
      onClose={() => {
        onDismiss()
        window.requestAnimationFrame(() => triggerRef.current?.focus())
      }}
    >
      <div className="dashboard-detail__dialog-body">
        <h2 id={`${descriptionId}-title`}>{title}</h2>
        {value && <div id={descriptionId}>{value}</div>}
        <div className="dashboard-detail__dialog-actions">
          <button className="dashboard-detail__button" type="button" disabled={pending} onClick={() => dialogRef.current?.close()}>
            <X size={15} aria-hidden="true" />
            <span>キャンセル</span>
          </button>
          <button className="dashboard-detail__button dashboard-detail__button--danger" type="button" aria-busy={pending} disabled={pending} onClick={onConfirm}>
            {pending ? <LoaderCircle className="dashboard-detail__spin" size={15} aria-hidden="true" /> : <Check size={15} aria-hidden="true" />}
            <span>{pending ? '処理中' : confirmLabel}</span>
          </button>
        </div>
      </div>
    </dialog>
  )
}

type LogLevelFilter = 'All' | 'Information' | 'Warning' | 'Error'

const visibleLogLevel = (level?: string | null) => {
  const normalized = normalize(level)
  if (normalized === 'critical' || normalized === 'fatal') return 'Error'
  if (normalized === 'error' || normalized === 'failed') return 'Error'
  if (normalized === 'warning' || normalized === 'warn') return 'Warning'
  if (normalized === 'information' || normalized === 'info') return 'Information'
  return level?.trim() || '—'
}

export function LogsDetails({ apiRevision }: { apiRevision: number }) {
  const [level, setLevel] = useState<LogLevelFilter>('All')
  const [keyword, setKeyword] = useState('')
  const [autoScroll, setAutoScroll] = useState(true)
  const [clearOpen, setClearOpen] = useState(false)
  const [clearPending, setClearPending] = useState(false)
  const [feedback, setFeedback] = useState<string | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const { create, release } = useMutationControllers(apiRevision)
  const load = useCallback((signal: AbortSignal) => getDashboardLogEntries(0, level === 'All' ? undefined : level, signal), [level])
  const query = useDashboardData(apiRevision, 'logs', load, 'Logs')
  const entries = useMemo(() => {
    const search = keyword.trim().toLocaleLowerCase('ja-JP')
    return (query.data?.entries ?? []).filter((entry) => {
      if (!search) return true
      return [entry.level, entry.category, entry.message, entry.exception].some((value) => value?.toLocaleLowerCase('ja-JP').includes(search))
    })
  }, [keyword, query.data])

  useEffect(() => {
    if (!autoScroll || !listRef.current) return
    listRef.current.scrollTop = listRef.current.scrollHeight
  }, [autoScroll, entries.length, query.data])

  const clearLogs = async () => {
    if (clearPending) return
    const controller = create()
    setClearPending(true)
    setFeedback(null)
    try {
      await clearDashboardLogs(controller.signal)
      if (controller.signal.aborted) return
      setFeedback('クリア済み')
      setClearOpen(false)
      query.refresh()
    } catch (error: unknown) {
      if (!isAbortError(error, controller.signal)) setFeedback(getMutationError(error))
    } finally {
      release(controller)
      if (!controller.signal.aborted) setClearPending(false)
    }
  }

  const data = query.data
  if (!data) {
    return <DetailFrame title="Logs" icon={ListChecks} route="logs" query={query}>{null}</DetailFrame>
  }

  return (
    <DetailFrame title="Logs" icon={ListChecks} route="logs" query={query}>
      <DetailSection title="ログ" count={formatNumber(entries.length)}>
        <div className="dashboard-detail__toolbar">
          <label className="dashboard-detail__filter-label" htmlFor="dashboard-log-level">Level</label>
          <select id="dashboard-log-level" value={level} onChange={(event) => setLevel(event.target.value as LogLevelFilter)}>
            <option value="All">All</option>
            <option value="Information">Information</option>
            <option value="Warning">Warning</option>
            <option value="Error">Error</option>
          </select>
          <label className="dashboard-detail__search-field" htmlFor="dashboard-log-keyword">
            <Search size={14} aria-hidden="true" />
            <span className="sr-only">Keyword</span>
            <input id="dashboard-log-keyword" type="search" value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="Keyword" />
          </label>
          <label className="dashboard-detail__check-label">
            <input type="checkbox" checked={autoScroll} onChange={(event) => setAutoScroll(event.target.checked)} />
            <span>自動スクロール</span>
          </label>
          <button ref={triggerRef} className="dashboard-detail__button dashboard-detail__button--danger" type="button" onClick={() => setClearOpen(true)}>
            <Trash2 size={15} aria-hidden="true" />
            <span>クリア</span>
          </button>
        </div>
        <div ref={listRef} className="dashboard-detail__table-wrap dashboard-detail__log-scroll" role="region" aria-label="ログ一覧" tabIndex={0}>
          <table className="dashboard-detail__table">
            <caption className="sr-only">ログ一覧</caption>
            <thead><tr><th scope="col">時刻</th><th scope="col">Level</th><th scope="col">Category</th><th scope="col">Message</th></tr></thead>
            <tbody>
              {entries.map((entry, index) => {
                const status = getStatus(entry.level)
                return (
                  <tr key={`${entry.sequence ?? 'entry'}-${index}`}>
                    <td><time dateTime={entry.timestamp ?? undefined}>{formatDateTime(entry.timestamp)}</time></td>
                    <td><StatusBadge tone={status.tone} icon={status.icon}>{visibleLogLevel(entry.level)}</StatusBadge></td>
                    <td>{entry.category || '—'}</td>
                    <td>
                      <span className="dashboard-detail__log-message">{entry.message || '—'}</span>
                      {entry.exception && (
                        <details className="dashboard-detail__exception">
                          <summary>例外</summary>
                          <pre>{entry.exception}</pre>
                        </details>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {!entries.length && <div className="dashboard-detail__empty">—</div>}
        </div>
        {feedback && <span className="dashboard-detail__feedback" role="status">{feedback}</span>}
      </DetailSection>
      <ConfirmDialog
        open={clearOpen}
        title="ログ クリア"
        value={<StatusBadge tone="danger" icon={Trash2}>全ログ</StatusBadge>}
        pending={clearPending}
        confirmLabel="クリア"
        triggerRef={triggerRef}
        onConfirm={() => void clearLogs()}
        onDismiss={() => setClearOpen(false)}
      />
    </DetailFrame>
  )
}
