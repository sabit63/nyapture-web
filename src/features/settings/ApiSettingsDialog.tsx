import { Eye, EyeOff, Save, Trash2, X } from 'lucide-react'

import { API_PROXY_PROTOCOLS } from '../../api'
import type { ApiProxyProtocol } from '../../api'
import {
  Button,
  Dialog,
  DialogBody,
  DialogFooter,
  DialogHeader,
  IconButton,
} from '../../components/ui'
import type { ApiSettingsController } from './useApiSettings'

export type ApiSettingsDialogProps = {
  controller: ApiSettingsController
}

export function ApiSettingsDialog({ controller }: ApiSettingsDialogProps) {
  const {
    apiSettingsDraft,
    apiSettingsOpen,
    apiSettingsErrors,
    apiSettingsSaveError,
    apiKeyVisible,
    editKeyVisible,
    draftConnectionState,
    draftConnectionError,
    apiSettingsDialogRef,
    requestApiSettingsClose,
    afterApiSettingsClose,
    clearDraftConnectionCheck,
    testApiConnection,
    saveApiSettings,
    resetApiSettings,
    setApiKeyVisible,
    setEditKeyVisible,
    setApiSettingsDraft,
    setApiSettingsErrors,
    setApiSettingsSaveError,
  } = controller
  const draftConnectionStatusLabel = controller.draftConnectionState === 'pending'
    ? '確認中'
    : controller.draftConnectionState === 'success'
      ? '接続済み'
      : controller.draftConnectionState === 'error'
        ? '接続エラー'
        : '未確認'

  return (
    <Dialog
      ref={apiSettingsDialogRef}
      id="api-settings-dialog"
      className="advanced-dialog api-settings-dialog"
      open={apiSettingsOpen}
      onRequestClose={requestApiSettingsClose}
      onAfterClose={afterApiSettingsClose}
      aria-labelledby="api-settings-title"
    >
      {({ requestClose }) => (
        <form className="advanced-dialog__panel api-settings-dialog__panel" noValidate onSubmit={(event) => saveApiSettings(event, requestClose)}>
          <DialogHeader className="advanced-dialog__header">
            <div>
              <h2 id="api-settings-title">API設定</h2>
            </div>
            <div className="api-settings-dialog__header-actions">
              <Button
                className={`api-settings__connection-indicator api-settings__connection-indicator--${draftConnectionState}`}
                type="button"
                variant="outline"
                tone={draftConnectionState === 'pending' ? 'warning' : draftConnectionState === 'success' ? 'success' : draftConnectionState === 'error' ? 'danger' : 'neutral'}
                size="compact"
                aria-live="polite"
                aria-atomic="true"
                aria-label={`API接続状態: ${draftConnectionStatusLabel}`}
                title="接続確認"
                disabled={draftConnectionState === 'pending'}
                onClick={() => { void testApiConnection() }}
              >
                <span className="api-settings__connection-indicator-dot" aria-hidden="true" />
                <span>{draftConnectionStatusLabel}</span>
              </Button>
              <IconButton size="default" type="button" aria-label="API設定を閉じる" onClick={() => requestClose('close-button')}>
                <X size={19} aria-hidden="true" />
              </IconButton>
            </div>
          </DialogHeader>

          <DialogBody className="advanced-dialog__body">
            <section
              className="api-settings-dialog__section"
              aria-labelledby="api-settings-section-title"
            >
              <h3 id="api-settings-section-title">接続先</h3>
              <div className="api-settings-dialog__content">
                <section className="advanced-dialog__field">
                  <label htmlFor="api-settings-url">URL</label>
                  <input
                    id="api-settings-url"
                    type="url"
                    required
                    value={apiSettingsDraft.apiUrl}
                    placeholder="http://localhost:5270"
                    autoComplete="url"
                    aria-invalid={Boolean(apiSettingsErrors.apiUrl)}
                    aria-describedby={apiSettingsErrors.apiUrl ? 'api-settings-url-error' : undefined}
                    onChange={(event) => {
                      clearDraftConnectionCheck()
                      setApiSettingsSaveError('')
                      setApiSettingsDraft((current) => ({ ...current, apiUrl: event.target.value }))
                      setApiSettingsErrors((current) => ({ ...current, apiUrl: undefined }))
                    }}
                  />
                  {apiSettingsErrors.apiUrl && <p id="api-settings-url-error" className="advanced-field-error" role="alert">{apiSettingsErrors.apiUrl}</p>}
                </section>

                <section className="advanced-dialog__field">
                  <label htmlFor="api-settings-timeout">タイムアウト</label>
                  <input
                    id="api-settings-timeout"
                    type="number"
                    required
                    min="1"
                    max="3600"
                    step="1"
                    inputMode="numeric"
                    value={apiSettingsDraft.timeoutSeconds}
                    aria-invalid={Boolean(apiSettingsErrors.timeoutSeconds)}
                    aria-describedby={apiSettingsErrors.timeoutSeconds ? 'api-settings-timeout-error' : undefined}
                    onChange={(event) => {
                      clearDraftConnectionCheck()
                      setApiSettingsSaveError('')
                      setApiSettingsDraft((current) => ({ ...current, timeoutSeconds: Number(event.target.value) }))
                      setApiSettingsErrors((current) => ({ ...current, timeoutSeconds: undefined }))
                    }}
                  />
                  {apiSettingsErrors.timeoutSeconds && <p id="api-settings-timeout-error" className="advanced-field-error" role="alert">{apiSettingsErrors.timeoutSeconds}</p>}
                </section>

                <fieldset className="api-settings__key-group">
                  <legend>APIキー</legend>
                  <section className="advanced-dialog__field">
                    <label htmlFor="api-settings-api-key">APIKey</label>
                    <div className="api-settings__secret-input">
                      <input
                        id="api-settings-api-key"
                        type={apiKeyVisible ? 'text' : 'password'}
                        value={apiSettingsDraft.apiKey}
                        autoComplete="new-password"
                        onChange={(event) => {
                          clearDraftConnectionCheck()
                          setApiSettingsSaveError('')
                          setApiSettingsDraft((current) => ({ ...current, apiKey: event.target.value }))
                        }}
                      />
                      <IconButton
                        className="api-settings__secret-toggle"
                        size="default"
                        type="button"
                        aria-label={apiKeyVisible ? 'APIKeyを非表示' : 'APIKeyを表示'}
                        aria-pressed={apiKeyVisible}
                        onClick={() => setApiKeyVisible((current) => !current)}
                      >
                        {apiKeyVisible
                          ? <EyeOff size={17} aria-hidden="true" />
                          : <Eye size={17} aria-hidden="true" />}
                      </IconButton>
                    </div>
                  </section>

                  <section className="advanced-dialog__field">
                    <label htmlFor="api-settings-edit-key">EditKey</label>
                    <div className="api-settings__secret-input">
                      <input
                        id="api-settings-edit-key"
                        type={editKeyVisible ? 'text' : 'password'}
                        value={apiSettingsDraft.editKey}
                        autoComplete="new-password"
                        onChange={(event) => {
                          clearDraftConnectionCheck()
                          setApiSettingsSaveError('')
                          setApiSettingsDraft((current) => ({ ...current, editKey: event.target.value }))
                        }}
                      />
                      <IconButton
                        className="api-settings__secret-toggle"
                        size="default"
                        type="button"
                        aria-label={editKeyVisible ? 'EditKeyを非表示' : 'EditKeyを表示'}
                        aria-pressed={editKeyVisible}
                        onClick={() => setEditKeyVisible((current) => !current)}
                      >
                        {editKeyVisible
                          ? <EyeOff size={17} aria-hidden="true" />
                          : <Eye size={17} aria-hidden="true" />}
                      </IconButton>
                    </div>
                  </section>
                </fieldset>
              </div>
            </section>

            <section className="api-settings-dialog__section" aria-labelledby="proxy-settings-section-title" hidden>
              <div className="api-settings-dialog__section-heading">
                <input
                  className="api-settings__proxy-toggle"
                  type="checkbox"
                  checked={apiSettingsDraft.proxy.enabled}
                  aria-label="Proxyを有効化"
                  onChange={(event) => {
                    clearDraftConnectionCheck()
                    setApiSettingsSaveError('')
                    setApiSettingsDraft((current) => ({
                      ...current,
                      proxy: { ...current.proxy, enabled: event.target.checked },
                    }))
                    setApiSettingsErrors((current) => ({
                      ...current,
                      proxyEnabled: undefined,
                      proxyProtocol: undefined,
                      proxyServerAddress: undefined,
                      proxyPort: undefined,
                    }))
                  }}
                />
                <h3 id="proxy-settings-section-title">Proxy</h3>
              </div>
              <div className="api-settings__proxy-grid">
                <section className="advanced-dialog__field">
                  <label htmlFor="api-settings-proxy-protocol">Protocol</label>
                  <select
                    id="api-settings-proxy-protocol"
                    value={apiSettingsDraft.proxy.protocol}
                    disabled={!apiSettingsDraft.proxy.enabled}
                    aria-invalid={Boolean(apiSettingsErrors.proxyProtocol)}
                    aria-describedby={apiSettingsErrors.proxyProtocol ? 'api-settings-proxy-protocol-error' : undefined}
                    onChange={(event) => {
                      clearDraftConnectionCheck()
                      setApiSettingsSaveError('')
                      setApiSettingsDraft((current) => ({
                        ...current,
                        proxy: { ...current.proxy, protocol: event.target.value as ApiProxyProtocol },
                      }))
                      setApiSettingsErrors((current) => ({ ...current, proxyProtocol: undefined }))
                    }}
                  >
                    {API_PROXY_PROTOCOLS.map((protocol) => <option key={protocol} value={protocol}>{protocol}</option>)}
                  </select>
                  {apiSettingsErrors.proxyProtocol && <p id="api-settings-proxy-protocol-error" className="advanced-field-error" role="alert">{apiSettingsErrors.proxyProtocol}</p>}
                </section>

                <section className="advanced-dialog__field">
                  <label htmlFor="api-settings-proxy-server-address">Server Address</label>
                  <input
                    id="api-settings-proxy-server-address"
                    type="text"
                    value={apiSettingsDraft.proxy.serverAddress}
                    disabled={!apiSettingsDraft.proxy.enabled}
                    autoComplete="off"
                    aria-invalid={Boolean(apiSettingsErrors.proxyServerAddress)}
                    aria-describedby={apiSettingsErrors.proxyServerAddress ? 'api-settings-proxy-server-address-error' : undefined}
                    onChange={(event) => {
                      clearDraftConnectionCheck()
                      setApiSettingsSaveError('')
                      setApiSettingsDraft((current) => ({
                        ...current,
                        proxy: { ...current.proxy, serverAddress: event.target.value },
                      }))
                      setApiSettingsErrors((current) => ({ ...current, proxyServerAddress: undefined }))
                    }}
                  />
                  {apiSettingsErrors.proxyServerAddress && <p id="api-settings-proxy-server-address-error" className="advanced-field-error" role="alert">{apiSettingsErrors.proxyServerAddress}</p>}
                </section>

                <section className="advanced-dialog__field">
                  <label htmlFor="api-settings-proxy-port">Port</label>
                  <input
                    id="api-settings-proxy-port"
                    type="number"
                    min="1"
                    max="65535"
                    step="1"
                    inputMode="numeric"
                    value={apiSettingsDraft.proxy.port ?? ''}
                    disabled={!apiSettingsDraft.proxy.enabled}
                    aria-invalid={Boolean(apiSettingsErrors.proxyPort)}
                    aria-describedby={apiSettingsErrors.proxyPort ? 'api-settings-proxy-port-error' : undefined}
                    onChange={(event) => {
                      clearDraftConnectionCheck()
                      setApiSettingsSaveError('')
                      setApiSettingsDraft((current) => ({
                        ...current,
                        proxy: {
                          ...current.proxy,
                          port: event.target.value === '' ? null : Number(event.target.value),
                        },
                      }))
                      setApiSettingsErrors((current) => ({ ...current, proxyPort: undefined }))
                    }}
                  />
                  {apiSettingsErrors.proxyPort && <p id="api-settings-proxy-port-error" className="advanced-field-error" role="alert">{apiSettingsErrors.proxyPort}</p>}
                </section>
              </div>
            </section>

            {draftConnectionState === 'error' && (
              <p className="advanced-field-error api-settings-dialog__body-error" role="alert">{draftConnectionError}</p>
            )}
            {apiSettingsSaveError && <p className="advanced-field-error api-settings-dialog__body-error" role="alert">{apiSettingsSaveError}</p>}
          </DialogBody>

          <DialogFooter className="advanced-dialog__footer api-settings-dialog__footer">
            <IconButton
              className="api-settings-dialog__action"
              variant="ghost"
              tone="danger"
              size="default"
              type="button"
              aria-label="端末から削除"
              title="端末から削除"
              disabled={draftConnectionState === 'pending'}
              onClick={() => resetApiSettings(requestClose)}
            >
              <Trash2 className="api-settings-dialog__action-icon" size={18} aria-hidden="true" />
            </IconButton>
            <span />
            <IconButton className="api-settings-dialog__action" variant="solid" tone="accent" size="default" type="submit" aria-label="保存" title="保存">
              <Save className="api-settings-dialog__action-icon" size={18} aria-hidden="true" />
            </IconButton>
          </DialogFooter>
        </form>
      )}
    </Dialog>
  )
}
