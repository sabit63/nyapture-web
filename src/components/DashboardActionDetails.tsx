import {
  Activity,
  Check,
  CheckCircle2,
  CircleAlert,
  Gauge,
  HardDrive,
  LoaderCircle,
  Pause,
  Play,
  RefreshCw,
  Save,
  Server,
  ShieldAlert,
  Trash2,
  TriangleAlert,
  X,
} from 'lucide-react'
import type { FormEvent, ReactNode, RefObject } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError, getErrorMessage } from '../api'
import {
  cancelMaintenance,
  clearDashboardCache,
  getCacheMetrics,
  getMaintenance,
  getMaintenanceIssues,
  getMaintenanceRun,
  getServiceConfig,
  pauseMaintenance,
  removeDashboardBookCache,
  resumeMaintenance,
  startMaintenance,
  testService,
  updateMaintenanceSchedule,
  updateServiceConfig,
} from '../api/dashboard'
import type { DashboardService, ServiceConfigResponse } from '../api/dashboard'
import type {
  CacheMetricsResponse,
  ConnectionTestResult,
  DashboardApiResponse,
  DashboardMaintenanceResponse,
  MaintenanceCheckResultDetailDto,
  MaintenanceHistoryEntryDto,
  MaintenanceIssueDto,
  MaintenanceRunDetailResponse,
  MaintenanceStorageSyncMode,
} from '../models/dashboard'
import { useVisiblePolling } from '../hooks/use-visible-polling'

type DetailStatus = 'idle' | 'loading' | 'refreshing' | 'success' | 'error'
type MutationStatus = 'idle' | 'pending' | 'success' | 'error'
type MaintenanceAction = 'run' | 'cancel' | 'pause' | 'resume' | null
type MaintenanceMutation = Exclude<MaintenanceAction, 'run' | null>

const EMPTY_SERVICE = {} as ServiceConfigResponse
const EMPTY_MAINTENANCE = {} as DashboardMaintenanceResponse
const EMPTY_CACHE = {} as CacheMetricsResponse

const formatNumber = (value?: number | null) => typeof value === 'number' && Number.isFinite(value) ? new Intl.NumberFormat('ja-JP').format(value) : '—'
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
const textValue = (value?: string | number | boolean | null) => value === undefined || value === null || value === '' ? '—' : String(value)
const normalize = (value?: string | null) => value?.trim().toLocaleLowerCase('en-US') ?? ''

const getStatus = (value?: string | null) => {
  const normalized = normalize(value)
  if (['success', 'succeeded', 'ok', 'healthy', 'passed', 'pass', 'completed', 'complete'].includes(normalized)) return { label: '正常', tone: 'success' as const, icon: CheckCircle2 }
  if (['running', 'processing'].includes(normalized)) return { label: '実行中', tone: 'info' as const, icon: Activity }
  if (['pending', 'queued', 'idle'].includes(normalized)) return { label: '待機', tone: 'muted' as const, icon: Activity }
  if (normalized === 'paused') return { label: '一時停止', tone: 'warning' as const, icon: Pause }
  if (['warning', 'warn', 'degraded', 'throttled'].includes(normalized)) return { label: '警告', tone: 'warning' as const, icon: TriangleAlert }
  if (['error', 'failed', 'failure', 'unavailable', 'disconnected', 'critical', 'fatal'].includes(normalized)) return { label: 'エラー', tone: 'danger' as const, icon: CircleAlert }
  return { label: value?.trim() || '—', tone: 'muted' as const, icon: Activity }
}

const mutationError = (error: unknown) => error instanceof ApiError && error.status === 403
  ? 'この変更操作はローカルまたは信頼済みネットワークからのみ実行できます。'
  : getErrorMessage(error)
const isAbort = (error: unknown, signal: AbortSignal) => signal.aborted || error instanceof ApiError && error.message.includes('キャンセル')

function StatusBadge({ children, tone = 'muted', icon: Icon }: { children: ReactNode; tone?: 'success' | 'warning' | 'danger' | 'info' | 'muted'; icon?: typeof Activity }) {
  return <span className={`dashboard-detail__badge dashboard-detail__badge--${tone}`}>{Icon && <Icon size={13} aria-hidden="true" />}<span>{children}</span></span>
}

function DetailSkeleton() { return <div className="dashboard-detail__loading" aria-hidden="true"><span className="dashboard-detail__spinner" /></div> }
function DetailState({ status, error, onRetry }: { status: DetailStatus; error: string | null; onRetry: () => void }) {
  if (status === 'loading') return <DetailSkeleton />
  if (!error) return null
  return <div className="dashboard-detail__error" role="alert"><CircleAlert size={15} aria-hidden="true" /><span>{error}</span><button className="dashboard-detail__button" type="button" aria-label="再試行" onClick={onRetry} disabled={status === 'refreshing'}><RefreshCw size={14} aria-hidden="true" /></button></div>
}
function DetailSection({ title, count, children }: { title: string; count?: ReactNode; children: ReactNode }) { return <section className="dashboard-detail__section"><div className="dashboard-detail__section-heading"><h2>{title}</h2>{count !== undefined && <span className="dashboard-detail__count">{count}</span>}</div>{children}</section> }
function ActionFeedback({ status, message }: { status: MutationStatus; message: string | null }) { if (!message && status !== 'pending') return null; return <span className="dashboard-detail__feedback" role="status" aria-live="polite">{status === 'pending' && <LoaderCircle className="dashboard-detail__spin" size={14} aria-hidden="true" />}{status === 'success' && <Check size={14} aria-hidden="true" />}{status === 'error' && <CircleAlert size={14} aria-hidden="true" />}<span>{status === 'pending' ? '処理中' : message}</span></span> }

