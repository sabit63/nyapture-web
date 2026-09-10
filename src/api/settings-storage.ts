import {
  DEFAULT_API_SETTINGS,
  isApiProxyProtocol,
  validateApiSettings,
} from './client'
import type { ApiProxySettings, ApiSettings } from './client'

export const API_SETTINGS_STORAGE_KEY = 'nyapture.api-settings.v1'
const API_SETTINGS_STORAGE_VERSION = 3

type PersistedApiSettingsBase = {
  apiUrl: string
  apiKey: string
  editKey: string
  timeoutSeconds: number
}

type PersistedApiSettingsV1 = PersistedApiSettingsBase & {
  version: 1
}

type PersistedApiSettingsV2 = PersistedApiSettingsBase & {
  version: 2
  proxy: Omit<ApiProxySettings, 'enabled'>
}

type PersistedApiSettings = PersistedApiSettingsBase & {
  version: typeof API_SETTINGS_STORAGE_VERSION
  proxy: ApiProxySettings
}

const defaultApiSettings = (): ApiSettings => ({
  ...DEFAULT_API_SETTINGS,
  proxy: { ...DEFAULT_API_SETTINGS.proxy },
})

const getLocalStorage = (): Storage | null => {
  if (typeof globalThis === 'undefined') return null

  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
)

const hasPersistedApiSettingsFields = (value: Record<string, unknown>) => (
  typeof value.apiUrl === 'string'
  && typeof value.apiKey === 'string'
  && typeof value.editKey === 'string'
  && typeof value.timeoutSeconds === 'number'
)

const isPersistedApiSettingsV1 = (value: unknown): value is PersistedApiSettingsV1 => (
  isRecord(value)
  && value.version === 1
  && hasPersistedApiSettingsFields(value)
)

const hasPersistedProxyFields = (value: Record<string, unknown>) => (
  isRecord(value.proxy)
  && isApiProxyProtocol(value.proxy.protocol)
  && typeof value.proxy.serverAddress === 'string'
  && (value.proxy.port === null || typeof value.proxy.port === 'number')
)

const isPersistedApiSettingsV2 = (value: unknown): value is PersistedApiSettingsV2 => (
  isRecord(value)
  && value.version === 2
  && hasPersistedApiSettingsFields(value)
  && hasPersistedProxyFields(value)
)

const isPersistedApiSettings = (value: unknown): value is PersistedApiSettings => (
  isRecord(value)
  && value.version === API_SETTINGS_STORAGE_VERSION
  && hasPersistedApiSettingsFields(value)
  && hasPersistedProxyFields(value)
  && isRecord(value.proxy)
  && typeof value.proxy.enabled === 'boolean'
)

const removeInvalidRecord = (storage: Storage) => {
  try {
    storage.removeItem(API_SETTINGS_STORAGE_KEY)
  } catch {
    // A failed cleanup must not prevent the safe default fallback.
  }
}

/**
 * Load and validate settings persisted by the UI. Storage is optional so this
 * function is safe during SSR, tests, and browsers with storage disabled.
 */
export const loadPersistedApiSettings = (): ApiSettings => {
  const storage = getLocalStorage()
  if (!storage) return defaultApiSettings()

  let raw: string | null
  try {
    raw = storage.getItem(API_SETTINGS_STORAGE_KEY)
  } catch {
    return defaultApiSettings()
  }

  if (raw === null) return defaultApiSettings()

  let parsed: unknown
  try {
    parsed = JSON.parse(raw) as unknown
  } catch {
    removeInvalidRecord(storage)
    return defaultApiSettings()
  }

  if (!isPersistedApiSettings(parsed) && !isPersistedApiSettingsV2(parsed) && !isPersistedApiSettingsV1(parsed)) {
    removeInvalidRecord(storage)
    return defaultApiSettings()
  }

  const result = validateApiSettings(isPersistedApiSettingsV1(parsed)
    ? {
        apiUrl: parsed.apiUrl,
        apiKey: parsed.apiKey,
        editKey: parsed.editKey,
        timeoutSeconds: parsed.timeoutSeconds,
        proxy: DEFAULT_API_SETTINGS.proxy,
      }
    : isPersistedApiSettingsV2(parsed)
      ? {
          ...parsed,
          proxy: {
            ...parsed.proxy,
            enabled: parsed.proxy.serverAddress.trim().length > 0 && parsed.proxy.port !== null,
          },
        }
      : parsed)
  if (!result.normalized) {
    removeInvalidRecord(storage)
    return defaultApiSettings()
  }

  return result.normalized
}
