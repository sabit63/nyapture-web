import {
  ArrowLeft,
  RefreshCw,
} from 'lucide-react'
import { useState } from 'react'
import {
  CacheDetails,
  MaintenanceDetails,
  ServiceDetails,
} from './DashboardActionDetails'
import {
  DataFolderDetails,
  LogsDetails,
  DataStoreDetails,
} from './DashboardReadDetails'
import { InternalLink } from '../app/client-router'
import { buttonClassName, IconButton } from './ui'
import './dashboard-details.css'
import { WebCacheManagement } from '../features/web-cache/WebCacheManagement'
import {
  DASHBOARD_ROUTE_META,
  type DashboardDetailRoute,
} from '../features/dashboard/dashboard-routes'

export type { DashboardDetailRoute } from '../features/dashboard/dashboard-routes'
// Keep the legacy helper import path stable for route-aware callers.
// oxlint-disable-next-line react/only-export-components
export { getDashboardRouteTitle } from '../features/dashboard/dashboard-routes'

export type DashboardDetailsProps = {
  route: DashboardDetailRoute
  apiRevision: number
}

export function DashboardDetails({ route, apiRevision }: DashboardDetailsProps) {
  const [refreshRevision, setRefreshRevision] = useState(0)
  const meta = DASHBOARD_ROUTE_META[route]
  const Icon = meta.icon

  return (
    <section className="dashboard-detail" aria-labelledby="dashboard-detail-title">
      <header className="dashboard-detail__header">
        <InternalLink className={buttonClassName({ variant: 'ghost', tone: 'neutral', size: 'compact' }, 'dashboard-detail__icon-button')} href="/dashboard" aria-label="Dashboardへ戻る"><ArrowLeft size={18} aria-hidden="true" /></InternalLink>
        <span className="dashboard-detail__route-icon" aria-hidden="true"><Icon size={22} /></span>
        <h1 id="dashboard-detail-title">{meta.title}</h1>
        {route !== 'web-cache' && <IconButton variant="ghost" tone="neutral" size="compact" className="dashboard-detail__icon-button dashboard-detail__refresh" type="button" aria-label="更新" onClick={() => setRefreshRevision((revision) => revision + 1)}><RefreshCw size={17} aria-hidden="true" /></IconButton>}
      </header>
      <div className="dashboard-detail__body">
        {(route === 'datastore' || route === 'mongodb') && <DataStoreDetails apiRevision={apiRevision} refreshRevision={refreshRevision} />}
        {route === 'datafolder' && <DataFolderDetails apiRevision={apiRevision} refreshRevision={refreshRevision} />}
        {route === 'webpilot' && <ServiceDetails service="webpilot" apiRevision={apiRevision} refreshRevision={refreshRevision} />}
        {route === 'image-worker' && <ServiceDetails service="image-worker" apiRevision={apiRevision} refreshRevision={refreshRevision} />}
        {route === 'maintenance' && <MaintenanceDetails apiRevision={apiRevision} refreshRevision={refreshRevision} />}
        {route === 'cache' && <CacheDetails apiRevision={apiRevision} refreshRevision={refreshRevision} />}
        {route === 'web-cache' && <WebCacheManagement apiRevision={apiRevision} />}
        {route === 'logs' && <LogsDetails apiRevision={apiRevision} refreshRevision={refreshRevision} />}
      </div>
    </section>
  )
}

export default DashboardDetails
