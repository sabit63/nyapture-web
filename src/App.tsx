import {
  FileText,
  Radio,
  Settings,
} from 'lucide-react'
import { useCallback, useRef, useState } from 'react'

import { AppShell } from './app/AppShell'
import { Dashboard } from './components/Dashboard'
import { DownloadManager } from './components/DownloadManager'
import { useSnackbar } from './components/Snackbar'
import { IconButton } from './components/ui'
import { SearchHeader, SearchPage, useSearchController } from './features/search'
import { API_CONNECTION_STATE_LABELS, useApiSettings } from './features/settings'
import { AppOverlays } from './features/shell/AppOverlays'
import { useAppShellController } from './features/shell/useAppShellController'
import { BookViewerRoute, resolveBookViewerRoute } from './features/viewer/BookViewerRoute'
import { useBookDownloadHubConnection } from './realtime/use-book-download-hub'
import './components/search-dialogs.css'
import './components/search-page.css'

function App() {
  const currentPath = window.location.pathname
  const isWebSearch = currentPath === '/hitomila/search'
  const isLibrarySearch = currentPath === '/search'
  const isBookViewer = currentPath === '/book/viewer'
  const isDownloadManager = currentPath === '/download/book'
  const isDashboard = currentPath === '/dashboard' || currentPath.startsWith('/dashboard/')
  const viewerRoute = isBookViewer ? resolveBookViewerRoute(window.location.search) : undefined
  const navigateBack = () => {
    try {
      const referrer = document.referrer ? new URL(document.referrer) : null
      const safeReferrer = referrer
        && referrer.origin === window.location.origin
        && referrer.pathname !== '/book/viewer'
      if (safeReferrer && window.history.length > 1) {
        window.history.back()
        return
      }
    } catch {
      // Fall through to the stable search destination when the referrer is malformed.
    }
    window.location.assign('/search')
  }
  const { notice, notify, dismiss } = useSnackbar()
  const shellController = useAppShellController()
  const apiSettingsController = useApiSettings(notify)
  const [bookViewerDetailsOpen, setBookViewerDetailsOpen] = useState(false)
  const [bookViewerReady, setBookViewerReady] = useState(false)
  const bookViewerDetailsTriggerRef = useRef<HTMLButtonElement>(null)
  const handleBookViewerReadyChange = useCallback((ready: boolean) => {
    setBookViewerReady(ready)
    if (!ready) setBookViewerDetailsOpen(false)
  }, [])
  const realtimeEnabled = isLibrarySearch || isWebSearch || isDownloadManager
  const hubConnectionState = useBookDownloadHubConnection(realtimeEnabled, apiSettingsController.apiRevision)
  const searchController = useSearchController({
    isWebSearch,
    isLibrarySearch,
    isBookViewer,
    apiRevision: apiSettingsController.apiRevision,
    displaySettings: apiSettingsController.displaySettings,
    hubConnectionState,
    notify,
  })
  const apiConnectionState = apiSettingsController.activeConnectionState
  const realtimeConnectionLabel = !realtimeEnabled
    ? '対象外（この画面では不要）'
    : hubConnectionState === 'connected'
      ? searchController.searchSyncFreshness === 'syncing'
        ? '接続済み（同期中）'
        : searchController.searchSyncFreshness === 'stale'
          ? '接続済み（同期が古い可能性あり）'
          : '接続済み'
      : hubConnectionState === 'connecting'
        ? '接続中'
        : hubConnectionState === 'reconnecting'
          ? '再接続中'
          : hubConnectionState === 'error'
            ? '接続エラー'
            : hubConnectionState === 'disconnected'
              ? '切断'
              : '接続待機中'
  const connectionStatus = apiConnectionState === 'success'
    ? !realtimeEnabled || hubConnectionState === 'connected' ? 'connected' : 'warning'
    : 'error'
  const connectionLabel = `API: ${API_CONNECTION_STATE_LABELS[apiConnectionState]}、リアルタイム: ${realtimeConnectionLabel}`

  return (
    <AppShell
      currentPath={currentPath}
      drawerOpen={shellController.drawerOpen}
      onOpenDrawer={shellController.openDrawer}
      onCloseDrawer={shellController.closeDrawer}
      onNavigate={shellController.onNavigate}
      onBack={isBookViewer ? navigateBack : undefined}
      menuButtonRef={shellController.menuButtonRef}
      headerCenter={isDashboard ? (
        <span aria-hidden="true" />
      ) : (
        <SearchHeader controller={searchController} />
      )}
      headerActions={(
        <>
          <span
            className={`connection connection--${connectionStatus}`}
            role="status"
            aria-label={connectionLabel}
            aria-live="polite"
            data-api-state={apiConnectionState}
            data-realtime-state={hubConnectionState}
            data-realtime-enabled={realtimeEnabled}
            data-sync-freshness={searchController.searchSyncFreshness}
          >
            <Radio className="connection__icon" aria-hidden="true" />
          </span>
          {isBookViewer && (
            <IconButton
              ref={bookViewerDetailsTriggerRef}
              size="default"
              type="button"
              aria-label="Book情報を表示"
              aria-haspopup="dialog"
              aria-expanded={bookViewerDetailsOpen}
              aria-controls="book-viewer-details"
              disabled={!bookViewerReady}
              onClick={() => setBookViewerDetailsOpen(true)}
            >
              <FileText size={18} aria-hidden="true" />
            </IconButton>
          )}
          <IconButton
            ref={apiSettingsController.apiSettingsTriggerRef}
            className="api-settings-trigger"
            size="default"
            type="button"
            aria-label="設定を開く"
            aria-haspopup="dialog"
            aria-expanded={apiSettingsController.apiSettingsOpen}
            aria-controls="api-settings-dialog"
            onClick={apiSettingsController.openApiSettings}
          >
            <Settings size={18} aria-hidden="true" />
          </IconButton>
        </>
      )}
    >
      {isDownloadManager ? (
        <DownloadManager apiRevision={apiSettingsController.apiRevision} hubConnectionState={hubConnectionState} />
      ) : isDashboard ? (
        <Dashboard path={currentPath} apiRevision={apiSettingsController.apiRevision} />
      ) : isBookViewer && viewerRoute ? (
        <BookViewerRoute
          route={viewerRoute}
          apiRevision={apiSettingsController.apiRevision}
          onTagSearch={searchController.searchByTag}
          onTagSearchDestinationRequest={searchController.openTagSearchDestination}
          tagDisplayNameOverrides={searchController.tagDisplayNameOverrides}
          detailsOpen={bookViewerDetailsOpen}
          onDetailsOpenChange={setBookViewerDetailsOpen}
          detailsTriggerRef={bookViewerDetailsTriggerRef}
          onReadyChange={handleBookViewerReadyChange}
        />
      ) : (
        <SearchPage controller={searchController} />
      )}

      <AppOverlays
        searchController={searchController}
        apiSettingsController={apiSettingsController}
        notice={notice}
        onDismiss={dismiss}
      />
    </AppShell>
  )
}

export default App
