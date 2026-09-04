import {
  Activity,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Clock3,
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
import type { FormEvent, ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'
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
import type {
  CacheClearStatusResponse,
  CacheMetricsResponse,
  ConnectionTestResult,
  DashboardMaintenanceResponse,
  ImageWorkerConfigResponse,
  MaintenanceCheckResultDetailDto,
  MaintenanceHistoryEntryDto,
  MaintenanceIssueDto,
  MaintenanceRunDetailResponse,
  MaintenanceStorageSyncMode,
  WebPilotConfigResponse,
} from '../models/dashboard'
import type { DashboardService, ServiceConfigResponse } from '../api/dashboard'

type DetailStatus = 'idle' | 'loading' | 'refreshing' | 'success' | 'error'
type MutationStatus = 'idle' | 'pending' | 'success' | 'error'
type ActionName = 'save' | 'test' | 'run' | 'cancel' | 'pause' | 'resume' | 'schedule' | 'clear' | 'remove'

const EMPTY_SERVICE: ServiceConfigResponse = {}
const EMPTY_MAINTENANCE: DashboardMaintenanceResponse = {}
const EMPTY_CACHE: CacheMetricsResponse = {}

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
  return new Intl.DateTimeFormat('ja-JP', { dateStyle: 'short', timeStyle: 'short' }).format(date)
}

const textValue = (value?: string | number | boolean | null) => (
  value === undefined || value === null || value === '' ? '—' : String(value)
)

const normalize = (value?: string | null) => value?.trim().toLocaleLowerCase('en-US') ?? ''

const getStatus = (value?: string | null) => {
  const normalized = normalize(value)
  if (['success', 'succeeded', 'ok', 'healthy', 'passed', 'pass', 'completed', 'complete'].includes(normalized)) {
    return { label: '正常', tone: 'success' as const, icon: CheckCircle2 }
  }
  if (['running', 'processing', 'pending'].includes(normalized)) {
    return { label: '実行中', tone: 'info' as const, icon: Activity }
  }
  if (normalized === 'paused') return { label: '一時停止', tone: 'warning' as const, icon: Pause }
  if (['warning', 'warn', 'degraded', 'throttled'].includes(normalized)) {
    return { label: '警告', tone: 'warning' as const, icon: TriangleAlert }
  }
  if (['error', 'failed', 'failure', 'unavailable', 'disconnected', 'critical', 'fatal'].includes(normalized)) {
    return { label: 'エラー', tone: 'danger' as const, icon: CircleAlert }
  }
  if (normalized === 'idle') return { label: '待機', tone: 'muted' as const, icon: Activity }
  return { label: value?.trim() || '—', tone: 'muted' as const, icon: Activity }
}

const mutationError = (error: unknown) => (
  error instanceof ApiError && error.status === 403 ? 'ローカル限定' : getErrorMessage(error)
)

const isAbort = (error: unknown, signal: AbortSignal) => signal.aborted || (
  error instanceof ApiError && error.message.includes('キャンセル')
)

const useModalDialog = (open: boolean) => {
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  return ref
}

const createController = (set: Set<AbortController>) => {
  const controller = new AbortController()
  set.add(controller)
  return controller
}

const releaseController = (set: Set<AbortController>, controller: AbortController) => {
  set.delete(controller)
}

function StatusBadge({ children, tone = 'muted', icon: Icon }: {
  children: ReactNode
  tone?: 'success' | 'warning' | 'danger' | 'info' | 'muted'
  icon?: typeof Activity
}) {
  return (
    <span className={`dashboard-detail__badge dashboard-detail__badge--${tone}`}>
      {Icon && <Icon size={13} aria-hidden="true" />}
      <span>{children}</span>
    </span>
  )
}

function DetailSkeleton() {
  return (
    <div className="dashboard-detail__loading" aria-hidden="true">
      <span className="dashboard-detail__spinner" />
    </div>
  )
}

function DetailState({
  status,
  error,
  onRetry,
}: {
  status: DetailStatus
  error: string | null
  onRetry: () => void
}) {
  if (status === 'loading') return <DetailSkeleton />
  if (!error) return null
  return (
    <div className="dashboard-detail__error" role="alert">
      <CircleAlert size={15} aria-hidden="true" />
      <span>{error}</span>
      <button className="dashboard-detail__button" type="button" aria-label="再試行" onClick={onRetry} disabled={status === 'refreshing'}>
        <RefreshCw size={14} aria-hidden="true" />
      </button>
    </div>
  )
}

function DetailSection({ title, count, children }: { title: string; count?: ReactNode; children: ReactNode }) {
  return (
    <section className="dashboard-detail__section">
      <div className="dashboard-detail__section-heading">
        <h2>{title}</h2>
        {count !== undefined && <span className="dashboard-detail__badge">{count}</span>}
      </div>
      {children}
    </section>
  )
}

function ActionFeedback({ status, message }: { status: MutationStatus; message: string | null }) {
  if (!message && status !== 'pending') return null
  return (
    <span className="dashboard-detail__feedback" role="status" aria-live="polite">
      {status === 'pending' && <LoaderCircle className="dashboard-detail__spin" size={14} aria-hidden="true" />}
      {status === 'success' && <Check size={14} aria-hidden="true" />}
      {status === 'error' && <CircleAlert size={14} aria-hidden="true" />}
      <span>{status === 'pending' ? '処理中' : message}</span>
    </span>
  )
}

const serviceName = (service: DashboardService) => service === 'webpilot' ? 'WebPilot' : 'ImageWorker'

export function ServiceDetails({ service, apiRevision }: { service: DashboardService; apiRevision: number }) {
  const [config, setConfig] = useState<ServiceConfigResponse | null>(null)
  const [status, setStatus] = useState<DetailStatus>('loading')
  const [error, setError] = useState<string | null>(null)
  const [reload, setReload] = useState(0)
  const [baseUrl, setBaseUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [keyTouched, setKeyTouched] = useState(false)
  const [saveStatus, setSaveStatus] = useState<MutationStatus>('idle')
  const [saveError, setSaveError] = useState<string | null>(null)
  const [testStatus, setTestStatus] = useState<MutationStatus>('idle')
  const [testError, setTestError] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<ConnectionTestResult | null>(null)
  const mutationControllers = useRef(new Set<AbortController>())
  const title = serviceName(service)

  useEffect(() => () => {
    mutationControllers.current.forEach((controller) => controller.abort())
    mutationControllers.current.clear()
  }, [service, apiRevision])

  useEffect(() => {
    const controller = new AbortController()
    setStatus(config ? 'refreshing' : 'loading')
    setError(null)
    void getServiceConfig(service, controller.signal).then((response) => {
      if (controller.signal.aborted) return
      const next = response.data ?? EMPTY_SERVICE
      setConfig(next)
      setBaseUrl(next.baseUrl ?? '')
      setApiKey('')
      setKeyTouched(false)
      setTestResult(next.lastTestResult ?? null)
      setStatus('success')
    }).catch((requestError: unknown) => {
      if (isAbort(requestError, controller.signal)) return
      setStatus(config ? 'success' : 'error')
      setError(getErrorMessage(requestError))
    })
    return () => controller.abort()
  }, [service, apiRevision, reload])

  const dirty = Boolean(config) && (baseUrl !== (config?.baseUrl ?? '') || keyTouched)

  const save = async (event: FormEvent) => {
    event.preventDefault()
    if (saveStatus === 'pending') return
    const controller = createController(mutationControllers.current)
    setSaveStatus('pending')
    setSaveError(null)
    try {
      const response = await updateServiceConfig(service, {
        baseUrl: baseUrl.trim(),
        apiKey: keyTouched ? (apiKey.trim() ? apiKey : '') : undefined,
      }, controller.signal)
      if (controller.signal.aborted) return
      const next = response.data ?? {
        ...(config ?? EMPTY_SERVICE),
        baseUrl: baseUrl.trim(),
        isApiKeyConfigured: keyTouched ? Boolean(apiKey.trim()) : config?.isApiKeyConfigured,
      }
      setConfig(next)
      setBaseUrl(next.baseUrl ?? baseUrl.trim())
      setApiKey('')
      setKeyTouched(false)
      setSaveStatus('success')
    } catch (requestError: unknown) {
      if (!isAbort(requestError, controller.signal)) {
        setSaveStatus('error')
        setSaveError(mutationError(requestError))
      }
    } finally {
      releaseController(mutationControllers.current, controller)
      if (!controller.signal.aborted) setSaveStatus((current) => current === 'pending' ? 'idle' : current)
    }
  }

  const test = async () => {
    if (testStatus === 'pending') return
    const controller = createController(mutationControllers.current)
    setTestStatus('pending')
    setTestError(null)
    try {
      const response = await testService(service, controller.signal)
      if (controller.signal.aborted) return
      setTestResult(response.data ?? null)
      setTestStatus('success')
    } catch (requestError: unknown) {
      if (!isAbort(requestError, controller.signal)) {
        setTestStatus('error')
        setTestError(mutationError(requestError))
      }
    } finally {
      releaseController(mutationControllers.current, controller)
      if (!controller.signal.aborted) setTestStatus((current) => current === 'pending' ? 'idle' : current)
    }
  }

  if (status === 'loading') return <DetailSkeleton />
  return (
    <div className="dashboard-detail__content" aria-busy={status === 'refreshing'}>
      <div className="dashboard-detail__toolbar">
        <StatusBadge tone={config?.isApiKeyConfigured ? 'success' : 'muted'} icon={Server}>{config?.isApiKeyConfigured ? 'API key' : 'API key 未設定'}</StatusBadge>
        {dirty && <StatusBadge tone="warning">未保存</StatusBadge>}
        {saveStatus === 'success' && <StatusBadge tone="info">一時</StatusBadge>}
        <button className="dashboard-detail__button" type="button" aria-label={`${title}を更新`} onClick={() => setReload((current) => current + 1)} disabled={status === 'refreshing'}>
          <RefreshCw size={14} aria-hidden="true" />
        </button>
      </div>
      <DetailState status={status} error={error} onRetry={() => setReload((current) => current + 1)} />
      <form className="dashboard-detail__form" onSubmit={(event) => void save(event)}>
        <div className="dashboard-detail__form-grid">
          <label>Base URL<input type="url" value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} /></label>
          <label>API key<input type="password" autoComplete="new-password" value={apiKey} onChange={(event) => { setApiKey(event.target.value); setKeyTouched(true) }} /></label>
        </div>
        <div className="dashboard-detail__form-actions">
          <button className="dashboard-detail__button dashboard-detail__button--primary" type="submit" disabled={!dirty || saveStatus === 'pending'} aria-busy={saveStatus === 'pending'}>
            {saveStatus === 'pending' ? <LoaderCircle className="dashboard-detail__spin" size={15} aria-hidden="true" /> : <Save size={15} aria-hidden="true" />}保存
          </button>
          <button className="dashboard-detail__button" type="button" onClick={() => void test()} disabled={testStatus === 'pending'} aria-busy={testStatus === 'pending'}>
            {testStatus === 'pending' ? <LoaderCircle className="dashboard-detail__spin" size={15} aria-hidden="true" /> : <Activity size={15} aria-hidden="true" />}テスト
          </button>
          <ActionFeedback status={saveStatus} message={saveError ?? (saveStatus === 'success' ? '保存済み' : null)} />
          <ActionFeedback status={testStatus} message={testError ?? (testStatus === 'success' ? '完了' : null)} />
        </div>
      </form>
      <DetailSection title="現在">
        <dl className="dashboard-detail__grid">
          <div className="dashboard-detail__metric"><dt>Base URL</dt><dd>{textValue(config?.baseUrl)}</dd></div>
          <div className="dashboard-detail__metric"><dt>API key</dt><dd>{config?.isApiKeyConfigured ? '設定済み' : '未設定'}</dd></div>
          <div className="dashboard-detail__metric"><dt>変更</dt><dd>{formatDateTime(config?.lastModified)}</dd></div>
        </dl>
      </DetailSection>
      <DetailSection title="接続">
        {testResult ? (
          <div className="dashboard-detail__status-row">
            {testResult.success ? <StatusBadge tone="success" icon={CheckCircle2}>正常</StatusBadge> : <StatusBadge tone="danger" icon={CircleAlert}>失敗</StatusBadge>}
            <span>{testResult.statusCode ?? '—'}</span><span>{testResult.latencyMs == null ? '—' : `${formatNumber(testResult.latencyMs)} ms`}</span><span>{textValue(testResult.message)}</span>
          </div>
        ) : <span className="dashboard-detail__empty">—</span>}
      </DetailSection>
    </div>
  )
}

type MaintenanceAction = Exclude<ActionName, 'save' | 'test' | 'clear' | 'remove'> | null

const numericDraft = (value?: number | null) => value == null ? '' : String(value)

const parseNumeric = (value: string) => {
  if (!value.trim()) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined
}

const issueInResult = (result: MaintenanceCheckResultDetailDto | null | undefined) => {
  const status = normalize(result?.status)
  return ['warning', 'warn', 'error', 'failed', 'failure'].includes(status)
    || Object.keys(result?.issuePages ?? {}).length > 0
}

function RunDetail({ data, filter }: { data: MaintenanceRunDetailResponse; filter: 'all' | 'issues' }) {
  const run = data.run
  const tasks = (data.tasks ?? []).filter((task) => filter === 'all' || Object.values(task.checkResults ?? {}).some(issueInResult))
  return (
    <div className="dashboard-detail__stack">
      {run && <div className="dashboard-detail__meta"><StatusBadge tone={getStatus(run.status).tone} icon={getStatus(run.status).icon}>{textValue(run.status)}</StatusBadge><span>{textValue(run.storageSyncMode)}</span><span>{formatNumber(run.processedBooks)} / {formatNumber(run.totalBooks)}</span></div>}
      {run?.results && <ul className="dashboard-detail__task-list">
        {Object.entries(run.results).map(([name, result]) => result && <li className="dashboard-detail__task" key={name}><strong>{name}</strong><span>OK {formatNumber(result.ok)}</span><span>Warning {formatNumber(result.warning)}</span><span>Error {formatNumber(result.error)}</span><span>Repaired {formatNumber(result.repaired)}</span></li>)}
      </ul>}
      <ul className="dashboard-detail__task-list">
        {tasks.map((task, index) => <li className="dashboard-detail__task" key={`${task.groupId}-${task.bookId}-${index}`}>
          <div className="dashboard-detail__meta"><code>{textValue(task.groupId)}</code><code>{textValue(task.bookId)}</code><StatusBadge tone={getStatus(task.status).tone} icon={getStatus(task.status).icon}>{textValue(task.status)}</StatusBadge></div>
          <span>{formatDateTime(task.completedAt)}</span>
          {task.checkResults && <ul className="dashboard-detail__issue-list">{Object.entries(task.checkResults).map(([name, result]) => result && <li key={name}><span>{name}</span><StatusBadge tone={getStatus(result.status).tone}>{textValue(result.status)}</StatusBadge><span>{textValue(result.message)}</span></li>)}</ul>}
        </li>)}
      </ul>
      {!tasks.length && <span className="dashboard-detail__empty">—</span>}
    </div>
  )
}

export function MaintenanceDetails({ apiRevision }: { apiRevision: number }) {
  const [snapshot, setSnapshot] = useState<DashboardMaintenanceResponse | null>(null)
  const [issues, setIssues] = useState<MaintenanceIssueDto[]>([])
  const [status, setStatus] = useState<DetailStatus>('loading')
  const [error, setError] = useState<string | null>(null)
  const [reload, setReload] = useState(0)
  const [intervalMinutes, setIntervalMinutes] = useState('')
  const [cpuThreshold, setCpuThreshold] = useState('')
  const [scheduleStatus, setScheduleStatus] = useState<MutationStatus>('idle')
  const [scheduleError, setScheduleError] = useState<string | null>(null)
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
  const runDialogRef = useModalDialog(runMode !== null)

  useEffect(() => () => {
    controllers.current.forEach((controller) => controller.abort())
    controllers.current.clear()
    detailControllers.current.forEach((controller) => controller.abort())
    detailControllers.current.clear()
  }, [apiRevision])

  useEffect(() => {
    const controller = new AbortController()
    setStatus(snapshot ? 'refreshing' : 'loading')
    setError(null)
    void Promise.all([getMaintenance(controller.signal), getMaintenanceIssues(controller.signal)]).then(([response, issueResponse]) => {
      if (controller.signal.aborted) return
      const next = response.data ?? EMPTY_MAINTENANCE
      setSnapshot(next)
      setIssues(issueResponse.data?.issues ?? [])
      setIntervalMinutes(numericDraft(next.schedule?.intervalMinutes))
      setCpuThreshold(numericDraft(next.schedule?.cpuThreshold))
      setStatus('success')
    }).catch((requestError: unknown) => {
      if (isAbort(requestError, controller.signal)) return
      setStatus(snapshot ? 'success' : 'error')
      setError(getErrorMessage(requestError))
    })
    return () => controller.abort()
  }, [apiRevision, reload])

  const mutate = async (kind: Exclude<MaintenanceAction, 'run' | null>) => {
    if (action) return
    const controller = createController(controllers.current)
    setAction(kind)
    setActionStatus('pending')
    setActionMessage(null)
    try {
      const response = kind === 'cancel'
        ? await cancelMaintenance(controller.signal)
        : kind === 'pause'
          ? await pauseMaintenance(controller.signal)
          : await resumeMaintenance(controller.signal)
      if (controller.signal.aborted) return
      setActionStatus('success')
      setActionMessage(response.message ?? '完了')
      setReload((current) => current + 1)
    } catch (requestError: unknown) {
      if (!isAbort(requestError, controller.signal)) {
        setActionStatus('error')
        setActionMessage(mutationError(requestError))
      }
    } finally {
      releaseController(controllers.current, controller)
      if (!controller.signal.aborted) setAction(null)
    }
  }

  const run = async () => {
    if (!runMode || action) return
    const mode = runMode
    setRunMode(null)
    const controller = createController(controllers.current)
    setAction('run')
    setActionStatus('pending')
    setActionMessage(null)
    try {
      const response = await startMaintenance(mode, controller.signal)
      if (controller.signal.aborted) return
      setActionStatus('success')
      setActionMessage(response.data?.message ?? '開始済み')
      setReload((current) => current + 1)
    } catch (requestError: unknown) {
      if (!isAbort(requestError, controller.signal)) {
        setActionStatus('error')
        setActionMessage(mutationError(requestError))
      }
    } finally {
      releaseController(controllers.current, controller)
      if (!controller.signal.aborted) setAction(null)
    }
  }

  const saveSchedule = async (event: FormEvent) => {
    event.preventDefault()
    if (scheduleStatus === 'pending') return
    const interval = parseNumeric(intervalMinutes)
    const cpu = parseNumeric(cpuThreshold)
    if (interval === undefined || cpu === undefined) {
      setScheduleStatus('error')
      setScheduleError('数値')
      return
    }
    const controller = createController(controllers.current)
    setScheduleStatus('pending')
    setScheduleError(null)
    try {
      await updateMaintenanceSchedule({ intervalMinutes: interval, cpuThreshold: cpu }, controller.signal)
      if (controller.signal.aborted) return
      setScheduleStatus('success')
      setReload((current) => current + 1)
    } catch (requestError: unknown) {
      if (!isAbort(requestError, controller.signal)) {
        setScheduleStatus('error')
        setScheduleError(mutationError(requestError))
      }
    } finally {
      releaseController(controllers.current, controller)
      if (!controller.signal.aborted) setScheduleStatus((current) => current === 'pending' ? 'idle' : current)
    }
  }

  const loadRun = (runId: string) => {
    if (expandedRun === runId) {
      setExpandedRun(null)
      return
    }
    setExpandedRun(runId)
    if (runDetails[runId] || runLoading === runId) return
    const controller = new AbortController()
    detailControllers.current.set(runId, controller)
    setRunLoading(runId)
    void getMaintenanceRun(runId, controller.signal).then((response) => {
      if (!controller.signal.aborted) setRunDetails((current) => ({ ...current, [runId]: response.data ?? {} }))
    }).catch((requestError: unknown) => {
      if (!isAbort(requestError, controller.signal)) setRunErrors((current) => ({ ...current, [runId]: getErrorMessage(requestError) }))
    }).finally(() => {
      detailControllers.current.delete(runId)
      if (!controller.signal.aborted) setRunLoading(null)
    })
  }

  const running = Boolean(snapshot?.isRunning)
  const paused = Boolean(snapshot?.isPaused)
  const state = running ? (paused ? 'paused' : 'running') : 'idle'
  const statusInfo = getStatus(state)
  const history = snapshot?.recentHistory ?? []
  const pending = action !== null

  if (status === 'loading') return <DetailSkeleton />
  return (
    <div className="dashboard-detail__content" aria-busy={status === 'refreshing'}>
      <div className="dashboard-detail__toolbar">
        <StatusBadge tone={statusInfo.tone} icon={statusInfo.icon}>{statusInfo.label}</StatusBadge>
        {snapshot?.isThrottled && <StatusBadge tone="warning" icon={Gauge}>CPU throttle</StatusBadge>}
        <span>{formatNumber(snapshot?.currentProcessedBooks)}</span>
        <button className="dashboard-detail__button" type="button" aria-label="Maintenanceを更新" onClick={() => setReload((current) => current + 1)} disabled={status === 'refreshing'}><RefreshCw size={14} aria-hidden="true" /></button>
      </div>
      <DetailState status={status} error={error} onRetry={() => setReload((current) => current + 1)} />
      <DetailSection title="操作">
        <div className="dashboard-detail__actions">
          <button className="dashboard-detail__button dashboard-detail__button--primary" type="button" onClick={() => setRunMode('Quick')} disabled={pending || running}><Play size={14} aria-hidden="true" />Quick</button>
          <button className="dashboard-detail__button" type="button" onClick={() => setRunMode('Deep')} disabled={pending || running}><Play size={14} aria-hidden="true" />Deep</button>
          <button className="dashboard-detail__button dashboard-detail__button--danger" type="button" onClick={() => void mutate('cancel')} disabled={pending || !running}><X size={14} aria-hidden="true" />Cancel</button>
          {paused ? <button className="dashboard-detail__button" type="button" onClick={() => void mutate('resume')} disabled={pending || !running}><Play size={14} aria-hidden="true" />Resume</button> : <button className="dashboard-detail__button" type="button" onClick={() => void mutate('pause')} disabled={pending || !running}><Pause size={14} aria-hidden="true" />Pause</button>}
          <ActionFeedback status={actionStatus} message={actionMessage} />
        </div>
      </DetailSection>
      <DetailSection title="スケジュール">
        <form className="dashboard-detail__form" onSubmit={(event) => void saveSchedule(event)}>
          <div className="dashboard-detail__form-grid"><label>Interval 分<input type="number" min="0" step="1" value={intervalMinutes} onChange={(event) => setIntervalMinutes(event.target.value)} /></label><label>CPU %<input type="number" min="0" max="100" step="1" value={cpuThreshold} onChange={(event) => setCpuThreshold(event.target.value)} /></label></div>
          <div className="dashboard-detail__form-actions"><button className="dashboard-detail__button" type="submit" disabled={scheduleStatus === 'pending'} aria-busy={scheduleStatus === 'pending'}>{scheduleStatus === 'pending' ? <LoaderCircle className="dashboard-detail__spin" size={14} aria-hidden="true" /> : <Save size={14} aria-hidden="true" />}保存</button><ActionFeedback status={scheduleStatus} message={scheduleError ?? (scheduleStatus === 'success' ? '保存済み' : null)} /></div>
        </form>
      </DetailSection>
      <DetailSection title="履歴" count={formatNumber(history.length)}>
        <div className="dashboard-detail__table-wrap" role="region" aria-label="Maintenance履歴" tabIndex={0}><table><thead><tr><th scope="col">RunId</th><th scope="col">Start</th><th scope="col">Result</th><th scope="col">Mode</th><th scope="col">Books</th><th scope="col">Issues</th></tr></thead><tbody>{history.map((entry: MaintenanceHistoryEntryDto, index) => { const id = entry.runId?.trim(); return <tr key={id ?? index} tabIndex={id ? 0 : undefined} aria-expanded={id ? expandedRun === id : undefined} onClick={() => id && loadRun(id)} onKeyDown={(event) => { if ((event.key === 'Enter' || event.key === ' ') && id) { event.preventDefault(); loadRun(id) } }}><th scope="row"><code>{textValue(id)}</code></th><td>{formatDateTime(entry.startedAt)}</td><td>{textValue(entry.result)}</td><td>{textValue(entry.storageSyncMode)}</td><td>{formatNumber(entry.processedBooks)}</td><td>{formatNumber(entry.issuesDetected)}</td></tr> })}</tbody></table>{!history.length && <div className="dashboard-detail__empty">—</div>}</div>
        {expandedRun && <div className="dashboard-detail__panel">{runLoading === expandedRun && <DetailSkeleton />}{runErrors[expandedRun] && <div className="dashboard-detail__error" role="alert"><CircleAlert size={14} aria-hidden="true" />{runErrors[expandedRun]}</div>}{runDetails[expandedRun] && <><div className="dashboard-detail__filters"><button className="dashboard-detail__button" type="button" aria-pressed={taskFilter === 'all'} onClick={() => setTaskFilter('all')}>All</button><button className="dashboard-detail__button" type="button" aria-pressed={taskFilter === 'issues'} onClick={() => setTaskFilter('issues')}>Issues</button></div><RunDetail data={runDetails[expandedRun]} filter={taskFilter} /></>}</div>}
      </DetailSection>
      <DetailSection title="Issues" count={formatNumber(issues.length)}><ul className="dashboard-detail__issue-list">{issues.map((issue: MaintenanceIssueDto, index) => <li className="dashboard-detail__issue" key={`${issue.runId}-${issue.target}-${index}`}><StatusBadge tone="warning" icon={TriangleAlert}>{textValue(issue.issueType)}</StatusBadge><code>{textValue(issue.target)}</code><span>{textValue(issue.detail)}</span><span>{textValue(issue.runId)}</span><time dateTime={issue.detectedAt ?? undefined}>{formatDateTime(issue.detectedAt)}</time></li>)}</ul>{!issues.length && <span className="dashboard-detail__empty">—</span>}</DetailSection>
      <dialog ref={runDialogRef} aria-labelledby="maintenance-run-dialog-title" onCancel={() => setRunMode(null)} onClose={() => setRunMode(null)}><div className="dashboard-detail__dialog-body"><h2 id="maintenance-run-dialog-title">Maintenance</h2><div className="dashboard-detail__meta"><StatusBadge tone={runMode === 'Deep' ? 'warning' : 'info'}>{textValue(runMode)}</StatusBadge><span>開始</span></div><div className="dashboard-detail__dialog-actions"><button className="dashboard-detail__button" type="button" onClick={() => setRunMode(null)} disabled={pending}>Cancel</button><button className="dashboard-detail__button dashboard-detail__button--primary" type="button" onClick={() => void run()} disabled={pending}>Start</button></div></div></dialog>
    </div>
  )
}

const clearStateLabel = (status?: CacheClearStatusResponse | null) => {
  const value = normalize(status?.state)
  if (value === 'running') return '実行中'
  if (value === 'completed' || value === 'complete') return '完了'
  if (value === 'failed' || value === 'error') return '失敗'
  return textValue(status?.state)
}

export function CacheDetails({ apiRevision }: { apiRevision: number }) {
  const [metrics, setMetrics] = useState<CacheMetricsResponse | null>(null)
  const [status, setStatus] = useState<DetailStatus>('loading')
  const [error, setError] = useState<string | null>(null)
  const [reload, setReload] = useState(0)
  const [clearOpen, setClearOpen] = useState(false)
  const [removeOpen, setRemoveOpen] = useState(false)
  const [groupId, setGroupId] = useState('')
  const [bookId, setBookId] = useState('')
  const [mutation, setMutation] = useState<MutationStatus>('idle')
  const [mutationMessage, setMutationMessage] = useState<string | null>(null)
  const controllers = useRef(new Set<AbortController>())
  const clearDialogRef = useModalDialog(clearOpen)
  const removeDialogRef = useModalDialog(removeOpen)

  useEffect(() => () => {
    controllers.current.forEach((controller) => controller.abort())
    controllers.current.clear()
  }, [apiRevision])

  useEffect(() => {
    const controller = new AbortController()
    setStatus(metrics ? 'refreshing' : 'loading')
    setError(null)
    void getCacheMetrics(controller.signal).then((response) => {
      if (controller.signal.aborted) return
      setMetrics(response.data ?? EMPTY_CACHE)
      setStatus('success')
    }).catch((requestError: unknown) => {
      if (isAbort(requestError, controller.signal)) return
      setStatus(metrics ? 'success' : 'error')
      setError(getErrorMessage(requestError))
    })
    return () => controller.abort()
  }, [apiRevision, reload])

  const clear = async (event: FormEvent) => {
    event.preventDefault()
    if (mutation === 'pending') return
    const controller = createController(controllers.current)
    setMutation('pending')
    setMutationMessage(null)
    try {
      const response = await clearDashboardCache(controller.signal)
      if (controller.signal.aborted) return
      const nextStatus = response.data?.status ?? null
      setMetrics((current) => ({ ...(current ?? EMPTY_CACHE), clearStatus: nextStatus }))
      setMutation('success')
      setMutationMessage(response.data?.message ?? '完了')
      setClearOpen(false)
      setReload((current) => current + 1)
    } catch (requestError: unknown) {
      if (!isAbort(requestError, controller.signal)) {
        setMutation('error')
        setMutationMessage(mutationError(requestError))
      }
    } finally {
      releaseController(controllers.current, controller)
      if (!controller.signal.aborted) setMutation((current) => current === 'pending' ? 'idle' : current)
    }
  }

  const remove = async (event: FormEvent) => {
    event.preventDefault()
    if (mutation === 'pending') return
    if (!groupId.trim() || !bookId.trim()) {
      setMutation('error')
      setMutationMessage('GroupId / BookId')
      return
    }
    const controller = createController(controllers.current)
    setMutation('pending')
    setMutationMessage(null)
    try {
      await removeDashboardBookCache(groupId.trim(), bookId.trim(), controller.signal)
      if (controller.signal.aborted) return
      setMutation('success')
      setMutationMessage('完了')
      setRemoveOpen(false)
      setReload((current) => current + 1)
    } catch (requestError: unknown) {
      if (!isAbort(requestError, controller.signal)) {
        setMutation('error')
        setMutationMessage(mutationError(requestError))
      }
    } finally {
      releaseController(controllers.current, controller)
      if (!controller.signal.aborted) setMutation((current) => current === 'pending' ? 'idle' : current)
    }
  }

  if (status === 'loading') return <DetailSkeleton />
  const clearStatus = metrics?.clearStatus
  return (
    <div className="dashboard-detail__content" aria-busy={status === 'refreshing'}>
      <div className="dashboard-detail__toolbar"><StatusBadge tone="info" icon={HardDrive}>Cache</StatusBadge>{clearStatus?.state && <StatusBadge tone={normalize(clearStatus.state) === 'failed' ? 'danger' : 'info'}>{clearStateLabel(clearStatus)}</StatusBadge>}<button className="dashboard-detail__button" type="button" aria-label="Cacheを更新" onClick={() => setReload((current) => current + 1)} disabled={status === 'refreshing'}><RefreshCw size={14} aria-hidden="true" /></button></div>
      <DetailState status={status} error={error} onRetry={() => setReload((current) => current + 1)} />
      <DetailSection title="Metrics">
        <div className="dashboard-detail__metrics"><div className="dashboard-detail__metric"><dt>Size</dt><dd>{formatBytes(metrics?.sizeBytes)}</dd></div><div className="dashboard-detail__metric"><dt>Entries</dt><dd>{formatNumber(metrics?.entryCount)}</dd></div><div className="dashboard-detail__metric"><dt>Hit rate</dt><dd>{metrics?.hitRate == null ? '—' : `${formatNumber(metrics.hitRate * 100)}%`}</dd></div><div className="dashboard-detail__metric"><dt>Hits</dt><dd>{formatNumber(metrics?.hitCount)}</dd></div><div className="dashboard-detail__metric"><dt>Misses</dt><dd>{formatNumber(metrics?.missCount)}</dd></div><div className="dashboard-detail__metric"><dt>Strategy</dt><dd>{textValue(metrics?.strategy)}</dd></div></div>
        <div className="dashboard-detail__meta"><span>更新 {formatDateTime(metrics?.generatedAt)}</span><span>Clear {formatDateTime(metrics?.lastClearedAt)}</span></div>
      </DetailSection>
      <DetailSection title="操作">
        <div className="dashboard-detail__actions"><button className="dashboard-detail__button dashboard-detail__button--danger" type="button" onClick={() => setClearOpen(true)} disabled={mutation === 'pending'}><Trash2 size={14} aria-hidden="true" />Clear all</button><button className="dashboard-detail__button" type="button" onClick={() => setRemoveOpen(true)} disabled={mutation === 'pending'}><Trash2 size={14} aria-hidden="true" />Book</button><ActionFeedback status={mutation} message={mutationMessage} /></div>
      </DetailSection>
      <dialog ref={clearDialogRef} aria-labelledby="cache-clear-dialog-title" onCancel={() => setClearOpen(false)} onClose={() => setClearOpen(false)}><form className="dashboard-detail__dialog-body" onSubmit={(event) => void clear(event)}><h2 id="cache-clear-dialog-title">Cache Clear all</h2><div className="dashboard-detail__meta"><ShieldAlert size={16} aria-hidden="true" /><span>全件</span></div><div className="dashboard-detail__dialog-actions"><button className="dashboard-detail__button" type="button" onClick={() => setClearOpen(false)} disabled={mutation === 'pending'}>Cancel</button><button className="dashboard-detail__button dashboard-detail__button--danger" type="submit" disabled={mutation === 'pending'} aria-busy={mutation === 'pending'}>{mutation === 'pending' ? <LoaderCircle className="dashboard-detail__spin" size={14} aria-hidden="true" /> : <Trash2 size={14} aria-hidden="true" />}Clear</button></div></form></dialog>
      <dialog ref={removeDialogRef} aria-labelledby="cache-remove-dialog-title" onCancel={() => setRemoveOpen(false)} onClose={() => setRemoveOpen(false)}><form className="dashboard-detail__dialog-body" onSubmit={(event) => void remove(event)}><h2 id="cache-remove-dialog-title">Cache Book</h2><div className="dashboard-detail__form-grid"><label>GroupId<input value={groupId} onChange={(event) => setGroupId(event.target.value)} required /></label><label>BookId<input value={bookId} onChange={(event) => setBookId(event.target.value)} required /></label></div><div className="dashboard-detail__dialog-actions"><button className="dashboard-detail__button" type="button" onClick={() => setRemoveOpen(false)} disabled={mutation === 'pending'}>Cancel</button><button className="dashboard-detail__button dashboard-detail__button--danger" type="submit" disabled={mutation === 'pending'} aria-busy={mutation === 'pending'}>{mutation === 'pending' ? <LoaderCircle className="dashboard-detail__spin" size={14} aria-hidden="true" /> : <Trash2 size={14} aria-hidden="true" />}Delete</button></div></form></dialog>
    </div>
  )
}

export default ServiceDetails
