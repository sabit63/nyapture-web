import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { it } from 'node:test'
import * as React from 'react'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { VectorDatabaseDiagnosticsDto } from '../src/models/dashboard'

registerHooks({ load(url, context, nextLoad) {
  return url.endsWith('.css') ? { format: 'module', source: '', shortCircuit: true } : nextLoad(url, context)
} })
Object.defineProperty(globalThis, 'React', { configurable: true, value: React })
const { VectorDatabaseDetails } = await import('../src/features/dashboard/VectorDatabaseDetails')

const render = (data?: VectorDatabaseDiagnosticsDto) => renderToStaticMarkup(createElement(VectorDatabaseDetails, { data }))

it('omits vector diagnostics for older responses', () => {
  assert.equal(render(), '')
})

it('renders each vector database lifecycle state', () => {
  for (const [status, label] of Object.entries({ disabled: '無効', not_initialized: '未初期化', building: '構築中', ready: '利用可能', unavailable: '利用不可' })) {
    assert.ok(render({ status: status as VectorDatabaseDiagnosticsDto['status'] }).includes(label))
  }
})

it('distinguishes configured and active modes and unknown and zero counts', () => {
  const html = render({
    enabled: true,
    workerEnabled: false,
    status: 'building',
    configuredMode: { method: 'D', directionMethods: { 'book->entity': 'C' } },
    activeMode: { method: 'A' },
    lastError: '<failed>',
    generations: [{ profileVersion: 'profile-2', state: 'building', failedBooks: 0, pendingBooks: null, evaluatedBooks: 12, mode: { method: 'B' } }],
  })
  assert.match(html, /設定された推薦方式/)
  assert.match(html, /稼働中の推薦方式/)
  assert.match(html, /D · RRF/)
  assert.match(html, /A · Jaccard/)
  assert.match(html, /book-&gt;entity: C · 意味コサイン/)
  assert.match(html, /失敗Books<\/dt><dd>0<\/dd>/)
  assert.match(html, /保留Books<\/dt><dd>—<\/dd>/)
  assert.match(html, /構築全体の完了率を示すものではありません/)
  assert.match(html, /&lt;failed&gt;/)
  assert.doesNotMatch(html, /role="progressbar"/)
})
