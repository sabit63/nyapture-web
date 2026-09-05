import { useCacheSyncStatus } from './use-cache-sync-status'
import { useCacheDraft } from './use-cache-draft'
import {
  Activity,
  Check,
  CircleAlert,
  CircleHelp,
  Database,
  Gauge,
  HardDrive,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Server,
  Square,
  TestTube2,
  Trash2,
  X,
} from 'lucide-react'
import { isValidElement, useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'

import {
  ApiError,
  getErrorMessage,
} from '../../api'
import {
  cancelCacheSync,
  getCacheConfig,
  resetCacheConfig,
  runCacheSync,
  saveCacheConfig,
  testCacheSite,
  validateCacheConfig,
} from '../../api/web-cache'
import {
  Button,
  Dialog,
  DialogBody,
  DialogFooter,
  DialogHeader,
  IconButton,
} from '../../components/ui'
import type {
  WebBookCacheConfigDto,
  WebBookCacheConfigResponse,
  WebBookCacheSyncStartResponse,
  WebBookCacheValidationResponse,
  WebBookCacheSiteTestResponse,
} from '../../models/web-cache'
import {
  canSaveWebCacheConfig,
  cloneWebCacheConfig,
  createCacheSyncRequest,
  getValidationMessagesFromError,
  isCurrentCacheRequest,
  validateWebCacheDraft,
  validationMessages,
  type WebCacheConfigDraft,
} from './management-state'
import './web-cache-management.css'

export type WebCacheManagementProps = {
  apiRevision: number
}

type Feedback = {
  tone: 'success' | 'warning' | 'danger' | 'info'
  message: string
}

type ConfirmAction =
  | { kind: 'reset' }
  | { kind: 'remove-site'; index: number; groupId: string }

type SiteTestResult = {
  tone: 'success' | 'warning' | 'danger'
  message: string
}

const formatNumber = (value?: number | null) => (
  typeof value === 'number' && Number.isFinite(value)
    ? new Intl.NumberFormat('ja-JP').format(value)
    : '—'
)

const formatDateTime = (value?: string | null) => {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('ja-JP', { dateStyle: 'short', timeStyle: 'short' }).format(date)
}

const responseMessage = (value: unknown): string | null => {
  if (!value || typeof value !== 'object') return null
  const message = (value as { message?: unknown }).message
  return typeof message === 'string' && message.trim() ? message.trim() : null
}

const responseIsFailure = (value: unknown) => (
  !!value
  && typeof value === 'object'
  && (value as { success?: unknown }).success === false
)

const errorMessage = (error: unknown) => {
  const validationErrors = getValidationMessagesFromError(error)
  if (validationErrors.length > 0) return validationErrors.join('\n')
  if (error instanceof ApiError && error.message.trim()) return error.message
  return getErrorMessage(error)
}

const responseConfig = (value: WebBookCacheConfigResponse | WebBookCacheConfigDto): WebCacheConfigDraft => {
  if (value && typeof value === 'object' && 'config' in value && value.config) {
    return cloneWebCacheConfig(value.config)
  }
  return cloneWebCacheConfig(value as WebBookCacheConfigDto)
}

const responseRuntimeOverride = (value: WebBookCacheConfigResponse | WebBookCacheConfigDto) => (
  !!(value && typeof value === 'object' && 'hasRuntimeOverride' in value && value.hasRuntimeOverride)
)

const updateNumber = (event: ChangeEvent<HTMLInputElement>) => (
  event.target.value === '' ? Number.NaN : Number(event.target.value)
)

function Metric({ icon: Icon, label, value, tone = 'muted' }: {
  icon: typeof Activity
  label: string
  value: string
  tone?: 'success' | 'warning' | 'danger' | 'info' | 'muted'
}) {
  return (
    <article className="web-cache-management__metric">
      <span className={`web-cache-management__metric-icon web-cache-management__metric-icon--${tone}`} aria-hidden="true"><Icon size={16} /></span>
      <span className="web-cache-management__metric-label">{label}</span>
      <strong>{value}</strong>
    </article>
  )
}

function Field({ label, hint, error, children }: {
  label: string
  hint?: string
  error?: string
  children: React.ReactNode
}) {
  const Container = isValidElement(children) && children.type === Toggle ? 'div' : 'label'
  return (
    <Container className="web-cache-management__field">
      <span className="web-cache-management__label">{label}</span>
      {children}
      {hint && <span className="web-cache-management__hint">{hint}</span>}
      {error && <span className="web-cache-management__field-error" role="alert">{error}</span>}
    </Container>
  )
}

function Toggle({ label, checked, onChange, disabled = false }: {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
}) {
  return (
    <label className="web-cache-management__toggle">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} disabled={disabled} />
      <span>{label}</span>
    </label>
  )
}

