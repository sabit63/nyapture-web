import type { ReactNode } from 'react'

import './state-panel.css'

export type StatePanelTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger'

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
  const classes = [
    'tw:flex tw:min-h-[210px] tw:flex-col tw:items-center tw:justify-center tw:gap-(--layout-control-gap) tw:mt-1 tw:p-6 tw:border tw:border-dashed tw:border-(--color-border) tw:rounded-(--radius-surface) tw:text-(--color-neutral-text) tw:text-center',
    `state-panel--${tone}`,
    className,
  ].filter(Boolean).join(' ')

  return (
    <div className={classes} role={role}>
      {icon && <span className="state-panel__icon tw:inline-grid tw:place-items-center" aria-hidden="true">{icon}</span>}
      <strong className="tw:text-(--color-neutral-on-fill) tw:text-(length:--font-size-label-md)">{title}</strong>
      {description && <span className="tw:text-(length:--font-size-label-sm)">{description}</span>}
      {action}
    </div>
  )
}
