import {
  ArrowDownUp,
  Ban,
  CircleCheck,
  CircleHelp,
  CircleStop,
  Clock3,
  Gauge,
  LibraryBig,
  Pause,
  PauseCircle,
  Play,
  RefreshCw,
  Trash2,
  TriangleAlert,
} from 'lucide-react'
import { useCallback } from 'react'
import { requestBlob } from '../../api'
import type { DownloadJob, DownloadStatus } from './download-state'
import { getPriorityLabel, isAbsoluteUrl } from './download-state'
import { Thumbnail } from '../../components/Thumbnail'

const STATUS_PRESENTATIONS: Record<DownloadStatus, { label: string; icon: typeof Play }> = {
  running: { label: '実行中', icon: Play },
  queued: { label: '待機中', icon: Clock3 },
  paused: { label: '一時停止', icon: PauseCircle },
  failed: { label: '失敗', icon: TriangleAlert },
  stopped: { label: '停止', icon: CircleStop },
  cancelled: { label: 'キャンセル', icon: Ban },
  completed: { label: '完了', icon: CircleCheck },
  unknown: { label: '状態不明', icon: CircleHelp },
}

export type DownloadCardActions = {
  onPause: (id: string) => void
  onResume: (id: string) => void
  onRetry: (id: string) => void
  onPriorityChange: (id: string) => void
  onDelete: (id: string) => void
}

export function DownloadCardSkeleton() {
  return (
    <article className="download-card download-card--skeleton" aria-hidden="true">
      <div className="download-card__cover-wrap">
        <span className="download-manager__skeleton download-card__skeleton-cover" />
      </div>

      <div className="download-card__body">
        <div className="download-card__title-row">
          <div className="download-card__skeleton-copy">
            <span className="download-manager__skeleton download-card__skeleton-line download-card__skeleton-line--title" />
            <span className="download-manager__skeleton download-card__skeleton-line download-card__skeleton-line--artist" />
          </div>
        </div>

        <div className="download-card__progress-row">
          <span className="download-manager__skeleton download-card__skeleton-progress" />
          <div className="download-card__progress-meta">
            <span className="download-manager__skeleton download-card__skeleton-percent" />
          </div>
        </div>

        <div className="download-card__details">
          <span className="download-manager__skeleton download-card__skeleton-detail" />
          <span className="download-manager__skeleton download-card__skeleton-detail download-card__skeleton-detail--short" />
        </div>

        <div className="download-card__status-row">
          <span className="download-manager__skeleton download-card__skeleton-status" />
          <span className="download-manager__skeleton download-card__skeleton-priority" />
        </div>
      </div>

      <div className="download-card__actions">
        <span className="download-manager__skeleton download-card__skeleton-action" />
        <span className="download-manager__skeleton download-card__skeleton-action" />
        <span className="download-manager__skeleton download-card__skeleton-action" />
      </div>
    </article>
  )
}

