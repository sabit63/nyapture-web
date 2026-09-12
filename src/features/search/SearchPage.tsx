import {
  ArrowDown,
  ArrowUp,
  BookSearch,
  Check,
  ChevronDown,
  FileText,
  Download,
  ListChecks,
  Scroll,
  LayoutGrid,
  LoaderCircle,
  RefreshCw,
  Search,
  Trash2,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BookGrid } from '../../components/BookGrid'
import { createPortal } from 'react-dom'

import type { ApiBookCardModel } from '../../api'
import { retryPendingScrollRestoration } from '../../app/client-router'
import { SearchResultsGrid } from './SearchResultsGrid'
import { TagChip } from '../../components/TagChip'
import { Button, IconButton, StatePanel } from '../../components/ui'
import { HITOMI_APPENDS, TAG_TYPE_LABELS, BOOK_STATUS_LABELS } from '../../models'
import type { HitomiAppend } from '../../models'
import { getBookIdentityKey } from '../library/book-deletion'
import { getPaginationItems, HITOMI_SORT_PERIODS } from './search-utils'
import { applyTagEntityMetadata } from './tag-display-name'
import { BookStatusFields } from './BookStatusFields'
import { MissingTagFields } from './MissingTagFields'
import type { SearchController } from './useSearchController'
import { formatSearchPageTitle, useDocumentTitle } from '../../app/page-title'
import { BookDetailsSheet } from '../viewer/BookDetailsSheet'
import { SearchContinuousReader } from './SearchContinuousReader'
import { resolveContinuousStart } from './search-continuous-utils'

export const SEARCH_CONTINUOUS_DETAILS_ACTION_ID = 'search-continuous-details-action'
export const SEARCH_VIEW_MODE_ACTION_ID = 'search-view-mode-action'

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
      <label className="sr-only" htmlFor="header-search">{isWebSearch ? 'Web検索' : controller.isStatusSearch ? 'ステータス検索' : controller.isMissingTagSearch ? '未タグ検索' : '検索'}</label>
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
      <IconButton className="search-submit" size="compact" type="submit" aria-label="検索を実行" aria-busy={controller.searchState === 'loading'}>
        {controller.searchState === 'loading'
          ? <LoaderCircle className="results-spinner" size={16} aria-hidden="true" />
          : <Search size={16} aria-hidden="true" />}
      </IconButton>
      <span className="quick-search__divider" aria-hidden="true" />
      <IconButton
        ref={advancedTriggerRef}
        className="search-detail"
        size="compact"
        type="button"
        aria-label="検索"
        aria-expanded={advancedOpen}
        aria-controls="advanced-search-dialog"
        onClick={openAdvancedSearch}
      >
        <BookSearch size={17} aria-hidden="true" />
      </IconButton>
    </form>
  )
}

export type SearchPageProps = {
  controller: SearchController
}

