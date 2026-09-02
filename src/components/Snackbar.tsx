import { CheckCircle2, CircleAlert, TriangleAlert } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

import './snackbar.css'

export type SnackbarTone = 'success' | 'warning' | 'error'

export type SnackbarNotice = {
  id: number
  message: string
  tone: SnackbarTone
}

type SnackbarProps = {
  notice: SnackbarNotice | null
  onDismiss: (id: number) => void
}

const TONE_ICONS: Record<SnackbarTone, LucideIcon> = {
  success: CheckCircle2,
  warning: TriangleAlert,
  error: CircleAlert,
}

export const useSnackbar = () => {
  const [notice, setNotice] = useState<SnackbarNotice | null>(null)
  const nextIdRef = useRef(0)

  const notify = useCallback((message: string, tone: SnackbarTone = 'success') => {
    const id = nextIdRef.current + 1
    nextIdRef.current = id
    setNotice({ id, message, tone })
  }, [])

  const dismiss = useCallback((id?: number) => {
    setNotice((current) => id === undefined || current?.id === id ? null : current)
  }, [])

  return { notice, notify, dismiss }
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
