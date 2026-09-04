import { forwardRef, type ButtonHTMLAttributes } from 'react'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger-ghost'

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({
  className,
  type = 'button',
  variant = 'secondary',
  ...props
}, ref) {
  const classes = ['button', `button--${variant}`, className].filter(Boolean).join(' ')
  return <button ref={ref} className={classes} type={type} {...props} />
})
