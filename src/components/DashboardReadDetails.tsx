import {
  Activity,
  AlertTriangle,
  Check,
  CheckCircle2,
  CircleAlert,
  Database,
  FileWarning,
  FolderOpen,
  HardDrive,
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
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import { ApiError, getErrorMessage } from '../api'
import {
  clearDashboardLogs,
  getDashboardLogEntries,
  getDataFolderDetails,
  getMongoDbDiagnostics,
} from '../api/dashboard'
import type {
  DashboardApiResponse,
  DashboardLogEntryDto,
  DashboardLogsResponse,
  DataFolderResponse,
  MongoDbDiagnosticsResponse,
} from '../models/dashboard'
import { useVisiblePolling } from '../hooks/use-visible-polling'

type DetailEnvelope<T> = DashboardApiResponse<T>
type DetailLoader<T> = (signal: AbortSignal) => Promise<DetailEnvelope<T>>

type DetailQuery<T> = {
  data: T | null
  error: string | null
  loading: boolean
  refreshing: boolean
  ready: boolean
  announcement: string
  generatedAt: string | null
  refresh: () => Promise<void>
  poll: (signal: AbortSignal) => Promise<void>
  update: (updater: (current: T | null) => T | null) => void
}

type StatusTone = 'success' | 'warning' | 'danger' | 'info' | 'muted'

const formatNumber = (value?: number | null) => (
  typeof value === 'number' && Number.isFinite(value) ? new Intl.NumberFormat('ja-JP').format(value) : '—'
)

const formatBytes = (value?: number | null) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—'
  if (Math.abs(value) < 1024) return `${formatNumber(value)} B`
  const units = ['KB', 'MB', 'GB', 'TB', 'PB']
  let size = Math.abs(value)
  let unit = -1
  while (size >= 1024 && unit < units.length - 1) { size /= 1024; unit += 1 }
  return `${value < 0 ? '-' : ''}${new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 1 }).format(size)} ${units[unit]}`
}

const formatDateTime = (value?: string | null) => {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('ja-JP', { dateStyle: 'short', timeStyle: 'short' }).format(date)
}

const normalize = (value?: string | null) => value?.trim().toLocaleLowerCase('en-US') ?? ''
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

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
      return { label: '実行中', tone: 'info', icon: Activity }
    case 'pending':
    case 'queued':
    case 'idle':
      return { label: '待機', tone: 'muted', icon: Activity }
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
    default:
      return { label: value?.trim() || '—', tone: 'muted', icon: Activity }
  }
}

const mutationError = (error: unknown) => (
  error instanceof ApiError && error.status === 403
    ? 'この変更操作はローカルまたは信頼済みネットワークからのみ実行できます。'
    : getErrorMessage(error)
)

const isAbort = (error: unknown, signal: AbortSignal) => signal.aborted || (
  error instanceof ApiError && error.message.includes('キャンセル')
)

function StatusBadge({ children, tone = 'muted', icon: Icon }: { children: ReactNode; tone?: StatusTone; icon?: LucideIcon }) {
  return <span className={`dashboard-detail__badge dashboard-detail__badge--${tone}`}>{Icon && <Icon size={13} aria-hidden="true" />}<span>{children}</span></span>
}

function DetailSkeleton() {
  return <div className="dashboard-detail__skeleton" aria-hidden="true"><span /><span /><span /></div>
}

function DetailSection({ title, count, children, className = '' }: { title: string; count?: ReactNode; children: ReactNode; className?: string }) {
  return <section className={`dashboard-detail__section ${className}`}><div className="dashboard-detail__section-heading"><h2>{title}</h2>{count !== undefined && <span className="dashboard-detail__count">{count}</span>}</div>{children}</section>
}

function MetricCard({ label, value, icon: Icon, tone = 'muted' }: { label: string; value: ReactNode; icon: LucideIcon; tone?: StatusTone }) {
  return <article className="dashboard-detail__metric"><div className="dashboard-detail__metric-label"><span className={`dashboard-detail__metric-icon dashboard-detail__metric-icon--${tone}`} aria-hidden="true"><Icon size={17} /></span><span>{label}</span></div><strong>{value}</strong></article>
}

