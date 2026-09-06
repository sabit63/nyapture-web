import assert from 'node:assert/strict'
import { afterEach, it } from 'node:test'
import * as endpoints from '../src/api/endpoints'
import * as dashboard from '../src/api/dashboard'
import * as cache from '../src/api/web-cache'
import { ApiError } from '../src/api/client'
import type { WebBookCacheConfigDto } from '../src/api/dto/web-cache'

const originalFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = originalFetch })
const respond = (body: unknown, status = 200) => {
  globalThis.fetch = async () => new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json' },
  })
}

type Request = (signal?: AbortSignal) => Promise<unknown>
// These wrappers intentionally return wire responses; application checks belong to callers.
const rawRequests: Record<string, Request> = {
  searchBooks: (s) => endpoints.searchBooks({}, s),
  getBook: (s) => endpoints.getBook('g', 'b', s),
  updateBookTitle: (s) => endpoints.updateBookTitle('g', 'b', 'title', s),
  deleteBookPhysical: (s) => endpoints.deleteBookPhysical('g', 'b', s),
  getBookDeletionJob: (s) => endpoints.getBookDeletionJob('job', s),
  autocompleteTags: (s) => endpoints.autocompleteTags('a', 'Artists', s),
  getTagAdditionalName: (s) => endpoints.getTagAdditionalName('Artists', 'a', s),
  upsertTagAdditionalNames: (s) => endpoints.upsertTagAdditionalNames([], s),
  searchWebBookCache: (s) => endpoints.searchWebBookCache({}, s),
  getWebBookCacheBook: (s) => endpoints.getWebBookCacheBook('g', 'b', s),
  downloadWebBookCacheBook: (s) => endpoints.downloadWebBookCacheBook('g', 'b', s),
  getWebBookContent: (s) => endpoints.getWebBookContent('https://fixture.invalid/book', s),
  getWebPageContent: (s) => endpoints.getWebPageContent('https://fixture.invalid/page', s),
  getDownloadStatuses: endpoints.getDownloadStatuses,
  getDownloadSystemStatus: endpoints.getDownloadSystemStatus,
  pauseAllDownloads: endpoints.pauseAllDownloads,
  resumeAllDownloads: endpoints.resumeAllDownloads,
  pauseDownloadItem: (s) => endpoints.pauseDownloadItem('fixture', s),
  resumeDownloadItem: (s) => endpoints.resumeDownloadItem('fixture', s),
  deleteDownloadItem: (s) => endpoints.deleteDownloadItem('fixture', s),
  updateDownloadPriority: (s) => endpoints.updateDownloadPriority({ url: 'fixture' }, s),
  startBookDownload: (s) => endpoints.startBookDownload({ url: 'fixture' }, s),
  getDashboardSummary: dashboard.getDashboardSummary,
  getDashboardDownloads: dashboard.getDashboardDownloads,
  getDashboardIntervals: dashboard.getDashboardIntervals,
  updateDashboardIntervals: (s) => dashboard.updateDashboardIntervals({ updates: [] }, s),
  cancelDashboardJob: (s) => dashboard.cancelDashboardJob('job', s),
  retryDashboardJob: (s) => dashboard.retryDashboardJob('job', s),
  getDataStoreDiagnostics: dashboard.getDataStoreDiagnostics,
  getMongoDbDiagnostics: dashboard.getMongoDbDiagnostics,
  getDataFolderDetails: dashboard.getDataFolderDetails,
  getServiceConfig: (s) => dashboard.getServiceConfig('webpilot', s),
  updateServiceConfig: (s) => dashboard.updateServiceConfig('webpilot', {}, s),
  testService: (s) => dashboard.testService('webpilot', s),
  getMaintenance: dashboard.getMaintenance,
  getMaintenanceIssues: dashboard.getMaintenanceIssues,
  startMaintenance: (s) => dashboard.startMaintenance(null, s),
  cancelMaintenance: dashboard.cancelMaintenance,
  pauseMaintenance: dashboard.pauseMaintenance,
  resumeMaintenance: dashboard.resumeMaintenance,
  getMaintenanceRun: (s) => dashboard.getMaintenanceRun('run', s),
  updateMaintenanceSchedule: (s) => dashboard.updateMaintenanceSchedule({}, s),
  getCacheMetrics: dashboard.getCacheMetrics,
  clearDashboardCache: dashboard.clearDashboardCache,
  removeDashboardBookCache: (s) => dashboard.removeDashboardBookCache('book', s),
  getDashboardLogs: (s) => dashboard.getDashboardLogs(0, s),
  getDashboardLogEntries: (s) => dashboard.getDashboardLogEntries(0, undefined, s),
  clearDashboardLogs: dashboard.clearDashboardLogs,
}