export function SearchPage({ controller }: SearchPageProps) {
  const [detailsBook, setDetailsBook] = useState<ApiBookCardModel>()
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [activeContinuousBook, setActiveContinuousBook] = useState<ApiBookCardModel>()
  const [continuousHeaderActionHost, setContinuousHeaderActionHost] = useState<HTMLElement | null>(null)
  const [viewModeHeaderActionHost, setViewModeHeaderActionHost] = useState<HTMLElement | null>(null)
  const [returnRestoreRevision, setReturnRestoreRevision] = useState(0)
  const detailsTriggerRef = useRef<HTMLButtonElement>(null)
  const returnToBookRef = useRef<ApiBookCardModel | undefined>(undefined)
  const {
    isWebSearch,
    criteria,
    searchResponseTags,
    hitomiAppend,
    hasCriteria,
    searchState,
    searchError,
    searchLoadingAnnouncement,
    searchResultGeneration,
    visibleBooks,
    displaySettings,
    selectMode,
    selected,
    pendingDeletionKeys,
    sortType,
    sortDirection,
    hitomiSortPeriod,
    totalResultPages,
    resultPage,
    searchView,
    continuousStart,
    paginationPageCount,
    changeHitomiAppend,
    setHitomiSortPeriod,
    setSortType,
    setSortDirection,
    toggleSelectMode,
    refresh,
    japaneseLanguageEnabled,
    toggleJapaneseLanguage,
    selectAllVisibleBooks,
    refreshSelectedBooks,
    deleteSelectedLibraryBooks,
    toggleSelection,
    getTagSearchHref,
    searchByTag,
    openTagSearchDestination,
    refreshWebBook,
    downloadWebBook,
    openWebBookDetail,
    deleteLibraryBook,
    goToResultPage,
    applyBookTagChange,
    applyBookTitleChange,
    enterContinuousView,
    getContinuousViewHref,
    exitContinuousView,
  } = controller
  const openBookDetails = useCallback((book: ApiBookCardModel, trigger: HTMLButtonElement) => {
    detailsTriggerRef.current = trigger
    setDetailsBook(book)
    setDetailsOpen(true)
  }, [])
  const selectableVisibleBooks = visibleBooks.filter((book) => !pendingDeletionKeys.has(getBookIdentityKey(book)))

  useEffect(() => {
    retryPendingScrollRestoration()
    setDetailsOpen(false)
  }, [searchResultGeneration])

  useEffect(() => {
    setContinuousHeaderActionHost(document.getElementById(SEARCH_CONTINUOUS_DETAILS_ACTION_ID))
    setViewModeHeaderActionHost(document.getElementById(SEARCH_VIEW_MODE_ACTION_ID))
  }, [])

  const isSearchLoading = searchState === 'loading'
  const showNoResults = searchState === 'success' && visibleBooks.length === 0
  const displayedCriteriaTags = applyTagEntityMetadata(criteria.tags, searchResponseTags)
  const isContinuousView = !isWebSearch && searchView === 'continuous'
  const continuousResolution = useMemo(
    () => resolveContinuousStart(visibleBooks, continuousStart),
    [continuousStart, visibleBooks],
  )
  const readableBooks = continuousResolution.sequence
  const continuousDetailsBook = (activeContinuousBook
    ? readableBooks.find((book) => (
        book.apiGroupId === activeContinuousBook.apiGroupId
        && book.apiBookId === activeContinuousBook.apiBookId
      ))
    : undefined) ?? readableBooks[continuousResolution.startIndex]

  useEffect(() => {
    const returnToBook = returnToBookRef.current
    if (isContinuousView || isSearchLoading || !returnToBook) return
    let restoreFrame: number | undefined
    let settleTimer: number | undefined
    const navigationFrame = window.requestAnimationFrame(() => {
      // RouterRuntime resets the viewport and focuses the destination heading
      // in its own navigation frame. Restore the originating card afterwards.
      restoreFrame = window.requestAnimationFrame(() => {
        const card = Array.from(document.querySelectorAll<HTMLElement>('.book-card')).find((element) => (
          element.dataset.bookGroupId === returnToBook.apiGroupId
          && element.dataset.bookId === returnToBook.apiBookId
        ))
        if (!card) return
        card.scrollIntoView({ block: 'center' })
        card.querySelector<HTMLButtonElement>('.book-cover__open-button')?.focus({ preventScroll: true })
        // Keep the target through any result refresh triggered by the URL
        // change, then discard it once the grid has remained stable.
        settleTimer = window.setTimeout(() => {
          const pending = returnToBookRef.current
          if (
            pending
            && pending.apiGroupId === returnToBook.apiGroupId
            && pending.apiBookId === returnToBook.apiBookId
          ) {
            returnToBookRef.current = undefined
          }
        }, 1_000)
      })
    })
    return () => {
      window.cancelAnimationFrame(navigationFrame)
      if (restoreFrame !== undefined) window.cancelAnimationFrame(restoreFrame)
      if (settleTimer !== undefined) window.clearTimeout(settleTimer)
    }
  }, [isContinuousView, isSearchLoading, returnRestoreRevision, searchResultGeneration, visibleBooks])
  useDocumentTitle(formatSearchPageTitle({
    isWebSearch,
    isLibrarySearch: controller.isLibrarySearch,
    isMissingTagSearch: controller.isMissingTagSearch,
    isStatusSearch: controller.isStatusSearch,
    criteria,
    hitomiAppend,
    resultPage,
    responseTags: searchResponseTags,
  }))

  return (
    <>
      <h1
        id="page-title"
        className={isWebSearch ? 'hitomi-search-title' : (controller.isMissingTagSearch || controller.isStatusSearch) ? 'missing-search-title' : 'sr-only'}
      >
        {isWebSearch ? 'Hitomi' : controller.isStatusSearch ? 'ステータス検索' : controller.isMissingTagSearch ? '未タグ検索' : '検索'}
      </h1>

      {controller.isStatusSearch && (
        <form className="missing-search-panel" onSubmit={controller.submitSearch}>
          <BookStatusFields id="book-status" value={controller.draftStatuses} error={controller.statusesError}
            onChange={controller.setDraftStatuses} />
          <div className="missing-search-actions">
            <span role="status">{controller.draftStatuses.length !== (criteria.statuses?.length ?? 0) || controller.draftStatuses.some((status) => !criteria.statuses?.includes(status)) || controller.query !== criteria.text ? '条件の変更はまだ検索結果に反映されていません' : ''}</span>
            <Button type="submit" variant="solid" tone="accent">検索</Button>
          </div>
        </form>
      )}

      {controller.isMissingTagSearch && (
        <form className="missing-search-panel" onSubmit={controller.submitSearch}>
          <MissingTagFields
            id="missing-tags"
            value={controller.draftMissingTagTypes}
            error={controller.missingTagsError}
            onChange={(types) => {
              controller.setDraftMissingTagTypes(types)
              controller.setMissingTagsError(types.length ? '' : '1種類以上選択してください。')
            }}
          />
          <div className="missing-search-actions">
            <span role="status">{controller.draftMissingTagTypes.length !== (criteria.missingTagTypes?.length ?? 0) || controller.draftMissingTagTypes.some((type) => !criteria.missingTagTypes?.includes(type)) || controller.query !== criteria.text ? '条件の変更はまだ検索結果に反映されていません' : ''}</span>
            <Button type="submit" variant="solid" tone="accent">検索</Button>
          </div>
        </form>
      )}

      <section className="filter-panel" aria-label="検索条件" hidden={!hasCriteria}>
        <div className="filter-values">
          {controller.isStatusSearch && Boolean(criteria.statuses?.length) && (
            <span className="filter-value">ステータス: {criteria.statuses?.map((status) => BOOK_STATUS_LABELS[status]).join('・')}</span>
          )}
          {controller.isMissingTagSearch && Boolean(criteria.missingTagTypes?.length) && (
            <span className="filter-value">すべて未設定: {criteria.missingTagTypes?.map((type) => TAG_TYPE_LABELS[type]).join('・')}</span>
          )}
          {criteria.text && (
            <span className="filter-value">検索: {criteria.text}</span>
          )}
          {criteria.tags.length > 0 && (
            <span className="filter-value filter-value--tags">
              {displayedCriteriaTags.map((tag) => (
                <TagChip
                  key={`${tag.type}:${tag.name}`}
                  tag={tag}
                  size="default"
                  title={tag.displayName && tag.displayName !== tag.name ? tag.name : undefined}
                  onClick={() => searchByTag(tag)}
                  onSearchDestinationRequest={openTagSearchDestination}
                />
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

      <section id="results-region" className="results" aria-busy={isSearchLoading} tabIndex={-1}>
        <div className="results-toolbar">
          <div className="results-actions">
            {selectMode && <span className="selection-count" aria-live="polite">{selected.length}件を選択中</span>}
            {isWebSearch && (
              <Button
                className={`language-toggle ${japaneseLanguageEnabled ? 'is-active' : ''}`}
                variant="ghost"
                tone="neutral"
                size="compact"
                type="button"
                aria-label={`日本語指定は${japaneseLanguageEnabled ? 'オン' : 'オフ'}。${japaneseLanguageEnabled ? 'オフ' : 'オン'}に切り替える`}
                aria-pressed={japaneseLanguageEnabled}
                disabled={isSearchLoading}
                onClick={toggleJapaneseLanguage}
              >
                日本語
              </Button>
            )}
            {isWebSearch && (
              <label className="hitomi-append-control">
                <select
                  value={hitomiAppend}
                  aria-label="HitomiAppend"
                  disabled={isSearchLoading}
                  onChange={(event) => changeHitomiAppend(event.target.value as HitomiAppend)}
                >
                  {HITOMI_APPENDS.map((append) => <option key={append} value={append}>{append}</option>)}
                </select>
                <ChevronDown size={15} aria-hidden="true" />
              </label>
            )}
            <label className="sort-control sort-control--type">
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
                <select value={sortType} aria-label="並び順の種類" disabled={isSearchLoading} onChange={(event) => setSortType(event.target.value as typeof sortType)}>
                  <option value="uploaded">アップロード日時</option>
                  <option value="updated">更新日</option>
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
                onClick={() => setSortDirection(sortDirection === 'desc' ? 'asc' : 'desc')}
              >
                {sortDirection === 'desc' ? <ArrowDown size={17} aria-hidden="true" /> : <ArrowUp size={17} aria-hidden="true" />}
              </IconButton>
            )}
            {!isContinuousView && (
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
            )}
            <IconButton className="toolbar-icon" variant="ghost" tone="neutral" size="compact" type="button" aria-label="結果を更新" disabled={isSearchLoading} onClick={refresh}>
              <RefreshCw className={isSearchLoading ? 'results-spinner' : undefined} size={17} aria-hidden="true" />
            </IconButton>
          </div>
        </div>

        {isWebSearch && (
          <div className="selection-toolbar-reveal" data-open={selectMode} inert={!selectMode ? true : undefined} aria-hidden={!selectMode}>
          <div className="selection-toolbar" role="group" aria-label="Web検索結果の一括操作">
            <IconButton
              className="toolbar-icon"
              variant="ghost"
              tone="neutral"
              size="compact"
              type="button"
              aria-label="全選択"
              disabled={isSearchLoading || selectableVisibleBooks.length === 0 || selectableVisibleBooks.every((book) => selected.includes(getBookIdentityKey(book)))}
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
              aria-label="再読み込み" aria-busy={controller.bulkRefreshPending}
              disabled={isSearchLoading || controller.bulkOperationPending || selected.length === 0}
              onClick={refreshSelectedBooks}
            >
              <RefreshCw size={17} aria-hidden="true" />
            </IconButton>
            <IconButton className="toolbar-icon" variant="ghost" tone="neutral" size="compact" type="button"
              aria-label="選択をダウンロード" aria-busy={controller.bulkDownloadPending}
              disabled={isSearchLoading || controller.bulkOperationPending || controller.downloadableSelectedCount === 0}
              onClick={controller.downloadSelectedBooks}>
              <Download size={17} aria-hidden="true" />
            </IconButton>
          </div>
          </div>
        )}

        {!isWebSearch && (
          <div className="selection-toolbar-reveal" data-open={selectMode} inert={!selectMode ? true : undefined} aria-hidden={!selectMode}>
          <div className="selection-toolbar" role="group">
            <IconButton
              className="toolbar-icon"
              variant="ghost"
              tone="neutral"
              size="compact"
              type="button"
              aria-label="全選択"
              disabled={isSearchLoading || selectableVisibleBooks.length === 0 || selectableVisibleBooks.every((book) => selected.includes(getBookIdentityKey(book)))}
              onClick={selectAllVisibleBooks}
            >
              <ListChecks size={17} aria-hidden="true" />
            </IconButton>
            <IconButton className="toolbar-icon" variant="ghost" tone="neutral" size="compact" type="button"
              aria-label="再読み込み" aria-busy={controller.bulkRefreshPending}
              disabled={isSearchLoading || controller.bulkOperationPending || selected.length === 0}
              onClick={refreshSelectedBooks}>
              <RefreshCw size={17} aria-hidden="true" />
            </IconButton>
            <IconButton
              className="toolbar-icon selection-toolbar__delete"
              variant="ghost"
              tone="danger"
              size="compact"
              type="button"
              aria-label="選択を削除"
              disabled={isSearchLoading || controller.bulkOperationPending || selected.length === 0}
              onClick={(event) => deleteSelectedLibraryBooks(event.currentTarget)}
            >
              <Trash2 size={17} aria-hidden="true" />
            </IconButton>
          </div>
          </div>
        )}

        {isSearchLoading && (
          <div className="results-loading-status" role="status" aria-live="polite"><LoaderCircle className="results-spinner" size={16} aria-hidden="true" /><span>{searchLoadingAnnouncement}</span></div>
        )}

        {showNoResults && (
          <StatePanel title="条件に一致する本がありません" role="status" />
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
          <BookGrid settings={displaySettings} aria-hidden="true" inert>
            {Array.from({ length: 10 }, (_, index) => (
              <div className="search-skeleton" key={index}>
                <div className="search-skeleton__cover" />
                <div className="search-skeleton__line" />
                <div className="search-skeleton__line search-skeleton__line--short" />
              </div>
            ))}
          </BookGrid>
        ) : showNoResults ? null : (
          <div className={`results-stage ${isSearchLoading ? 'results-stage--loading-visible' : ''}`}>
            {isContinuousView ? (
              readableBooks.length > 0 ? (
                <SearchContinuousReader
                  books={readableBooks}
                  startIndex={continuousResolution.startIndex}
                  resultPage={resultPage}
                  totalResultPages={totalResultPages}
                  isLoading={isSearchLoading}
                  onActiveBookChange={setActiveContinuousBook}
                  onBookJump={enterContinuousView}
                  getTagSearchHref={getTagSearchHref}
                  onResultPageChange={goToResultPage}
                  onTagSearch={searchByTag}
                />
              ) : (
                <StatePanel
                  title="連続閲覧できるBookがありません"
                  description={`閲覧可能 0件／対象外 ${visibleBooks.length}件。ダウンロード済みでページ画像を取得できるBookがありません。`}
                  role="status"
                  action={<Button onClick={exitContinuousView}>カード一覧へ戻る</Button>}
                />
              )
            ) : (
              <SearchResultsGrid
                visibleBooks={visibleBooks}
                displaySettings={displaySettings}
                pendingDeletionKeys={pendingDeletionKeys}
                failedBookKeys={controller.failedBookKeys}
                isWebSearch={isWebSearch}
                selectMode={selectMode}
                selected={selected}
                toggleSelection={toggleSelection}
                searchByTag={searchByTag}
                openTagSearchDestination={openTagSearchDestination}
                openWebBookDetail={openWebBookDetail}
                enterContinuousView={enterContinuousView}
                getContinuousViewHref={getContinuousViewHref}
                deleteLibraryBook={deleteLibraryBook}
                refreshWebBook={refreshWebBook}
                downloadWebBook={downloadWebBook}
                isSearchLoading={isSearchLoading}
                onDetailsRequest={openBookDetails}
              />
            )}
          </div>
        )}

        {!isContinuousView && visibleBooks.length > 0 && totalResultPages > 1 && (
          <nav className="pagination" aria-label="検索結果のページ">
            {getPaginationItems(resultPage, totalResultPages, paginationPageCount).map((item, index) => item === 'ellipsis'
              ? <span key={`ellipsis-${index}`} className="pagination__ellipsis" aria-hidden="true">…</span>
              : item === resultPage
                ? <span key={item} className="pagination__current" aria-current="page" aria-label={`現在${item}ページ（全${totalResultPages}ページ中）`}>{item}</span>
                : <Button key={item} variant="ghost" tone="neutral" size="default" type="button" aria-label={`${item}ページへ移動`} disabled={isSearchLoading} onClick={() => goToResultPage(item)}>{item}</Button>)}
          </nav>
        )}
      </section>
      {controller.isLibrarySearch && viewModeHeaderActionHost && createPortal(
        <div className="search-view-toggle" role="group" aria-label="検索結果の表示形式">
          <IconButton
            className={`toolbar-icon ${!isContinuousView ? 'is-active' : ''}`}
            variant="ghost"
            tone="neutral"
            size="compact"
            type="button"
            aria-label="カード一覧"
            aria-pressed={!isContinuousView}
            disabled={isSearchLoading}
            onClick={() => {
              if (!isContinuousView) return
              returnToBookRef.current = activeContinuousBook ?? readableBooks[continuousResolution.startIndex]
              setReturnRestoreRevision((current) => current + 1)
              exitContinuousView()
            }}
          >
            <LayoutGrid size={16} aria-hidden="true" />
          </IconButton>
          <IconButton
            className={`toolbar-icon ${isContinuousView ? 'is-active' : ''}`}
            variant="ghost"
            tone="neutral"
            size="compact"
            type="button"
            aria-label="連続閲覧"
            aria-pressed={isContinuousView}
            disabled={isSearchLoading || readableBooks.length === 0}
            onClick={() => {
              if (!isContinuousView) enterContinuousView()
            }}
          >
            <Scroll size={16} aria-hidden="true" />
          </IconButton>
        </div>,
        viewModeHeaderActionHost,
      )}
      {isContinuousView && continuousDetailsBook && continuousHeaderActionHost && createPortal(
        <IconButton
          ref={detailsTriggerRef}
          size="default"
          type="button"
          aria-label="Book情報を表示"
          aria-haspopup="dialog"
          aria-expanded={detailsOpen}
          aria-controls="book-viewer-details"
          disabled={isSearchLoading}
          onClick={() => {
            setDetailsBook(continuousDetailsBook)
            setDetailsOpen(true)
          }}
        >
          <FileText size={18} aria-hidden="true" />
        </IconButton>,
        continuousHeaderActionHost,
      )}
      {detailsBook && (
        <BookDetailsSheet
          book={detailsBook}
          totalPages={detailsBook.totalPage}
          detailsOpen={detailsOpen}
          onDetailsOpenChange={setDetailsOpen}
          detailsTriggerRef={detailsTriggerRef}
          onBookChange={(updated) => {
            setDetailsBook(updated)
            applyBookTagChange(updated)
          }}
          onTitleChange={(groupId, bookId, title) => {
            setDetailsBook((current) => current?.groupId === groupId && current.bookId === bookId
              ? { ...current, title }
              : current)
            applyBookTitleChange(groupId, bookId, title)
          }}
          onTagSearch={searchByTag}
          onTagSearchDestinationRequest={openTagSearchDestination}
        />
      )}
    </>
  )
}
