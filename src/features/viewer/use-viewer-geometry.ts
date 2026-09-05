import { useEffect, useRef, useState } from 'react'
import { BookPageLoader, getBookPageRequestWidth } from './book-page-loading'

const getPageNumber = (target: Element) => Number(target.getAttribute('data-page-number') ?? 0)

const pickClosestEntry = (entries: Map<Element, IntersectionObserverEntry>) => {
  const viewportCenter = window.innerHeight / 2
  let closest: IntersectionObserverEntry | undefined
  let closestDistance = Number.POSITIVE_INFINITY

  entries.forEach((entry) => {
    if (!entry.isIntersecting) return
    const rect = entry.target.getBoundingClientRect()
    const distance = Math.abs((rect.top + rect.bottom) / 2 - viewportCenter)
    if (distance < closestDistance) {
      closest = entry
      closestDistance = distance
    }
  })

  return closest
}

export function useViewerGeometry(bookIdentity: string, totalPages: number, pageLoader: BookPageLoader) {
  const readerRef = useRef<HTMLElement>(null)
  const [currentPage, setCurrentPage] = useState(totalPages > 0 ? 1 : 0)
  const [showScrollTop, setShowScrollTop] = useState(false)
  useEffect(() => {
    const updateVisibility = () => pageLoader.setBackgrounded(document.hidden)
    updateVisibility()
    document.addEventListener('visibilitychange', updateVisibility)
    return () => document.removeEventListener('visibilitychange', updateVisibility)
  }, [pageLoader])

  useEffect(() => {
    setCurrentPage(totalPages > 0 ? 1 : 0)
  }, [bookIdentity, totalPages])

  useEffect(() => {
    const reader = readerRef.current
    if (!reader) return
    let frame: number | undefined
    const measure = () => {
      frame = undefined
      pageLoader.setRequestWidth(getBookPageRequestWidth(
        reader.getBoundingClientRect().width,
        window.devicePixelRatio,
      ))
    }
    const scheduleMeasure = () => {
      if (frame !== undefined) return
      frame = window.requestAnimationFrame(measure)
    }
    measure()
    const observer = typeof ResizeObserver === 'undefined'
      ? undefined
      : new ResizeObserver(scheduleMeasure)
    observer?.observe(reader)
    window.addEventListener('resize', scheduleMeasure, { passive: true })
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', scheduleMeasure)
      if (frame !== undefined) window.cancelAnimationFrame(frame)
    }
  }, [pageLoader])

  useEffect(() => {
    const updateScrollTopVisibility = () => setShowScrollTop(window.scrollY > 420)
    updateScrollTopVisibility()
    window.addEventListener('scroll', updateScrollTopVisibility, { passive: true })
    return () => window.removeEventListener('scroll', updateScrollTopVisibility)
  }, [])

  useEffect(() => {
    const reader = readerRef.current
    if (!reader || totalPages === 0 || typeof IntersectionObserver === 'undefined') return

    const pageElements = Array.from(reader.querySelectorAll<HTMLElement>('[data-page-number]'))
    const activeEntries = new Map<Element, IntersectionObserverEntry>()
    const centerEntries = new Map<Element, IntersectionObserverEntry>()

    const updateFromCenter = () => {
      const candidate = pickClosestEntry(centerEntries)
      if (!candidate) return
      const pageNumber = getPageNumber(candidate.target)
      if (pageNumber > 0 && activeEntries.has(candidate.target)) {
        setCurrentPage(pageNumber)
        pageLoader.setCurrentPage(pageNumber)
      }
    }

    const activeObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        const pageNumber = getPageNumber(entry.target)
        if (entry.isIntersecting) activeEntries.set(entry.target, entry)
        else activeEntries.delete(entry.target)
        if (pageNumber > 0) pageLoader.setVisible(pageNumber, entry.isIntersecting)
      })
      updateFromCenter()
    }, { threshold: [0, 0.1, 0.5, 1] })

    const centerObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) centerEntries.set(entry.target, entry)
        else centerEntries.delete(entry.target)
      })
      updateFromCenter()
    }, {
      rootMargin: '-45% 0px -45% 0px',
      threshold: [0, 0.01, 0.5, 1],
    })

    pageElements.forEach((pageElement) => {
      activeObserver.observe(pageElement)
      centerObserver.observe(pageElement)
    })

    return () => {
      activeObserver.disconnect()
      centerObserver.disconnect()
      activeEntries.clear()
      centerEntries.clear()
    }
  }, [bookIdentity, pageLoader, totalPages])

  useEffect(() => {
    const reader = readerRef.current
    if (!reader || totalPages === 0 || typeof IntersectionObserver === 'undefined') return
    const pageElements = Array.from(reader.querySelectorAll<HTMLElement>('[data-page-number]'))
    let loadObserver: IntersectionObserver | undefined
    let retentionObserver: IntersectionObserver | undefined
    let frame: number | undefined
    let observedViewportHeight = 0

    const observeRanges = () => {
      frame = undefined
      const viewportHeight = Math.max(1, Math.round(window.innerHeight))
      if (viewportHeight === observedViewportHeight && loadObserver && retentionObserver) return
      observedViewportHeight = viewportHeight
      loadObserver?.disconnect()
      retentionObserver?.disconnect()
      loadObserver = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          const pageNumber = getPageNumber(entry.target)
          if (pageNumber > 0) pageLoader.setLoadRange(pageNumber, entry.isIntersecting)
        })
      }, { rootMargin: `${viewportHeight * 2}px 0px`, threshold: 0 })
      retentionObserver = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          const pageNumber = getPageNumber(entry.target)
          if (pageNumber > 0) pageLoader.setRetentionRange(pageNumber, entry.isIntersecting)
        })
      }, { rootMargin: `${viewportHeight * 3}px 0px`, threshold: 0 })
      pageElements.forEach((pageElement) => {
        loadObserver?.observe(pageElement)
        retentionObserver?.observe(pageElement)
      })
    }
    const scheduleRanges = () => {
      if (frame !== undefined) return
      frame = window.requestAnimationFrame(observeRanges)
    }

    observeRanges()
    window.addEventListener('resize', scheduleRanges, { passive: true })
    return () => {
      loadObserver?.disconnect()
      retentionObserver?.disconnect()
      window.removeEventListener('resize', scheduleRanges)
      if (frame !== undefined) window.cancelAnimationFrame(frame)
    }
  }, [bookIdentity, pageLoader, totalPages])

  useEffect(() => {
    const reader = readerRef.current
    if (!reader || totalPages === 0 || typeof IntersectionObserver !== 'undefined') return
    const pageElements = Array.from(reader.querySelectorAll<HTMLElement>('[data-page-number]'))
    type PageRange = { start: number; end: number } | null
    let visibleRange: PageRange = null
    let loadRange: PageRange = null
    let retentionRange: PageRange = null
    let frame: number | undefined

    const findRange = (margin: number): PageRange => {
      const minimum = -margin
      const maximum = window.innerHeight + margin
      let low = 0
      let high = pageElements.length
      while (low < high) {
        const middle = Math.floor((low + high) / 2)
        if (pageElements[middle].getBoundingClientRect().bottom < minimum) low = middle + 1
        else high = middle
      }
      const start = low
      low = start
      high = pageElements.length
      while (low < high) {
        const middle = Math.floor((low + high) / 2)
        if (pageElements[middle].getBoundingClientRect().top <= maximum) low = middle + 1
        else high = middle
      }
      const end = low - 1
      return start <= end && start < pageElements.length
        ? { start: start + 1, end: end + 1 }
        : null
    }

    const updateRange = (
      previous: PageRange,
      next: PageRange,
      update: (pageNumber: number, inRange: boolean) => void,
    ) => {
      if (previous) {
        for (let pageNumber = previous.start; pageNumber <= previous.end; pageNumber += 1) {
          if (!next || pageNumber < next.start || pageNumber > next.end) update(pageNumber, false)
        }
      }
      if (next) {
        for (let pageNumber = next.start; pageNumber <= next.end; pageNumber += 1) {
          if (!previous || pageNumber < previous.start || pageNumber > previous.end) update(pageNumber, true)
        }
      }
    }

    const updateFallbackRanges = () => {
      frame = undefined
      const viewportHeight = Math.max(1, window.innerHeight)
      const nextVisibleRange = findRange(0)
      const nextLoadRange = findRange(viewportHeight * 2)
      const nextRetentionRange = findRange(viewportHeight * 3)
      updateRange(visibleRange, nextVisibleRange, (pageNumber, inRange) => pageLoader.setVisible(pageNumber, inRange))
      updateRange(loadRange, nextLoadRange, (pageNumber, inRange) => pageLoader.setLoadRange(pageNumber, inRange))
      updateRange(retentionRange, nextRetentionRange, (pageNumber, inRange) => pageLoader.setRetentionRange(pageNumber, inRange))
      visibleRange = nextVisibleRange
      loadRange = nextLoadRange
      retentionRange = nextRetentionRange

      const currentCandidates = nextVisibleRange ?? nextLoadRange
      if (currentCandidates) {
        const viewportCenter = window.innerHeight / 2
        let nextCurrentPage = currentCandidates.start
        let closestDistance = Number.POSITIVE_INFINITY
        for (let pageNumber = currentCandidates.start; pageNumber <= currentCandidates.end; pageNumber += 1) {
          const rect = pageElements[pageNumber - 1].getBoundingClientRect()
          const distance = Math.abs((rect.top + rect.bottom) / 2 - viewportCenter)
          if (distance < closestDistance) {
            closestDistance = distance
            nextCurrentPage = pageNumber
          }
        }
        setCurrentPage(nextCurrentPage)
        pageLoader.setCurrentPage(nextCurrentPage)
      }
    }
    const scheduleFallbackRanges = () => {
      if (frame !== undefined) return
      frame = window.requestAnimationFrame(updateFallbackRanges)
    }

    const unsubscribeGeometry = pageLoader.subscribeGeometry(scheduleFallbackRanges)
    window.addEventListener('scroll', scheduleFallbackRanges, { passive: true })
    window.addEventListener('resize', scheduleFallbackRanges, { passive: true })
    updateFallbackRanges()
    return () => {
      unsubscribeGeometry()
      window.removeEventListener('scroll', scheduleFallbackRanges)
      window.removeEventListener('resize', scheduleFallbackRanges)
      if (frame !== undefined) window.cancelAnimationFrame(frame)
      updateRange(visibleRange, null, (pageNumber, inRange) => pageLoader.setVisible(pageNumber, inRange))
      updateRange(loadRange, null, (pageNumber, inRange) => pageLoader.setLoadRange(pageNumber, inRange))
      updateRange(retentionRange, null, (pageNumber, inRange) => pageLoader.setRetentionRange(pageNumber, inRange))
    }
  }, [bookIdentity, pageLoader, totalPages])

  return { readerRef, currentPage, showScrollTop }
}
