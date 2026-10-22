import type { RangeKey, SeriesPoint } from '../types'

const DAYS: Record<RangeKey, number> = {
  '1y': 365,
  '6m': 182,
  '3m': 92,
  '1m': 31,
}

export const RANGE_OPTIONS: { key: RangeKey; label: string }[] = [
  { key: '1y', label: '一年' },
  { key: '6m', label: '半年' },
  { key: '3m', label: '三個月' },
  { key: '1m', label: '一個月' },
]

export function filterByRange(
  series: SeriesPoint[],
  range: RangeKey,
): SeriesPoint[] {
  if (!series.length) return []
  const last = new Date(series[series.length - 1].date).getTime()
  const min = last - DAYS[range] * 24 * 60 * 60 * 1000
  const filtered = series.filter((p) => new Date(p.date).getTime() >= min)
  // monthly series may be sparse — keep at least a few points for context
  if (filtered.length < 2 && series.length >= 2) {
    return series.slice(-Math.min(series.length, range === '1m' ? 3 : 6))
  }
  return filtered
}

export function formatNumber(n: number, digits = 2): string {
  return n.toLocaleString('zh-TW', {
    maximumFractionDigits: digits,
    minimumFractionDigits: Number.isInteger(n) ? 0 : Math.min(digits, 1),
  })
}

export function formatDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('zh-TW', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'Asia/Taipei',
  })
}
