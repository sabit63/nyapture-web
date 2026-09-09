import { Save, X } from 'lucide-react'

import type { DisplaySettings } from '../../api'
import { RESULT_LIMIT_OPTIONS, type ResultLimit } from '../../api/display-settings-storage'
import { MIN_THUMBNAIL_COLUMNS, MAX_THUMBNAIL_COLUMNS } from '../../api'
import {
  Dialog,
  DialogBody,
  DialogFooter,
  DialogHeader,
  IconButton,
} from '../../components/ui'
import type { ApiSettingsController } from './useApiSettings'
import './display-settings-dialog.css'

const COLOR_THEMES = [
  {
    id: 'default',
    label: 'Default',
    description: 'Nyapture の標準ダークテーマ',
  },
  {
    id: 'amethyst',
    label: 'Amethyst',
    description: '紫水晶を基調にしたダークテーマ',
  },
] as const satisfies ReadonlyArray<{
  id: DisplaySettings['colorTheme']
  label: string
  description: string
}>

export type DisplaySettingsDialogProps = {
  controller: ApiSettingsController
}

export function DisplaySettingsDialog({ controller }: DisplaySettingsDialogProps) {
  const {
    displaySettingsDraft,
    displaySettingsOpen,
    displaySettingsSaveError,
    displaySettingsDialogRef,
    requestDisplaySettingsClose,
    afterDisplaySettingsClose,
    saveDisplaySettings,
    setDisplaySettingsDraft,
    setDisplaySettingsSaveError,
  } = controller

  return (
    <Dialog
      ref={displaySettingsDialogRef}
      id="display-settings-dialog"
      className="advanced-dialog api-settings-dialog display-settings-dialog"
      open={displaySettingsOpen}
      onRequestClose={requestDisplaySettingsClose}
      onAfterClose={afterDisplaySettingsClose}
      aria-labelledby="display-settings-title"
    >
      {({ requestClose }) => (
        <form className="advanced-dialog__panel api-settings-dialog__panel" noValidate onSubmit={(event) => saveDisplaySettings(event, requestClose)}>
          <DialogHeader className="advanced-dialog__header">
            <div>
              <h2 id="display-settings-title">表示設定</h2>
            </div>
            <IconButton size="default" type="button" aria-label="表示設定を閉じる" onClick={() => requestClose('close-button')}>
              <X size={19} aria-hidden="true" />
            </IconButton>
          </DialogHeader>

          <DialogBody className="advanced-dialog__body">
            <section className="api-settings-dialog__section" aria-labelledby="display-settings-theme-title">
              <h3 id="display-settings-theme-title">カラーテーマ</h3>
              <fieldset className="display-settings-theme-picker">
                <legend className="sr-only">カラーテーマを選択</legend>
                {COLOR_THEMES.map((theme) => (
                  <label
                    className="display-settings-theme-card"
                    data-theme-preview={theme.id}
                    data-selected={displaySettingsDraft.colorTheme === theme.id || undefined}
                    key={theme.id}
                  >
                    <input
                      type="radio"
                      name="color-theme"
                      value={theme.id}
                      checked={displaySettingsDraft.colorTheme === theme.id}
                      onChange={() => {
                        setDisplaySettingsSaveError('')
                        setDisplaySettingsDraft((current) => ({ ...current, colorTheme: theme.id }))
                      }}
                    />
                    <span className="display-settings-theme-card__content">
                      <span className="display-settings-theme-card__swatches" aria-hidden="true">
                        <span />
                        <span />
                        <span />
                        <span />
                      </span>
                      <strong>{theme.label}</strong>
                      <small>{theme.description}</small>
                    </span>
                  </label>
                ))}
              </fieldset>
            </section>

            <section className="api-settings-dialog__section" aria-labelledby="display-settings-section-title">
              <h3 id="display-settings-section-title">検索結果</h3>
              <section className="advanced-dialog__field">
                <label htmlFor="display-settings-search-limit">取得件数</label>
                <select id="display-settings-search-limit" value={displaySettingsDraft.searchLimit ?? 50}
                  onChange={(event) => {
                    setDisplaySettingsSaveError('')
                    setDisplaySettingsDraft((current) => ({ ...current, searchLimit: Number(event.target.value) as ResultLimit }))
                  }}>
                  {RESULT_LIMIT_OPTIONS.map((limit) => <option key={limit} value={limit}>{limit}件</option>)}
                </select>
              </section>
              <section className="advanced-dialog__field">
                <label htmlFor="display-settings-thumbnail-columns">サムネイル列数</label>
                <div className="display-settings-columns-row">
                <button type="button" role="switch" className="display-settings-auto-columns"
                  aria-checked={displaySettingsDraft.autoThumbnailColumns === true}
                  aria-controls="display-settings-thumbnail-columns"
                    onClick={() => {
                      setDisplaySettingsSaveError('')
                      setDisplaySettingsDraft((current) => ({ ...current, autoThumbnailColumns: !current.autoThumbnailColumns }))
                    }}>
                  <span className="display-settings-auto-columns__track" aria-hidden="true" />
                  <span>自動</span>
                </button>
                <select
                  id="display-settings-thumbnail-columns"
                  disabled={displaySettingsDraft.autoThumbnailColumns === true}
                  value={displaySettingsDraft.thumbnailColumns}
                  onChange={(event) => {
                    setDisplaySettingsSaveError('')
                    setDisplaySettingsDraft((current) => ({
                      ...current,
                      thumbnailColumns: Number(event.target.value) as DisplaySettings['thumbnailColumns'],
                    }))
                  }}
                >
                  {Array.from({ length: MAX_THUMBNAIL_COLUMNS - MIN_THUMBNAIL_COLUMNS + 1 }, (_, index) => {
                    const columns = MIN_THUMBNAIL_COLUMNS + index
                    return <option key={columns} value={columns}>{columns}</option>
                  })}
                </select>
                </div>
              </section>
            </section>

            {displaySettingsSaveError && <p className="advanced-field-error api-settings-dialog__body-error" role="alert">{displaySettingsSaveError}</p>}
            <section className="api-settings-dialog__section" aria-labelledby="display-settings-recommendations-title">
              <h3 id="display-settings-recommendations-title">レコメンド</h3>
              <section className="advanced-dialog__field">
                <label htmlFor="display-settings-recommendation-limit">取得件数</label>
                <select id="display-settings-recommendation-limit" value={displaySettingsDraft.recommendationLimit ?? 20}
                  onChange={(event) => {
                    setDisplaySettingsSaveError('')
                    setDisplaySettingsDraft((current) => ({ ...current, recommendationLimit: Number(event.target.value) as ResultLimit }))
                  }}>
                  {RESULT_LIMIT_OPTIONS.map((limit) => <option key={limit} value={limit}>{limit}件</option>)}
                </select>
              </section>
              <button type="button" role="switch" className="display-settings-auto-columns"
                aria-checked={displaySettingsDraft.recommendationDebug === true}
                onClick={() => {
                  setDisplaySettingsSaveError('')
                  setDisplaySettingsDraft((current) => ({ ...current, recommendationDebug: !current.recommendationDebug }))
                }}>
                <span className="display-settings-auto-columns__track" aria-hidden="true" />
                <span>レコメンドのDebug詳細を表示</span>
              </button>
            </section>
          </DialogBody>

          <DialogFooter className="advanced-dialog__footer display-settings-dialog__footer">
            <IconButton className="api-settings-dialog__action" variant="solid" tone="accent" size="default" type="submit" aria-label="保存" title="保存">
              <Save className="api-settings-dialog__action-icon" size={18} aria-hidden="true" />
            </IconButton>
          </DialogFooter>
        </form>
      )}
    </Dialog>
  )
}
