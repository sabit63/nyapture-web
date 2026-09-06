import assert from 'node:assert/strict'
import test from 'node:test'

import {
  act,
  deferred,
  installHookDom,
  renderHook,
} from './helpers/react-hook'
import {
  getWebCacheResponseConfig,
  getWebCacheResponseMessage,
  hasWebCacheRuntimeOverride,
  isWebCacheResponseFailure,
  useCacheManagement,
} from '../src/features/web-cache/use-cache-management'
import type { WebBookCacheConfigDto } from '../src/models/web-cache'

type FetchInput = Parameters<typeof fetch>[1]

const config = (overrides: Partial<WebBookCacheConfigDto> = {}): WebBookCacheConfigDto => ({
  enabled: true,
  intervalMinutes: 30,
  initialLookbackDays: 7,
  maxPagesPerRun: 20,
  maxDetailsPerRun: 100,
  sites: [],
  autoDownload: {
    enabled: false,
    conditionMode: 'All',
    maxPageCount: 200,
    maxAutoDownloadsPerRun: 10,
    maxAutoDownloadsPerDay: 50,
    minFreeDiskGb: 20,
    allowedGroupIds: [],
    excludedTags: [],
  },
  ...overrides,
})

const jsonResponse = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status,
  headers: { 'Content-Type': 'application/json' },
})

const envelope = (value: unknown) => jsonResponse({ success: true, data: value })

const flush = async () => {
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
}

const settle = () => act(flush)

test('management response helpers normalize envelopes without sharing mutable config state', () => {
  const source = config({
    sites: [{
      groupId: 'alpha',
      enabled: true,
      startUrl: 'https://example.test/start',
      intervalMinutes: null,
      maxPagesPerRun: null,
      maxDetailsPerRun: null,
      domainIntervalMilliseconds: null,
    }],
    autoDownload: {
      enabled: true,
      conditionMode: 'All',
      maxPageCount: 200,
      maxAutoDownloadsPerRun: 10,
      maxAutoDownloadsPerDay: 50,
      minFreeDiskGb: 20,
      allowedGroupIds: ['alpha'],
      excludedTags: ['sample'],
    },
  })
  const copy = getWebCacheResponseConfig({ config: source, hasRuntimeOverride: true })

  copy.sites[0].groupId = 'changed'
  copy.autoDownload.allowedGroupIds.push('beta')

  assert.equal(source.sites[0]?.groupId, 'alpha')
  assert.deepEqual(source.autoDownload.allowedGroupIds, ['alpha'])
  assert.equal(hasWebCacheRuntimeOverride({ config: source, hasRuntimeOverride: true }), true)
  assert.equal(hasWebCacheRuntimeOverride({ config: source }), false)
  assert.equal(getWebCacheResponseMessage({ message: '  saved  ' }), 'saved')
  assert.equal(getWebCacheResponseMessage({ message: '   ' }), null)
  assert.equal(isWebCacheResponseFailure({ success: false }), true)
  assert.equal(isWebCacheResponseFailure({ success: true }), false)
})

test('management hook loads config and aborts an in-flight request on unmount', async () => {
  const dom = installHookDom()
  const configRequest = deferred<Response>()
  let configSignal: AbortSignal | undefined
  globalThis.fetch = (async (input: RequestInfo | URL, init?: FetchInput) => {
    const pathname = new URL(String(input)).pathname
    if (pathname.endsWith('/config')) {
      configSignal = init?.signal ?? undefined
      return configRequest.promise
    }
    if (pathname.endsWith('/status')) return envelope({ isRunning: false })
    throw new Error(`Unexpected request: ${pathname}`)
  }) as typeof fetch

  try {
    const hook = await renderHook((revision: number) => useCacheManagement(revision), 0 as number)
    assert.equal(configSignal?.aborted, false)
    await hook.unmount()
    assert.equal(configSignal?.aborted, true)
    configRequest.resolve(envelope({ config: config() }))
    await settle()
  } finally {
    dom.cleanup()
  }
})

test('management hook ignores config from the previous API revision', async () => {
  const dom = installHookDom()
  const firstConfig = deferred<Response>()
  let configRequests = 0
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const pathname = new URL(String(input)).pathname
    if (pathname.endsWith('/config')) {
      configRequests += 1
      if (configRequests === 1) return firstConfig.promise
      return envelope({ config: config({ intervalMinutes: 45 }) })
    }
    if (pathname.endsWith('/status')) return envelope({ isRunning: false })
    throw new Error(`Unexpected request: ${pathname}`)
  }) as typeof fetch

  try {
    const hook = await renderHook((revision: number) => useCacheManagement(revision), 0 as number)
    await hook.rerender(1)
    await settle()
    assert.equal(configRequests, 2)
    assert.equal(hook.current.draft?.intervalMinutes, 45)

    await act(async () => {
      firstConfig.resolve(envelope({ config: config({ intervalMinutes: 15 }) }))
      await flush()
    })
    assert.equal(hook.current.draft?.intervalMinutes, 45)
    await hook.unmount()
  } finally {
    dom.cleanup()
  }
})

