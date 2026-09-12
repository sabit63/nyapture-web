import type { LucideIcon } from 'lucide-react'
import {
  Activity,
  CheckCircle2,
  CircleAlert,
  CircleHelp,
  TriangleAlert,
} from 'lucide-react'

export type DashboardStatusTone = 'success' | 'warning' | 'danger' | 'info' | 'muted'

export type DashboardStatusPresentation = {
  label: string
  tone: DashboardStatusTone
  icon: LucideIcon
}

export const STATUS_ICONS: Record<DashboardStatusTone, LucideIcon> = {
  success: CheckCircle2,
  warning: TriangleAlert,
  danger: CircleAlert,
  info: Activity,
  muted: CircleHelp,
}

export const UNKNOWN_STATUS: DashboardStatusPresentation = {
  label: '不明',
  tone: 'muted',
  icon: STATUS_ICONS.muted,
}

export const LOADING_STATUS: DashboardStatusPresentation = {
  label: '取得中',
  tone: 'muted',
  icon: STATUS_ICONS.muted,
}

export const normalize = (value?: string | null) => value?.trim().toLocaleLowerCase('en-US') ?? ''

export const getDashboardStatus = (value?: string | null): DashboardStatusPresentation => {
  switch (normalize(value)) {
    case 'available':
    case 'connected':
    case 'success':
    case 'succeeded':
    case 'ok':
    case 'healthy':
    case 'passed':
    case 'pass':
    case 'completed':
    case 'complete':
      return { label: '正常', tone: 'success', icon: STATUS_ICONS.success }
    case 'degraded':
    case 'warning':
    case 'warn':
    case 'throttled':
      return { label: '警告', tone: 'warning', icon: STATUS_ICONS.warning }
    case 'error':
    case 'failed':
    case 'failure':
    case 'unavailable':
    case 'disconnected':
      return { label: 'エラー', tone: 'danger', icon: STATUS_ICONS.danger }
    case 'critical':
    case 'fatal':
      return { label: '重大', tone: 'danger', icon: STATUS_ICONS.danger }
    case 'notapplicable':
    case 'not applicable':
    case 'notsupported':
    case 'not supported':
      return { label: '対象外', tone: 'info', icon: STATUS_ICONS.info }
    case 'running':
    case 'processing':
      return { label: '実行中', tone: 'info', icon: STATUS_ICONS.info }
    case 'paused':
      return { label: '一時停止', tone: 'warning', icon: STATUS_ICONS.warning }
    case 'configured':
      return { label: '設定済み', tone: 'success', icon: STATUS_ICONS.success }
    case 'idle':
      return { label: '待機', tone: 'muted', icon: STATUS_ICONS.muted }
    default:
      return UNKNOWN_STATUS
  }
}

export const formatNumber = (value?: number | null) => (
  typeof value === 'number' && Number.isFinite(value) ? new Intl.NumberFormat('ja-JP').format(value) : '—'
)

export const formatCount = formatNumber

export const formatBytes = (value?: number | null) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—'
  if (Math.abs(value) < 1024) return `${formatNumber(value)} B`
  const units = ['KB', 'MB', 'GB', 'TB', 'PB']
  let size = Math.abs(value)
  let unitIndex = -1
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024
    unitIndex += 1
  }
  return `${value < 0 ? '-' : ''}${new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 1 }).format(size)} ${units[unitIndex]}`
}

export { formatDateTime } from '../../models/date-time'

export const textValue = (value?: string | number | boolean | null) => (
  value === undefined || value === null || value === '' ? '—' : String(value)
)

export const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

export const ratio = (value?: number | null) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return clamp(value, 0, 1)
}
