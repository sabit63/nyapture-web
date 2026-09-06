import { Check, ChevronDown, ExternalLink, Globe2, LoaderCircle, Save, Search, X } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent } from 'react'

import {
  ApiError,
  getErrorMessage,
  getTagAdditionalName,
  upsertTagAdditionalNames,
} from '../../api'
import { InternalLink } from '../../app/client-router'
import { getTagLabel, TAG_TYPE_LABELS } from '../../models'
import {
  Button,
  Dialog,
  DialogBody,
  DialogHeader,
  IconButton,
  buttonClassName,
} from '../../components/ui'
import type { SearchController } from './useSearchController'

export type TagSearchDestinationDialogProps = {
  controller: SearchController
}

export function TagSearchDestinationDialog({ controller }: TagSearchDestinationDialogProps) {
  const primaryActionRef = useRef<HTMLAnchorElement>(null)
  const saveControllerRef = useRef<AbortController | null>(null)
  const [displayName, setDisplayName] = useState('')
  const [approved, setApproved] = useState(false)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [validationError, setValidationError] = useState('')
  const [requestError, setRequestError] = useState('')
  const [savedMessage, setSavedMessage] = useState('')
  const selection = controller.tagSearchDestinationSelection
  const selectionRef = useRef(selection)
  selectionRef.current = selection
  const tagLabel = selection ? getTagLabel(selection.tag) : ''
  const tagTypeLabel = selection ? TAG_TYPE_LABELS[selection.tag.type] : ''
  const selectionType = selection?.tag.type
  const selectionName = selection?.tag.name

  useEffect(() => {
    if (!controller.tagSearchDestinationDialogOpen || !selectionType || !selectionName) return

    const requestController = new AbortController()
    const fallbackDisplayName = selectionRef.current?.tag.displayName?.trim() ?? ''
    setDisplayName(fallbackDisplayName)
    setApproved(Boolean(fallbackDisplayName))
    setLoading(true)
    setSaving(false)
    setValidationError('')
    setRequestError('')
    setSavedMessage('')

    getTagAdditionalName(selectionType, selectionName, requestController.signal)
      .then((record) => {
        if (requestController.signal.aborted) return
        setDisplayName(record.primaryAdditionalName?.trim() || fallbackDisplayName)
        setApproved(record.status === 'Approved')
      })
      .catch((error: unknown) => {
        if (requestController.signal.aborted) return
        if (error instanceof ApiError && error.status === 404) return
        setRequestError(`表示名を取得できませんでした: ${getErrorMessage(error)}`)
      })
      .finally(() => {
        if (!requestController.signal.aborted) setLoading(false)
      })

    return () => {
      requestController.abort()
      saveControllerRef.current?.abort()
      saveControllerRef.current = null
    }
  }, [controller.tagSearchDestinationDialogOpen, selectionName, selectionType])

  const saveDisplayName = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!selection || loading || saving) return

    const nextDisplayName = displayName.trim()
    if (!nextDisplayName) {
      setValidationError('表示名を入力してください。')
      setSavedMessage('')
      return
    }

    const requestController = new AbortController()
    saveControllerRef.current?.abort()
    saveControllerRef.current = requestController
    setSaving(true)
    setValidationError('')
    setRequestError('')
    setSavedMessage('')

    try {
      await upsertTagAdditionalNames([{
        name: selection.tag.name,
        tagType: selection.tag.type,
        primaryAdditionalName: nextDisplayName,
        status: approved ? 'Approved' : 'Pending',
        source: 'Manual',
      }], requestController.signal)
      if (requestController.signal.aborted) return
      setDisplayName(nextDisplayName)
      controller.applyTagDisplayName(selection.tag, approved ? nextDisplayName : undefined)
      setSavedMessage('保存しました')
    } catch (error) {
      if (!requestController.signal.aborted) {
        setRequestError(`表示名を保存できませんでした: ${getErrorMessage(error)}`)
      }
    } finally {
      if (saveControllerRef.current === requestController) saveControllerRef.current = null
      if (!requestController.signal.aborted) setSaving(false)
    }
  }

  return (
    <Dialog
      ref={controller.tagSearchDestinationDialogRef}
      id="tag-search-destination-dialog"
      className="tag-search-destination-dialog"
      open={controller.tagSearchDestinationDialogOpen}
      initialFocusRef={primaryActionRef}
      onRequestClose={controller.requestTagSearchDestinationClose}
      onAfterClose={controller.afterTagSearchDestinationClose}
      resolveRestoreFocus={controller.resolveTagSearchDestinationRestoreFocus}
      aria-labelledby="tag-search-destination-title"
    >
      {({ requestClose }) => selection && (
        <div className="tag-search-destination-dialog__panel">
          <DialogHeader className="tag-search-destination-dialog__header">
            <div>
              <span>{tagTypeLabel}</span>
              <h2 id="tag-search-destination-title">{tagLabel}</h2>
            </div>
            <IconButton
              variant="ghost"
              tone="neutral"
              aria-label="タグ操作を閉じる"
              onClick={() => requestClose('close-button')}
            >
              <X size={19} aria-hidden="true" />
            </IconButton>
          </DialogHeader>

          <DialogBody className="tag-search-destination-dialog__body">
            <div className="tag-search-destination-dialog__actions">
              <InternalLink
                ref={primaryActionRef}
                className={buttonClassName({ variant: 'outline', tone: 'neutral', size: 'compact' }, 'tag-search-destination-dialog__action')}
                href={selection.libraryUrl}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`「${tagLabel}」を通常検索で新しいタブに開く`}
                onClick={() => requestClose('submit')}
              >
                <Search aria-hidden="true" />
                <span>
                  <strong>通常検索</strong>
                </span>
                <ExternalLink aria-hidden="true" />
              </InternalLink>
              <InternalLink
                className={buttonClassName({ variant: 'outline', tone: 'accent', size: 'compact' }, 'tag-search-destination-dialog__action')}
                href={selection.hitomiUrl}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`「${tagLabel}」をHitomi検索で新しいタブに開く`}
                onClick={() => requestClose('submit')}
              >
                <Globe2 aria-hidden="true" />
                <span>
                  <strong>Hitomi検索</strong>
                </span>
                <ExternalLink aria-hidden="true" />
              </InternalLink>
            </div>

            <details
              key={`${selection.tag.type}:${selection.tag.name}:${controller.tagSearchDestinationDialogOpen}`}
              className="tag-display-name-section"
            >
              <summary>
                <span>表示名</span>
                <ChevronDown size={17} aria-hidden="true" />
              </summary>
              <form className="tag-display-name-editor" onSubmit={(event) => void saveDisplayName(event)}>
                <label className="tag-display-name-editor__field" htmlFor="tag-display-name-input">
                  <span>{selection.tag.name}</span>
                  <input
                    id="tag-display-name-input"
                    type="text"
                    value={displayName}
                    disabled={loading || saving}
                    aria-invalid={Boolean(validationError)}
                    aria-describedby={validationError ? 'tag-display-name-validation' : undefined}
                    onChange={(event) => {
                      setDisplayName(event.target.value)
                      setValidationError('')
                      setRequestError('')
                      setSavedMessage('')
                    }}
                  />
                </label>
                <div className="tag-display-name-editor__controls">
                  <Button
                    className={`tag-display-name-editor__approval${approved ? ' is-approved' : ''}`}
                    variant="outline"
                    tone={approved ? 'success' : 'neutral'}
                    size="compact"
                    type="button"
                    aria-pressed={approved}
                    disabled={loading || saving}
                    onClick={() => {
                      setApproved((current) => !current)
                      setRequestError('')
                      setSavedMessage('')
                    }}
                  >
                    <Check size={15} aria-hidden="true" />
                    {approved ? '承認済み' : '未承認'}
                  </Button>
                  <Button
                    className="tag-display-name-editor__save"
                    variant="solid"
                    tone="accent"
                    size="compact"
                    type="submit"
                    disabled={loading || saving || !displayName.trim()}
                    aria-busy={saving}
                  >
                    {saving
                      ? <LoaderCircle className="tag-display-name-editor__spinner" size={15} aria-hidden="true" />
                      : <Save size={15} aria-hidden="true" />}
                    保存
                  </Button>
                </div>
                {loading && <p className="tag-display-name-editor__status" role="status">表示名を読み込んでいます</p>}
                {saving && <p className="tag-display-name-editor__status" role="status">保存しています</p>}
                {validationError && <p id="tag-display-name-validation" className="tag-display-name-editor__error" role="alert">{validationError}</p>}
                {requestError && <p className="tag-display-name-editor__error" role="alert">{requestError}</p>}
                {savedMessage && <p className="tag-display-name-editor__success" role="status">{savedMessage}</p>}
              </form>
            </details>
          </DialogBody>
        </div>
      )}
    </Dialog>
  )
}
