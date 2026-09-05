import {
  ArrowLeft,
  Database,
  FolderOpen,
  Image,
  ListChecks,
  RefreshCw,
  Server,
  Wrench,
  Zap,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useState } from 'react'
import {
  CacheDetails,
  MaintenanceDetails,
  ServiceDetails,
} from './DashboardActionDetails'
import {
  DataFolderDetails,
  LogsDetails,
  MongoDbDetails,
} from './DashboardReadDetails'
import { InternalLink } from '../app/client-router'
import { buttonClassName, IconButton } from './ui'
import './dashboard-details.css'

export type DashboardDetailRoute =
  | 'mongodb'
  | 'datafolder'
  | 'webpilot'
  | 'image-worker'
  | 'maintenance'
  | 'cache'
  | 'logs'

type RouteMeta = { title: string; icon: LucideIcon }

const ROUTE_META: Record<DashboardDetailRoute, RouteMeta> = {
  mongodb: { title: 'MongoDB', icon: Database },
  datafolder: { title: 'DataFolder', icon: FolderOpen },
  webpilot: { title: 'WebPilot', icon: Server },
  'image-worker': { title: 'ImageWorker', icon: Image },
  maintenance: { title: 'Maintenance', icon: Wrench },
  cache: { title: 'Cache', icon: Zap },
  logs: { title: 'Logs', icon: ListChecks },
}

export const getDashboardRouteTitle = (route: DashboardDetailRoute) => ROUTE_META[route].title

export type DashboardDetailsProps = {
  route: DashboardDetailRoute
  apiRevision: number
}

export function DashboardDetails({ route, apiRevision }: DashboardDetailsProps) {
  const [refreshRevision, setRefreshRevision] = useState(0)
  const meta = ROUTE_META[route]
  const Icon = meta.icon
  const detailRevision = apiRevision + refreshRevision

  return (
    <section className="dashboard-detail" aria-labelledby="dashboard-detail-title">
      <header className="dashboard-detail__header">
        <InternalLink className={buttonClassName({ variant: 'ghost', tone: 'neutral', size: 'compact' }, 'dashboard-detail__icon-button')} href="/dashboard" aria-label="Dashboardへ戻る"><ArrowLeft size={18} aria-hidden="true" /></InternalLink>
        <span className="dashboard-detail__route-icon" aria-hidden="true"><Icon size={22} /></span>
        <h1 id="dashboard-detail-title">{meta.title}</h1>
        <IconButton variant="ghost" tone="neutral" size="compact" className="dashboard-detail__icon-button dashboard-detail__refresh" type="button" aria-label="更新" onClick={() => setRefreshRevision((revision) => revision + 1)}><RefreshCw size={17} aria-hidden="true" /></IconButton>
      </header>
      <div className="dashboard-detail__body">
        {route === 'mongodb' && <MongoDbDetails apiRevision={detailRevision} />}
        {route === 'datafolder' && <DataFolderDetails apiRevision={detailRevision} />}
        {route === 'webpilot' && <ServiceDetails service="webpilot" apiRevision={detailRevision} />}
        {route === 'image-worker' && <ServiceDetails service="image-worker" apiRevision={detailRevision} />}
        {route === 'maintenance' && <MaintenanceDetails apiRevision={detailRevision} />}
        {route === 'cache' && <CacheDetails apiRevision={detailRevision} />}
        {route === 'logs' && <LogsDetails apiRevision={detailRevision} />}
      </div>
    </section>
  )
}

export default DashboardDetails