export function DownloadCard({
  download,
  pending,
  onPause,
  onResume,
  onRetry,
  onPriorityChange,
  onDelete,
}: { download: DownloadJob; pending: boolean } & DownloadCardActions) {
  const presentation = STATUS_PRESENTATIONS[download.status]
  const StatusIcon = presentation.icon
  const progressColor = download.status === 'failed'
    ? 'danger'
    : download.status === 'paused'
      ? 'warning'
      : download.status === 'queued'
        ? 'info'
        : download.status === 'stopped' || download.status === 'cancelled'
          ? 'warning'
          : 'primary'
  const canPause = download.status === 'running' || download.status === 'queued'
  const canResume = download.status === 'paused'
  const canRetry = download.status === 'failed'
  const canLoadBookThumbnail = Boolean(
    download.groupId
    && download.bookId
    && download.totalPages > 0
    && download.completedPages > 0,
  )
  const loadBookThumbnail = useCallback((signal: AbortSignal) => {
    if (!download.groupId || !download.bookId || download.totalPages <= 0) {
      return Promise.reject(new Error('Book page is not available'))
    }
    return requestBlob('/api/book/page', {
      query: {
        groupId: download.groupId,
        bookId: download.bookId,
        page: 1,
        width: 500,
        height: 700,
        strategy: 'speed',
        fallback_to_original: true,
      },
      headers: { Accept: 'image/*' },
      signal,
    })
  }, [download.bookId, download.groupId, download.totalPages])
  const legacyThumbnailUrl = isAbsoluteUrl(download.thumbnailUrl) ? download.thumbnailUrl : undefined

  return (
    <article className={`download-card download-card--${download.status}`} aria-busy={pending}>
      <div className="download-card__cover-wrap">
        <Thumbnail
          src={canLoadBookThumbnail ? undefined : legacyThumbnailUrl}
          load={canLoadBookThumbnail ? loadBookThumbnail : undefined}
          reloadKey={download.completedPages > 0 ? 1 : 0}
          loadingPolicy={{ mode: 'range', viewports: 4 }}
          alt={`${download.title}の表紙`}
          className="download-card__thumbnail"
          variant={download.cover}
          fallbackText="表紙なし"
          retryOnError={false}
          fallbackAriaLabel={`${download.title}の表紙を表示できません`}
        />
        <span className="download-card__cover-status" aria-label={`状態: ${presentation.label}`}>
          <StatusIcon size={13} aria-hidden="true" />
          <span>{presentation.label}</span>
        </span>
      </div>

      <div className="download-card__body">
        <div className="download-card__title-row">
          <div>
            <h2>{download.title}</h2>
            {download.artist && (
              <p className="download-card__artist"><span aria-hidden="true">作家</span>{download.artist}</p>
            )}
          </div>
          {download.priority === 0 && <span className="download-card__priority-badge">最優先</span>}
        </div>

        <div className="download-card__progress-row">
          <div
            className={`download-card__progress download-card__progress--${progressColor}`}
            role="progressbar"
            aria-label={`${download.title}のダウンロード進捗`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={download.progress}
          >
            <span style={{ width: `${download.progress}%` }} />
          </div>
          <div className="download-card__progress-meta">
            <strong>{download.progress}%</strong>
            {download.status === 'running' && download.speed !== undefined && (
              <span className="download-card__speed">
                <Gauge size={14} aria-hidden="true" />
                {download.speed.toFixed(1)} KB/s
              </span>
            )}
          </div>
        </div>

        <div className="download-card__details">
          <span>
            <LibraryBig size={14} aria-hidden="true" />
            {download.completedPages} / {download.totalPages} ページ完了
          </span>
          {download.failedPages > 0 && (
            <span className="download-card__failed-pages">
              <TriangleAlert size={14} aria-hidden="true" />
              {download.failedPages}ページ失敗
            </span>
          )}
        </div>

        <div className="download-card__status-row">
          <span className="download-card__priority-text">優先度: {getPriorityLabel(download.priority)}</span>
          {download.status === 'queued' && download.queuePosition !== undefined && (
            <span className="download-card__queue-position">キュー内位置: {download.queuePosition}</span>
          )}
        </div>

        {download.status === 'failed' && download.errorMessage && (
          <p className="download-card__error">
            <TriangleAlert size={14} aria-hidden="true" />
            <span>{download.errorMessage}</span>
          </p>
        )}
      </div>

      <div className="download-card__actions" aria-label={`${download.title}の操作`}>
        {download.status === 'queued' && (
          <button
            className="download-card__action download-card__action--priority download-card__action--icon-only"
            type="button"
            aria-label={`${download.title}の優先度を変更（現在: ${getPriorityLabel(download.priority)}）`}
            disabled={pending || !download.url}
            onClick={() => onPriorityChange(download.id)}
          >
            <ArrowDownUp size={16} aria-hidden="true" />
          </button>
        )}

        {canPause ? (
          <button
            className="download-card__action download-card__action--pause download-card__action--icon-only"
            type="button"
            aria-label={`${download.title}を一時停止`}
            disabled={pending || !download.url}
            onClick={() => onPause(download.id)}
          >
            <Pause size={16} aria-hidden="true" />
          </button>
        ) : canResume ? (
          <button
            className="download-card__action download-card__action--resume download-card__action--icon-only"
            type="button"
            aria-label={`${download.title}を再開`}
            disabled={pending || !download.url}
            onClick={() => onResume(download.id)}
          >
            <Play size={16} aria-hidden="true" />
          </button>
        ) : canRetry ? (
          <button
            className="download-card__action download-card__action--retry download-card__action--icon-only"
            type="button"
            aria-label={`${download.title}を再試行`}
            disabled={pending || !download.url}
            onClick={() => onRetry(download.id)}
          >
            <RefreshCw size={16} aria-hidden="true" />
          </button>
        ) : null}

        <button
          className="download-card__action download-card__action--delete download-card__action--icon-only"
          type="button"
          aria-label={`${download.title}を削除`}
          disabled={pending || !download.url}
          onClick={() => onDelete(download.id)}
        >
          <Trash2 size={16} aria-hidden="true" />
        </button>
      </div>
    </article>
  )
}
