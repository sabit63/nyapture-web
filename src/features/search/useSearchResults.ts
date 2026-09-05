import { useCallback, useRef, useState, type SetStateAction } from 'react'

import type { ApiBookCardModel } from '../../api'
import type { BookCardModel } from '../../models'
import {
  replaceSearchBookAndSelection,
  replaceSearchBooksAndSelection,
} from './search-book-download'

export type SearchResultsState = {
  librarySearchBooks: ApiBookCardModel[]
  webSearchResultBooks: ApiBookCardModel[]
  selected: string[]
}

/** Own gallery results and selection so card identity changes commit together. */
export function useSearchResults() {
  const [state, setState] = useState<SearchResultsState>({
    librarySearchBooks: [],
    webSearchResultBooks: [],
    selected: [],
  })
  const stateRef = useRef<SearchResultsState>(state)

  const commit = useCallback((update: (current: SearchResultsState) => SearchResultsState) => {
    const next = update(stateRef.current)
    stateRef.current = next
    setState(next)
  }, [])

  const setLibrarySearchBooks = useCallback((update: SetStateAction<ApiBookCardModel[]>) => {
    commit((current) => ({
      ...current,
      librarySearchBooks: typeof update === 'function' ? update(current.librarySearchBooks) : update,
    }))
  }, [commit])

  const setSelected = useCallback((update: SetStateAction<string[]>) => {
    commit((current) => ({
      ...current,
      selected: typeof update === 'function' ? update(current.selected) : update,
    }))
  }, [commit])

  const updateWebSearchResultBooks = useCallback((update: SetStateAction<ApiBookCardModel[]>) => {
    commit((current) => ({
      ...current,
      webSearchResultBooks: typeof update === 'function' ? update(current.webSearchResultBooks) : update,
    }))
  }, [commit])

  const replaceWebSearchBook = useCallback((original: BookCardModel, refreshed: ApiBookCardModel) => {
    commit((current) => {
      const replacement = replaceSearchBookAndSelection({
        books: current.webSearchResultBooks,
        selected: current.selected,
      }, original, refreshed)
      return {
        ...current,
        webSearchResultBooks: [...replacement.books],
        selected: [...replacement.selected],
      }
    })
  }, [commit])

  const replaceWebSearchBooks = useCallback((
    replacements: readonly { original: BookCardModel; refreshed: ApiBookCardModel }[],
  ) => {
    if (replacements.length === 0) return
    commit((current) => {
      const replacement = replaceSearchBooksAndSelection({
        books: current.webSearchResultBooks,
        selected: current.selected,
      }, replacements)
      return {
        ...current,
        webSearchResultBooks: [...replacement.books],
        selected: [...replacement.selected],
      }
    })
  }, [commit])

  return {
    librarySearchBooks: state.librarySearchBooks,
    webSearchResultBooks: state.webSearchResultBooks,
    selected: state.selected,
    setLibrarySearchBooks,
    setSelected,
    updateWebSearchResultBooks,
    replaceWebSearchBook,
    replaceWebSearchBooks,
    stateRef,
  }
}

export type SearchResultsController = ReturnType<typeof useSearchResults>
