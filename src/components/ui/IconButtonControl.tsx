import { forwardRef } from 'react'
import { iconButtonClassName, type IconButtonProps } from './IconButton'
import type { ButtonStyle } from './Button'

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton({
  className,
  type = 'button',
  variant,
  tone,
  size,
  ...props
}, ref) {
  const style = { variant, tone, size } as ButtonStyle
  return <button ref={ref} className={iconButtonClassName(style, className)} type={type} {...props} />
})
