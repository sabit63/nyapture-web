import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  ListChecks,
  LoaderCircle,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Trash2,
  X,
} from 'lucide-react'
import type { CSSProperties } from 'react'

import { BookCard } from '../../components/BookCard'
import { TagChip } from '../../components/TagChip'
import { Button, IconButton, StatePanel } from '../../components/ui'
import { getBookIdentityKey } from '../library/book-deletion'
import { getPaginationItems, HITOMI_SORT_PERIODS } from './search-utils'
import type { SearchController } from './useSearchController'

export type SearchHeaderProps = {
  controller: SearchController
}

export function SearchHeader({ controller }: SearchHeaderProps) {
  const {
    isWebSearch,
    query,
    advancedOpen,
    advancedTriggerRef,
    setQuery,
    submitSearch,
    openAdvancedSearch,
  } = controller

  return (
    <form className="quick-search" role="search" onSubmit={submitSearch}>
      <label className="sr-only" htmlFor="header-search">{isWebSearch ? 'Web検索' : '蔵書'}を検索</label>
      <input
        id="header-search"
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      {query && (
        <IconButton
          className="search-clear"
          size="compact"
          aria-label="検索語を消去"
          onClick={() => setQuery('')}
        >
          <X size={16} aria-hidden="true" />
        </IconButton>
      )}
      <IconButton className="search-submit" size="compact" type="submit" aria-label="検索を実行">
        <Search size={16} aria-hidden="true" />
      </IconButton>
      <span className="quick-search__divider" aria-hidden="true" />
      <IconButton
        ref={advancedTriggerRef}
        className="search-detail"
        size="compact"
        type="button"
        aria-label="詳細検索"
        aria-expanded={advancedOpen}
        aria-controls="advanced-search-dialog"
        onClick={openAdvancedSearch}
      >
        <SlidersHorizontal size={17} aria-hidden="true" />
      </IconButton>
    </form>
  )
}

export type SearchPageProps = {
  controller: SearchController
}

