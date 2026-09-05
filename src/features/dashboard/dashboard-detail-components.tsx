import {
  Check,
  CircleAlert,
  LoaderCircle,
  RefreshCw,
  RotateCcw,
  TriangleAlert,
  X,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { FormEvent, ReactNode, RefObject } from 'react'
import { useCallback } from 'react'
import type { DashboardResourceQuery, DashboardResourceStatus } from './use-dashboard-resource'
import { formatDateTime } from './formatters'
import {
  Button,
  Dialog,
  DialogBody,
  DialogFooter,
  DialogHeader,
  IconButton,
  type CloseReason,
} from '../../components/ui'

export type DetailStatus = DashboardResourceStatus
export type MutationStatus = 'idle' | 'pending' | 'success' | 'error'
export type DashboardDetailTone = 'success' | 'warning' | 'danger' | 'info' | 'muted'

export function StatusBadge({
  children,
  tone = 'muted',
  icon: Icon,
}: {
  children: ReactNode
  tone?: DashboardDetailTone
  icon?: LucideIcon
}) {
  return (
    <span className={`dashboard-detail__badge dashboard-detail__badge--${tone}`}>
      {Icon && <Icon size={13} aria-hidden="true" />}
      <span>{children}</span>
    </span>
  )
}

export function DetailSkeleton() {
  return <div className="dashboard-detail__loading" aria-hidden="true"><span className="dashboard-detail__spinner" /></div>
}

export function DetailState({
  status,
  error,
  onRetry,
}: {
  status: DetailStatus
  error: string | null
  onRetry: () => void
}) {
  if (status === 'loading') return <DetailSkeleton />
  if (!error) return null
  return (
    <div className="dashboard-detail__error" role="alert">
      <CircleAlert size={15} aria-hidden="true" />
      <span>{error}</span>
      <IconButton
        variant="ghost"
        tone="danger"
        size="compact"
        type="button"
        aria-label="再試行"
        onClick={onRetry}
        disabled={status === 'refreshing'}
      >
        <RefreshCw size={14} aria-hidden="true" />
      </IconButton>
    </div>
  )
}

export function DetailSection({
  title,
  count,
  children,
  className = '',
}: {
  title: string
  count?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={`dashboard-detail__section ${className}`}>
      <div className="dashboard-detail__section-heading">
        <h2>{title}</h2>
        {count !== undefined && <span className="dashboard-detail__count">{count}</span>}
      </div>
      {children}
    </section>
  )
}

export function MetricCard({
  label,
  value,
  icon: Icon,
  tone = 'muted',
}: {
  label: string
  value: ReactNode
  icon: LucideIcon
  tone?: DashboardDetailTone
}) {
  return (
    <article className="dashboard-detail__metric">
      <div className="dashboard-detail__metric-label">
        <span className={`dashboard-detail__metric-icon dashboard-detail__metric-icon--${tone}`} aria-hidden="true"><Icon size={17} /></span>
        <span>{label}</span>
      </div>
      <strong>{value}</strong>
    </article>
  )
}

export function DetailFrame<T>({
  title,
  query,
  children,
}: {
  title: string
  query: DashboardResourceQuery<T>
  children: ReactNode
}) {
  return (
    <div className="dashboard-detail__content" aria-busy={query.loading || query.refreshing}>
      <p className="dashboard__live-region dashboard-detail__live-region sr-only" role="status" aria-live="polite">{query.announcement}</p>
      <div className="dashboard-detail__meta-line">
        {query.generatedAt && <time className="dashboard-detail__generated" dateTime={query.generatedAt}>{formatDateTime(query.generatedAt)}</time>}
      </div>
      {query.error && (
        <div className="dashboard-detail__inline-error" role="alert">
          <CircleAlert size={15} aria-hidden="true" />
          <span>{query.error}</span>
          <IconButton
            variant="ghost"
            tone="danger"
            size="compact"
            type="button"
            aria-label={`${title}を再試行`}
            onClick={() => void query.refresh()}
            disabled={query.loading || query.refreshing}
          >
            <RotateCcw size={15} aria-hidden="true" />
          </IconButton>
        </div>
      )}
      {query.data === null
        ? query.loading
          ? <DetailSkeleton />
          : <div className="dashboard-detail__empty" role="status"><TriangleAlert size={18} aria-hidden="true" /><span>データなし</span></div>
        : children}
    </div>
  )
}

export function ActionFeedback({ status, message }: { status: MutationStatus; message: string | null }) {
  if (!message && status !== 'pending') return null
  return (
    <span className="dashboard-detail__feedback" role="status" aria-live="polite">
      {status === 'pending' && <LoaderCircle className="dashboard-detail__spin" size={14} aria-hidden="true" />}
      {status === 'success' && <Check size={14} aria-hidden="true" />}
      {status === 'error' && <CircleAlert size={14} aria-hidden="true" />}
      <span>{status === 'pending' ? '処理中' : message}</span>
    </span>
  )
}

export function ActionDialog({
  open,
  title,
  value,
  pending,
  confirmLabel,
  triggerRef,
  onConfirm,
  onDismiss,
}: {
  open: boolean
  title: string
  value?: ReactNode
  pending: boolean
  confirmLabel: string
  triggerRef?: RefObject<HTMLElement | null>
  onConfirm: () => void
  onDismiss: () => void
}) {
  const onRequestClose = useCallback((reason: CloseReason) => {
    if (pending || reason === 'submit') return false
    onDismiss()
    return true
  }, [onDismiss, pending])

  return (
    <Dialog
      open={open}
      className="dashboard-detail__dialog"
      aria-labelledby="dashboard-action-dialog-title"
      onRequestClose={onRequestClose}
      resolveRestoreFocus={() => triggerRef?.current ?? null}
      dismissible={!pending}
    >
      {({ requestClose }) => (
        <>
          <DialogHeader><h2 id="dashboard-action-dialog-title">{title}</h2></DialogHeader>
          <DialogBody>{value && <div>{value}</div>}</DialogBody>
          <DialogFooter className="dashboard-detail__dialog-actions">
            <Button variant="outline" tone="neutral" size="compact" type="button" disabled={pending} onClick={() => requestClose('close-button')}><X size={15} aria-hidden="true" />キャンセル</Button>
            <Button variant="solid" tone="accent" size="compact" type="button" aria-busy={pending} disabled={pending} onClick={onConfirm}>{pending ? <LoaderCircle className="dashboard-detail__spin" size={15} aria-hidden="true" /> : <Check size={15} aria-hidden="true" />}{pending ? '処理中' : confirmLabel}</Button>
          </DialogFooter>
        </>
      )}
    </Dialog>
  )
}

export function ConfirmDialog({
  open,
  title,
  value,
  pending,
  confirmLabel,
  triggerRef,
  onConfirm,
  onDismiss,
}: {
  open: boolean
  title: string
  value?: ReactNode
  pending: boolean
  confirmLabel: string
  triggerRef: RefObject<HTMLElement | null>
  onConfirm: () => void
  onDismiss: () => void
}) {
  const onRequestClose = useCallback((reason: CloseReason) => {
    if (pending || reason === 'submit') return false
    onDismiss()
    return true
  }, [onDismiss, pending])

  return (
    <Dialog
      open={open}
      className="dashboard-detail__dialog"
      aria-labelledby="dashboard-confirm-title"
      onRequestClose={onRequestClose}
      resolveRestoreFocus={() => triggerRef.current}
      dismissible={!pending}
    >
      {({ requestClose }) => (
        <>
          <DialogHeader><h2 id="dashboard-confirm-title">{title}</h2></DialogHeader>
          <DialogBody>{value && <div>{value}</div>}</DialogBody>
          <DialogFooter className="dashboard-detail__dialog-actions">
            <Button variant="outline" tone="neutral" size="compact" type="button" disabled={pending} onClick={() => requestClose('close-button')}><X size={15} aria-hidden="true" />キャンセル</Button>
            <Button variant="solid" tone="danger" size="compact" type="button" aria-busy={pending} disabled={pending} onClick={onConfirm}>{pending ? <LoaderCircle className="dashboard-detail__spin" size={15} aria-hidden="true" /> : <Check size={15} aria-hidden="true" />}{pending ? '処理中' : confirmLabel}</Button>
          </DialogFooter>
        </>
      )}
    </Dialog>
  )
}

export function BookCacheDialog({
  open,
  pending,
  bookId,
  triggerRef,
  onBookIdChange,
  onSubmit,
  onDismiss,
}: {
  open: boolean
  pending: boolean
  bookId: string
  triggerRef: RefObject<HTMLElement | null>
  onBookIdChange: (value: string) => void
  onSubmit: (event: FormEvent) => void
  onDismiss: () => void
}) {
  const onRequestClose = useCallback((reason: CloseReason) => {
    if (pending || reason === 'submit') return false
    onDismiss()
    return true
  }, [onDismiss, pending])

  return (
    <Dialog
      open={open}
      className="dashboard-detail__dialog"
      aria-labelledby="cache-remove-dialog-title"
      onRequestClose={onRequestClose}
      resolveRestoreFocus={() => triggerRef.current}
      dismissible={!pending}
    >
      {({ requestClose }) => (
        <form className="dashboard-detail__dialog-form" onSubmit={onSubmit}>
          <DialogHeader><h2 id="cache-remove-dialog-title">Cache 個別削除</h2></DialogHeader>
          <DialogBody><p>BookIdだけを指定します。</p><label>BookId<input value={bookId} onChange={(event) => onBookIdChange(event.target.value)} required /></label></DialogBody>
          <DialogFooter className="dashboard-detail__dialog-actions">
            <Button variant="outline" tone="neutral" size="compact" type="button" onClick={() => requestClose('close-button')} disabled={pending}>キャンセル</Button>
            <Button variant="solid" tone="danger" size="compact" type="submit" disabled={pending} aria-busy={pending}>{pending ? <LoaderCircle className="dashboard-detail__spin" size={14} aria-hidden="true" /> : <CircleAlert size={14} aria-hidden="true" />}削除</Button>
          </DialogFooter>
        </form>
      )}
    </Dialog>
  )
}
