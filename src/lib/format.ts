export function formatMoney(n: number, digits = 0): string {
  return new Intl.NumberFormat('zh-TW', {
    style: 'currency',
    currency: 'TWD',
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(n)
}

export function formatNumber(n: number, digits = 2): string {
  return new Intl.NumberFormat('zh-TW', {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(n)
}

export function formatPct(n: number, digits = 2): string {
  const sign = n > 0 ? '+' : ''
  return `${sign}${n.toFixed(digits)}%`
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}
