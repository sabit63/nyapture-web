import {
  ArrowDownUp,
  CheckCircle2,
  Clock3,
  CloudDownload,
  Gauge,
  LibraryBig,
  Pause,
  PauseCircle,
  Play,
  RefreshCw,
  Search,
  Trash2,
  TriangleAlert,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useMemo, useState } from 'react'
import cover01 from '../assets/covers/cover-01.svg'
import cover02 from '../assets/covers/cover-02.svg'
import cover03 from '../assets/covers/cover-03.svg'
import cover04 from '../assets/covers/cover-04.svg'
import { Thumbnail } from './Thumbnail'
import './download-manager.css'

type DownloadStatus = 'running' | 'queued' | 'paused' | 'failed'
type DownloadFilter = 'all' | DownloadStatus
type DownloadSort = 'priority' | 'progress' | 'added' | 'title'

type DownloadJob = {
  id: string
  title: string
  artist: string
  thumbnailUrl: string
  cover: string
  status: DownloadStatus
  progress: number
  completedPages: number
  totalPages: number
  failedPages: number
  priority: number
  speed?: number
  remainingTime?: string
  queuePosition?: number
  errorMessage?: string
  addedAt: string
}

type StatusPresentation = {
  label: string
  icon: LucideIcon
}

const STATUS_PRESENTATIONS: Record<DownloadStatus, StatusPresentation> = {
  running: { label: '実行中', icon: Play },
  queued: { label: '待機中', icon: Clock3 },
  paused: { label: '一時停止', icon: PauseCircle },
  failed: { label: '失敗', icon: TriangleAlert },
}

const FILTERS: Array<{ key: DownloadFilter; label: string; icon: LucideIcon }> = [
  { key: 'all', label: 'すべて', icon: LibraryBig },
  { key: 'running', label: '実行中', icon: Play },
  { key: 'queued', label: '待機中', icon: Clock3 },
  { key: 'paused', label: '一時停止', icon: PauseCircle },
  { key: 'failed', label: '失敗', icon: TriangleAlert },
]

const INITIAL_DOWNLOADS: DownloadJob[] = [
  {
    id: 'hoshizora-no-kiroku',
    title: '星降る夜の記録',
    artist: '月影文庫',
    thumbnailUrl: cover01,
    cover: 'violet',
    status: 'running',
    progress: 64,
    completedPages: 128,
    totalPages: 200,
    failedPages: 0,
    priority: 0,
    speed: 842.6,
    remainingTime: '約1分20秒',
    addedAt: '2026-08-29T09:10:00+09:00',
  },
  {
    id: 'mahoutsukai-no-shoko',
    title: '魔法使いの書庫',
    artist: '青い栞',
    thumbnailUrl: cover02,
    cover: 'blue',
    status: 'queued',
    progress: 12,
    completedPages: 18,
    totalPages: 150,
    failedPages: 0,
    priority: 1,
    queuePosition: 1,
    addedAt: '2026-08-29T09:18:00+09:00',
  },
  {
    id: 'neko-biyori-vol3',
    title: 'ねこ日和 Vol.3',
    artist: 'しろくろ工房',
    thumbnailUrl: cover03,
    cover: 'amber',
    status: 'paused',
    progress: 38,
    completedPages: 36,
    totalPages: 96,
    failedPages: 0,
    priority: 2,
    addedAt: '2026-08-29T08:42:00+09:00',
  },
  {
    id: 'yuugure-kaido',
    title: '夕暮れ街道',
    artist: '遠野あかり',
    thumbnailUrl: cover04,
    cover: 'rose',
    status: 'failed',
    progress: 23,
    completedPages: 27,
    totalPages: 120,
    failedPages: 3,
    priority: 1,
    errorMessage: '28ページ目の取得に失敗しました。再試行してください。',
    addedAt: '2026-08-29T07:56:00+09:00',
  },
]

const PRIORITY_LABELS = ['最優先', '高', '通常']

function getPriorityLabel(priority: number) {
  return PRIORITY_LABELS[priority] ?? '通常'
}

function getCounts(downloads: DownloadJob[]) {
  return {
    all: downloads.length,
    running: downloads.filter((download) => download.status === 'running').length,
    queued: downloads.filter((download) => download.status === 'queued').length,
    paused: downloads.filter((download) => download.status === 'paused').length,
    failed: downloads.filter((download) => download.status === 'failed').length,
  }
}

