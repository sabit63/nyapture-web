import { LoaderCircle, Trash2, X } from 'lucide-react'
import type { RefObject } from 'react'

import type { ApiBookCardModel } from '../../api'
import { Thumbnail } from '../../components/Thumbnail'
import {
  Dialog,
  DialogBody,
  DialogFooter,
  DialogHeader,
  IconButton,
  type CloseReason,
  type NativeDialogControls,
} from '../../components/ui'
import { getBookIdentityKey } from './book-deletion'

export type LibraryDeleteDialogProps = {
  dialogRef: RefObject<HTMLDialogElement | null>
  open: boolean
  books: ApiBookCardModel[]
  pending: boolean
  error: string
  thumbnailRequest?: ApiBookCardModel['thumbnailRequest']
  loadThumbnail?: (signal: AbortSignal) => Promise<Blob>
  onRequestClose: (reason: CloseReason) => boolean
  onAfterClose: (reason: CloseReason) => void
  resolveRestoreFocus: (reason: CloseReason) => HTMLElement | null
  onConfirm: (requestClose: NativeDialogControls['requestClose']) => void | Promise<void>
}

export function LibraryDeleteDialog({
  dialogRef,
  open,
  books,
  pending,
  error,
  thumbnailRequest,
  loadThumbnail,
  onRequestClose,
  onAfterClose,
  resolveRestoreFocus,
  onConfirm,
}: LibraryDeleteDialogProps) {
  const deleteDialogBook = books.length === 1 ? books[0] : undefined

  return (
    <Dialog
      ref={dialogRef}
      id="library-delete-dialog"
      className="delete-dialog"
      open={open}
      onRequestClose={onRequestClose}
      onAfterClose={onAfterClose}
      resolveRestoreFocus={resolveRestoreFocus}
      aria-labelledby="delete-dialog-title"
    >
      {({ requestClose }) => (
        <div className="delete-dialog__panel">
          <DialogHeader className="delete-dialog__header">
            <div>
              <span>削除</span>
              <h2 id="delete-dialog-title">{deleteDialogBook?.title ?? '削除の確認'}</h2>
            </div>
            <IconButton
              size="default"
              type="button"
              aria-label="削除をキャンセル"
              title="削除をキャンセル"
              disabled={pending}
              onClick={() => requestClose('close-button')}
            >
              <X size={19} aria-hidden="true" />
            </IconButton>
          </DialogHeader>

          <DialogBody className="delete-dialog__body">
            {pending && <p className="sr-only" role="status" aria-live="polite">削除しています。完了までお待ちください。</p>}
            {deleteDialogBook ? (
              <div className="delete-dialog__single">
                <Thumbnail
                  className="delete-dialog__thumbnail"
                  src={deleteDialogBook.thumbnailUrl}
                  load={thumbnailRequest ? loadThumbnail : undefined}
                  alt={`${deleteDialogBook.title}の表紙`}
                  fallbackText={deleteDialogBook.thumbnailUrl || thumbnailRequest ? '画像を読み込めませんでした' : 'サムネイルはありません'}
                  fallbackAriaLabel={`${deleteDialogBook.title}のサムネイルを表示できません`}
                  variant={deleteDialogBook.cover}
                />
              </div>
            ) : (
              <ul className="delete-dialog__title-list">
                {books.map((book) => <li key={getBookIdentityKey(book)}>{book.title}</li>)}
              </ul>
            )}
            {error && <p className="delete-dialog__error" role="alert">{error}</p>}
          </DialogBody>

          <DialogFooter className="delete-dialog__footer">
            <IconButton
              className="delete-dialog__action delete-dialog__action--confirm"
              variant="ghost"
              tone="danger"
              size="default"
              type="button"
              aria-label={pending ? '削除中' : '削除を実行'}
              title={pending ? '削除中' : '削除を実行'}
              disabled={pending}
              onClick={() => { void onConfirm(requestClose) }}
            >
              {pending
                ? <LoaderCircle className="delete-dialog__spinner" size={19} aria-hidden="true" />
                : <Trash2 size={19} aria-hidden="true" />}
            </IconButton>
          </DialogFooter>
        </div>
      )}
    </Dialog>
  )
}
