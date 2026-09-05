import { ExternalLink, RefreshCw, Search, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from 'react'
import { getErrorMessage, mapWebCacheBookToCard, type DisplaySettings } from '../../api'
import { ApiError } from '../../api/client'
import { deleteCacheBook, enqueueCacheBook, getCacheBook, getCacheConfig, searchCache } from '../../api/web-cache'
import { isDownloadCandidate } from '../search/download-candidate'
import { InternalLink, navigate, useRouterLocation } from '../../app/client-router'
import { formatPageTitle, useDocumentTitle } from '../../app/page-title'
import { BookCard } from '../../components/BookCard'
import { getTagLabel, TAG_TYPE_LABELS, TAG_TYPE_ORDER, type BookTag } from '../../models'
import { Button, Dialog, DialogBody, DialogFooter, DialogHeader, IconButton, StatePanel, iconButtonClassName } from '../../components/ui'
import type { SnackbarTone } from '../../components/Snackbar'
import type { WebBookCacheBookDto } from '../../models/web-cache'
import { getPaginationItems } from '../search/search-utils'
import { buildCacheSearchRequest, parseCacheSearch, serializeCacheSearch, splitCacheIds, validateCacheSearch } from './search-state'
import './web-cache.css'

type Props = {
  apiRevision: number
  displaySettings: DisplaySettings
  notify: (message: string, tone?: SnackbarTone) => void
}

const identity = (book: WebBookCacheBookDto) => JSON.stringify([book.groupId, book.bookId])
const cacheError = (error: unknown) => error instanceof ApiError ? error.message : getErrorMessage(error)
const hasIdentity = (book: WebBookCacheBookDto) => Boolean(book.groupId?.trim() && book.bookId?.trim())
const dateText = (value?: string | null) => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString() : '—'
const sourceUrl = (book: WebBookCacheBookDto) => safeUrl(book.sourcePageUrl?.trim() || book.url)
function safeUrl(value?: string | null) {
  try {
    const url = new URL(value ?? '')
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : undefined
  } catch { return undefined }
}
const autoState = (book: WebBookCacheBookDto) => book.autoDownloadEnqueuedAt
  ? '自動投入済み' : !book.autoDownloadEvaluatedAt ? '自動判定待ち' : book.autoDownloadMatched ? '自動条件に一致' : '自動条件の対象外'

function CacheCard({ book, disabled, enqueued, onDetail, onEnqueue, onDelete, onTagSearch }: {
  book: WebBookCacheBookDto
  disabled: boolean
  enqueued: boolean
  onDetail: () => void
  onEnqueue: () => void
  onDelete: () => void
  onTagSearch: (tag: BookTag) => void
}) {
  const valid = hasIdentity(book)
  const source = sourceUrl(book)
  const card = useMemo(() => ({
    ...mapWebCacheBookToCard(book),
    status: 'WebBookInPage' as const,
    thumbnailUrl: undefined,
    thumbnailReloadKey: `${identity(book)}:${book.lastSyncedAt ?? ''}`,
  }), [book])
  return (
    <BookCard
      book={card}
      selectMode={false}
      selected={false}
      onToggle={() => undefined}
      onOpen={onDetail}
      openDisabled={!valid}
      isDownloadCandidate={isDownloadCandidate(card)}
      actionsDisabled={disabled || !valid}
      downloadDisabled={enqueued}
      downloadLabel={disabled ? '処理中…' : enqueued ? '投入済み' : `${card.title}をダウンロード`}
      onDownload={onEnqueue}
      onDelete={onDelete}
      allowWebDelete
      onTagSearch={onTagSearch}
      extraActions={source && <a className={iconButtonClassName({ variant: 'outline', tone: 'neutral', size: 'compact' }, 'card-action card-action--control')} href={source} target="_blank" rel="noopener noreferrer" aria-label="配信元を別タブで開く"><ExternalLink size={16} aria-hidden="true" /></a>}
      footer={<div className="cache-card-metadata">
        <p>{book.groupId || '不明'} / {book.bookId || '不明'}</p>
        <p>{disabled ? '処理中…' : enqueued ? 'ダウンロード投入済み' : autoState(book)}</p>
        {book.syncError && <p className="cache-error">同期エラー: {book.syncError}</p>}
      </div>}
    />
  )
}

// Remounting on connection changes also scopes successful enqueues to the active server.
export function WebCachePage(props: Props) {
  return <CachePageSession key={props.apiRevision} {...props} />
}

function CachePageSession({ displaySettings, notify }: Props) {
  const location = useRouterLocation()
  const applied = useMemo(() => parseCacheSearch(location.search), [location.search])
  const [draft, setDraft] = useState(applied)
  const [groupsText, setGroupsText] = useState(applied.groupIds.join(', '))
  const [booksText, setBooksText] = useState(applied.bookIds.join(', '))
  const [groups, setGroups] = useState<string[]>([])
  const [books, setBooks] = useState<WebBookCacheBookDto[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [formError, setFormError] = useState('')
  const [revision, setRevision] = useState(0)
  const [selected, setSelected] = useState<WebBookCacheBookDto | null>(null)
  const [detail, setDetail] = useState<WebBookCacheBookDto | null>(null)
  const detailTags = useMemo(() => detail ? mapWebCacheBookToCard(detail).tags : [], [detail])
  const [detailError, setDetailError] = useState('')
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailRevision, setDetailRevision] = useState(0)
  const [deleteTarget, setDeleteTarget] = useState<WebBookCacheBookDto | null>(null)
  const [deleteError, setDeleteError] = useState('')
  const [pending, setPending] = useState<Set<string>>(new Set())
  const [enqueued, setEnqueued] = useState<Set<string>>(new Set())
  const operations = useRef(new Map<string, AbortController>())
  useDocumentTitle(formatPageTitle(`キャッシュ候補 · ${applied.page}ページ`))

  useEffect(() => {
    setDraft(applied)
    setGroupsText(applied.groupIds.join(', '))
    setBooksText(applied.bookIds.join(', '))
    setFormError('')
    setSelected(null)
  }, [applied])

  useEffect(() => {
    const controller = new AbortController()
    getCacheConfig(controller.signal).then((response) => {
      if (!controller.signal.aborted) setGroups((response.config.sites ?? []).map((site) => site.groupId).filter((id): id is string => Boolean(id)))
    }).catch(() => { /* Optional suggestions must never block candidate search. */ })
    return () => controller.abort()
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError('')
    searchCache(buildCacheSearchRequest(applied), controller.signal).then((response) => {
      if (controller.signal.aborted) return
      const pages = Math.max(1, response.totalPage ?? 1)
      if (applied.page > pages) {
        navigate(`/web-cache${serializeCacheSearch({ ...applied, page: pages })}`, { replace: true })
        return
      }
      setBooks(response.books ?? [])
      setTotalCount(response.totalCount ?? 0)
      setTotalPages(pages)

    }).catch((failure: unknown) => {
      if (!controller.signal.aborted) setError(cacheError(failure))
    }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [applied, revision])

  useEffect(() => {
    if (!selected) return
    const controller = new AbortController()
    setDetail(null)
    setDetailError('')
    setDetailLoading(true)
    getCacheBook(selected.groupId!, selected.bookId!, controller.signal).then((book) => {
      if (!controller.signal.aborted) setDetail(book)
    }).catch((failure: unknown) => {
      if (!controller.signal.aborted) setDetailError(cacheError(failure))
    }).finally(() => { if (!controller.signal.aborted) setDetailLoading(false) })
    return () => controller.abort()
  }, [selected, detailRevision])

  useEffect(() => {
    const requests = operations.current
    return () => { requests.forEach((controller) => controller.abort()); requests.clear() }
  }, [])

  function submit(event: FormEvent) {
    event.preventDefault()
    const next = {
      ...draft,
      groupIds: groupsText === draft.groupIds.join(', ') ? draft.groupIds : splitCacheIds(groupsText),
      bookIds: booksText === draft.bookIds.join(', ') ? draft.bookIds : splitCacheIds(booksText),
      page: 1,
    }
    const message = validateCacheSearch(next)
    setFormError(message ?? '')
    if (message) return
    const query = serializeCacheSearch(next)
    if (query === location.search) setRevision((value) => value + 1)
    else navigate(`/web-cache${query}`)
  }

  async function mutate(book: WebBookCacheBookDto, action: 'enqueue' | 'delete') {
    const key = identity(book)
    if (!hasIdentity(book) || operations.current.has(key) || action === 'enqueue' && enqueued.has(key)) return
    const controller = new AbortController()
    operations.current.set(key, controller)
    setPending(new Set(operations.current.keys()))
    setDeleteError('')
    try {
      if (action === 'enqueue') await enqueueCacheBook(book.groupId!, book.bookId!, controller.signal)
      else await deleteCacheBook(book.groupId!, book.bookId!, controller.signal)
      if (controller.signal.aborted) return
      if (action === 'enqueue') {
        setEnqueued((current) => new Set([...current, key]))
        notify('ダウンロードキューに投入しました。進捗はダウンロード画面で確認できます。')
      } else {
        setDeleteTarget(null)
        setSelected((current) => current && identity(current) === key ? null : current)
        setRevision((value) => value + 1)
        notify('キャッシュ候補を削除しました。')
      }
    } catch (failure) {
      if (!controller.signal.aborted) {
        const message = cacheError(failure)
        if (action === 'delete') setDeleteError(message)
        notify(message, 'error')
      }
    } finally {
      operations.current.delete(key)
      if (!controller.signal.aborted) setPending(new Set(operations.current.keys()))
    }
  }

  const activeBook = detail ?? selected
  return (
    <section className="web-cache" aria-labelledby="web-cache-title">
      <header className="web-cache__heading"><div><h1 id="web-cache-title">キャッシュ候補</h1><p>収集済みのWeb書籍から、ダウンロードする候補を探す</p></div><InternalLink href="/dashboard/web-cache">Web Cache管理</InternalLink></header>
      <form className="cache-search" role="search" onSubmit={submit}>
        <div className="cache-search__basic">
          <label>キーワード<input type="search" value={draft.q} onChange={(event) => setDraft({ ...draft, q: event.target.value })} placeholder="タイトル・キーワード" /></label>
          <label>GroupId<input list="cache-group-suggestions" value={groupsText} onChange={(event) => setGroupsText(event.target.value)} placeholder="カンマ区切りで複数指定" /></label>
          <label>最大ページ数<input type="number" min="1" step="1" value={draft.maxPages} onChange={(event) => setDraft({ ...draft, maxPages: event.target.value })} placeholder="上限なし" /></label>
          <Button type="submit" variant="solid" tone="accent"><Search size={16} />検索</Button>
        </div>
        <datalist id="cache-group-suggestions">{groups.map((group) => <option value={group} key={group} />)}</datalist>
        <details><summary>詳細条件</summary><div className="cache-search__advanced">
          <label>BookId<input value={booksText} onChange={(event) => setBooksText(event.target.value)} placeholder="カンマ区切りで複数指定" /></label>
          <label>投稿日（開始）<input type="date" value={draft.from} onChange={(event) => setDraft({ ...draft, from: event.target.value })} /></label>
          <label>投稿日（終了）<input type="date" value={draft.to} onChange={(event) => setDraft({ ...draft, to: event.target.value })} /></label>
          <label>投稿日順<select value={draft.asc ? 'asc' : 'desc'} onChange={(event) => setDraft({ ...draft, asc: event.target.value === 'asc' })}><option value="desc">新しい順</option><option value="asc">古い順</option></select></label>
        </div></details>
        {formError && <p className="cache-error" role="alert">{formError}</p>}
      </form>
      <div className="web-cache__toolbar"><p role="status">{loading ? '検索中…' : error ? '検索に失敗しました' : `${totalCount.toLocaleString()}件 · ${applied.page} / ${totalPages}ページ`}</p><div><InternalLink href="/download/book">ダウンロード</InternalLink><IconButton aria-label="検索結果を更新" disabled={loading} onClick={() => setRevision((value) => value + 1)}><RefreshCw size={17} /></IconButton></div></div>
      {error && <StatePanel title="検索できませんでした" description={error} action={<Button onClick={() => setRevision((value) => value + 1)}>再試行</Button>} />}
      {loading ? <StatePanel title="候補を検索しています…" /> : !error && books.length === 0 ? <StatePanel title="該当する候補がありません" description="検索条件を変更するか、管理画面で同期状態を確認してください。" /> : !error && (
        <div className="book-grid" style={{ '--thumbnail-columns': displaySettings.thumbnailColumns } as CSSProperties}>
          {books.map((book, index) => <CacheCard key={`${identity(book)}:${index}`} book={book} onTagSearch={(tag) => navigate(`/web-cache${serializeCacheSearch({ ...applied, q: tag.name, page: 1 })}`)} disabled={pending.has(identity(book))} enqueued={enqueued.has(identity(book))} onDetail={() => setSelected(book)} onEnqueue={() => { void mutate(book, 'enqueue') }} onDelete={() => { setDeleteError(''); setDeleteTarget(book) }} />)}
        </div>
      )}
      {!loading && !error && totalPages > 1 && <nav className="pagination" aria-label="キャッシュ候補のページ">{getPaginationItems(applied.page, totalPages, 5).map((page, index) => page === 'ellipsis' ? <span key={`gap-${index}`}>…</span> : page === applied.page ? <span key={page} className="pagination__current" aria-current="page">{page}</span> : <Button key={page} onClick={() => navigate(`/web-cache${serializeCacheSearch({ ...applied, page })}`)} aria-label={`${page}ページへ`}>{page}</Button>)}</nav>}
      <Dialog open={selected !== null} onRequestClose={() => { setSelected(null); return true }} aria-labelledby="cache-detail-title" className="cache-detail">
        <DialogHeader><h2 id="cache-detail-title">候補の詳細</h2><IconButton aria-label="詳細を閉じる" onClick={() => setSelected(null)}><X size={18} /></IconButton></DialogHeader>
        <DialogBody>
          {detailLoading && <p role="status">詳細を取得しています…</p>}
          {detailError && <div role="alert"><p className="cache-error">{detailError}</p><Button onClick={() => setDetailRevision((value) => value + 1)}>再試行</Button></div>}
          {detail && <><h3>{detail.title || 'タイトルなし'}</h3><dl className="cache-detail__fields">
            {Object.entries({ GroupId: detail.groupId, BookId: detail.bookId, ページ数: detail.totalPage, 投稿日: dateText(detail.uploadedTime), 初回キャッシュ: dateText(detail.firstCachedAt), 最終同期: dateText(detail.lastSyncedAt), 最終確認: dateText(detail.lastSeenAt), 同期エラー: detail.syncError, 自動判定: autoState(detail), 判定日時: dateText(detail.autoDownloadEvaluatedAt), 判定理由: detail.autoDownloadReason, 自動投入日時: dateText(detail.autoDownloadEnqueuedAt) }).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value ?? '—'}</dd></div>)}
          </dl><h3>すべてのタグ</h3>{TAG_TYPE_ORDER.map((type) => { const tags = detailTags.filter((tag) => tag.type === type); return tags.length > 0 && <div key={type}><h4>{TAG_TYPE_LABELS[type]}</h4><div className="cache-tags">{tags.map((tag) => <span key={tag.name}>{getTagLabel(tag)}{typeof tag.count === 'number' && Number.isFinite(tag.count) ? `（${tag.count.toLocaleString('ja-JP')}件）` : ''}</span>)}</div></div> })}
          <h3>URL</h3><dl className="cache-detail__fields">{Object.entries({ 配信元: detail.sourcePageUrl, URL: detail.url, サムネイル: detail.thumbnailUrl }).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{safeUrl(value) ? <a href={safeUrl(value)} target="_blank" rel="noopener noreferrer">{value}</a> : value || '—'}</dd></div>)}</dl>
          {(detail.pageUrls?.length ?? 0) > 0 && <details><summary>ページURL（{detail.pageUrls!.length}件）</summary><ul>{detail.pageUrls!.map((url, index) => <li key={`${index}:${url}`}>{safeUrl(url) ? <a href={safeUrl(url)} target="_blank" rel="noopener noreferrer">{url}</a> : url}</li>)}</ul></details>}
          </>}
        </DialogBody>
        <DialogFooter>{activeBook && <><Button disabled={detailLoading || !detail || pending.has(identity(activeBook)) || enqueued.has(identity(activeBook))} onClick={() => { void mutate(activeBook, 'enqueue') }}>{pending.has(identity(activeBook)) ? '投入中…' : enqueued.has(identity(activeBook)) ? '投入済み' : 'ダウンロード投入'}</Button>{sourceUrl(activeBook) && <a href={sourceUrl(activeBook)} target="_blank" rel="noopener noreferrer">配信元を開く</a>}</>}</DialogFooter>
      </Dialog>
      <Dialog open={deleteTarget !== null} dismissible={!deleteTarget || !pending.has(identity(deleteTarget))} onRequestClose={() => { if (deleteTarget && pending.has(identity(deleteTarget))) return false; setDeleteTarget(null); return true }} aria-labelledby="cache-delete-title">
        <DialogHeader><h2 id="cache-delete-title">キャッシュ候補を削除</h2></DialogHeader><DialogBody><p>「{deleteTarget?.title || deleteTarget?.bookId}」をキャッシュから削除しますか？</p>{deleteError && <p className="cache-error" role="alert">{deleteError}</p>}</DialogBody><DialogFooter><Button disabled={Boolean(deleteTarget && pending.has(identity(deleteTarget)))} onClick={() => setDeleteTarget(null)}>キャンセル</Button><Button variant="solid" tone="danger" disabled={!deleteTarget || pending.has(identity(deleteTarget))} onClick={() => { if (deleteTarget) void mutate(deleteTarget, 'delete') }}>{deleteTarget && pending.has(identity(deleteTarget)) ? '削除中…' : '削除'}</Button></DialogFooter>
      </Dialog>
    </section>
  )
}
