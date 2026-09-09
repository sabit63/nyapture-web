import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { getBookRecommendations, getEntityRecommendations, usableRecommendations } from '../src/api/recommendations'
import { useRecommendations } from '../src/features/viewer/use-recommendations'
import { act, deferred, installHookDom, renderHook } from './helpers/react-hook'

let dom: ReturnType<typeof installHookDom>
beforeEach(() => { dom = installHookDom() })
afterEach(() => { dom.cleanup() })
const reply = (status = 'success', retryAfter = '60') => new Response(JSON.stringify({ status, items: [] }), {
  status: status === 'pending' ? 202 : 200, headers: { 'Retry-After': retryAfter },
})

describe('recommendation requests', () => {
  it('requests and retains 20, 50, or 100 recommendations for books and entities', async () => {
    for (const limit of [20, 50, 100]) {
      globalThis.fetch = async (input) => {
        assert.equal(new URL(String(input)).searchParams.get('limit'), String(limit))
        return reply()
      }
      const signal = new AbortController().signal
      await getBookRecommendations('g', 'b', 'Book', signal, limit)
      await getEntityRecommendations('Artist', 'a', 'Group', signal, limit)
      const items = Array.from({ length: 110 }, (_, index) => ({ key: { entityType: 'Artist' as const, tagName: String(index) } }))
      assert.equal(usableRecommendations(items, 'Artist', limit).length, limit)
    }
  })
  it('encodes identities, limits each type, and respects long Retry-After values', async () => {
    globalThis.fetch = async (input) => {
      const url = new URL(String(input))
      assert.equal(url.pathname, `/api/book/${encodeURIComponent('g/日')}/${encodeURIComponent('b/?')}/recommendations`)
      assert.equal(url.searchParams.get('targetType'), 'Artist')
      assert.equal(url.searchParams.get('limit'), '20')
      return reply('pending', '120')
    }
    const result = await getBookRecommendations('g/日', 'b/?', 'Artist', new AbortController().signal)
    assert.equal(result.status, 'pending')
    assert.equal(result.retryAfterSeconds, 120)
  })
  it('distinguishes missing sources and unavailable service from authentication errors', async () => {
    for (const [code, expected] of [[404, 'not_found'], [503, 'unavailable']] as const) {
      globalThis.fetch = async () => new Response('{}', { status: code })
      assert.equal((await getBookRecommendations('g', 'b', 'Book', new AbortController().signal)).status, expected)
    }
    globalThis.fetch = async () => new Response('{}', { status: 401 })
    await assert.rejects(getBookRecommendations('g', 'b', 'Book', new AbortController().signal), { status: 401 })
  })
  it('keeps usable destinations in API order, including absent optional metadata', () => {
    assert.deepEqual(usableRecommendations([
      {}, { key: { entityType: 'Book', groupId: 'g', bookId: '2' }, book: null },
      { key: { entityType: 'Book', groupId: 'g', bookId: '1' } },
      { key: { entityType: 'Book', groupId: 'g', bookId: '2' } },
      { key: { entityType: 'Artist', tagName: 'a' } },
    ], 'Book').map((hit) => hit.key?.bookId), ['2', '1'])
  })
})

describe('recommendation lifecycle', () => {
  it('fetches again when the limit changes and keeps tab caches separate by limit', async () => {
    const requests: string[] = []
    globalThis.fetch = async (input) => { requests.push(new URL(String(input)).searchParams.get('limit')!); return reply() }
    const hook = await renderHook(({ limit }: { limit: number }) => useRecommendations('g', 'b', true, 'Book', undefined, limit), { limit: 20 })
    try {
      await hook.rerender({ limit: 100 })
      await hook.rerender({ limit: 50 })
      await hook.rerender({ limit: 20 })
      assert.deepEqual(requests, ['20', '100', '50'])
    } finally { await hook.unmount() }
  })
  it('loads only selected tabs and reuses results after closing', async () => {
    const requests: string[] = []
    globalThis.fetch = async (input) => { requests.push(new URL(String(input)).searchParams.get('targetType')!); return reply() }
    const hook = await renderHook(({ open, type }: { open: boolean; type: 'Book' | 'Artist' }) => useRecommendations('g', 'b', open, type), { open: false, type: 'Book' })
    try {
      assert.equal(requests.length, 0)
      await hook.rerender({ open: true, type: 'Book' })
      await hook.rerender({ open: true, type: 'Artist' })
      await hook.rerender({ open: false, type: 'Artist' })
      await hook.rerender({ open: true, type: 'Artist' })
      assert.deepEqual(requests, ['Book', 'Artist'])
      await act(async () => { hook.current.retry() })
      assert.deepEqual(requests, ['Book', 'Artist', 'Artist'])
    } finally { await hook.unmount() }
  })
  it('aborts hidden requests and ignores their late responses', async () => {
    const pending = deferred<Response>()
    let signal: AbortSignal | null | undefined
    globalThis.fetch = async (_input, init) => { signal = init?.signal; return pending.promise }
    const hook = await renderHook(({ open }) => useRecommendations('g', 'b', open, 'Book'), { open: true })
    try {
      await hook.rerender({ open: false })
      assert.equal(signal?.aborted, true)
      await act(async () => { pending.resolve(reply('no_features')) })
      assert.equal(Boolean(hook.current.state?.result), false)
      globalThis.fetch = async () => reply()
      await hook.rerender({ open: true })
      assert.equal(hook.current.state?.result?.status, 'success')
    } finally { await hook.unmount() }
  })
  it('stops after three automatic polls and requires manual retry to reset the budget', async (context) => {
    context.mock.timers.enable({ apis: ['setTimeout', 'Date'] })
    let requests = 0
    globalThis.fetch = async () => { requests++; return reply('pending', '2') }
    const hook = await renderHook(({ open }) => useRecommendations('g', 'b', open, 'Book'), { open: true })
    try {
      assert.equal(requests, 1)
      for (let i = 0; i < 3; i++) await act(async () => { context.mock.timers.tick(2000) })
      assert.equal(requests, 4)
      await hook.rerender({ open: false })
      await hook.rerender({ open: true })
      await act(async () => { context.mock.timers.tick(10000) })
      assert.equal(requests, 4)
      await act(async () => { hook.current.retry() })
      assert.equal(requests, 5)
      assert.equal(hook.current.state?.attempts, 0)
    } finally { await hook.unmount(); context.mock.timers.reset() }
  })
  it('pauses polling while closed, resumes only the selected tab, and uses a 60s fallback', async (context) => {
    context.mock.timers.enable({ apis: ['setTimeout', 'Date'] })
    const requests: string[] = []
    globalThis.fetch = async (input) => { requests.push(new URL(String(input)).searchParams.get('targetType')!); return reply('pending', 'invalid') }
    const hook = await renderHook(({ open, type }: { open: boolean; type: 'Book' | 'Group' }) => useRecommendations('g', 'b', open, type), { open: true, type: 'Book' })
    try {
      await act(async () => { context.mock.timers.tick(59000) })
      assert.deepEqual(requests, ['Book'])
      await hook.rerender({ open: false, type: 'Book' })
      await act(async () => { context.mock.timers.tick(10000) })
      assert.deepEqual(requests, ['Book'])
      await hook.rerender({ open: true, type: 'Group' })
      await act(async () => { context.mock.timers.tick(60000) })
      assert.deepEqual(requests, ['Book', 'Group', 'Group'])
    } finally { await hook.unmount(); context.mock.timers.reset() }
  })
})
