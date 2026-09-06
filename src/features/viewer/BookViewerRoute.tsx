import { useCallback, useEffect, useMemo, useState } from 'react'
import type { RefObject } from 'react'

import { ApiError, getBook, getErrorMessage, mapEBookToCard } from '../../api'
import type { ApiBookCardModel } from '../../api'
import { formatPageTitle, useDocumentTitle } from '../../app/page-title'
import { useRouteContentCommitted } from '../../app/use-route-content-committed'
import { BookViewerPage } from './BookViewerPage'
import type { BookTag } from '../../models'
import { applyTagDisplayNameOverrides, type TagDisplayNameOverrides } from '../search/tag-display-name'

import type { BookViewerRouteData, BookViewerRouteState } from './viewer-route'

export type BookViewerRouteProps = {
  route: BookViewerRouteData
  apiRevision: number
  onBookChange: (book: ApiBookCardModel) => void
  onTagSearch: (tag: BookTag) => void
  onTagSearchDestinationRequest: (tag: BookTag, trigger: HTMLButtonElement) => void
  tagDisplayNameOverrides: TagDisplayNameOverrides
  detailsOpen: boolean
  onDetailsOpenChange: (open: boolean) => void
  detailsTriggerRef: RefObject<HTMLButtonElement | null>
  onReadyChange: (ready: boolean) => void
}

export function BookViewerRoute({
  route,
  apiRevision,
  onBookChange,
  onTagSearch,
  onTagSearchDestinationRequest,
  tagDisplayNameOverrides,
  detailsOpen,
  onDetailsOpenChange,
  detailsTriggerRef,
  onReadyChange,
}: BookViewerRouteProps) {
  const [viewerBook, setViewerBook] = useState<ApiBookCardModel>()
  const [viewerState, setViewerState] = useState<BookViewerRouteState>(() => route.state === 'ready' ? 'loading' : 'missing')
  const [viewerError, setViewerError] = useState('')
  const [viewerRevision, setViewerRevision] = useState(0)
  const [viewerBookIdentity, setViewerBookIdentity] = useState('')
  const updateViewerBookTitle = useCallback((groupId: string, bookId: string, title: string) => {
    setViewerBook((current) => {
      if (!current || current.groupId !== groupId || current.bookId !== bookId) return current
      return { ...current, title }
    })
  }, [])

  const updateViewerBook = useCallback((updated: ApiBookCardModel) => {
    setViewerBook((current) => current?.groupId === updated.groupId && current.bookId === updated.bookId ? updated : current)
    onBookChange(updated)
  }, [onBookChange])

  const readyBook = viewerState === 'ready' && viewerBookIdentity === route.identity ? viewerBook : undefined
  useRouteContentCommitted(readyBook)
  const displayBook = useMemo(() => {
    if (!readyBook || tagDisplayNameOverrides.size === 0) return readyBook
    const tags = applyTagDisplayNameOverrides(readyBook.tags, tagDisplayNameOverrides)
    return tags === readyBook.tags ? readyBook : { ...readyBook, tags }
  }, [readyBook, tagDisplayNameOverrides])
  useDocumentTitle(displayBook
    ? formatPageTitle(displayBook.title, 'Bookビューア')
    : formatPageTitle('Bookビューア'))

  useEffect(() => {
    onReadyChange(Boolean(displayBook))
  }, [displayBook, onReadyChange])

  useEffect(() => {
    if (route.state !== 'ready' || !route.groupId || !route.bookId) {
      setViewerState('missing')
      setViewerBook(undefined)
      setViewerBookIdentity('')
      return
    }
    const controller = new AbortController()
    setViewerState('loading')
    setViewerError('')
    setViewerBook(undefined)
    setViewerBookIdentity('')
    getBook(route.groupId, route.bookId, controller.signal)
      .then((response) => {
        if (controller.signal.aborted) return
        const book = response.books?.[0]
        if (!book) {
          setViewerState('notFound')
          return
        }
        setViewerBook(mapEBookToCard(book, { context: 'library', entities: response.tags ?? [] }))
        setViewerBookIdentity(route.identity)
        setViewerState('ready')
      })
      .catch((error) => {
        if (controller.signal.aborted) return
        if (error instanceof ApiError && error.category === 'notFound') {
          setViewerState('notFound')
          return
        }
        setViewerError(getErrorMessage(error))
        setViewerState('error')
      })
    return () => controller.abort()
  }, [apiRevision, route.bookId, route.groupId, route.identity, route.state, viewerRevision])

  return (
    <BookViewerPage
      routeState={viewerState}
      book={displayBook}
      routeIdentity={route.identity}
      errorMessage={viewerError}
      onRetry={() => setViewerRevision((current) => current + 1)}
      onBookChange={updateViewerBook}
      onTitleChange={updateViewerBookTitle}
      onTagSearch={onTagSearch}
      onTagSearchDestinationRequest={onTagSearchDestinationRequest}
      detailsOpen={detailsOpen}
      onDetailsOpenChange={onDetailsOpenChange}
      detailsTriggerRef={detailsTriggerRef}
    />
  )
}