export function WebCacheManagement({ apiRevision }: WebCacheManagementProps) {
  const { serverConfig, setServerConfig, draft, setDraft, draftRef, allowedGroupIdsText, setAllowedGroupIdsText, excludedTagsText, setExcludedTagsText, applyEditableConfig, updateDraft, updateGlobalNumber, updateAutoDownload, updateSite } = useCacheDraft()
  const [hasRuntimeOverride, setHasRuntimeOverride] = useState(false)
  const { status, setStatus, statusLoading, statusError, loadStatus } = useCacheSyncStatus(apiRevision)
  const [configLoading, setConfigLoading] = useState(true)
  const [configError, setConfigError] = useState<string | null>(null)
  const [configUncertain, setConfigUncertain] = useState(false)
  const configUncertainRef = useRef(false)
  const [validationIssues, setValidationIssues] = useState<Array<{ path?: string; message: string }>>([])
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  const [validating, setValidating] = useState(false)
  const [saving, setSaving] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [cancelPending, setCancelPending] = useState(false)
  const [syncGroupId, setSyncGroupId] = useState('')
  const [syncForce, setSyncForce] = useState(false)
  const [testingGroupId, setTestingGroupId] = useState<string | null>(null)
  const [siteTests, setSiteTests] = useState<Record<string, SiteTestResult>>({})
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null)

  const mountedRef = useRef(true)
  const revisionRef = useRef(apiRevision)
  const generationRef = useRef(0)
  const configControllerRef = useRef<AbortController | null>(null)
  const mutationControllerRef = useRef<AbortController | null>(null)
  const configRequestIdRef = useRef(0)
  const mutationBusyRef = useRef(false)

  const isActive = useCallback((generation: number, revision = apiRevision) => (
    mountedRef.current
    && generationRef.current === generation
    && revisionRef.current === revision
  ), [apiRevision])

  const abortRequests = useCallback(() => {
    configControllerRef.current?.abort()
    mutationControllerRef.current?.abort()
  }, [])

  const loadConfig = useCallback(async (preserveDraft: boolean, generation = generationRef.current) => {
    const requestId = ++configRequestIdRef.current
    configControllerRef.current?.abort()
    const controller = new AbortController()
    configControllerRef.current = controller
    if (!preserveDraft) setConfigLoading(true)
    setConfigError(null)
    try {
      const result = await getCacheConfig(controller.signal)
      if (!isActive(generation) || !isCurrentCacheRequest(apiRevision, revisionRef.current, requestId, configRequestIdRef.current)) return 'stale' as const
      if (responseIsFailure(result)) throw new ApiError(responseMessage(result) ?? 'Web Cache設定を取得できませんでした。')
      const nextConfig = responseConfig(result)
      setServerConfig(nextConfig)
      setHasRuntimeOverride(responseRuntimeOverride(result))
      if (!preserveDraft || configUncertainRef.current || draftRef.current === null) applyEditableConfig(nextConfig)
      if (configUncertainRef.current) setFeedback(null)
      configUncertainRef.current = false
      setConfigUncertain(false)
      return 'success' as const
    } catch (error) {
      if (!isActive(generation) || controller.signal.aborted) return 'stale' as const
      setConfigError(configUncertainRef.current ? 'リセット済み・設定の再取得に失敗しました' : errorMessage(error))
      return 'error' as const
    } finally {
      if (isActive(generation) && requestId === configRequestIdRef.current) setConfigLoading(false)
    }
  }, [apiRevision, applyEditableConfig, draftRef, isActive, setServerConfig])

  useEffect(() => {
    mountedRef.current = true
    revisionRef.current = apiRevision
    const generation = ++generationRef.current
    abortRequests()
    setServerConfig(null)
    setDraft(null)
    setConfigError(null)
    setFeedback(null)
    setValidationIssues([])
    setValidating(false)
    setSaving(false)
    setResetting(false)
    setSyncing(false)
    setCancelPending(false)
    setTestingGroupId(null)
    setSiteTests({})
    setAllowedGroupIdsText('')
    setExcludedTagsText('')
    mutationBusyRef.current = false
    setConfigLoading(true)
    void loadConfig(false, generation)
    return () => {
      mountedRef.current = false
      abortRequests()
    }
  }, [abortRequests, apiRevision, loadConfig, setDraft, setServerConfig, setAllowedGroupIdsText, setExcludedTagsText])

  useEffect(() => {
    if (!status?.isRunning && cancelPending) setCancelPending(false)
  }, [cancelPending, status?.isRunning])

  useEffect(() => () => {
    mountedRef.current = false
    abortRequests()
  }, [abortRequests])

  const localIssues = useMemo(() => (draft ? validateWebCacheDraft(draft) : []), [draft])
  const allValidationMessages = useMemo(() => (
    [...validationMessages(localIssues), ...validationIssues.map(({ message }) => message)]
  ), [localIssues, validationIssues])
  const issueFor = useCallback((path: string) => (
    localIssues.find((item) => item.path === path)?.message
  ), [localIssues])

  const addSite = useCallback(() => {
    updateDraft((current) => ({
      ...current,
      sites: [...current.sites, {
        groupId: '',
        enabled: true,
        startUrl: '',
        intervalMinutes: null,
        maxPagesPerRun: null,
        maxDetailsPerRun: null,
        domainIntervalMilliseconds: null,
      }],
    }))
    setFeedback(null)
  }, [updateDraft])

  const confirmRemoveSite = useCallback((index: number) => {
    const groupId = draft?.sites[index]?.groupId?.trim() ?? ''
    setConfirmAction({ kind: 'remove-site', index, groupId })
  }, [draft])

  const removeSite = useCallback((index: number) => {
    updateDraft((current) => ({ ...current, sites: current.sites.filter((_, siteIndex) => siteIndex !== index) }))
    setFeedback({ tone: 'info', message: 'サイトを編集用コピーから削除しました。保存すると反映されます。' })
  }, [updateDraft])

  const beginMutation = useCallback(() => {
    if (mutationBusyRef.current) return null
    const controller = new AbortController()
    mutationBusyRef.current = true
    mutationControllerRef.current = controller
    return controller
  }, [])

  const endMutation = useCallback((controller: AbortController) => {
    if (mutationControllerRef.current !== controller) return
    mutationControllerRef.current = null
    mutationBusyRef.current = false
  }, [])

  const save = useCallback(async () => {
    if (configUncertain || !draft || !canSaveWebCacheConfig(draft, saving, validating)) return
    const issues = validateWebCacheDraft(draft)
    if (issues.length > 0) {
      setValidationIssues(issues)
      setFeedback({ tone: 'warning', message: '入力内容を確認してください。' })
      return
    }
    const generation = generationRef.current
    const controller = beginMutation()
    if (!controller) return
    setValidating(true)
    setSaving(false)
    setValidationIssues([])
    setFeedback(null)
    try {
      const validation = await validateCacheConfig(cloneWebCacheConfig(draft), controller.signal)
      if (!isActive(generation) || controller.signal.aborted) return
      if (responseIsFailure(validation) || validation?.isValid !== true) {
        const messages = (validation as WebBookCacheValidationResponse | null | undefined)?.errors ?? []
        setValidationIssues(messages.filter((message): message is string => typeof message === 'string').map((message) => ({ message })))
        setFeedback({ tone: 'warning', message: responseMessage(validation) ?? '設定を保存できる状態ではありません。' })
        return
      }
      setValidating(false)
      setSaving(true)
      const result = await saveCacheConfig(cloneWebCacheConfig(draft), controller.signal)
      if (!isActive(generation) || controller.signal.aborted) return
      if (responseIsFailure(result)) throw new ApiError(responseMessage(result) ?? 'Web Cache設定を保存できませんでした。')
      const configRequestId = ++configRequestIdRef.current
      const refreshed = await getCacheConfig(controller.signal)
      if (!isActive(generation)
        || controller.signal.aborted
        || !isCurrentCacheRequest(apiRevision, revisionRef.current, configRequestId, configRequestIdRef.current)) return
      if (responseIsFailure(refreshed)) throw new ApiError(responseMessage(refreshed) ?? '保存後のWeb Cache設定を取得できませんでした。')
      const nextConfig = responseConfig(refreshed)
      setServerConfig(nextConfig)
      applyEditableConfig(nextConfig)
      setHasRuntimeOverride(responseRuntimeOverride(refreshed))
      setValidationIssues([])
      setFeedback({ tone: 'success', message: 'Web Cache設定を保存しました。現在のDashboard上で有効です。' })
    } catch (error) {
      if (!isActive(generation) || controller.signal.aborted) return
      const messages = getValidationMessagesFromError(error)
      if (messages.length > 0) setValidationIssues(messages.map((message) => ({ message })))
      setFeedback({ tone: 'danger', message: errorMessage(error) })
    } finally {
      endMutation(controller)
      if (isActive(generation) && !controller.signal.aborted) {
        setValidating(false)
        setSaving(false)
      }
    }
  }, [apiRevision, applyEditableConfig, beginMutation, configUncertain, draft, endMutation, isActive, saving, setServerConfig, validating])

  const reset = useCallback(async () => {
    if (resetting) return
    const generation = generationRef.current
    const controller = beginMutation()
    if (!controller) return
    setResetting(true)
    setFeedback(null)
    try {
      const result = await resetCacheConfig(controller.signal)
      if (!isActive(generation) || controller.signal.aborted) return
      if (responseIsFailure(result)) throw new ApiError(responseMessage(result) ?? 'Web Cache設定をリセットできませんでした。')
      configUncertainRef.current = true
      setConfigUncertain(true)
      const refreshed = await loadConfig(false, generation)
      if (!isActive(generation) || controller.signal.aborted) return
      if (refreshed !== 'success') return
      setFeedback({ tone: 'success', message: 'Web Cache設定を初期値へリセットしました。' })
    } catch (error) {
      if (!isActive(generation) || controller.signal.aborted) return
      setFeedback({ tone: 'danger', message: errorMessage(error) })
    } finally {
      endMutation(controller)
      if (isActive(generation) && !controller.signal.aborted) setResetting(false)
    }
  }, [beginMutation, endMutation, isActive, loadConfig, resetting])

  const runSync = useCallback(async () => {
    if (syncing || cancelPending || status?.isRunning) return
    const generation = generationRef.current
    const controller = beginMutation()
    if (!controller) return
    setSyncing(true)
    setFeedback(null)
    try {
      const result = await runCacheSync(createCacheSyncRequest(syncGroupId, syncForce), controller.signal)
      if (!isActive(generation) || controller.signal.aborted) return
      if (responseIsFailure(result)) throw new ApiError(responseMessage(result) ?? '同期を開始できませんでした。')
      const start = result as WebBookCacheSyncStartResponse
      if (start.started === false) {
        setFeedback({ tone: 'warning', message: start.message ?? '同期は開始されませんでした。' })
        if (start.status) setStatus(start.status)
      } else {
        if (start.status) setStatus(start.status)
        else await loadStatus(generation, true)
        setFeedback({ tone: 'success', message: start.message ?? 'Web Cache同期を開始しました。' })
      }
    } catch (error) {
      if (!isActive(generation) || controller.signal.aborted) return
      setFeedback({ tone: 'danger', message: errorMessage(error) })
    } finally {
      endMutation(controller)
      if (isActive(generation) && !controller.signal.aborted) setSyncing(false)
    }
  }, [beginMutation, cancelPending, endMutation, isActive, loadStatus, status?.isRunning, syncForce, syncGroupId, syncing, setStatus])

  const cancel = useCallback(async () => {
    if (cancelPending || !status?.isRunning) return
    const generation = generationRef.current
    const controller = beginMutation()
    if (!controller) return
    setCancelPending(true)
    setFeedback(null)
    try {
      const result = await cancelCacheSync(controller.signal)
      if (!isActive(generation) || controller.signal.aborted) return
      if (responseIsFailure(result)) throw new ApiError(responseMessage(result) ?? '同期キャンセルを要求できませんでした。')
      setFeedback({ tone: 'info', message: responseMessage(result) ?? 'キャンセルを要求しました。同期の終了を確認しています。' })
      await loadStatus(generation, true)
    } catch (error) {
      if (!isActive(generation) || controller.signal.aborted) return
      setCancelPending(false)
      setFeedback({ tone: 'danger', message: errorMessage(error) })
    } finally {
      endMutation(controller)
    }
  }, [beginMutation, cancelPending, endMutation, isActive, loadStatus, status?.isRunning])

  const testSite = useCallback(async (groupId: string) => {
    const normalized = groupId.trim()
    if (!normalized || testingGroupId) return
    const savedSite = serverConfig?.sites.find((site) => site.groupId?.trim() === normalized)
    if (!savedSite) {
      setSiteTests((current) => ({ ...current, [normalized]: { tone: 'warning', message: '保存済みサイトのみ疎通テストできます。先に設定を保存してください。' } }))
      return
    }
    const generation = generationRef.current
    const controller = beginMutation()
    if (!controller) return
    setTestingGroupId(normalized)
    try {
      const result = await testCacheSite(normalized, controller.signal)
      if (!isActive(generation) || controller.signal.aborted) return
      if (responseIsFailure(result)) throw new ApiError(responseMessage(result) ?? 'サイト疎通テストに失敗しました。')
      const testResult = result as WebBookCacheSiteTestResponse
      const detail = typeof testResult.bookCount === 'number'
        ? `取得件数 ${formatNumber(testResult.bookCount)}、ページ ${formatNumber(testResult.currentPage)} / ${formatNumber(testResult.totalPage)}`
        : ''
      setSiteTests((current) => ({
        ...current,
        [normalized]: {
          tone: testResult.success === false ? 'warning' : 'success',
          message: testResult.message ?? (testResult.success === false ? 'サイト疎通テストに失敗しました。' : `疎通テストに成功しました。${detail ? ` ${detail}` : ''}`),
        },
      }))
    } catch (error) {
      if (!isActive(generation) || controller.signal.aborted) return
      setSiteTests((current) => ({ ...current, [normalized]: { tone: 'danger', message: errorMessage(error) } }))
    } finally {
      endMutation(controller)
      if (isActive(generation) && !controller.signal.aborted) setTestingGroupId(null)
    }
  }, [beginMutation, endMutation, isActive, serverConfig?.sites, testingGroupId])

  const resolveConfirmation = useCallback(() => {
    const action = confirmAction
    setConfirmAction(null)
    if (!action) return
    if (action.kind === 'reset') void reset()
    else removeSite(action.index)
  }, [confirmAction, removeSite, reset])

  const runtimeNotice = hasRuntimeOverride
    ? '現在のDashboardで変更したRAM overrideを表示しています。ApiService再起動後は構成ファイルの初期値へ戻ります。'
    : 'Dashboardでの変更はRAM overrideです。ApiService再起動後は構成ファイルの初期値へ戻ります。'

  const draftDirty = useMemo(() => (
    draft !== null && serverConfig !== null && JSON.stringify(draft) !== JSON.stringify(serverConfig)
  ), [draft, serverConfig])
  const resetDisabled = resetting || saving || validating || syncing || cancelPending
  const saveDisabled = configUncertain || !canSaveWebCacheConfig(draft, saving, validating) || localIssues.length > 0 || resetting
  const statusTone = status?.isRunning ? 'info' : statusError ? 'danger' : 'success'

  return (
    <section className="web-cache-management" aria-labelledby="web-cache-management-title" aria-busy={configLoading || statusLoading}>
      <header className="web-cache-management__header">
        <div className="web-cache-management__heading">
          <span className="web-cache-management__heading-icon" aria-hidden="true"><Database size={21} /></span>
          <div>
            <h2 id="web-cache-management-title" className="web-cache-management__title">同期と設定</h2>
            <p>キャッシュ候補の同期と自動ダウンロードを管理します。</p>
          </div>
        </div>
        <div className="web-cache-management__header-actions">
          <Button variant="outline" tone="neutral" size="compact" type="button" onClick={() => void loadConfig(true)} disabled={configLoading || saving || validating || resetting}>
            <RefreshCw size={15} aria-hidden="true" /> 設定を再取得
          </Button>
          <IconButton variant="ghost" tone="neutral" size="compact" type="button" aria-label="状態を更新" onClick={() => void loadStatus()} disabled={statusLoading}>
            <RefreshCw size={16} aria-hidden="true" />
          </IconButton>
        </div>
      </header>

      <div className="web-cache-management__notices">
        <div className="web-cache-management__notice web-cache-management__notice--warning" role="note"><CircleHelp size={16} aria-hidden="true" /><span>{runtimeNotice}</span></div>
        <div className="web-cache-management__notice web-cache-management__notice--info" role="note"><TestTube2 size={16} aria-hidden="true" /><span>サイト疎通テストは保存済みで有効なサイト設定を対象に実行します。</span></div>
      </div>

      {configError && <div className="web-cache-management__alert web-cache-management__alert--danger" role="alert"><CircleAlert size={16} aria-hidden="true" /><span>{configError}</span><Button variant="ghost" tone="danger" size="compact" type="button" onClick={() => void loadConfig(true)} disabled={configLoading}>再試行</Button></div>}
      {statusError && <div className="web-cache-management__alert web-cache-management__alert--danger" role="alert"><CircleAlert size={16} aria-hidden="true" /><span>{statusError}</span><Button variant="ghost" tone="danger" size="compact" type="button" onClick={() => void loadStatus()} disabled={statusLoading}>再試行</Button></div>}
      {feedback && <div className={`web-cache-management__alert web-cache-management__alert--${feedback.tone}`} role={feedback.tone === 'danger' ? 'alert' : 'status'}><span>{feedback.message}</span></div>}

      {allValidationMessages.length > 0 && (
        <div className="web-cache-management__validation" role="alert">
          <strong>設定を保存できません。</strong>
          <ul>{allValidationMessages.map((message, index) => <li key={`${message}-${index}`}>{message}</li>)}</ul>
        </div>
      )}

      <section className="web-cache-management__section" aria-labelledby="web-cache-sync-status-title">
        <div className="web-cache-management__section-heading"><div><h2 id="web-cache-sync-status-title">同期状態</h2><p>Web Cache同期の現在値と前回実行結果。</p></div><span className={`web-cache-management__status web-cache-management__status--${statusTone}`}>{status?.isRunning ? <Activity size={14} aria-hidden="true" /> : <Check size={14} aria-hidden="true" />}{status?.isRunning ? '実行中' : '待機'}</span></div>
        <div className="web-cache-management__metrics">
          <Metric icon={Server} label="実行中サイト" value={status?.currentSite || '—'} tone={status?.isRunning ? 'info' : 'muted'} />
          <Metric icon={Gauge} label="取得ページ" value={formatNumber(status?.pagesLoaded)} tone="info" />
          <Metric icon={Database} label="取得詳細" value={formatNumber(status?.detailsLoaded)} tone="info" />
          <Metric icon={Plus} label="作成 / 更新" value={`${formatNumber(status?.createdCount)} / ${formatNumber(status?.updatedCount)}`} tone="success" />
          <Metric icon={HardDrive} label="自動判定 / 投入" value={`${formatNumber(status?.autoDownloadMatchedCount)} / ${formatNumber(status?.autoDownloadEnqueuedCount)}`} tone="warning" />
        </div>
        <dl className="web-cache-management__details-grid">
          <div><dt>前回開始</dt><dd>{formatDateTime(status?.lastStartedAt)}</dd></div>
          <div><dt>前回終了</dt><dd>{formatDateTime(status?.lastFinishedAt)}</dd></div>
          <div><dt>次回実行</dt><dd>{formatDateTime(status?.nextRunAt)}</dd></div>
          <div><dt>最終エラー</dt><dd className={status?.lastError ? 'web-cache-management__value--danger' : undefined}>{status?.lastError || 'なし'}</dd></div>
        </dl>
      </section>

      <section className="web-cache-management__section" aria-labelledby="web-cache-manual-sync-title">
        <div className="web-cache-management__section-heading"><div><h2 id="web-cache-manual-sync-title">手動同期</h2><p>全サイトまたは特定GroupIdを指定して同期を開始します。</p></div></div>
        <div className="web-cache-management__form-grid web-cache-management__form-grid--sync">
          <Field label="対象GroupId"><input className="web-cache-management__input" value={syncGroupId} onChange={(event) => setSyncGroupId(event.target.value)} placeholder="全サイト" disabled={syncing || status?.isRunning} /></Field>
          <Toggle label="Force（既存の次回実行を待たずに実行）" checked={syncForce} onChange={setSyncForce} disabled={syncing || status?.isRunning} />
          <div className="web-cache-management__inline-actions web-cache-management__sync-actions"><Button variant="solid" tone="accent" type="button" onClick={() => void runSync()} disabled={syncing || cancelPending || !!status?.isRunning}>{syncing ? <><RefreshCw size={15} className="is-spinning" aria-hidden="true" /> 開始中…</> : <><Activity size={15} aria-hidden="true" /> 同期開始</>}</Button><Button variant="outline" tone="danger" type="button" onClick={() => void cancel()} disabled={cancelPending || !status?.isRunning}>{cancelPending ? '終了待ち…' : <><Square size={14} aria-hidden="true" /> キャンセル</>}</Button></div>
        </div>
      </section>

      {draft && (
        <>
          <fieldset className="web-cache-management__fieldset" disabled={saving || validating || resetting}>
          <section className="web-cache-management__section" aria-labelledby="web-cache-global-title">
            <div className="web-cache-management__section-heading"><div><h2 id="web-cache-global-title">全体設定</h2><p>同期スケジュールと1回あたりの取得上限。</p></div><span className="web-cache-management__draft-badge">編集用コピー</span></div>
            <div className="web-cache-management__form-grid">
              <Field label="有効"><Toggle label="Web Cache同期を有効にする" checked={draft.enabled} onChange={(value) => updateDraft((current) => ({ ...current, enabled: value }))} /></Field>
              <Field label="同期間隔（分）" error={issueFor('intervalMinutes')}><input className="web-cache-management__input" type="number" min="1" step="1" value={Number.isNaN(draft.intervalMinutes) ? '' : draft.intervalMinutes} onChange={(event) => updateGlobalNumber('intervalMinutes', updateNumber(event))} /></Field>
              <Field label="初回探索日数" error={issueFor('initialLookbackDays')}><input className="web-cache-management__input" type="number" min="0" step="1" value={Number.isNaN(draft.initialLookbackDays) ? '' : draft.initialLookbackDays} onChange={(event) => updateGlobalNumber('initialLookbackDays', updateNumber(event))} /></Field>
              <Field label="1回の最大ページ数" error={issueFor('maxPagesPerRun')}><input className="web-cache-management__input" type="number" min="1" step="1" value={Number.isNaN(draft.maxPagesPerRun) ? '' : draft.maxPagesPerRun} onChange={(event) => updateGlobalNumber('maxPagesPerRun', updateNumber(event))} /></Field>
              <Field label="1回の最大詳細件数" error={issueFor('maxDetailsPerRun')}><input className="web-cache-management__input" type="number" min="1" step="1" value={Number.isNaN(draft.maxDetailsPerRun) ? '' : draft.maxDetailsPerRun} onChange={(event) => updateGlobalNumber('maxDetailsPerRun', updateNumber(event))} /></Field>
            </div>
          </section>

          <section className="web-cache-management__section" aria-labelledby="web-cache-sites-title">
            <div className="web-cache-management__section-heading"><div><h2 id="web-cache-sites-title">サイト別設定</h2><p>GroupIdごとの開始URL、取得上限、ドメイン間隔。</p></div><Button variant="outline" tone="accent" size="compact" type="button" onClick={addSite} disabled={saving || validating}><Plus size={15} aria-hidden="true" /> サイトを追加</Button></div>
            {draft.sites.length === 0 ? <div className="web-cache-management__empty">サイト設定がありません。「サイトを追加」から登録してください。</div> : <div className="web-cache-management__site-list">{draft.sites.map((site, index) => {
              const groupId = site.groupId?.trim() ?? ''
              const siteResult = siteTests[groupId]
              return <article className="web-cache-management__site-card" key={`${index}-${groupId}`}>
                <div className="web-cache-management__site-heading"><div><span className="web-cache-management__site-index">SITE {index + 1}</span><h3>{groupId || '新しいサイト'}</h3></div><div className="web-cache-management__site-actions"><Button variant="outline" tone="neutral" size="compact" type="button" onClick={() => void testSite(groupId)} disabled={!groupId || testingGroupId !== null || saving || validating}><TestTube2 size={14} aria-hidden="true" /> {testingGroupId === groupId ? '試験中…' : '疎通テスト'}</Button><IconButton variant="ghost" tone="danger" size="compact" type="button" aria-label={`${groupId || 'サイト'}を削除`} onClick={() => confirmRemoveSite(index)} disabled={saving || validating}><Trash2 size={16} aria-hidden="true" /></IconButton></div></div>
                {siteResult && <div className={`web-cache-management__site-result web-cache-management__site-result--${siteResult.tone}`} role={siteResult.tone === 'danger' ? 'alert' : 'status'}>{siteResult.message}</div>}
                <div className="web-cache-management__form-grid">
                  <Field label="GroupId" error={issueFor(`sites.${index}.groupId`)}><input className="web-cache-management__input" value={site.groupId ?? ''} onChange={(event) => updateSite(index, 'groupId', event.target.value)} /></Field>
                  <Field label="有効"><Toggle label="このサイトを同期対象にする" checked={site.enabled === true} onChange={(value) => updateSite(index, 'enabled', value)} /></Field>
                  <Field label="StartUrl" error={issueFor(`sites.${index}.startUrl`)}><input className="web-cache-management__input" type="url" value={site.startUrl ?? ''} onChange={(event) => updateSite(index, 'startUrl', event.target.value)} placeholder="https://…" /></Field>
                  <Field label="個別間隔（分）" hint="空欄で全体設定"><input className="web-cache-management__input" type="number" min="1" step="1" value={site.intervalMinutes ?? ''} onChange={(event) => updateSite(index, 'intervalMinutes', event.target.value === '' ? null : updateNumber(event))} /></Field>
                  <Field label="最大ページ数" hint="空欄で全体設定"><input className="web-cache-management__input" type="number" min="1" step="1" value={site.maxPagesPerRun ?? ''} onChange={(event) => updateSite(index, 'maxPagesPerRun', event.target.value === '' ? null : updateNumber(event))} /></Field>
                  <Field label="最大詳細件数" hint="空欄で全体設定"><input className="web-cache-management__input" type="number" min="1" step="1" value={site.maxDetailsPerRun ?? ''} onChange={(event) => updateSite(index, 'maxDetailsPerRun', event.target.value === '' ? null : updateNumber(event))} /></Field>
                  <Field label="ドメイン間隔（ms）" hint="空欄で既定値"><input className="web-cache-management__input" type="number" min="0" step="1" value={site.domainIntervalMilliseconds ?? ''} onChange={(event) => updateSite(index, 'domainIntervalMilliseconds', event.target.value === '' ? null : updateNumber(event))} /></Field>
                </div>
              </article>
            })}</div>}
          </section>

          <section className="web-cache-management__section" aria-labelledby="web-cache-auto-download-title">
            <div className="web-cache-management__section-heading"><div><h2 id="web-cache-auto-download-title">自動ダウンロード設定</h2><p>同期した候補をダウンロードキューへ自動投入する条件。</p></div></div>
            <div className="web-cache-management__form-grid">
              <Field label="自動投入"><Toggle label="条件に一致した候補を自動投入する" checked={draft.autoDownload.enabled === true} onChange={(value) => updateAutoDownload('enabled', value)} /></Field>
              <Field label="条件の組み合わせ" error={issueFor('autoDownload.conditionMode')}><select className="web-cache-management__input" value={draft.autoDownload.conditionMode ?? 'All'} onChange={(event) => updateAutoDownload('conditionMode', event.target.value)}><option value="All">All（すべて）</option><option value="Any">Any（いずれか）</option></select></Field>
              <Field label="最大ページ数" error={issueFor('autoDownload.maxPageCount')}><input className="web-cache-management__input" type="number" min="1" step="1" value={Number.isNaN(draft.autoDownload.maxPageCount) ? '' : draft.autoDownload.maxPageCount} onChange={(event) => updateAutoDownload('maxPageCount', updateNumber(event))} /></Field>
              <Field label="1回の投入上限" error={issueFor('autoDownload.maxAutoDownloadsPerRun')}><input className="web-cache-management__input" type="number" min="0" step="1" value={Number.isNaN(draft.autoDownload.maxAutoDownloadsPerRun) ? '' : draft.autoDownload.maxAutoDownloadsPerRun} onChange={(event) => updateAutoDownload('maxAutoDownloadsPerRun', updateNumber(event))} /></Field>
              <Field label="1日の投入上限" error={issueFor('autoDownload.maxAutoDownloadsPerDay')}><input className="web-cache-management__input" type="number" min="0" step="1" value={Number.isNaN(draft.autoDownload.maxAutoDownloadsPerDay) ? '' : draft.autoDownload.maxAutoDownloadsPerDay} onChange={(event) => updateAutoDownload('maxAutoDownloadsPerDay', updateNumber(event))} /></Field>
              <Field label="必要な空き容量（GB）" error={issueFor('autoDownload.minFreeDiskGb')}><input className="web-cache-management__input" type="number" min="0" step="0.1" value={Number.isNaN(draft.autoDownload.minFreeDiskGb) ? '' : draft.autoDownload.minFreeDiskGb} onChange={(event) => updateAutoDownload('minFreeDiskGb', updateNumber(event))} /></Field>
              <Field label="許可GroupId" hint="改行またはカンマ区切り"><textarea className="web-cache-management__input web-cache-management__textarea" value={allowedGroupIdsText} onChange={(event) => { const value = event.target.value; setAllowedGroupIdsText(value); updateAutoDownload('allowedGroupIds', value.split(/[\n,]/).map((entry) => entry.trim()).filter(Boolean)) }} onBlur={() => { const values = allowedGroupIdsText.split(/[\n,]/).map((entry) => entry.trim()).filter(Boolean); updateAutoDownload('allowedGroupIds', values); setAllowedGroupIdsText(values.join('\n')) }} /></Field>
              <Field label="除外タグ" hint="改行またはカンマ区切り"><textarea className="web-cache-management__input web-cache-management__textarea" value={excludedTagsText} onChange={(event) => { const value = event.target.value; setExcludedTagsText(value); updateAutoDownload('excludedTags', value.split(/[\n,]/).map((entry) => entry.trim()).filter(Boolean)) }} onBlur={() => { const values = excludedTagsText.split(/[\n,]/).map((entry) => entry.trim()).filter(Boolean); updateAutoDownload('excludedTags', values); setExcludedTagsText(values.join('\n')) }} /></Field>
            </div>
          </section>
          </fieldset>

          <footer className="web-cache-management__form-footer">
            <span className="web-cache-management__footer-meta">{draftDirty ? '未保存の編集があります。' : serverConfig?.updatedAt ? `最終保存: ${formatDateTime(serverConfig.updatedAt)}` : '保存済み設定を編集中です。'}</span>
            <div className="web-cache-management__inline-actions"><Button variant="outline" tone="warning" type="button" onClick={() => setConfirmAction({ kind: 'reset' })} disabled={resetDisabled}><RotateCcw size={15} aria-hidden="true" /> 初期値へリセット</Button><Button variant="solid" tone="accent" type="button" onClick={() => void save()} disabled={saveDisabled}>{saving || validating ? <><RefreshCw size={15} className="is-spinning" aria-hidden="true" /> {validating ? '検証中…' : '保存中…'}</> : <><Save size={15} aria-hidden="true" /> 設定を保存</>}</Button></div>
          </footer>
        </>
      )}

      <Dialog
        open={confirmAction !== null}
        onRequestClose={() => { setConfirmAction(null); return true }}
        aria-labelledby="web-cache-confirm-title"
      >
        <DialogHeader><h2 id="web-cache-confirm-title">操作の確認</h2><IconButton variant="ghost" tone="neutral" size="compact" type="button" aria-label="閉じる" onClick={() => setConfirmAction(null)}><X size={16} aria-hidden="true" /></IconButton></DialogHeader>
        <DialogBody>{confirmAction?.kind === 'reset' ? <p>Web Cache設定を構成ファイルの初期値へ戻します。現在の編集内容も破棄されます。</p> : <p>{confirmAction?.groupId ? `GroupId「${confirmAction.groupId}」のサイト設定を編集用コピーから削除します。保存時に反映されます。` : 'このサイト設定を編集用コピーから削除します。保存時に反映されます。'}</p>}</DialogBody>
        <DialogFooter><Button variant="outline" tone="neutral" type="button" onClick={() => setConfirmAction(null)}>キャンセル</Button><Button variant="solid" tone="danger" type="button" onClick={resolveConfirmation}>{confirmAction?.kind === 'reset' ? 'リセットする' : '削除する'}</Button></DialogFooter>
      </Dialog>
    </section>
  )
}

export default WebCacheManagement
