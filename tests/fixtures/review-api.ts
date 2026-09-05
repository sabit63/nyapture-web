/** Local-only UI fixture. No requests are forwarded to a real backend. */
import { createServer } from 'node:http'

const config = {
  enabled: true, intervalMinutes: 30, initialLookbackDays: 7, maxPagesPerRun: 10, maxDetailsPerRun: 20,
  sites: [{ groupId: 'fixture', enabled: true, startUrl: 'https://example.com', intervalMinutes: null, maxPagesPerRun: null, maxDetailsPerRun: null, domainIntervalMilliseconds: null }],
  autoDownload: { enabled: false, conditionMode: 'All', maxPageCount: 100, maxAutoDownloadsPerRun: 10, maxAutoDownloadsPerDay: 100, minFreeDiskGb: 10, allowedGroupIds: [], excludedTags: [] },
}
let failConfig = false
let clearRequests = 0
const webBook = { title: 'Fixture web candidate', url: 'https://example.com/book/fixture', totalPage: 3, tagSet: { Artist: ['fixture-artist'] }, status: 'WebBook' }
const savedBook = { ...webBook, groupId: 'fixture', bookId: 'saved', title: 'Fixture saved book', totalPage: 12, status: 'Downloaded' }
createServer((request, response) => {
  const path = new URL(request.url ?? '/', 'http://localhost').pathname
  const send = (data: unknown, status = 200) => { response.writeHead(status, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(data)) }
  if (path === '/alive') return send({ success: true })
  if (path.includes('negotiate')) return send({ success: false }, 503)
  if (path === '/api/web/page') return send({ success: true, onlineBookPage: { books: [webBook], totalPage: 1, currentPage: 1 } })
  if (path === '/api/web/book') return send({ success: true, onlineBook: webBook })
  if (path === '/api/book/fixture/saved') return send({ success: true, books: [savedBook] })
  if (path.includes('/page') || path.includes('/thumbnail')) {
    response.writeHead(200, { 'Content-Type': 'image/svg+xml' })
    return response.end('<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1400"><rect width="1000" height="1400" fill="#292d40"/><text x="100" y="200" fill="white" font-size="48">Fixture page</text></svg>')
  }
  if (path.endsWith('/config/reset')) { failConfig = true; return send({ success: true }) }
  if (path.endsWith('/web-cache/config')) {
    if (failConfig) { failConfig = false; return send({ success: false, message: 'Fixture: reset succeeded, reload failed' }, 503) }
    return send({ success: true, data: { config, hasRuntimeOverride: false } })
  }
  if (path.endsWith('/config/validate')) return send({ success: true, data: { isValid: true, errors: [] } })
  if (path.endsWith('/web-cache/status')) return send({ success: true, data: { isRunning: false, pagesLoaded: 12 } })
  if (path === '/api/book/search') return send({ success: true, books: [], totalPage: 1, tags: [] })
  if (path === '/api/web-cache/search') return send({ success: true, books: [], totalPage: 1 })
  if (path.endsWith('/datastore')) return send({ success: true, data: { provider: 'Fixture', isConnected: true, resources: [], statistics: {} } })
  if (path.endsWith('/cache/metrics')) return send({ success: true, data: { entryCount: 0, clearStatus: { state: 'Completed', processedEntries: 4, deletedEntries: 4, failedEntries: 0, totalEntries: 4 } } })
  if (path === '/api/dashboard/cache' && request.method === 'DELETE') {
    clearRequests += 1
    if (clearRequests % 3 === 2) return send({ success: false, message: 'Fixture: already running' }, 409)
    if (clearRequests % 3 === 0) return send({ success: false, message: 'Fixture: clear failed' }, 500)
    return send({ success: true, message: 'Fixture: clear accepted', data: { started: true, status: { state: 'Running', runId: 'fixture' } } }, 202)
  }
  if (path.includes('/download/')) return send({})
  return send({ success: true, data: {} })
}).listen(5271, '127.0.0.1', () => console.log('UI fixture: http://127.0.0.1:5271'))
