import { useEffect } from 'react'
import { retryPendingScrollRestoration } from './client-router'

/** Retry after the DOM commit, including subsequent image/layout changes. */
export function useRouteContentCommitted(content: unknown) {
  useEffect(() => {
    const retry = () => { retryPendingScrollRestoration() }
    retry()
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(retry)
    observer?.observe(document.body)
    return () => observer?.disconnect()
  }, [content])
}
