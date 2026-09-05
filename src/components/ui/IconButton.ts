import { type ButtonHTMLAttributes } from 'react'

import {
  type ButtonSize,
  type ButtonStyle,
  type ButtonTone,
  type ButtonVariant,
} from './Button'

export type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & ButtonStyle

type NormalizedIconButtonStyle = {
  variant: ButtonVariant
  tone: ButtonTone
  size: ButtonSize
}

function normalizeIconButtonStyle(style: ButtonStyle = {}): NormalizedIconButtonStyle {
  const variant = style.variant ?? 'ghost'
  const tone = style.tone ?? 'neutral'
  return { variant, tone, size: style.size ?? 'default' }
}

export function iconButtonClassName(style: ButtonStyle = {}, className?: string): string {
  const normalized = normalizeIconButtonStyle(style)
  const classes = [
    'icon-button',
    `icon-button--${normalized.variant}`,
    `icon-button--tone-${normalized.tone}`,
    `icon-button--size-${normalized.size}`,
  ]

  if (className) classes.push(className)
  return classes.join(' ')
}

export { IconButton } from './IconButtonControl'
