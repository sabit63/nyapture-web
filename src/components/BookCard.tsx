import {
  CalendarDays,
  Check,
  Download,
  RefreshCw,
  Trash2,
  X,
} from 'lucide-react'
import { useCallback, useId, useRef, useState } from 'react'
import type { MouseEvent, ReactNode } from 'react'

import { requestBlob } from '../api'
import type { ApiBookCardModel } from '../api'
import { InternalLink, navigate, shouldInterceptNavigationClick } from '../app/client-router'
import { toPublicPath } from '../app/app-base-path'
import { BookStatusBadge } from './BookStatusBadge'
import { TagChip } from './TagChip'
import { Thumbnail } from './Thumbnail'
import { Button } from './ui/Button'
import { Dialog, DialogBody, DialogHeader } from './ui/Dialog'
import { IconButton } from './ui/IconButton'
import { TAG_TYPE_LABELS, TAG_TYPE_ORDER } from '../models'
import type { BookTag } from '../models'
import { formatDateTime } from '../models/date-time'
import './book-card.css'

export type BookCardProps = {
  book: ApiBookCardModel
  selectMode: boolean
  selected: boolean
  actionFailed?: boolean
  onToggle: () => void
  onTagSearch: (tag: BookTag) => void
  onTagSearchDestinationRequest?: (tag: BookTag, trigger: HTMLButtonElement) => void
  isDownloadCandidate?: boolean
  onDelete?: (trigger: HTMLButtonElement) => void
  onRefresh?: () => void
  onDownload?: () => void
  /** Opens both cover and title unless `onCoverOpen` overrides the cover. */
  onOpen?: (trigger?: HTMLElement) => void
  /** Opens only the cover; the title keeps its normal `onOpen` or viewer-link behavior. */
  onCoverOpen?: (trigger?: HTMLElement) => void
  /** Native destination for cover navigation, including modified and middle clicks. */
  coverHref?: string
  coverOpenAriaLabel?: string
  onTagOverflowDetails?: (trigger: HTMLButtonElement) => void
  openDisabled?: boolean
  actionsDisabled?: boolean
  downloadDisabled?: boolean
  downloadLabel?: string
  extraActions?: ReactNode
  footer?: ReactNode
}

