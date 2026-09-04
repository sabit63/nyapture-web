import { forwardRef, type ButtonHTMLAttributes } from 'react'

export type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement>

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton({
  className,
  type = 'button',
  ...props
}, ref) {
  const classes = ['icon-button', className].filter(Boolean).join(' ')
  return <button ref={ref} className={classes} type={type} {...props} />
})
