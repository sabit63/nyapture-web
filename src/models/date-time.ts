const jstDateTime = new Intl.DateTimeFormat('ja-JP', {
  timeZone: 'Asia/Tokyo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
})

/** API timestamps without an offset represent UTC; only the display is converted. */
export const formatDateTime = (value?: string | null): string => {
  if (!value?.trim()) return '—'
  const parts = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)(Z|[+-]\d{2}:?\d{2})?)?$/i.exec(value.trim())
  if (!parts) return '—'
  const date = new Date(`${parts[1]}T${parts[2] ?? '00:00:00'}${parts[3] ?? 'Z'}`)
  return Number.isNaN(date.getTime()) ? '—' : `${jstDateTime.format(date)} JST`
}
