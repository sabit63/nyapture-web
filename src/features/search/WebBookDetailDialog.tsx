import { Download, ExternalLink, LoaderCircle, X } from 'lucide-react'
import { useCallback, useRef } from 'react'

import { requestBlob } from '../../api'
import { TagChip } from '../../components/TagChip'
import { Thumbnail } from '../../components/Thumbnail'
import { Button, Dialog, DialogBody, DialogFooter, DialogHeader, IconButton } from '../../components/ui'
import { TAG_TYPE_LABELS, TAG_TYPE_ORDER } from '../../models'
import type { BookTag } from '../../models'
import type { SearchController } from './useSearchController'
import './web-book-detail-dialog.css'

export type WebBookDetailDialogProps = {
  controller: SearchController
}

const safeUrl = (value: string | undefined) => {
  if (!value) return undefined
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : undefined
  } catch {
    return undefined
  }
}

export function WebBookDetailDialog({ controller }: WebBookDetailDialogProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const book = controller.webDetailBook
  const thumbnailRequest = book?.thumbnailRequest
  const loadThumbnail = useCallback((signal: AbortSignal) => {
    if (!thumbnailRequest) return Promise.reject(new Error('Thumbnail request is unavailable'))
    return requestBlob(thumbnailRequest.path, {
      query: thumbnailRequest.query,
      headers: { Accept: 'image/*' },
      signal,
    })
  }, [thumbnailRequest])
  const sourceUrl = safeUrl(book?.url)
  const canDownload = Boolean(book)
    && book?.status !== 'Downloaded'
    && book?.status !== 'Downloading'
    && book?.status !== 'Standby'
    && book?.status !== 'Shredding'
    && !controller.webDetailLoading
  const tagsByType = TAG_TYPE_ORDER.map((type) => ({
    type,
    tags: (book?.tags ?? []).filter((tag) => tag.type === type),
  })).filter(({ tags }) => tags.length > 0)
  const handleTagSearch = (tag: BookTag) => {
    controller.requestWebDetailClose('programmatic')
    controller.searchByTag(tag)
  }

  return (
    <Dialog
      ref={controller.webDetailDialogRef}
      id="web-book-detail-dialog"
      className="web-book-detail-dialog"
      open={controller.webDetailDialogOpen}
      onRequestClose={controller.requestWebDetailClose}
      onAfterClose={controller.afterWebDetailClose}
      resolveRestoreFocus={controller.resolveWebDetailRestoreFocus}
      initialFocusRef={closeButtonRef}
      aria-labelledby="web-book-detail-title"
    >
      {({ requestClose }) => book && (
        <div className="web-book-detail-dialog__panel">
          <DialogHeader className="web-book-detail-dialog__header">
            <div>
              <h2 id="web-book-detail-title">{book.title}</h2>
            </div>
            <IconButton
              ref={closeButtonRef}
              size="default"
              type="button"
              aria-label="Web候補の詳細を閉じる"
              onClick={() => requestClose('close-button')}
            >
              <X size={19} aria-hidden="true" />
            </IconButton>
          </DialogHeader>

          <DialogBody className="web-book-detail-dialog__body">
            <div className="web-book-detail-dialog__summary">
              <div className="web-book-detail-dialog__cover">
                <Thumbnail
                  src={book.thumbnailUrl}
                  load={thumbnailRequest ? loadThumbnail : undefined}
                  reloadKey={book.thumbnailReloadKey}
                  loadingPolicy={{ mode: 'page', viewports: 3 }}
                  alt={`${book.title}の表紙`}
                  fallbackText={book.thumbnailUrl || thumbnailRequest ? '画像を読み込めませんでした' : 'サムネイルはありません'}
                  fallbackAriaLabel={`${book.title}の表紙を表示できません`}
                  variant={book.cover}
                />
              </div>
              <dl className="web-book-detail-dialog__meta">
                <div>
                  <dt>ページ数</dt>
                  <dd>{book.totalPage > 0 ? `${book.totalPage}ページ` : '—'}</dd>
                </div>
                <div>
                  <dt>配信元</dt>
                  <dd>
                    {sourceUrl
                      ? <a href={sourceUrl} target="_blank" rel="noopener noreferrer">{book.sourceLabel ?? sourceUrl}<ExternalLink size={13} aria-hidden="true" /></a>
                      : book.sourceLabel ?? '—'}
                  </dd>
                </div>
              </dl>
            </div>

            {controller.webDetailLoading && (
              <p className="web-book-detail-dialog__status" role="status" aria-live="polite">
                <LoaderCircle className="web-book-detail-dialog__spinner" size={16} aria-hidden="true" />
                取得中…
              </p>
            )}
            {controller.webDetailError && (
              <p className="web-book-detail-dialog__error" role="alert">
                詳細を更新できませんでした
              </p>
            )}

            {tagsByType.length > 0 && (
              <div className="web-book-detail-dialog__tags" aria-label="すべてのタグ">
                <h3>タグ</h3>
                {tagsByType.map(({ type, tags }) => (
                  <section key={type} className="web-book-detail-dialog__tag-group" aria-labelledby={`web-book-detail-${type}`}>
                    <h4 id={`web-book-detail-${type}`}>{TAG_TYPE_LABELS[type]}</h4>
                    <div>
                      {tags.map((tag: BookTag) => (
                        <TagChip
                          key={`${tag.type}:${tag.name}`}
                          tag={tag}
                          size="default"
                          title={tag.displayName && tag.displayName !== tag.name ? tag.name : undefined}
                          onClick={() => handleTagSearch(tag)}
                          onSearchDestinationRequest={controller.openTagSearchDestination}
                        />
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            )}
          </DialogBody>

          <DialogFooter className="web-book-detail-dialog__footer">
            <Button
              variant="solid"
              tone="accent"
              type="button"
              disabled={!canDownload}
              onClick={() => { if (book) void controller.downloadWebBook(book) }}
            >
              <Download size={16} aria-hidden="true" />
              {book.status === 'Standby' ? '待機中' : book.status === 'Downloading' ? 'ダウンロード中…' : book.status === 'Downloaded' ? 'ダウンロード済み' : 'ダウンロード'}
            </Button>
          </DialogFooter>
        </div>
      )}
    </Dialog>
  )
}
