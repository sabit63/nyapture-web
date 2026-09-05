import { forwardRef, useCallback, useEffect, useRef, type AnchorHTMLAttributes, type MouseEvent as ReactMouseEvent, type ReactNode, type Ref } from 'react'
import { navigate, shouldInterceptNavigationClick, useRouterLocation, locationStore, readRouterHistoryMetadata, runScheduledScrollSave, persistScrollPosition, beginPendingScrollRestoration } from './client-router'

const getAnchorTarget = (anchor: HTMLAnchorElement) => (
  anchor.hasAttribute('target') ? anchor.getAttribute('target') : null
)

export type InternalLinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  ref?: Ref<HTMLAnchorElement>
}

export const InternalLink = forwardRef<HTMLAnchorElement, Omit<InternalLinkProps, 'ref'>>(({
  href,
  onClick,
  ...props
}, ref) => {
  const handleClick = useCallback((event: ReactMouseEvent<HTMLAnchorElement>) => {
    onClick?.(event)
    if (event.defaultPrevented || typeof window === 'undefined') return
    const anchor = event.currentTarget
    if (!shouldInterceptNavigationClick({
      button: event.button,
      defaultPrevented: event.defaultPrevented,
      metaKey: event.metaKey,
      ctrlKey: event.ctrlKey,
      shiftKey: event.shiftKey,
      altKey: event.altKey,
      target: getAnchorTarget(anchor),
      download: anchor.hasAttribute('download'),
      href: anchor.href,
      currentHref: window.location.href,
      currentOrigin: window.location.origin,
    })) return
    event.preventDefault()
    navigate(anchor.href)
  }, [onClick])

  return <a ref={ref} href={href} onClick={handleClick} {...props} />
})
InternalLink.displayName = 'InternalLink'

const focusDestinationHeading = () => {
  if (typeof document === 'undefined') return
  const heading = document.querySelector<HTMLElement>('main h1, main [role="heading"]')
  if (!heading) return
  const hadTabIndex = heading.hasAttribute('tabindex')
  if (!hadTabIndex) heading.setAttribute('tabindex', '-1')
  heading.focus({ preventScroll: true })
}

export function RouterRuntime({ children }: { children?: ReactNode }) {
  const location = useRouterLocation()
  const scrollFrameRef = useRef<number | null>(null)

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.history.scrollRestoration = 'manual'
    locationStore.ensureHistoryEntry()
    const onScroll = () => {
      if (scrollFrameRef.current !== null) return
      const expectedEntryId = readRouterHistoryMetadata(window.history.state)?.entryId
        ?? locationStore.ensureHistoryEntry()?.entryId
      if (!expectedEntryId) return
      const persist = () => {
        scrollFrameRef.current = null
        runScheduledScrollSave({
          expectedEntryId,
          scrollY: window.scrollY,
          getCurrentEntryId: () => readRouterHistoryMetadata(window.history.state)?.entryId ?? null,
          save: (scrollY) => persistScrollPosition(scrollY, expectedEntryId),
        })
      }
      if (typeof window.requestAnimationFrame === 'function') {
        scrollFrameRef.current = window.requestAnimationFrame(persist)
      } else {
        persist()
      }
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', onScroll)
      if (scrollFrameRef.current !== null) window.cancelAnimationFrame(scrollFrameRef.current)
      scrollFrameRef.current = null
    }
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined' || location.revision === 0) return
    const frame = typeof window.requestAnimationFrame === 'function'
      ? window.requestAnimationFrame(() => {
        if (location.navigationType === 'pop') {
          if (location.history?.entryId) {
            beginPendingScrollRestoration(location.history.entryId, location.history.scrollY)
          } else {
            window.scrollTo({ top: 0, behavior: 'auto' })
          }
          focusDestinationHeading()
        } else {
          window.scrollTo({ top: 0, behavior: 'auto' })
          focusDestinationHeading()
        }
      })
      : undefined
    if (frame === undefined) {
      if (location.navigationType === 'pop' && location.history?.entryId) {
        beginPendingScrollRestoration(location.history.entryId, location.history.scrollY)
      } else {
        window.scrollTo({ top: 0, behavior: 'auto' })
      }
      focusDestinationHeading()
    }
    return () => {
      if (frame !== undefined) window.cancelAnimationFrame(frame)
    }
  }, [location.history?.entryId, location.history?.scrollY, location.navigationType, location.revision])

  return children ?? null
}
