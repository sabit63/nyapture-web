import { CheckCircle2, CircleAlert, TriangleAlert, type LucideIcon } from 'lucide-react'
import { useEffect } from 'react'
import type { SnackbarNotice, SnackbarTone } from './Snackbar'
import './snackbar.css'

type SnackbarProps = {
  notice: SnackbarNotice | null
  onDismiss: (id: number) => void
}

const TONE_ICONS: Record<SnackbarTone, LucideIcon> = {
  success: CheckCircle2,
  warning: TriangleAlert,
  error: CircleAlert,
}

export function Snackbar({ notice, onDismiss }: SnackbarProps) {
  useEffect(() => {
    if (!notice) return
    const duration = notice.tone === 'success' ? 4000 : 7000
    const timer = window.setTimeout(() => onDismiss(notice.id), duration)
    return () => window.clearTimeout(timer)
  }, [notice, onDismiss])

  if (!notice) return null

  const Icon = TONE_ICONS[notice.tone]
  const isError = notice.tone === 'error'
  return (
    <div
      className={`snackbar snackbar--${notice.tone}`}
      role={isError ? 'alert' : 'status'}
      aria-live={isError ? 'assertive' : 'polite'}
      aria-atomic="true"
    >
      <Icon className="snackbar__icon" size={16} aria-hidden="true" />
      <span className="snackbar__message">{notice.message}</span>
    </div>
  )
}
