import { Plus } from 'lucide-react'
import { useEffect, useId, useState } from 'react'
import { autocompleteTags } from '../../api'
import type { BookTag } from '../../models'
import { getTagLabel, TAG_TYPE_LABELS, TAG_TYPE_ORDER } from '../../models'
import { TagChip } from '../../components/TagChip'
import { Button, IconButton } from '../../components/ui'
import { normalizeDraftTags, tagKey } from './book-tag-editing'
import type { BookTagEditorState } from './use-book-tag-editor'

export function BookTagEditor({ editor }: { editor: BookTagEditorState }) {
  const { draft, types, activeType, input, pending } = editor
  const [suggestions, setSuggestions] = useState<BookTag[]>([])
  const [loading, setLoading] = useState(false)
  const [searchError, setSearchError] = useState(false)
  const [highlight, setHighlight] = useState(-1)
  const inputRef = editor.addInputRef
  const id = useId()
  const query = input.trim()
  const selectedKeys = new Set(draft.map(tagKey))
  const candidates = suggestions.filter((tag) => tag.type === activeType && !selectedKeys.has(tagKey(tag)))
  const duplicate = activeType !== undefined && selectedKeys.has(tagKey({ type: activeType, name: query }))
  const canCreate = Boolean(query && activeType && !duplicate && !suggestions.some((tag) => tag.type === activeType && tag.name === query))
  const options = [...candidates, ...(canCreate && activeType ? [{ type: activeType, name: query }] : [])]

  useEffect(() => {
    if (activeType) inputRef.current?.focus()
    else editor.addTriggerRef.current?.focus({ preventScroll: true })
  }, [activeType, editor.addTriggerRef, inputRef])

  useEffect(() => {
    setSuggestions([])
    setHighlight(-1)
    setSearchError(false)
    if (!query || !activeType || pending) { setLoading(false); return }
    const controller = new AbortController()
    setLoading(true)
    const timer = window.setTimeout(() => {
      autocompleteTags(query, activeType, controller.signal).then((response) => {
        if (controller.signal.aborted) return
        if (response.success === false) throw new Error(response.message)
        setSuggestions(normalizeDraftTags((response.tags ?? []).flatMap((tag) =>
          tag.name && tag.tagType === activeType
            ? [{ type: activeType, name: tag.name, displayName: tag.displayName, count: tag.count }]
            : [])))
      }).catch(() => {
        if (!controller.signal.aborted) setSearchError(true)
      }).finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    }, 200)
    return () => { window.clearTimeout(timer); controller.abort() }
  }, [query, activeType, pending])

  useEffect(() => {
    if (highlight >= 0) document.getElementById(`${id}-option-${highlight}`)?.scrollIntoView({ block: 'nearest' })
  }, [highlight, id])

  const choose = (tag: BookTag) => {
    if (pending) return
    editor.add(tag)
    setSuggestions([])
    setHighlight(-1)
    inputRef.current?.focus({ preventScroll: true })
  }

  return <fieldset className="book-viewer__tag-editor" disabled={pending} aria-label="ブックのタグを編集">
    {activeType !== undefined && <div className="book-viewer__tag-add advanced-dialog__field">
      <div className="advanced-tag-picker">
        <select aria-label="タグの種類" value={activeType} onChange={(event) => {
          const type = TAG_TYPE_ORDER.find((item) => item === event.target.value)
          if (type) { setSuggestions([]); setHighlight(-1); editor.setActiveType(type) }
        }}>
          {TAG_TYPE_ORDER.map((type) => <option key={type} value={type}>{TAG_TYPE_LABELS[type]}</option>)}
        </select>
        <div className="advanced-tag-combobox">
        <input id={`${id}-input`} ref={inputRef} value={input} autoComplete="off"
          aria-label="タグ名" placeholder="タグを入力して選択"
          role="combobox" aria-autocomplete="list" aria-expanded={options.length > 0}
          aria-controls={`${id}-options`} aria-activedescendant={highlight >= 0 && options[highlight] ? `${id}-option-${highlight}` : undefined}
          aria-describedby={`${id}-status`}
          onChange={(event) => { editor.setInput(event.target.value); setSuggestions([]); setHighlight(-1) }}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing || event.keyCode === 229) return
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault()
              setHighlight((current) => options.length ? (current + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length : -1)
            } else if (event.key === 'Enter') {
              event.preventDefault()
              const option = options[highlight >= 0 ? highlight : 0]
              if (option) choose(option)
            } else if (event.key === 'Escape') {
              event.preventDefault()
              event.stopPropagation()
              editor.closeAdd()
            }
          }}
        />
          {options.length > 0 && <ul id={`${id}-options`} role="listbox" aria-label="タグの候補" className="advanced-tag-options">
            {options.map((tag, index) => <li key={tagKey(tag)} role="presentation">
              <Button id={`${id}-option-${index}`} role="option" aria-selected={highlight === index}
                variant="ghost" tone="neutral" size="compact" tabIndex={-1} data-tag-type={tag.type}
                onMouseDown={(event) => event.preventDefault()} onClick={() => choose(tag)}>
                <span aria-hidden="true">#</span>
                <span className="advanced-tag-option__text">
                  {canCreate && index === options.length - 1 ? <span>「{tag.name}」を追加</span> : <>
                    <span>{getTagLabel(tag)}</span>
                    {getTagLabel(tag) !== tag.name && <small>{tag.name}</small>}
                  </>}
                </span>
                {tag.count !== undefined && <span className="advanced-tag-option__count">{tag.count}</span>}
              </Button>
            </li>)}
          </ul>}
        </div>
      </div>
      <div id={`${id}-status`} className="book-viewer__tag-input-status" role="status">
        {loading ? '候補を検索中…' : searchError ? '候補を取得できません。タグ名を直接入力して追加できます。' : duplicate ? '追加済みのタグです。' : ''}
      </div>
    </div>}
    {types.map((type) => <section className="book-viewer__tag-group" key={type} aria-labelledby={`${id}-${type}`}>
      <div className="book-viewer__tag-group-heading">
        <h3 id={`${id}-${type}`}>{TAG_TYPE_LABELS[type]}</h3>
        <span>{draft.filter((tag) => tag.type === type).length}</span>
      </div>
      <div className="book-viewer__tag-chips">
        {draft.filter((tag) => tag.type === type).map((tag) => <TagChip
          key={tagKey(tag)} tag={tag} size="default"
          title={tag.name === getTagLabel(tag) ? tag.name : `${tag.name} / ${getTagLabel(tag)}`}
          onRemove={() => {
            editor.remove(tag)
            // Deleting the focused chip must not leave focus on the document body.
            document.getElementById(`${id}-add-${type}`)?.focus({ preventScroll: true })
          }}
        />)}
        <IconButton id={`${id}-add-${type}`}
          size="compact" onClick={() => editor.openAdd(type)} aria-label={`${TAG_TYPE_LABELS[type]}を追加`} title={`${TAG_TYPE_LABELS[type]}を追加`}>
          <Plus size={16} aria-hidden="true" />
        </IconButton>
      </div>
    </section>)}
  </fieldset>
}
