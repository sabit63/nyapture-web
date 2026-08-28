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

const tagChipContent = (tag: BookTag) => (
  <>
    <span className="tag-chip__hash" aria-hidden="true">#</span>
    <span className="tag-chip__label">{getTagLabel(tag)}</span>
  </>
)

export function TagChip(props: TagChipProps) {
  const { tag, size, title, ariaLabel } = props
  const label = getTagLabel(tag)
  const typeLabel = TAG_TYPE_LABELS[tag.type]
  const className = `tag-chip tag-chip--${size}`
  const commonProps = {
    className,
    'data-tag-type': tag.type,
    title,
  }

  if ('onClick' in props && props.onClick) {
    return (
      <button
        {...commonProps}
        type="button"
        aria-label={ariaLabel ?? `${typeLabel}「${label}」で検索`}
        onClick={props.onClick}
      >
        {tagChipContent(tag)}
      </button>
    )
  }

  if ('onRemove' in props && props.onRemove) {
    return (
      <button
        {...commonProps}
        type="button"
        aria-label={ariaLabel ?? `${typeLabel}「${label}」を削除`}
        onClick={props.onRemove}
      >
        {tagChipContent(tag)}
        <X className="tag-chip__remove" size={13} aria-hidden="true" />
      </button>
    )
  }

  return (
    <span {...commonProps}>
      <span className="sr-only">{typeLabel}: </span>
      {tagChipContent(tag)}
    </span>
  )
}
