import { BookOpen, BookX, CalendarDays, Clock3, CloudOff, Inbox, RefreshCw, Sparkles, UserRound, Users, X } from 'lucide-react'
import type { MouseEvent, ReactNode } from 'react'
import { useCallback, useContext, useEffect, useId, useMemo, useRef, useState } from 'react'
import { createBookPageThumbnailRequest, mapEBookToCard } from '../../api/books'
import { requestBlob } from '../../api/client'
import { usableRecommendations } from '../../api/recommendations'
import type { RecommendationHit, RecommendationTagDisplayName, RecommendationType } from '../../api/recommendations'
import { InternalLink, navigate } from '../../app/client-router'
import { Thumbnail } from '../../components/Thumbnail'
import { IconButton } from '../../components/ui'
import type { BookCardModel, BookTag } from '../../models'
import { getTagLabel } from '../../models'
import { useRecommendations } from './use-recommendations'
import './book-recommendations.css'
import { RecommendationDebugContext } from '../settings/RecommendationDebugContext'
import { RecommendationHitDebug, RecommendationResponseDebug } from './RecommendationDebug'

const tabs = [
  { type: 'Book', label: '作品', icon: BookOpen },
  { type: 'Artist', label: '作者', icon: UserRound },
  { type: 'Group', label: 'グループ', icon: Users },
] as const

function StatusIcon({ label, children, animated = false }: { label: string; children: ReactNode; animated?: boolean }) {
  const [expanded, setExpanded] = useState(false)
  const id = useId()
  return <span className="recommendations__hint">
    <IconButton aria-label={label} aria-describedby={expanded ? id : undefined} title={label}
      aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}
      className={animated ? 'recommendations__pulse' : undefined}>
      {children}
    </IconButton>
    {expanded && <span id={id} role="tooltip" className="recommendations__tooltip">{label}</span>}
  </span>
}

const recommendationTag = (type: BookTag['type'], name: string, displayNames?: RecommendationTagDisplayName[]): BookTag => ({
  type,
  name,
  displayName: displayNames?.find((tag) => tag.type === type && tag.name === name)?.displayName?.trim() || undefined,
})

function RecommendationCard({ hit, displayNames, href, onSelect }: { hit: RecommendationHit; displayNames?: RecommendationTagDisplayName[]; href: string; onSelect: (event: MouseEvent<HTMLAnchorElement>) => void }) {
  const key = hit.key!
  const isBook = key.entityType === 'Book'
  const book = useMemo(() => isBook ? mapEBookToCard({ ...hit.book, groupId: key.groupId, bookId: key.bookId }) : undefined, [hit.book, isBook, key])
  const thumbnailBook = hit.entity?.thumbnailBook
  const request = useMemo(() => isBook ? book?.thumbnailRequest
    : createBookPageThumbnailRequest(thumbnailBook?.groupId, thumbnailBook?.bookId, 1), [isBook, book?.thumbnailRequest, thumbnailBook])
  const load = useCallback((signal: AbortSignal) => requestBlob(request!.path, { query: request!.query, headers: { Accept: 'image/*' }, signal }), [request])
  const title = book?.title ?? getTagLabel(recommendationTag(key.entityType === 'Artist' ? 'Artists' : 'Groups', key.tagName ?? '', displayNames))
  const tags = hit.commonTags ?? []
  const EntityIcon = key.entityType === 'Artist' ? UserRound : Users
  const count = hit.entity?.totalBookCount
  return <InternalLink href={href} className={`recommendations__card ${isBook ? '' : 'recommendations__card--entity'}`} onClick={onSelect}>
    {!isBook && <span className="recommendations__card-body">
      <strong title={title}>{title}</strong>
      {typeof count === 'number' && Number.isFinite(count) && count >= 0 && <span className="recommendations__count">{count.toLocaleString()}作品</span>}
    </span>}
    {isBook ? <Thumbnail load={request ? load : undefined} alt="" fallbackText="" fallbackAriaLabel="表紙なし"
      retryOnError={false} className="recommendations__cover" loadingPolicy="page">
        <span className="recommendations__cover-meta">
          {book?.sourceLabel && <span className="recommendations__source">{book.sourceLabel}</span>}
          {book && book.totalPage > 0 && <span className="recommendations__pages" aria-label={`${book.totalPage}ページ`}>P{book.totalPage}</span>}
        </span>
      </Thumbnail>
      : <span className="recommendations__avatar"><Thumbnail
        load={request ? load : undefined} alt="" fallbackText="" fallbackAriaLabel={key.entityType === 'Artist' ? '作者' : 'グループ'}
        fallbackIcon={<EntityIcon size={28} aria-hidden="true" />} retryOnError={false}
        reloadKey={thumbnailBook ? JSON.stringify([thumbnailBook.groupId, thumbnailBook.bookId]) : undefined}
        loadingPolicy={{ mode: 'page', viewports: 1 }}
      /></span>}
    {isBook && <span className="recommendations__card-body">
      {book?.uploadedTime && <time className="recommendations__uploaded-time" dateTime={book.uploadedTime}>
        <CalendarDays size={11} aria-hidden="true" />
        {book.uploadedTime.slice(0, 16).replace('T', ' ').replaceAll('-', '/')}
      </time>}
      <strong>{title}</strong>
      <span className="recommendations__tags">{tags.filter((tag) => typeof tag === 'string').slice(0, 3).map((tag, index) => <span key={`${tag}:${index}`}>{getTagLabel(recommendationTag('Tags', tag, displayNames))}</span>)}</span>
    </span>}
  </InternalLink>
}

