import { LoaderCircle, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type FormEvent, type RefObject } from 'react'
import { ApiError, getErrorMessage, updateBookTitle } from '../../api'
import { Button, Dialog, DialogBody, DialogFooter, DialogHeader, IconButton } from '../../components/ui'

export function BookTitleEditDialog({
  open,
  groupId,
  bookId,
  title,
  triggerRef,
  onTitleChange,
  onDismiss,
}: {
  open: boolean
  groupId: string
  bookId: string
  title: string
  triggerRef: RefObject<HTMLButtonElement | null>
  onTitleChange: (groupId: string, bookId: string, title: string) => void
  onDismiss: () => void
}) {
  const [value, setValue] = useState(title)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const requestRef = useRef<AbortController | null>(null)

  useEffect(() => () => requestRef.current?.abort(), [groupId, bookId])

  useEffect(() => {
    if (!open) return
    setValue(title)
    setError('')
  }, [open, title])

  const requestClose = useCallback(() => {
    if (pending) return false
    onDismiss()
    return true
  }, [onDismiss, pending])

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (pending) return
    const nextTitle = value.trim()
    if (!nextTitle) {
      setError('タイトルを入力してください。')
      return
    }

    setPending(true)
    setError('')
    const controller = new AbortController()
    requestRef.current = controller
    try {
      const response = await updateBookTitle(groupId, bookId, nextTitle, controller.signal)
      if (controller.signal.aborted) return
      if (response.success === false) {
        throw new ApiError(response.message ?? 'タイトルの更新に失敗しました。', { category: 'server' })
      }
      onTitleChange(groupId, bookId, nextTitle)
      onDismiss()
    } catch (requestError: unknown) {
      if (!controller.signal.aborted) setError(getErrorMessage(requestError))
    } finally {
      if (requestRef.current === controller) requestRef.current = null
      if (!controller.signal.aborted) setPending(false)
    }
  }

  return (
    <Dialog
      className="book-viewer__title-edit-dialog"
      open={open}
      aria-labelledby="book-viewer-title-edit-title"
      initialFocusRef={inputRef}
      resolveRestoreFocus={() => triggerRef.current}
      dismissible={!pending}
      onRequestClose={requestClose}
    >
      {({ requestClose: requestDialogClose }) => (
        <form className="book-viewer__title-edit-panel" onSubmit={handleSubmit}>
          <DialogHeader className="book-viewer__title-edit-header">
            <h2 id="book-viewer-title-edit-title">タイトルを編集</h2>
            <IconButton
              type="button"
              aria-label="タイトル編集を閉じる"
              title="タイトル編集を閉じる"
              onClick={() => requestDialogClose('close-button')}
              disabled={pending}
            >
              <X size={19} aria-hidden="true" />
            </IconButton>
          </DialogHeader>
          <DialogBody className="book-viewer__title-edit-body">
            <label className="book-viewer__title-edit-field" htmlFor="book-viewer-title-edit-input">
              タイトル
              <input
                ref={inputRef}
                id="book-viewer-title-edit-input"
                value={value}
                onChange={(event) => {
                  setValue(event.target.value)
                  if (error) setError('')
                }}
                aria-invalid={error ? 'true' : undefined}
                aria-describedby={error ? 'book-viewer-title-edit-error' : undefined}
                disabled={pending}
              />
            </label>
            {error && <p id="book-viewer-title-edit-error" className="book-viewer__title-edit-error" role="alert">{error}</p>}
          </DialogBody>
          <DialogFooter className="book-viewer__title-edit-footer">
            <Button
              variant="outline"
              tone="neutral"
              type="button"
              onClick={() => requestDialogClose('close-button')}
              disabled={pending}
            >
              キャンセル
            </Button>
            <Button variant="solid" tone="accent" type="submit" disabled={pending}>
              {pending && <LoaderCircle className="book-viewer__title-edit-spinner" size={16} aria-hidden="true" />}
              保存
            </Button>
          </DialogFooter>
        </form>
      )}
    </Dialog>
  )
}
