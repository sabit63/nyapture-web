import { useEffect, useState } from 'react'

import { ApiError, getBook, getErrorMessage, mapEBookToCard } from '../../api'
import type { ApiBookCardModel } from '../../api'
import { formatPageTitle, useDocumentTitle } from '../../app/page-title'
import { BookViewerPage } from '../../components/BookViewerPage'
import type { BookTag } from '../../models'

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
}

export function BookViewerRoute({ route, apiRevision, onTagSearch }: BookViewerRouteProps) {
  const [viewerBook, setViewerBook] = useState<ApiBookCardModel>()
  const [viewerState, setViewerState] = useState<BookViewerRouteState>(() => route.state === 'ready' ? 'loading' : 'missing')
  const [viewerError, setViewerError] = useState('')
  const [viewerRevision, setViewerRevision] = useState(0)
  const [viewerBookIdentity, setViewerBookIdentity] = useState('')

  const readyBook = viewerState === 'ready' && viewerBookIdentity === route.identity ? viewerBook : undefined
  useDocumentTitle(readyBook
    ? formatPageTitle(readyBook.title, 'Bookビューア')
    : formatPageTitle('Bookビューア'))

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
      book={viewerBook}
      routeIdentity={route.identity}
      errorMessage={viewerError}
      onRetry={() => setViewerRevision((current) => current + 1)}
      onTagSearch={onTagSearch}
    />
  )
}
