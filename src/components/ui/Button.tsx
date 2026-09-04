import { forwardRef, type ButtonHTMLAttributes } from 'react'

export type ButtonSize = 'default' | 'compact'
export type ButtonSolidTone = 'accent' | 'danger' | 'success' | 'warning'
export type ButtonOutlineTone = 'neutral' | 'accent' | 'danger' | 'success' | 'warning'
export type ButtonGhostTone = 'neutral' | 'accent' | 'danger'
export type ButtonTone = ButtonSolidTone | ButtonOutlineTone | ButtonGhostTone
export type ButtonVariant = 'solid' | 'outline' | 'ghost'

/**
 * Variants and tones are deliberately correlated. Keeping this as one union
 * means Button, IconButton, and buttonClassName reject unsupported pairs at
 * compile time while still allowing omitted values for the documented
 * defaults.
 */
export type ButtonStyle =
  | { variant: 'solid'; tone?: ButtonSolidTone; size?: ButtonSize }
  | { variant: 'outline'; tone?: ButtonOutlineTone; size?: ButtonSize }
  | { variant: 'ghost'; tone?: ButtonGhostTone; size?: ButtonSize }
  | { variant?: undefined; tone?: undefined; size?: ButtonSize }

export type ButtonClassNameOptions = ButtonStyle

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & ButtonStyle

type NormalizedButtonStyle = {
  variant: ButtonVariant
  tone: ButtonTone
  size: ButtonSize
}

function normalizeButtonStyle(style: ButtonStyle = {}): NormalizedButtonStyle {
  const variant = style.variant ?? 'outline'
  const tone = style.tone ?? (variant === 'solid' ? 'accent' : 'neutral')
  return { variant, tone, size: style.size ?? 'default' }
}

/** Build classes for both native buttons and button-like links. */
export function buttonClassName(style: ButtonStyle = {}, className?: string): string {
  const normalized = normalizeButtonStyle(style)
  const classes = [
    'button',
    `button--${normalized.variant}`,
    `button--tone-${normalized.tone}`,
    `button--size-${normalized.size}`,
  ]

  if (className) classes.push(className)
  return classes.join(' ')
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({
  className,
  type = 'button',
  variant,
  tone,
  size,
  ...props
}, ref) {
  const style = { variant, tone, size } as ButtonStyle
  return <button ref={ref} className={buttonClassName(style, className)} type={type} {...props} />
})
