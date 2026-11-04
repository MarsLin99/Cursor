export function fmt(value: number | null | undefined, digits = 2) {
  if (value == null || Number.isNaN(value)) return '—'
  return value.toLocaleString('zh-TW', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
}

export function signed(value: number | null | undefined, digits = 2) {
  if (value == null || Number.isNaN(value)) return '—'
  const text = fmt(Math.abs(value), digits)
  if (value > 0) return `+${text}`
  if (value < 0) return `-${text}`
  return text
}

export function yi(value: number | null | undefined) {
  if (value == null) return '—'
  return `${signed(value / 1e8, 1)}億`
}

export function tone(value: number | null | undefined) {
  if (value == null || value === 0) return ''
  return value > 0 ? 'up' : 'down'
}

export function clock(iso: string | null) {
  if (!iso) return '尚未掃描'
  return new Date(iso).toLocaleString('zh-TW', {
    timeZone: 'Asia/Taipei',
    hour12: false,
  })
}
