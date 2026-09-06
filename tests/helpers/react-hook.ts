import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { JSDOM } from 'jsdom'

/** Isolated DOM with no network fallback. Call cleanup after unmounting hooks. */
export function installHookDom(url = 'http://localhost/library') {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url,
    pretendToBeVisual: true,
  })
  const replacements: Record<string, unknown> = {
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement,
    HTMLDialogElement: dom.window.HTMLDialogElement,
    HTMLAnchorElement: dom.window.HTMLAnchorElement,
    Element: dom.window.Element,
    Node: dom.window.Node,
    MutationObserver: dom.window.MutationObserver,
    requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
    cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
    IS_REACT_ACT_ENVIRONMENT: true,
    fetch: async () => { throw new Error('Unmocked network request in hook test') },
  }
  const originals = new Map<string, PropertyDescriptor | undefined>()
  for (const [key, value] of Object.entries(replacements)) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
  }
  return {
    window: dom.window,
    cleanup() {
      dom.window.close()
      for (const [key, descriptor] of originals) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor)
        else Reflect.deleteProperty(globalThis, key)
      }
    },
  }
}

export async function renderHook<Props, Result>(hook: (props: Props) => Result, initialProps: Props) {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  let current: Result
  function Probe({ value }: { value: Props }) {
    current = hook(value)
    return null
  }
  await act(async () => { root.render(createElement(Probe, { value: initialProps })) })
  return {
    get current() { return current },
    async rerender(props: Props) {
      await act(async () => { root.render(createElement(Probe, { value: props })) })
    },
    async unmount() {
      await act(async () => { root.unmount() })
      container.remove()
    },
  }
}

export function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((accept, fail) => { resolve = accept; reject = fail })
  return { promise, resolve, reject }
}

export { act }
