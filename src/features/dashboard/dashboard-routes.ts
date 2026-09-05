import {
  Database,
  FolderOpen,
  Image,
  ListChecks,
  Server,
  Wrench,
  Zap,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

export type DashboardDetailRoute =
  | 'datastore'
  | 'mongodb'
  | 'datafolder'
  | 'webpilot'
  | 'image-worker'
  | 'maintenance'
  | 'cache'
  | 'web-cache'
  | 'logs'

export type DashboardRoute = 'home' | DashboardDetailRoute

type RouteMeta = { title: string; icon: LucideIcon }

export const DASHBOARD_ROUTE_META: Record<DashboardDetailRoute, RouteMeta> = {
  datastore: { title: 'DataStore', icon: Database },
  mongodb: { title: 'DataStore', icon: Database },
  datafolder: { title: 'DataFolder', icon: FolderOpen },
  webpilot: { title: 'WebPilot', icon: Server },
  'image-worker': { title: 'ImageWorker', icon: Image },
  maintenance: { title: 'Maintenance', icon: Wrench },
  cache: { title: 'Cache', icon: Zap },
  'web-cache': { title: 'Web Cache', icon: Server },
  logs: { title: 'Logs', icon: ListChecks },
}

export const getDashboardRouteTitle = (route: DashboardDetailRoute) => DASHBOARD_ROUTE_META[route].title

const DASHBOARD_PATHS: Record<string, DashboardRoute> = {
  '/dashboard': 'home',
  '/dashboard/datastore': 'datastore',
  '/dashboard/mongodb': 'mongodb',
  '/dashboard/datafolder': 'datafolder',
  '/dashboard/webpilot': 'webpilot',
  '/dashboard/image-worker': 'image-worker',
  '/dashboard/maintenance': 'maintenance',
  '/dashboard/cache': 'cache',
  '/dashboard/web-cache': 'web-cache',
  '/dashboard/logs': 'logs',
}

export const resolveDashboardRoute = (path?: string): DashboardRoute => {
  const source = path ?? (typeof window === 'undefined' ? '/dashboard' : window.location.pathname)
  const pathname = (source.split(/[?#]/)[0] || '/').replace(/\/+$/, '') || '/'
  return DASHBOARD_PATHS[pathname] ?? 'home'
}

