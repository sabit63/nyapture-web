import assert from 'node:assert/strict'
import { it } from 'node:test'
import { useDashboardResource } from '../src/features/dashboard/use-dashboard-resource'
import type { DashboardApiResponse } from '../src/models/dashboard'
import { act, deferred, installHookDom, renderHook } from './helpers/react-hook'

type Data = { value: string }
type Reply = DashboardApiResponse<Data>

it('Dashboard discards API A and exposes API B failure without old data', async () => {
  const dom = installHookDom()
  const first = deferred<Reply>()
  const second = deferred<Reply>()
  const signals: AbortSignal[] = []
  const load = (signal: AbortSignal) => {
    signals.push(signal)
    return signals.length === 1 ? first.promise : second.promise
  }
  const hook = await renderHook((revision: number) => useDashboardResource(revision, 'test', 'Test', load), 0 as number)
  try {
    await hook.rerender(1)
    assert.equal(signals[0].aborted, true)
    await act(async () => { second.reject(new Error('B unavailable')) })
    assert.equal(hook.current.status, 'error')
    assert.equal(hook.current.data, null)
    await act(async () => { first.resolve({ data: { value: 'A' } }) })
    assert.equal(hook.current.status, 'error')
    assert.equal(hook.current.data, null)
  } finally {
    await hook.unmount()
    dom.cleanup()
  }
})

it('Dashboard manual refresh failure retains the current snapshot', async () => {
  const dom = installHookDom()
  let requests = 0
  const refresh = deferred<Reply>()
  const load = () => ++requests === 1 ? Promise.resolve({ data: { value: 'saved' } }) : refresh.promise
  const hook = await renderHook(() => useDashboardResource(0, 'test', 'Test', load), undefined)
  try {
    let pending!: Promise<void>
    await act(async () => { pending = hook.current.refresh() })
    assert.equal(hook.current.refreshing, true)
    assert.deepEqual(hook.current.data, { value: 'saved' })
    await act(async () => { refresh.reject(new Error('refresh failed')); await pending })
    assert.equal(hook.current.status, 'success')
    assert.ok(hook.current.error)
    assert.deepEqual(hook.current.data, { value: 'saved' })
  } finally {
    await hook.unmount()
    dom.cleanup()
  }
})

it('Dashboard poll abort invalidates pending responses and pre-aborted polls do not load', async () => {
  const dom = installHookDom()
  let requests = 0
  const pollResult = deferred<Reply>()
  const signals: AbortSignal[] = []
  const load = (signal: AbortSignal) => {
    signals.push(signal)
    return ++requests === 1 ? Promise.resolve({ data: { value: 'saved' } }) : pollResult.promise
  }
  const hook = await renderHook(() => useDashboardResource(0, 'test', 'Test', load), undefined)
  try {
    const controller = new AbortController()
    let pending!: Promise<void>
    await act(async () => { pending = hook.current.poll(controller.signal) })
    controller.abort()
    assert.equal(signals[1].aborted, true)
    await act(async () => { pollResult.resolve({ data: { value: 'stale' } }); await pending })
    assert.deepEqual(hook.current.data, { value: 'saved' })
    const aborted = new AbortController()
    aborted.abort()
    await act(async () => { await hook.current.poll(aborted.signal) })
    assert.equal(requests, 2)
  } finally {
    await hook.unmount()
    dom.cleanup()
  }
})