function DetailFrame<T>({ title, query, children }: { title: string; query: DetailQuery<T>; children: ReactNode }) {
  return <div className="dashboard-detail__content" aria-busy={query.loading}><p className="dashboard__live-region dashboard-detail__live-region sr-only" role="status" aria-live="polite">{query.announcement}</p><div className="dashboard-detail__meta-line">{query.generatedAt && <time className="dashboard-detail__generated" dateTime={query.generatedAt}>{formatDateTime(query.generatedAt)}</time>}</div>{query.error && <div className="dashboard-detail__inline-error" role="alert"><CircleAlert size={15} aria-hidden="true" /><span>{query.error}</span><button className="icon-button" type="button" aria-label={`${title}を再試行`} onClick={query.refresh} disabled={query.loading}><RotateCcw size={15} aria-hidden="true" /></button></div>}{query.data === null ? query.loading ? <DetailSkeleton /> : <div className="dashboard-detail__empty" role="status"><TriangleAlert size={18} aria-hidden="true" /><span>データなし</span></div> : children}</div>
}

function useDashboardData<T>(apiRevision: number, route: string, load: DetailLoader<T>, title: string, getGeneratedAt?: (data: T | null) => string | null): DetailQuery<T> {
  const requestRef = useRef<AbortController | null>(null)
  const dataRef = useRef<T | null>(null)
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [ready, setReady] = useState(false)
  const [announcement, setAnnouncement] = useState('')

  const refreshInternal = useCallback((reset = false, pollSignal?: AbortSignal): Promise<void> => {
    if (pollSignal?.aborted) return Promise.resolve()
    requestRef.current?.abort()
    const controller = new AbortController()
    requestRef.current = controller
    const hasData = !reset && dataRef.current !== null
    if (reset) { dataRef.current = null; setData(null) }
    if (reset) setReady(false)
    setLoading(true)
    setRefreshing(hasData)
    setError(null)
    setAnnouncement(`${title}${hasData ? 'を更新中' : 'を読み込み中'}`)
    const onPollAbort = pollSignal ? () => controller.abort() : null
    if (pollSignal && onPollAbort) pollSignal.addEventListener('abort', onPollAbort, { once: true })
    return load(controller.signal).then((response) => {
      if (controller.signal.aborted) return
      if (response.success === false) throw new ApiError(response.message ?? `${title}の取得に失敗しました。`, { category: 'server' })
      const next = response.data ?? null
      dataRef.current = next
      setData(next)
      setReady(true)
      setError(null)
      setAnnouncement(`${title}${hasData ? 'を更新' : 'を読み込み'}ました`)
    }).catch((requestError: unknown) => {
      if (isAbort(requestError, controller.signal)) return
      setReady(true)
      setError(getErrorMessage(requestError))
      setAnnouncement(`${title}エラー`)
    }).finally(() => {
      if (pollSignal && onPollAbort) pollSignal.removeEventListener('abort', onPollAbort)
      if (requestRef.current !== controller) return
      requestRef.current = null
      setLoading(false)
      setRefreshing(false)
    })
  }, [load, title])

  const update = useCallback((updater: (current: T | null) => T | null) => {
    setData((current) => {
      const next = updater(current)
      dataRef.current = next
      return next
    })
  }, [])

  useEffect(() => {
    void refreshInternal(true)
    return () => { requestRef.current?.abort(); requestRef.current = null }
  }, [apiRevision, route, refreshInternal])

  const refresh = useCallback(() => refreshInternal(false), [refreshInternal])
  const poll = useCallback((signal: AbortSignal) => refreshInternal(false, signal), [refreshInternal])
  const generatedAt = getGeneratedAt?.(data) ?? (data as (T & { generatedAt?: string | null }) | null)?.generatedAt ?? null
  return { data, error, loading, refreshing, ready, announcement, generatedAt, refresh, poll, update }
}

