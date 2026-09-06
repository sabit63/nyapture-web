import {
  FileText,
  Radio,
  Settings,
} from 'lucide-react'
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'

import { AppShell } from './app/AppShell'
import { navigateBackOrFallback, RouterRuntime, useRouterLocation } from './app/client-router'
import { RouteBoundary } from './app/RouteBoundary'
import { useSnackbar } from './components/Snackbar'
import { IconButton, StatePanel } from './components/ui'
import { SearchHeader, SearchPage, useSearchController } from './features/search'
import { API_CONNECTION_STATE_LABELS, useApiSettings } from './features/settings'
import { AppOverlays } from './features/shell/AppOverlays'
import { useAppShellController } from './features/shell/useAppShellController'
import { resolveBookViewerRoute } from './features/viewer/viewer-route'
import { useBookDownloadHubConnection } from './realtime/use-book-download-hub'
import './components/search-dialogs.css'
import './components/search-page.css'

const Dashboard = lazy(() => import('./features/dashboard/Dashboard').then((module) => ({ default: module.Dashboard })))
const DownloadManager = lazy(() => import('./features/downloads/DownloadManager').then((module) => ({ default: module.DownloadManager })))
const WebCachePage = lazy(() => import('./features/web-cache/WebCachePage').then((module) => ({ default: module.WebCachePage })))
const BookViewerRoute = lazy(() => import('./features/viewer/BookViewerRoute').then((module) => ({ default: module.BookViewerRoute })))

function App() {
  const routerLocation = useRouterLocation()
  const currentPath = routerLocation.pathname
  const isWebSearch = currentPath === '/hitomila/search'
  const isWebCache = currentPath === '/web-cache'
  const isMissingTagSearch = currentPath === '/search/missing-tags'
  const isLibrarySearch = currentPath === '/search' || isMissingTagSearch
  const isBookViewer = currentPath === '/book/viewer'
  const isDownloadManager = currentPath === '/download/book'
  const isDashboard = currentPath === '/dashboard' || currentPath.startsWith('/dashboard/')
  const viewerRoute = isBookViewer ? resolveBookViewerRoute(routerLocation.search) : undefined
  const { notice, notify, dismiss } = useSnackbar()
  const shellController = useAppShellController()
  const apiSettingsController = useApiSettings(notify)
  const [bookViewerDetailsOpen, setBookViewerDetailsOpen] = useState(false)
  const [bookViewerReady, setBookViewerReady] = useState(false)
  const bookViewerDetailsTriggerRef = useRef<HTMLButtonElement>(null)
  const lastRouterRevisionRef = useRef(0)
  const handleBookViewerReadyChange = useCallback((ready: boolean) => {
    setBookViewerReady(ready)
    if (!ready) setBookViewerDetailsOpen(false)
  }, [])
  const navigateBack = useCallback(() => navigateBackOrFallback('/search'), [])
  useEffect(() => {
    if (routerLocation.revision === 0 || lastRouterRevisionRef.current === routerLocation.revision) return
    lastRouterRevisionRef.current = routerLocation.revision
    shellController.onNavigate()
    if (apiSettingsController.apiSettingsOpen) apiSettingsController.requestApiSettingsClose('programmatic')
  }, [apiSettingsController, routerLocation.revision, shellController])
  const realtimeEnabled = isLibrarySearch || isWebSearch || isWebCache || isDownloadManager
  const hubConnectionState = useBookDownloadHubConnection(realtimeEnabled, apiSettingsController.apiRevision)
  const searchController = useSearchController({
    isWebSearch,
    isLibrarySearch,
    isMissingTagSearch,
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
      headerCenter={isDashboard || isWebCache ? (
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
      <RouteBoundary key={currentPath}>
      <Suspense fallback={<StatePanel title="画面を読み込み中" role="status" />}>
      {isDownloadManager ? (
        <DownloadManager apiRevision={apiSettingsController.apiRevision} />
      ) : isWebCache ? (
        <WebCachePage
          apiRevision={apiSettingsController.apiRevision}
          displaySettings={apiSettingsController.displaySettings}
          notify={notify}
          onTagSearchDestinationRequest={searchController.openTagSearchDestination}
        />
      ) : isDashboard ? (
        <Dashboard path={currentPath} apiRevision={apiSettingsController.apiRevision} />
      ) : isBookViewer && viewerRoute ? (
        <BookViewerRoute
          route={viewerRoute}
          onBookChange={searchController.applyBookTagChange}
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
      </Suspense>
      </RouteBoundary>

      <AppOverlays
        searchController={searchController}
        apiSettingsController={apiSettingsController}
        notice={notice}
        onDismiss={dismiss}
      />
      <RouterRuntime />
    </AppShell>
  )
}

export default App
