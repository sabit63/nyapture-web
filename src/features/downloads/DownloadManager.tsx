import {
  ArrowDownUp,
  CloudDownload,
  Pause,
  Play,
  RefreshCw,
  Search,
  TriangleAlert,
  X,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { Snackbar, useSnackbar } from '../../components/Snackbar'
import { Button, IconButton, StatePanel } from '../../components/ui'
import { DownloadCard, DownloadCardSkeleton } from './download-card'
import { useDownloadManager } from './use-download-manager'
import { sortDownloads, type DownloadSort } from './download-state'
import './download-manager.css'

export interface DownloadManagerProps {
  /** Changes whenever the active API client settings are replaced. */
  apiRevision: number
}

export function DownloadManager({ apiRevision }: DownloadManagerProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [sort, setSort] = useState<DownloadSort>('priority')
  const { notice, notify, dismiss } = useSnackbar()
  const {
    downloads,
    systemStatus,
    counts,
    loadError,
    isInitialLoading,
    isRefreshing,
    pendingActions,
    refreshDownloads,
    pauseDownload,
    resumeDownload,
    retryDownload,
    changePriority,
    deleteDownload,
    pauseAllDownloads,
    resumeAllDownloads,
  } = useDownloadManager({ apiRevision, notify, dismiss })

  const filteredDownloads = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLocaleLowerCase('ja-JP')
    const matches = downloads.filter(
      (download) =>
        !normalizedQuery ||
        download.title.toLocaleLowerCase('ja-JP').includes(normalizedQuery) ||
        download.artist?.toLocaleLowerCase('ja-JP').includes(normalizedQuery) === true,
    )

    return sortDownloads(matches, sort)
  }, [downloads, searchQuery, sort])

  const hasSearchQuery = searchQuery.trim().length > 0
  const activeDownloads = counts.running + counts.queued
  const systemActivityLabel =
    systemStatus === null
      ? 'システム状態未取得'
      : systemStatus.isSystemRunning
        ? 'システム処理中'
        : null

  return (
    <section
      className="download-manager"
      aria-labelledby="download-manager-title"
      aria-busy={isInitialLoading || isRefreshing}
    >
      <header className="download-manager__hero">
        <div className="download-manager__heading">
          <span className="download-manager__heading-icon" aria-hidden="true">
            <CloudDownload size={22} strokeWidth={2.1} />
          </span>
          <div>
            <h1 id="download-manager-title">ダウンロード</h1>
            {systemActivityLabel && (
              <p className="download-manager__system-activity" role="status" aria-live="polite">
                {systemActivityLabel}
              </p>
            )}
          </div>
        </div>

        <div className="download-manager__global-actions" aria-label="ダウンロード全体の操作">
          <IconButton
            variant="outline"
            tone="success"
            size="compact"
            className="download-manager__global-action"
            type="button"
            aria-label="全て再開"
            disabled={pendingActions.has('global-resume') || counts.paused === 0}
            onClick={resumeAllDownloads}
          >
            <Play size={16} aria-hidden="true" />
          </IconButton>
          <IconButton
            variant="outline"
            tone="warning"
            size="compact"
            className="download-manager__global-action"
            type="button"
            aria-label="全て一時停止"
            disabled={pendingActions.has('global-pause') || activeDownloads === 0}
            onClick={pauseAllDownloads}
          >
            <Pause size={16} aria-hidden="true" />
          </IconButton>
          <IconButton
            variant="ghost"
            tone="neutral"
            size="compact"
            className="download-manager__icon-button"
            type="button"
            aria-label="ダウンロード一覧を更新"
            disabled={isRefreshing}
            onClick={refreshDownloads}
          >
            <RefreshCw
              className={isRefreshing ? 'is-spinning' : undefined}
              size={18}
              aria-hidden="true"
            />
          </IconButton>
        </div>
      </header>

      <section className="download-manager__filters" aria-label="ダウンロードの検索と並び順">
        <div className="download-manager__search-field">
          <Search size={18} aria-hidden="true" />
          <label className="sr-only" htmlFor="download-manager-search">
            タイトルまたは作者で検索
          </label>
          <input
            id="download-manager-search"
            type="search"
            value={searchQuery}
            placeholder="タイトルまたは作者で検索..."
            onChange={(event) => setSearchQuery(event.target.value)}
          />
          {searchQuery && (
            <IconButton
              variant="ghost"
              tone="neutral"
              size="compact"
              className="download-manager__search-clear"
              type="button"
              aria-label="検索をクリア"
              onClick={() => setSearchQuery('')}
            >
              <X size={14} aria-hidden="true" />
            </IconButton>
          )}
        </div>

        <label className="download-manager__sort-field">
          <span>並び順</span>
          <ArrowDownUp size={15} aria-hidden="true" />
          <select value={sort} onChange={(event) => setSort(event.target.value as DownloadSort)}>
            <option value="priority">優先度順</option>
            <option value="progress">進捗順</option>
            <option value="added">追加日時順</option>
            <option value="title">タイトル順</option>
          </select>
        </label>
      </section>

      <div className="download-manager__list-header">
        <p>
          <span aria-live="polite">{filteredDownloads.length}件</span>
          {isRefreshing && (
            <span className="sr-only" role="status">
              更新中…
            </span>
          )}
        </p>
      </div>

      {loadError && downloads.length > 0 && (
        <div className="download-manager__error" role="alert">
          <TriangleAlert size={16} aria-hidden="true" />
          <span>{loadError}</span>
          <Button
            variant="outline"
            tone="danger"
            size="compact"
            className="download-manager__error-retry"
            type="button"
            onClick={refreshDownloads}
            disabled={isRefreshing}
          >
            再試行
          </Button>
        </div>
      )}

      {isInitialLoading ? (
        <div
          className="download-manager__loading"
          role="status"
          aria-live="polite"
          aria-busy="true"
        >
          <span className="sr-only">ダウンロード一覧を読み込み中…</span>
          <div
            className="download-manager__list download-manager__list--loading"
            aria-hidden="true"
          >
            {Array.from({ length: 4 }, (_, index) => (
              <DownloadCardSkeleton key={index} />
            ))}
          </div>
        </div>
      ) : loadError && downloads.length === 0 ? (
        <StatePanel
          title="ダウンロード一覧を読み込めませんでした"
          description={loadError}
          icon={<TriangleAlert size={28} />}
          tone="danger"
          role="alert"
          action={
            <Button
              variant="outline"
              tone="danger"
              size="compact"
              className={
                isRefreshing
                  ? 'download-manager__clear-button--pending'
                  : 'download-manager__clear-button'
              }
              aria-label={isRefreshing ? '再試行中…' : '再試行'}
              aria-busy={isRefreshing}
              onClick={refreshDownloads}
              disabled={isRefreshing}
            >
              {isRefreshing ? (
                <RefreshCw className="is-spinning" size={16} aria-hidden="true" />
              ) : (
                '再試行'
              )}
            </Button>
          }
        />
      ) : filteredDownloads.length > 0 ? (
        <div className="download-manager__list" aria-live="polite" aria-busy={isRefreshing}>
          {filteredDownloads.map((download) => (
            <DownloadCard
              key={download.id}
              download={download}
              pending={pendingActions.has(download.id)}
              onPause={pauseDownload}
              onResume={resumeDownload}
              onRetry={retryDownload}
              onPriorityChange={changePriority}
              onDelete={deleteDownload}
            />
          ))}
        </div>
      ) : (
        <StatePanel
          title={
            hasSearchQuery ? '条件に一致するダウンロードがありません' : 'ダウンロードはありません'
          }
          icon={<Search size={28} />}
          action={
            hasSearchQuery && (
              <Button
                variant="outline"
                tone="accent"
                size="compact"
                className="download-manager__clear-button"
                type="button"
                onClick={() => setSearchQuery('')}
              >
                検索をクリア
              </Button>
            )
          }
        />
      )}

      <Snackbar notice={notice} onDismiss={dismiss} />
    </section>
  )
}

export default DownloadManager
