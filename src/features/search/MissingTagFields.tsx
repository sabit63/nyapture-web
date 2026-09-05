import { TAG_TYPE_LABELS, TAG_TYPE_ORDER } from '../../models'
import type { NyaTagType } from '../../models'

type MissingTagFieldsProps = {
  id: string
  value: NyaTagType[]
  onChange: (value: NyaTagType[]) => void
  error?: string
}

export function MissingTagFields({ id, value, onChange, error }: MissingTagFieldsProps) {
  return (
    <fieldset className="missing-tag-fields" aria-label="未設定タグの種類" aria-describedby={error ? `${id}-error` : undefined} aria-invalid={Boolean(error)}>
      <div className="missing-tag-options">
        {TAG_TYPE_ORDER.map((type) => (
          <label key={type}>
            <input
              type="checkbox"
              checked={value.includes(type)}
              onChange={(event) => onChange(TAG_TYPE_ORDER.filter((candidate) => candidate === type ? event.target.checked : value.includes(candidate)))}
            />
            {TAG_TYPE_LABELS[type]}
          </label>
        ))}
      </div>
      {error && <p id={`${id}-error`} className="advanced-field-error" role="alert">{error}</p>}
    </fieldset>
  )
}
