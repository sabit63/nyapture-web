export const DISPLAY_SETTINGS_STORAGE_KEY = 'nyapture.display-settings.v1'
export const DEFAULT_THUMBNAIL_COLUMNS = 5
export const MIN_THUMBNAIL_COLUMNS = 1
export const MAX_THUMBNAIL_COLUMNS = 5

const DISPLAY_SETTINGS_STORAGE_VERSION = 1

export type ThumbnailColumnCount = 1 | 2 | 3 | 4 | 5

export type DisplaySettings = {
  thumbnailColumns: ThumbnailColumnCount
}

type PersistedDisplaySettings = {
  version: typeof DISPLAY_SETTINGS_STORAGE_VERSION
  thumbnailColumns: ThumbnailColumnCount
}

/** A storage operation failed without exposing unrelated persisted data. */
export class DisplaySettingsStorageError extends Error {
  constructor(message = '表示設定を保存できませんでした。') {
    super(message)
    this.name = 'DisplaySettingsStorageError'
  }
}

const defaultDisplaySettings = (): DisplaySettings => ({
  thumbnailColumns: DEFAULT_THUMBNAIL_COLUMNS,
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

export const isThumbnailColumnCount = (value: unknown): value is ThumbnailColumnCount => (
  typeof value === 'number'
  && Number.isInteger(value)
  && value >= MIN_THUMBNAIL_COLUMNS
  && value <= MAX_THUMBNAIL_COLUMNS
)

export const normalizeThumbnailColumnCount = (value: unknown): ThumbnailColumnCount => (
  isThumbnailColumnCount(value) ? value : DEFAULT_THUMBNAIL_COLUMNS
)

export const normalizeDisplaySettings = (settings: Partial<DisplaySettings> = {}): DisplaySettings => ({
  thumbnailColumns: normalizeThumbnailColumnCount(settings.thumbnailColumns),
})

const isPersistedDisplaySettings = (value: unknown): value is PersistedDisplaySettings => (
  isRecord(value)
  && value.version === DISPLAY_SETTINGS_STORAGE_VERSION
  && isThumbnailColumnCount(value.thumbnailColumns)
)

const removeInvalidRecord = (storage: Storage) => {
  try {
    storage.removeItem(DISPLAY_SETTINGS_STORAGE_KEY)
  } catch {
    // A failed cleanup must not prevent the safe default fallback.
  }
}

/** Load display settings without failing when browser storage is unavailable. */
export const loadPersistedDisplaySettings = (): DisplaySettings => {
  const storage = getLocalStorage()
  if (!storage) return defaultDisplaySettings()

  let raw: string | null
  try {
    raw = storage.getItem(DISPLAY_SETTINGS_STORAGE_KEY)
  } catch {
    return defaultDisplaySettings()
  }

  if (raw === null) return defaultDisplaySettings()

  let parsed: unknown
  try {
    parsed = JSON.parse(raw) as unknown
  } catch {
    removeInvalidRecord(storage)
    return defaultDisplaySettings()
  }

  if (!isPersistedDisplaySettings(parsed)) {
    removeInvalidRecord(storage)
    return defaultDisplaySettings()
  }

  return { thumbnailColumns: parsed.thumbnailColumns }
}

/** Persist display settings under their own versioned storage key. */
export const savePersistedDisplaySettings = (settings: DisplaySettings): void => {
  const normalized = normalizeDisplaySettings(settings)
  const storage = getLocalStorage()
  if (!storage) throw new DisplaySettingsStorageError()

  const persisted: PersistedDisplaySettings = {
    version: DISPLAY_SETTINGS_STORAGE_VERSION,
    ...normalized,
  }

  try {
    storage.setItem(DISPLAY_SETTINGS_STORAGE_KEY, JSON.stringify(persisted))
  } catch {
    throw new DisplaySettingsStorageError()
  }
}