export function DownloadManager() {
  const [downloads, setDownloads] = useState<DownloadJob[]>(INITIAL_DOWNLOADS)
  const [searchQuery, setSearchQuery] = useState('')
  const [filter, setFilter] = useState<DownloadFilter>('all')
  const [sort, setSort] = useState<DownloadSort>('priority')
  const [feedback, setFeedback] = useState('')
  const [isRefreshing, setIsRefreshing] = useState(false)

  const counts = useMemo(() => getCounts(downloads), [downloads])

  const filteredDownloads = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLocaleLowerCase('ja-JP')
    const matches = downloads.filter((download) => {
      const matchesFilter = filter === 'all' || download.status === filter
      const matchesQuery = !normalizedQuery
        || download.title.toLocaleLowerCase('ja-JP').includes(normalizedQuery)
        || download.artist.toLocaleLowerCase('ja-JP').includes(normalizedQuery)
      return matchesFilter && matchesQuery
    })

    return [...matches].sort((first, second) => {
      if (sort === 'progress') return second.progress - first.progress
      if (sort === 'added') return second.addedAt.localeCompare(first.addedAt)
      if (sort === 'title') return first.title.localeCompare(second.title, 'ja')
      return first.priority - second.priority || second.addedAt.localeCompare(first.addedAt)
    })
  }, [downloads, filter, searchQuery, sort])

  const hasActiveFilters = filter !== 'all' || searchQuery.trim().length > 0
  const activeDownloads = counts.running + counts.queued

  const announce = (message: string) => {
    setFeedback(message)
  }

  const pauseDownload = (id: string) => {
    const job = downloads.find((download) => download.id === id)
    if (!job) return

    setDownloads((current) => current.map((download) => download.id === id
      ? {
        ...download,
        status: 'paused',
        speed: undefined,
        remainingTime: undefined,
        queuePosition: undefined,
      }
      : download))
    announce(`${job.title}を一時停止しました`)
  }

  const resumeDownload = (id: string) => {
    const job = downloads.find((download) => download.id === id)
    if (!job) return

    setDownloads((current) => current.map((download) => download.id === id
      ? {
        ...download,
        status: 'running',
        speed: download.speed ?? 486.2,
        remainingTime: download.remainingTime ?? '計算中',
        queuePosition: undefined,
        errorMessage: undefined,
      }
      : download))
    announce(`${job.title}を再開しました`)
  }

  const retryDownload = (id: string) => {
    const job = downloads.find((download) => download.id === id)
    if (!job) return

    setDownloads((current) => current.map((download) => download.id === id
      ? {
        ...download,
        status: 'running',
        failedPages: 0,
        speed: 382.4,
        remainingTime: '計算中',
        errorMessage: undefined,
        queuePosition: undefined,
      }
      : download))
    announce(`${job.title}のダウンロードを再試行します`)
  }

  const changePriority = (id: string) => {
    const job = downloads.find((download) => download.id === id)
    if (!job) return

    const nextPriority = (job.priority + 1) % PRIORITY_LABELS.length
    setDownloads((current) => current.map((download) => download.id === id
      ? { ...download, priority: nextPriority }
      : download))
    announce(`${job.title}の優先度を「${getPriorityLabel(nextPriority)}」に変更しました`)
  }

  const deleteDownload = (id: string) => {
    const job = downloads.find((download) => download.id === id)
    if (!job) return

    setDownloads((current) => current.filter((download) => download.id !== id))
    announce(`${job.title}をリストから削除しました`)
  }

  const pauseAllDownloads = () => {
    setDownloads((current) => current.map((download) => download.status === 'running' || download.status === 'queued'
      ? {
        ...download,
        status: 'paused',
        speed: undefined,
        remainingTime: undefined,
        queuePosition: undefined,
      }
      : download))
    announce('実行中と待機中のダウンロードをすべて一時停止しました')
  }

  const resumeAllDownloads = () => {
    setDownloads((current) => current.map((download) => download.status === 'paused'
      ? {
        ...download,
        status: 'running',
        speed: download.speed ?? 486.2,
        remainingTime: download.remainingTime ?? '計算中',
        queuePosition: undefined,
      }
      : download))
    announce('一時停止中のダウンロードをすべて再開しました')
  }

  const refreshDownloads = () => {
    setIsRefreshing(true)
    announce('ダウンロード一覧を更新しました（モック）')
    window.setTimeout(() => setIsRefreshing(false), 550)
  }

  const clearFilters = () => {
    setSearchQuery('')
    setFilter('all')
    announce('フィルターをクリアしました')
  }

  return (
    <section className="download-manager" aria-labelledby="download-manager-title">
      <header className="download-manager__hero">
        <div className="download-manager__heading">
          <span className="download-manager__heading-icon" aria-hidden="true">
            <CloudDownload size={22} strokeWidth={2.1} />
          </span>
          <div>
            <p className="download-manager__eyebrow">BOOK DOWNLOAD MONITOR</p>
            <h1 id="download-manager-title">ダウンロード管理</h1>
            <p className="download-manager__connection" role="status" aria-live="polite">
              <span className="download-manager__connection-dot" aria-hidden="true" />
              <span>接続中</span>
              <span className="download-manager__connection-divider" aria-hidden="true">•</span>
              <span>実行中: {counts.running}</span>
              <span className="download-manager__connection-divider" aria-hidden="true">•</span>
              <span>待機中: {counts.queued}</span>
            </p>
          </div>
        </div>

        <div className="download-manager__global-actions" aria-label="ダウンロード全体の操作">
          <button
            className="download-manager__button download-manager__button--success download-manager__button--icon-only"
            type="button"
            aria-label="全て再開"
            title="全て再開"
            disabled={counts.paused === 0}
            onClick={resumeAllDownloads}
          >
            <Play size={16} aria-hidden="true" />
          </button>
          <button
            className="download-manager__button download-manager__button--warning download-manager__button--icon-only"
            type="button"
            aria-label="全て一時停止"
            title="全て一時停止"
            disabled={activeDownloads === 0}
            onClick={pauseAllDownloads}
          >
            <Pause size={16} aria-hidden="true" />
          </button>
          <button
            className="download-manager__icon-button"
            type="button"
            aria-label="ダウンロード一覧を更新"
            title="ダウンロード一覧を更新"
            disabled={isRefreshing}
            onClick={refreshDownloads}
          >
            <RefreshCw className={isRefreshing ? 'is-spinning' : undefined} size={18} aria-hidden="true" />
          </button>
        </div>
      </header>

      <section className="download-manager__filters" aria-label="ダウンロードの検索と絞り込み">
        <div className="download-manager__search-field">
          <Search size={17} aria-hidden="true" />
          <label className="sr-only" htmlFor="download-manager-search">タイトルまたは作者で検索</label>
          <input
            id="download-manager-search"
            type="search"
            value={searchQuery}
            placeholder="タイトルまたは作者で検索..."
            onChange={(event) => setSearchQuery(event.target.value)}
          />
          {searchQuery && (
            <button
              className="download-manager__search-clear"
              type="button"
              aria-label="検索をクリア"
              title="検索をクリア"
              onClick={() => setSearchQuery('')}
            >
              ×
            </button>
          )}
        </div>

        <div className="download-manager__filter-group" role="radiogroup" aria-label="ダウンロードの状態で絞り込み">
          {FILTERS.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              className={`download-manager__filter-chip download-manager__filter-chip--${key} ${filter === key ? 'is-active' : ''}`}
              type="button"
              role="radio"
              aria-checked={filter === key}
              onClick={() => setFilter(key)}
            >
              <Icon size={14} aria-hidden="true" />
              <span>{label}</span>
              <strong>{counts[key]}</strong>
            </button>
          ))}
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
          {hasActiveFilters && <span className="download-manager__list-header-filter">絞り込み中</span>}
        </p>
        <span className="download-manager__mock-label">モックデータ</span>
      </div>

      {filteredDownloads.length > 0 ? (
        <div className="download-manager__list" aria-live="polite">
          {filteredDownloads.map((download) => (
            <DownloadCard
              key={download.id}
              download={download}
              onPause={pauseDownload}
              onResume={resumeDownload}
              onRetry={retryDownload}
              onPriorityChange={changePriority}
              onDelete={deleteDownload}
            />
          ))}
        </div>
      ) : (
        <div className="download-manager__empty" role="status">
          <span className="download-manager__empty-icon" aria-hidden="true"><Search size={28} /></span>
          <h2>{hasActiveFilters ? '条件に一致するダウンロードがありません' : 'ダウンロードはありません'}</h2>
          <p>{hasActiveFilters ? '検索語やステータスを変更すると、ここに結果が表示されます。' : 'ダウンロードを追加すると、進捗がここに表示されます。'}</p>
          {hasActiveFilters && (
            <button className="download-manager__clear-button" type="button" onClick={clearFilters}>
              フィルターをクリア
            </button>
          )}
        </div>
      )}

      <p className={`download-manager__feedback ${feedback ? 'is-visible' : ''}`} role="status" aria-live="polite">
        <CheckCircle2 size={15} aria-hidden="true" />
        <span>{feedback}</span>
      </p>
    </section>
  )
}

