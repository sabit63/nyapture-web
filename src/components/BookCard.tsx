import {
  CalendarDays,
  Check,
  Download,
  RefreshCw,
  Trash2,
  X,
} from 'lucide-react'
import { useCallback, useRef, useState } from 'react'
import type { MouseEvent } from 'react'

import type { ApiBookCardModel } from '../api'
import { requestBlob } from '../api'
import { BookStatusBadge } from './BookStatusBadge'
import { TagChip } from './TagChip'
import { Thumbnail } from './Thumbnail'
import { Button } from './ui/Button'
import { Dialog, DialogBody, DialogHeader } from './ui/Dialog'
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
  onTagSearchDestinationRequest: (tag: BookTag, trigger: HTMLButtonElement) => void
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
  onTagSearchDestinationRequest,
  isDownloadCandidate = false,
  isWebSearch,
  onDelete,
  onRefresh,
  onDownload,
}: BookCardProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const tagsTriggerRef = useRef<HTMLButtonElement>(null)
  const tagsCloseButtonRef = useRef<HTMLButtonElement>(null)
  const [tagsOpen, setTagsOpen] = useState(false)
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

  const handleThumbnailClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (!selectMode) return
    event.preventDefault()
    onToggle()
  }

  const openTagsDialog = () => setTagsOpen(true)

  return (
    <article className={`book-card ${selected ? 'book-card--selected' : ''} ${isDownloadCandidate ? 'book-card--download-candidate' : ''}`} data-book-status={book.status}>
      <Thumbnail
        src={book.thumbnailUrl}
        load={thumbnailRequest ? loadThumbnail : undefined}
        reloadKey={thumbnailReloadKey}
        alt={`${book.title}の表紙`}
        linkHref={viewerUrl}
        linkAriaLabel={`${book.title}を${selectMode ? (selected ? '選択解除' : '選択') : '閲覧'}`}
        linkTabIndex={selectMode ? -1 : undefined}
        linkOnClick={selectMode ? handleThumbnailClick : undefined}
        fallbackText={book.thumbnailUrl || thumbnailRequest ? '画像を読み込めませんでした' : 'サムネイルはありません'}
        fallbackAriaLabel={`${book.title}のサムネイルを表示できません`}
        variant={book.cover}
      >
        <span className="book-card__page-count" aria-label={`${book.totalPage}ページ`}>P{book.totalPage}</span>
        <BookStatusBadge status={book.status} />
        {sourceLabel && <span className="source-badge">{sourceLabel}</span>}
        {selectMode ? (
          <IconButton
            className="card-select card-select--control"
            variant="ghost"
            tone="neutral"
            size="compact"
            aria-label={`${book.title}を${selected ? '選択解除' : '選択'}`}
            aria-pressed={selected}
            onClick={onToggle}
          >
            {selected && <Check size={15} />}
          </IconButton>
        ) : isWebSearch ? (
          <div className="card-actions" aria-label={`${book.title}の操作`}>
            <IconButton
              className="card-action card-action--control"
              variant="ghost"
              tone="neutral"
              size="compact"
              aria-label={`${book.title}を再読み込み`}
              onClick={() => onRefresh?.()}
            >
              <RefreshCw size={16} aria-hidden="true" />
            </IconButton>
            <IconButton
              className="card-action card-action--control"
              variant="ghost"
              tone="neutral"
              size="compact"
              aria-label={downloadLabel}
              disabled={downloadDisabled}
              onClick={() => onDownload?.()}
            >
              <Download size={16} aria-hidden="true" />
            </IconButton>
          </div>
        ) : (
          <IconButton
            className="card-action card-action--control card-action--delete"
            variant="ghost"
            tone="danger"
            size="compact"
            aria-label={`${book.title}を削除`}
            onClick={(event) => onDelete?.(event.currentTarget)}
          >
            <Trash2 size={17} aria-hidden="true" />
          </IconButton>
        )}
      </Thumbnail>
      <div className="book-card__body">
        <div className="book-card__title-row">
          <time className="book-card__uploaded-time" dateTime={book.uploadedTime}>
            <CalendarDays size={11} aria-hidden="true" />
            {formatDisplayDate(book.uploadedTime)}
          </time>
          <h3><a href={viewerUrl}>{book.title}</a></h3>
        </div>
        <div className="book-tags" aria-label="主要タグ">
          {inlineTags.map((tag) => (
            <TagChip
              key={`${tag.type}:${tag.name}`}
              tag={tag}
              size="compact"
              onClick={() => onTagSearch(tag)}
              onSearchDestinationRequest={onTagSearchDestinationRequest}
            />
          ))}
          {hiddenTagCount > 0 && (
            <Button
              ref={tagsTriggerRef}
              className="tag-overflow tag-overflow--control"
              variant="ghost"
              tone="accent"
              size="compact"
              aria-label={`${book.title}の残り${hiddenTagCount}件のタグを表示`}
              onClick={openTagsDialog}
            >
              +{hiddenTagCount}
            </Button>
          )}
        </div>
      </div>
      <Dialog
        ref={dialogRef}
        className="tags-dialog"
        open={tagsOpen}
        aria-labelledby={`tags-dialog-title-${book.bookId}`}
        initialFocusRef={tagsCloseButtonRef}
        resolveRestoreFocus={() => tagsTriggerRef.current}
        onRequestClose={() => {
          setTagsOpen(false)
          return true
        }}
      >
        {({ requestClose }) => (
          <div className="tags-dialog__panel">
            <DialogHeader className="tags-dialog__header">
              <div>
                <span>タグ一覧</span>
                <h2 id={`tags-dialog-title-${book.bookId}`}>{book.title}</h2>
              </div>
              <IconButton ref={tagsCloseButtonRef} aria-label="タグ一覧を閉じる" onClick={() => requestClose('close-button')}>
                <X size={19} aria-hidden="true" />
              </IconButton>
            </DialogHeader>
            <DialogBody className="tags-dialog__body">
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
                          onSearchDestinationRequest={onTagSearchDestinationRequest}
                          onClick={() => {
                            requestClose('submit')
                            onTagSearch(tag)
                          }}
                        />
                      ))}
                    </div>
                  </section>
                )
              })}
            </DialogBody>
          </div>
        )}
      </Dialog>
    </article>
  )
}
