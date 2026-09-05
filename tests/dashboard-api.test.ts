import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import { ApiError } from '../src/api/client'
import {
  clearDashboardCache,
  getDataStoreDiagnostics,
  getMongoDbDiagnostics,
} from '../src/api/dashboard'

type FetchInput = Parameters<typeof fetch>[1]

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

const jsonResponse = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status,
  headers: { 'Content-Type': 'application/json' },
})

describe('Dashboard API contracts', () => {
  it('uses the provider-neutral DataStore diagnostics endpoint', async () => {
    let requestUrl = ''
    globalThis.fetch = (async (input) => {
      requestUrl = String(input)
      return jsonResponse({ success: true, data: { isConnected: true, storeName: 'sqlite' } })
    }) as typeof fetch

    const response = await getDataStoreDiagnostics()

    assert.equal(new URL(requestUrl).pathname, '/api/dashboard/datastore')
    assert.equal(response.success, true)
    assert.equal(response.data?.storeName, 'sqlite')
  })

  it('keeps the MongoDB endpoint as a legacy compatibility request', async () => {
    let requestUrl = ''
    globalThis.fetch = (async (input) => {
      requestUrl = String(input)
      return jsonResponse({ success: true, data: { isConnected: true } })
    }) as typeof fetch

    await getMongoDbDiagnostics()

    assert.equal(new URL(requestUrl).pathname, '/api/dashboard/mongodb')
  })

  it('preserves the typed asynchronous 202 cache-clear response', async () => {
    let requestInit: FetchInput | undefined
    globalThis.fetch = (async (_input, init) => {
      requestInit = init
      return jsonResponse({
        success: true,
        data: {
          started: true,
          status: { runId: 'clear-1', state: 'Running', totalEntries: 10, processedEntries: 2 },
        },
      }, 202)
    }) as typeof fetch

    const response = await clearDashboardCache()

    assert.equal(requestInit?.method, 'DELETE')
    assert.equal(response.data?.started, true)
    assert.equal(response.data?.status?.state, 'Running')
    assert.equal(response.data?.status?.processedEntries, 2)
  })

  it('keeps a 409 response classifiable for the already-running UI path', async () => {
    globalThis.fetch = (async () => jsonResponse({
      success: false,
      message: 'cache clear already running',
      data: { started: false, status: { state: 'Running' } },
    }, 409)) as typeof fetch

    await assert.rejects(
      clearDashboardCache(),
      (error: unknown) => error instanceof ApiError && error.status === 409 && error.category === 'conflict',
    )
  })
})