function DownloadCard({
  download,
  onPause,
  onResume,
  onRetry,
  onPriorityChange,
  onDelete,
}: {
  download: DownloadJob
  onPause: (id: string) => void
  onResume: (id: string) => void
  onRetry: (id: string) => void
  onPriorityChange: (id: string) => void
  onDelete: (id: string) => void
}) {
  const presentation = STATUS_PRESENTATIONS[download.status]
  const StatusIcon = presentation.icon
  const progressColor = download.status === 'failed'
    ? 'danger'
    : download.status === 'paused'
      ? 'warning'
      : download.status === 'queued'
        ? 'info'
        : 'primary'

  return (
    <article className={`download-card download-card--${download.status}`}>
      <div className="download-card__cover-wrap">
        <Thumbnail
          src={download.thumbnailUrl}
          alt={`${download.title}の表紙`}
          className="download-card__thumbnail"
          variant={download.cover}
          fallbackText="表紙なし"
          fallbackAriaLabel={`${download.title}の表紙を表示できません`}
        />
        <span className="download-card__cover-status" aria-label={`状態: ${presentation.label}`}>
          <StatusIcon size={12} aria-hidden="true" />
          <span>{presentation.label}</span>
        </span>
      </div>

      <div className="download-card__body">
        <div className="download-card__title-row">
          <div>
            <h2>{download.title}</h2>
            <p className="download-card__artist"><span aria-hidden="true">作家</span>{download.artist}</p>
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
          <strong>{download.progress}%</strong>
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
          {download.status === 'running' && download.speed !== undefined && (
            <span className="download-card__speed">
              <Gauge size={14} aria-hidden="true" />
              {download.speed.toFixed(1)} KB/s
              <span className="download-card__remaining">残り {download.remainingTime ?? '計算中'}</span>
            </span>
          )}
        </div>

        <div className="download-card__status-row">
          <span className={`download-card__status download-card__status--${download.status}`}>
            <StatusIcon size={14} aria-hidden="true" />
            {presentation.label}
          </span>
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
        <button
          className="download-card__action download-card__action--priority download-card__action--icon-only"
          type="button"
          aria-label={`${download.title}の優先度を変更（現在: ${getPriorityLabel(download.priority)}）`}
          title="優先度変更"
          onClick={() => onPriorityChange(download.id)}
        >
          <ArrowDownUp size={16} aria-hidden="true" />
        </button>

        {download.status === 'running' || download.status === 'queued' ? (
          <button
            className="download-card__action download-card__action--pause download-card__action--icon-only"
            type="button"
            aria-label={`${download.title}を一時停止`}
            title="一時停止"
            onClick={() => onPause(download.id)}
          >
            <Pause size={16} aria-hidden="true" />
          </button>
        ) : download.status === 'paused' ? (
          <button
            className="download-card__action download-card__action--resume download-card__action--icon-only"
            type="button"
            aria-label={`${download.title}を再開`}
            title="再開"
            onClick={() => onResume(download.id)}
          >
            <Play size={16} aria-hidden="true" />
          </button>
        ) : (
          <button
            className="download-card__action download-card__action--retry download-card__action--icon-only"
            type="button"
            aria-label={`${download.title}を再試行`}
            title="再試行"
            onClick={() => onRetry(download.id)}
          >
            <RefreshCw size={16} aria-hidden="true" />
          </button>
        )}

        <button
          className="download-card__action download-card__action--delete download-card__action--icon-only"
          type="button"
          aria-label={`${download.title}を削除`}
          title="削除"
          onClick={() => onDelete(download.id)}
        >
          <Trash2 size={16} aria-hidden="true" />
        </button>
      </div>
    </article>
  )
}

export default DownloadManager
