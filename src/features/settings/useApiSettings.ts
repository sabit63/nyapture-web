import { useCallback, useEffect, useRef, useState, type Dispatch, type FormEvent, type RefObject, type SetStateAction } from 'react'

import {
  API_PROXY_PROTOCOLS,
  DEFAULT_API_SETTINGS,
  configureApi,
  getErrorMessage,
  normalizeDisplaySettings,
  testApiConnection as testApiConnectionRequest,
  validateApiSettings,
} from '../../api'
import type { ApiProxyProtocol, ApiSettings, ApiSettingsErrors, DisplaySettings } from '../../api'
import type { NativeDialogControls } from '../../components/ui'
import { loadAppSettings, saveAppSettings } from '../../api/app-settings-storage'
import { applyColorTheme } from '../../app/color-theme'

export type ApiConnectionState = 'idle' | 'pending' | 'success' | 'error'

export const API_CONNECTION_STATE_LABELS: Record<ApiConnectionState, string> = {
  idle: '未確認',
  pending: '確認中',
  success: '接続済み',
  error: '接続エラー',
}

export type ApiSettingsController = {
  apiSettings: ApiSettings
  apiSettingsDraft: ApiSettings
  displaySettings: DisplaySettings
  displaySettingsDraft: DisplaySettings
  apiSettingsOpen: boolean
  displaySettingsOpen: boolean
  apiSettingsErrors: ApiSettingsErrors
  apiSettingsSaveError: string
  displaySettingsSaveError: string
  apiKeyVisible: boolean
  editKeyVisible: boolean
  draftConnectionState: ApiConnectionState
  draftConnectionError: string
  activeConnectionState: ApiConnectionState
  apiRevision: number
  apiSettingsDialogRef: RefObject<HTMLDialogElement | null>
  displaySettingsDialogRef: RefObject<HTMLDialogElement | null>
  apiSettingsTriggerRef: RefObject<HTMLButtonElement | null>
  displaySettingsTriggerRef: RefObject<HTMLButtonElement | null>
  openApiSettings: () => void
  openDisplaySettings: () => void
  requestApiSettingsClose: (reason: Parameters<NativeDialogControls['requestClose']>[0]) => boolean
  requestDisplaySettingsClose: (reason: Parameters<NativeDialogControls['requestClose']>[0]) => boolean
  afterApiSettingsClose: () => void
  afterDisplaySettingsClose: () => void
  clearDraftConnectionCheck: () => void
  testApiConnection: (settings?: ApiSettings) => Promise<void>
  saveApiSettings: (event: FormEvent<HTMLFormElement>, requestClose: NativeDialogControls['requestClose']) => void
  saveDisplaySettings: (event: FormEvent<HTMLFormElement>, requestClose: NativeDialogControls['requestClose']) => void
  resetApiSettings: (requestClose: NativeDialogControls['requestClose']) => void
  setApiKeyVisible: (visible: boolean | ((current: boolean) => boolean)) => void
  setEditKeyVisible: (visible: boolean | ((current: boolean) => boolean)) => void
  setApiSettingsDraft: Dispatch<SetStateAction<ApiSettings>>
  setApiSettingsErrors: Dispatch<SetStateAction<ApiSettingsErrors>>
  setApiSettingsSaveError: Dispatch<SetStateAction<string>>
  setDisplaySettingsSaveError: Dispatch<SetStateAction<string>>
  setDisplaySettingsDraft: Dispatch<SetStateAction<DisplaySettings>>
}

