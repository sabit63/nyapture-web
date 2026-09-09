import { EllipsisVertical, X } from 'lucide-react'
import { useId, useRef, useState, type ReactNode } from 'react'
import { IconButton } from '../../components/ui'

export function ViewerControlPanel({ children }: { children: ReactNode }) {
  const [expanded, setExpanded] = useState(() => (
    typeof window !== 'undefined' && window.matchMedia?.('(min-width: 640px)').matches === true
  ))
  const id = useId()
  const trigger = useRef<HTMLButtonElement>(null)
  return (
    <div className="book-viewer__control-panel" role="group" aria-label="閲覧操作"
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || event.defaultPrevented || !expanded) return
        event.preventDefault()
        setExpanded(false)
        trigger.current?.focus()
      }}>
      <div id={id} className="book-viewer__control-panel-content" hidden={!expanded}>
        {children}
      </div>
      <IconButton ref={trigger} className="book-viewer__floating-control"
        aria-label={expanded ? '閲覧操作を折りたたむ' : '閲覧操作を展開'}
        aria-expanded={expanded} aria-controls={id}
        onClick={() => setExpanded((current) => !current)}>
        {expanded ? <X size={18} aria-hidden="true" /> : <EllipsisVertical size={18} aria-hidden="true" />}
      </IconButton>
    </div>
  )
}
