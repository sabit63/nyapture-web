import { useLayoutEffect, useRef, useState, type CSSProperties, type HTMLAttributes } from 'react'
import type { DisplaySettings } from '../api'
import { automaticThumbnailColumns } from './thumbnail-columns'

export function BookGrid({ settings, onColumnsChange, ...props }: HTMLAttributes<HTMLDivElement> & {
  settings: DisplaySettings
  onColumnsChange?: (columns: number) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [columns, setColumns] = useState(settings.thumbnailColumns as number)
  useLayoutEffect(() => {
    const grid = ref.current
    if (!grid || !settings.autoThumbnailColumns) return
    const update = () => {
      const style = getComputedStyle(grid)
      const width = grid.clientWidth - (parseFloat(style.paddingLeft) || 0) - (parseFloat(style.paddingRight) || 0)
      if (width > 0) setColumns(automaticThumbnailColumns(width, parseFloat(style.columnGap) || 0))
    }
    update()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(update)
    observer.observe(grid)
    return () => observer.disconnect()
  }, [settings.autoThumbnailColumns])
  const resolvedColumns = settings.autoThumbnailColumns ? columns : settings.thumbnailColumns
  useLayoutEffect(() => { onColumnsChange?.(resolvedColumns) }, [onColumnsChange, resolvedColumns])
  return <div {...props} ref={ref} className="book-grid" style={{ '--thumbnail-columns': resolvedColumns } as CSSProperties} />
}
