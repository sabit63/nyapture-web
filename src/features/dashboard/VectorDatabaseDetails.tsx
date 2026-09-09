import { Database, HardDrive, Server } from 'lucide-react'
import type { RecommendationModeDto, VectorDatabaseDiagnosticsDto } from '../../models/dashboard'
import { DetailSection, MetricCard, StatusBadge, type DashboardDetailTone } from './dashboard-detail-components'
import { formatBytes, formatDateTime, formatNumber } from './formatters'

const statuses: Record<string, { label: string; tone: DashboardDetailTone }> = {
  disabled: { label: '無効', tone: 'muted' },
  not_initialized: { label: '未初期化', tone: 'warning' },
  building: { label: '構築中', tone: 'info' },
  ready: { label: '利用可能', tone: 'success' },
  unavailable: { label: '利用不可', tone: 'danger' },
  active: { label: '稼働中', tone: 'success' },
  retired: { label: '退役済み', tone: 'muted' },
}
const methods = { A: 'A · Jaccard', B: 'B · タグコサイン', C: 'C · 意味コサイン', D: 'D · RRF' }
const booleanLabel = (value?: boolean | null) => value === true ? '有効' : value === false ? '無効' : '—'

function VectorStatus({ value }: { value?: string }) {
  const status = value ? statuses[value] : undefined
  return <StatusBadge tone={status?.tone ?? 'muted'}>{status?.label ?? value ?? '—'}</StatusBadge>
}

function RecommendationMode({ mode }: { mode?: RecommendationModeDto | null }) {
  if (!mode) return <p className="dashboard-detail__empty">—</p>
  return (
    <dl className="dashboard-detail__definition-grid">
      <div><dt>推薦方式</dt><dd>{mode.method ? methods[mode.method] ?? mode.method : '—'}</dd></div>
      <div><dt>重み付けバージョン</dt><dd>{mode.exactWeightingVersion || '—'}</dd></div>
      <div><dt>埋め込み生成</dt><dd>{booleanLabel(mode.generateEmbeddings)}</dd></div>
      <div><dt>モデル</dt><dd>{mode.modelId || '—'}</dd></div>
      <div><dt>モデルリビジョン</dt><dd>{mode.modelRevision || '—'}</dd></div>
      <div><dt>方向別の推薦方式</dt><dd>{Object.entries(mode.directionMethods ?? {}).length
        ? Object.entries(mode.directionMethods ?? {}).map(([direction, method]) => (
          <div key={direction}>{direction}: {methods[method] ?? method}</div>
        )) : '—'}</dd></div>
    </dl>
  )
}

export function VectorDatabaseDetails({ data }: { data?: VectorDatabaseDiagnosticsDto | null }) {
  if (!data) return null
  const generations = data.generations ?? []
  return (
    <DetailSection title="ベクトルDB" className="dashboard-detail__vector">
      <div className="dashboard-detail__metrics">
        <MetricCard label="状態" value={<VectorStatus value={data.status} />} icon={Database} />
        <MetricCard label="pgvector バージョン" value={data.providerVersion || '—'} icon={Server} />
        <MetricCard label="総使用容量" value={formatBytes(data.totalStorageBytes)} icon={HardDrive} />
        <MetricCard label="共有容量" value={formatBytes(data.sharedStorageBytes)} icon={HardDrive} />
      </div>
      <p className="dashboard-detail__meta">総使用容量にはインデックス・TOAST・退役済み世代を含みます。</p>
      <dl className="dashboard-detail__definition-grid">
        <div><dt>ベクトルDB</dt><dd>{booleanLabel(data.enabled)}</dd></div>
        <div><dt>ワーカー</dt><dd>{booleanLabel(data.workerEnabled)}</dd></div>
        <div><dt>稼働中のプロファイル</dt><dd>{data.activeProfileVersion || '—'}</dd></div>
        <div><dt>観測日時</dt><dd>{formatDateTime(data.observedAt)}</dd></div>
        <div><dt>最終試行</dt><dd>{formatDateTime(data.lastAttemptAt)}</dd></div>
        <div><dt>最終成功</dt><dd>{formatDateTime(data.lastSuccessAt)}</dd></div>
      </dl>
      {data.lastError && <div className="dashboard-detail__error" role="alert">{data.lastError}</div>}
      <div className="dashboard-detail__panel"><h3>設定された推薦方式</h3><RecommendationMode mode={data.configuredMode} /></div>
      <div className="dashboard-detail__panel"><h3>稼働中の推薦方式</h3><RecommendationMode mode={data.activeMode} /></div>
      <h3>世代別の処理状況 ({formatNumber(generations.length)})</h3>
      <p className="dashboard-detail__meta">評価済みBooksはワーカーが最後に記録した件数です。構築全体の完了率を示すものではありません。</p>
      {!generations.length && <div className="dashboard-detail__empty">世代情報はありません。</div>}
      {generations.map((generation, index) => (
        <article className="dashboard-detail__panel" key={`${generation.profileVersion}-${index}`}>
          <div className="dashboard-detail__status-row">
            <h3>{generation.profileVersion || '—'}</h3><VectorStatus value={generation.state} />
          </div>
          <dl className="dashboard-detail__definition-grid">
            <div><dt>カタログBooks</dt><dd>{formatNumber(generation.catalogBooks)}</dd></div>
            <div><dt>評価済みBooks</dt><dd>{formatNumber(generation.evaluatedBooks)}</dd></div>
            <div><dt>失敗Books</dt><dd>{formatNumber(generation.failedBooks)}</dd></div>
            <div><dt>保留Books</dt><dd>{formatNumber(generation.pendingBooks)}</dd></div>
            <div><dt>保留エンティティ</dt><dd>{formatNumber(generation.pendingEntities)}</dd></div>
            <div><dt>Books容量</dt><dd>{formatBytes(generation.bookStorageBytes)}</dd></div>
            <div><dt>エンティティ容量</dt><dd>{formatBytes(generation.entityStorageBytes)}</dd></div>
            <div><dt>作成日時</dt><dd>{formatDateTime(generation.createdAt)}</dd></div>
            <div><dt>最終整合日時</dt><dd>{formatDateTime(generation.lastReconciledAt)}</dd></div>
          </dl>
          <details><summary>世代の推薦方式</summary><RecommendationMode mode={generation.mode} /></details>
        </article>
      ))}
    </DetailSection>
  )
}