export function MongoDbDetails({ apiRevision }: { apiRevision: number }) {
  const load = useCallback((signal: AbortSignal) => getMongoDbDiagnostics(signal), [])
  const query = useDashboardData(apiRevision, 'mongodb', load, 'MongoDB')
  const poll = useCallback((signal: AbortSignal) => query.poll(signal), [query.poll])
  useVisiblePolling({ intervalMs: 5_000, enabled: query.ready, poll })
  const data = query.data
  if (!data) return <DetailFrame title="MongoDB" query={query}>{null}</DetailFrame>
  const connection = data.isConnected === true ? { label: '接続', tone: 'success' as const, icon: CheckCircle2 } : data.isConnected === false ? { label: '切断', tone: 'danger' as const, icon: CircleAlert } : getStatus(data.replicaSetState)
  return <DetailFrame title="MongoDB" query={query}><DetailSection title="接続状態"><div className="dashboard-detail__metrics"><MetricCard label="接続" value={<StatusBadge tone={connection.tone} icon={connection.icon}>{connection.label}</StatusBadge>} icon={Database} tone={connection.tone} /><MetricCard label="Server version" value={data.serverVersion || '—'} icon={Server} tone="info" /><MetricCard label="Database" value={data.databaseName || '—'} icon={HardDrive} tone="muted" /><MetricCard label="Replica" value={<StatusBadge tone={getStatus(data.replicaSetState).tone}>{data.replicaSetState || '—'}</StatusBadge>} icon={Database} tone="info" /></div>{data.error && <div className="dashboard-detail__error" role="alert"><CircleAlert size={15} aria-hidden="true" /><span>{data.error}</span></div>}</DetailSection><DetailSection title="Collections" count={formatNumber(data.collections?.length ?? 0)}><div className="dashboard-detail__table-wrap" role="region" aria-label="MongoDBコレクション" tabIndex={0}><table className="dashboard-detail__table"><thead><tr><th scope="col">Name</th><th scope="col">Documents</th><th scope="col">Size</th><th scope="col">Indexes</th></tr></thead><tbody>{(data.collections ?? []).map((collection, index) => <tr key={`${collection.name ?? 'collection'}-${index}`}><th scope="row">{collection.name || '—'}</th><td>{formatNumber(collection.documentCount)}</td><td>{formatBytes(collection.sizeBytes)}</td><td>{formatNumber(collection.indexCount)}</td></tr>)}</tbody></table>{!data.collections?.length && <div className="dashboard-detail__empty">—</div>}</div>{(data.collections ?? []).some((collection) => collection.indexes?.length) && <div className="dashboard-detail__table-wrap" role="region" aria-label="MongoDBインデックス" tabIndex={0}><table className="dashboard-detail__table"><thead><tr><th scope="col">Collection</th><th scope="col">Index</th><th scope="col">Keys</th><th scope="col">Unique</th><th scope="col">Sparse</th></tr></thead><tbody>{(data.collections ?? []).flatMap((collection, collectionIndex) => (collection.indexes ?? []).map((index, indexIndex) => <tr key={`${collection.name ?? collectionIndex}-${index.name ?? indexIndex}`}><th scope="row">{collection.name || '—'}</th><td>{index.name || '—'}</td><td><code className="dashboard-detail__value-truncate">{index.keysJson || '—'}</code></td><td>{index.isUnique ? 'Yes' : 'No'}</td><td>{index.isSparse ? 'Yes' : 'No'}</td></tr>))}</tbody></table></div>}</DetailSection></DetailFrame>
}

/** Backward-compatible export for callers that used the pre-contract name. */
export const DataStoreDetails = MongoDbDetails

