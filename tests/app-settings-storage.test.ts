import assert from 'node:assert/strict'
import test from 'node:test'
import { APP_SETTINGS_STORAGE_KEY, loadAppSettings, saveAppSettings } from '../src/api/app-settings-storage'
import { DEFAULT_API_SETTINGS } from '../src/api/client'
import { API_SETTINGS_STORAGE_KEY } from '../src/api/settings-storage'
import { DISPLAY_SETTINGS_STORAGE_KEY } from '../src/api/display-settings-storage'

test('settings migrate on save, commit atomically, and reset API without losing display', () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  const values = new Map<string, string>()
  let reject = false
  let writes = 0
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { if (reject) throw new Error('quota'); writes++; values.set(key, value) },
    removeItem: (key: string) => values.delete(key),
  } })
  try {
    values.set(API_SETTINGS_STORAGE_KEY, JSON.stringify({ version: 3, ...DEFAULT_API_SETTINGS, apiUrl: 'https://legacy.test' }))
    values.set(DISPLAY_SETTINGS_STORAGE_KEY, JSON.stringify({ version: 1, thumbnailColumns: 3 }))
    const legacy = loadAppSettings()
    assert.equal(legacy.api.apiUrl, 'https://legacy.test')
    assert.equal(legacy.display.thumbnailColumns, 3)
    assert.equal(values.has(APP_SETTINGS_STORAGE_KEY), false)
    saveAppSettings(legacy)
    assert.equal(writes, 1)
    const committed = values.get(APP_SETTINGS_STORAGE_KEY)
    reject = true
    assert.throws(() => saveAppSettings({ ...legacy, display: { thumbnailColumns: 1 } }))
    assert.equal(values.get(APP_SETTINGS_STORAGE_KEY), committed)
    assert.equal(loadAppSettings().display.thumbnailColumns, 3)
    reject = false
    saveAppSettings({ api: DEFAULT_API_SETTINGS, display: legacy.display })
    assert.equal(loadAppSettings().api.apiUrl, DEFAULT_API_SETTINGS.apiUrl)
    assert.equal(loadAppSettings().display.thumbnailColumns, 3)
  } finally {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous)
    else Reflect.deleteProperty(globalThis, 'localStorage')
  }
})
