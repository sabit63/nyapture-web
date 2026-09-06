import { Save, X } from 'lucide-react'

import type { DisplaySettings } from '../../api'
import {
  Dialog,
  DialogBody,
  DialogFooter,
  DialogHeader,
  IconButton,
} from '../../components/ui'
import type { ApiSettingsController } from './useApiSettings'

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
            <section className="api-settings-dialog__section" aria-labelledby="display-settings-section-title">
              <h3 id="display-settings-section-title">検索結果</h3>
              <section className="advanced-dialog__field">
                <label htmlFor="display-settings-thumbnail-columns">サムネイル列数</label>
                <select
                  id="display-settings-thumbnail-columns"
                  value={displaySettingsDraft.thumbnailColumns}
                  onChange={(event) => {
                    setDisplaySettingsSaveError('')
                    setDisplaySettingsDraft((current) => ({
                      ...current,
                      thumbnailColumns: Number(event.target.value) as DisplaySettings['thumbnailColumns'],
                    }))
                  }}
                >
                  <option value="1">1</option>
                  <option value="2">2</option>
                  <option value="3">3</option>
                  <option value="4">4</option>
                  <option value="5">5</option>
                </select>
              </section>
            </section>

            {displaySettingsSaveError && <p className="advanced-field-error api-settings-dialog__body-error" role="alert">{displaySettingsSaveError}</p>}
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