type ResourceQuery<T> = { data: T | null; status: DetailStatus; error: string | null; ready: boolean; refresh: () => Promise<void>; poll: (signal: AbortSignal) => Promise<void>; update: (updater: (current: T | null) => T | null) => void; generatedAt: string | null }
function useResource<T>(apiRevision: number, route: string, title: string, load: (signal: AbortSignal) => Promise<DashboardApiResponse<T>>): ResourceQuery<T> {
  const [data, setData] = useState<T | null>(null)
  const dataRef = useRef<T | null>(null)
  const requestRef = useRef<AbortController | null>(null)
  const [status, setStatus] = useState<DetailStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  const [generatedAt, setGeneratedAt] = useState<string | null>(null)
  const refreshInternal = useCallback((reset = false, pollSignal?: AbortSignal): Promise<void> => {
    if (pollSignal?.aborted) return Promise.resolve()
    requestRef.current?.abort()
    const controller = new AbortController(); requestRef.current = controller
    const hasData = dataRef.current !== null
    if (reset) setReady(false)
    setStatus(hasData ? 'refreshing' : 'loading'); setError(null)
    const onPollAbort = pollSignal ? () => controller.abort() : null
    if (pollSignal && onPollAbort) pollSignal.addEventListener('abort', onPollAbort, { once: true })
    return load(controller.signal).then((response) => { if (controller.signal.aborted) return; if (response.success === false) throw new ApiError(response.message ?? `${title}の取得に失敗しました。`, { category: 'server' }); const next = response.data ?? null; dataRef.current = next; setData(next); setGeneratedAt((next as { generatedAt?: string | null } | null)?.generatedAt ?? null); setReady(true); setStatus('success') }).catch((requestError: unknown) => { if (!isAbort(requestError, controller.signal)) { setReady(true); setStatus(hasData ? 'success' : 'error'); setError(getErrorMessage(requestError)) } }).finally(() => { if (pollSignal && onPollAbort) pollSignal.removeEventListener('abort', onPollAbort); if (requestRef.current === controller) { requestRef.current = null; if (pollSignal?.aborted && hasData) setStatus('success') } })
  }, [load, title])
  const update = useCallback((updater: (current: T | null) => T | null) => { setData((current) => { const next = updater(current); dataRef.current = next; setGeneratedAt((next as { generatedAt?: string | null } | null)?.generatedAt ?? null); return next }) }, [])
  useEffect(() => { void refreshInternal(true); return () => { requestRef.current?.abort(); requestRef.current = null } }, [apiRevision, route, refreshInternal])
  const refresh = useCallback(() => refreshInternal(false), [refreshInternal])
  const poll = useCallback((signal: AbortSignal) => refreshInternal(false, signal), [refreshInternal])
  return { data, status, error, ready, refresh, poll, update, generatedAt }
}

function useMutationControllers(apiRevision: number) {
  const controllers = useRef(new Set<AbortController>())
  const create = useCallback(() => { const controller = new AbortController(); controllers.current.add(controller); return controller }, [])
  const release = useCallback((controller: AbortController) => controllers.current.delete(controller), [])
  useEffect(() => () => { controllers.current.forEach((controller) => controller.abort()); controllers.current.clear() }, [apiRevision])
  return { create, release }
}

const serviceName = (service: DashboardService) => service === 'webpilot' ? 'WebPilot' : 'ImageWorker'