export function DataFolderDetails({ apiRevision }: { apiRevision: number }) {
  const load = useCallback((signal: AbortSignal) => getDataFolderDetails(signal), [])
  const query = useDashboardData(apiRevision, 'datafolder', load, 'DataFolder')
  const data = query.data
  if (!data) return <DetailFrame title="DataFolder" query={query}>{null}</DetailFrame>
  const total = typeof data.totalBytes === 'number' && data.totalBytes > 0 ? data.totalBytes : null
  const used = typeof data.usedBytes === 'number' ? data.usedBytes : total !== null && typeof data.freeBytes === 'number' ? total - data.freeBytes : null
  const usageRatio = typeof data.usageRatio === 'number' ? clamp(data.usageRatio > 1 ? data.usageRatio / 100 : data.usageRatio, 0, 1) : total !== null && used !== null ? clamp(used / total, 0, 1) : null
  const percent = usageRatio === null ? null : Math.round(usageRatio * 100)
  const tone: StatusTone = percent !== null && percent >= 90 ? 'danger' : percent !== null && percent >= 75 ? 'warning' : 'success'
  return <DetailFrame title="DataFolder" query={query}><DetailSection title="状態"><div className="dashboard-detail__metrics"><MetricCard label="Path" value={<span className="dashboard-detail__value-truncate">{data.path || '—'}</span>} icon={FolderOpen} tone="info" /><MetricCard label="Exists" value={<StatusBadge tone={data.exists === true ? 'success' : data.exists === false ? 'danger' : 'muted'}>{data.exists === true ? '存在' : data.exists === false ? 'なし' : '—'}</StatusBadge>} icon={FolderOpen} tone="success" /><MetricCard label="Writable" value={<StatusBadge tone={data.isWritable === true ? 'success' : data.isWritable === false ? 'warning' : 'muted'}>{data.isWritable === true ? '書込可' : data.isWritable === false ? '読取専用' : '—'}</StatusBadge>} icon={Save} tone="success" /></div></DetailSection><DetailSection title="容量"><div className="dashboard-detail__storage"><div className="dashboard-detail__storage-heading"><strong>{percent === null ? '—' : `${percent}%`}</strong>{percent !== null && <StatusBadge tone={tone}>{tone === 'danger' ? '危険' : tone === 'warning' ? '警告' : '正常'}</StatusBadge>}</div><div className={`dashboard-detail__progress dashboard-detail__progress--${tone}`} role="progressbar" aria-label="使用率" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent ?? undefined}><span style={{ width: `${percent ?? 0}%` }} /></div><dl className="dashboard-detail__definition-grid"><div><dt>Used</dt><dd>{formatBytes(used)}</dd></div><div><dt>Free</dt><dd>{formatBytes(data.freeBytes)}</dd></div><div><dt>Total</dt><dd>{formatBytes(total)}</dd></div></dl></div>{data.error && <div className="dashboard-detail__error" role="alert"><CircleAlert size={15} aria-hidden="true" /><span>{data.error}</span></div>}</DetailSection></DetailFrame>
}

function ConfirmDialog({ open, title, value, pending, confirmLabel, triggerRef, onConfirm, onDismiss }: { open: boolean; title: string; value?: ReactNode; pending: boolean; confirmLabel: string; triggerRef: RefObject<HTMLElement | null>; onConfirm: () => void; onDismiss: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const dismiss = useCallback(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (typeof dialog.close === 'function') {
      dialog.close()
      return
    }
    dialog.removeAttribute('open')
    onDismiss()
    restoreDialogFocus(triggerRef)
  }, [onDismiss, triggerRef])
  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) {
      if (typeof dialog.showModal === 'function') dialog.showModal()
      else dialog.setAttribute('open', '')
    }
    if (!open && dialog.open) {
      if (typeof dialog.close === 'function') dialog.close()
      else dialog.removeAttribute('open')
    }
  }, [open])
  return <dialog ref={dialogRef} className="dashboard-detail__dialog" aria-labelledby="dashboard-confirm-title" onCancel={(event) => { if (pending) event.preventDefault() }} onClose={() => { onDismiss(); restoreDialogFocus(triggerRef) }}><div className="dashboard-detail__dialog-body"><h2 id="dashboard-confirm-title">{title}</h2>{value && <div>{value}</div>}<div className="dashboard-detail__dialog-actions"><button className="dashboard-detail__button" type="button" disabled={pending} onClick={dismiss}><X size={15} aria-hidden="true" />キャンセル</button><button className="dashboard-detail__button dashboard-detail__button--danger" type="button" aria-busy={pending} disabled={pending} onClick={onConfirm}>{pending ? <LoaderCircle className="dashboard-detail__spin" size={15} aria-hidden="true" /> : <Check size={15} aria-hidden="true" />}{pending ? '処理中' : confirmLabel}</button></div></div></dialog>
}

