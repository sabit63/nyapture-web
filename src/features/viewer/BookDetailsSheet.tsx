import { LoaderCircle, Pencil, Plus, RefreshCw, Save, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { BookViewerPageProps } from './BookViewerPage'
import { getTagLabel, TAG_TYPE_LABELS, TAG_TYPE_ORDER } from '../../models'
import type { BookTag, NyaTagType } from '../../models'
import { BookStatusBadge } from '../../components/BookStatusBadge'
import { TagChip } from '../../components/TagChip'
import { Button, IconButton } from '../../components/ui'
import { BookTagEditor } from './BookTagEditor'
import { useBookTagEditor } from './use-book-tag-editor'
import { BookTitleEditDialog } from './BookTitleEditDialog'
import './book-viewer.css'

const formatUploadDate = (uploadedTime: string) => {
  const date = new Date(uploadedTime)
  if (Number.isNaN(date.getTime())) return '不明'

  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)
  const getPart = (type: string) => parts.find((part) => part.type === type)?.value
  const year = getPart('year')
  const month = getPart('month')
  const day = getPart('day')
  const hour = getPart('hour')
  const minute = getPart('minute')
  const second = getPart('second')

  if (!year || !month || !day || !hour || !minute || !second) return '不明'
  return `${year}/${month}/${day} ${hour}:${minute}:${second} JST`
}

const groupBookTags = (tags: BookTag[]) => {
  const tagsByType = new Map<NyaTagType, BookTag[]>()
  tags.forEach((tag) => {
    const group = tagsByType.get(tag.type)
    if (group) group.push(tag)
    else tagsByType.set(tag.type, [tag])
  })

  return TAG_TYPE_ORDER
    .map((type) => ({ type, tags: tagsByType.get(type) ?? [] }))
    .filter((group) => group.tags.length > 0)
}

const getTagChipTitle = (tag: BookTag) => {
  const label = getTagLabel(tag)
  return label === tag.name ? tag.name : `${tag.name} / ${label}`
}

type Props = Pick<BookViewerPageProps, 'onBookChange' | 'onTitleChange' | 'onTagSearch' | 'onTagSearchDestinationRequest' | 'detailsOpen' | 'onDetailsOpenChange' | 'detailsTriggerRef'> & { book: NonNullable<BookViewerPageProps['book']>; totalPages: number }

