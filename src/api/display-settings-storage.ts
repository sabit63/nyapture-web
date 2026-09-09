export const DISPLAY_SETTINGS_STORAGE_KEY = 'nyapture.display-settings.v1'
export const DEFAULT_THUMBNAIL_COLUMNS = 5
export const MIN_THUMBNAIL_COLUMNS = 1
export const MAX_THUMBNAIL_COLUMNS = 10
export const DEFAULT_COLOR_THEME = 'default'

export type ColorTheme = 'default' | 'amethyst'

const DISPLAY_SETTINGS_STORAGE_VERSION = 1

export type ThumbnailColumnCount = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10

export type DisplaySettings = {
  recommendationDebug?: boolean
  autoThumbnailColumns?: boolean
  thumbnailColumns: ThumbnailColumnCount
  colorTheme: ColorTheme
}

type PersistedDisplaySettings = {
  recommendationDebug?: boolean
  autoThumbnailColumns?: boolean
  version: typeof DISPLAY_SETTINGS_STORAGE_VERSION
  thumbnailColumns: ThumbnailColumnCount
  colorTheme?: ColorTheme
}

/** A storage operation failed without exposing unrelated persisted data. */
export class DisplaySettingsStorageError extends Error {
  constructor(message = '表示設定を保存できませんでした。') {
    super(message)
    this.name = 'DisplaySettingsStorageError'
  }
}

const defaultDisplaySettings = (): DisplaySettings => ({
  autoThumbnailColumns: true,
  thumbnailColumns: DEFAULT_THUMBNAIL_COLUMNS,
  colorTheme: DEFAULT_COLOR_THEME,
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

export const isColorTheme = (value: unknown): value is ColorTheme => (
  value === 'default' || value === 'amethyst'
)

export const normalizeColorTheme = (value: unknown): ColorTheme => (
  isColorTheme(value) ? value : DEFAULT_COLOR_THEME
)

export const normalizeDisplaySettings = (settings: Partial<DisplaySettings> = { autoThumbnailColumns: true }): DisplaySettings => ({
  ...(settings.recommendationDebug === true ? { recommendationDebug: true } : {}),
  autoThumbnailColumns: settings.autoThumbnailColumns === true,
  thumbnailColumns: normalizeThumbnailColumnCount(settings.thumbnailColumns),
  colorTheme: normalizeColorTheme(settings.colorTheme),
})

const isPersistedDisplaySettings = (value: unknown): value is PersistedDisplaySettings => (
  isRecord(value)
  && value.version === DISPLAY_SETTINGS_STORAGE_VERSION
  && isThumbnailColumnCount(value.thumbnailColumns)
  && (value.colorTheme === undefined || isColorTheme(value.colorTheme))
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

  return normalizeDisplaySettings(parsed)
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
