import { DEFAULT_API_SETTINGS, normalizeApiSettings, type ApiSettings } from './client'
import { loadPersistedApiSettings } from './settings-storage'
import { loadPersistedDisplaySettings, normalizeDisplaySettings, type DisplaySettings } from './display-settings-storage'

export const APP_SETTINGS_STORAGE_KEY = 'nyapture.settings.v1'
export type AppSettings = { api: ApiSettings; display: DisplaySettings }

const defaults = (): AppSettings => ({
  api: { ...DEFAULT_API_SETTINGS, proxy: { ...DEFAULT_API_SETTINGS.proxy } },
  display: normalizeDisplaySettings(),
})

export function loadAppSettings(): AppSettings {
  let raw: string | null
  try { raw = globalThis.localStorage?.getItem(APP_SETTINGS_STORAGE_KEY) ?? null }
  catch { return defaults() }
  if (raw === null) return { api: loadPersistedApiSettings(), display: loadPersistedDisplaySettings() }
  try {
    const record = JSON.parse(raw)
    if (record?.version !== 1 || !record.api || !record.display) return defaults()
    return { api: normalizeApiSettings(record.api), display: normalizeDisplaySettings(record.display) }
  } catch { return defaults() }
}

/** One setItem commits both settings; failed writes leave the previous record intact. */
export function saveAppSettings(settings: AppSettings): void {
  const record = {
    version: 1,
    api: normalizeApiSettings(settings.api),
    display: normalizeDisplaySettings(settings.display),
  }
  try {
    if (!globalThis.localStorage) throw new Error()
    globalThis.localStorage.setItem(APP_SETTINGS_STORAGE_KEY, JSON.stringify(record))
  } catch { throw new Error('設定を端末へ保存できませんでした。') }
}
