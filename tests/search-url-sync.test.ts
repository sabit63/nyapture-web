import assert from 'node:assert/strict'
import test from 'node:test'
import { useRef, useState } from 'react'

import { act, installHookDom, renderHook } from './helpers/react-hook'
import type { NyaTagType, SearchCriteria } from '../src/models'
import { emptyCriteria } from '../src/features/search/search-utils'
import { useSearchUrlSync, type SearchRouteStateBindings } from '../src/features/search/useSearchUrlSync'

test('URL sync derives route criteria and applies it to controller bindings', async () => {
  const dom = installHookDom('http://localhost/search?q=sample&tag=Artists:alice&page=4')
  const mounted = await renderHook(() => {
    const [criteria, setCriteria] = useState<SearchCriteria>(emptyCriteria)
    const [query, setQuery] = useState('')
    const [missingTagTypes, setMissingTagTypes] = useState<NyaTagType[]>([])
    const [missingTagsError, setMissingTagsError] = useState('')
    const [draftCriteria, setDraftCriteria] = useState<SearchCriteria>(emptyCriteria)
    const [hitomiAppend, setHitomiAppend] = useState<'Normal' | 'Male' | 'Female'>('Normal')
    const [draftHitomiAppend, setDraftHitomiAppend] = useState<'Normal' | 'Male' | 'Female'>('Normal')
    const [resultPage, setResultPage] = useState(1)
    const [advancedErrors, setAdvancedErrors] = useState<{ date?: string; pages?: string; missingTags?: string }>({})
    const [selected, setSelected] = useState<string[]>([])
    const sync = useSearchUrlSync({ isWebSearch: false, isLibrarySearch: true, isMissingTagSearch: false })
    return {
      sync,
      criteria,
      query,
      missingTagTypes,
      missingTagsError,
      draftCriteria,
      hitomiAppend,
      draftHitomiAppend,
      resultPage,
      advancedErrors,
      selected,
      setters: {
        setCriteria,
        setQuery,
        setMissingTagTypes,
        setMissingTagsError,
        setDraftCriteria,
        setHitomiAppend,
        setDraftHitomiAppend,
        setResultPage,
        setAdvancedErrors,
        setSelected,
      },
    }
  }, undefined)

  try {
    assert.equal(mounted.current.sync.routeCriteria.text, 'sample')
    assert.deepEqual(mounted.current.sync.routeCriteria.tags, [{ type: 'Artists', name: 'alice' }])
    assert.equal(mounted.current.sync.routeResultPage, 4)

    await act(async () => {
      mounted.current.sync.synchronizeRouteState({
        setCriteria: mounted.current.setters.setCriteria,
        setQuery: mounted.current.setters.setQuery,
        setDraftMissingTagTypes: mounted.current.setters.setMissingTagTypes,
        setMissingTagsError: mounted.current.setters.setMissingTagsError,
        setDraftCriteria: mounted.current.setters.setDraftCriteria,
        setHitomiAppend: mounted.current.setters.setHitomiAppend,
        setDraftHitomiAppend: mounted.current.setters.setDraftHitomiAppend,
        setResultPageState: mounted.current.setters.setResultPage,
        setAdvancedErrors: mounted.current.setters.setAdvancedErrors,
        setSelected: mounted.current.setters.setSelected,
      })
    })

    assert.equal(mounted.current.criteria.text, 'sample')
    assert.deepEqual(mounted.current.criteria.tags, [{ type: 'Artists', name: 'alice' }])
    assert.equal(mounted.current.query, 'sample')
    assert.equal(mounted.current.resultPage, 4)
    assert.deepEqual(mounted.current.selected, [])
    assert.equal(mounted.current.sync.isRouteStateSynchronized({
      criteria: mounted.current.criteria,
      hitomiAppend: mounted.current.hitomiAppend,
      resultPage: mounted.current.resultPage,
    }), true)
  } finally {
    await mounted.unmount()
    dom.cleanup()
  }
})

