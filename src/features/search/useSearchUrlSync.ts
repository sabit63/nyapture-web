import { useCallback, useEffect, useMemo, type Dispatch, type SetStateAction } from 'react'

import { navigate, useRouterLocation, type RouterLocation } from '../../app/client-router'
import type { HitomiAppend, NyaTagType, SearchCriteria } from '../../models'
import {
  cloneCriteria,
  parseCriteriaForRoute,
  parseHitomiAppend,
  parsePageParam,
  validateCriteria,
  type SearchValidationErrors,
} from './search-utils'

export type SearchUrlSyncOptions = {
  isWebSearch: boolean
  isLibrarySearch: boolean
  isMissingTagSearch: boolean
  routeBindingsRef?: { current: SearchRouteStateBindings | null }
}

export type SearchRouteStateBindings = {
  setCriteria: Dispatch<SetStateAction<SearchCriteria>>
  setQuery: Dispatch<SetStateAction<string>>
  setDraftMissingTagTypes: Dispatch<SetStateAction<NyaTagType[]>>
  setMissingTagsError: Dispatch<SetStateAction<string>>
  setDraftCriteria: Dispatch<SetStateAction<SearchCriteria>>
  setHitomiAppend: Dispatch<SetStateAction<HitomiAppend>>
  setDraftHitomiAppend: Dispatch<SetStateAction<HitomiAppend>>
  setResultPageState: Dispatch<SetStateAction<number>>
  setAdvancedErrors: Dispatch<SetStateAction<SearchValidationErrors>>
  setSelected: Dispatch<SetStateAction<string[]>>
}

export type SearchRouteState = {
  routerLocation: RouterLocation
  routeSearchParams: URLSearchParams
  routeCriteria: SearchCriteria
  routeHitomiAppend: HitomiAppend
  routeResultPage: number
}

export type SearchRouteSynchronizedArgs = {
  criteria: SearchCriteria
  hitomiAppend: HitomiAppend
  resultPage: number
}

/**
 * Keep the route comparison independent from React state identity. Search
 * state can be cloned while the route remains unchanged, so only the fields
 * represented in the URL participate in this key.
 */
export const searchCriteriaRouteKey = (
  criteria: SearchCriteria,
  hitomiAppend: HitomiAppend,
  resultPage: number,
  isWebSearch: boolean,
) => JSON.stringify({
  text: criteria.text,
  tags: criteria.tags.map((tag) => ({ type: tag.type, name: tag.name })),
  tagMode: criteria.tagMode,
  missingTagTypes: criteria.missingTagTypes,
  dateFrom: criteria.dateFrom,
  dateTo: criteria.dateTo,
  pagesMin: criteria.pagesMin,
  pagesMax: criteria.pagesMax,
  hitomiAppend: isWebSearch ? hitomiAppend : 'Normal',
  resultPage,
})

export const areSearchRouteValuesSynchronized = ({
  criteria,
  hitomiAppend,
  resultPage,
  routeCriteria,
  routeHitomiAppend,
  routeResultPage,
  isWebSearch,
  isLibrarySearch,
}: SearchRouteSynchronizedArgs & {
  routeCriteria: SearchCriteria
  routeHitomiAppend: HitomiAppend
  routeResultPage: number
  isWebSearch: boolean
  isLibrarySearch: boolean
}) => {
  if (!isLibrarySearch && !isWebSearch) return true
  return searchCriteriaRouteKey(criteria, hitomiAppend, resultPage, isWebSearch)
    === searchCriteriaRouteKey(routeCriteria, routeHitomiAppend, routeResultPage, isWebSearch)
}

export type SearchRouteSyncNavigation = (url: URL, onSameUrl?: () => void) => void

export function useSearchUrlSync({
  isWebSearch,
  isLibrarySearch,
  isMissingTagSearch,
  routeBindingsRef,
}: SearchUrlSyncOptions) {
  const routerLocation = useRouterLocation()
  const routeSearchParams = useMemo(() => new URLSearchParams(routerLocation.search), [routerLocation.search])
  const routeCriteria = useMemo(
    () => parseCriteriaForRoute(routeSearchParams, isWebSearch, isMissingTagSearch),
    [isMissingTagSearch, isWebSearch, routeSearchParams],
  )
  const routeHitomiAppend = isWebSearch ? parseHitomiAppend(routeSearchParams) : 'Normal'
  const routeResultPage = parsePageParam(routeSearchParams.get('page'))

  const navigateSearchUrl = useCallback<SearchRouteSyncNavigation>((url, onSameUrl) => {
    if (url.href === routerLocation.href) {
      onSameUrl?.()
      return
    }
    navigate(url)
  }, [routerLocation.href])

  const setResultPage = useCallback((value: SetStateAction<number>, currentPage: number) => {
    const nextPage = Math.max(1, Math.floor(typeof value === 'function' ? value(currentPage) : value))
    if (nextPage === currentPage) return
    const url = new URL(routerLocation.href)
    url.searchParams.set('page', String(nextPage))
    navigate(url)
  }, [routerLocation.href])

  const isRouteStateSynchronized = useCallback((args: SearchRouteSynchronizedArgs) => (
    areSearchRouteValuesSynchronized({
      ...args,
      routeCriteria,
      routeHitomiAppend,
      routeResultPage,
      isWebSearch,
      isLibrarySearch,
    })
  ), [isLibrarySearch, isWebSearch, routeCriteria, routeHitomiAppend, routeResultPage])

  const synchronizeRouteState = useCallback((bindings: SearchRouteStateBindings) => {
    if (!isLibrarySearch && !isWebSearch) return false
    bindings.setCriteria(cloneCriteria(routeCriteria))
    bindings.setQuery(routeCriteria.text)
    bindings.setDraftMissingTagTypes([...(routeCriteria.missingTagTypes ?? [])])
    bindings.setMissingTagsError(validateCriteria(routeCriteria, isMissingTagSearch).missingTags ?? '')
    bindings.setDraftCriteria(cloneCriteria(routeCriteria))
    bindings.setHitomiAppend(routeHitomiAppend)
    bindings.setDraftHitomiAppend(routeHitomiAppend)
    bindings.setResultPageState(routeResultPage)
    bindings.setAdvancedErrors({})
    bindings.setSelected([])
    return true
  }, [isLibrarySearch, isMissingTagSearch, isWebSearch, routeCriteria, routeHitomiAppend, routeResultPage])

  useEffect(() => {
    const bindings = routeBindingsRef?.current
    if (!bindings) return
    synchronizeRouteState(bindings)
  }, [routeBindingsRef, routerLocation.pathname, routerLocation.search, synchronizeRouteState])

  return {
    routerLocation,
    routeSearchParams,
    routeCriteria,
    routeHitomiAppend,
    routeResultPage,
    isRouteStateSynchronized,
    navigateSearchUrl,
    setResultPage,
    synchronizeRouteState,
  } satisfies SearchRouteState & {
    isRouteStateSynchronized: (args: SearchRouteSynchronizedArgs) => boolean
    navigateSearchUrl: SearchRouteSyncNavigation
    setResultPage: (value: SetStateAction<number>, currentPage: number) => void
    synchronizeRouteState: (bindings: SearchRouteStateBindings) => boolean
  }
}
