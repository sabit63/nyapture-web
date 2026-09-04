import {
  CalendarDays,
  Check,
  Download,
  Files,
  RefreshCw,
  Trash2,
  X,
} from 'lucide-react'
import { useCallback, useRef } from 'react'

import type { ApiBookCardModel } from '../api'
import { requestBlob } from '../api'
import { BookStatusBadge } from './BookStatusBadge'
import { TagChip } from './TagChip'
import { Thumbnail } from './Thumbnail'
import { IconButton } from './ui/IconButton'
import { TAG_TYPE_LABELS, TAG_TYPE_ORDER } from '../models'
import type { BookCardModel, BookTag } from '../models'
import './book-card.css'

const formatDisplayDate = (uploadedTime: string) => uploadedTime.slice(0, 16).replace('T', ' ').replaceAll('-', '/')

export type BookCardProps = {
  book: BookCardModel
  selectMode: boolean
  selected: boolean
  onToggle: () => void
  onTagSearch: (tag: BookTag) => void
  isDownloadCandidate?: boolean
  isWebSearch: boolean
  onDelete?: (trigger: HTMLButtonElement) => void
  onRefresh?: () => void
  onDownload?: () => void
}

export function BookCard({
  book,
  selectMode,
  selected,
  onToggle,
  onTagSearch,
  isDownloadCandidate = false,
  isWebSearch,
  onDelete,
  onRefresh,
  onDownload,
}: BookCardProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const tagsPanelRef = useRef<HTMLDivElement>(null)
  const tagsPointerStartedOutsideRef = useRef(false)
  const tagsTriggerRef = useRef<HTMLButtonElement>(null)
  const thumbnailRequest = (book as ApiBookCardModel).thumbnailRequest
  const thumbnailReloadKey = (book as ApiBookCardModel).thumbnailReloadKey
  const sourceLabel = book.sourceLabel?.trim() || undefined
  const loadThumbnail = useCallback((signal: AbortSignal) => {
    if (!thumbnailRequest) return Promise.reject(new Error('Thumbnail request is unavailable'))
    return requestBlob(thumbnailRequest.path, { query: thumbnailRequest.query, headers: { Accept: 'image/*' }, signal })
  }, [thumbnailRequest])
  const inlineTags = [
    ...book.tags.filter((tag) => tag.type === 'Artists'),
    ...book.tags.filter((tag) => tag.type === 'Groups'),
  ].slice(0, 2)
  const hiddenTagCount = Math.max(0, book.tags.length - inlineTags.length)
  const viewerUrl = `/book/viewer?id=${encodeURIComponent(book.bookId)}&gid=${encodeURIComponent(book.groupId)}`
  const downloadDisabled = book.status === 'Downloaded' || book.status === 'Downloading'
  const downloadLabel = book.status === 'Downloaded'
    ? `${book.title}はダウンロード済み`
    : book.status === 'Downloading'
      ? `${book.title}はダウンロード中`
      : `${book.title}をダウンロード`

  const openTagsDialog = () => dialogRef.current?.showModal()
  const closeTagsDialog = () => dialogRef.current?.close()

  return (
    <article className={`book-card ${selected ? 'book-card--selected' : ''} ${isDownloadCandidate ? 'book-card--download-candidate' : ''}`} data-book-status={book.status}>
      <Thumbnail
        src={book.thumbnailUrl}
        load={thumbnailRequest ? loadThumbnail : undefined}
        reloadKey={thumbnailReloadKey}
        alt={`${book.title}の表紙`}
        linkHref={viewerUrl}
        linkAriaLabel={`${book.title}を閲覧`}
        linkTabIndex={selectMode ? -1 : undefined}
        fallbackText={book.thumbnailUrl || thumbnailRequest ? '画像を読み込めませんでした' : 'サムネイルはありません'}
        fallbackAriaLabel={`${book.title}のサムネイルを表示できません`}
        variant={book.cover}
      >
        <BookStatusBadge status={book.status} />
        {sourceLabel && <span className="source-badge">{sourceLabel}</span>}
        {selectMode ? (
          <button className="card-select" type="button" aria-label={`${book.title}を${selected ? '選択解除' : '選択'}`} aria-pressed={selected} onClick={onToggle}>
            {selected && <Check size={15} />}
          </button>
        ) : isWebSearch ? (
          <div className="card-actions" aria-label={`${book.title}の操作`}>
            <button className="card-action" type="button" aria-label={`${book.title}を再読み込み`} onClick={() => onRefresh?.()}>
              <RefreshCw size={16} aria-hidden="true" />
            </button>
            <button className="card-action" type="button" aria-label={downloadLabel} disabled={downloadDisabled} onClick={() => onDownload?.()}>
              <Download size={16} aria-hidden="true" />
            </button>
          </div>
        ) : (
          <button className="card-action card-action--delete" type="button" aria-label={`${book.title}を削除`} onClick={(event) => onDelete?.(event.currentTarget)}>
            <Trash2 size={17} aria-hidden="true" />
          </button>
        )}
      </Thumbnail>
      <div className="book-card__body">
        <div className="book-card__title-row">
          <h3><a href={viewerUrl}>{book.title}</a></h3>
        </div>
        <div className="book-tags" aria-label="主要タグ">
          {inlineTags.map((tag) => (
            <TagChip key={`${tag.type}:${tag.name}`} tag={tag} size="compact" onClick={() => onTagSearch(tag)} />
          ))}
          {hiddenTagCount > 0 && (
            <button
              ref={tagsTriggerRef}
              className="tag-overflow"
              type="button"
              aria-label={`${book.title}の残り${hiddenTagCount}件のタグを表示`}
              onClick={openTagsDialog}
            >
              +{hiddenTagCount}
            </button>
          )}
        </div>
        <div className="book-card__meta">
          <span><Files size={13} aria-hidden="true" />{book.totalPage}ページ</span>
          <time dateTime={book.uploadedTime}><CalendarDays size={13} aria-hidden="true" />{formatDisplayDate(book.uploadedTime)}</time>
        </div>
      </div>
      <dialog
        ref={dialogRef}
        className="ui-dialog tags-dialog"
        aria-labelledby={`tags-dialog-title-${book.bookId}`}
        onClose={() => tagsTriggerRef.current?.focus()}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            closeTagsDialog()
          }
        }}
        onPointerDown={(event) => {
          const panel = tagsPanelRef.current
          if (!panel) return
          const rect = panel.getBoundingClientRect()
          tagsPointerStartedOutsideRef.current = event.clientX < rect.left
            || event.clientX > rect.right
            || event.clientY < rect.top
            || event.clientY > rect.bottom
        }}
        onClick={(event) => {
          if (event.target === event.currentTarget && tagsPointerStartedOutsideRef.current) closeTagsDialog()
          tagsPointerStartedOutsideRef.current = false
        }}
      >
        <div ref={tagsPanelRef} className="tags-dialog__panel">
          <header className="tags-dialog__header">
            <div>
              <span>タグ一覧</span>
              <h2 id={`tags-dialog-title-${book.bookId}`}>{book.title}</h2>
            </div>
            <IconButton aria-label="タグ一覧を閉じる" onClick={closeTagsDialog}>
              <X size={19} aria-hidden="true" />
            </IconButton>
          </header>
          <div className="tags-dialog__body">
            {TAG_TYPE_ORDER.map((type) => {
              const tags = book.tags.filter((tag) => tag.type === type)
              if (!tags.length) return null
              return (
                <section className="tags-dialog__group" key={type} aria-labelledby={`tags-${book.bookId}-${type}`}>
                  <div className="tags-dialog__group-heading">
                    <h3 id={`tags-${book.bookId}-${type}`}>{TAG_TYPE_LABELS[type]}</h3>
                    <span>{tags.length}</span>
                  </div>
                  <div className="tags-dialog__chips">
                    {tags.map((tag) => (
                      <TagChip
                        key={`${tag.type}:${tag.name}`}
                        tag={tag}
                        size="default"
                        title={tag.displayName && tag.displayName !== tag.name ? tag.name : undefined}
                        onClick={() => {
                          closeTagsDialog()
                          onTagSearch(tag)
                        }}
                      />
                    ))}
                  </div>
                </section>
              )
            })}
          </div>
        </div>
      </dialog>
    </article>
  )
}
