import { useEffect, useRef, useState } from 'react'
import type { ApiBookCardModel } from '../../api'
import { getErrorMessage } from '../../api'
import type { BookCardModel, BookTag, NyaTagType } from '../../models'
import { TAG_TYPE_ORDER } from '../../models'
import { BookTagSaveError, fetchBookTagState, getBookTagChanges, normalizeDraftTags, saveBookTagChanges, tagKey } from './book-tag-editing'

export function useBookTagEditor(book: BookCardModel, onBookChange: (book: ApiBookCardModel) => void) {
  const [editing, setEditing] = useState(false)
  const [baseline, setBaseline] = useState<BookTag[]>([])
  const [draft, setDraft] = useState<BookTag[]>([])
  const [types, setTypes] = useState<NyaTagType[]>([])
  const [activeType, setActiveType] = useState<NyaTagType>()
  const [input, setInput] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [needsRefresh, setNeedsRefresh] = useState(false)
  const requestRef = useRef<AbortController | null>(null)
  const saveButtonRef = useRef<HTMLButtonElement>(null)
  const addInputRef = useRef<HTMLInputElement>(null)
  const addTriggerRef = useRef<HTMLButtonElement>(null)
  const editTriggerRef = useRef<HTMLButtonElement>(null)

  useEffect(() => () => requestRef.current?.abort(), [book.groupId, book.bookId])

  const begin = () => {
    setBaseline(normalizeDraftTags(book.tags))
    setDraft(normalizeDraftTags(book.tags))
    setTypes(TAG_TYPE_ORDER.filter((type) => book.tags.some((tag) => tag.type === type)))
    setActiveType(undefined)
    setInput('')
    setError(needsRefresh ? '現在のタグを確認できていません。「状態を再確認」してから保存してください。' : '')
    setEditing(true)
  }
  const finish = () => {
    if (requestRef.current) return
    setEditing(false)
    setInput('')
    setActiveType(undefined)
    setError('')
    window.requestAnimationFrame(() => editTriggerRef.current?.focus({ preventScroll: true }))
  }
  const openAdd = (type: NyaTagType = 'Tags') => {
    setActiveType(type)
    setInput('')
    window.requestAnimationFrame(() => addInputRef.current?.focus())
  }
  const add = (tag: BookTag) => {
    const normalized = normalizeDraftTags([tag])[0]
    if (!normalized) return
    setTypes((current) => TAG_TYPE_ORDER.filter((type) => type === normalized.type || current.includes(type)))
    setDraft((current) => normalizeDraftTags([...current, normalized]))
    setInput('')
  }
  const remove = (tag: BookTag) => setDraft((current) => current.filter((item) => tagKey(item) !== tagKey(tag)))
  const dirty = getBookTagChanges(baseline, draft).length > 0

  const save = async () => {
    if (requestRef.current || input.trim()) return
    const controller = new AbortController()
    requestRef.current = controller
    setPending(true)
    setError('')
    try {
      // An unknown server state must be read before any more mutations.
      if (needsRefresh) {
        const latest = await fetchBookTagState(book.groupId, book.bookId, controller.signal)
        if (controller.signal.aborted) return
        setBaseline(latest.tags)
        onBookChange(latest)
        setNeedsRefresh(false)
        return
      }
      const latest = await saveBookTagChanges(book.groupId, book.bookId, baseline, draft, controller.signal)
      if (controller.signal.aborted) return
      onBookChange(latest)
      setBaseline(latest.tags)
      setDraft(latest.tags)
      requestRef.current = null
      finish()
    } catch (requestError) {
      if (controller.signal.aborted) return
      const latest = requestError instanceof BookTagSaveError ? requestError.latestBook : undefined
      if (latest) {
        setBaseline(latest.tags)
        onBookChange(latest)
        setNeedsRefresh(false)
      } else {
        setNeedsRefresh(true)
      }
      setError(`${getErrorMessage(requestError instanceof BookTagSaveError ? requestError.cause : requestError)} ${latest
        ? '編集内容を保持しています。一部の変更は反映済みの場合があります。保存で未反映分を再試行できます。'
        : '現在のタグを確認できません。「状態を再確認」してから保存してください。'}`)
      window.requestAnimationFrame(() => saveButtonRef.current?.focus({ preventScroll: true }))
    } finally {
      if (requestRef.current === controller) requestRef.current = null
      if (!controller.signal.aborted) setPending(false)
    }
  }

  return {
    editing, draft, types, activeType, input, pending, error, needsRefresh, dirty,
    hasUnsavedChanges: dirty || Boolean(input.trim()),
    editTriggerRef, addTriggerRef, addInputRef, saveButtonRef, setActiveType, begin, finish, openAdd, add, remove, setInput, save,
    closeAdd: () => { setActiveType(undefined); setInput('') },
  }
}

export type BookTagEditorState = ReturnType<typeof useBookTagEditor>
