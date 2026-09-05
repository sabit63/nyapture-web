import { ApiError } from '../../api'
import type {
  CacheClearState,
  DashboardLogEntryDto,
  DashboardLogsResponse,
} from '../../models/dashboard'

export const isCacheClearConflict = (error: unknown): error is ApiError => (
  error instanceof ApiError && error.status === 409
)

export const cacheClearStateLabel = (state?: CacheClearState | string | null) => {
  switch (state?.trim().toLocaleLowerCase('en-US')) {
    case 'running': return 'Running'
    case 'completed':
    case 'complete': return 'Completed'
    case 'failed':
    case 'failure': return 'Failed'
    case 'idle': return 'Idle'
    default: return null
  }
}

export const cacheClearStateTone = (state?: CacheClearState | string | null) => {
  switch (state?.trim().toLocaleLowerCase('en-US')) {
    case 'running': return 'info' as const
    case 'completed':
    case 'complete': return 'success' as const
    case 'failed':
    case 'failure': return 'danger' as const
    default: return 'muted' as const
  }
}

export const mergeDashboardLogs = (
  current: DashboardLogsResponse | null,
  incoming: DashboardLogsResponse | null,
  replace = false,
): DashboardLogsResponse => {
  const entries = replace ? incoming?.entries ?? [] : [...(current?.entries ?? []), ...(incoming?.entries ?? [])]
  const bySequence = new Map<string, DashboardLogEntryDto>()
  entries.forEach((entry, index) => {
    const key = entry.sequence == null
      ? `${entry.timestamp ?? ''}-${entry.category ?? ''}-${entry.message ?? ''}-${index}`
      : String(entry.sequence)
    bySequence.set(key, entry)
  })
  const nextEntries = Array.from(bySequence.values())
    .sort((left, right) => (left.sequence ?? 0) - (right.sequence ?? 0))
    .slice(-500)
  return {
    ...(current ?? {}),
    ...(incoming ?? {}),
    entries: nextEntries,
    latestSequence: Math.max(
      current?.latestSequence ?? 0,
      incoming?.latestSequence ?? 0,
      ...nextEntries.map((entry) => entry.sequence ?? 0),
    ),
  }
}