export function useApiSettings(notify: (message: string, tone?: 'success' | 'warning' | 'error') => void): ApiSettingsController {
  const [initialSettings] = useState(loadAppSettings)
  const [apiSettings, setApiSettings] = useState<ApiSettings>(() => configureApi(initialSettings.api))
  const [apiSettingsDraft, setApiSettingsDraft] = useState<ApiSettings>(() => ({ ...apiSettings }))
  const [displaySettings, setDisplaySettings] = useState<DisplaySettings>(initialSettings.display)
  const [displaySettingsDraft, setDisplaySettingsDraft] = useState<DisplaySettings>(() => ({ ...displaySettings }))
  const [apiSettingsOpen, setApiSettingsOpen] = useState(false)
  const [displaySettingsOpen, setDisplaySettingsOpen] = useState(false)
  const [apiSettingsErrors, setApiSettingsErrors] = useState<ApiSettingsErrors>({})
  const [apiSettingsSaveError, setApiSettingsSaveError] = useState('')
  const [displaySettingsSaveError, setDisplaySettingsSaveError] = useState('')
  const [apiKeyVisible, setApiKeyVisible] = useState(false)
  const [editKeyVisible, setEditKeyVisible] = useState(false)
  const [draftConnectionState, setDraftConnectionState] = useState<ApiConnectionState>('idle')
  const [draftConnectionError, setDraftConnectionError] = useState('')
  const [activeConnectionState, setActiveConnectionState] = useState<ApiConnectionState>('idle')
  const [apiRevision, setApiRevision] = useState(0)
  const apiSettingsDialogRef = useRef<HTMLDialogElement>(null)
  const displaySettingsDialogRef = useRef<HTMLDialogElement>(null)
  const apiSettingsTriggerRef = useRef<HTMLButtonElement>(null)
  const displaySettingsTriggerRef = useRef<HTMLButtonElement>(null)
  const draftConnectionAbortRef = useRef<AbortController | null>(null)
  const activeConnectionAbortRef = useRef<AbortController | null>(null)
  const announceActiveConnectionRef = useRef<'save' | 'reset' | null>(null)

  useEffect(() => {
    applyColorTheme(displaySettingsOpen ? displaySettingsDraft.colorTheme : displaySettings.colorTheme)
  }, [displaySettings.colorTheme, displaySettingsDraft.colorTheme, displaySettingsOpen])

  const clearDraftConnectionCheck = useCallback(() => {
    draftConnectionAbortRef.current?.abort()
    draftConnectionAbortRef.current = null
    setDraftConnectionError('')
    setDraftConnectionState('idle')
  }, [])

  const testApiConnection = useCallback(async (settings: ApiSettings = apiSettingsDraft) => {
    const { normalized, errors } = validateApiSettings(settings)
    setApiSettingsErrors(errors)
    if (!normalized) return

    setApiSettingsDraft(normalized)
    setApiSettingsSaveError('')
    clearDraftConnectionCheck()
    setDraftConnectionState('pending')
    const controller = new AbortController()
    draftConnectionAbortRef.current = controller
    try {
      await testApiConnectionRequest(normalized, controller.signal)
      if (controller.signal.aborted) return
      setDraftConnectionState('success')
    } catch (error) {
      if (controller.signal.aborted) return
      setDraftConnectionError(getErrorMessage(error))
      setDraftConnectionState('error')
    } finally {
      if (draftConnectionAbortRef.current === controller) draftConnectionAbortRef.current = null
    }
  }, [apiSettingsDraft, clearDraftConnectionCheck])

  const openApiSettings = useCallback(() => {
    const nextDraft = { ...apiSettings }
    clearDraftConnectionCheck()
    setApiKeyVisible(false)
    setEditKeyVisible(false)
    setApiSettingsDraft(nextDraft)
    setApiSettingsErrors({})
    setApiSettingsSaveError('')
    setApiSettingsOpen(true)
    void testApiConnection(nextDraft)
  }, [apiSettings, clearDraftConnectionCheck, testApiConnection])

  const openDisplaySettings = useCallback(() => {
    setDisplaySettingsDraft({ ...displaySettings })
    setDisplaySettingsSaveError('')
    setDisplaySettingsOpen(true)
  }, [displaySettings])

  const prepareApiSettingsClose = useCallback(() => {
    clearDraftConnectionCheck()
    setApiKeyVisible(false)
    setEditKeyVisible(false)
  }, [clearDraftConnectionCheck])

  const requestApiSettingsClose = useCallback((_reason: Parameters<NativeDialogControls['requestClose']>[0]) => {
    prepareApiSettingsClose()
    setApiSettingsOpen(false)
    return true
  }, [prepareApiSettingsClose])

  const afterApiSettingsClose = useCallback(() => {
    prepareApiSettingsClose()
    setApiSettingsOpen(false)
  }, [prepareApiSettingsClose])

  const requestDisplaySettingsClose = useCallback((_reason: Parameters<NativeDialogControls['requestClose']>[0]) => {
    setDisplaySettingsOpen(false)
    return true
  }, [])

  const afterDisplaySettingsClose = useCallback(() => {
    setDisplaySettingsOpen(false)
  }, [])

  const saveApiSettings = useCallback((event: FormEvent<HTMLFormElement>, requestClose: NativeDialogControls['requestClose']) => {
    event.preventDefault()
    const { normalized, errors } = validateApiSettings(apiSettingsDraft)
    setApiSettingsErrors(errors)
    if (!normalized) return

    try {
      saveAppSettings({ api: normalized, display: displaySettings })
    } catch {
      setApiSettingsSaveError('設定を端末へ保存できませんでした。ブラウザのストレージ設定を確認してください。')
      return
    }

    clearDraftConnectionCheck()
    configureApi(normalized)
    setApiSettings(normalized)
    setApiSettingsDraft(normalized)
    announceActiveConnectionRef.current = 'save'
    setApiRevision((current) => current + 1)
    requestClose('submit')
  }, [apiSettingsDraft, clearDraftConnectionCheck, displaySettings])

  const saveDisplaySettings = useCallback((event: FormEvent<HTMLFormElement>, requestClose: NativeDialogControls['requestClose']) => {
    event.preventDefault()
    const normalizedDisplaySettings = normalizeDisplaySettings(displaySettingsDraft)

    try {
      saveAppSettings({ api: apiSettings, display: normalizedDisplaySettings })
    } catch {
      setDisplaySettingsSaveError('表示設定を端末へ保存できませんでした。ブラウザのストレージ設定を確認してください。')
      return
    }

    setDisplaySettings(normalizedDisplaySettings)
    setDisplaySettingsDraft(normalizedDisplaySettings)
    setDisplaySettingsSaveError('')
    requestClose('submit')
    notify('表示設定を保存しました')
  }, [apiSettings, displaySettingsDraft, notify])

  const resetApiSettings = useCallback((requestClose: NativeDialogControls['requestClose']) => {
    if (!window.confirm('端末に保存したAPI設定を削除し、既定値へ戻しますか？')) return

    try {
      saveAppSettings({ api: DEFAULT_API_SETTINGS, display: displaySettings })
    } catch {
      setApiSettingsSaveError('端末に保存したAPI設定を削除できませんでした。ブラウザのストレージ設定を確認してください。')
      return
    }

    const defaults = configureApi({ ...DEFAULT_API_SETTINGS })
    clearDraftConnectionCheck()
    setApiSettings(defaults)
    setApiSettingsDraft(defaults)
    setApiSettingsErrors({})
    setApiSettingsSaveError('')
    announceActiveConnectionRef.current = 'reset'
    setApiRevision((current) => current + 1)
    requestClose('submit')
  }, [clearDraftConnectionCheck, displaySettings])

  useEffect(() => {
    activeConnectionAbortRef.current?.abort()
    const controller = new AbortController()
    activeConnectionAbortRef.current = controller
    const announcedAction = announceActiveConnectionRef.current
    setActiveConnectionState('pending')

    void testApiConnectionRequest(undefined, controller.signal)
      .then(() => {
        if (controller.signal.aborted) return
        setActiveConnectionState('success')
        if (announcedAction === 'save') notify('API設定を保存し、接続を確認しました')
        if (announcedAction === 'reset') notify('API設定を既定値へ戻し、接続を確認しました')
        if (announceActiveConnectionRef.current === announcedAction) announceActiveConnectionRef.current = null
      })
      .catch(() => {
        if (controller.signal.aborted) return
        setActiveConnectionState('error')
        if (announcedAction === 'save') notify('API設定を保存しましたが、接続を確認できませんでした', 'warning')
        if (announcedAction === 'reset') notify('API設定を既定値へ戻しましたが、接続を確認できませんでした', 'warning')
        if (announceActiveConnectionRef.current === announcedAction) announceActiveConnectionRef.current = null
      })
      .finally(() => {
        if (activeConnectionAbortRef.current === controller) activeConnectionAbortRef.current = null
      })

    return () => controller.abort()
  }, [apiRevision, notify])

  return {
    apiSettings,
    apiSettingsDraft,
    displaySettings,
    displaySettingsDraft,
    apiSettingsOpen,
    displaySettingsOpen,
    apiSettingsErrors,
    apiSettingsSaveError,
    displaySettingsSaveError,
    apiKeyVisible,
    editKeyVisible,
    draftConnectionState,
    draftConnectionError,
    activeConnectionState,
    apiRevision,
    apiSettingsDialogRef,
    displaySettingsDialogRef,
    apiSettingsTriggerRef,
    displaySettingsTriggerRef,
    openApiSettings,
    openDisplaySettings,
    requestApiSettingsClose,
    requestDisplaySettingsClose,
    afterApiSettingsClose,
    afterDisplaySettingsClose,
    clearDraftConnectionCheck,
    testApiConnection,
    saveApiSettings,
    saveDisplaySettings,
    resetApiSettings,
    setApiKeyVisible,
    setEditKeyVisible,
    setApiSettingsDraft,
    setApiSettingsErrors,
    setApiSettingsSaveError,
    setDisplaySettingsSaveError,
    setDisplaySettingsDraft,
  }
}

export { API_PROXY_PROTOCOLS, type ApiProxyProtocol }
