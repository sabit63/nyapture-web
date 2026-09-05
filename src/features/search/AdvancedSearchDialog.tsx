import { Eraser, Search, X } from 'lucide-react'

import { TAG_TYPE_LABELS, TAG_TYPE_ORDER, HITOMI_APPENDS, getTagLabel } from '../../models'
import { TagChip } from '../../components/TagChip'
import { Button, Dialog, DialogBody, DialogFooter, DialogHeader, IconButton } from '../../components/ui'
import { MissingTagFields } from './MissingTagFields'
import type { SearchController } from './useSearchController'
import { formatTagCount } from './search-utils'

export type AdvancedSearchDialogProps = {
  controller: SearchController
}

export function AdvancedSearchDialog({ controller }: AdvancedSearchDialogProps) {
  const {
    isWebSearch,
    advancedOpen,
    advancedDialogRef,
    requestAdvancedClose,
    afterAdvancedClose,
    resolveAdvancedRestoreFocus,
    draftCriteria,
    draftHitomiAppend,
    advancedErrors,
    tagType,
    tagInput,
    highlightedTagIndex,
    tagCandidates,
    showTagCandidates,
    setDraftCriteria,
    setDraftHitomiAppend,
    setTagType,
    setTagInput,
    setTagInputFocused,
    setHighlightedTagIndex,
    setAdvancedErrors,
    selectDraftTag,
    removeDraftTag,
    clearAdvancedDraft,
    applyAdvancedSearch,
  } = controller

  return (
    <Dialog
      ref={advancedDialogRef}
      id="advanced-search-dialog"
      className="advanced-dialog"
      open={advancedOpen}
      onRequestClose={requestAdvancedClose}
      onAfterClose={afterAdvancedClose}
      resolveRestoreFocus={resolveAdvancedRestoreFocus}
      aria-labelledby="advanced-search-title"
    >
      {({ requestClose }) => (
        <form className="advanced-dialog__panel" noValidate onSubmit={(event) => applyAdvancedSearch(event, requestClose)}>
          <DialogHeader className="advanced-dialog__header">
            <div>
              <h2 id="advanced-search-title">詳細検索</h2>
            </div>
            <IconButton
              size="default"
              type="button"
              aria-label="詳細検索を閉じる"
              onClick={() => requestClose('close-button')}
            >
              <X size={19} aria-hidden="true" />
            </IconButton>
          </DialogHeader>

          <DialogBody className="advanced-dialog__body">
            {controller.isMissingTagSearch && (
              <MissingTagFields
                id="advanced-missing-tags"
                value={draftCriteria.missingTagTypes ?? []}
                error={advancedErrors.missingTags}
                onChange={(types) => {
                  setDraftCriteria((current) => ({ ...current, missingTagTypes: types }))
                  setAdvancedErrors((current) => ({ ...current, missingTags: types.length ? undefined : '1種類以上選択してください。' }))
                }}
              />
            )}
            {!isWebSearch && (
              <section className="advanced-dialog__field">
                <label htmlFor="advanced-search-text">テキスト入力</label>
                <input
                  id="advanced-search-text"
                  type="search"
                  value={draftCriteria.text}
                  placeholder="タイトル、作者、タグを検索"
                  onChange={(event) => setDraftCriteria((current) => ({ ...current, text: event.target.value }))}
                />
              </section>
            )}

            <section className="advanced-dialog__field">
              <label htmlFor="advanced-tag-type">タグ選択</label>
              <div className="advanced-tag-picker">
                <select
                  id="advanced-tag-type"
                  value={tagType}
                  aria-label="タグの種別"
                  onChange={(event) => {
                    setTagType(event.target.value as typeof tagType)
                    setHighlightedTagIndex(0)
                  }}
                >
                  {TAG_TYPE_ORDER.map((type) => <option key={type} value={type}>{TAG_TYPE_LABELS[type]}</option>)}
                </select>
                <div className="advanced-tag-combobox">
                  <input
                    id="advanced-tag-input"
                    type="text"
                    role="combobox"
                    value={tagInput}
                    placeholder="タグを入力して選択"
                    autoComplete="off"
                    aria-autocomplete="list"
                    aria-expanded={showTagCandidates}
                    aria-controls="advanced-tag-options"
                    aria-activedescendant={showTagCandidates && tagCandidates[highlightedTagIndex] ? `advanced-tag-option-${highlightedTagIndex}` : undefined}
                    onFocus={() => setTagInputFocused(true)}
                    onBlur={() => window.setTimeout(() => setTagInputFocused(false), 120)}
                    onChange={(event) => {
                      setTagInput(event.target.value)
                      setHighlightedTagIndex(0)
                      setTagInputFocused(true)
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'ArrowDown' && tagCandidates.length) {
                        event.preventDefault()
                        setHighlightedTagIndex((current) => Math.min(current + 1, tagCandidates.length - 1))
                      } else if (event.key === 'ArrowUp' && tagCandidates.length) {
                        event.preventDefault()
                        setHighlightedTagIndex((current) => Math.max(current - 1, 0))
                      } else if (event.key === 'Enter' && showTagCandidates && tagCandidates[highlightedTagIndex]) {
                        event.preventDefault()
                        selectDraftTag(tagCandidates[highlightedTagIndex])
                      } else if (event.key === 'Escape' && (tagInput || showTagCandidates)) {
                        event.preventDefault()
                        event.stopPropagation()
                        setTagInput('')
                        setTagInputFocused(false)
                        setHighlightedTagIndex(0)
                      }
                    }}
                  />
                  {showTagCandidates && (
                    <ul id="advanced-tag-options" className="advanced-tag-options" role="listbox" aria-label={`${TAG_TYPE_LABELS[tagType]}の候補`}>
                      {tagCandidates.map((tag, index) => {
                        const formattedCount = formatTagCount(tag.count)
                        return (
                          <li key={`${tag.type}:${tag.name}`} role="presentation">
                            <Button
                              id={`advanced-tag-option-${index}`}
                              data-tag-type={tag.type}
                              type="button"
                              variant="ghost"
                              tone="neutral"
                              size="compact"
                              role="option"
                              aria-selected={index === highlightedTagIndex}
                              onMouseDown={(event) => event.preventDefault()}
                              onMouseEnter={() => setHighlightedTagIndex(index)}
                              onClick={() => selectDraftTag(tag)}
                            >
                              <span aria-hidden="true">#</span>
                              <span className="advanced-tag-option__text">
                                <span>{getTagLabel(tag)}</span>
                                {tag.displayName && tag.displayName !== tag.name && <small>{tag.name}</small>}
                              </span>
                              {formattedCount !== null && (
                                <span className="advanced-tag-option__count">
                                  <span className="sr-only">使用回数 </span>
                                  {formattedCount}
                                  <span className="sr-only"> 件</span>
                                </span>
                              )}
                            </Button>
                          </li>
                        )
                      })}
                    </ul>
                  )}
                </div>
              </div>
              {draftCriteria.tags.length > 0 && (
                <div className="advanced-selected-tags" aria-label="選択済みタグ">
                  {draftCriteria.tags.map((tag) => (
                    <TagChip
                      key={`${tag.type}:${tag.name}`}
                      tag={tag}
                      size="default"
                      onRemove={() => removeDraftTag(tag)}
                    />
                  ))}
                </div>
              )}
              {!isWebSearch && (
                <fieldset className="advanced-tag-mode">
                  <legend>タグの一致条件</legend>
                  <label><input type="radio" name="advanced-tag-mode" value="and" checked={draftCriteria.tagMode === 'and'} onChange={() => setDraftCriteria((current) => ({ ...current, tagMode: 'and' }))} />すべて一致</label>
                  <label><input type="radio" name="advanced-tag-mode" value="or" checked={draftCriteria.tagMode === 'or'} onChange={() => setDraftCriteria((current) => ({ ...current, tagMode: 'or' }))} />いずれか一致</label>
                </fieldset>
              )}
            </section>

            {isWebSearch && (
              <section className="advanced-dialog__field">
                <label htmlFor="hitomi-append">Append</label>
                <select id="hitomi-append" value={draftHitomiAppend} onChange={(event) => setDraftHitomiAppend(event.target.value as typeof draftHitomiAppend)}>
                  {HITOMI_APPENDS.map((append) => <option key={append} value={append}>{append}</option>)}
                </select>
              </section>
            )}

            {!isWebSearch && (
              <>
                <fieldset className="advanced-dialog__field advanced-range-field">
                  <legend>日時範囲</legend>
                  <div className="advanced-range-grid">
                    <label htmlFor="advanced-date-from">開始日</label>
                    <input id="advanced-date-from" type="date" value={draftCriteria.dateFrom} aria-invalid={Boolean(advancedErrors.date)} aria-describedby={advancedErrors.date ? 'advanced-date-error' : undefined} onChange={(event) => { setDraftCriteria((current) => ({ ...current, dateFrom: event.target.value })); setAdvancedErrors((current) => ({ ...current, date: undefined })) }} />
                    <label htmlFor="advanced-date-to">終了日</label>
                    <input id="advanced-date-to" type="date" value={draftCriteria.dateTo} aria-invalid={Boolean(advancedErrors.date)} aria-describedby={advancedErrors.date ? 'advanced-date-error' : undefined} onChange={(event) => { setDraftCriteria((current) => ({ ...current, dateTo: event.target.value })); setAdvancedErrors((current) => ({ ...current, date: undefined })) }} />
                  </div>
                  {advancedErrors.date && <p id="advanced-date-error" className="advanced-field-error" role="alert">{advancedErrors.date}</p>}
                </fieldset>

                <fieldset className="advanced-dialog__field advanced-range-field">
                  <legend>ページ数範囲</legend>
                  <div className="advanced-range-grid">
                    <label htmlFor="advanced-pages-min">最小ページ数</label>
                    <input id="advanced-pages-min" type="number" min="1" step="1" inputMode="numeric" value={draftCriteria.pagesMin} aria-invalid={Boolean(advancedErrors.pages)} aria-describedby={advancedErrors.pages ? 'advanced-pages-error' : undefined} onChange={(event) => { setDraftCriteria((current) => ({ ...current, pagesMin: event.target.value })); setAdvancedErrors((current) => ({ ...current, pages: undefined })) }} />
                    <label htmlFor="advanced-pages-max">最大ページ数</label>
                    <input id="advanced-pages-max" type="number" min="1" step="1" inputMode="numeric" value={draftCriteria.pagesMax} aria-invalid={Boolean(advancedErrors.pages)} aria-describedby={advancedErrors.pages ? 'advanced-pages-error' : undefined} onChange={(event) => { setDraftCriteria((current) => ({ ...current, pagesMax: event.target.value })); setAdvancedErrors((current) => ({ ...current, pages: undefined })) }} />
                  </div>
                  {advancedErrors.pages && <p id="advanced-pages-error" className="advanced-field-error" role="alert">{advancedErrors.pages}</p>}
                </fieldset>
              </>
            )}
          </DialogBody>

          <DialogFooter className="advanced-dialog__footer">
            <IconButton size="default" type="button" aria-label="検索条件をクリア" onClick={clearAdvancedDraft}>
              <Eraser size={17} aria-hidden="true" />
            </IconButton>
            <span />
            <IconButton
              className="advanced-dialog__submit"
              variant="solid"
              tone="accent"
              size="default"
              type="submit"
              aria-label="検索"
            >
              <Search size={18} aria-hidden="true" />
            </IconButton>
          </DialogFooter>
        </form>
      )}
    </Dialog>
  )
}
