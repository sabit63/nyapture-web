import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

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
import type {
  WebBookCacheConfigDto,
  WebBookCacheConfigResponse,
  WebBookCacheSiteTestResponse,
  WebBookCacheSyncStartResponse,
  WebBookCacheValidationResponse,
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
import { useCacheDraft } from './use-cache-draft'
import { useCacheSyncStatus } from './use-cache-sync-status'

export type WebCacheManagementFeedback = {
  tone: 'success' | 'warning' | 'danger' | 'info'
  message: string
}

export type WebCacheSiteTestResult = {
  tone: 'success' | 'warning' | 'danger'
  message: string
}

/** Extract the optional message shared by Web Cache command responses. */
export const getWebCacheResponseMessage = (value: unknown): string | null => {
  if (!value || typeof value !== 'object') return null
  const message = (value as { message?: unknown }).message
  return typeof message === 'string' && message.trim() ? message.trim() : null
}

/** Web Cache commands can return an application-level failure without throwing. */
export const isWebCacheResponseFailure = (value: unknown) => (
  !!value
  && typeof value === 'object'
  && (value as { success?: unknown }).success === false
)

export const getWebCacheResponseConfig = (
  value: WebBookCacheConfigResponse | WebBookCacheConfigDto,
): WebCacheConfigDraft => {
  if (value && typeof value === 'object' && 'config' in value && value.config) {
    return cloneWebCacheConfig(value.config)
  }
  return cloneWebCacheConfig(value as WebBookCacheConfigDto)
}

export const hasWebCacheRuntimeOverride = (
  value: WebBookCacheConfigResponse | WebBookCacheConfigDto,
) => (
  !!(value && typeof value === 'object' && 'hasRuntimeOverride' in value && value.hasRuntimeOverride)
)

const errorMessage = (error: unknown) => {
  const validationErrors = getValidationMessagesFromError(error)
  if (validationErrors.length > 0) return validationErrors.join('\n')
  if (error instanceof ApiError && error.message.trim()) return error.message
  return getErrorMessage(error)
}

const formatNumber = (value?: number | null) => (
  typeof value === 'number' && Number.isFinite(value)
    ? new Intl.NumberFormat('ja-JP').format(value)
    : '—'
)

export function useCacheManagement(apiRevision: number) {
  const draftController = useCacheDraft()
  const {
    serverConfig,
    setServerConfig,
    draft,
    setDraft,
    draftRef,
    setAllowedGroupIdsText,
    setExcludedTagsText,
    applyEditableConfig,
  } = draftController
  const statusController = useCacheSyncStatus(apiRevision)
  const {
    status,
    setStatus,
    loadStatus,
  } = statusController
  const [hasRuntimeOverride, setHasRuntimeOverride] = useState(false)
  const [configLoading, setConfigLoading] = useState(true)
  const [configError, setConfigError] = useState<string | null>(null)
  const [configUncertain, setConfigUncertain] = useState(false)
  const configUncertainRef = useRef(false)
  const [validationIssues, setValidationIssues] = useState<Array<{ path?: string; message: string }>>([])
  const [feedback, setFeedback] = useState<WebCacheManagementFeedback | null>(null)
  const [validating, setValidating] = useState(false)
  const [saving, setSaving] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [cancelPending, setCancelPending] = useState(false)
  const [syncGroupId, setSyncGroupId] = useState('')
  const [syncForce, setSyncForce] = useState(false)
  const [testingGroupId, setTestingGroupId] = useState<string | null>(null)
  const [siteTests, setSiteTests] = useState<Record<string, WebCacheSiteTestResult>>({})

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
      if (isWebCacheResponseFailure(result)) throw new ApiError(getWebCacheResponseMessage(result) ?? 'Web Cache設定を取得できませんでした。')
      const nextConfig = getWebCacheResponseConfig(result)
      setServerConfig(nextConfig)
      setHasRuntimeOverride(hasWebCacheRuntimeOverride(result))
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
      if (isWebCacheResponseFailure(validation) || validation?.isValid !== true) {
        const messages = (validation as WebBookCacheValidationResponse | null | undefined)?.errors ?? []
        setValidationIssues(messages.filter((message): message is string => typeof message === 'string').map((message) => ({ message })))
        setFeedback({ tone: 'warning', message: getWebCacheResponseMessage(validation) ?? '設定を保存できる状態ではありません。' })
        return
      }
      setValidating(false)
      setSaving(true)
      const result = await saveCacheConfig(cloneWebCacheConfig(draft), controller.signal)
      if (!isActive(generation) || controller.signal.aborted) return
      if (isWebCacheResponseFailure(result)) throw new ApiError(getWebCacheResponseMessage(result) ?? 'Web Cache設定を保存できませんでした。')
      const configRequestId = ++configRequestIdRef.current
      const refreshed = await getCacheConfig(controller.signal)
      if (!isActive(generation)
        || controller.signal.aborted
        || !isCurrentCacheRequest(apiRevision, revisionRef.current, configRequestId, configRequestIdRef.current)) return
      if (isWebCacheResponseFailure(refreshed)) throw new ApiError(getWebCacheResponseMessage(refreshed) ?? '保存後のWeb Cache設定を取得できませんでした。')
      const nextConfig = getWebCacheResponseConfig(refreshed)
      setServerConfig(nextConfig)
      applyEditableConfig(nextConfig)
      setHasRuntimeOverride(hasWebCacheRuntimeOverride(refreshed))
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
      if (isWebCacheResponseFailure(result)) throw new ApiError(getWebCacheResponseMessage(result) ?? 'Web Cache設定をリセットできませんでした。')
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
      if (isWebCacheResponseFailure(result)) throw new ApiError(getWebCacheResponseMessage(result) ?? '同期を開始できませんでした。')
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
      if (isWebCacheResponseFailure(result)) throw new ApiError(getWebCacheResponseMessage(result) ?? '同期キャンセルを要求できませんでした。')
      setFeedback({ tone: 'info', message: getWebCacheResponseMessage(result) ?? 'キャンセルを要求しました。同期の終了を確認しています。' })
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
      if (isWebCacheResponseFailure(result)) throw new ApiError(getWebCacheResponseMessage(result) ?? 'サイト疎通テストに失敗しました。')
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

  const draftDirty = useMemo(() => (
    draft !== null && serverConfig !== null && JSON.stringify(draft) !== JSON.stringify(serverConfig)
  ), [draft, serverConfig])
  const resetDisabled = resetting || saving || validating || syncing || cancelPending
  const saveDisabled = configUncertain || !canSaveWebCacheConfig(draft, saving, validating) || localIssues.length > 0 || resetting

  return {
    ...draftController,
    ...statusController,
    hasRuntimeOverride,
    configLoading,
    configError,
    configUncertain,
    validationIssues,
    feedback,
    setFeedback,
    validating,
    saving,
    resetting,
    syncing,
    cancelPending,
    syncGroupId,
    setSyncGroupId,
    syncForce,
    setSyncForce,
    testingGroupId,
    siteTests,
    localIssues,
    allValidationMessages,
    issueFor,
    loadConfig,
    save,
    reset,
    runSync,
    cancel,
    testSite,
    draftDirty,
    resetDisabled,
    saveDisabled,
  }
}