test('URL sync navigates result pages and refreshes same-URL searches through its callback', async () => {
  const dom = installHookDom('http://localhost/search?q=sample&page=1')
  const mounted = await renderHook(
    () => useSearchUrlSync({ isWebSearch: false, isLibrarySearch: true, isMissingTagSearch: false }),
    undefined,
  )

  try {
    let sameUrlCalls = 0
    const currentUrl = new URL(mounted.current.routerLocation.href)
    mounted.current.navigateSearchUrl(currentUrl, () => { sameUrlCalls += 1 })
    assert.equal(sameUrlCalls, 1)

    await act(async () => {
      mounted.current.setResultPage(3, 1)
    })
    assert.equal(dom.window.location.search, '?q=sample&page=3')
  } finally {
    await mounted.unmount()
    dom.cleanup()
  }
})

test('URL sync follows browser history back and forward for route criteria and page', async () => {
  const dom = installHookDom('http://localhost/search?q=first&page=1')
  const mounted = await renderHook(() => {
    const [criteria, setCriteria] = useState<SearchCriteria>(emptyCriteria)
    const [query, setQuery] = useState('')
    const [missingTagTypes, setMissingTagTypes] = useState<NyaTagType[]>([])
    const [missingTagsError, setMissingTagsError] = useState('')
    const [draftCriteria, setDraftCriteria] = useState<SearchCriteria>(emptyCriteria)
    const [hitomiAppend, setHitomiAppend] = useState<'Normal' | 'Male' | 'Female'>('Normal')
    const [draftHitomiAppend, setDraftHitomiAppend] = useState<'Normal' | 'Male' | 'Female'>('Normal')
    const [resultPage, setResultPage] = useState(1)
    const [advancedErrors, setAdvancedErrors] = useState<{ date?: string; pages?: string; missingTags?: string }>({})
    const [selected, setSelected] = useState<string[]>([])
    const routeBindingsRef = useRef<SearchRouteStateBindings | null>(null)
    const sync = useSearchUrlSync({
      isWebSearch: false,
      isLibrarySearch: true,
      isMissingTagSearch: false,
      routeBindingsRef,
    })
    routeBindingsRef.current = {
      setCriteria,
      setQuery,
      setDraftMissingTagTypes: setMissingTagTypes,
      setMissingTagsError,
      setDraftCriteria,
      setHitomiAppend,
      setDraftHitomiAppend,
      setResultPageState: setResultPage,
      setAdvancedErrors,
      setSelected,
    }
    return { sync, criteria, query, resultPage, selected }
  }, undefined)

  const waitForRouter = async () => {
    await act(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
    })
  }

  try {
    assert.equal(mounted.current.criteria.text, 'first')
    assert.equal(mounted.current.resultPage, 1)

    await act(async () => {
      mounted.current.sync.navigateSearchUrl(new URL('http://localhost/search?q=second&page=2'))
    })
    await waitForRouter()
    assert.equal(dom.window.location.search, '?q=second&page=2')
    assert.equal(mounted.current.criteria.text, 'second')
    assert.equal(mounted.current.resultPage, 2)

    await act(async () => {
      dom.window.history.back()
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
    })
    await waitForRouter()
    assert.equal(dom.window.location.search, '?q=first&page=1')
    assert.equal(mounted.current.sync.routeCriteria.text, 'first')
    assert.equal(mounted.current.sync.routeResultPage, 1)
    assert.equal(mounted.current.criteria.text, 'first')
    assert.equal(mounted.current.resultPage, 1)

    await act(async () => {
      dom.window.history.forward()
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
    })
    await waitForRouter()
    assert.equal(dom.window.location.search, '?q=second&page=2')
    assert.equal(mounted.current.sync.routeCriteria.text, 'second')
    assert.equal(mounted.current.sync.routeResultPage, 2)
    assert.equal(mounted.current.criteria.text, 'second')
    assert.equal(mounted.current.resultPage, 2)
  } finally {
    await mounted.unmount()
    dom.cleanup()
  }
})
