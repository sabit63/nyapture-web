import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  type MouseEvent,
  type PointerEvent,
  type RefObject,
  type SyntheticEvent,
} from 'react'

export type CloseReason = 'escape' | 'backdrop' | 'close-button' | 'submit' | 'programmatic'

export type NativeDialogOptions = {
  open: boolean
  onRequestClose: (reason: CloseReason) => boolean
  onAfterClose?: (reason: CloseReason) => void
  initialFocusRef?: RefObject<HTMLElement | null>
  resolveRestoreFocus?: (reason: CloseReason) => HTMLElement | null
  dismissible?: boolean
}

export type NativeDialogControls = {
  dialogRef: RefObject<HTMLDialogElement | null>
  requestClose: (reason: CloseReason) => boolean
  onCancel: (event: SyntheticEvent<HTMLDialogElement>) => void
  onClose: (event: SyntheticEvent<HTMLDialogElement>) => void
  onPointerDown: (event: PointerEvent<HTMLDialogElement>) => void
  onClick: (event: MouseEvent<HTMLDialogElement>) => void
  onPointerCancel: (event: PointerEvent<HTMLDialogElement>) => void
}

const EXPLICIT_CLOSE_REASONS: ReadonlySet<CloseReason> = new Set([
  'escape',
  'backdrop',
  'close-button',
])

function scheduleFrame(callback: () => void) {
  if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
    window.requestAnimationFrame(callback)
  } else {
    callback()
  }
}

function focusIfAvailable(target: HTMLElement | null) {
  if (
    !target
    || !target.isConnected
    || target.hasAttribute('disabled')
    || target.getAttribute('aria-disabled') === 'true'
  ) return
  target.focus({ preventScroll: true })
}

function showNativeDialog(dialog: HTMLDialogElement) {
  if (dialog.open) return
  if (typeof dialog.showModal === 'function') {
    try {
      dialog.showModal()
      return
    } catch {
      // A non-modal fallback keeps controlled rendering usable in test DOMs
      // and browsers that expose dialog but not the modal methods.
    }
  }
  dialog.setAttribute('open', '')
}

function closeNativeDialog(dialog: HTMLDialogElement) {
  if (!dialog.open) return
  if (typeof dialog.close === 'function') {
    try {
      dialog.close()
      return
    } catch {
      // Fall through to the non-modal fallback described above.
    }
  }
  dialog.removeAttribute('open')
}

