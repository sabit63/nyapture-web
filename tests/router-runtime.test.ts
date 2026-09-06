import assert from 'node:assert/strict'
import { it } from 'node:test'
import { RouterRuntime } from '../src/app/router-components'
import { navigate, createRouterHistoryState } from '../src/app/client-router'
import { act, installHookDom, renderHook } from './helpers/react-hook'

it('resets scroll only on navigation and preserves it across unrelated renders', async () => {
  const dom = installHookDom('http://localhost/search')
  const frames = new Map<number, FrameRequestCallback>()
  let frameId = 0
  let scrollY = 0
  const scrollCalls: number[] = []
  dom.window.requestAnimationFrame = (callback) => {
    frames.set(++frameId, callback)
    return frameId
  }
  dom.window.cancelAnimationFrame = (id) => { frames.delete(id) }
  Object.defineProperty(dom.window, 'scrollY', { get: () => scrollY })
  Object.defineProperty(dom.window.document.documentElement, 'scrollHeight', { value: 5000 })
  dom.window.scrollTo = ((options: ScrollToOptions) => {
    scrollY = options.top ?? scrollY
    scrollCalls.push(scrollY)
  }) as typeof window.scrollTo
  const flush = async () => {
    await act(async () => {
      const batch = [...frames.values()]
      frames.clear()
      batch.forEach((callback) => callback(0))
    })
  }
  const hook = await renderHook(() => RouterRuntime({}), undefined)
  try {
    for (const path of ['/search', '/hitomila/search', '/web-cache']) {
      await act(async () => { navigate(`${path}?page=2`) })
      await flush()
      assert.equal(scrollY, 0, 'navigation resets scroll')
      scrollCalls.length = 0
      scrollY = 800
      dom.window.dispatchEvent(new dom.window.Event('scroll'))
      await flush()
      await hook.rerender(undefined)
      await flush()
      assert.equal(scrollY, 800, path)
      assert.deepEqual(scrollCalls, [], 'unrelated render must not scroll')
    }
    await act(async () => {
      dom.window.history.replaceState(createRouterHistoryState(null, 'restored-entry', 600), '', '/search?page=1')
      dom.window.dispatchEvent(new dom.window.PopStateEvent('popstate'))
    })
    await flush()
    assert.equal(scrollY, 600, 'history navigation restores saved scroll')
    scrollY = 900
    dom.window.dispatchEvent(new dom.window.Event('scroll'))
    await flush()
    scrollCalls.length = 0
    await hook.rerender(undefined)
    await flush()
    assert.deepEqual(scrollCalls, [], 'render after history navigation must not restore again')
  } finally {
    await hook.unmount()
    dom.cleanup()
  }
})
