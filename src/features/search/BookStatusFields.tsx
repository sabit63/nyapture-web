import { NYA_BOOK_STATUSES, BOOK_STATUS_LABELS } from '../../models'
import type { NyaBookStatus } from '../../models'


type BookStatusFieldsProps = {
  id: string
  value: NyaBookStatus[]
  onChange: (value: NyaBookStatus[]) => void
  error?: string
}

export function BookStatusFields({ id, value, onChange, error }: BookStatusFieldsProps) {
  return (
    <fieldset className="missing-tag-fields" aria-label="BookStatus" aria-describedby={error ? `${id}-error` : undefined} aria-invalid={Boolean(error)}>
      <div className="missing-tag-options">
        {NYA_BOOK_STATUSES.map((status) => (
          <label key={status}>
            <input type="checkbox" checked={value.includes(status)}
              onChange={(event) => onChange(NYA_BOOK_STATUSES.filter((candidate) => candidate === status ? event.target.checked : value.includes(candidate)))} />
            {BOOK_STATUS_LABELS[status]}
          </label>
        ))}
      </div>
      {error && <p id={`${id}-error`} className="advanced-field-error" role="alert">{error}</p>}
    </fieldset>
  )
}