type LogLevelFilter = 'All' | 'Information' | 'Warning' | 'Error' | 'Critical'
const visibleLogLevel = (level?: string | null) => { const value = normalize(level); if (value === 'critical' || value === 'fatal') return 'Critical'; if (value === 'error' || value === 'failed') return 'Error'; if (value === 'warning' || value === 'warn') return 'Warning'; if (value === 'information' || value === 'info') return 'Information'; return level?.trim() || '—' }
const levelParam = (level: LogLevelFilter): Parameters<typeof getDashboardLogEntries>[1] => level === 'All' ? undefined : level

const mergeLogs = (current: DashboardLogsResponse | null, incoming: DashboardLogsResponse | null, replace = false): DashboardLogsResponse => {
  const entries = replace ? incoming?.entries ?? [] : [...(current?.entries ?? []), ...(incoming?.entries ?? [])]
  const bySequence = new Map<string, DashboardLogEntryDto>()
  entries.forEach((entry, index) => { const key = entry.sequence == null ? `${entry.timestamp ?? ''}-${entry.category ?? ''}-${entry.message ?? ''}-${index}` : String(entry.sequence); bySequence.set(key, entry) })
  const nextEntries = Array.from(bySequence.values()).sort((left, right) => (left.sequence ?? 0) - (right.sequence ?? 0)).slice(-500)
  return { ...(current ?? {}), ...(incoming ?? {}), entries: nextEntries, latestSequence: Math.max(current?.latestSequence ?? 0, incoming?.latestSequence ?? 0, ...nextEntries.map((entry) => entry.sequence ?? 0)) }
}

const restoreDialogFocus = (triggerRef: RefObject<HTMLElement | null>) => {
  const focus = () => triggerRef.current?.focus()
  if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') window.requestAnimationFrame(focus)
  else focus()
}

