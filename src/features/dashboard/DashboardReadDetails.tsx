import {
  CheckCircle2,
  CircleAlert,
  Database,
  FolderOpen,
  HardDrive,
  Save,
  Search,
  Server,
  Trash2,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ApiError, getErrorMessage } from '../../api'
import {
  clearDashboardLogs,
  getDashboardLogEntries,
  getDataFolderDetails,
  getDataStoreDiagnostics,
} from '../../api/dashboard'
import { useVisiblePolling } from '../../hooks/use-visible-polling'
import {
  clamp,
  formatBytes,
  formatDateTime,
  formatNumber,
  getDashboardStatus,
  mergeDashboardLogs,
  normalize,
  useDashboardResource,
  ConfirmDialog,
  DetailFrame,
  DetailSection,
  MetricCard,
  StatusBadge,
} from './index'
import { Button } from '../../components/ui'
import { VectorDatabaseDetails } from './VectorDatabaseDetails'

const mutationError = (error: unknown) =>
  error instanceof ApiError && error.status === 403
    ? 'この変更操作はローカルまたは信頼済みネットワークからのみ実行できます。'
    : getErrorMessage(error)

const isAbort = (error: unknown, signal: AbortSignal) =>
  signal.aborted || (error instanceof ApiError && error.message.includes('キャンセル'))

