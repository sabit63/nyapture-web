import assert from 'node:assert/strict'
import test from 'node:test'
import type { FormEvent } from 'react'

import { APP_SETTINGS_STORAGE_KEY, saveAppSettings } from '../src/api/app-settings-storage'
import { DEFAULT_API_SETTINGS } from '../src/api/client'
import { useApiSettings } from '../src/features/settings/useApiSettings'
import { act, installHookDom, renderHook } from './helpers/react-hook'

const submitEvent = { preventDefault() {} } as FormEvent<HTMLFormElement>
const notify = () => {}

test('API設定と表示設定は独立して開き、相手の保存値を維持する', async () => {
  const dom = installHookDom()
  const localStorageDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: dom.window.localStorage,
  })
  globalThis.fetch = async () => new Response('alive')
  saveAppSettings({
    api: { ...DEFAULT_API_SETTINGS, apiUrl: 'http://api-before.test' },
    display: { thumbnailColumns: 3, colorTheme: 'default' },
  })

  const hook = await renderHook(() => useApiSettings(notify), undefined)
  try {
    await act(async () => { hook.current.openDisplaySettings() })
    assert.equal(hook.current.displaySettingsOpen, true)
    assert.equal(hook.current.apiSettingsOpen, false)

    await act(async () => {
      hook.current.setDisplaySettingsDraft({ thumbnailColumns: 5, colorTheme: 'amethyst' })
    })
    assert.equal(dom.window.document.documentElement.dataset.colorTheme, 'amethyst')
    await act(async () => {
      hook.current.requestDisplaySettingsClose('close-button')
    })
    assert.equal(dom.window.document.documentElement.dataset.colorTheme, 'default')

    await act(async () => { hook.current.openDisplaySettings() })
    assert.equal(hook.current.displaySettingsDraft.colorTheme, 'default')
    await act(async () => {
      hook.current.setDisplaySettingsDraft({ thumbnailColumns: 5, colorTheme: 'amethyst' })
    })
    await act(async () => {
      hook.current.saveDisplaySettings(
        submitEvent,
        (reason) => hook.current.requestDisplaySettingsClose(reason),
      )
    })
    let persisted = JSON.parse(dom.window.localStorage.getItem(APP_SETTINGS_STORAGE_KEY) ?? '{}')
    assert.equal(persisted.api.apiUrl, 'http://api-before.test')
    assert.equal(persisted.display.thumbnailColumns, 5)
    assert.equal(persisted.display.colorTheme, 'amethyst')
    assert.equal(dom.window.document.documentElement.dataset.colorTheme, 'amethyst')

    await act(async () => { hook.current.openApiSettings() })
    assert.equal(hook.current.apiSettingsOpen, true)
    assert.equal(hook.current.displaySettingsOpen, false)

    await act(async () => {
      hook.current.setApiSettingsDraft((current) => ({ ...current, apiUrl: 'http://api-after.test' }))
    })
    await act(async () => {
      hook.current.saveApiSettings(
        submitEvent,
        (reason) => hook.current.requestApiSettingsClose(reason),
      )
    })
    persisted = JSON.parse(dom.window.localStorage.getItem(APP_SETTINGS_STORAGE_KEY) ?? '{}')
    assert.equal(persisted.api.apiUrl, 'http://api-after.test')
    assert.equal(persisted.display.thumbnailColumns, 5)
    assert.equal(persisted.display.colorTheme, 'amethyst')
  } finally {
    await hook.unmount()
    if (localStorageDescriptor) Object.defineProperty(globalThis, 'localStorage', localStorageDescriptor)
    else Reflect.deleteProperty(globalThis, 'localStorage')
    dom.cleanup()
  }
})

test('表示設定の保存失敗中はテーマのプレビューとダイアログを維持する', async () => {
  const dom = installHookDom()
  const localStorageDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  let rejectWrites = false
  const values = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        if (rejectWrites) throw new Error('quota')
        values.set(key, value)
      },
      removeItem: (key: string) => values.delete(key),
    },
  })
  globalThis.fetch = async () => new Response('alive')

  const hook = await renderHook(() => useApiSettings(notify), undefined)
  try {
    await act(async () => { hook.current.openDisplaySettings() })
    await act(async () => {
      hook.current.setDisplaySettingsDraft((current) => ({ ...current, colorTheme: 'amethyst' }))
    })
    rejectWrites = true
    await act(async () => {
      hook.current.saveDisplaySettings(
        submitEvent,
        (reason) => hook.current.requestDisplaySettingsClose(reason),
      )
    })

    assert.equal(hook.current.displaySettingsOpen, true)
    assert.match(hook.current.displaySettingsSaveError, /保存できませんでした/)
    assert.equal(dom.window.document.documentElement.dataset.colorTheme, 'amethyst')
  } finally {
    await hook.unmount()
    if (localStorageDescriptor) Object.defineProperty(globalThis, 'localStorage', localStorageDescriptor)
    else Reflect.deleteProperty(globalThis, 'localStorage')
    dom.cleanup()
  }
})