export function ServiceDetails({ service, apiRevision }: { service: DashboardService; apiRevision: number }) {
  const [config, setConfig] = useState<ServiceConfigResponse | null>(null)
  const configRef = useRef<ServiceConfigResponse | null>(null)
  const [status, setStatus] = useState<DetailStatus>('loading')
  const [error, setError] = useState<string | null>(null)
  const [reload, setReload] = useState(0)
  const [baseUrl, setBaseUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [keyTouched, setKeyTouched] = useState(false)
  const [saveStatus, setSaveStatus] = useState<MutationStatus>('idle')
  const [saveMessage, setSaveMessage] = useState<string | null>(null)
  const [testStatus, setTestStatus] = useState<MutationStatus>('idle')
  const [testMessage, setTestMessage] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<ConnectionTestResult | null>(null)
  const controllers = useRef(new Set<AbortController>())
  const title = serviceName(service)

  useEffect(() => { const controller = new AbortController(); setStatus(configRef.current ? 'refreshing' : 'loading'); setError(null); void getServiceConfig(service, controller.signal).then((response) => { if (controller.signal.aborted) return; if (response.success === false) throw new ApiError(response.message ?? `${title}を取得できませんでした。`, { category: 'server' }); const next = response.data ?? EMPTY_SERVICE; configRef.current = next; setConfig(next); setBaseUrl(next.baseUrl ?? ''); setApiKey(''); setKeyTouched(false); setTestResult(next.lastTestResult ?? null); setStatus('success') }).catch((requestError: unknown) => { if (!isAbort(requestError, controller.signal)) { setStatus(configRef.current ? 'success' : 'error'); setError(getErrorMessage(requestError)) } }); return () => controller.abort() }, [apiRevision, reload, service, title])
  useEffect(() => () => { controllers.current.forEach((controller) => controller.abort()); controllers.current.clear() }, [apiRevision, service])

  const create = () => { const controller = new AbortController(); controllers.current.add(controller); return controller }
  const release = (controller: AbortController) => controllers.current.delete(controller)
  const dirty = Boolean(config) && (baseUrl !== (config?.baseUrl ?? '') || keyTouched)
  const save = async (event: FormEvent) => { event.preventDefault(); if (saveStatus === 'pending') return; const controller = create(); setSaveStatus('pending'); setSaveMessage(null); try { const response = await updateServiceConfig(service, { baseUrl: baseUrl.trim(), apiKey: keyTouched ? apiKey : undefined }, controller.signal); if (controller.signal.aborted) return; if (response.success === false) throw new ApiError(response.message ?? '保存に失敗しました。', { category: 'server' }); setSaveStatus('success'); setSaveMessage(response.message ?? '保存済み'); setReload((current) => current + 1) } catch (requestError: unknown) { if (!isAbort(requestError, controller.signal)) { setSaveStatus('error'); setSaveMessage(mutationError(requestError)) } } finally { release(controller); if (!controller.signal.aborted) setSaveStatus((current) => current === 'pending' ? 'idle' : current) } }
  const test = async () => { if (testStatus === 'pending') return; const controller = create(); setTestStatus('pending'); setTestMessage(null); try { const response = await testService(service, controller.signal); if (controller.signal.aborted) return; if (response.success === false) throw new ApiError(response.message ?? '疎通テストに失敗しました。', { category: 'server' }); setTestResult(response.data ?? null); setTestStatus('success'); setTestMessage(response.message ?? '疎通テスト完了') } catch (requestError: unknown) { if (!isAbort(requestError, controller.signal)) { setTestStatus('error'); setTestMessage(mutationError(requestError)) } } finally { release(controller); if (!controller.signal.aborted) setTestStatus((current) => current === 'pending' ? 'idle' : current) } }

  if (status === 'loading') return <DetailSkeleton />
  return <div className="dashboard-detail__content" aria-busy={status === 'refreshing'}><div className="dashboard-detail__toolbar"><StatusBadge tone={config?.isApiKeyConfigured ? 'success' : 'muted'} icon={Server}>{config?.isApiKeyConfigured ? 'API key 設定済み' : 'API key 未設定'}</StatusBadge>{dirty && <StatusBadge tone="warning">未保存</StatusBadge>}<button className="dashboard-detail__button" type="button" aria-label={`${title}を更新`} onClick={() => setReload((current) => current + 1)} disabled={status === 'refreshing'}><RefreshCw size={14} aria-hidden="true" /></button></div><DetailState status={status} error={error} onRetry={() => setReload((current) => current + 1)} /><form className="dashboard-detail__form" onSubmit={(event) => void save(event)}><div className="dashboard-detail__form-grid"><label>Base URL<input type="url" value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} /></label><label>API key<input type="text" autoComplete="off" spellCheck={false} value={apiKey} onChange={(event) => { setApiKey(event.target.value); setKeyTouched(true) }} /></label></div><div className="dashboard-detail__form-actions"><button className="dashboard-detail__button dashboard-detail__button--primary" type="submit" disabled={!dirty || saveStatus === 'pending'} aria-busy={saveStatus === 'pending'}>{saveStatus === 'pending' ? <LoaderCircle className="dashboard-detail__spin" size={15} aria-hidden="true" /> : <Save size={15} aria-hidden="true" />}保存</button><button className="dashboard-detail__button" type="button" onClick={() => void test()} disabled={testStatus === 'pending'} aria-busy={testStatus === 'pending'}>{testStatus === 'pending' ? <LoaderCircle className="dashboard-detail__spin" size={15} aria-hidden="true" /> : <Activity size={15} aria-hidden="true" />}テスト</button><ActionFeedback status={saveStatus} message={saveMessage} /><ActionFeedback status={testStatus} message={testMessage} /></div></form><DetailSection title="現在"><dl className="dashboard-detail__grid"><div className="dashboard-detail__metric"><dt>Base URL</dt><dd>{textValue(config?.baseUrl)}</dd></div><div className="dashboard-detail__metric"><dt>API key</dt><dd>{config?.isApiKeyConfigured ? '設定済み' : '未設定'}</dd></div><div className="dashboard-detail__metric"><dt>変更</dt><dd>{formatDateTime(config?.lastModified)}</dd></div></dl></DetailSection><DetailSection title="接続"><div className="dashboard-detail__status-row">{testResult ? <>{testResult.success ? <StatusBadge tone="success" icon={CheckCircle2}>正常</StatusBadge> : <StatusBadge tone="danger" icon={CircleAlert}>失敗</StatusBadge>}<span>{testResult.statusCode ?? '—'}</span><span>{testResult.latencyMs == null ? '—' : `${formatNumber(testResult.latencyMs)} ms`}</span><span>{textValue(testResult.message)}</span></> : <span className="dashboard-detail__empty">—</span>}</div></DetailSection></div>
}