type RecommendationsProps = { onTagSearch: (tag: BookTag) => void; getTagSearchHref: (tag: BookTag) => string } & (
  { book: BookCardModel; sourceTag?: never } | { book?: never; sourceTag: BookTag & { type: 'Artists' | 'Groups' } }
)

export function BookRecommendations(props: RecommendationsProps) {
  const identity = props.sourceTag ? JSON.stringify([props.sourceTag.type, props.sourceTag.name]) : JSON.stringify([props.book.groupId, props.book.bookId])
  return <RecommendationsPanel key={identity} {...props} />
}

function RecommendationsPanel({ book, sourceTag, onTagSearch, getTagSearchHref }: RecommendationsProps) {
  const debug = useContext(RecommendationDebugContext)
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<RecommendationType>(sourceTag ? 'Artist' : 'Book')
  const visibleTabs = sourceTag ? tabs.filter((entry) => entry.type !== 'Book') : tabs
  const dialogRef = useRef<HTMLDialogElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const outsideRef = useRef(false)
  const id = useId()
  const { state, retry } = useRecommendations(book?.groupId ?? '', sourceTag?.name ?? book?.bookId ?? '', open, tab, sourceTag ? sourceTag.type === 'Artists' ? 'Artist' : 'Group' : undefined)
  const result = state?.result
  const items = usableRecommendations(result?.items, tab)
  const waiting = result?.status === 'pending'
  const loading = !state || state.loading && !waiting
  const label = state?.error ?? (result?.status === 'no_features' ? '関連候補を探すための情報が不足しています'
    : result?.status === 'not_found' ? sourceTag ? 'この作者・グループは存在しません' : 'この作品は存在しないか削除されています'
      : result?.status === 'unavailable' ? 'レコメンド機能を利用できません'
        : waiting ? '関連候補を準備しています' : '関連候補はありません')
  const canRetry = Boolean(state?.error || result?.status === 'unavailable' || waiting && state && state.attempts >= 3 && !state.loading)
  const StateIcon = state?.error || result?.status === 'unavailable' ? CloudOff : result?.status === 'not_found' ? BookX : waiting ? Clock3 : Inbox

  useEffect(() => {
    if (!open) return
    const dialog = dialogRef.current!
    const trigger = triggerRef.current
    const position = { left: window.scrollX, top: window.scrollY }
    const previousOverflow = document.body.style.overflow
    const previousRootOverflow = document.documentElement.style.overflow
    dialog.showModal()
    document.body.style.overflow = 'hidden'
    document.documentElement.style.overflow = 'hidden'
    window.scrollTo({ ...position, behavior: 'instant' })
    closeRef.current?.focus({ preventScroll: true })
    return () => {
      dialog.close()
      document.body.style.overflow = previousOverflow
      document.documentElement.style.overflow = previousRootOverflow
      if (trigger?.isConnected) trigger.focus({ preventScroll: true })
    }
  }, [open])

  const getHref = (hit: RecommendationHit) => {
    const key = hit.key!
    return key.entityType === 'Book'
      ? `/book/viewer?${new URLSearchParams({ gid: key.groupId!, id: key.bookId! })}`
      : getTagSearchHref(recommendationTag(key.entityType === 'Artist' ? 'Artists' : 'Groups', key.tagName!, result?.tagDisplayNames))
  }

  const select = (event: MouseEvent<HTMLAnchorElement>, hit: RecommendationHit) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    setOpen(false)
    const key = hit.key!
    if (key.entityType === 'Book') {
      navigate(getHref(hit))
    } else {
      onTagSearch(recommendationTag(key.entityType === 'Artist' ? 'Artists' : 'Groups', key.tagName!, result?.tagDisplayNames))
    }
  }

  return <>
    {sourceTag ? <IconButton ref={triggerRef} type="button" variant="ghost" tone="neutral" aria-label="関連する作者・グループ" title="関連する作者・グループ" aria-haspopup="dialog" aria-expanded={open} aria-controls={id} onClick={() => setOpen(true)}>
      <Sparkles size={19} aria-hidden="true" />
    </IconButton> : <IconButton ref={triggerRef} className="book-viewer__floating-control recommendations__trigger" aria-label="タグ関連作品を開く" title="タグ関連作品"
      aria-haspopup="dialog" aria-expanded={open} aria-controls={id} onClick={() => setOpen(true)}><Sparkles size={20} aria-hidden="true" /></IconButton>}
    <dialog ref={dialogRef} id={id} aria-labelledby={`${id}-title`} className="recommendations"
      onClose={(event) => event.stopPropagation()}
      onCancel={(event) => { event.preventDefault(); event.stopPropagation(); setOpen(false) }}
      onPointerDown={(event) => { outsideRef.current = event.target === event.currentTarget }}
      onClick={(event) => { if (outsideRef.current && event.target === event.currentTarget) setOpen(false); outsideRef.current = false }}>
      {open && <div className="recommendations__panel">
        <header className="recommendations__header">
          <Sparkles size={20} aria-hidden="true" /><h2 id={`${id}-title`}>{sourceTag ? `${getTagLabel(sourceTag)} の関連` : 'タグ関連'}</h2>
          {result?.isStale && items.length > 0 && <StatusIcon label="候補は更新待ちです"><Clock3 size={16} aria-hidden="true" /></StatusIcon>}
          <IconButton aria-label="関連候補を更新" title="更新" disabled={Boolean(loading || state?.loading || waiting && !canRetry)} onClick={retry}><RefreshCw size={18} aria-hidden="true" /></IconButton>
          <IconButton ref={closeRef} aria-label="関連候補を閉じる" title="閉じる" onClick={() => setOpen(false)}><X size={20} aria-hidden="true" /></IconButton>
        </header>
        <div className="recommendations__tabs" role="tablist" aria-label="関連候補の種類">
          {visibleTabs.map(({ type, label: tabLabel, icon: Icon }, index) => <button type="button" key={type} role="tab" id={`${id}-${type}`}
            aria-controls={`${id}-content`} aria-selected={tab === type} tabIndex={tab === type ? 0 : -1} onClick={() => setTab(type)}
            onKeyDown={(event) => {
              const next = event.key === 'ArrowRight' ? (index + 1) % visibleTabs.length : event.key === 'ArrowLeft' ? (index + visibleTabs.length - 1) % visibleTabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? visibleTabs.length - 1 : undefined
              if (next === undefined) return
              event.preventDefault(); setTab(visibleTabs[next].type)
              document.getElementById(`${id}-${visibleTabs[next].type}`)?.focus({ preventScroll: true })
            }}><Icon size={17} aria-hidden="true" />{tabLabel}</button>)}
        </div>
        <div key={tab} id={`${id}-content`} role="tabpanel" aria-labelledby={`${id}-${tab}`} tabIndex={0} className="recommendations__content" aria-busy={Boolean(loading)}>
          <span role="status" className="sr-only">{loading ? '関連候補を読み込んでいます' : items.length ? `${items.length}件の関連候補` : label}</span>
          {debug && result && <RecommendationResponseDebug result={result} />}
          {loading ? <div className="recommendations__grid" aria-hidden="true">{Array.from({ length: 6 }, (_, index) => <span key={index} className="recommendations__skeleton" />)}</div>
            : items.length > 0 && result?.status === 'success' ? <div className={debug ? 'recommendations__debug-list' : tab === 'Book' ? 'recommendations__grid' : 'recommendations__list'}>
              {items.map((hit) => debug ? <article key={JSON.stringify(hit.key)} className="recommendations__debug-item">
                <RecommendationCard hit={hit} displayNames={result?.tagDisplayNames} href={getHref(hit)} onSelect={(event) => select(event, hit)} />
                <RecommendationHitDebug hit={hit} rank={(result.items?.indexOf(hit) ?? -1) + 1} names={result.tagDisplayNames} />
              </article> : <RecommendationCard key={JSON.stringify(hit.key)} hit={hit} displayNames={result?.tagDisplayNames} href={getHref(hit)} onSelect={(event) => select(event, hit)} />)}
            </div> : <div className="recommendations__empty">
              <StatusIcon key={label} label={label} animated={waiting && !canRetry}><StateIcon size={36} strokeWidth={1.4} aria-hidden="true" /></StatusIcon>
              {canRetry && <IconButton aria-label="関連候補を再試行" title="再試行" onClick={retry}><RefreshCw size={20} aria-hidden="true" /></IconButton>}
            </div>}
        </div>
      </div>}
    </dialog>
  </>
}
