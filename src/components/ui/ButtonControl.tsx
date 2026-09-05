import { forwardRef } from 'react'
import { buttonClassName, type ButtonProps, type ButtonStyle } from './Button'

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
