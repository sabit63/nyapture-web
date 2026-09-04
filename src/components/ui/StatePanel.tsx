import type { ReactNode } from 'react'

import './state-panel.css'

export type StatePanelTone = 'neutral' | 'danger'

export type StatePanelProps = {
  title: string
  description?: string
  icon?: ReactNode
  action?: ReactNode
  tone?: StatePanelTone
  role?: 'status' | 'alert'
  className?: string
}

export function StatePanel({
  title,
  description,
  icon,
  action,
  tone = 'neutral',
  role = 'status',
  className,
}: StatePanelProps) {
  const classes = ['state-panel', `state-panel--${tone}`, className].filter(Boolean).join(' ')

  return (
    <div className={classes} role={role}>
      {icon && <span className="state-panel__icon" aria-hidden="true">{icon}</span>}
      <strong>{title}</strong>
      {description && <span>{description}</span>}
      {action}
    </div>
  )
}