export function useNativeDialog({
  open,
  onRequestClose,
  onAfterClose,
  initialFocusRef,
  resolveRestoreFocus,
  dismissible = true,
}: NativeDialogOptions): NativeDialogControls {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const openRef = useRef(open)
  const onRequestCloseRef = useRef(onRequestClose)
  const onAfterCloseRef = useRef(onAfterClose)
  const initialFocusRefRef = useRef(initialFocusRef)
  const resolveRestoreFocusRef = useRef(resolveRestoreFocus)
  const dismissibleRef = useRef(dismissible)
  const restoreFocusTargetRef = useRef<HTMLElement | null>(null)
  const pendingReasonRef = useRef<CloseReason | null>(null)
  const controlledCloseRef = useRef(false)
  const closeHandledRef = useRef(true)
  const pointerStartedOutsideRef = useRef(false)

  openRef.current = open
  onRequestCloseRef.current = onRequestClose
  onAfterCloseRef.current = onAfterClose
  initialFocusRefRef.current = initialFocusRef
  resolveRestoreFocusRef.current = resolveRestoreFocus
  dismissibleRef.current = dismissible

  const finalizeClose = useCallback((reason: CloseReason) => {
    if (closeHandledRef.current) return
    closeHandledRef.current = true
    onAfterCloseRef.current?.(reason)

    const resolver = resolveRestoreFocusRef.current
    if (!resolver && !EXPLICIT_CLOSE_REASONS.has(reason)) return
    scheduleFrame(() => {
      const target = resolver
        ? resolver(reason)
        : restoreFocusTargetRef.current
      focusIfAvailable(target)
    })
  }, [])

  const requestClose = useCallback((reason: CloseReason) => {
    if (
      !dismissibleRef.current
      && (reason === 'escape' || reason === 'backdrop' || reason === 'close-button')
    ) return false

    const dialog = dialogRef.current
    pendingReasonRef.current = reason
    closeHandledRef.current = false
    const accepted = onRequestCloseRef.current(reason)
    if (!accepted) {
      pendingReasonRef.current = null
      closeHandledRef.current = true
      return false
    }

    // A request against an already-closed dialog has no native close event to
    // finalize. The caller remains responsible for controlled state.
    if (!dialog?.open) {
      pendingReasonRef.current = null
      closeHandledRef.current = true
    }
    return true
  }, [])

  const handleCancel = useCallback((event: SyntheticEvent<HTMLDialogElement>) => {
    event.preventDefault()
    if (dismissibleRef.current) requestClose('escape')
  }, [requestClose])

  const handleClose = useCallback(() => {
    const requestedReason = pendingReasonRef.current
    pendingReasonRef.current = null

    if (controlledCloseRef.current) {
      controlledCloseRef.current = false
      finalizeClose(requestedReason ?? 'programmatic')
      return
    }

    if (requestedReason) {
      finalizeClose(requestedReason)
      return
    }

    // A native close that was not requested through this hook is unexpected.
    // Give the controlled owner one chance to reject it and reopen the dialog.
    if (openRef.current) {
      const accepted = onRequestCloseRef.current('programmatic')
      if (!accepted) {
        closeHandledRef.current = false
        scheduleFrame(() => {
          const dialog = dialogRef.current
          if (openRef.current && dialog && !dialog.open) showNativeDialog(dialog)
        })
        return
      }
      finalizeClose('programmatic')
      return
    }

    finalizeClose('programmatic')
  }, [finalizeClose])

  const handlePointerDown = useCallback((event: PointerEvent<HTMLDialogElement>) => {
    pointerStartedOutsideRef.current = event.target === event.currentTarget
  }, [])

  const handleClick = useCallback((event: MouseEvent<HTMLDialogElement>) => {
    const startedOutside = pointerStartedOutsideRef.current
    pointerStartedOutsideRef.current = false
    if (dismissibleRef.current && startedOutside && event.target === event.currentTarget) {
      requestClose('backdrop')
    }
  }, [requestClose])

  const handlePointerCancel = useCallback(() => {
    pointerStartedOutsideRef.current = false
  }, [])

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return

    if (open && !dialog.open) {
      const activeElement = document.activeElement
      restoreFocusTargetRef.current = activeElement instanceof HTMLElement && activeElement !== document.body
        ? activeElement
        : null
      closeHandledRef.current = false
      showNativeDialog(dialog)
      scheduleFrame(() => {
        focusIfAvailable(initialFocusRefRef.current?.current ?? null)
      })
    } else if (!open && dialog.open) {
      if (!pendingReasonRef.current) controlledCloseRef.current = true
      closeNativeDialog(dialog)
    }
  }, [open])

  return {
    dialogRef,
    requestClose,
    onCancel: handleCancel,
    onClose: handleClose,
    onPointerDown: handlePointerDown,
    onClick: handleClick,
    onPointerCancel: handlePointerCancel,
  }
}

export function useDialogIds(prefix = 'ui-dialog') {
  const id = useId().replaceAll(':', '')
  return {
    titleId: `${prefix}-${id}-title`,
    descriptionId: `${prefix}-${id}-description`,
  }
}

type DialogContextValue = Pick<NativeDialogControls, 'dialogRef' | 'requestClose'> & { open: boolean }
export const DialogContext = createContext<DialogContextValue | null>(null)

export function useDialogContext() {
  const context = useContext(DialogContext)
  if (!context) throw new Error('useDialogContext must be used within <Dialog>')
  return context
}

export { Dialog, DialogBody, DialogFooter, DialogHeader, type DialogProps, type DialogRenderControls } from './DialogFrame'
