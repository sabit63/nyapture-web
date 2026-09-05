import { useCallback, useEffect, useMemo, useState } from 'react'
import type { RefObject } from 'react'

import { ApiError, getBook, getErrorMessage, mapEBookToCard } from '../../api'
import type { ApiBookCardModel } from '../../api'
import { formatPageTitle, useDocumentTitle } from '../../app/page-title'
import { BookViewerPage } from '../../components/BookViewerPage'
import type { BookTag } from '../../models'
import { applyTagDisplayNameOverrides, type TagDisplayNameOverrides } from '../search/tag-display-name'

export type BookViewerRouteState = 'missing' | 'loading' | 'notFound' | 'error' | 'ready'

export type BookViewerRouteData = {
  state: 'missing' | 'ready'
  groupId?: string
  bookId?: string
  identity: string
}

const hasBookIdentifier = (value: string | undefined) => Boolean(value?.trim())

export const resolveBookViewerRoute = (search: string): BookViewerRouteData => {
  const params = new URLSearchParams(search)
  const idParam = params.get('id')
  const gidParam = params.get('gid')
  const identity = `${idParam ?? ''}\u0000${gidParam ?? ''}`

  if (idParam === null || gidParam === null || !hasBookIdentifier(idParam) || !hasBookIdentifier(gidParam)) {
    return { state: 'missing', identity }
  }

  return { state: 'ready', groupId: gidParam, bookId: idParam, identity }
}

export type BookViewerRouteProps = {
  route: BookViewerRouteData
  apiRevision: number
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

  const readyBook = viewerState === 'ready' && viewerBookIdentity === route.identity ? viewerBook : undefined
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
  }, [apiRevision, route.bookId, route.groupId, route.state, viewerRevision])

  return (
    <BookViewerPage
      routeState={viewerState}
      book={displayBook}
      routeIdentity={route.identity}
      errorMessage={viewerError}
      onRetry={() => setViewerRevision((current) => current + 1)}
      onTitleChange={updateViewerBookTitle}
      onTagSearch={onTagSearch}
      onTagSearchDestinationRequest={onTagSearchDestinationRequest}
      detailsOpen={detailsOpen}
      onDetailsOpenChange={onDetailsOpenChange}
      detailsTriggerRef={detailsTriggerRef}
    />
  )
}
