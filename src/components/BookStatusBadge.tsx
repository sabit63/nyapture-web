import {
  CheckCircle2,
  CircleHelp,
  CircleSlash2,
  Cloud,
  Clock3,
  FileWarning,
  Save,
  Search,
  Trash2,
  TriangleAlert,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { BOOK_STATUS_LABELS, type NyaBookStatus } from '../models'
import './book-status-badge.css'

type StatusTone = 'info' | 'candidate' | 'accent' | 'neutral' | 'danger' | 'warning' | 'destructive' | 'muted'
type StatusEffect = 'none' | 'candidate' | 'error' | 'short-page' | 'shredding' | 'deleted'

type Presentation = {
  tone: StatusTone
  effect: StatusEffect
  icon: LucideIcon | null
  animated: boolean
}

const STATUS_PRESENTATIONS: Record<NyaBookStatus, Presentation> = {
  Unknown: {
    tone: 'neutral',
    effect: 'none',
    icon: CircleHelp,
    animated: false,
  },
  Standby: {
    tone: 'accent',
    effect: 'none',
    icon: Clock3,
    animated: false,
  },
  Downloaded: {
    tone: 'muted',
    effect: 'none',
    icon: CheckCircle2,
    animated: false,
  },
  Downloading: {
    tone: 'info',
    effect: 'none',
    icon: null,
    animated: true,
  },
  Cancel: {
    tone: 'warning',
    effect: 'none',
    icon: CircleSlash2,
    animated: false,
  },
  DownloadError: {
    tone: 'danger',
    effect: 'error',
    icon: TriangleAlert,
    animated: false,
  },
  SaveError: {
    tone: 'danger',
    effect: 'error',
    icon: Save,
    animated: false,
  },
  ShortPage: {
    tone: 'danger',
    effect: 'short-page',
    icon: FileWarning,
    animated: false,
  },
  Shredding: {
    tone: 'destructive',
    effect: 'shredding',
    icon: null,
    animated: true,
  },
  Deleted: {
    tone: 'muted',
    effect: 'deleted',
    icon: Trash2,
    animated: false,
  },
  WebBook: {
    tone: 'info',
    effect: 'none',
    icon: Cloud,
    animated: false,
  },
  WebBookInPage: {
    tone: 'candidate',
    effect: 'candidate',
    icon: Search,
    animated: false,
  },
}

const isNyaBookStatus = (value: unknown): value is NyaBookStatus => (
  typeof value === 'string' && Object.prototype.hasOwnProperty.call(STATUS_PRESENTATIONS, value)
)

export type BookStatusBadgeProps = {
  status: NyaBookStatus
  variant?: 'card' | 'inline'
}

export function BookStatusBadge({ status, variant = 'card' }: BookStatusBadgeProps) {
  const resolvedStatus: NyaBookStatus = isNyaBookStatus(status) ? status : 'Unknown'
  const presentation = STATUS_PRESENTATIONS[resolvedStatus]
  const label = resolvedStatus === 'Downloading' ? 'DL' : BOOK_STATUS_LABELS[resolvedStatus]

  if (resolvedStatus === 'Downloaded' && variant === 'card') {
    return <span className="sr-only" data-book-status={resolvedStatus}>状態: {label}</span>
  }

  const Icon = presentation.icon
  const badgeClassName = [
    'book-status-badge',
    `book-status-badge--${presentation.tone}`,
    presentation.animated && 'book-status-badge--animated',
    variant === 'inline' && 'book-status-badge--inline',
  ].filter(Boolean).join(' ')

  if (variant === 'inline') {
    return (
      <span className={badgeClassName} data-book-status={resolvedStatus}>
        <span className="book-status-badge__dot" aria-hidden="true" />
        {resolvedStatus === 'Downloaded' ? (
          <span className="sr-only">状態: {label}</span>
        ) : (
          <>
            <span className="sr-only">状態: </span>
            <span>{label}</span>
          </>
        )}
      </span>
    )
  }

  return (
    <>
      {variant === 'card' && presentation.effect !== 'none' && (
        <span
          className={`book-status-effect book-status-effect--${presentation.effect}`}
          aria-hidden="true"
        />
      )}
      <span className={badgeClassName} data-book-status={resolvedStatus}>
        {presentation.animated ? (
          <span className="book-status-spinner" aria-hidden="true" />
        ) : (
          Icon && <Icon size={13} strokeWidth={2.2} aria-hidden="true" />
        )}
        <span className="sr-only">状態: </span>
        <span>{label}</span>
      </span>
    </>
  )
}