for (const [name, request] of Object.entries(rawRequests)) {
  it(`${name} preserves direct/envelope/failure/missing-data wire responses`, async () => {
    for (const body of [
      { books: [], totalPage: 1 },
      { success: true, data: { value: 1 } },
      { success: false, message: '  failure  ', data: null },
      { success: true },
    ]) {
      respond(body)
      assert.deepEqual(await request(), body)
    }
    respond({ message: 'transport failure' }, 500)
    await assert.rejects(request(), (error: unknown) => error instanceof ApiError && error.status === 500)
    let fetched = false
    globalThis.fetch = async () => { fetched = true; throw new Error('must not fetch') }
    const controller = new AbortController()
    controller.abort()
    await assert.rejects(request(controller.signal), ApiError)
    assert.equal(fetched, false)
  })
}

const config: WebBookCacheConfigDto = {
  enabled: false, intervalMinutes: 60, initialLookbackDays: 7,
  maxPagesPerRun: 1, maxDetailsPerRun: 1, sites: [],
  autoDownload: {
    enabled: false, conditionMode: 'All', maxPageCount: 1,
    maxAutoDownloadsPerRun: 1, maxAutoDownloadsPerDay: 1,
    minFreeDiskGb: 1, allowedGroupIds: [], excludedTags: [],
  },
}
const unwrapped: Record<string, Request> = {
  getCacheBook: (s) => cache.getCacheBook('g', 'b', s),
  getCacheConfig: cache.getCacheConfig,
  validateCacheConfig: (s) => cache.validateCacheConfig(config, s),
  saveCacheConfig: (s) => cache.saveCacheConfig(config, s),
  getCacheStatus: cache.getCacheStatus,
  runCacheSync: (s) => cache.runCacheSync({ force: false }, s),
  testCacheSite: (s) => cache.testCacheSite('g', s),
}
for (const [name, request] of Object.entries(unwrapped)) {
  it(`${name} preserves its opt-in envelope policy`, async () => {
    respond({ data: { value: 1 } })
    assert.deepEqual(await request(), { value: 1 })
    for (const data of [undefined, null]) {
      respond({ success: true, data })
      await assert.rejects(request(), (error: unknown) => (
        error instanceof ApiError && error.message === 'Web Book Cache APIの応答に失敗しました。'
      ))
    }
    respond({ success: false, message: '  failed  ', data: { errors: ['first', 1] } })
    await assert.rejects(request(), (error: unknown) => {
      assert.ok(error instanceof ApiError)
      assert.equal(error.message, 'failed')
      assert.deepEqual(error.validationErrors, ['first'])
      return true
    })
  })
}

it('cache commands discard successful envelopes but preserve application errors', async () => {
  const commands: Request[] = [
    (s) => cache.enqueueCacheBook('g', 'b', s),
    (s) => cache.deleteCacheBook('g', 'b', s),
    cache.resetCacheConfig, cache.cancelCacheSync,
  ]
  for (const command of commands) {
    respond({ success: true })
    assert.equal(await command(), undefined)
    respond({ success: false, message: '  failed  ' })
    await assert.rejects(command(), (error: unknown) => error instanceof ApiError && error.message === 'failed')
  }
})

it('cache search stays direct and nested site failures keep their distinct fallback', async () => {
  respond({ books: [], totalPage: 1 })
  assert.deepEqual(await cache.searchCache({}), { books: [], totalPage: 1 })
  respond({ success: false, message: '  search failed  ' })
  await assert.rejects(cache.searchCache({}), (error: unknown) => error instanceof ApiError && error.message === 'search failed')
  respond({ data: { success: false, message: ' ' } })
  await assert.rejects(cache.testCacheSite('g'), (error: unknown) => (
    error instanceof ApiError && error.message === 'Web Book Cacheサイト接続試験に失敗しました。'
  ))
})
