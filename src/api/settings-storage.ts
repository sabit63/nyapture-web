import {
  DEFAULT_API_SETTINGS,
  normalizeApiSettings,
  validateApiSettings,
} from './client'
import type { ApiSettings } from './client'

export const API_SETTINGS_STORAGE_KEY = 'nyapture.api-settings.v1'
const API_SETTINGS_STORAGE_VERSION = 1

type PersistedApiSettings = {
  version: typeof API_SETTINGS_STORAGE_VERSION
  apiUrl: string
  apiKey: string
  editKey: string
  timeoutSeconds: number
}

/** A storage operation failed without exposing any API credentials. */
export class ApiSettingsStorageError extends Error {
  constructor(message = 'API設定を保存できませんでした。') {
    super(message)
    this.name = 'ApiSettingsStorageError'
  }
}

const defaultApiSettings = (): ApiSettings => ({ ...DEFAULT_API_SETTINGS })

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

const isPersistedApiSettings = (value: unknown): value is PersistedApiSettings => (
  isRecord(value)
  && value.version === API_SETTINGS_STORAGE_VERSION
  && typeof value.apiUrl === 'string'
  && typeof value.apiKey === 'string'
  && typeof value.editKey === 'string'
  && typeof value.timeoutSeconds === 'number'
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

  if (!isPersistedApiSettings(parsed)) {
    removeInvalidRecord(storage)
    return defaultApiSettings()
  }

  const result = validateApiSettings(parsed)
  if (!result.normalized) {
    removeInvalidRecord(storage)
    return defaultApiSettings()
  }

  return result.normalized
}

/**
 * Persist validated settings. A missing or unavailable localStorage is a
 * visible failure so callers can leave the active client unchanged.
 */
export const savePersistedApiSettings = (settings: ApiSettings): void => {
  const normalized = normalizeApiSettings(settings)
  const storage = getLocalStorage()
  if (!storage) throw new ApiSettingsStorageError()

  const persisted: PersistedApiSettings = {
    version: API_SETTINGS_STORAGE_VERSION,
    ...normalized,
  }

  try {
    storage.setItem(API_SETTINGS_STORAGE_KEY, JSON.stringify(persisted))
  } catch {
    throw new ApiSettingsStorageError()
  }
}

/** Remove persisted settings. Missing browser storage is treated as empty. */
export const clearPersistedApiSettings = (): void => {
  const storage = getLocalStorage()
  if (!storage) {
    if (typeof window !== 'undefined') throw new ApiSettingsStorageError('API設定を削除できませんでした。')
    return
  }

  try {
    storage.removeItem(API_SETTINGS_STORAGE_KEY)
  } catch {
    throw new ApiSettingsStorageError('API設定を削除できませんでした。')
  }
}