const numericDraft = (value?: number | null) => value == null ? '' : String(value)
const parseNumeric = (value: string, minimum = 0) => { if (!value.trim()) return null; const parsed = Number(value); return Number.isFinite(parsed) && parsed >= minimum ? parsed : undefined }
const issueInResult = (result: MaintenanceCheckResultDetailDto | null | undefined) => ['warning', 'warn', 'error', 'failed', 'failure'].includes(normalize(result?.status)) || Object.keys(result?.issuePages ?? {}).length > 0
const restoreDialogFocus = (triggerRef?: RefObject<HTMLElement | null>) => {
  const focus = () => triggerRef?.current?.focus()
  if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') window.requestAnimationFrame(focus)
  else focus()
}

function ActionDialog({ open, title, value, pending, confirmLabel, triggerRef, onConfirm, onDismiss }: { open: boolean; title: string; value?: ReactNode; pending: boolean; confirmLabel: string; triggerRef?: RefObject<HTMLElement | null>; onConfirm: () => void; onDismiss: () => void }) {
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
  return <dialog ref={dialogRef} className="dashboard-detail__dialog" aria-labelledby="dashboard-action-dialog-title" onCancel={(event) => { if (pending) event.preventDefault(); else onDismiss() }} onClose={() => { onDismiss(); restoreDialogFocus(triggerRef) }}><div className="dashboard-detail__dialog-body"><h2 id="dashboard-action-dialog-title">{title}</h2>{value && <div>{value}</div>}<div className="dashboard-detail__dialog-actions"><button className="dashboard-detail__button" type="button" disabled={pending} onClick={dismiss}><X size={15} aria-hidden="true" />キャンセル</button><button className="dashboard-detail__button dashboard-detail__button--primary" type="button" aria-busy={pending} disabled={pending} onClick={onConfirm}>{pending ? <LoaderCircle className="dashboard-detail__spin" size={15} aria-hidden="true" /> : <Check size={15} aria-hidden="true" />}{pending ? '処理中' : confirmLabel}</button></div></div></dialog>
}

function BookCacheDialog({ open, pending, bookId, triggerRef, onBookIdChange, onSubmit, onDismiss }: { open: boolean; pending: boolean; bookId: string; triggerRef: RefObject<HTMLElement | null>; onBookIdChange: (value: string) => void; onSubmit: (event: FormEvent) => void; onDismiss: () => void }) {
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
  return <dialog ref={dialogRef} className="dashboard-detail__dialog" aria-labelledby="cache-remove-dialog-title" onCancel={(event) => { if (pending) event.preventDefault(); else onDismiss() }} onClose={() => { onDismiss(); restoreDialogFocus(triggerRef) }}><form className="dashboard-detail__dialog-body" onSubmit={onSubmit}><h2 id="cache-remove-dialog-title">Cache 個別削除</h2><p>BookIdだけを指定します。</p><label>BookId<input value={bookId} onChange={(event) => onBookIdChange(event.target.value)} required /></label><div className="dashboard-detail__dialog-actions"><button className="dashboard-detail__button" type="button" onClick={dismiss} disabled={pending}>キャンセル</button><button className="dashboard-detail__button dashboard-detail__button--danger" type="submit" disabled={pending} aria-busy={pending}>{pending ? <LoaderCircle className="dashboard-detail__spin" size={14} aria-hidden="true" /> : <Trash2 size={14} aria-hidden="true" />}削除</button></div></form></dialog>
}

function RunDetail({ data, filter }: { data: MaintenanceRunDetailResponse; filter: 'all' | 'issues' }) {
  const run = data.run
  const tasks = (data.tasks ?? []).filter((task) => filter === 'all' || Object.values(task.checkResults ?? {}).some(issueInResult))
  return <div className="dashboard-detail__stack">{run && <div className="dashboard-detail__meta"><StatusBadge tone={getStatus(run.status).tone} icon={getStatus(run.status).icon}>{textValue(run.status)}</StatusBadge><span>{textValue(run.storageSyncMode)}</span><span>{formatNumber(run.processedBooks)} / {formatNumber(run.totalBooks)}</span></div>}{run?.results && <ul className="dashboard-detail__task-list">{Object.entries(run.results).map(([name, result]) => result && <li className="dashboard-detail__task" key={name}><strong>{name}</strong><span>OK {formatNumber(result.ok)}</span><span>Warning {formatNumber(result.warning)}</span><span>Error {formatNumber(result.error)}</span><span>Skipped {formatNumber(result.skipped)}</span><span>Repaired {formatNumber(result.repaired)}</span></li>)}</ul>}<ul className="dashboard-detail__task-list">{tasks.map((task, index) => <li className="dashboard-detail__task" key={`${task.groupId}-${task.bookId}-${index}`}><div className="dashboard-detail__meta"><code>{textValue(task.groupId)}</code><code>{textValue(task.bookId)}</code><StatusBadge tone={getStatus(task.status).tone} icon={getStatus(task.status).icon}>{textValue(task.status)}</StatusBadge></div><span>{formatDateTime(task.completedAt)}</span>{task.checkResults && <ul className="dashboard-detail__issue-list">{Object.entries(task.checkResults).map(([name, result]) => result && <li key={name}><span>{name}</span><StatusBadge tone={getStatus(result.status).tone}>{textValue(result.status)}</StatusBadge><span>{textValue(result.message)}</span></li>)}</ul>}</li>)}</ul>{!tasks.length && <span className="dashboard-detail__empty">—</span>}</div>
}

