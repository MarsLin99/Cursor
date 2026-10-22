export type SeriesPoint = {
  date: string
  value: number
  label?: string
}

export type IndicatorSeries = {
  id: string
  title: string
  unit: string
  frequency: 'daily' | 'monthly'
  latest: SeriesPoint | null
  change?: number | null
  note?: string
  source: string
  series: SeriesPoint[]
  meta?: Record<string, string | number | null>
}

export type StockSummary = {
  date: string
  index: number
  change: number
  changePercent: number | null
  volumeShares: number
  turnoverTwd: number
  trades: number
  source: string
  note: string
}

export type IndicatorsPayload = {
  updatedAt: string
  indicators: IndicatorSeries[]
  stock: StockSummary | null
  cached?: boolean
}

export type RangeKey = '1y' | '6m' | '3m' | '1m'