export function BookDetailsSheet({ book, totalPages, onBookChange, onTitleChange, onTagSearch, onTagSearchDestinationRequest, detailsOpen, onDetailsOpenChange, detailsTriggerRef }: Props) {
  const editor = useBookTagEditor(book, onBookChange)
  const [confirmClose, setConfirmClose] = useState(false)
  const sourceLabel = book.sourceLabel?.trim() || undefined
  const tagGroups = useMemo(() => groupBookTags(book.tags), [book.tags])
  const [titleEditOpen, setTitleEditOpen] = useState(false)
  const titleEditTriggerRef = useRef<HTMLButtonElement>(null)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const detailsPanelRef = useRef<HTMLDivElement>(null)
  const pointerStartedOutsideRef = useRef(false)
  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return

    if (detailsOpen) {
      // showModal's native autofocus can scroll the document before our focus
      // handler runs. Keep the reader position, then focus without scrolling.
      const scrollPosition = { left: window.scrollX, top: window.scrollY }
      if (!dialog.open) {
        if (typeof dialog.showModal === 'function') dialog.showModal()
        else dialog.setAttribute('open', '')
      }
      window.scrollTo({ ...scrollPosition, behavior: 'instant' })
      const frame = window.requestAnimationFrame(() => {
        dialog.querySelector<HTMLElement>('[data-details-initial-focus]')?.focus({ preventScroll: true })
      })
      return () => window.cancelAnimationFrame(frame)
    } else if (dialog.open) {
      dialog.close()
    }
  }, [detailsOpen])

  const dismissDetails = () => {
    editor.finish()
    setConfirmClose(false)
    setTitleEditOpen(false)
    const dialog = dialogRef.current
    if (dialog?.open) dialog.close()
    else onDetailsOpenChange(false)
  }

  const closeDetails = () => {
    if (editor.pending) return
    if (editor.editing && editor.hasUnsavedChanges) {
      setConfirmClose(true)
      window.requestAnimationFrame(() => document.getElementById('book-tag-continue-edit')?.focus({ preventScroll: true }))
      return
    }
    dismissDetails()
  }

  const resumeEditing = () => {
    setConfirmClose(false)
    window.requestAnimationFrame(() => {
      dialogRef.current?.querySelector<HTMLElement>('.book-viewer__tag-editor input:not(:disabled), .book-viewer__tag-editor button:not(:disabled), .book-viewer__tag-editor select:not(:disabled)')?.focus({ preventScroll: true })
    })
  }

  const openTitleEdit = useCallback(() => {
    setTitleEditOpen(true)
  }, [])

  const handleDetailsKeyDown = (event: ReactKeyboardEvent<HTMLDialogElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      if (confirmClose) resumeEditing()
      else closeDetails()
      return
    }
    if (event.key !== 'Tab') return

    const dialog = dialogRef.current
    if (!dialog) return
    const focusableElements = Array.from(dialog.querySelectorAll<HTMLElement>(
      'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
    ))
    if (focusableElements.length === 0) return
    const first = focusableElements[0]
    const last = focusableElements[focusableElements.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus({ preventScroll: true })
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus({ preventScroll: true })
    }
  }

  return <>
      <dialog
        ref={dialogRef}
        id="book-viewer-details"
        className="book-viewer__details-dialog"
        aria-labelledby="book-viewer-details-title"
        onCancel={(event) => {
          event.preventDefault()
          closeDetails()
        }}
        onKeyDown={handleDetailsKeyDown}
        onPointerDown={(event) => {
          const panel = detailsPanelRef.current
          if (!panel) return
          const rect = panel.getBoundingClientRect()
          pointerStartedOutsideRef.current = event.clientX < rect.left
            || event.clientX > rect.right
            || event.clientY < rect.top
            || event.clientY > rect.bottom
        }}
        onPointerCancel={() => { pointerStartedOutsideRef.current = false }}
        onClick={(event) => {
          if (event.target === event.currentTarget && pointerStartedOutsideRef.current) closeDetails()
          pointerStartedOutsideRef.current = false
        }}
        onClose={() => {
          onDetailsOpenChange(false)
          window.requestAnimationFrame(() => detailsTriggerRef.current?.focus({ preventScroll: true }))
        }}
      >
        <div ref={detailsPanelRef} className="book-viewer__details-panel">
          <header className="book-viewer__details-header">
            <div className="book-viewer__details-title">
              <h2 id="book-viewer-details-title">{book.title}</h2>
            </div>
            <div className="book-viewer__details-actions">
              <IconButton
                ref={titleEditTriggerRef}
                size="default"
                type="button"
                aria-label="タイトルを編集"
                title="タイトルを編集"
                onClick={openTitleEdit}
                disabled={editor.editing}
              >
                <Pencil size={18} aria-hidden="true" />
              </IconButton>
              <IconButton
                size="default"
                type="button"
                data-details-initial-focus
                aria-label="画像情報を閉じる"
                disabled={editor.pending}
                onClick={closeDetails}
              >
                <X size={19} aria-hidden="true" />
              </IconButton>
            </div>
          </header>

          <div className="book-viewer__details-body">
            <div className="book-viewer__details-meta" aria-label="Bookのメタデータ">
              <div className="book-viewer__details-meta-group book-viewer__details-meta-group--left">
                {sourceLabel && <span className="book-viewer__meta-chip book-viewer__meta-chip--source">{sourceLabel}</span>}
                <BookStatusBadge status={book.status} variant="inline" />
              </div>
              <div className="book-viewer__details-meta-group book-viewer__details-meta-group--right">
                <span className="book-viewer__meta-chip book-viewer__meta-chip--page">Page: {totalPages}</span>
                <time className="book-viewer__meta-chip book-viewer__meta-chip--date" dateTime={book.uploadedTime}>
                  {formatUploadDate(book.uploadedTime)}
                </time>
              </div>
            </div>

            <div className="book-viewer__tag-toolbar">
              <h3>{editor.editing ? 'タグを編集' : 'タグ情報'}</h3>
              {editor.editing && <IconButton ref={editor.addTriggerRef} aria-label={editor.activeType ? 'タグの追加欄を閉じる' : 'タグを追加'} title={editor.activeType ? 'タグの追加欄を閉じる' : 'タグを追加'} disabled={editor.pending} onClick={() => editor.activeType ? editor.closeAdd() : editor.openAdd()}>
                {editor.activeType ? <X size={18} aria-hidden="true" /> : <Plus size={18} aria-hidden="true" />}
              </IconButton>}
              {!editor.editing && <IconButton ref={editor.editTriggerRef} aria-label="タグを編集" title="タグを編集" onClick={editor.begin}>
                <Pencil size={18} aria-hidden="true" />
              </IconButton>}
            </div>
            {editor.editing ? <BookTagEditor editor={editor} /> : <div className="book-viewer__tag-groups">
              {tagGroups.map(({ type, tags }) => (
                <section className="book-viewer__tag-group" key={type} aria-labelledby={`book-viewer-tag-group-${type}`}>
                  <div className="book-viewer__tag-group-heading">
                    <h3 id={`book-viewer-tag-group-${type}`}>{TAG_TYPE_LABELS[type]}</h3>
                    <span>{tags.length}</span>
                  </div>
                  <div className="book-viewer__tag-chips">
                    {tags.map((tag) => (
                      <TagChip
                        key={`${tag.type}:${tag.name}:${tag.displayName ?? ''}`}
                        tag={tag}
                        size="default"
                        title={getTagChipTitle(tag)}
                        onSearchDestinationRequest={onTagSearchDestinationRequest}
                        onClick={() => {
                          closeDetails()
                          onTagSearch(tag)
                        }}
                      />
                    ))}
                  </div>
                </section>
              ))}
            </div>}
          </div>
          {editor.editing && <footer className="book-viewer__tag-footer" aria-busy={editor.pending}>
            {confirmClose ? <>
              <p role="alert">未保存のタグ変更を破棄して閉じますか？</p>
              <div className="book-viewer__tag-footer-actions">
                <Button id="book-tag-continue-edit" onClick={resumeEditing}>編集を続ける</Button>
                <Button variant="outline" tone="danger" onClick={dismissDetails}>破棄して閉じる</Button>
              </div>
            </> : <>
              {editor.error && <p className="book-viewer__tag-error" role="alert">{editor.error}</p>}
              {editor.input.trim() && <p>入力中のタグを追加するか、追加欄を閉じてから保存してください。</p>}
              <div className="book-viewer__tag-footer-actions">
                <IconButton variant="outline" tone="neutral" aria-label="キャンセル" title="キャンセル" disabled={editor.pending} onClick={editor.finish}>
                  <X size={18} aria-hidden="true" />
                </IconButton>
                <IconButton ref={editor.saveButtonRef} aria-label={editor.pending ? '処理中…' : editor.needsRefresh ? '状態を再確認' : '保存'} title={editor.pending ? '処理中…' : editor.needsRefresh ? '状態を再確認' : '保存'} variant="solid" tone="accent" disabled={editor.pending || Boolean(editor.input.trim()) || (!editor.dirty && !editor.needsRefresh)} onClick={() => void editor.save()}>
                  {editor.pending ? <LoaderCircle size={18} className="book-viewer__title-edit-spinner" aria-hidden="true" />
                    : editor.needsRefresh ? <RefreshCw size={18} aria-hidden="true" />
                      : <Save size={18} aria-hidden="true" />}
                </IconButton>
              </div>
            </>}
          </footer>}
        </div>
      </dialog>

      <BookTitleEditDialog
        open={titleEditOpen}
        groupId={book.groupId}
        bookId={book.bookId}
        title={book.title}
        triggerRef={titleEditTriggerRef}
        onTitleChange={onTitleChange}
        onDismiss={() => setTitleEditOpen(false)}
      />
  </>
}