export function MaintenanceDetails({ apiRevision }: { apiRevision: number }) {
  const [snapshot, setSnapshot] = useState<DashboardMaintenanceResponse | null>(null)
  const snapshotRef = useRef<DashboardMaintenanceResponse | null>(null)
  const [issues, setIssues] = useState<MaintenanceIssueDto[]>([])
  const [status, setStatus] = useState<DetailStatus>('loading')
  const [error, setError] = useState<string | null>(null)
  const [issueError, setIssueError] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  const [reload, setReload] = useState(0)
  const [intervalMinutes, setIntervalMinutes] = useState('')
  const [cpuThreshold, setCpuThreshold] = useState('')
  const [scheduleStatus, setScheduleStatus] = useState<MutationStatus>('idle')
  const [scheduleMessage, setScheduleMessage] = useState<string | null>(null)
  const [action, setAction] = useState<MaintenanceAction>(null)
  const [actionStatus, setActionStatus] = useState<MutationStatus>('idle')
  const [actionMessage, setActionMessage] = useState<string | null>(null)
  const [runMode, setRunMode] = useState<MaintenanceStorageSyncMode | null>(null)
  const [expandedRun, setExpandedRun] = useState<string | null>(null)
  const [runDetails, setRunDetails] = useState<Record<string, MaintenanceRunDetailResponse>>({})
  const [runLoading, setRunLoading] = useState<string | null>(null)
  const [runErrors, setRunErrors] = useState<Record<string, string>>({})
  const [taskFilter, setTaskFilter] = useState<'all' | 'issues'>('all')
  const controllers = useRef(new Set<AbortController>())
  const detailControllers = useRef(new Map<string, AbortController>())
  const readController = useRef<AbortController | null>(null)
  const runTriggerRef = useRef<HTMLButtonElement>(null)
  const create = () => { const controller = new AbortController(); controllers.current.add(controller); return controller }
  const release = (controller: AbortController) => controllers.current.delete(controller)

  useEffect(() => { snapshotRef.current = snapshot }, [snapshot])
  useEffect(() => () => { readController.current?.abort(); controllers.current.forEach((controller) => controller.abort()); controllers.current.clear(); detailControllers.current.forEach((controller) => controller.abort()); detailControllers.current.clear() }, [apiRevision])
  const reloadData = useCallback((pollSignal?: AbortSignal, reset = false): Promise<void> => {
    if (pollSignal?.aborted) return Promise.resolve()
    readController.current?.abort()
    const controller = create()
    readController.current = controller
    if (reset) setReady(false)
    setStatus(snapshotRef.current ? 'refreshing' : 'loading')
    setError(null)
    setIssueError(null)
    const onPollAbort = pollSignal ? () => controller.abort() : null
    if (pollSignal && onPollAbort) pollSignal.addEventListener('abort', onPollAbort, { once: true })
    return Promise.allSettled([getMaintenance(controller.signal), getMaintenanceIssues(controller.signal)]).then(([maintenanceResult, issueResult]) => {
      if (controller.signal.aborted) return
      if (maintenanceResult.status === 'fulfilled' && maintenanceResult.value.success !== false) {
        const next = maintenanceResult.value.data ?? EMPTY_MAINTENANCE
        snapshotRef.current = next
        setSnapshot(next)
        setIntervalMinutes(numericDraft(next.schedule?.intervalMinutes))
        setCpuThreshold(numericDraft(next.schedule?.cpuThreshold))
      } else if (!snapshotRef.current) {
        setError(maintenanceResult.status === 'rejected' ? getErrorMessage(maintenanceResult.reason) : maintenanceResult.value.message ?? 'Maintenanceを取得できませんでした。')
      }
      if (issueResult.status === 'fulfilled' && issueResult.value.success !== false) setIssues(issueResult.value.data?.issues ?? [])
      else setIssueError(issueResult.status === 'rejected' ? getErrorMessage(issueResult.reason) : issueResult.value.message ?? '問題一覧を取得できませんでした。')
      if (maintenanceResult.status === 'fulfilled' && maintenanceResult.value.success !== false) setStatus('success')
      else if (snapshotRef.current) setStatus('success')
      else setStatus('error')
    }).finally(() => {
      if (pollSignal && onPollAbort) pollSignal.removeEventListener('abort', onPollAbort)
      release(controller)
      if (readController.current === controller) readController.current = null
      if (!controller.signal.aborted) setReady(true)
    })
  }, [])
  useEffect(() => { void reloadData(undefined, true); return () => { controllers.current.forEach((controller) => controller.abort()) } }, [apiRevision, reload, reloadData])
  const poll = useCallback((signal: AbortSignal) => {
    const activeRead = readController.current
    return activeRead && !activeRead.signal.aborted ? Promise.resolve() : reloadData(signal)
  }, [reloadData])
  useVisiblePolling({ intervalMs: 5_000, enabled: ready, poll })

  const mutate = async (kind: MaintenanceMutation) => { if (action) return; const controller = create(); setAction(kind); setActionStatus('pending'); setActionMessage(null); try { const response = kind === 'cancel' ? await cancelMaintenance(controller.signal) : kind === 'pause' ? await pauseMaintenance(controller.signal) : await resumeMaintenance(controller.signal); if (controller.signal.aborted) return; if (response.success === false) throw new ApiError(response.message ?? '操作に失敗しました。', { category: 'server' }); setActionStatus('success'); setActionMessage(response.message ?? response.data?.message ?? '完了'); setReload((current) => current + 1) } catch (requestError: unknown) { if (!isAbort(requestError, controller.signal)) { setActionStatus('error'); setActionMessage(mutationError(requestError)) } } finally { release(controller); if (!controller.signal.aborted) setAction(null) } }
  const run = async () => { if (!runMode || action) return; const mode = runMode; setRunMode(null); const controller = create(); setAction('run'); setActionStatus('pending'); setActionMessage(null); try { const response = await startMaintenance(mode, controller.signal); if (controller.signal.aborted) return; if (response.success === false) throw new ApiError(response.message ?? '開始に失敗しました。', { category: 'server' }); setActionStatus('success'); setActionMessage(response.message ?? response.data?.message ?? '開始済み'); setReload((current) => current + 1) } catch (requestError: unknown) { if (!isAbort(requestError, controller.signal)) { setActionStatus('error'); setActionMessage(mutationError(requestError)) } } finally { release(controller); if (!controller.signal.aborted) setAction(null) } }
  const saveSchedule = async (event: FormEvent) => { event.preventDefault(); if (scheduleStatus === 'pending') return; const interval = parseNumeric(intervalMinutes, 1); const cpu = parseNumeric(cpuThreshold, 0); if (interval === undefined || cpu === undefined || (cpu !== null && cpu > 100)) { setScheduleStatus('error'); setScheduleMessage('間隔は1以上、CPU閾値は0〜100で入力してください。'); return } const controller = create(); setScheduleStatus('pending'); setScheduleMessage(null); try { const response = await updateMaintenanceSchedule({ intervalMinutes: interval, cpuThreshold: cpu }, controller.signal); if (controller.signal.aborted) return; if (response.success === false) throw new ApiError(response.message ?? '保存に失敗しました。', { category: 'server' }); setScheduleStatus('success'); setScheduleMessage(response.message ?? '保存済み'); setReload((current) => current + 1) } catch (requestError: unknown) { if (!isAbort(requestError, controller.signal)) { setScheduleStatus('error'); setScheduleMessage(mutationError(requestError)) } } finally { release(controller); if (!controller.signal.aborted) setScheduleStatus((current) => current === 'pending' ? 'idle' : current) } }
  const loadRun = (runId: string) => { if (expandedRun === runId) { setExpandedRun(null); return } setExpandedRun(runId); if (runDetails[runId] || runLoading === runId) return; const controller = new AbortController(); detailControllers.current.set(runId, controller); setRunLoading(runId); void getMaintenanceRun(runId, controller.signal).then((response) => { if (controller.signal.aborted) return; if (response.success === false) throw new ApiError(response.message ?? '履歴詳細を取得できませんでした。', { category: 'server' }); setRunDetails((current) => ({ ...current, [runId]: response.data ?? ({} as MaintenanceRunDetailResponse) })) }).catch((requestError: unknown) => { if (!isAbort(requestError, controller.signal)) setRunErrors((current) => ({ ...current, [runId]: getErrorMessage(requestError) })) }).finally(() => { detailControllers.current.delete(runId); if (!controller.signal.aborted) setRunLoading(null) }) }

  if (status === 'loading') return <DetailSkeleton />
  const running = Boolean(snapshot?.isRunning)
  const paused = Boolean(snapshot?.isPaused)
  const busy = action !== null
  return <div className="dashboard-detail__content" aria-busy={status === 'refreshing'}><div className="dashboard-detail__toolbar"><StatusBadge tone={running ? 'info' : 'muted'} icon={running ? Activity : CheckCircle2}>{running ? '実行中' : '停止'}</StatusBadge><StatusBadge tone={paused ? 'warning' : 'muted'} icon={Pause}>{paused ? 'Paused' : 'Not paused'}</StatusBadge><StatusBadge tone={snapshot?.isThrottled ? 'warning' : 'muted'} icon={Gauge}>{snapshot?.isThrottled ? 'Throttled' : 'Not throttled'}</StatusBadge><span>Run {textValue(snapshot?.currentRunId)}</span><span>{formatNumber(snapshot?.currentProcessedBooks)} books</span><span>CPU {snapshot?.currentCpuUsage == null ? '—' : `${formatNumber(snapshot.currentCpuUsage)}%`}</span><button className="dashboard-detail__button" type="button" aria-label="Maintenanceを更新" onClick={() => setReload((current) => current + 1)} disabled={status === 'refreshing'}><RefreshCw size={14} aria-hidden="true" /></button></div><DetailState status={status} error={error ?? issueError} onRetry={() => setReload((current) => current + 1)} /><DetailSection title="実行状態"><dl className="dashboard-detail__definition-grid"><div><dt>CurrentRunId</dt><dd>{textValue(snapshot?.currentRunId)}</dd></div><div><dt>処理済み Books</dt><dd>{formatNumber(snapshot?.currentProcessedBooks)}</dd></div><div><dt>CPU 使用率</dt><dd>{snapshot?.currentCpuUsage == null ? '—' : `${formatNumber(snapshot.currentCpuUsage)}%`}</dd></div><div><dt>最終実行</dt><dd>{formatDateTime(snapshot?.lastExecutionTime)}</dd></div><div><dt>次回実行</dt><dd>{formatDateTime(snapshot?.nextExecutionTime)}</dd></div><div><dt>最終結果</dt><dd>{textValue(snapshot?.lastExecutionResult)}</dd></div></dl></DetailSection><DetailSection title="操作"><div className="dashboard-detail__actions"><button ref={runTriggerRef} className="dashboard-detail__button dashboard-detail__button--primary" type="button" onClick={() => setRunMode('Quick')} disabled={busy || running}><Play size={14} aria-hidden="true" />Quick</button><button className="dashboard-detail__button" type="button" onClick={() => setRunMode('Deep')} disabled={busy || running}><Play size={14} aria-hidden="true" />Deep</button><button className="dashboard-detail__button dashboard-detail__button--danger" type="button" onClick={() => void mutate('cancel')} disabled={busy || !running}><X size={14} aria-hidden="true" />Cancel</button>{paused ? <button className="dashboard-detail__button" type="button" onClick={() => void mutate('resume')} disabled={busy || !running}><Play size={14} aria-hidden="true" />Resume</button> : <button className="dashboard-detail__button" type="button" onClick={() => void mutate('pause')} disabled={busy || !running}><Pause size={14} aria-hidden="true" />Pause</button>}<ActionFeedback status={actionStatus} message={actionMessage} /></div></DetailSection><DetailSection title="スケジュール"><form className="dashboard-detail__form" onSubmit={(event) => void saveSchedule(event)}><div className="dashboard-detail__form-grid"><label>Interval 分<input type="number" min="1" step="1" value={intervalMinutes} onChange={(event) => setIntervalMinutes(event.target.value)} /></label><label>CPU %<input type="number" min="0" max="100" step="1" value={cpuThreshold} onChange={(event) => setCpuThreshold(event.target.value)} /></label></div><div className="dashboard-detail__form-actions"><button className="dashboard-detail__button" type="submit" disabled={scheduleStatus === 'pending'} aria-busy={scheduleStatus === 'pending'}>{scheduleStatus === 'pending' ? <LoaderCircle className="dashboard-detail__spin" size={14} aria-hidden="true" /> : <Save size={14} aria-hidden="true" />}保存</button><ActionFeedback status={scheduleStatus} message={scheduleMessage} /></div></form></DetailSection><DetailSection title="履歴" count={formatNumber(snapshot?.recentHistory?.length ?? 0)}><div className="dashboard-detail__table-wrap" role="region" aria-label="Maintenance履歴" tabIndex={0}><table className="dashboard-detail__table"><thead><tr><th scope="col">RunId</th><th scope="col">Start</th><th scope="col">Result</th><th scope="col">Mode</th><th scope="col">Books</th><th scope="col">Issues</th></tr></thead><tbody>{(snapshot?.recentHistory ?? []).map((entry: MaintenanceHistoryEntryDto, index) => { const id = entry.runId?.trim(); return <tr key={id ?? index}><th scope="row"><button className="dashboard-detail__table-button" type="button" onClick={() => id && loadRun(id)} disabled={!id} aria-expanded={id ? expandedRun === id : undefined}><code>{textValue(id)}</code></button></th><td>{formatDateTime(entry.startedAt)}</td><td>{textValue(entry.result)}</td><td>{textValue(entry.storageSyncMode)}</td><td>{formatNumber(entry.processedBooks)}</td><td>{formatNumber(entry.issuesDetected)}</td></tr> })}</tbody></table>{!snapshot?.recentHistory?.length && <div className="dashboard-detail__empty">—</div>}</div>{expandedRun && <div className="dashboard-detail__panel">{runLoading === expandedRun && <DetailSkeleton />}{runErrors[expandedRun] && <div className="dashboard-detail__error" role="alert"><CircleAlert size={14} aria-hidden="true" />{runErrors[expandedRun]}</div>}{runDetails[expandedRun] && <><div className="dashboard-detail__filters"><button className="dashboard-detail__button" type="button" aria-pressed={taskFilter === 'all'} onClick={() => setTaskFilter('all')}>All</button><button className="dashboard-detail__button" type="button" aria-pressed={taskFilter === 'issues'} onClick={() => setTaskFilter('issues')}>Issues</button></div><RunDetail data={runDetails[expandedRun]} filter={taskFilter} /></>}</div>}</DetailSection><DetailSection title="検出問題" count={formatNumber(issues.length)}><ul className="dashboard-detail__issue-list">{issues.map((issue, index) => <li className="dashboard-detail__issue" key={`${issue.runId}-${issue.target}-${index}`}><StatusBadge tone="warning" icon={TriangleAlert}>{textValue(issue.issueType)}</StatusBadge><code>{textValue(issue.target)}</code><span>{textValue(issue.detail)}</span><span>{textValue(issue.runId)}</span><time dateTime={issue.detectedAt ?? undefined}>{formatDateTime(issue.detectedAt)}</time></li>)}</ul>{!issues.length && <span className="dashboard-detail__empty">—</span>}</DetailSection><ActionDialog open={runMode !== null} title="Maintenance を開始" value={<StatusBadge tone={runMode === 'Deep' ? 'warning' : 'info'}>{textValue(runMode)}</StatusBadge>} pending={busy} confirmLabel="開始" triggerRef={runTriggerRef} onConfirm={() => void run()} onDismiss={() => setRunMode(null)} /></div>
}

