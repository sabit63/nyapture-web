import {
  CircleAlert,
  CircleCheck,
  CircleHelp,
  LoaderCircle,
  Radio,
  Settings,
} from 'lucide-react'

import { AppShell } from './app/AppShell'
import { Dashboard } from './components/Dashboard'
import { DownloadManager } from './components/DownloadManager'
import { useSnackbar } from './components/Snackbar'
import { IconButton } from './components/ui'
import { SearchHeader, SearchPage, useSearchController } from './features/search'
import { useApiSettings } from './features/settings'
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
  const { notice, notify, dismiss } = useSnackbar()
  const shellController = useAppShellController()
  const apiSettingsController = useApiSettings(notify)
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
  const apiStatus = apiSettingsController.activeConnectionState === 'error'
    ? 'error'
    : apiSettingsController.activeConnectionState === 'pending'
      ? 'loading'
      : apiSettingsController.activeConnectionState === 'success'
        ? 'connected'
        : 'unknown'
  const ConnectionIcon = apiStatus === 'error'
    ? CircleAlert
    : apiStatus === 'loading'
      ? LoaderCircle
      : apiStatus === 'connected'
        ? CircleCheck
        : CircleHelp
  const connectionLabel = apiStatus === 'error'
    ? 'API接続エラー'
    : apiStatus === 'loading'
      ? 'API接続中'
      : apiStatus === 'connected'
        ? 'API接続済み'
        : 'API接続未確認'
  const realtimeIsStale = searchController.searchSyncFreshness === 'stale'
    || hubConnectionState === 'disconnected'
    || hubConnectionState === 'error'
  const realtimeStatusClass = hubConnectionState === 'connected' && !realtimeIsStale
    ? searchController.searchSyncFreshness === 'syncing' ? 'loading' : 'connected'
    : hubConnectionState === 'connecting' || hubConnectionState === 'reconnecting'
      ? 'loading'
      : hubConnectionState === 'error'
        ? 'error'
        : realtimeIsStale
          ? 'stale'
          : 'unknown'
  const realtimeConnectionLabel = hubConnectionState === 'connected'
    ? searchController.searchSyncFreshness === 'syncing'
      ? 'Book Statusを同期中'
      : searchController.searchSyncFreshness === 'stale'
        ? 'リアルタイム接続済み。Status表示が古い可能性があります'
        : 'Book Statusリアルタイム接続済み'
    : hubConnectionState === 'connecting'
      ? 'Book Statusリアルタイム接続中'
      : hubConnectionState === 'reconnecting'
        ? 'Book Statusを再接続中。表示が古い可能性があります'
        : hubConnectionState === 'error'
          ? 'Book Statusリアルタイム接続エラー。表示が古い可能性があります'
          : hubConnectionState === 'disconnected'
            ? 'Book Statusリアルタイム切断。表示が古い可能性があります'
            : 'Book Statusリアルタイム接続待機中'

  return (
    <AppShell
      currentPath={currentPath}
      drawerOpen={shellController.drawerOpen}
      onOpenDrawer={shellController.openDrawer}
      onCloseDrawer={shellController.closeDrawer}
      onNavigate={shellController.onNavigate}
      menuButtonRef={shellController.menuButtonRef}
      headerCenter={isDashboard ? (
        <span aria-hidden="true" />
      ) : (
        <SearchHeader controller={searchController} />
      )}
      headerActions={(
        <>
          {(isLibrarySearch || isWebSearch) && (
            <span
              className={`connection connection--realtime connection--${realtimeStatusClass}`}
              role="status"
              aria-label={realtimeConnectionLabel}
              aria-live="polite"
              data-realtime-state={hubConnectionState}
              data-sync-freshness={searchController.searchSyncFreshness}
            >
              <Radio className="connection__icon" aria-hidden="true" />
            </span>
          )}
          <span
            className={`connection connection--${apiStatus}`}
            role="status"
            aria-label={connectionLabel}
            aria-live="polite"
          >
            <ConnectionIcon className="connection__icon" aria-hidden="true" />
          </span>
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