test('reset GET failure keeps save suppressed until config is fetched again', async () => {
  const dom = installHookDom()
  let configRequests = 0
  let validationRequests = 0
  let resetRequests = 0
  globalThis.fetch = (async (input: RequestInfo | URL, init?: FetchInput) => {
    const pathname = new URL(String(input)).pathname
    if (pathname.endsWith('/config')) {
      configRequests += 1
      if (configRequests === 2) throw new Error('reset refresh unavailable')
      return envelope({ config: config() })
    }
    if (pathname.endsWith('/status')) return envelope({ isRunning: false })
    if (pathname.endsWith('/config/reset')) {
      resetRequests += 1
      assert.equal(init?.method, 'POST')
      return jsonResponse({ success: true })
    }
    if (pathname.endsWith('/config/validate')) {
      validationRequests += 1
      return envelope({ isValid: true, errors: [] })
    }
    throw new Error(`Unexpected request: ${pathname}`)
  }) as typeof fetch

  try {
    const hook = await renderHook((revision: number) => useCacheManagement(revision), 0 as number)
    await settle()
    assert.equal(hook.current.saveDisabled, false)

    await act(async () => {
      await hook.current.reset()
      await flush()
    })
    assert.equal(resetRequests, 1)
    assert.equal(hook.current.configError, 'リセット済み・設定の再取得に失敗しました')
    assert.equal(hook.current.configUncertain, true)
    assert.equal(hook.current.saveDisabled, true)

    await act(async () => { await hook.current.save() })
    assert.equal(validationRequests, 0)

    await act(async () => {
      await hook.current.loadConfig(true)
      await flush()
    })
    assert.equal(hook.current.configError, null)
    assert.equal(hook.current.configUncertain, false)
    assert.equal(hook.current.saveDisabled, false)
    await hook.unmount()
  } finally {
    dom.cleanup()
  }
})

test('sync and reset share one mutation ownership guard', async () => {
  const dom = installHookDom()
  const syncRequest = deferred<Response>()
  let syncRequests = 0
  let resetRequests = 0
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const pathname = new URL(String(input)).pathname
    if (pathname.endsWith('/config')) return envelope({ config: config() })
    if (pathname.endsWith('/status')) return envelope({ isRunning: false })
    if (pathname.endsWith('/sync/run')) {
      syncRequests += 1
      return syncRequest.promise
    }
    if (pathname.endsWith('/config/reset')) {
      resetRequests += 1
      return jsonResponse({ success: true })
    }
    throw new Error(`Unexpected request: ${pathname}`)
  }) as typeof fetch

  try {
    const hook = await renderHook((revision: number) => useCacheManagement(revision), 0 as number)
    await settle()

    let sync: Promise<void> | undefined
    await act(async () => {
      sync = hook.current.runSync()
      await flush()
    })
    await act(async () => { await hook.current.reset() })
    assert.equal(syncRequests, 1)
    assert.equal(resetRequests, 0)

    await act(async () => {
      syncRequest.resolve(envelope({ started: true, status: { isRunning: true } }))
      await sync
      await flush()
    })
    assert.equal(hook.current.feedback?.tone, 'success')
    await hook.unmount()
  } finally {
    dom.cleanup()
  }
})

test('API switch aborts an old mutation without blocking or overwriting the new API', async () => {
  const dom = installHookDom()
  const oldSync = deferred<Response>()
  const newSync = deferred<Response>()
  const signals: AbortSignal[] = []
  globalThis.fetch = async (input, init) => {
    const pathname = new URL(String(input)).pathname
    if (pathname.endsWith('/config')) return envelope({ config: config() })
    if (pathname.endsWith('/status')) return envelope({ isRunning: false })
    if (pathname.endsWith('/sync/run')) {
      assert.ok(init?.signal)
      signals.push(init.signal)
      return signals.length === 1 ? oldSync.promise : newSync.promise
    }
    throw new Error(`Unexpected request: ${pathname}`)
  }
  const hook = await renderHook((revision: number) => useCacheManagement(revision), 0 as number)
  try {
    let oldPending!: Promise<void>
    let newPending!: Promise<void>
    await act(async () => { oldPending = hook.current.runSync() })
    assert.equal(signals.length, 1)
    await hook.rerender(1)
    assert.equal(signals[0].aborted, true)
    assert.equal(hook.current.syncing, false)
    assert.equal(hook.current.feedback, null)
    await act(async () => { newPending = hook.current.runSync() })
    assert.equal(signals.length, 2)
    await act(async () => {
      oldSync.resolve(envelope({ started: true, message: 'old', status: { isRunning: true } }))
      await oldPending
    })
    assert.equal(hook.current.syncing, true)
    assert.equal(hook.current.feedback, null)
    assert.equal(hook.current.status?.isRunning, false)
    await act(async () => {
      newSync.resolve(envelope({ started: true, message: 'new', status: { isRunning: true } }))
      await newPending
    })
    assert.deepEqual(hook.current.feedback, { tone: 'success', message: 'new' })
    assert.equal(hook.current.status?.isRunning, true)
    assert.equal(hook.current.syncing, false)
  } finally {
    await hook.unmount()
    dom.cleanup()
  }
})
