import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent } from 'react'
import { X } from 'lucide-react'
import type { BookTag } from '../models'
import { getTagLabel, TAG_TYPE_LABELS } from '../models'
import './tag-chip.css'

type TagChipBaseProps = {
  tag: BookTag
  size: 'compact' | 'default'
  title?: string
  ariaLabel?: string
}

type TagChipSearchProps = TagChipBaseProps & {
  onClick: () => void
  onSearchDestinationRequest?: (tag: BookTag, trigger: HTMLButtonElement) => void
  onRemove?: never
}

type TagChipRemoveProps = TagChipBaseProps & {
  onClick?: never
  onRemove: () => void
}

type TagChipStaticProps = TagChipBaseProps & {
  onClick?: never
  onRemove?: never
}

export type TagChipProps = TagChipSearchProps | TagChipRemoveProps | TagChipStaticProps

const getTagCountLabel = (count: BookTag['count']) => (
  typeof count === 'number' && Number.isFinite(count)
    ? String(count)
    : undefined
)

const tagChipContent = (tag: BookTag, countLabel: string | undefined) => (
  <>
    <span className="tag-chip__hash" aria-hidden="true">#</span>
    <span className="tag-chip__label">{getTagLabel(tag)}</span>
    {countLabel !== undefined && (
      <span className="tag-chip__count">
        <span className="sr-only">使用回数 </span>
        {countLabel}
        <span className="sr-only"> 件</span>
      </span>
    )}
  </>
)

const LONG_PRESS_DURATION_MS = 500
const LONG_PRESS_MOVE_THRESHOLD_PX = 10
const SUPPRESS_CLICK_DURATION_MS = 1000

type PointerStart = {
  pointerId: number
  x: number
  y: number
}

function SearchTagChip({
  tag,
  size,
  title,
  ariaLabel,
  onClick,
  onSearchDestinationRequest,
}: TagChipSearchProps) {
  const [longPressPending, setLongPressPending] = useState(false)
  const longPressTimerRef = useRef<number | null>(null)
  const pointerStartRef = useRef<PointerStart | null>(null)
  const destinationRequestBlockedUntilRef = useRef(0)
  const suppressClickUntilRef = useRef(0)
  const hasDestinationChooser = onSearchDestinationRequest !== undefined

  useEffect(() => () => {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current)
      longPressTimerRef.current = null
    }
  }, [])

  const clearLongPress = () => {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current)
      longPressTimerRef.current = null
    }
    pointerStartRef.current = null
    setLongPressPending(false)
  }

  const requestSearchDestination = (trigger: HTMLButtonElement, suppressClick: boolean) => {
    if (!onSearchDestinationRequest) return
    const now = Date.now()
    if (now < destinationRequestBlockedUntilRef.current) return
    destinationRequestBlockedUntilRef.current = now + 250
    if (suppressClick) suppressClickUntilRef.current = now + SUPPRESS_CLICK_DURATION_MS
    onSearchDestinationRequest(tag, trigger)
  }

  const handlePointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    if (!hasDestinationChooser || event.button !== 0 || event.isPrimary === false) return

    clearLongPress()
    const trigger = event.currentTarget
    const pointerId = event.pointerId
    pointerStartRef.current = {
      pointerId,
      x: event.clientX,
      y: event.clientY,
    }
    setLongPressPending(true)
    longPressTimerRef.current = window.setTimeout(() => {
      const pointerStart = pointerStartRef.current
      if (!pointerStart || pointerStart.pointerId !== pointerId) return
      longPressTimerRef.current = null
      pointerStartRef.current = null
      setLongPressPending(false)
      requestSearchDestination(trigger, true)
    }, LONG_PRESS_DURATION_MS)
  }

  const handlePointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    const pointerStart = pointerStartRef.current
    if (!pointerStart || pointerStart.pointerId !== event.pointerId) return
    const distance = Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y)
    if (distance > LONG_PRESS_MOVE_THRESHOLD_PX) clearLongPress()
  }

  const handleContextMenu = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault()
    clearLongPress()
    requestSearchDestination(event.currentTarget, event.button !== 2)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const isDestinationKey = event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)
    if (!hasDestinationChooser || !isDestinationKey || event.repeat) return
    event.preventDefault()
    clearLongPress()
    requestSearchDestination(event.currentTarget, false)
  }

  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    if (Date.now() < suppressClickUntilRef.current) {
      event.preventDefault()
      suppressClickUntilRef.current = 0
      return
    }
    onClick()
  }

  const label = getTagLabel(tag)
  const countLabel = getTagCountLabel(tag.count)
  const countAriaLabel = countLabel === undefined ? '' : `（使用回数${countLabel}件）`
  const typeLabel = TAG_TYPE_LABELS[tag.type]
  const className = `tag-chip tag-chip--${size}${longPressPending ? ' tag-chip--long-press-pending' : ''}`
  const commonProps = {
    className,
    'data-tag-type': tag.type,
    title,
  }
  const defaultAriaLabel = hasDestinationChooser
    ? `${typeLabel}「${label}」${countAriaLabel}をクリックして検索（長押しまたはコンテキストメニューで検索先を選択）`
    : `${typeLabel}「${label}」${countAriaLabel}で検索`

  return (
    <button
      {...commonProps}
      type="button"
      aria-label={ariaLabel ?? defaultAriaLabel}
      aria-haspopup={hasDestinationChooser ? 'dialog' : undefined}
      aria-controls={hasDestinationChooser ? 'tag-search-destination-dialog' : undefined}
      onClick={hasDestinationChooser ? handleClick : onClick}
      onPointerDown={hasDestinationChooser ? handlePointerDown : undefined}
      onPointerMove={hasDestinationChooser ? handlePointerMove : undefined}
      onPointerUp={hasDestinationChooser ? clearLongPress : undefined}
      onPointerCancel={hasDestinationChooser ? clearLongPress : undefined}
      onPointerLeave={hasDestinationChooser ? clearLongPress : undefined}
      onContextMenu={hasDestinationChooser ? handleContextMenu : undefined}
      onKeyDown={hasDestinationChooser ? handleKeyDown : undefined}
    >
      {tagChipContent(tag, countLabel)}
    </button>
  )
}

export function TagChip(props: TagChipProps) {
  const { tag, size, title, ariaLabel } = props
  const label = getTagLabel(tag)
  const countLabel = getTagCountLabel(tag.count)
  const countAriaLabel = countLabel === undefined ? '' : `（使用回数${countLabel}件）`
  const typeLabel = TAG_TYPE_LABELS[tag.type]
  const className = `tag-chip tag-chip--${size}`
  const commonProps = {
    className,
    'data-tag-type': tag.type,
    title,
  }

  if ('onClick' in props && props.onClick) {
    return <SearchTagChip {...props} />
  }

  if ('onRemove' in props && props.onRemove) {
    return (
      <button
        {...commonProps}
        type="button"
        aria-label={ariaLabel ?? `${typeLabel}「${label}」${countAriaLabel}を削除`}
        onClick={props.onRemove}
      >
        {tagChipContent(tag, countLabel)}
        <X className="tag-chip__remove" size={13} aria-hidden="true" />
      </button>
    )
  }

  return (
    <span {...commonProps}>
      <span className="sr-only">{typeLabel}: </span>
      {tagChipContent(tag, countLabel)}
    </span>
  )
}