export function CacheDetails({ apiRevision }: { apiRevision: number }) {
  const load = useCallback((signal: AbortSignal) => getCacheMetrics(signal), [])
  const query = useResource(apiRevision, 'cache', 'Cache', load)
  const { create, release } = useMutationControllers(apiRevision)
  const [clearOpen, setClearOpen] = useState(false)
  const [removeOpen, setRemoveOpen] = useState(false)
  const [bookId, setBookId] = useState('')
  const [mutation, setMutation] = useState<MutationStatus>('idle')
  const [message, setMessage] = useState<string | null>(null)
  const clearTriggerRef = useRef<HTMLButtonElement>(null)
  const removeTriggerRef = useRef<HTMLButtonElement>(null)
  const poll = useCallback((signal: AbortSignal) => query.poll(signal), [query.poll])
  useVisiblePolling({ intervalMs: 5_000, enabled: query.ready, poll })
  const clear = async () => { if (mutation === 'pending') return; const controller = create(); setMutation('pending'); setMessage(null); try { const response = await clearDashboardCache(controller.signal); if (controller.signal.aborted) return; if (response.success === false) throw new ApiError(response.message ?? 'Cacheのクリアに失敗しました。', { category: 'server' }); setMutation('success'); setMessage(response.message ?? 'クリア済み'); setClearOpen(false); query.refresh() } catch (error: unknown) { if (!isAbort(error, controller.signal)) { setMutation('error'); setMessage(mutationError(error)) } } finally { release(controller); if (!controller.signal.aborted) setMutation((current) => current === 'pending' ? 'idle' : current) } }
  const remove = async (event: FormEvent) => { event.preventDefault(); if (mutation === 'pending') return; if (!bookId.trim()) { setMutation('error'); setMessage('BookIdを入力してください。'); return } const controller = create(); setMutation('pending'); setMessage(null); try { const response = await removeDashboardBookCache(bookId.trim(), controller.signal); if (controller.signal.aborted) return; if (response.success === false) throw new ApiError(response.message ?? 'Cacheエントリの削除に失敗しました。', { category: 'server' }); setMutation('success'); setMessage(response.message ?? '削除済み'); setRemoveOpen(false); setBookId(''); query.refresh() } catch (error: unknown) { if (!isAbort(error, controller.signal)) { setMutation('error'); setMessage(mutationError(error)) } } finally { release(controller); if (!controller.signal.aborted) setMutation((current) => current === 'pending' ? 'idle' : current) } }
  if (query.status === 'loading') return <DetailSkeleton />
  const metrics = query.data ?? EMPTY_CACHE
  return <div className="dashboard-detail__content" aria-busy={query.status === 'refreshing'}><div className="dashboard-detail__toolbar"><StatusBadge tone="info" icon={HardDrive}>Cache</StatusBadge><button className="dashboard-detail__button" type="button" aria-label="Cacheを更新" onClick={query.refresh} disabled={query.status === 'refreshing'}><RefreshCw size={14} aria-hidden="true" /></button></div><DetailState status={query.status} error={query.error} onRetry={query.refresh} /><DetailSection title="Metrics"><div className="dashboard-detail__metrics"><div className="dashboard-detail__metric"><span className="dashboard-detail__metric-label">Size</span><strong>{formatBytes(metrics.sizeBytes)}</strong></div><div className="dashboard-detail__metric"><span className="dashboard-detail__metric-label">Entries</span><strong>{formatNumber(metrics.entryCount)}</strong></div><div className="dashboard-detail__metric"><span className="dashboard-detail__metric-label">Hit rate</span><strong>{metrics.hitRate == null ? '—' : `${formatNumber(metrics.hitRate * 100)}%`}</strong></div><div className="dashboard-detail__metric"><span className="dashboard-detail__metric-label">Hits</span><strong>{formatNumber(metrics.hitCount)}</strong></div><div className="dashboard-detail__metric"><span className="dashboard-detail__metric-label">Misses</span><strong>{formatNumber(metrics.missCount)}</strong></div><div className="dashboard-detail__metric"><span className="dashboard-detail__metric-label">Evictions</span><strong>{formatNumber(metrics.evictionCount)}</strong></div><div className="dashboard-detail__metric"><span className="dashboard-detail__metric-label">Strategy</span><strong>{textValue(metrics.strategy)}</strong></div></div><div className="dashboard-detail__meta"><span>更新 {formatDateTime(metrics.generatedAt)}</span></div></DetailSection><DetailSection title="操作"><div className="dashboard-detail__actions"><button ref={clearTriggerRef} className="dashboard-detail__button dashboard-detail__button--danger" type="button" onClick={() => setClearOpen(true)} disabled={mutation === 'pending'}><Trash2 size={14} aria-hidden="true" />Clear all</button><button ref={removeTriggerRef} className="dashboard-detail__button" type="button" onClick={() => setRemoveOpen(true)} disabled={mutation === 'pending'}><Trash2 size={14} aria-hidden="true" />Book</button><ActionFeedback status={mutation} message={message} /></div></DetailSection><ActionDialog open={clearOpen} title="Cache を全件クリア" value={<><ShieldAlert size={16} aria-hidden="true" />全件削除</>} pending={mutation === 'pending'} confirmLabel="クリア" triggerRef={clearTriggerRef} onConfirm={() => void clear()} onDismiss={() => setClearOpen(false)} /><BookCacheDialog open={removeOpen} pending={mutation === 'pending'} bookId={bookId} triggerRef={removeTriggerRef} onBookIdChange={setBookId} onSubmit={(event) => void remove(event)} onDismiss={() => setRemoveOpen(false)} /></div>
}

export default ServiceDetails