export function DataStoreDetails({
  apiRevision,
  refreshRevision = 0,
}: {
  apiRevision: number
  refreshRevision?: number
}) {
  const load = useCallback((signal: AbortSignal) => getDataStoreDiagnostics(signal), [])
  const query = useDashboardResource(apiRevision, 'datastore', 'DataStore', load, refreshRevision)
  useVisiblePolling({ intervalMs: 5_000, enabled: query.ready, poll: query.poll })
  const data = query.data
  if (!data)
    return (
      <DetailFrame title="DataStore" query={query}>
        {null}
      </DetailFrame>
    )

  const connection =
    data.isConnected === true
      ? { label: '接続', tone: 'success' as const, icon: CheckCircle2 }
      : data.isConnected === false
        ? { label: '切断', tone: 'danger' as const, icon: CircleAlert }
        : getDashboardStatus(data.availability ?? data.topology?.availability)
  const availability = data.availability ?? data.topology?.availability
  const availabilityStatus = getDashboardStatus(availability)
  const statistics = data.statistics
  const resources = data.resources ?? []
  const hasIndexes = resources.some((resource) => (resource.indexes?.length ?? 0) > 0)

  return (
    <DetailFrame title="DataStore" query={query}>
      <DetailSection title="接続状態">
        <div className="dashboard-detail__metrics">
          <MetricCard
            label="接続"
            value={
              <StatusBadge tone={connection.tone} icon={connection.icon}>
                {connection.label}
              </StatusBadge>
            }
            icon={Database}
            tone={connection.tone}
          />
          <MetricCard
            label="Provider version"
            value={data.providerVersion || '—'}
            icon={Server}
            tone="info"
          />
          <MetricCard
            label="Store"
            value={data.storeName || statistics?.storeName || '—'}
            icon={HardDrive}
            tone="muted"
          />
          <MetricCard
            label="Availability"
            value={
              <StatusBadge tone={availabilityStatus.tone} icon={availabilityStatus.icon}>
                {availabilityStatus.label}
              </StatusBadge>
            }
            icon={Database}
            tone={availabilityStatus.tone}
          />
        </div>
        <dl className="dashboard-detail__definition-grid">
          <div>
            <dt>Diagnostic code</dt>
            <dd>{data.diagnosticCode || data.topology?.diagnosticCode || '—'}</dd>
          </div>
          <div>
            <dt>Topology</dt>
            <dd>{data.topology?.state || '—'}</dd>
          </div>
          <div>
            <dt>Available stores</dt>
            <dd>{statistics?.availableStoreNames?.join(', ') || '—'}</dd>
          </div>
        </dl>
        {data.error && (
          <div className="dashboard-detail__error" role="alert">
            <CircleAlert size={15} aria-hidden="true" />
            <span>{data.error}</span>
          </div>
        )}
      </DetailSection>
      <DetailSection title="統計">
        <div className="dashboard-detail__metrics">
          <MetricCard
            label="Books"
            value={formatNumber(statistics?.bookCount)}
            icon={Database}
            tone="info"
          />
          <MetricCard
            label="Tags"
            value={formatNumber(statistics?.tagCount)}
            icon={Database}
            tone="muted"
          />
          <MetricCard
            label="Indexes"
            value={formatNumber(statistics?.indexCount)}
            icon={Server}
            tone="muted"
          />
          <MetricCard
            label="Data size"
            value={formatBytes(statistics?.dataSizeBytes)}
            icon={HardDrive}
            tone="muted"
          />
        </div>
        <div className="dashboard-detail__meta">
          <span>Observed {formatDateTime(statistics?.observedAt)}</span>
        </div>
      </DetailSection>
      <VectorDatabaseDetails data={data.vectorDatabase} />
      <DetailSection title="Resources" count={formatNumber(resources.length)}>
        <div
          className="dashboard-detail__table-wrap"
          role="region"
          aria-label="DataStoreリソース"
          tabIndex={0}
        >
          <table className="dashboard-detail__table">
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Records</th>
                <th scope="col">Size</th>
                <th scope="col">Indexes</th>
                <th scope="col">Availability</th>
              </tr>
            </thead>
            <tbody>
              {resources.map((resource, index) => {
                const status = getDashboardStatus(resource.availability)
                return (
                  <tr key={`${resource.name ?? 'resource'}-${index}`}>
                    <th scope="row">{resource.name || '—'}</th>
                    <td>{formatNumber(resource.recordCount)}</td>
                    <td>{formatBytes(resource.sizeBytes)}</td>
                    <td>{formatNumber(resource.indexCount)}</td>
                    <td>
                      <StatusBadge tone={status.tone} icon={status.icon}>
                        {status.label}
                      </StatusBadge>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {!resources.length && <div className="dashboard-detail__empty">—</div>}
        </div>
        {hasIndexes && (
          <div
            className="dashboard-detail__table-wrap"
            role="region"
            aria-label="DataStoreインデックス"
            tabIndex={0}
          >
            <table className="dashboard-detail__table">
              <thead>
                <tr>
                  <th scope="col">Resource</th>
                  <th scope="col">Index</th>
                  <th scope="col">Definition</th>
                  <th scope="col">Unique</th>
                  <th scope="col">Availability</th>
                </tr>
              </thead>
              <tbody>
                {resources.flatMap((resource, resourceIndex) =>
                  (resource.indexes ?? []).map((indexInfo, indexIndex) => {
                    const status = getDashboardStatus(indexInfo.availability)
                    return (
                      <tr key={`${resource.name ?? resourceIndex}-${indexInfo.name ?? indexIndex}`}>
                        <th scope="row">{resource.name || '—'}</th>
                        <td>{indexInfo.name || '—'}</td>
                        <td>
                          <code className="dashboard-detail__value-truncate">
                            {indexInfo.definition || '—'}
                          </code>
                        </td>
                        <td>{indexInfo.isUnique ? 'Yes' : 'No'}</td>
                        <td>
                          <StatusBadge tone={status.tone} icon={status.icon}>
                            {status.label}
                          </StatusBadge>
                        </td>
                      </tr>
                    )
                  }),
                )}
              </tbody>
            </table>
          </div>
        )}
      </DetailSection>
    </DetailFrame>
  )
}

/** Backward-compatible export for callers that used the old component name. */
export const MongoDbDetails = DataStoreDetails

export function DataFolderDetails({
  apiRevision,
  refreshRevision = 0,
}: {
  apiRevision: number
  refreshRevision?: number
}) {
  const load = useCallback((signal: AbortSignal) => getDataFolderDetails(signal), [])
  const query = useDashboardResource(apiRevision, 'datafolder', 'DataFolder', load, refreshRevision)
  const data = query.data
  if (!data)
    return (
      <DetailFrame title="DataFolder" query={query}>
        {null}
      </DetailFrame>
    )
  const total = typeof data.totalBytes === 'number' && data.totalBytes > 0 ? data.totalBytes : null
  const used =
    typeof data.usedBytes === 'number'
      ? data.usedBytes
      : total !== null && typeof data.freeBytes === 'number'
        ? total - data.freeBytes
        : null
  const usageRatio =
    typeof data.usageRatio === 'number'
      ? clamp(data.usageRatio > 1 ? data.usageRatio / 100 : data.usageRatio, 0, 1)
      : total !== null && used !== null
        ? clamp(used / total, 0, 1)
        : null
  const percent = usageRatio === null ? null : Math.round(usageRatio * 100)
  const tone =
    percent !== null && percent >= 90
      ? ('danger' as const)
      : percent !== null && percent >= 75
        ? ('warning' as const)
        : ('success' as const)
  return (
    <DetailFrame title="DataFolder" query={query}>
      <DetailSection title="状態">
        <div className="dashboard-detail__metrics">
          <MetricCard
            label="Path"
            value={<span className="dashboard-detail__value-truncate">{data.path || '—'}</span>}
            icon={FolderOpen}
            tone="info"
          />
          <MetricCard
            label="Exists"
            value={
              <StatusBadge
                tone={data.exists === true ? 'success' : data.exists === false ? 'danger' : 'muted'}
              >
                {data.exists === true ? '存在' : data.exists === false ? 'なし' : '—'}
              </StatusBadge>
            }
            icon={FolderOpen}
            tone="success"
          />
          <MetricCard
            label="Writable"
            value={
              <StatusBadge
                tone={
                  data.isWritable === true
                    ? 'success'
                    : data.isWritable === false
                      ? 'warning'
                      : 'muted'
                }
              >
                {data.isWritable === true ? '書込可' : data.isWritable === false ? '読取専用' : '—'}
              </StatusBadge>
            }
            icon={Save}
            tone="success"
          />
        </div>
      </DetailSection>
      <DetailSection title="容量">
        <div className="dashboard-detail__storage">
          <div className="dashboard-detail__storage-heading">
            <strong>{percent === null ? '—' : `${percent}%`}</strong>
            {percent !== null && (
              <StatusBadge tone={tone}>
                {tone === 'danger' ? '危険' : tone === 'warning' ? '警告' : '正常'}
              </StatusBadge>
            )}
          </div>
          <div
            className={`dashboard-detail__progress dashboard-detail__progress--${tone}`}
            role="progressbar"
            aria-label="使用率"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent ?? undefined}
          >
            <span style={{ width: `${percent ?? 0}%` }} />
          </div>
          <dl className="dashboard-detail__definition-grid">
            <div>
              <dt>Used</dt>
              <dd>{formatBytes(used)}</dd>
            </div>
            <div>
              <dt>Free</dt>
              <dd>{formatBytes(data.freeBytes)}</dd>
            </div>
            <div>
              <dt>Total</dt>
              <dd>{formatBytes(total)}</dd>
            </div>
          </dl>
        </div>
        {data.error && (
          <div className="dashboard-detail__error" role="alert">
            <CircleAlert size={15} aria-hidden="true" />
            <span>{data.error}</span>
          </div>
        )}
      </DetailSection>
    </DetailFrame>
  )
}

type LogLevelFilter = 'All' | 'Information' | 'Warning' | 'Error' | 'Critical'
const visibleLogLevel = (level?: string | null) => {
  const value = normalize(level)
  if (value === 'critical' || value === 'fatal') return 'Critical'
  if (value === 'error' || value === 'failed') return 'Error'
  if (value === 'warning' || value === 'warn') return 'Warning'
  if (value === 'information' || value === 'info') return 'Information'
  return level?.trim() || '—'
}
const levelParam = (level: LogLevelFilter): Parameters<typeof getDashboardLogEntries>[1] =>
  level === 'All' ? undefined : level

export function LogsDetails({
  apiRevision,
  refreshRevision = 0,
}: {
  apiRevision: number
  refreshRevision?: number
}) {
  const [level, setLevel] = useState<LogLevelFilter>('All')
  const [category, setCategory] = useState('All')
  const [keyword, setKeyword] = useState('')
  const [autoScroll, setAutoScroll] = useState(true)
  const [clearOpen, setClearOpen] = useState(false)
  const [clearPending, setClearPending] = useState(false)
  const [feedback, setFeedback] = useState<string | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const clearRef = useRef<AbortController | null>(null)
  const latestSequenceRef = useRef(0)
  const load = useCallback(
    (signal: AbortSignal) => getDashboardLogEntries(0, levelParam(level), signal),
    [level],
  )
  const query = useDashboardResource(apiRevision, `logs:${level}`, 'Logs', load, refreshRevision)
  const { update: updateQuery } = query

  useEffect(() => {
    latestSequenceRef.current = Math.max(
      query.data?.latestSequence ?? 0,
      ...(query.data?.entries ?? []).map((entry) => entry.sequence ?? 0),
    )
  }, [query.data])
  const poll = useCallback(
    async (signal: AbortSignal) => {
      if (signal.aborted) return
      try {
        const response = await getDashboardLogEntries(
          latestSequenceRef.current,
          levelParam(level),
          signal,
        )
        if (signal.aborted || response.success === false) return
        updateQuery((current) => mergeDashboardLogs(current, response.data ?? null))
        latestSequenceRef.current = Math.max(
          latestSequenceRef.current,
          response.data?.latestSequence ?? 0,
        )
      } catch {
        // Incremental logs are best-effort; the next visible poll can recover.
      }
    },
    [level, updateQuery],
  )
  useVisiblePolling({ intervalMs: 2_000, enabled: query.ready, poll })
  useEffect(() => {
    const controller = clearRef.current
    return () => controller?.abort()
  }, [])

  const categories = useMemo(
    () => [
      'All',
      ...Array.from(
        new Set(
          (query.data?.entries ?? [])
            .map((entry) => entry.category?.trim())
            .filter((value): value is string => Boolean(value)),
        ),
      ).sort((a, b) => a.localeCompare(b)),
    ],
    [query.data],
  )
  const entries = useMemo(() => {
    const search = keyword.trim().toLocaleLowerCase('ja-JP')
    return (query.data?.entries ?? []).filter(
      (entry) =>
        (category === 'All' || entry.category === category) &&
        (!search ||
          [entry.level, entry.category, entry.message, entry.exception].some((value) =>
            value?.toLocaleLowerCase('ja-JP').includes(search),
          )),
    )
  }, [category, keyword, query.data])
  useEffect(() => {
    if (autoScroll && listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight
  }, [autoScroll, entries.length])

  const clearLogs = async () => {
    if (clearPending) return
    const controller = new AbortController()
    clearRef.current = controller
    setClearPending(true)
    setFeedback(null)
    try {
      const response = await clearDashboardLogs(controller.signal)
      if (controller.signal.aborted) return
      if (response.success === false)
        throw new ApiError(response.message ?? 'ログのクリアに失敗しました。', {
          category: 'server',
        })
      setFeedback(response.message ?? 'クリア済み')
      setClearOpen(false)
      latestSequenceRef.current = 0
      await query.refresh()
    } catch (error: unknown) {
      if (!isAbort(error, controller.signal)) setFeedback(mutationError(error))
    } finally {
      if (clearRef.current === controller) clearRef.current = null
      if (!controller.signal.aborted) setClearPending(false)
    }
  }

  const data = query.data
  if (!data)
    return (
      <DetailFrame title="Logs" query={query}>
        {null}
      </DetailFrame>
    )
  return (
    <DetailFrame title="Logs" query={query}>
      <DetailSection title="ログ" count={formatNumber(entries.length)}>
        <div className="dashboard-detail__toolbar">
          <label className="dashboard-detail__filter-label" htmlFor="dashboard-log-level">
            Level
            <select
              id="dashboard-log-level"
              value={level}
              onChange={(event) => setLevel(event.target.value as LogLevelFilter)}
            >
              <option value="All">All</option>
              <option value="Information">Information</option>
              <option value="Warning">Warning</option>
              <option value="Error">Error</option>
              <option value="Critical">Critical</option>
            </select>
          </label>
          <label className="dashboard-detail__filter-label" htmlFor="dashboard-log-category">
            Category
            <select
              id="dashboard-log-category"
              value={category}
              onChange={(event) => setCategory(event.target.value)}
            >
              {categories.map((item) => (
                <option value={item} key={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
          <label className="dashboard-detail__search-field" htmlFor="dashboard-log-keyword">
            <Search size={14} aria-hidden="true" />
            <span className="sr-only">Keyword</span>
            <input
              id="dashboard-log-keyword"
              type="search"
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              placeholder="Keyword"
            />
          </label>
          <label className="dashboard-detail__check-label">
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={(event) => setAutoScroll(event.target.checked)}
            />
            自動スクロール
          </label>
          <Button
            ref={triggerRef}
            variant="solid"
            tone="danger"
            size="default"
            type="button"
            onClick={() => setClearOpen(true)}
          >
            <Trash2 size={15} aria-hidden="true" />
            クリア
          </Button>
        </div>
        <div
          ref={listRef}
          className="dashboard-detail__table-wrap dashboard-detail__log-scroll"
          role="region"
          aria-label="ログ一覧"
          tabIndex={0}
        >
          <table className="dashboard-detail__table">
            <caption className="sr-only">ログ一覧</caption>
            <thead>
              <tr>
                <th scope="col">時刻</th>
                <th scope="col">Level</th>
                <th scope="col">Category</th>
                <th scope="col">Message</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry, index) => {
                const status = getDashboardStatus(entry.level)
                return (
                  <tr key={`${entry.sequence ?? 'entry'}-${index}`}>
                    <td>
                      <time dateTime={entry.timestamp ?? undefined}>
                        {formatDateTime(entry.timestamp)}
                      </time>
                    </td>
                    <td>
                      <StatusBadge tone={status.tone} icon={status.icon}>
                        {visibleLogLevel(entry.level)}
                      </StatusBadge>
                    </td>
                    <td>{entry.category || '—'}</td>
                    <td>
                      <span className="dashboard-detail__log-message">{entry.message || '—'}</span>
                      {entry.exception && (
                        <details className="dashboard-detail__exception">
                          <summary>例外</summary>
                          <pre>{entry.exception}</pre>
                        </details>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {!entries.length && <div className="dashboard-detail__empty">—</div>}
        </div>
        {feedback && (
          <span className="dashboard-detail__feedback" role="status">
            {feedback}
          </span>
        )}
      </DetailSection>
      <ConfirmDialog
        open={clearOpen}
        title="ログ クリア"
        value={
          <StatusBadge tone="danger" icon={Trash2}>
            全ログ
          </StatusBadge>
        }
        pending={clearPending}
        confirmLabel="クリア"
        triggerRef={triggerRef}
        onConfirm={() => void clearLogs()}
        onDismiss={() => setClearOpen(false)}
      />
    </DetailFrame>
  )
}
