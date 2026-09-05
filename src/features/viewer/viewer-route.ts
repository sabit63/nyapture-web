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
