import { forwardRef, useCallback, type DialogHTMLAttributes, type HTMLAttributes, type ReactNode } from 'react'
import { DialogContext, useNativeDialog, type NativeDialogControls, type NativeDialogOptions } from './Dialog'

export type DialogRenderControls = Pick<NativeDialogControls, 'dialogRef' | 'requestClose'>

export type DialogProps = Omit<DialogHTMLAttributes<HTMLDialogElement>, 'children' | 'open' | 'onCancel' | 'onClose' | 'onPointerDown' | 'onPointerCancel' | 'onClick'> & NativeDialogOptions & {
  children: ReactNode | ((controls: DialogRenderControls) => ReactNode)
}

export const Dialog = forwardRef<HTMLDialogElement, DialogProps>(function Dialog({
  className,
  children,
  open,
  onRequestClose,
  onAfterClose,
  initialFocusRef,
  resolveRestoreFocus,
  dismissible,
  ...props
}, forwardedRef) {
  const controls = useNativeDialog({
    open,
    onRequestClose,
    onAfterClose,
    initialFocusRef,
    resolveRestoreFocus,
    dismissible,
  })
  const setDialogRef = useCallback((node: HTMLDialogElement | null) => {
    controls.dialogRef.current = node
    if (typeof forwardedRef === 'function') forwardedRef(node)
    else if (forwardedRef) forwardedRef.current = node
  }, [controls.dialogRef, forwardedRef])
  const classes = ['ui-dialog', className].filter(Boolean).join(' ')

  return (
    <DialogContext.Provider value={{ dialogRef: controls.dialogRef, requestClose: controls.requestClose, open }}>
      <dialog
        {...props}
        ref={setDialogRef}
        className={classes}
        onCancel={controls.onCancel}
        onClose={controls.onClose}
        onPointerDown={controls.onPointerDown}
        onClick={controls.onClick}
        onPointerCancel={controls.onPointerCancel}
      >
        {typeof children === 'function'
          ? children({ dialogRef: controls.dialogRef, requestClose: controls.requestClose })
          : children}
      </dialog>
    </DialogContext.Provider>
  )
})

type DialogHeaderProps = HTMLAttributes<HTMLElement>
export function DialogHeader({ className, ...props }: DialogHeaderProps) {
  return <header {...props} className={['ui-dialog__header', className].filter(Boolean).join(' ')} />
}

type DialogBodyProps = HTMLAttributes<HTMLDivElement>
export function DialogBody({ className, ...props }: DialogBodyProps) {
  return <div {...props} className={['ui-dialog__body', className].filter(Boolean).join(' ')} />
}

type DialogFooterProps = HTMLAttributes<HTMLElement>
export function DialogFooter({ className, ...props }: DialogFooterProps) {
  return <footer {...props} className={['ui-dialog__footer', className].filter(Boolean).join(' ')} />
}