export function SearchPage({ controller }: SearchPageProps) {
  const {
    isWebSearch,
    criteria,
    hitomiAppend,
    hasCriteria,
    searchState,
    searchError,
    searchLoadingAnnouncement,
    searchLoaderVisible,
    visibleBooks,
    displaySettings,
    selectMode,
    selected,
    sortType,
    sortDirection,
    hitomiSortPeriod,
    totalResultPages,
    resultPage,
    paginationPageCount,
    setResultPage,
    setHitomiSortPeriod,
    setSortType,
    setSortDirection,
    toggleSelectMode,
    refresh,
    selectAllVisibleBooks,
    refreshSelectedWebBooks,
    deleteSelectedLibraryBooks,
    toggleSelection,
    searchByTag,
    refreshWebBook,
    downloadWebBook,
    deleteLibraryBook,
    goToResultPage,
  } = controller

  const isSearchLoading = searchState === 'loading'
  const showSearchLoader = isSearchLoading && searchLoaderVisible

  return (
    <>
      <h1 id="page-title" className="sr-only">{isWebSearch ? 'Web検索' : '蔵書検索'}</h1>

      <section className="filter-panel" aria-label="検索条件" hidden={!hasCriteria}>
        <div className="filter-values">
          {criteria.text && (
            <span className="filter-value">検索: {criteria.text}</span>
          )}
          {isWebSearch && hitomiAppend !== 'Normal' && (
            <span className="filter-value">HitomiAppend: {hitomiAppend}</span>
          )}
          {criteria.tags.length > 0 && (
            <span className="filter-value filter-value--tags">
              <span className="filter-value__operator">{criteria.tagMode === 'and' ? 'すべてのタグ' : 'いずれかのタグ'}:</span>
              {criteria.tags.map((tag) => (
                <TagChip key={`${tag.type}:${tag.name}`} tag={tag} size="default" />
              ))}
            </span>
          )}
          {(criteria.dateFrom || criteria.dateTo) && (
            <span className="filter-value">
              日時: {criteria.dateFrom || '指定なし'} ～ {criteria.dateTo || '指定なし'}
            </span>
          )}
          {(criteria.pagesMin || criteria.pagesMax) && (
            <span className="filter-value">
              ページ数: {criteria.pagesMin || '指定なし'} ～ {criteria.pagesMax || '指定なし'}
            </span>
          )}
        </div>
      </section>

      <section id="results-region" className="results" aria-label={isWebSearch ? 'Web検索結果一覧' : '蔵書一覧'} aria-busy={isSearchLoading} tabIndex={-1}>
        <div className="results-toolbar">
          <div className="results-actions">
            {selectMode && <span className="selection-count" aria-live="polite">{selected.length}件を選択中</span>}
            <label className="sort-control sort-control--type">
              <span>並び順</span>
              {isWebSearch ? (
                <select
                  value={hitomiSortPeriod}
                  aria-label="Hitomiの並び順"
                  disabled={isSearchLoading}
                  onChange={(event) => {
                    const nextPeriod = event.target.value as typeof hitomiSortPeriod
                    setHitomiSortPeriod(nextPeriod)
                  }}
                >
                  {HITOMI_SORT_PERIODS.map((period) => <option key={period.value} value={period.value}>{period.label}</option>)}
                </select>
              ) : (
                <select value={sortType} aria-label="並び順の種類" disabled={isSearchLoading} onChange={(event) => { setSortType(event.target.value as typeof sortType); setResultPage(1) }}>
                  <option value="uploaded">アップロード日時</option>
                  <option value="title">タイトル順</option>
                  <option value="pages">ページ数順</option>
                </select>
              )}
              <ChevronDown size={15} aria-hidden="true" />
            </label>
            {!isWebSearch && (
              <IconButton
                className="toolbar-icon sort-direction-toggle"
                variant="ghost"
                tone="neutral"
                size="compact"
                type="button"
                aria-label={sortDirection === 'desc' ? '現在は降順。昇順に切り替える' : '現在は昇順。降順に切り替える'}
                aria-pressed={sortDirection === 'asc'}
                disabled={isSearchLoading}
                onClick={() => { setSortDirection((current) => current === 'desc' ? 'asc' : 'desc'); setResultPage(1) }}
              >
                {sortDirection === 'desc' ? <ArrowDown size={17} aria-hidden="true" /> : <ArrowUp size={17} aria-hidden="true" />}
              </IconButton>
            )}
            <IconButton
              className={`toolbar-icon selection-toggle ${selectMode ? 'is-active' : ''}`}
              variant="ghost"
              tone="neutral"
              size="compact"
              type="button"
              aria-label={selectMode ? '選択を終了' : '選択'}
              aria-pressed={selectMode}
              disabled={isSearchLoading}
              onClick={toggleSelectMode}
            >
              <Check size={16} aria-hidden="true" />
            </IconButton>
            <IconButton className="toolbar-icon" variant="ghost" tone="neutral" size="compact" type="button" aria-label="結果を更新" disabled={isSearchLoading} onClick={refresh}>
              <RefreshCw size={17} aria-hidden="true" />
            </IconButton>
          </div>
        </div>

        {isWebSearch && selectMode && (
          <div className="selection-toolbar" role="group" aria-label="Web検索結果の一括操作">
            <IconButton
              className="toolbar-icon"
              variant="ghost"
              tone="neutral"
              size="compact"
              type="button"
              aria-label="全選択"
              disabled={isSearchLoading || visibleBooks.length === 0 || visibleBooks.every((book) => selected.includes(getBookIdentityKey(book)))}
              onClick={selectAllVisibleBooks}
            >
              <ListChecks size={17} aria-hidden="true" />
            </IconButton>
            <IconButton
              className="toolbar-icon"
              variant="ghost"
              tone="neutral"
              size="compact"
              type="button"
              aria-label="読み込み"
              disabled={isSearchLoading || selected.length === 0}
              onClick={refreshSelectedWebBooks}
            >
              <RefreshCw size={17} aria-hidden="true" />
            </IconButton>
          </div>
        )}

        {!isWebSearch && selectMode && (
          <div className="selection-toolbar" role="group" aria-label="蔵書の一括操作">
            <IconButton
              className="toolbar-icon"
              variant="ghost"
              tone="neutral"
              size="compact"
              type="button"
              aria-label="全選択"
              disabled={isSearchLoading || visibleBooks.length === 0 || visibleBooks.every((book) => selected.includes(getBookIdentityKey(book)))}
              onClick={selectAllVisibleBooks}
            >
              <ListChecks size={17} aria-hidden="true" />
            </IconButton>
            <IconButton
              className="toolbar-icon selection-toolbar__delete"
              variant="ghost"
              tone="danger"
              size="compact"
              type="button"
              aria-label="選択を削除"
              disabled={isSearchLoading || selected.length === 0}
              onClick={(event) => deleteSelectedLibraryBooks(event.currentTarget)}
            >
              <Trash2 size={17} aria-hidden="true" />
            </IconButton>
          </div>
        )}

        {isSearchLoading && (
          <p className="sr-only" role="status" aria-live="polite">{searchLoadingAnnouncement}</p>
        )}

        {searchState === 'error' && (
          <StatePanel
            title="検索結果を取得できませんでした"
            description={searchError}
            tone="danger"
            role="alert"
            action={<Button disabled={isSearchLoading} onClick={refresh}>再試行</Button>}
          />
        )}

        {isSearchLoading && visibleBooks.length === 0 ? (
          <StatePanel
            className="results-state-panel"
            title={searchLoadingAnnouncement}
            icon={<LoaderCircle className="results-spinner" size={30} strokeWidth={2.1} />}
          />
        ) : (
          <div className={`results-stage ${showSearchLoader ? 'results-stage--loading-visible' : ''}`}>
            <div
              className="book-grid"
              style={{ '--thumbnail-columns': displaySettings.thumbnailColumns } as CSSProperties}
              aria-busy={isSearchLoading}
              inert={isSearchLoading ? true : undefined}
            >
              {visibleBooks.map((book) => (
                <BookCard
                  key={getBookIdentityKey(book)}
                  book={book}
                  selectMode={selectMode}
                  selected={selected.includes(getBookIdentityKey(book))}
                  onToggle={() => toggleSelection(getBookIdentityKey(book))}
                  onTagSearch={searchByTag}
                  isDownloadCandidate={isWebSearch
                    && (book.status === 'WebBook' || book.status === 'WebBookInPage')
                    && book.tags.some((tag) => (
                      (tag.type === 'Artists' || tag.type === 'Groups')
                      && typeof tag.count === 'number'
                      && tag.count >= 1
                    ))}
                  isWebSearch={isWebSearch}
                  onDelete={!isWebSearch ? (trigger) => deleteLibraryBook(book, trigger) : undefined}
                  onRefresh={isWebSearch ? () => refreshWebBook(book) : undefined}
                  onDownload={isWebSearch ? () => downloadWebBook(book) : undefined}
                />
              ))}
            </div>
            {showSearchLoader && (
              <div className="results-loading-overlay" aria-hidden="true">
                <LoaderCircle className="results-spinner" size={30} strokeWidth={2.1} />
              </div>
            )}
          </div>
        )}

        {searchState === 'success' && visibleBooks.length === 0 && (
          <StatePanel
            title={hasCriteria ? `条件に一致する${isWebSearch ? 'Web検索結果' : '蔵書'}がありません` : `${isWebSearch ? 'Web検索結果' : '蔵書'}はありません`}
            icon={<Search size={24} />}
          />
        )}

        {visibleBooks.length > 0 && totalResultPages > 1 && (
          <nav className="pagination" aria-label="検索結果のページ">
            {getPaginationItems(resultPage, totalResultPages, paginationPageCount).map((item, index) => item === 'ellipsis'
              ? <span key={`ellipsis-${index}`} className="pagination__ellipsis" aria-hidden="true">…</span>
              : item === resultPage
                ? <span key={item} className="pagination__current" aria-current="page" aria-label={`現在${item}ページ（全${totalResultPages}ページ中）`}>{item}</span>
                : <Button key={item} variant="ghost" tone="neutral" size="default" type="button" aria-label={`${item}ページへ移動`} disabled={isSearchLoading} onClick={() => goToResultPage(item)}>{item}</Button>)}
          </nav>
        )}
      </section>
    </>
  )
}