export function LogsDetails({ apiRevision }: { apiRevision: number }) {
  const [level, setLevel] = useState<LogLevelFilter>('All')
  const [category, setCategory] = useState('All')
  const [keyword, setKeyword] = useState('')
  const [autoScroll, setAutoScroll] = useState(true)
  const [clearOpen, setClearOpen] = useState(false)
  const [clearPending, setClearPending] = useState(false)
  const [feedback, setFeedback] = useState<string | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const clearRef = useRef<AbortController | null>(null)
  const latestSequenceRef = useRef(0)
  const load = useCallback((signal: AbortSignal) => getDashboardLogEntries(0, levelParam(level), signal), [level])
  const query = useDashboardData(apiRevision, 'logs', load, 'Logs')

  useEffect(() => { latestSequenceRef.current = Math.max(query.data?.latestSequence ?? 0, ...(query.data?.entries ?? []).map((entry) => entry.sequence ?? 0)) }, [query.data])
  const poll = useCallback(async (signal: AbortSignal) => {
    if (signal.aborted) return
    try {
      const response = await getDashboardLogEntries(latestSequenceRef.current, levelParam(level), signal)
      if (signal.aborted || response.success === false) return
      query.update((current) => mergeLogs(current, response.data ?? null))
      latestSequenceRef.current = Math.max(latestSequenceRef.current, response.data?.latestSequence ?? 0)
    } catch {
      // The existing Logs view treats a failed incremental poll as transient;
      // the next visible poll or manual refresh can recover it.
    }
  }, [level, query.update])
  useVisiblePolling({ intervalMs: 2_000, enabled: query.ready, poll })
  useEffect(() => () => {
    clearRef.current?.abort()
    clearRef.current = null
  }, [])

  const categories = useMemo(() => ['All', ...Array.from(new Set((query.data?.entries ?? []).map((entry) => entry.category?.trim()).filter((value): value is string => Boolean(value)))).sort((a, b) => a.localeCompare(b))], [query.data])
  const entries = useMemo(() => { const search = keyword.trim().toLocaleLowerCase('ja-JP'); return (query.data?.entries ?? []).filter((entry) => (category === 'All' || entry.category === category) && (!search || [entry.level, entry.category, entry.message, entry.exception].some((value) => value?.toLocaleLowerCase('ja-JP').includes(search)))) }, [category, keyword, query.data])
  useEffect(() => { if (autoScroll && listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight }, [autoScroll, entries.length])

  const clearLogs = async () => {
    if (clearPending) return
    const controller = new AbortController(); clearRef.current = controller; setClearPending(true); setFeedback(null)
    try { const response = await clearDashboardLogs(controller.signal); if (controller.signal.aborted) return; if (response.success === false) throw new ApiError(response.message ?? 'ログのクリアに失敗しました。', { category: 'server' }); setFeedback(response.message ?? 'クリア済み'); setClearOpen(false); latestSequenceRef.current = 0; query.refresh() } catch (error: unknown) { if (!isAbort(error, controller.signal)) setFeedback(mutationError(error)) } finally { if (clearRef.current === controller) clearRef.current = null; if (!controller.signal.aborted) setClearPending(false) }
  }

  const data = query.data
  if (!data) return <DetailFrame title="Logs" query={query}>{null}</DetailFrame>
  return <DetailFrame title="Logs" query={query}><DetailSection title="ログ" count={formatNumber(entries.length)}><div className="dashboard-detail__toolbar"><label className="dashboard-detail__filter-label" htmlFor="dashboard-log-level">Level<select id="dashboard-log-level" value={level} onChange={(event) => setLevel(event.target.value as LogLevelFilter)}><option value="All">All</option><option value="Information">Information</option><option value="Warning">Warning</option><option value="Error">Error</option><option value="Critical">Critical</option></select></label><label className="dashboard-detail__filter-label" htmlFor="dashboard-log-category">Category<select id="dashboard-log-category" value={category} onChange={(event) => setCategory(event.target.value)}>{categories.map((item) => <option value={item} key={item}>{item}</option>)}</select></label><label className="dashboard-detail__search-field" htmlFor="dashboard-log-keyword"><Search size={14} aria-hidden="true" /><span className="sr-only">Keyword</span><input id="dashboard-log-keyword" type="search" value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="Keyword" /></label><label className="dashboard-detail__check-label"><input type="checkbox" checked={autoScroll} onChange={(event) => setAutoScroll(event.target.checked)} />自動スクロール</label><button ref={triggerRef} className="dashboard-detail__button dashboard-detail__button--danger" type="button" onClick={() => setClearOpen(true)}><Trash2 size={15} aria-hidden="true" />クリア</button></div><div ref={listRef} className="dashboard-detail__table-wrap dashboard-detail__log-scroll" role="region" aria-label="ログ一覧" tabIndex={0}><table className="dashboard-detail__table"><caption className="sr-only">ログ一覧</caption><thead><tr><th scope="col">時刻</th><th scope="col">Level</th><th scope="col">Category</th><th scope="col">Message</th></tr></thead><tbody>{entries.map((entry, index) => { const status = getStatus(entry.level); return <tr key={`${entry.sequence ?? 'entry'}-${index}`}><td><time dateTime={entry.timestamp ?? undefined}>{formatDateTime(entry.timestamp)}</time></td><td><StatusBadge tone={status.tone} icon={status.icon}>{visibleLogLevel(entry.level)}</StatusBadge></td><td>{entry.category || '—'}</td><td><span className="dashboard-detail__log-message">{entry.message || '—'}</span>{entry.exception && <details className="dashboard-detail__exception"><summary>例外</summary><pre>{entry.exception}</pre></details>}</td></tr> })}</tbody></table>{!entries.length && <div className="dashboard-detail__empty">—</div>}</div>{feedback && <span className="dashboard-detail__feedback" role="status">{feedback}</span>}</DetailSection><ConfirmDialog open={clearOpen} title="ログ クリア" value={<StatusBadge tone="danger" icon={Trash2}>全ログ</StatusBadge>} pending={clearPending} confirmLabel="クリア" triggerRef={triggerRef} onConfirm={() => void clearLogs()} onDismiss={() => setClearOpen(false)} /></DetailFrame>
}