export function BookCard({
  book,
  selectMode,
  selected,
  actionFailed = false,
  onToggle,
  onTagSearch,
  onTagSearchDestinationRequest,
  isDownloadCandidate = false,
  onDelete,
  onRefresh,
  onDownload,
  onOpen,
  onCoverOpen,
  coverHref,
  coverOpenAriaLabel,
  onTagOverflowDetails,
  openDisabled = false,
  actionsDisabled = false,
  downloadDisabled = false,
  downloadLabel,
  extraActions,
  footer,
}: BookCardProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const tagsTriggerRef = useRef<HTMLButtonElement>(null)
  const tagsCloseButtonRef = useRef<HTMLButtonElement>(null)
  const tagsId = useId()
  const [tagsOpen, setTagsOpen] = useState(false)
  const thumbnailRequest = book.thumbnailRequest
  const thumbnailReloadKey = book.thumbnailReloadKey
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
  const apiGroupId = book.apiGroupId?.trim()
  const apiBookId = book.apiBookId?.trim()
  const viewerUrl = apiGroupId && apiBookId
    ? toPublicPath(`/book/viewer?id=${encodeURIComponent(apiBookId)}&gid=${encodeURIComponent(apiGroupId)}`)
    : undefined
  const isDownloading = book.status === 'Downloading'
  const isDownloaded = book.status === 'Downloaded'
  const isShredding = book.status === 'Shredding'
  const isWebBook = book.status === 'WebBook' || book.status === 'WebBookInPage'
  const canRefresh = !isDownloading && !isShredding
  const canDownload = canRefresh && !isDownloaded
  const canDelete = !isDownloaded && !isShredding && !isWebBook
  const hasActions = canRefresh || canDownload || canDelete || (extraActions !== undefined && extraActions !== null)
  const coverOpen = onCoverOpen ?? onOpen
  const coverLink = openDisabled || isShredding || (selectMode && (isDownloading || actionsDisabled))
    ? undefined
    : selectMode ? coverHref ?? viewerUrl ?? '#' : coverHref ?? (coverOpen ? undefined : viewerUrl)
  const tagsDialogTitleId = `tags-dialog-title-${tagsId}`

  const handleThumbnailClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    if (event.target instanceof Element && event.target.closest('button,[role="button"]')) {
      event.preventDefault()
      return
    }
    if (selectMode) {
      event.preventDefault()
      onToggle()
      return
    }
    if (coverOpen) {
      event.preventDefault()
      coverOpen(event.currentTarget)
      return
    }
    if (typeof window === 'undefined') return
    if (!shouldInterceptNavigationClick({
      button: event.button,
      defaultPrevented: event.defaultPrevented,
      metaKey: event.metaKey,
      ctrlKey: event.ctrlKey,
      shiftKey: event.shiftKey,
      altKey: event.altKey,
      href: event.currentTarget.href,
      currentHref: window.location.href,
      currentOrigin: window.location.origin,
    })) return
    event.preventDefault()
    navigate(event.currentTarget.href)
  }

  const handleTagOverflowClick = (trigger: HTMLButtonElement) => {
    if (isDownloaded && onTagOverflowDetails) {
      onTagOverflowDetails(trigger)
      return
    }
    setTagsOpen(true)
  }

  return (
    <article
      className={`book-card ${selectMode && selected ? 'book-card--selected' : actionFailed ? 'book-card--action-failed' : ''} ${isDownloadCandidate ? 'book-card--download-candidate' : ''}`}
      data-book-status={book.status}
      data-book-group-id={apiGroupId}
      data-book-id={apiBookId}
      aria-busy={actionsDisabled || undefined}
    >
      <Thumbnail
        src={book.thumbnailUrl}
        load={thumbnailRequest ? loadThumbnail : undefined}
        reloadKey={thumbnailReloadKey}
        loadingPolicy={{ mode: 'page', viewports: 3 }}
        alt={`${book.title}の表紙`}
        linkHref={coverLink ? toPublicPath(coverLink) : undefined}
        linkAriaLabel={selectMode ? `${book.title}を${selected ? '選択解除' : '選択'}` : coverOpenAriaLabel ?? `${book.title}を閲覧`}
        linkOnClick={handleThumbnailClick}
        fallbackText={book.thumbnailUrl || thumbnailRequest ? '画像を読み込めませんでした' : 'サムネイルはありません'}
        fallbackAriaLabel={`${book.title}のサムネイルを表示できません`}
        retryOnError={!isShredding && !selectMode}
        variant={book.cover}
      >
        {!isShredding && !selectMode && coverOpen && !coverLink && (
          <button
            type="button"
            className="book-cover__open-button"
            aria-label={coverOpenAriaLabel ?? `${book.title}を表示`}
            disabled={openDisabled}
            onClick={(event) => coverOpen(event.currentTarget)}
          />
        )}
        {book.totalPage > 0 && <span className="book-card__page-count" aria-label={`${book.totalPage}ページ`}>P{book.totalPage}</span>}
        <BookStatusBadge status={book.status} />
        {sourceLabel && <span className="source-badge">{sourceLabel}</span>}
        {!isShredding && selectMode && (
          <IconButton
            className="card-select card-select--control"
            variant="outline"
            tone="neutral"
            size="compact"
            aria-label={`${book.title}を${selected ? '選択解除' : '選択'}`}
            aria-pressed={selected}
            disabled={isDownloading || actionsDisabled || openDisabled}
            onClick={onToggle}
          >
            {selected && <Check size={18} aria-hidden="true" />}
          </IconButton>
        )}
        {!isShredding && !selectMode && hasActions && (
          <div className="card-actions" aria-label={`${book.title}の操作`}>
            {canRefresh && (
              <IconButton
                className="card-action card-action--control"
                variant="outline"
                tone="neutral"
                size="compact"
                aria-label={`${book.title}を再読み込み`}
                disabled={actionsDisabled || !onRefresh}
                onClick={() => onRefresh?.()}
              >
                <RefreshCw size={16} aria-hidden="true" />
              </IconButton>
            )}
            {canDownload && (
              <IconButton
                className="card-action card-action--control"
                variant="outline"
                tone="neutral"
                size="compact"
                aria-label={downloadLabel ?? `${book.title}をダウンロード`}
                disabled={actionsDisabled || downloadDisabled || !onDownload}
                onClick={() => onDownload?.()}
              >
                <Download size={16} aria-hidden="true" />
              </IconButton>
            )}
            {canDelete && (
              <IconButton
                className="card-action card-action--control card-action--delete"
                variant="outline"
                tone="danger"
                size="compact"
                aria-label={`${book.title}を削除`}
                disabled={actionsDisabled || !onDelete}
                onClick={(event) => onDelete?.(event.currentTarget)}
              >
                <Trash2 size={17} aria-hidden="true" />
              </IconButton>
            )}
            {extraActions}
          </div>
        )}
      </Thumbnail>
      <div className="book-card__body">
        <div className="book-card__title-row">
          <time className="book-card__uploaded-time" dateTime={book.uploadedTime}>
            <CalendarDays size={11} aria-hidden="true" />
            {formatDateTime(book.uploadedTime)}
          </time>
          <h3>
            {onOpen ? (
              <button type="button" className="book-card__title-button" disabled={openDisabled} onClick={(event) => onOpen(event.currentTarget)}>
                {book.title}
              </button>
            ) : viewerUrl ? (
              <InternalLink href={viewerUrl}>{book.title}</InternalLink>
            ) : (
              book.title
            )}
          </h3>
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
          {book.tags.length > 0 && (
            <Button
              ref={tagsTriggerRef}
              className={`tag-overflow tag-overflow--control ${hiddenTagCount === 0 ? 'tag-overflow--all-inline' : ''}`}
              variant="ghost"
              tone="accent"
              size="compact"
              aria-label={isDownloaded && onTagOverflowDetails
                ? `${book.title}の詳細情報を表示`
                : `${book.title}の全${book.tags.length}件のタグを表示`}
              onClick={(event) => handleTagOverflowClick(event.currentTarget)}
            >
              <span className="tag-overflow__regular">+{hiddenTagCount}</span>
              <span className="tag-overflow__narrow">+{book.tags.length}</span>
            </Button>
          )}
        </div>
        {footer !== undefined && footer !== null && <div className="book-card__extra">{footer}</div>}
      </div>
      <Dialog
        ref={dialogRef}
        className="tags-dialog"
        open={tagsOpen}
        aria-labelledby={tagsDialogTitleId}
        initialFocusRef={tagsCloseButtonRef}
        resolveRestoreFocus={() => tagsTriggerRef.current}
        onRequestClose={() => {
          setTagsOpen(false)
          return true
        }}
      >
        {({ requestClose }) => tagsOpen ? (
          <div className="tags-dialog__panel">
            <DialogHeader className="tags-dialog__header">
              <div>
                <h2 id={tagsDialogTitleId}>{book.title}</h2>
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
                  <section className="tags-dialog__group" key={type} aria-labelledby={`tags-${tagsId}-${type}`}>
                    <div className="tags-dialog__group-heading">
                      <h3 id={`tags-${tagsId}-${type}`}>{TAG_TYPE_LABELS[type]}</h3>
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
        ) : null}
      </Dialog>
    </article>
  )
}
